import {
  MAX_PROTOCOL_MESSAGE_BYTES,
  PROTOCOL_VERSION_V1,
  type AnyProtocolEnvelopeV1
} from "./v1.js";

/** Sidecar IPC 使用的最大单帧字节数，Tauri 与 Runtime 握手时必须声明同一量级上限。 */
export const SIDECAR_MAX_FRAME_BYTES = MAX_PROTOCOL_MESSAGE_BYTES;

/** Sidecar 握手等待时间，超过后调用方必须关闭进程并 fail closed。 */
export const SIDECAR_HANDSHAKE_TIMEOUT_MS = 5_000;

/** 取消后等待 Runtime 协作退出的宽限期，超时后 Tauri 强制终止进程树。 */
export const SIDECAR_CANCEL_GRACE_MS = 1_500;

/** Runtime sidecar 当前声明的能力。 */
export type SidecarCapability =
  | "framed_ipc"
  | "protocol_v1"
  | "single_run"
  | "cooperative_cancel";

/** Tauri 请求取消 Run 时使用的稳定原因。 */
export type SidecarCancelReason = "user" | "timeout" | "app_exit";

/** Sidecar run_start 中传递给 Runtime 的聊天消息。 */
export interface SidecarChatMessageV1 {
  /** 消息角色；工具消息由 Runtime 内部循环生成，sidecar 输入只接收对话消息。 */
  role: "system" | "user" | "assistant";
  /** 消息文本内容。 */
  content: string;
}

/** Sidecar 启动后首先发送的握手消息。 */
export interface SidecarHelloV1 {
  /** 消息类型，固定为 `hello`。 */
  type: "hello";
  /** Runtime 支持的协议版本；同主版本才允许继续。 */
  protocolVersion: string;
  /** Runtime sidecar 自身版本，通常来自包版本或构建注入。 */
  runtimeVersion: string;
  /** Runtime 进程本次启动生成的实例 ID，用于诊断崩溃与重启。 */
  instanceId: string;
  /** 当前 sidecar 支持的能力集合。 */
  capabilities: SidecarCapability[];
  /** Runtime 接受的最大单帧字节数。 */
  maxFrameBytes: number;
}

/** Tauri 在校验 hello 后发送的确认消息。 */
export interface SidecarHelloAckV1 {
  /** 消息类型，固定为 `hello_ack`。 */
  type: "hello_ack";
  /** Tauri 侧接受的协议版本。 */
  protocolVersion: string;
  /** Tauri 接受的最大单帧字节数。 */
  maxFrameBytes: number;
}

/** Tauri 请求 sidecar 执行一次 Agent Run 的消息。 */
export interface SidecarRunStartV1 {
  /** 消息类型，固定为 `run_start`。 */
  type: "run_start";
  /** 本次 Run 的稳定 ID。 */
  runId: string;
  /** 首条 assistant 消息 ID，便于 UI 提前建立占位。 */
  messageId?: string;
  /** 模型服务商。 */
  provider: "openai" | "anthropic";
  /** 可选模型名称；未传入时由 Runtime 使用 provider 默认值。 */
  model?: string;
  /** 工具允许访问的工作区根目录。 */
  workspaceRoot: string;
  /** 是否启用工具调用；默认启用。 */
  useTools?: boolean;
  /** 传给 Runtime 的聊天消息。 */
  messages: SidecarChatMessageV1[];
}

/** Tauri 请求 sidecar 取消当前 Run 的消息。 */
export interface SidecarCancelV1 {
  /** 消息类型，固定为 `cancel`。 */
  type: "cancel";
  /** 要取消的 Run ID。 */
  runId: string;
  /** 取消来源，用于 Runtime 与 Tauri 生成一致终态。 */
  reason: SidecarCancelReason;
}

/** Tauri 发送给 Runtime sidecar 的控制消息。 */
export type SidecarControlMessageV1 =
  | SidecarHelloAckV1
  | SidecarRunStartV1
  | SidecarCancelV1;

/** Runtime sidecar 发送给 Tauri 的所有消息。 */
export type SidecarRuntimeMessageV1 = SidecarHelloV1 | AnyProtocolEnvelopeV1;

/** 创建 sidecar hello 消息所需的输入。 */
export interface CreateSidecarHelloInputV1 {
  /** Runtime 版本。 */
  runtimeVersion: string;
  /** 本次进程实例 ID。 */
  instanceId: string;
  /** 可选最大帧字节数；默认使用协议层上限。 */
  maxFrameBytes?: number;
}

/**
 * 创建 Runtime sidecar 握手消息。
 *
 * @param input Runtime 版本、实例 ID 和可选帧大小。
 * @returns 可通过 framed IPC 发送给 Tauri 的 hello 消息。
 */
export function createSidecarHelloV1(
  input: CreateSidecarHelloInputV1
): SidecarHelloV1 {
  return {
    type: "hello",
    protocolVersion: PROTOCOL_VERSION_V1,
    runtimeVersion: input.runtimeVersion,
    instanceId: input.instanceId,
    capabilities: [
      "framed_ipc",
      "protocol_v1",
      "single_run",
      "cooperative_cancel"
    ],
    maxFrameBytes: input.maxFrameBytes ?? SIDECAR_MAX_FRAME_BYTES
  };
}

/**
 * 创建 Tauri 对 Runtime hello 的确认消息。
 *
 * @returns Tauri 可发送给 sidecar 的 hello_ack。
 */
export function createSidecarHelloAckV1(): SidecarHelloAckV1 {
  return {
    type: "hello_ack",
    protocolVersion: PROTOCOL_VERSION_V1,
    maxFrameBytes: SIDECAR_MAX_FRAME_BYTES
  };
}
