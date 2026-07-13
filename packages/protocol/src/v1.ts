import type { RuntimeCapabilitySnapshot, ToolPermissionCategory } from "./index.js";
import type { RunTerminalStatus } from "./run-state.js";

/** Protocol v1 当前生成消息时使用的具体版本号。 */
export const PROTOCOL_VERSION_V1 = "1.0.0";

/** Protocol v1 兼容判断使用的主版本号。 */
export const PROTOCOL_MAJOR_VERSION_V1 = 1;

/** 单条协议消息允许的默认最大 UTF-8 字节数。 */
export const MAX_PROTOCOL_MESSAGE_BYTES = 1024 * 1024;

/** 协议消息可声明的稳定来源，用于错误归因和审计。 */
export type ProtocolMessageSource =
  | "desktop"
  | "tauri"
  | "runtime"
  | "tools"
  | "provider"
  | "protocol";

/** Protocol v1 的错误信封，所有跨边界错误都应转换为这个稳定形状。 */
export interface ProtocolErrorEnvelope {
  /** 稳定错误码，用于测试、日志聚合和兼容处理。 */
  code: string;
  /** 可直接展示给用户的中文错误信息。 */
  message: string;
  /** 调用方是否可以在不修改输入的情况下重试。 */
  retryable: boolean;
  /** 错误产生或被归一化的边界来源。 */
  source: ProtocolMessageSource;
  /** 已脱敏的结构化详情；不得包含密钥、原始堆栈或未授权文件内容。 */
  details?: Record<string, unknown>;
}

/** Run 开始事件的 payload；字段保留为空对象，便于后续兼容扩展。 */
export interface ProtocolRunStartPayloadV1 {
  /** 预留扩展字段；当前版本没有必填内容。 */
  readonly _reserved?: never;
}

/** Run 安全能力快照事件的 payload。 */
export interface ProtocolSecuritySnapshotPayloadV1 {
  /** 本轮 Run 冻结后的安全能力快照，运行中不得被 UI 设置提升。 */
  snapshot: RuntimeCapabilitySnapshot;
}

/** 模型请求开始事件的 payload；字段保留为空对象，便于后续兼容扩展。 */
export interface ProtocolModelRequestStartPayloadV1 {
  /** 预留扩展字段；当前版本没有必填内容。 */
  readonly _reserved?: never;
}

/** assistant 消息开始事件的 payload。 */
export interface ProtocolMessageStartPayloadV1 {
  /** 当前 assistant 消息的稳定 ID，用于归并后续增量。 */
  messageId: string;
  /** 当前版本只允许 runtime 产生 assistant 消息。 */
  role: "assistant";
}

/** assistant 文本增量事件的 payload。 */
export interface ProtocolTextDeltaPayloadV1 {
  /** 当前文本增量归属的 assistant 消息 ID。 */
  messageId: string;
  /** 本次新增的文本片段，允许为空字符串但必须显式存在。 */
  text: string;
}

/** assistant 消息结束事件的 payload。 */
export interface ProtocolMessageDonePayloadV1 {
  /** 已完成生成的 assistant 消息 ID。 */
  messageId: string;
}

/** 工具调用开始事件的 payload。 */
export interface ProtocolToolCallStartPayloadV1 {
  /** 工具调用 ID，用于关联结果、审批和审计记录。 */
  toolCallId: string;
  /** 工具注册表中的稳定工具名称。 */
  name: string;
  /** 工具需要的权限分类，用于 UI 标记风险等级和策略复验。 */
  permission: ToolPermissionCategory;
  /** 模型生成的工具输入参数；具体结构由工具自身 schema 约束。 */
  input: unknown;
}

/** 工具调用结束事件的 payload。 */
export interface ProtocolToolCallDonePayloadV1 {
  /** 已收口的工具调用 ID。 */
  toolCallId: string;
}

/** 工具执行结果事件的 payload。 */
export interface ProtocolToolResultPayloadV1 {
  /** 当前结果归属的工具调用 ID。 */
  toolCallId: string;
  /** 工具返回的可序列化结果；成功和失败都应包装在这里。 */
  output: unknown;
}

/** Run 错误事件的 payload，直接使用稳定错误信封。 */
export type ProtocolErrorPayloadV1 = ProtocolErrorEnvelope;

/** Run 完成事件的 payload；Protocol v1 必须显式携带唯一终态。 */
export interface ProtocolRunDonePayloadV1 {
  /** 本次 Run 的唯一终态。 */
  status: RunTerminalStatus;
}

