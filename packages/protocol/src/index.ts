/** Agent 消息在协议层支持的角色。 */
export type AgentRole = "system" | "user" | "assistant" | "tool";

/** Agent 运行时和下游 UI 共享的消息信封。 */
export interface AgentMessage {
  /** 消息唯一标识。 */
  id: string;
  /** 消息角色。 */
  role: AgentRole;
  /** 消息正文。 */
  content: string;
  /** ISO 格式的创建时间。 */
  createdAt: string;
}

/** 一次工具调用的最小描述。 */
export interface ToolCall {
  /** 工具调用唯一标识。 */
  id: string;
  /** 被调用的工具名称。 */
  name: string;
  /** 传递给工具的原始输入。 */
  input: unknown;
}

/** Agent 循环在生成消息和工具活动时发出的事件流。 */
export type RunEvent =
  | { type: "message"; message: AgentMessage }
  | { type: "tool_call"; toolCall: ToolCall }
  | { type: "tool_result"; toolCallId: string; output: unknown }
  | { type: "error"; message: string };
