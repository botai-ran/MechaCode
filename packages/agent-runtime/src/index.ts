import type { AgentRunEvent } from "@mecha/protocol";
import type { AgentRunChatOptions } from "./runtime/agent-run.js";
import type { ChatInput } from "./providers/index.js";

export { ChatRuntime, createProvider } from "./runtime/chat-runtime.js";
export { runAgentChat } from "./runtime/agent-run.js";
export type { AgentRunChatOptions } from "./runtime/agent-run.js";
export type {
  AgentMessage,
  AgentRole,
  AgentRunEvent,
  RunEvent,
  ToolCall
} from "@mecha/protocol";
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

/** 对外公开的运行时抽象，通常由桌面端或 CLI 直接消费。 */
export interface AgentRuntime {
  /** 发起一次聊天运行并返回统一事件流。 */
  run(
    input: ChatInput,
    options?: AgentRunChatOptions
  ): AsyncIterable<AgentRunEvent>;
}
