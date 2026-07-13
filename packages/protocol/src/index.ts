import type { RunTerminalStatus } from "./run-state.js";

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
export type ToolPermissionCategory = "command" | "network" | "read" | "write";

/** 运行时安全模式，用于跨 UI、Tauri、Runtime 与 Tools 描述当前默认策略。 */
export type RuntimeSecurityMode = "default_deny";

/** 工具能力在一次 Run 开始时冻结后的只读快照。 */
export interface RuntimeCapabilitySnapshot {
  /** 当前安全模式；默认模式采用 fail closed，未声明能力一律视为关闭。 */
  mode: RuntimeSecurityMode;
  /** 策略版本，用于审计一次 Run 使用了哪一版默认拒绝规则。 */
  policyVersion: string;
  /** 是否允许读取工作区内非敏感内容；默认允许。 */
  read: boolean;
  /** 是否允许写入、patch 或修改 Git 工作区；默认拒绝。 */
  write: boolean;
  /** 是否允许执行本地命令或启动工具子进程；默认拒绝。 */
  command: boolean;
  /** 是否允许工具发起网络请求；默认拒绝。 */
  network: boolean;
  /** 是否启用敏感文件、密钥和凭据路径保护；默认启用。 */
  sensitiveFileProtection: boolean;
  /** 快照冻结时间，使用 ISO 字符串；缺省时表示调用方未记录时间。 */
  frozenAt?: string;
}

/** 工具执行前策略复验的结果，供 Runtime 和 UI 展示一致的拒绝原因。 */
export interface ToolPolicyDecision {
  /** 决策结果；拒绝时 Runtime 可按权限类型进入用户审批流程。 */
  status: "allowed" | "denied";
  /** 被评估的工具权限分类。 */
  permission: ToolPermissionCategory;
  /** 稳定错误码或审计码。 */
  code: string;
  /** 可直接展示给用户的中文原因。 */
  message: string;
}

/** 用户对单次工具调用审批后的决策。 */
export type ToolApprovalDecision = "approved" | "denied";

/** 一次 Agent run 过程中 runtime 对外抛出的标准事件。 */
export type AgentRunEvent =
  /** 运行开始，`runId` 用于把后续事件归并到同一次执行。 */
  | { type: "run_start"; runId: string }
  /** Run 开始时冻结的安全能力快照，运行中不随 UI 设置提升权限。 */
  | {
      type: "security_snapshot";
      runId: string;
      snapshot: RuntimeCapabilitySnapshot;
    }
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
  /** 工具调用命中默认拒绝策略，Runtime 正在等待用户批准或拒绝。 */
  | {
      type: "tool_approval_request";
      runId: string;
      approvalId: string;
      toolCallId: string;
      name: string;
      permission: ToolPermissionCategory;
      input: unknown;
      reason: string;
    }
  /** 用户已经处理工具审批请求，Runtime 将继续执行或返回拒绝结果。 */
  | {
      type: "tool_approval_resolved";
      runId: string;
      approvalId: string;
      toolCallId: string;
      decision: ToolApprovalDecision;
    }
  /** 工具调用动作结束，表示工具执行阶段已收口。 */
  | { type: "tool_call_done"; runId: string; toolCallId: string }
  /** 工具执行结果，成功和失败都应包装为可序列化对象。 */
  | { type: "tool_result"; runId: string; toolCallId: string; output: unknown }
  /** 运行过程中发生的错误；有 `runId` 时可归并到对应 run。 */
  | { type: "error"; runId?: string; message: string }
  /** 运行结束，无论成功或失败都会发送；旧事件缺省时由状态机按是否见过 error 推断终态。 */
  | { type: "run_done"; runId: string; status?: RunTerminalStatus };

/** `AgentRunEvent` 的短别名，便于 UI 和 Tauri 层表达事件流。 */
export type RunEvent = AgentRunEvent;

export {
  createProtocolEnvelopeV1,
  decodeProtocolEnvelopeJsonV1,
  decodeProtocolEnvelopeV1,
  encodeProtocolEnvelopeJsonV1,
  MAX_PROTOCOL_MESSAGE_BYTES,
  PROTOCOL_MAJOR_VERSION_V1,
  PROTOCOL_VERSION_V1,
  PROTOCOL_V1_SCHEMA
} from "./v1.js";
export {
  createSidecarHelloAckV1,
  createSidecarHelloV1,
  SIDECAR_CANCEL_GRACE_MS,
  SIDECAR_HANDSHAKE_TIMEOUT_MS,
  SIDECAR_MAX_FRAME_BYTES
} from "./sidecar.js";
export type {
  AnyProtocolEnvelopeV1,
  CreateProtocolEnvelopeInputV1,
  DecodeProtocolJsonOptions,
  ProtocolDecodeErrorV1,
  ProtocolDecodeIgnoredV1,
  ProtocolDecodeOkV1,
  ProtocolDecodeResultV1,
  ProtocolEnvelopeV1,
  ProtocolErrorEnvelope,
  ProtocolErrorPayloadV1,
  ProtocolEventTypeV1,
  ProtocolMessageDonePayloadV1,
  ProtocolMessageSource,
  ProtocolMessageStartPayloadV1,
  ProtocolModelRequestStartPayloadV1,
  ProtocolPayloadByTypeV1,
  ProtocolRunDonePayloadV1,
  ProtocolRunStartPayloadV1,
  ProtocolSecuritySnapshotPayloadV1,
  ProtocolTextDeltaPayloadV1,
  ProtocolToolApprovalRequestPayloadV1,
  ProtocolToolApprovalResolvedPayloadV1,
  ProtocolToolCallDonePayloadV1,
  ProtocolToolCallStartPayloadV1,
  ProtocolToolResultPayloadV1
} from "./v1.js";
export type {
  CreateSidecarHelloInputV1,
  SidecarChatMessageV1,
  SidecarCancelReason,
  SidecarCancelV1,
  SidecarCapability,
  SidecarControlMessageV1,
  SidecarHelloAckV1,
  SidecarHelloV1,
  SidecarRunStartV1,
  SidecarToolApprovalV1,
  SidecarRuntimeMessageV1
} from "./sidecar.js";
export { RunStateMachine, createRunStateMachine } from "./run-state.js";
export type {
  CreateRunStateMachineOptions,
  RunActiveState,
  RunLifecycleState,
  RunStateMachineError,
  RunStateMachineErrorCode,
  RunStateMachineFailure,
  RunStateMachineOk,
  RunStateMachineResult,
  RunStateMachineSnapshot,
  RunTerminalStatus,
  RunToolCallState
} from "./run-state.js";
