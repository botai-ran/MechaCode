/** Agent 消息在 UI、Tauri 与 runtime 之间传递时允许使用的角色。 */
export type AgentRole = "system" | "user" | "assistant" | "tool";

/** 持久化或跨层传递的 Agent 消息记录。 */
export interface AgentMessage {
  /** 消息唯一标识，由创建消息的一侧生成并保持稳定。 */
  id: string;
  /** 消息发送方角色。 */
  role: AgentRole;
  /** 消息正文文本。 */
  content: string;
  /** 消息创建时间，统一使用 ISO 字符串。 */
  createdAt: string;
}

/** 模型请求执行工具时跨层传递的工具调用描述。 */
export interface ToolCall {
  /** 工具调用唯一标识，用于把工具结果归并到对应调用。 */
  id: string;
  /** 工具注册表中的稳定工具名称。 */
  name: string;
  /** 模型生成的工具输入参数，具体结构由工具自身的 JSON Schema 约束。 */
  input: unknown;
}

/** 工具调用的权限分类，用于 UI 标记风险等级和后续权限确认。 */
export type ToolPermissionCategory = "command" | "read" | "write";

/** 一次 Agent run 过程中 runtime 对外抛出的标准事件。 */
export type AgentRunEvent =
  /** 运行开始，`runId` 用于把后续事件归并到同一次执行。 */
  | { type: "run_start"; runId: string }
  /** runtime 开始向模型服务商发起请求。 */
  | { type: "model_request_start"; runId: string }
  /** assistant 消息开始生成，前端可据此创建空消息占位。 */
  | { type: "message_start"; runId: string; messageId: string; role: "assistant" }
  /** assistant 消息的文本增量。 */
  | { type: "text_delta"; runId: string; messageId: string; text: string }
  /** 当前 assistant 消息生成结束。 */
  | { type: "message_done"; runId: string; messageId: string }
  /** 模型请求调用工具，`input` 是待执行的结构化入参。 */
  | {
      type: "tool_call_start";
      runId: string;
      toolCallId: string;
      name: string;
      permission: ToolPermissionCategory;
      input: unknown;
    }
  /** 工具调用动作结束，表示工具执行阶段已收口。 */
  | { type: "tool_call_done"; runId: string; toolCallId: string }
  /** 工具执行结果，成功和失败都应包装为可序列化对象。 */
  | { type: "tool_result"; runId: string; toolCallId: string; output: unknown }
  /** 运行过程中发生的错误；有 `runId` 时可归并到对应 run。 */
  | { type: "error"; runId?: string; message: string }
  /** 运行结束，无论成功或失败都会发送。 */
  | { type: "run_done"; runId: string };

/** `AgentRunEvent` 的短别名，便于 UI 和 Tauri 层表达事件流。 */
export type RunEvent = AgentRunEvent;
