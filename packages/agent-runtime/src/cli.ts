import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import {
  createDefaultToolRegistry,
  type AgentTool
} from "@mecha/agent-tools";
import { config } from "dotenv";
import { ChatRuntime } from "./chat-runtime.js";
import type {
  ChatMessage,
  ChatTool,
  ChatToolCall,
  ProviderId
} from "./providers/index.js";

/** CLI 支持的命令行选项。 */
interface CliOptions {
  /** 模型服务商标识。 */
  provider: ProviderId;
  /** 可选模型名称。 */
  model?: string;
  /** 从命令行直接传入的提示词。 */
  prompt?: string;
  messages?: ChatMessage[];
  /** 是否启用流式输出。 */
  stream: boolean;
  /** 是否允许模型调用本地工具。 */
  tools: boolean;
}

/** 单次 CLI 对话中允许的最大工具调用轮数。 */
const MAX_TOOL_ITERATIONS = 6;
/** 模型请求遇到连接类错误时的最大重试次数。 */
const MAX_MODEL_RETRIES = 2;
/** 模型请求重试的基础等待时间，单位毫秒。 */
const MODEL_RETRY_DELAY_MS = 1_000;
/** CLI 中展示单行摘要时保留的最大字符数。 */
const MAX_SUMMARY_CHARS = 120;

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

  const messages: ChatMessage[] = options.messages ?? [
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

  if (options.tools && options.provider === "deepseek") {
    const response = await runToolCallingLoop(runtime, messages);
    console.log(response);
    return;
  }

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
    stream: true,
    tools: true
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
        throw new Error("--provider 只能是 openai、anthropic 或 deepseek。");
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

    if (arg === "--no-tools") {
      options.tools = false;
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
 * 运行一个最小 tool calling 循环。
 *
 * @param runtime 聊天运行时。
 * @param initialMessages 初始对话消息。
 * @returns 模型最终生成的文本内容。
 */
async function runToolCallingLoop(
  runtime: ChatRuntime,
  initialMessages: ChatMessage[]
): Promise<string> {
  const registry = createDefaultToolRegistry({ workspaceRoot: findWorkspaceRoot() });
  const toolDefinitions = toChatTools(registry.list());
  const messages = [...initialMessages];
  for (let index = 0; index < MAX_TOOL_ITERATIONS; index += 1) {
    logToolProgress(`第 ${index + 1} 轮：模型正在分析当前对话。`);
    const response = await chatWithRetry(runtime, {
      messages,
      tools: toolDefinitions
    });

    if (!response.toolCalls || response.toolCalls.length === 0) {
      logToolProgress("本轮对话已完成，下面输出模型回复。");
      return response.content;
    }

    logToolProgress(`模型决定先执行 ${response.toolCalls.length} 个操作来补充信息。`);
    messages.push({
      role: "assistant",
      content: response.content,
      toolCalls: response.toolCalls
    });

    for (const toolCall of response.toolCalls) {
      logToolProgress(describeToolCall(toolCall));
      const output = await runToolCall(registry, toolCall);
      logToolProgress(describeToolResult(toolCall.name, output));
      messages.push({
        role: "tool",
        toolCallId: toolCall.id,
        content: stringifyToolOutput(output)
      });
    }
  }

  logToolProgress("工具调用达到轮数上限，要求模型基于已有结果直接总结。");
  const response = await chatWithRetry(runtime, {
    messages: [
      ...messages,
      {
        role: "user",
        content:
          "工具调用轮数已达到上限。请基于已有工具结果给出最终答复，不要继续调用工具。"
      }
    ]
  });

  return response.content;
}

/**
 * 调用模型并在连接类错误时自动重试。
 *
 * @param runtime 聊天运行时。
 * @param input 聊天请求参数。
 * @returns 模型回复。
 */
async function chatWithRetry(
  runtime: ChatRuntime,
  input: Parameters<ChatRuntime["chat"]>[0]
): ReturnType<ChatRuntime["chat"]> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_MODEL_RETRIES; attempt += 1) {
    try {
      return await runtime.chat(input);
    } catch (error) {
      lastError = error;

      if (!isRetryableModelError(error) || attempt === MAX_MODEL_RETRIES) {
        break;
      }

      const delayMs = MODEL_RETRY_DELAY_MS * (attempt + 1);
      logToolProgress(
        `模型连接失败，${delayMs}ms 后重试第 ${attempt + 1} 次：${getErrorMessage(error)}`
      );
      await sleep(delayMs);
    }
  }

  throw new Error(`模型请求失败：${getErrorMessage(lastError)}`);
}

/**
 * 将本地工具转换为模型可见的工具定义。
 *
 * @param tools 本地工具列表。
 * @returns 聊天模型工具定义列表。
 */
function toChatTools(tools: AgentTool[]): ChatTool[] {
  return tools
    .filter((tool) => tool.inputSchema)
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema ?? {
        type: "object",
        properties: {},
        additionalProperties: false
      }
    }));
}

/**
 * 执行模型请求的单次工具调用。
 *
 * @param registry 本地工具注册表。
 * @param toolCall 模型返回的工具调用。
 * @returns 工具执行结果或错误信息。
 */
