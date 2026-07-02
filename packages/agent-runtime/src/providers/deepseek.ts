import OpenAI from "openai";
import { ensureConversation } from "./message-utils.js";
import type {
  ChatInput,
  ChatOutput,
  ChatStreamEvent,
  ModelProvider
} from "./types.js";
import { ProviderConfigError } from "./types.js";

/** DeepSeek 适配器的初始化选项。 */
export interface DeepSeekProviderOptions {
  /** DeepSeek API Key；未传入时读取 `DEEPSEEK_API_KEY`。 */
  apiKey?: string;
  /** OpenAI 兼容接口地址；未传入时读取 `DEEPSEEK_BASE_URL` 或使用官方默认地址。 */
  baseURL?: string;
  /** 默认模型；未传入时读取 `DEEPSEEK_MODEL` 或使用内置默认值。 */
  defaultModel?: string;
}

/** 基于 OpenAI 兼容接口的 DeepSeek 模型服务商适配器。 */
export class DeepSeekProvider implements ModelProvider {
  /** 服务商唯一标识。 */
  readonly id = "deepseek" as const;
  /** 当前适配器默认使用的模型。 */
  readonly defaultModel: string;

  /** 复用 OpenAI SDK 访问 DeepSeek 的兼容接口。 */
  private readonly client: OpenAI;

  /**
   * 创建 DeepSeek 服务商适配器。
   *
   * @param options 初始化选项，通常由环境变量补齐。
   * @throws {ProviderConfigError} 当 API Key 缺失时抛出。
   */
  constructor(options: DeepSeekProviderOptions = {}) {
    const apiKey = options.apiKey ?? process.env.DEEPSEEK_API_KEY;

    if (!apiKey) {
      throw new ProviderConfigError("Missing DEEPSEEK_API_KEY.");
    }

    this.defaultModel =
      options.defaultModel ??
      process.env.DEEPSEEK_MODEL ??
      "deepseek-v4-flash";

    /* DeepSeek 使用 OpenAI 兼容协议，因此复用 OpenAI SDK 并替换端点与凭据来源。 */
    this.client = new OpenAI({
      apiKey,
      baseURL:
        options.baseURL ??
        process.env.DEEPSEEK_BASE_URL ??
        "https://api.deepseek.com"
    });
  }

  /**
   * 调用 DeepSeek 非流式聊天接口生成完整回复。
   *
   * @param input 标准聊天输入。
   * @returns 标准化后的聊天输出。
   */
  async chat(input: ChatInput): Promise<ChatOutput> {
    const model = input.model ?? this.defaultModel;
    const response = await this.client.chat.completions.create({
      model,
      messages: toDeepSeekMessages(input),
      temperature: input.temperature,
      max_tokens: input.maxOutputTokens
    });

    return {
      provider: this.id,
      model,
      content: response.choices[0]?.message.content ?? ""
    };
  }

  /**
   * 调用 DeepSeek 流式聊天接口生成回复。
   *
   * @param input 标准聊天输入。
   * @yields 标准化后的文本增量事件。
   * @returns 最终会产出 `done` 事件，其中包含完整输出。
   */
  async *streamChat(input: ChatInput): AsyncIterable<ChatStreamEvent> {
    const model = input.model ?? this.defaultModel;
    let content = "";

    const stream = await this.client.chat.completions.create({
      model,
      messages: toDeepSeekMessages(input),
      temperature: input.temperature,
      max_tokens: input.maxOutputTokens,
      stream: true
    });

    /* DeepSeek 输出 OpenAI 风格的分片；当前只转发普通回答文本。 */
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta.content;

      if (delta) {
        content += delta;
        yield { type: "text_delta", text: delta };
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
 * 将标准聊天输入转换为 DeepSeek 兼容的 OpenAI 消息数组。
 *
 * @param input 标准聊天输入。
 * @returns DeepSeek 聊天接口可接受的消息数组。
 */
function toDeepSeekMessages(
  input: ChatInput
): OpenAI.Chat.ChatCompletionMessageParam[] {
  return ensureConversation(input.messages).map((message) => ({
    role: message.role,
    content: message.content
  }));
}
