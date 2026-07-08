import type { AgentRunEvent, ToolPermissionCategory } from "@mecha/protocol";

/** 侧边栏中展示的一条会话摘要。 */
export type Conversation = {
  /** 会话唯一标识。 */
  id: string;
  /** 会话标题，默认由首条用户消息生成。 */
  title: string;
  /** 最近更新时间的短文案。 */
  updatedAt: string;
  /** 会话当前状态文案。 */
  status: string;
};

/** 桌面端本地维护的完整会话状态。 */
export type ConversationState = Conversation & {
  /** 当前会话的消息列表。 */
  messages: ChatMessage[];
  /** 当前会话的 Agent 工具工作区。 */
  workspaceRoot: string;
};

/** 桌面端消息流中展示的一条消息。 */
export type ChatMessage = {
  /** 消息唯一标识。 */
  id: string;
  /** 消息角色；桌面端当前不直接展示 system 消息。 */
  role: "assistant" | "system" | "user";
  /** 消息正文。 */
  content: string;
  /** assistant 消息下挂载的工具调用过程。 */
  toolCalls?: ToolCallView[];
  /** 是否是前端补齐的提示消息，不会回传给 runtime。 */
  isSynthetic?: boolean;
};

/** 工具调用在 UI 中的执行状态。 */
export type ToolCallStatus = "completed" | "failed" | "running";

/** 工具调用在消息流中的展示模型。 */
export type ToolCallView = {
  /** 工具调用唯一标识。 */
  id: string;
  /** 工具注册名。 */
  name: string;
  /** 工具权限分类，用于展示风险等级。 */
  permission: ToolPermissionCategory;
  /** 工具输入参数。 */
  input: unknown;
  /** 工具输出结果；执行中时为空。 */
  output?: unknown;
  /** 当前执行状态。 */
  status: ToolCallStatus;
};

/** 当前 Agent run 在 UI 顶部展示的状态。 */
export type AgentRunStatus =
  | "calling_tool"
  | "completed"
  | "error"
  | "generating"
  | "idle"
  | "thinking";

export type RuntimeProviderId = "openai" | "anthropic";

export type { AgentRunEvent, ToolPermissionCategory };