async function runToolCall(
  registry: ReturnType<typeof createDefaultToolRegistry>,
  toolCall: ChatToolCall
): Promise<unknown> {
  const tool = registry.get(toolCall.name);

  if (!tool) {
    return {
      error: `未知工具：${toolCall.name}`
    };
  }

  try {
    return await tool.run(toolCall.input);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * 将工具输出转换为可回传给模型的字符串。
 *
 * @param output 工具执行输出。
 * @returns JSON 字符串形式的工具输出。
 */
function stringifyToolOutput(output: unknown): string {
  return JSON.stringify(output);
}

/**
 * 判断错误是否适合重试。
 *
 * @param error 捕获到的模型调用错误。
 * @returns 是否应该重试。
 */
function isRetryableModelError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();

  return (
    message.includes("connection") ||
    message.includes("timeout") ||
    message.includes("network") ||
    message.includes("econnreset") ||
    message.includes("fetch failed")
  );
}

/**
 * 从未知错误中提取可读消息。
 *
 * @param error 捕获到的错误。
 * @returns 错误消息。
 */
function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 等待指定时间。
 *
 * @param ms 等待毫秒数。
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * 打印工具调用进度。
 *
 * @param message 要展示给 CLI 用户的进度信息。
 */
function logToolProgress(message: string): void {
  console.error(`[进度] ${message}`);
}

/**
 * 将模型发起的工具调用转换为普通用户可读的进度说明。
 *
 * @param toolCall 模型请求执行的工具调用。
 * @returns 单行进度说明。
 */
function describeToolCall(toolCall: ChatToolCall): string {
  const input = asRecord(toolCall.input);

  switch (toolCall.name) {
    case "read_file":
      return `读取文件：${formatField(input.path, "未指定路径")}`;
    case "write_file":
      return `写入文件：${formatField(input.path, "未指定路径")}`;
    case "list_dir":
      return `查看目录：${formatField(input.path, ".")}`;
    case "search_text":
      return `搜索文本：${formatField(input.query, "未指定关键词")}${formatPathSuffix(input.path)}`;
    case "apply_patch":
      return input.checkOnly === true ? "校验代码补丁。" : "应用代码补丁。";
    case "run_command":
      return `运行命令：${formatCommand(input)}`;
    case "git_diff":
      return `查看 ${input.staged === true ? "暂存区" : "工作区"} diff${formatPathSuffix(input.path)}。`;
    case "git_status":
      return "查看 Git 状态。";
    default:
      return `执行操作：${toolCall.name}。`;
  }
}

/**
 * 将工具执行结果转换为普通用户可读的完成说明。
 *
 * @param toolName 已执行的工具名称。
 * @param output 工具执行结果。
 * @returns 单行完成说明。
 */
function describeToolResult(toolName: string, output: unknown): string {
  const result = asRecord(output);

  if (typeof result.error === "string" && result.error.length > 0) {
    return `操作失败：${trimSummary(result.error)}`;
  }

  switch (toolName) {
    case "read_file":
      return `读取完成：${formatField(result.path, "目标文件")}，${formatBytes(result.sizeBytes)}${result.truncated === true ? "，内容较长已截断" : ""}。`;
    case "write_file":
      return `写入完成：${formatField(result.path, "目标文件")}，${formatBytes(result.sizeBytes)}。`;
    case "list_dir":
      return `目录查看完成：${formatField(result.path, ".")}，共 ${arrayLength(result.entries)} 项。`;
    case "search_text":
      return `搜索完成：找到 ${arrayLength(result.matches)} 处匹配${result.truncated === true ? "，结果较多已截断" : ""}。`;
    case "apply_patch":
      return result.applied === true ? "补丁已应用。" : "补丁校验完成。";
    case "run_command":
      return describeCommandResult(result);
    case "git_diff":
      return result.truncated === true ? "diff 读取完成，内容较长已截断。" : "diff 读取完成。";
    case "git_status":
      return "Git 状态读取完成。";
    default:
      return "操作完成。";
  }
}

function describeCommandResult(result: Record<string, unknown>): string {
  if (result.timedOut === true) {
    return "命令执行超时。";
  }

  const exitCode = typeof result.exitCode === "number" ? result.exitCode : undefined;
  if (exitCode !== undefined && exitCode !== 0) {
    return `命令执行结束，退出码 ${exitCode}。`;
  }

  return "命令执行完成。";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function formatField(value: unknown, fallback: string): string {
  return trimSummary(typeof value === "string" && value.length > 0 ? value : fallback);
}

function formatPathSuffix(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    return "";
  }

  return `，范围：${trimSummary(value)}`;
}

function formatCommand(input: Record<string, unknown>): string {
  const command = typeof input.command === "string" ? input.command : "未指定命令";
  const args = Array.isArray(input.args)
    ? input.args.filter((arg): arg is string => typeof arg === "string")
    : [];
  const text = args.length > 0 ? `${command} ${args.join(" ")}` : command;

  return trimSummary(text);
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function formatBytes(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return "大小未知";
  }

  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function trimSummary(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= MAX_SUMMARY_CHARS) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_SUMMARY_CHARS)}...`;
}

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

function parseMessagesJsonBase64(value: string | undefined): ChatMessage[] {
  if (!value) {
    throw new Error("--messages-json-base64 需要传入参数值。");
  }

  return parseMessagesJson(Buffer.from(value, "base64").toString("utf8"));
}

/**
 * 从当前目录向上寻找 pnpm workspace 根目录。
 *
 * @returns 找到的工作区根目录；找不到时回退到当前目录。
 */
function findWorkspaceRoot(): string {
  let current = process.cwd();

  while (true) {
    if (existsSync(resolve(current, "pnpm-workspace.yaml"))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return process.cwd();
    }

    current = parent;
  }
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
      config({ path, quiet: true });
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
    return await rl.question("你：");
  } finally {
    rl.close();
  }
}

/** 捕获 CLI 顶层错误并转换为非零退出码。 */
main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error(`错误：${message}`);
  process.exitCode = 1;
});
