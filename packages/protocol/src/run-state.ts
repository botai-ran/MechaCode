import type { AgentRunEvent } from "./index.js";

/** Run 生命周期中的非终态节点。 */
export type RunActiveState = "created" | "starting" | "running" | "cancelling";

/** Run 生命周期终态；每个 Run 最终必须且只能进入其中一个。 */
export type RunTerminalStatus = "completed" | "failed" | "cancelled" | "interrupted";

/** Run 生命周期状态，`terminal` 通过 `terminalStatus` 区分具体结果。 */
export type RunLifecycleState = RunActiveState | "terminal";

/** 工具调用在 Run 状态机中的配对状态。 */
export type RunToolCallState = "running" | "result_received" | "done";

/** Run 状态机拒绝事件时返回的稳定错误码。 */
export type RunStateMachineErrorCode =
  | "RUN_EVENT_AFTER_TERMINAL"
  | "RUN_EVENT_RUN_ID_MISMATCH"
  | "RUN_EVENT_DUPLICATE_START"
  | "RUN_EVENT_MISSING_START"
  | "RUN_EVENT_DUPLICATE_TERMINAL"
  | "RUN_EVENT_INVALID_TRANSITION"
  | "RUN_TOOL_CALL_DUPLICATE_START"
  | "RUN_TOOL_CALL_MISSING_START"
  | "RUN_TOOL_CALL_DUPLICATE_RESULT"
  | "RUN_TOOL_CALL_RESULT_REQUIRED";

/** Run 状态机拒绝某个事件时的结构化原因。 */
export interface RunStateMachineError {
  /** 稳定错误码，用于测试和跨层错误归一化。 */
  code: RunStateMachineErrorCode;
  /** 可直接展示或写入日志的中文说明。 */
  message: string;
  /** 触发拒绝的事件类型。 */
  eventType: AgentRunEvent["type"];
  /** 当前 Run 状态，用于定位乱序或终态后的输出。 */
  state: RunLifecycleState;
}

/** Run 状态机成功接收事件后的快照。 */
export interface RunStateMachineSnapshot {
  /** 当前生命周期状态。 */
  state: RunLifecycleState;
  /** 当前 Run ID；收到 `run_start` 前为空。 */
  runId?: string;
  /** 终态状态；仅当 `state` 为 `terminal` 时存在。 */
  terminalStatus?: RunTerminalStatus;
  /** 本轮 Run 是否已经观察到错误事件。 */
  hasError: boolean;
  /** 当前仍未完成配对的工具调用数量。 */
  openToolCallCount: number;
}

/** Run 状态机成功接收事件的结果。 */
export interface RunStateMachineOk {
  /** 应用结果。 */
  ok: true;
  /** 应用事件后的快照。 */
  snapshot: RunStateMachineSnapshot;
}

/** Run 状态机拒绝事件的结果。 */
export interface RunStateMachineFailure {
  /** 应用结果。 */
  ok: false;
  /** 拒绝原因。 */
  error: RunStateMachineError;
  /** 拒绝事件后的状态机仍保持原快照。 */
  snapshot: RunStateMachineSnapshot;
}

/** Run 状态机事件应用结果。 */
export type RunStateMachineResult = RunStateMachineOk | RunStateMachineFailure;

/** 创建 Run 状态机时可注入的初始条件。 */
export interface CreateRunStateMachineOptions {
  /** 可选 Run ID；用于接收已知 Run 的恢复或测试场景。 */
  runId?: string;
}

interface ToolCallRecord {
  state: RunToolCallState;
}

/**
 * 校验 Run 事件顺序、终态唯一性和工具调用配对关系。
 *
 * 状态机属于协议层：Runtime 用它约束业务事件流，Desktop 后续只按协议
 * 投影状态，Tauri 仍负责进程事实和异常退出事实的上报。
 */
export class RunStateMachine {
  private state: RunLifecycleState;
  private runId: string | undefined;
  private terminalStatus: RunTerminalStatus | undefined;
  private hasError = false;
  private readonly toolCalls = new Map<string, ToolCallRecord>();

  constructor(options: CreateRunStateMachineOptions = {}) {
    this.runId = options.runId;
    this.state = options.runId ? "starting" : "created";
  }

  /**
   * 将一个 `AgentRunEvent` 应用到状态机。
   *
   * @param event Runtime 或测试输入的 Run 事件。
   * @returns 成功快照，或拒绝事件的稳定错误。
   */
  apply(event: AgentRunEvent): RunStateMachineResult {
    const precheck = this.precheck(event);

    if (precheck) {
      return this.fail(event, precheck.code, precheck.message);
    }

    switch (event.type) {
      case "run_start":
        return this.applyRunStart(event);
      case "security_snapshot":
        return this.applyStartingEvent(event);
      case "model_request_start":
        this.state = "running";
        return this.ok();
      case "message_start":
      case "text_delta":
      case "message_done":
        return this.requireRunning(event);
      case "tool_call_start":
        return this.applyToolCallStart(event);
      case "tool_approval_request":
      case "tool_approval_resolved":
        return this.requireRunning(event);
      case "tool_result":
        return this.applyToolResult(event);
      case "tool_call_done":
        return this.applyToolCallDone(event);
      case "error":
        this.hasError = true;
        if (this.state === "starting") {
          this.state = "running";
        }
        return this.ok();
      case "run_done":
        return this.applyRunDone(event);
    }
  }

  /** 返回当前状态快照，调用方可用于日志、测试或 UI 投影。 */
  snapshot(): RunStateMachineSnapshot {
    return {
      state: this.state,
      ...(this.runId ? { runId: this.runId } : {}),
      ...(this.terminalStatus ? { terminalStatus: this.terminalStatus } : {}),
      hasError: this.hasError,
      openToolCallCount: [...this.toolCalls.values()].filter(
        (toolCall) => toolCall.state !== "done"
      ).length
    };
  }

