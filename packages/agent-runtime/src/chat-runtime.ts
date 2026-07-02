import {
  AnthropicProvider,
  DeepSeekProvider,
  OpenAIProvider,
  type ChatInput,
  type ChatOutput,
  type ChatStreamEvent,
  type ModelProvider,
  type ProviderId
} from "./providers/index.js";

/** ChatRuntime 的初始化选项。 */
export interface ChatRuntimeOptions {
  /** 本次运行要使用的模型服务商。 */
  provider: ProviderId;
  /** 可选默认模型；会在单次请求未指定模型时使用。 */
  model?: string;
}

/** 统一封装模型服务商选择、默认模型和聊天调用的运行时门面。 */
export class ChatRuntime {
  /** 当前选中的模型服务商适配器。 */
  private readonly provider: ModelProvider;
  /** 运行时级别的默认模型。 */
  private readonly model?: string;

  /**
   * 创建聊天运行时。
   *
   * @param options 运行时配置。
   */
  constructor(options: ChatRuntimeOptions) {
    this.provider = createProvider(options.provider);
    this.model = options.model;
  }

  /**
   * 发起一次非流式聊天请求。
   *
   * @param input 标准聊天输入。
   * @returns 标准化后的完整聊天输出。
   */
  chat(input: ChatInput): Promise<ChatOutput> {
    return this.provider.chat({
      ...input,
      model: input.model ?? this.model
    });
  }

  /**
   * 发起一次流式聊天请求。
   *
   * @param input 标准聊天输入。
   * @returns 标准化后的流式事件序列。
   */
  streamChat(input: ChatInput): AsyncIterable<ChatStreamEvent> {
    return this.provider.streamChat({
      ...input,
      model: input.model ?? this.model
    });
  }
}

/**
 * 根据服务商标识创建对应的模型适配器。
 *
 * 保持显式 `switch` 可以让 TypeScript 在新增服务商时帮助检查遗漏分支。
 *
 * @param provider 服务商标识。
 * @returns 对应服务商的适配器实例。
 */
export function createProvider(provider: ProviderId): ModelProvider {
  switch (provider) {
    case "openai":
      return new OpenAIProvider();
    case "anthropic":
      return new AnthropicProvider();
    case "deepseek":
      return new DeepSeekProvider();
  }
}
