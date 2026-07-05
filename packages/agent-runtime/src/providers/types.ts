/** 支持的模型服务商标识。 */
export type ProviderId = "openai" | "anthropic" | "deepseek";

/** 运行时统一使用的聊天角色。 */
export type ChatRole = "system" | "user" | "assistant" | "tool";

/** 暴露给模型的工具定义。 */
export interface ChatTool {
  /** 工具名称。 */
  name: string;
  /** 工具能力说明。 */
  description: string;
  /** 工具输入参数的 JSON Schema。 */
  inputSchema: Record<string, unknown>;
}

/** 模型请求执行的工具调用。 */
export interface ChatToolCall {
  /** 服务商返回的工具调用 ID。 */
  id: string;
  /** 被调用的工具名称。 */
  name: string;
  /** 工具输入参数。 */
  input: unknown;
}

/** CLI、桌面端和各服务商适配器共享的标准消息结构。 */
export interface ChatMessage {
  /** 消息发送方角色。 */
  role: ChatRole;
  /** 消息正文内容。 */
  content: string;
  /** 当角色为 `tool` 时，对应的工具调用 ID。 */
  toolCallId?: string;
  /** 当角色为 `assistant` 时，模型返回的工具调用列表。 */
  toolCalls?: ChatToolCall[];
}

/** 与具体服务商无关的聊天请求参数。 */
export interface ChatInput {
  /** 按对话顺序排列的消息列表。 */
  messages: ChatMessage[];
  /** 可选模型名称；未传入时使用服务商默认模型。 */
  model?: string;
  /** 采样温度，用于控制回复随机性。 */
  temperature?: number;
  /** 最大输出 token 数。 */
  maxOutputTokens?: number;
  /** 本轮请求允许模型调用的工具列表。 */
  tools?: ChatTool[];
}

/** 每个后端返回的统一聊天结果。 */
export interface ChatOutput {
  /** 生成结果的服务商。 */
  provider: ProviderId;
  /** 实际使用的模型名称。 */
  model: string;
  /** 模型生成的完整文本内容。 */
  content: string;
  /** 模型要求执行的工具调用列表。 */
  toolCalls?: ChatToolCall[];
}

/** 流式事件，允许 UI 在最终结果完成前逐步渲染增量文本。 */
export type ChatStreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "done"; output: ChatOutput };

/** 每个模型服务商适配器都需要实现的统一契约。 */
export interface ModelProvider {
  /** 服务商唯一标识。 */
  id: ProviderId;
  /** 未显式指定模型时使用的默认模型。 */
  defaultModel: string;

  /**
   * 发起一次非流式聊天请求。
   *
   * @param input 与服务商无关的标准聊天输入。
   * @returns 标准化后的完整聊天输出。
   */
  chat(input: ChatInput): Promise<ChatOutput>;

  /**
   * 发起一次流式聊天请求。
   *
   * @param input 与服务商无关的标准聊天输入。
   * @returns 标准化后的流式事件序列。
   */
  streamChat(input: ChatInput): AsyncIterable<ChatStreamEvent>;
}

/** 当服务商配置不完整、无法初始化适配器时抛出的错误。 */
export class ProviderConfigError extends Error {
  /**
   * 创建服务商配置错误。
   *
   * @param message 面向调用方的错误说明。
   */
  constructor(message: string) {
    super(message);
    this.name = "ProviderConfigError";
  }
}
