#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { stdin, stdout } from "node:process";
import { Readable } from "node:stream";
import { createDefaultToolRegistry } from "@mecha/agent-tools";
import {
  createProtocolEnvelopeV1,
  createSidecarHelloV1,
  SIDECAR_HANDSHAKE_TIMEOUT_MS,
  SIDECAR_MAX_FRAME_BYTES,
  type AgentRunEvent,
  type AnyProtocolEnvelopeV1,
  type ProtocolEventTypeV1,
  type ProtocolPayloadByTypeV1,
  type SidecarCancelReason,
  type SidecarChatMessageV1,
  type SidecarControlMessageV1,
  type SidecarHelloAckV1,
  type SidecarRunStartV1
} from "@mecha/protocol";
import { ChatRuntime } from "../runtime/chat-runtime.js";

/** Sidecar 入口的 Runtime 版本，发布构建可通过环境变量覆盖。 */
const RUNTIME_VERSION =
  process.env.MECHA_RUNTIME_VERSION ?? process.env.npm_package_version ?? "0.1.0";

/** 一次 sidecar 进程只承载一个 Run，避免阶段 2 生命周期域交叉。 */
let activeRun:
  | {
      runId: string;
      abortController: AbortController;
      cancelReason?: SidecarCancelReason;
    }
  | undefined;

/**
 * Runtime sidecar 主入口。
 *
 * 该进程只通过 stdin/stdout framed IPC 与 Tauri 通信，stderr 只用于脱敏诊断。
 * 启动后先发送 hello，等待 hello_ack，再等待单个 run_start。
 */
async function main(): Promise<void> {
  const framed = new FramedJsonDuplex(Readable.toWeb(stdin) as ReadableStream<Uint8Array>);

  await framed.write(createSidecarHelloV1({
    runtimeVersion: RUNTIME_VERSION,
    instanceId: randomUUID()
  }));

  const ack = await readWithTimeout(
    framed,
    SIDECAR_HANDSHAKE_TIMEOUT_MS,
    "等待 Tauri sidecar 握手确认超时。"
  );

  if (!isHelloAck(ack)) {
    throw new Error("Tauri sidecar 握手确认无效。");
  }

  for await (const message of framed.readMessages()) {
    const control = decodeControlMessage(message);

    if (control.type === "run_start") {
      if (activeRun) {
        throw new Error("当前 sidecar 已经有运行中的 Run。");
      }

      const runPromise = runAgent(framed, control);

      await readControlMessagesUntilRunDone(framed, runPromise);
      return;
    }

    if (control.type === "cancel") {
      cancelActiveRun(control.runId, control.reason);
    }
  }
}

async function readControlMessagesUntilRunDone(
  framed: FramedJsonDuplex,
  runPromise: Promise<void>
): Promise<void> {
  while (true) {
    const result = await Promise.race([
      runPromise.then(() => ({ type: "run_done" as const })),
      framed.readOne().then((message) => ({
        type: "control" as const,
        message
      }))
    ]);

    if (result.type === "run_done") {
      await runPromise;
      return;
    }

    const control = decodeControlMessage(result.message);

    if (control.type === "cancel") {
      cancelActiveRun(control.runId, control.reason);
      continue;
    }

    if (control.type === "run_start") {
      throw new Error("当前 sidecar 只允许单个 Run。");
    }
  }
}

async function runAgent(
  framed: FramedJsonDuplex,
  request: SidecarRunStartV1
): Promise<void> {
  const abortController = new AbortController();

  activeRun = {
    runId: request.runId,
    abortController
  };

  const runtime = new ChatRuntime({
    provider: request.provider,
    model: request.model
  });
  const toolRegistry = request.useTools === false
    ? undefined
    : createDefaultToolRegistry({
        workspaceRoot: request.workspaceRoot
      });
  let seq = 0;

  try {
    for await (const event of runtime.run(
      { messages: request.messages, model: request.model },
      {
        runId: request.runId,
        messageId: request.messageId,
        toolRegistry,
        abortSignal: abortController.signal
      }
    )) {
      await framed.write(toProtocolEnvelope(event, seq++));
    }
  } finally {
    activeRun = undefined;
  }
}

