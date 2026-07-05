import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { config } from "dotenv";
import { ChatRuntime } from "./chat-runtime.js";
import type { ChatMessage, ProviderId } from "./providers/index.js";

/** CLI 支持的命令行选项。 */
interface CliOptions {
  /** 模型服务商标识。 */
  provider: ProviderId;
  /** 可选模型名称。 */
  model?: string;
  /** 从命令行直接传入的提示词。 */
  prompt?: string;
  /** 是否启用流式输出。 */
  stream: boolean;
}

/**
 * CLI 主流程：加载环境变量、解析参数、创建运行时并输出模型回复。
 */
async function main(): Promise<void> {
  loadEnv();

  const options = await parseOptions(process.argv.slice(2));
  const runtime = new ChatRuntime({
    provider: options.provider,
    model: options.model
  });

  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "回答时请使用中文，内容简洁明了，不要使用表情符号。"
    },
    {
      role: "user",
      content: options.prompt ?? (await askPrompt())
    }
  ];

  if (!options.stream) {
    const response = await runtime.chat({ messages });
    console.log(response.content);
    return;
  }

  /* 流式输出让 CLI 与桌面端体验一致：服务商产生文本后立即展示。 */
  for await (const event of runtime.streamChat({ messages })) {
    if (event.type === "text_delta") {
      process.stdout.write(event.text);
    }
  }

  process.stdout.write("\n");
}

/**
 * 解析 CLI 参数并收集未命名参数作为提示词。
 *
 * @param args 去掉 `node` 与脚本路径后的命令行参数。
 * @returns 标准化后的 CLI 选项。
 */
async function parseOptions(args: string[]): Promise<CliOptions> {
  const options: CliOptions = {
    provider: "openai",
    stream: true
  };
  const promptParts: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--") {
      continue;
    }

    if (arg === "--provider") {
      const provider = args[++index];
      if (
        provider !== "openai" &&
        provider !== "anthropic" &&
        provider !== "deepseek"
      ) {
        throw new Error("--provider must be openai, anthropic, or deepseek.");
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

    promptParts.push(arg);
  }

  if (promptParts.length > 0) {
    options.prompt = promptParts.join(" ");
  }

  return options;
}

/**
 * 从当前目录或仓库根目录加载 `.env` 文件。
 */
function loadEnv(): void {
  /* 优先使用本地 `.env`，让仓库检出后无需配置全局 shell 环境也能运行 CLI。 */
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "..", "..", ".env")
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      config({ path });
    }
  }
}

/**
 * 在未通过命令行传入提示词时，从终端交互式读取用户输入。
 *
 * @returns 用户输入的提示词。
 */
async function askPrompt(): Promise<string> {
  const rl = createInterface({ input, output });

  try {
    return await rl.question("You: ");
  } finally {
    rl.close();
  }
}

/** 捕获 CLI 顶层错误并转换为非零退出码。 */
main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error(`Error: ${message}`);
  process.exitCode = 1;
});
