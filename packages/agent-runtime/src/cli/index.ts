import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { config } from "dotenv";
import { createDefaultToolRegistry } from "@mecha/agent-tools";
import { ChatRuntime } from "../runtime/chat-runtime.js";
import type { ChatMessage, ProviderId } from "../providers/index.js";

/** CLI 解析后的运行参数。 */
interface CliOptions {
  /** 要使用的模型服务商。 */
  provider: ProviderId;
  /** 可选默认模型名。 */
  model?: string;
  /** 命令行里直接给出的单轮 prompt。 */
  prompt?: string;
  /** 直接注入的完整消息数组。 */
  messages?: ChatMessage[];
  /** 是否使用流式输出。 */
  stream: boolean;
  /** 是否启用 runtime 层工具调用循环。 */
  useTools: boolean;
  /** 是否按 JSON Lines 输出完整 AgentRunEvent，供桌面端转发事件流。 */
  eventsJsonLines: boolean;
  /** 工具调用允许访问的工作区根目录；默认使用当前进程目录。 */
  workspaceRoot?: string;
  /** 外部指定的 run id，用于桌面端在监听前建立事件归并键。 */
  runId?: string;
  /** 外部指定的首条 assistant 消息 id，便于前端提前创建占位消息。 */
  messageId?: string;
}

/**
 * CLI 入口，负责读取环境变量、解析参数并驱动一次聊天请求。
 */
async function main(): Promise<void> {
  loadEnv();

  const options = await parseOptions(process.argv.slice(2));
  const runtime = new ChatRuntime({
    provider: options.provider,
    model: options.model
  });

  const messages: ChatMessage[] = options.messages ?? [
    {
      role: "system",
      content: "回答时请使用中文，内容简洁明了，不要使用表情符号。"
    },
    {
      role: "user",
      content: options.prompt ?? (await askPrompt())
    }
  ];

  const toolRegistry = options.useTools
    ? createDefaultToolRegistry({
        workspaceRoot: options.workspaceRoot ?? process.cwd()
      })
    : undefined;
  let content = "";
  let hasError = false;

  for await (const event of runtime.run(
    { messages },
    {
      toolRegistry,
      runId: options.runId,
      messageId: options.messageId
    }
  )) {
    if (options.eventsJsonLines) {
      process.stdout.write(`${JSON.stringify(event)}\n`);
      if (event.type === "error") {
        hasError = true;
      }
      continue;
    }

    if (event.type === "text_delta") {
      if (options.stream) {
        process.stdout.write(event.text);
      } else {
        content += event.text;
      }
    }

    if (event.type === "error") {
      hasError = true;
      console.error(`错误：${event.message}`);
    }
  }

  if (options.eventsJsonLines) {
    // JSON Lines 模式已经逐事件输出，这里不追加额外文本，避免破坏事件解析。
  } else if (!options.stream) {
    console.log(content);
  } else {
    process.stdout.write("\n");
  }

  if (hasError) {
    process.exitCode = 1;
  }
}

/**
 * 解析命令行参数，支持 prompt、JSON 消息和输出模式切换。
 *
 * @param args 原始命令行参数。
 * @returns 规范化后的 CLI 配置。
 */
async function parseOptions(args: string[]): Promise<CliOptions> {
  const options: CliOptions = {
    provider: "openai",
    stream: true,
    useTools: true,
    eventsJsonLines: false
  };
  const promptParts: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    // 保留给外层包装器的分隔符与兼容参数，不在这里消费。
    if (arg === "--") {
      continue;
    }

    if (arg === "--no-tools") {
      options.useTools = false;
      continue;
    }

    if (arg === "--provider") {
      const provider = args[++index];
      if (provider !== "openai" && provider !== "anthropic") {
        throw new Error("--provider 只能是 openai 或 anthropic。");
      }
      options.provider = provider;
      continue;
    }

    if (arg === "--model") {
      options.model = args[++index];
      continue;
    }

    if (arg === "--no-stream") {
      options.stream = false;
      continue;
    }

    if (arg === "--events-json-lines") {
      options.eventsJsonLines = true;
      continue;
    }

    if (arg === "--workspace-root") {
      options.workspaceRoot = readRequiredValue(args, ++index, "--workspace-root");
      continue;
    }

    if (arg === "--run-id") {
      options.runId = readRequiredValue(args, ++index, "--run-id");
      continue;
    }

    if (arg === "--message-id") {
      options.messageId = readRequiredValue(args, ++index, "--message-id");
      continue;
    }

    if (arg === "--messages-json") {
      options.messages = parseMessagesJson(args[++index]);
      continue;
    }

    if (arg === "--messages-json-base64") {
      options.messages = parseMessagesJsonBase64(args[++index]);
      continue;
    }

    promptParts.push(arg);
  }

  if (promptParts.length > 0) {
    options.prompt = promptParts.join(" ");
  }

  return options;
}

/**
 * 读取必须带值的命令行参数。
 *
 * @param args 原始命令行参数。
 * @param index 参数值所在位置。
 * @param name 参数名，用于错误提示。
 * @returns 非空参数值。
 */
function readRequiredValue(
  args: string[],
  index: number,
  name: string
): string {
  const value = args[index];

  if (!value) {
    throw new Error(`${name} 需要传入参数值。`);
  }

  return value;
}

/**
 * 解析 JSON 字符串形式的消息数组。
 *
 * @param value 传入的 JSON 字符串。
 * @returns 可直接交给 runtime 的消息列表。
 */
function parseMessagesJson(value: string | undefined): ChatMessage[] {
  if (!value) {
    throw new Error("--messages-json 需要传入 JSON 数组。");
  }

  const parsed: unknown = JSON.parse(value);

  if (!Array.isArray(parsed)) {
    throw new Error("--messages-json 必须是 JSON 数组。");
  }

  return parsed.map((item, index) => {
    if (item === null || typeof item !== "object") {
      throw new Error(`第 ${index} 条消息必须是对象。`);
    }

    const candidate = item as Partial<ChatMessage>;

    if (
      candidate.role !== "system" &&
      candidate.role !== "user" &&
      candidate.role !== "assistant"
    ) {
      throw new Error(`第 ${index} 条消息的角色不受支持。`);
    }

    if (typeof candidate.content !== "string") {
      throw new Error(`第 ${index} 条消息必须包含字符串内容。`);
    }

    return {
      role: candidate.role,
      content: candidate.content
    };
  });
}

/**
 * 解析 base64 编码的消息数组，避免 shell 转义把内容弄坏。
 *
 * @param value base64 字符串。
 * @returns 可直接交给 runtime 的消息列表。
 */
function parseMessagesJsonBase64(value: string | undefined): ChatMessage[] {
  if (!value) {
    throw new Error("--messages-json-base64 需要传入参数值。");
  }

  return parseMessagesJson(Buffer.from(value, "base64").toString("utf8"));
}

/**
 * 按优先级加载本地 `.env` 文件，便于在包目录或仓库根目录下运行 CLI。
 */
function loadEnv(): void {
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "..", "..", ".env")
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      config({ path, quiet: true, override: true });
      return;
    }
  }
}

/**
 * 交互式读取用户输入的 prompt。
 *
 * @returns 用户在终端输入的一句话。
 */
async function askPrompt(): Promise<string> {
  const rl = createInterface({ input, output });

  try {
    return await rl.question("你：");
  } finally {
    rl.close();
  }
}

// 捕获顶层异常，避免 CLI 直接崩溃而没有中文报错。
main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error(`错误：${message}`);
  process.exitCode = 1;
});