function cancelActiveRun(runId: string, reason: SidecarCancelReason): void {
  if (!activeRun || activeRun.runId !== runId || activeRun.abortController.signal.aborted) {
    return;
  }

  activeRun.cancelReason = reason;
  activeRun.abortController.abort(reason);
}

function toProtocolEnvelope(
  event: AgentRunEvent,
  seq: number
): AnyProtocolEnvelopeV1 {
  const runId = event.runId ?? activeRun?.runId ?? "unknown-run";

  switch (event.type) {
    case "run_start":
      return envelope(runId, seq, "run_start", {});
    case "security_snapshot":
      return envelope(runId, seq, "security_snapshot", {
        snapshot: event.snapshot
      });
    case "model_request_start":
      return envelope(runId, seq, "model_request_start", {});
    case "message_start":
      return envelope(runId, seq, "message_start", {
        messageId: event.messageId,
        role: event.role
      });
    case "text_delta":
      return envelope(runId, seq, "text_delta", {
        messageId: event.messageId,
        text: event.text
      });
    case "message_done":
      return envelope(runId, seq, "message_done", {
        messageId: event.messageId
      });
    case "tool_call_start":
      return envelope(runId, seq, "tool_call_start", {
        toolCallId: event.toolCallId,
        name: event.name,
        permission: event.permission,
        input: event.input
      });
    case "tool_result":
      return envelope(runId, seq, "tool_result", {
        toolCallId: event.toolCallId,
        output: event.output
      });
    case "tool_call_done":
      return envelope(runId, seq, "tool_call_done", {
        toolCallId: event.toolCallId
      });
    case "error":
      return envelope(runId, seq, "error", {
        code: "RUNTIME_RUN_ERROR",
        message: event.message,
        retryable: false,
        source: "runtime"
      });
    case "run_done":
      return envelope(runId, seq, "run_done", {
        status: event.status ?? "completed"
      });
  }
}

function envelope<TType extends ProtocolEventTypeV1>(
  runId: string,
  seq: number,
  type: TType,
  payload: ProtocolPayloadByTypeV1[TType]
): AnyProtocolEnvelopeV1 {
  return createProtocolEnvelopeV1({
    runId,
    seq,
    type,
    payload
  }) as AnyProtocolEnvelopeV1;
}

async function readWithTimeout(
  framed: FramedJsonDuplex,
  timeoutMs: number,
  timeoutMessage: string
): Promise<unknown> {
  return await Promise.race([
    framed.readOne(),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    })
  ]);
}

function decodeControlMessage(message: unknown): SidecarControlMessageV1 {
  if (!isRecord(message) || typeof message.type !== "string") {
    throw new Error("sidecar 控制消息必须包含 type。");
  }

  if (message.type === "hello_ack") {
    if (!isHelloAck(message)) {
      throw new Error("sidecar hello_ack 消息无效。");
    }

    return message;
  }

  if (message.type === "run_start") {
    return decodeRunStart(message);
  }

  if (message.type === "cancel") {
    if (!isNonEmptyString(message.runId)) {
      throw new Error("cancel 消息缺少 runId。");
    }

    if (!isCancelReason(message.reason)) {
      throw new Error("cancel 消息缺少有效 reason。");
    }

    return {
      type: "cancel",
      runId: message.runId,
      reason: message.reason
    };
  }

  throw new Error(`未知 sidecar 控制消息：${message.type}`);
}