/** Protocol v1 支持的事件类型到 payload 的唯一映射。 */
export interface ProtocolPayloadByTypeV1 {
  /** Run 已创建并开始向下游发送事件。 */
  run_start: ProtocolRunStartPayloadV1;
  /** Run 开始时冻结的安全能力快照。 */
  security_snapshot: ProtocolSecuritySnapshotPayloadV1;
  /** Runtime 准备向模型服务商发起请求。 */
  model_request_start: ProtocolModelRequestStartPayloadV1;
  /** assistant 消息开始生成。 */
  message_start: ProtocolMessageStartPayloadV1;
  /** assistant 消息文本增量。 */
  text_delta: ProtocolTextDeltaPayloadV1;
  /** assistant 消息生成结束。 */
  message_done: ProtocolMessageDonePayloadV1;
  /** 模型请求执行工具。 */
  tool_call_start: ProtocolToolCallStartPayloadV1;
  /** 工具调用执行阶段结束。 */
  tool_call_done: ProtocolToolCallDonePayloadV1;
  /** 工具调用返回结果。 */
  tool_result: ProtocolToolResultPayloadV1;
  /** Run 过程中发生可展示错误。 */
  error: ProtocolErrorPayloadV1;
  /** Run 已进入终态。 */
  run_done: ProtocolRunDonePayloadV1;
}

/** Protocol v1 允许跨边界传递的事件类型。 */
export type ProtocolEventTypeV1 = keyof ProtocolPayloadByTypeV1;

/** Protocol v1 的版本化外层信封，所有跨边界消息都应具有这个公共头。 */
export type ProtocolEnvelopeV1<TType extends ProtocolEventTypeV1 = ProtocolEventTypeV1> = {
  /** 语义化协议版本；同一主版本必须保持向后兼容。 */
  protocolVersion: string;
  /** Run 的稳定 ID，用于把事件、工具调用和错误归并到同一次运行。 */
  runId: string;
  /** 单个 Run 内单调递增的序号；跨进程接收方用它检测乱序和重复。 */
  seq: number;
  /** 当前消息的事件类型，决定 payload 的结构。 */
  type: TType;
  /** 受事件类型约束的消息正文。 */
  payload: ProtocolPayloadByTypeV1[TType];
};

/** Protocol v1 所有已知事件信封的联合类型。 */
export type AnyProtocolEnvelopeV1 = {
  /** 按事件类型展开后的具体信封。 */
  [TType in ProtocolEventTypeV1]: ProtocolEnvelopeV1<TType>;
}[ProtocolEventTypeV1];

/** 创建 Protocol v1 信封时使用的输入参数。 */
export interface CreateProtocolEnvelopeInputV1<TType extends ProtocolEventTypeV1> {
  /** 可选协议版本；默认使用当前 v1 版本。 */
  protocolVersion?: string;
  /** Run 的稳定 ID。 */
  runId: string;
  /** 单个 Run 内的消息序号。 */
  seq: number;
  /** 当前消息的事件类型。 */
  type: TType;
  /** 与事件类型匹配的 payload。 */
  payload: ProtocolPayloadByTypeV1[TType];
}

/** JSON 解码时可覆盖的边界约束。 */
export interface DecodeProtocolJsonOptions {
  /** 允许的最大 UTF-8 字节数；缺省使用 `MAX_PROTOCOL_MESSAGE_BYTES`。 */
  maxBytes?: number;
}

/** Protocol v1 解码成功结果。 */
export interface ProtocolDecodeOkV1 {
  /** 解码结果状态。 */
  status: "ok";
  /** 已通过结构校验的协议消息。 */
  message: AnyProtocolEnvelopeV1;
}

/** Protocol v1 遇到可安全忽略消息时的结果。 */
export interface ProtocolDecodeIgnoredV1 {
  /** 解码结果状态。 */
  status: "ignored";
  /** 描述忽略原因的稳定错误信封。 */
  error: ProtocolErrorEnvelope;
}

/** Protocol v1 解码失败结果。 */
export interface ProtocolDecodeErrorV1 {
  /** 解码结果状态。 */
  status: "error";
  /** 描述失败原因的稳定错误信封。 */
  error: ProtocolErrorEnvelope;
}

/** Protocol v1 解码函数的完整结果类型。 */
export type ProtocolDecodeResultV1 =
  | ProtocolDecodeOkV1
  | ProtocolDecodeIgnoredV1
  | ProtocolDecodeErrorV1;

