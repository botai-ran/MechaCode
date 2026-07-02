import OpenAI from "openai";
import { ensureConversation, splitSystemMessage } from "./message-utils.js";
import type {
  ChatInput,
  ChatOutput,
  ChatStreamEvent,
  ModelProvider
} from "./types.js";
import { ProviderConfigError } from "./types.js";

/** OpenAI 适配器的初始化选项。 */
export interface OpenAIProviderOptions {
  /** OpenAI API Key；未传入时读取 `OPENAI_API_KEY`。 */
  apiKey?: string;
  /** 默认模型；未传入时读取 `OPENAI_MODEL` 或使用内置默认值。 */
  defaultModel?: string;
}

/** 基于 OpenAI Responses API 的模型服务商适配器。 */
export class OpenAIProvider implements ModelProvider {
  /** 服务商唯一标识。 */
  readonly id = "openai" as const;
  /** 当前适配器默认使用的模型。 */
  readonly defaultModel: string;

  /** OpenAI 官方 SDK 客户端。 */
  private readonly client: OpenAI;

  /**
   * 创建 OpenAI 服务商适配器。
   *
   * @param options 初始化选项，通常由环境变量补齐。
   * @throws {ProviderConfigError} 当 API Key 缺失时抛出。
   */
  constructor(options: OpenAIProviderOptions = {}) {
    const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new ProviderConfigError("Missing OPENAI_API_KEY.");
    }

    this.defaultModel =
      options.defaultModel ?? process.env.OPENAI_MODEL ?? "gpt-5.5";
    this.client = new OpenAI({ apiKey });
  }

  /**
   * 调用 OpenAI Responses API 生成一次完整回复。
   *
   * @param input 标准聊天输入。
   * @returns 标准化后的聊天输出。
   */
  async chat(input: ChatInput): Promise<ChatOutput> {
    const model = input.model ?? this.defaultModel;
    const { system } = splitSystemMessage(input.messages);

    /* Responses API 将系统指令和对话项拆开传入，因此这里负责转换为 OpenAI 专用结构。 */
    const response = await this.client.responses.create({
      model,
      instructions: system,
      input: ensureConversation(input.messages).map((message) => ({
        role: message.role,
        content: message.content
      })),
      temperature: input.temperature,
      max_output_tokens: input.maxOutputTokens
    });

    return {
      provider: this.id,
      model,
      content: response.output_text
    };
  }

  /**
   * 调用 OpenAI Responses API 生成流式回复。
   *
   * @param input 标准聊天输入。
   * @yields 标准化后的文本增量事件。
   * @returns 最终会产出 `done` 事件，其中包含完整输出。
   */
  async *streamChat(input: ChatInput): AsyncIterable<ChatStreamEvent> {
    const model = input.model ?? this.defaultModel;
    const { system } = splitSystemMessage(input.messages);
    let content = "";

    const stream = await this.client.responses.stream({
      model,
      instructions: system,
      input: ensureConversation(input.messages).map((message) => ({
        role: message.role,
        content: message.content
      })),
      temperature: input.temperature,
      max_output_tokens: input.maxOutputTokens
    });

    /* 将 OpenAI 流式事件统一成运行时事件，避免桌面端感知服务商差异。 */
    for await (const event of stream as AsyncIterable<{
      type: string;
      delta?: string;
    }>) {
      if (event.type === "response.output_text.delta" && event.delta) {
        content += event.delta;
        yield { type: "text_delta", text: event.delta };
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