function decodeRunStart(message: Record<string, unknown>): SidecarRunStartV1 {
  if (!isNonEmptyString(message.runId)) {
    throw new Error("run_start 消息缺少 runId。");
  }

  if (message.provider !== "openai" && message.provider !== "anthropic") {
    throw new Error("run_start 消息 provider 只能是 openai 或 anthropic。");
  }

  if (!isNonEmptyString(message.workspaceRoot)) {
    throw new Error("run_start 消息缺少 workspaceRoot。");
  }

  if (!Array.isArray(message.messages)) {
    throw new Error("run_start 消息缺少 messages 数组。");
  }

  const messages: SidecarChatMessageV1[] = message.messages.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`第 ${index} 条消息必须是对象。`);
    }

    const role = item.role;

    if (role !== "system" && role !== "user" && role !== "assistant") {
      throw new Error(`第 ${index} 条消息 role 不受支持。`);
    }

    if (typeof item.content !== "string") {
      throw new Error(`第 ${index} 条消息缺少字符串 content。`);
    }

    return {
      role,
      content: item.content
    };
  });

  return {
    type: "run_start",
    runId: message.runId,
    provider: message.provider,
    workspaceRoot: message.workspaceRoot,
    messages,
    ...(isNonEmptyString(message.model) ? { model: message.model } : {}),
    ...(isNonEmptyString(message.messageId) ? { messageId: message.messageId } : {}),
    ...(typeof message.useTools === "boolean" ? { useTools: message.useTools } : {})
  };
}

function isHelloAck(message: unknown): message is SidecarHelloAckV1 {
  return (
    isRecord(message) &&
    message.type === "hello_ack" &&
    typeof message.protocolVersion === "string" &&
    message.protocolVersion.startsWith("1.") &&
    typeof message.maxFrameBytes === "number" &&
    Number.isSafeInteger(message.maxFrameBytes) &&
    message.maxFrameBytes > 0 &&
    message.maxFrameBytes <= SIDECAR_MAX_FRAME_BYTES
  );
}

function isCancelReason(value: unknown): value is SidecarCancelReason {
  return value === "user" || value === "timeout" || value === "app_exit";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

class FramedJsonDuplex {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private buffer = Buffer.alloc(0);

  constructor(stream: ReadableStream<Uint8Array>) {
    this.reader = stream.getReader();
  }

  async write(message: unknown): Promise<void> {
    const payload = Buffer.from(JSON.stringify(message), "utf8");

    if (payload.byteLength > SIDECAR_MAX_FRAME_BYTES) {
      throw new Error("sidecar 输出帧超过最大长度限制。");
    }

    const header = Buffer.alloc(4);
    header.writeUInt32BE(payload.byteLength, 0);

    await new Promise<void>((resolve, reject) => {
      stdout.write(Buffer.concat([header, payload]), (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  async readOne(): Promise<unknown> {
    while (true) {
      const frame = this.tryReadFrame();

      if (frame) {
        return JSON.parse(frame.toString("utf8")) as unknown;
      }

      const { done, value } = await this.reader.read();

      if (done) {
        throw new Error("sidecar 输入流已关闭。");
      }

      this.buffer = Buffer.concat([this.buffer, Buffer.from(value)]);
    }
  }

  async *readMessages(): AsyncIterable<unknown> {
    while (true) {
      try {
        yield await this.readOne();
      } catch (error) {
        if (error instanceof Error && error.message === "sidecar 输入流已关闭。") {
          return;
        }

        throw error;
      }
    }
  }

  private tryReadFrame(): Buffer | null {
    if (this.buffer.byteLength < 4) {
      return null;
    }

    const length = this.buffer.readUInt32BE(0);

    if (length === 0 || length > SIDECAR_MAX_FRAME_BYTES) {
      throw new Error("sidecar 输入帧长度非法。");
    }

    if (this.buffer.byteLength < 4 + length) {
      return null;
    }

    const frame = this.buffer.subarray(4, 4 + length);
    this.buffer = this.buffer.subarray(4 + length);

    return frame;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error(`sidecar 错误：${message}`);
  process.exitCode = 1;
});