/** Protocol v1 的 schema 摘要，作为 TS/Rust 契约测试共享语义的入口。 */
export const PROTOCOL_V1_SCHEMA = Object.freeze({
  id: "mecha.protocol.v1",
  version: PROTOCOL_VERSION_V1,
  majorVersion: PROTOCOL_MAJOR_VERSION_V1,
  requiredEnvelopeFields: ["protocolVersion", "runId", "seq", "type", "payload"],
  eventTypes: [
    "run_start",
    "security_snapshot",
    "model_request_start",
    "message_start",
    "text_delta",
    "message_done",
    "tool_call_start",
    "tool_call_done",
    "tool_result",
    "error",
    "run_done"
  ],
  compatibility: {
    sameMajorVersion: "backward_compatible",
    unknownEvent: "ignore",
    incompatibleMajorVersion: "fail_handshake"
  }
});

const KNOWN_EVENT_TYPES = new Set<string>(PROTOCOL_V1_SCHEMA.eventTypes);
const TOOL_PERMISSION_CATEGORIES = new Set<string>([
  "command",
  "network",
  "read",
  "write"
]);

/**
 * 创建并校验 Protocol v1 信封。
 *
 * @param input 事件类型、Run ID、序号和 payload。
 * @returns 已通过结构校验的协议信封。
 */
export function createProtocolEnvelopeV1<TType extends ProtocolEventTypeV1>(
  input: CreateProtocolEnvelopeInputV1<TType>
): ProtocolEnvelopeV1<TType> {
  const message: ProtocolEnvelopeV1<TType> = {
    protocolVersion: input.protocolVersion ?? PROTOCOL_VERSION_V1,
    runId: input.runId,
    seq: input.seq,
    type: input.type,
    payload: input.payload
  };
  const result = decodeProtocolEnvelopeV1(message);

  if (result.status !== "ok") {
    throw new Error(`协议消息无效：${result.error.message}`);
  }

  return message;
}

/**
 * 将 Protocol v1 信封编码为 JSON 字符串。
 *
 * @param message 已构造的协议信封。
 * @returns 可跨进程传输的 JSON 字符串。
 */
export function encodeProtocolEnvelopeJsonV1(
  message: AnyProtocolEnvelopeV1
): string {
  const result = decodeProtocolEnvelopeV1(message);

  if (result.status !== "ok") {
    throw new Error(`协议消息无效：${result.error.message}`);
  }

  return JSON.stringify(message);
}

/**
 * 从 JSON 字符串解码并校验 Protocol v1 消息。
 *
 * @param json 跨进程收到的原始 JSON 字符串。
 * @param options 可选大小限制。
 * @returns ok、ignored 或 error 结果。
 */
