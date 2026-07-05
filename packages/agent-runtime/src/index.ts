/** Agent 运行时包的统一导出口。 */
export { ChatRuntime, createProvider } from "./chat-runtime.js";
export {
  AnthropicProvider,
  OpenAIProvider,
  ProviderConfigError,
  type ChatInput,
  type ChatMessage,
  type ChatOutput,
  type ChatRole,
  type ChatStreamEvent,
  type ChatTool,
  type ChatToolCall,
  type ModelProvider,
  type ProviderId
} from "./providers/index.js";

/** Agent 消息在运行时层的基础结构。 */
export interface AgentMessage {
  /** 消息唯一标识。 */
  id: string;
  /** 消息角色。 */
  role: "system" | "user" | "assistant" | "tool";
  /** 消息正文。 */
  content: string;
  /** ISO 格式的创建时间。 */
  createdAt: string;
}

/** Agent 运行时向调用方发出的事件。 */
export type RunEvent =
  | { type: "message"; message: AgentMessage }
  | { type: "error"; message: string };

/** Agent 运行时需要实现的最小接口。 */
export interface AgentRuntime {
  /**
   * 执行一轮 Agent 流程并返回事件流。
   *
   * @param messages 输入消息列表。
   * @returns 运行过程中产生的事件序列。
   */
  run(messages: AgentMessage[]): AsyncIterable<RunEvent>;
}

/** 在真实 Agent 循环接入前用于保持包可用的占位运行时。 */
export class PlaceholderAgentRuntime implements AgentRuntime {
  /**
   * 回显最后一条用户消息，模拟一次最小可用的 Agent 输出。
   *
   * @param messages 输入消息列表。
   * @yields 一条 assistant 消息事件。
   */
  async *run(messages: AgentMessage[]): AsyncIterable<RunEvent> {
    const lastMessage = messages.at(-1);

    yield {
      type: "message",
      message: {
        id: crypto.randomUUID(),
        role: "assistant",
        content: lastMessage
          ? `Received: ${lastMessage.content}`
          : "Agent runtime is ready.",
        createdAt: new Date().toISOString()
      }
    };
  }
}