  private precheck(
    event: AgentRunEvent
  ): { code: RunStateMachineErrorCode; message: string } | null {
    if (this.state === "terminal" && event.type === "run_done") {
      return {
        code: "RUN_EVENT_DUPLICATE_TERMINAL",
        message: "Run 已经有终态，不能重复结束。"
      };
    }

    if (this.state === "terminal") {
      return {
        code: "RUN_EVENT_AFTER_TERMINAL",
        message: "Run 已进入终态，不能继续接收事件。"
      };
    }

    if (event.type !== "run_start" && !this.runId) {
      return {
        code: "RUN_EVENT_MISSING_START",
        message: "Run 事件缺少对应的开始事件。"
      };
    }

    if (event.type !== "error" && this.runId && event.runId !== this.runId) {
      return {
        code: "RUN_EVENT_RUN_ID_MISMATCH",
        message: "Run 事件的 runId 与当前状态机不一致。"
      };
    }

    if (
      event.type === "error" &&
      event.runId !== undefined &&
      this.runId &&
      event.runId !== this.runId
    ) {
      return {
        code: "RUN_EVENT_RUN_ID_MISMATCH",
        message: "Run 错误事件的 runId 与当前状态机不一致。"
      };
    }

    return null;
  }

  private applyRunStart(event: Extract<AgentRunEvent, { type: "run_start" }>): RunStateMachineResult {
    if (this.state !== "created") {
      return this.fail(event, "RUN_EVENT_DUPLICATE_START", "Run 已经开始，不能重复开始。");
    }

    this.runId = event.runId;
    this.state = "starting";

    return this.ok();
  }

  private applyStartingEvent(event: AgentRunEvent): RunStateMachineResult {
    if (this.state !== "starting") {
      return this.fail(event, "RUN_EVENT_INVALID_TRANSITION", "该事件只能在 Run 启动阶段出现。");
    }

    return this.ok();
  }

  private requireRunning(event: AgentRunEvent): RunStateMachineResult {
    if (this.state !== "running") {
      return this.fail(event, "RUN_EVENT_INVALID_TRANSITION", "该事件只能在 Run 运行阶段出现。");
    }

    return this.ok();
  }

  private applyToolCallStart(
    event: Extract<AgentRunEvent, { type: "tool_call_start" }>
  ): RunStateMachineResult {
    const running = this.requireRunning(event);

    if (!running.ok) {
      return running;
    }

    if (this.toolCalls.has(event.toolCallId)) {
      return this.fail(event, "RUN_TOOL_CALL_DUPLICATE_START", "工具调用不能重复开始。");
    }

    this.toolCalls.set(event.toolCallId, { state: "running" });

    return this.ok();
  }

  private applyToolResult(
    event: Extract<AgentRunEvent, { type: "tool_result" }>
  ): RunStateMachineResult {
    const running = this.requireRunning(event);

    if (!running.ok) {
      return running;
    }

    const toolCall = this.toolCalls.get(event.toolCallId);

    if (!toolCall) {
      return this.fail(event, "RUN_TOOL_CALL_MISSING_START", "工具结果缺少对应的开始事件。");
    }

    if (toolCall.state !== "running") {
      return this.fail(event, "RUN_TOOL_CALL_DUPLICATE_RESULT", "工具调用不能重复返回结果。");
    }

    toolCall.state = "result_received";

    return this.ok();
  }

  private applyToolCallDone(
    event: Extract<AgentRunEvent, { type: "tool_call_done" }>
  ): RunStateMachineResult {
    const running = this.requireRunning(event);

    if (!running.ok) {
      return running;
    }

    const toolCall = this.toolCalls.get(event.toolCallId);

    if (!toolCall) {
      return this.fail(event, "RUN_TOOL_CALL_MISSING_START", "工具结束缺少对应的开始事件。");
    }

    if (toolCall.state === "running") {
      return this.fail(event, "RUN_TOOL_CALL_RESULT_REQUIRED", "工具结束前必须先返回工具结果。");
    }

    if (toolCall.state === "done") {
      return this.fail(event, "RUN_EVENT_INVALID_TRANSITION", "工具调用不能重复结束。");
    }

    toolCall.state = "done";

    return this.ok();
  }

  private applyRunDone(event: Extract<AgentRunEvent, { type: "run_done" }>): RunStateMachineResult {
    if (this.terminalStatus) {
      return this.fail(event, "RUN_EVENT_DUPLICATE_TERMINAL", "Run 已经有终态，不能重复结束。");
    }

    const openToolCall = [...this.toolCalls.values()].find(
      (toolCall) => toolCall.state !== "done"
    );

    if (openToolCall) {
      return this.fail(event, "RUN_EVENT_INVALID_TRANSITION", "存在未完成配对的工具调用。");
    }

    this.state = "terminal";
    this.terminalStatus = event.status ?? (this.hasError ? "failed" : "completed");

    return this.ok();
  }

  private ok(): RunStateMachineOk {
    return {
      ok: true,
      snapshot: this.snapshot()
    };
  }

  private fail(
    event: AgentRunEvent,
    code: RunStateMachineErrorCode,
    message: string
  ): RunStateMachineFailure {
    return {
      ok: false,
      error: {
        code,
        message,
        eventType: event.type,
        state: this.state
      },
      snapshot: this.snapshot()
    };
  }
}

/** 创建新的 Run 状态机实例。 */
export function createRunStateMachine(
  options?: CreateRunStateMachineOptions
): RunStateMachine {
  return new RunStateMachine(options);
}