export function decodeProtocolEnvelopeJsonV1(
  json: string,
  options: DecodeProtocolJsonOptions = {}
): ProtocolDecodeResultV1 {
  const maxBytes = options.maxBytes ?? MAX_PROTOCOL_MESSAGE_BYTES;

  if (Buffer.byteLength(json, "utf8") > maxBytes) {
    return protocolError("PROTOCOL_MESSAGE_TOO_LARGE", "协议消息超过最大长度限制。", {
      maxBytes
    });
  }

  try {
    return decodeProtocolEnvelopeV1(JSON.parse(json) as unknown);
  } catch (error) {
    return protocolError("PROTOCOL_INVALID_JSON", "协议消息不是合法 JSON。", {
      reason: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * 校验已经解析为对象的 Protocol v1 消息。
 *
 * @param input 未可信的消息对象。
 * @returns ok、ignored 或 error 结果。
 */
export function decodeProtocolEnvelopeV1(input: unknown): ProtocolDecodeResultV1 {
  if (!isRecord(input)) {
    return protocolError("PROTOCOL_INVALID_MESSAGE", "协议消息必须是对象。");
  }

  const versionResult = validateProtocolVersion(input.protocolVersion);

  if (versionResult) {
    return versionResult;
  }

  if (!isNonEmptyString(input.runId)) {
    return protocolError("PROTOCOL_INVALID_RUN_ID", "协议消息缺少有效 runId。");
  }

  const seq = input.seq;

  if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 0) {
    return protocolError("PROTOCOL_INVALID_SEQ", "协议消息缺少有效 seq。");
  }

  if (!isNonEmptyString(input.type)) {
    return protocolError("PROTOCOL_INVALID_TYPE", "协议消息缺少有效 type。");
  }

  if (!KNOWN_EVENT_TYPES.has(input.type)) {
    return {
      status: "ignored",
      error: createProtocolError("PROTOCOL_UNKNOWN_EVENT", "收到未知协议事件，已安全忽略。", {
        type: input.type
      })
    };
  }

  if (!isRecord(input.payload)) {
    return protocolError("PROTOCOL_INVALID_PAYLOAD", "协议消息 payload 必须是对象。", {
      type: input.type
    });
  }

  const payloadError = validatePayload(input.type as ProtocolEventTypeV1, input.payload);

  if (payloadError) {
    return payloadError;
  }

  return {
    status: "ok",
    message: input as AnyProtocolEnvelopeV1
  };
}

function validateProtocolVersion(version: unknown): ProtocolDecodeErrorV1 | null {
  if (!isNonEmptyString(version)) {
    return protocolError("PROTOCOL_INVALID_VERSION", "协议消息缺少有效 protocolVersion。");
  }

  const majorVersion = parseMajorVersion(version);

  if (majorVersion === null) {
    return protocolError("PROTOCOL_INVALID_VERSION", "协议版本必须使用语义化版本号。", {
      protocolVersion: version
    });
  }

  if (majorVersion !== PROTOCOL_MAJOR_VERSION_V1) {
    return protocolError("PROTOCOL_INCOMPATIBLE_VERSION", "协议主版本不兼容，必须拒绝启动 Run。", {
      expectedMajorVersion: PROTOCOL_MAJOR_VERSION_V1,
      actualVersion: version
    });
  }

  return null;
}

function validatePayload(
  type: ProtocolEventTypeV1,
  payload: Record<string, unknown>
): ProtocolDecodeErrorV1 | null {
  switch (type) {
    case "run_start":
    case "model_request_start":
      return null;
    case "run_done":
      return validateRunDonePayload(payload);
    case "security_snapshot":
      return validateSecuritySnapshotPayload(payload);
    case "message_start":
      return validateMessageStartPayload(payload);
    case "text_delta":
      return validateTextDeltaPayload(payload);
    case "message_done":
      return validateStringField(payload, "messageId", "PROTOCOL_INVALID_MESSAGE_ID");
    case "tool_call_start":
      return validateToolCallStartPayload(payload);
    case "tool_call_done":
      return validateStringField(payload, "toolCallId", "PROTOCOL_INVALID_TOOL_CALL_ID");
    case "tool_result":
      return validateToolResultPayload(payload);
    case "error":
      return validateProtocolErrorEnvelope(payload);
  }
}

function validateRunDonePayload(
  payload: Record<string, unknown>
): ProtocolDecodeErrorV1 | null {
  if (
    typeof payload.status !== "string" ||
    !["completed", "failed", "cancelled", "interrupted"].includes(payload.status)
  ) {
    return protocolError("PROTOCOL_INVALID_TERMINAL_STATUS", "Run 终态不在协议允许范围内。");
  }

  return null;
}

function validateSecuritySnapshotPayload(
  payload: Record<string, unknown>
): ProtocolDecodeErrorV1 | null {
  if (!isRecord(payload.snapshot)) {
    return protocolError("PROTOCOL_INVALID_SECURITY_SNAPSHOT", "安全能力快照必须是对象。");
  }

  const snapshot = payload.snapshot;

  if (snapshot.mode !== "default_deny") {
    return protocolError("PROTOCOL_INVALID_SECURITY_MODE", "安全模式必须是 default_deny。");
  }

  for (const field of ["read", "write", "command", "network", "sensitiveFileProtection"]) {
    if (typeof snapshot[field] !== "boolean") {
      return protocolError("PROTOCOL_INVALID_SECURITY_SNAPSHOT", "安全能力快照缺少布尔能力字段。", {
        field
      });
    }
  }

  if (!isNonEmptyString(snapshot.policyVersion)) {
    return protocolError("PROTOCOL_INVALID_POLICY_VERSION", "安全能力快照缺少有效 policyVersion。");
  }

  if (snapshot.frozenAt !== undefined && typeof snapshot.frozenAt !== "string") {
    return protocolError("PROTOCOL_INVALID_FROZEN_AT", "安全能力快照 frozenAt 必须是字符串。");
  }

  return null;
}

function validateMessageStartPayload(
  payload: Record<string, unknown>
): ProtocolDecodeErrorV1 | null {
  const messageIdError = validateStringField(payload, "messageId", "PROTOCOL_INVALID_MESSAGE_ID");

  if (messageIdError) {
    return messageIdError;
  }

  if (payload.role !== "assistant") {
    return protocolError("PROTOCOL_INVALID_ROLE", "message_start 只允许 assistant 角色。");
  }

  return null;
}

function validateTextDeltaPayload(
  payload: Record<string, unknown>
): ProtocolDecodeErrorV1 | null {
  const messageIdError = validateStringField(payload, "messageId", "PROTOCOL_INVALID_MESSAGE_ID");

  if (messageIdError) {
    return messageIdError;
  }

  if (typeof payload.text !== "string") {
    return protocolError("PROTOCOL_INVALID_TEXT_DELTA", "text_delta 必须包含字符串 text。");
  }

  return null;
}

function validateToolCallStartPayload(
  payload: Record<string, unknown>
): ProtocolDecodeErrorV1 | null {
  const toolCallIdError = validateStringField(payload, "toolCallId", "PROTOCOL_INVALID_TOOL_CALL_ID");

  if (toolCallIdError) {
    return toolCallIdError;
  }

  const nameError = validateStringField(payload, "name", "PROTOCOL_INVALID_TOOL_NAME");

  if (nameError) {
    return nameError;
  }

  if (typeof payload.permission !== "string" || !TOOL_PERMISSION_CATEGORIES.has(payload.permission)) {
    return protocolError("PROTOCOL_INVALID_TOOL_PERMISSION", "工具权限分类不在协议允许范围内。");
  }

  if (!Object.hasOwn(payload, "input")) {
    return protocolError("PROTOCOL_INVALID_TOOL_INPUT", "工具调用必须显式包含 input。");
  }

  return null;
}

function validateToolResultPayload(
  payload: Record<string, unknown>
): ProtocolDecodeErrorV1 | null {
  const toolCallIdError = validateStringField(payload, "toolCallId", "PROTOCOL_INVALID_TOOL_CALL_ID");

  if (toolCallIdError) {
    return toolCallIdError;
  }

  if (!Object.hasOwn(payload, "output")) {
    return protocolError("PROTOCOL_INVALID_TOOL_OUTPUT", "工具结果必须显式包含 output。");
  }

  return null;
}

function validateProtocolErrorEnvelope(
  payload: Record<string, unknown>
): ProtocolDecodeErrorV1 | null {
  const codeError = validateStringField(payload, "code", "PROTOCOL_INVALID_ERROR_CODE");

  if (codeError) {
    return codeError;
  }

  const messageError = validateStringField(payload, "message", "PROTOCOL_INVALID_ERROR_MESSAGE");

  if (messageError) {
    return messageError;
  }

  if (typeof payload.retryable !== "boolean") {
    return protocolError("PROTOCOL_INVALID_ERROR_RETRYABLE", "错误信封 retryable 必须是布尔值。");
  }

  if (
    typeof payload.source !== "string" ||
    !["desktop", "tauri", "runtime", "tools", "provider", "protocol"].includes(payload.source)
  ) {
    return protocolError("PROTOCOL_INVALID_ERROR_SOURCE", "错误信封 source 不在协议允许范围内。");
  }

  if (payload.details !== undefined && !isRecord(payload.details)) {
    return protocolError("PROTOCOL_INVALID_ERROR_DETAILS", "错误信封 details 必须是脱敏对象。");
  }

  return null;
}

function validateStringField(
  payload: Record<string, unknown>,
  field: string,
  code: string
): ProtocolDecodeErrorV1 | null {
  return isNonEmptyString(payload[field])
    ? null
    : protocolError(code, `协议 payload 缺少有效 ${field}。`, { field });
}

function protocolError(
  code: string,
  message: string,
  details?: Record<string, unknown>
): ProtocolDecodeErrorV1 {
  return {
    status: "error",
    error: createProtocolError(code, message, details)
  };
}

function createProtocolError(
  code: string,
  message: string,
  details?: Record<string, unknown>
): ProtocolErrorEnvelope {
  return {
    code,
    message,
    retryable: false,
    source: "protocol",
    ...(details ? { details } : {})
  };
}

function parseMajorVersion(version: string): number | null {
  const match = /^(\d+)\.\d+\.\d+$/.exec(version);

  return match ? Number(match[1]) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
