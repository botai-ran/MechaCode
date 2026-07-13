import assert from "node:assert/strict";
import test from "node:test";

import { createRunStateMachine } from "./index.js";
import type {
  AgentRunEvent,
  RunStateMachineErrorCode,
  RunStateMachineResult
} from "./index.js";

test("Run 状态机接受正常运行并进入 completed 终态", () => {
  const machine = createRunStateMachine();

  applyAll(machine, [
    { type: "run_start", runId: "run-ok" },
    {
      type: "security_snapshot",
      runId: "run-ok",
      snapshot: {
        mode: "default_deny",
        policyVersion: "default-deny-v0",
        read: true,
        write: false,
        command: false,
        network: false,
        sensitiveFileProtection: true
      }
    },
    { type: "model_request_start", runId: "run-ok" },
    {
      type: "message_start",
      runId: "run-ok",
      messageId: "message-ok",
      role: "assistant"
    },
    { type: "text_delta", runId: "run-ok", messageId: "message-ok", text: "ok" },
    { type: "message_done", runId: "run-ok", messageId: "message-ok" },
    { type: "run_done", runId: "run-ok" }
  ]);

  assert.deepEqual(machine.snapshot(), {
    state: "terminal",
    runId: "run-ok",
    terminalStatus: "completed",
    hasError: false,
    openToolCallCount: 0
  });
});

test("Run 状态机拒绝缺少开始事件的乱序输出", () => {
  const machine = createRunStateMachine();
  const result = machine.apply({
    type: "message_start",
    runId: "run-out-of-order",
    messageId: "message-out-of-order",
    role: "assistant"
  });

  assertFailure(result, "RUN_EVENT_MISSING_START");
});

test("Run 状态机拒绝重复终态和终态后的输出", () => {
  const machine = createRunStateMachine();

  applyAll(machine, [
    { type: "run_start", runId: "run-terminal" },
    { type: "model_request_start", runId: "run-terminal" },
    { type: "run_done", runId: "run-terminal" }
  ]);

  const duplicateDone = machine.apply({
    type: "run_done",
    runId: "run-terminal"
  });
  const afterTerminal = machine.apply({
    type: "text_delta",
    runId: "run-terminal",
    messageId: "message-terminal",
    text: "late"
  });

  assertFailure(duplicateDone, "RUN_EVENT_DUPLICATE_TERMINAL");
  assertFailure(afterTerminal, "RUN_EVENT_AFTER_TERMINAL");
});

test("Run 状态机校验工具调用配对状态", () => {
  const machine = createRunStateMachine();

  applyAll(machine, [
    { type: "run_start", runId: "run-tool" },
    { type: "model_request_start", runId: "run-tool" },
    {
      type: "tool_call_start",
      runId: "run-tool",
      toolCallId: "tool-1",
      name: "file.read",
      permission: "read",
      input: {}
    },
    {
      type: "tool_result",
      runId: "run-tool",
      toolCallId: "tool-1",
      output: { ok: true }
    }
  ]);

  const duplicateResult = machine.apply({
    type: "tool_result",
    runId: "run-tool",
    toolCallId: "tool-1",
    output: { ok: true }
  });

  assertFailure(duplicateResult, "RUN_TOOL_CALL_DUPLICATE_RESULT");

  applyOk(machine, {
    type: "tool_call_done",
    runId: "run-tool",
    toolCallId: "tool-1"
  });

  assert.equal(machine.snapshot().openToolCallCount, 0);
});

test("Run 状态机拒绝缺少开始事件的工具结果和未返回结果的工具结束", () => {
  const missingStartMachine = createRunningMachine("run-missing-tool");
  const missingStart = missingStartMachine.apply({
    type: "tool_result",
    runId: "run-missing-tool",
    toolCallId: "tool-missing",
    output: {}
  });

  assertFailure(missingStart, "RUN_TOOL_CALL_MISSING_START");

  const missingResultMachine = createRunningMachine("run-missing-result");

  applyOk(missingResultMachine, {
    type: "tool_call_start",
    runId: "run-missing-result",
    toolCallId: "tool-open",
    name: "file.read",
    permission: "read",
    input: {}
  });

  const missingResult = missingResultMachine.apply({
    type: "tool_call_done",
    runId: "run-missing-result",
    toolCallId: "tool-open"
  });

  assertFailure(missingResult, "RUN_TOOL_CALL_RESULT_REQUIRED");
});

test("Run 状态机支持取消竞争以 cancelled 终态收口", () => {
  const machine = createRunningMachine("run-cancel");

  applyOk(machine, {
    type: "error",
    runId: "run-cancel",
    message: "用户取消了本次运行。"
  });
  applyOk(machine, {
    type: "run_done",
    runId: "run-cancel",
    status: "cancelled"
  });

  assert.equal(machine.snapshot().state, "terminal");
  assert.equal(machine.snapshot().terminalStatus, "cancelled");
});

test("Run 状态机在 Runtime 异常后推断 failed 终态", () => {
  const machine = createRunningMachine("run-failed");

  applyAll(machine, [
    {
      type: "error",
      runId: "run-failed",
      message: "provider 断流。"
    },
    { type: "run_done", runId: "run-failed" }
  ]);

  assert.equal(machine.snapshot().state, "terminal");
  assert.equal(machine.snapshot().terminalStatus, "failed");
});

function createRunningMachine(runId: string) {
  const machine = createRunStateMachine();

  applyAll(machine, [
    { type: "run_start", runId },
    { type: "model_request_start", runId }
  ]);

  return machine;
}

function applyAll(
  machine: ReturnType<typeof createRunStateMachine>,
  events: AgentRunEvent[]
): void {
  for (const event of events) {
    applyOk(machine, event);
  }
}

function applyOk(
  machine: ReturnType<typeof createRunStateMachine>,
  event: AgentRunEvent
): void {
  const result = machine.apply(event);

  if (!result.ok) {
    assert.fail(`${result.error.code}: ${result.error.message}`);
  }
}

function assertFailure(
  result: RunStateMachineResult,
  code: RunStateMachineErrorCode
): void {
  assert.equal(result.ok, false);

  if (!result.ok) {
    assert.equal(result.error.code, code);
  }
}
