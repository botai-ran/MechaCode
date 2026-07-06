import Anthropic from "@anthropic-ai/sdk";
import { ensureTextConversation, splitSystemMessage } from "./message-utils.js";
import type {
  ChatInput,
  ChatOutput,
  ChatStreamEvent,
  ModelProvider
} from "./types.js";
import { ProviderConfigError } from "./types.js";

/** Anthropic 适配器的初始化选项。 */
export interface AnthropicProviderOptions {
  /** Anthropic API Key；未传入时读取 `ANTHROPIC_API_KEY`。 */
  apiKey?: string;
  /** API 地址；未传入时读取 `ANTHROPIC_BASE_URL`。 */
  baseURL?: string;
  /** 默认模型；未传入时读取 `ANTHROPIC_MODEL` 或使用内置默认值。 */
  defaultModel?: string;
}

/** 基于 Anthropic Messages API 的模型服务商适配器。 */
export class AnthropicProvider implements ModelProvider {
  /** 服务商唯一标识。 */
  readonly id = "anthropic" as const;
  /** 当前适配器默认使用的模型。 */
  readonly defaultModel: string;

  /** Anthropic 官方 SDK 客户端。 */
  private readonly client: Anthropic;

  /**
   * 创建 Anthropic 服务商适配器。
   *
   * @param options 初始化选项，通常由环境变量补齐。
   * @throws {ProviderConfigError} 当 API Key 缺失时抛出。
   */
  constructor(options: AnthropicProviderOptions = {}) {
    const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
    const baseURL = normalizeOptionalString(
      options.baseURL ?? process.env.ANTHROPIC_BASE_URL
    );

    if (!apiKey) {
      throw new ProviderConfigError("缺少 ANTHROPIC_API_KEY。");
    }

    this.defaultModel =
      options.defaultModel ??
      process.env.ANTHROPIC_MODEL ??
      (isDeepSeekAnthropicBaseURL(baseURL)
        ? "deepseek-v4-flash"
        : "claude-opus-4-6");
    this.client = new Anthropic({ apiKey, baseURL });
  }

  /**
   * 调用 Anthropic Messages API 生成一次完整回复。
   *
   * @param input 标准聊天输入。
   * @returns 标准化后的聊天输出。
   */
  async chat(input: ChatInput): Promise<ChatOutput> {
    const model = input.model ?? this.defaultModel;
    const { system } = splitSystemMessage(input.messages);

    const message = await this.client.messages.create({
      model,
      system,
      max_tokens: input.maxOutputTokens ?? 1024,
      temperature: input.temperature,
      messages: toAnthropicMessages(input)
    });

    return {
      provider: this.id,
      model,
      content: collectAnthropicText(message.content)
    };
  }

  /**
   * 调用 Anthropic Messages API 生成流式回复。
   *
   * @param input 标准聊天输入。
   * @yields 标准化后的文本增量事件。
   * @returns 最终会产出 `done` 事件，其中包含完整输出。
   */
  async *streamChat(input: ChatInput): AsyncIterable<ChatStreamEvent> {
    const model = input.model ?? this.defaultModel;
    const { system } = splitSystemMessage(input.messages);
    let content = "";

    const stream = this.client.messages.stream({
      model,
      system,
      max_tokens: input.maxOutputTokens ?? 1024,
      temperature: input.temperature,
      messages: toAnthropicMessages(input)
    });

    /* Anthropic 的事件名称不同，这里统一折叠为所有适配器共享的 `text_delta`。 */
    for await (const event of stream as AsyncIterable<{
      type: string;
      delta?: { type?: string; text?: string };
    }>) {
      if (
        event.type === "content_block_delta" &&
        event.delta?.type === "text_delta" &&
        event.delta.text
      ) {
        content += event.delta.text;
        yield { type: "text_delta", text: event.delta.text };
      }
    }

    yield {
      type: "done",
      output: {
        provider: this.id,
        model,
        content
      }
    };
  }
}

/**
 * 将标准聊天输入转换为 Anthropic Messages API 可接受的消息数组。
 *
 * @param input 标准聊天输入。
 * @returns Anthropic 消息数组。
 */
function toAnthropicMessages(input: ChatInput): Anthropic.MessageParam[] {
  return ensureTextConversation(input.messages).map((message) => ({
    role: message.role,
    content: message.content
  }));
}

/**
 * 从 Anthropic 返回的内容块中提取所有文本块并拼接为完整回复。
 *
 * @param content Anthropic Messages API 返回的内容块列表。
 * @returns 拼接后的纯文本内容。
 */
function collectAnthropicText(content: Anthropic.Message["content"]): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const normalized = value?.trim();

  return normalized ? normalized : undefined;
}

function isDeepSeekAnthropicBaseURL(baseURL: string | undefined): boolean {
  return baseURL?.replace(/\/+$/, "").toLowerCase() ===
    "https://api.deepseek.com/anthropic";
}
