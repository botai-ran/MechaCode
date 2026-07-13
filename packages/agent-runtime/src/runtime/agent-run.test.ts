import assert from "node:assert/strict";
import test from "node:test";

import { ToolRegistry, type AgentTool } from "@mecha/agent-tools";
import type { AgentRunEvent } from "@mecha/protocol";
import { runAgentChat } from "./agent-run.js";
import type {
  ChatInput,
  ChatOutput,
  ChatStreamEvent,
  ModelProvider
} from "../providers/index.js";

const mockProvider: ModelProvider = {
  id: "openai",
  defaultModel: "mock-model",
  async chat(): Promise<ChatOutput> {
    return {
      provider: "openai",
      model: "mock-model",
      content: "ok"
    };
  },
  async *streamChat(): AsyncIterable<ChatStreamEvent> {
    yield {
      type: "done",
      output: {
        provider: "openai",
        model: "mock-model",
        content: "ok"
      }
    };
  }
};

const toolCallingProvider: ModelProvider = {
  id: "openai",
  defaultModel: "mock-model",
  async chat(input: ChatInput): Promise<ChatOutput> {
    return createToolCallingOutput(input);
  },
  async *streamChat(input: ChatInput): AsyncIterable<ChatStreamEvent> {
    yield {
      type: "done",
      output: createToolCallingOutput(input)
    };
  }
};

const failingProvider: ModelProvider = {
  id: "openai",
  defaultModel: "mock-model",
  async chat(): Promise<ChatOutput> {
    throw new Error("provider 请求失败");
  },
  async *streamChat(): AsyncIterable<ChatStreamEvent> {
    yield {
      type: "text_delta",
      text: "partial"
    };
    throw new Error("provider 断流");
  }
};

test("Run 开始时冻结默认安全快照，并在模型请求前发出", async () => {
  const events = await collectRunEvents({
    messages: [{ role: "user", content: "hello" }]
  });

  const snapshotIndex = events.findIndex(
    (event) => event.type === "security_snapshot"
  );
  const modelRequestIndex = events.findIndex(
    (event) => event.type === "model_request_start"
  );
  const snapshotEvent = events[snapshotIndex];

  assert.equal(events[0]?.type, "run_start");
  assert.ok(snapshotIndex > 0);
  assert.ok(modelRequestIndex > snapshotIndex);
  assert.equal(snapshotEvent?.type, "security_snapshot");

  if (snapshotEvent?.type === "security_snapshot") {
    assert.equal(snapshotEvent.snapshot.mode, "default_deny");
    assert.equal(snapshotEvent.snapshot.read, true);
    assert.equal(snapshotEvent.snapshot.write, false);
    assert.equal(snapshotEvent.snapshot.command, false);
    assert.equal(snapshotEvent.snapshot.network, false);
    assert.equal(snapshotEvent.snapshot.sensitiveFileProtection, true);
    assert.match(snapshotEvent.snapshot.frozenAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
  }

  const doneEvent = events.at(-1);

  assert.equal(doneEvent?.type, "run_done");

  if (doneEvent?.type === "run_done") {
    assert.equal(doneEvent.status, "completed");
  }
});

test("Runtime 异常会以 failed 终态收口", async () => {
  const events = await collectRunEvents(
    {
      messages: [{ role: "user", content: "hello" }]
    },
    failingProvider
  );
  const errorEvent = events.find((event) => event.type === "error");
  const doneEvent = events.at(-1);

  assert.equal(errorEvent?.type, "error");
  assert.equal(doneEvent?.type, "run_done");

  if (doneEvent?.type === "run_done") {
    assert.equal(doneEvent.status, "failed");
  }
});

test("Runtime 收到用户取消信号后以 cancelled 终态收口", async () => {
  const abortController = new AbortController();
  const events: AgentRunEvent[] = [];

  for await (const event of runAgentChat(
    mockProvider,
    {
      messages: [{ role: "user", content: "hello" }]
    },
    {
      runId: "run-cancel",
      messageId: "message-cancel",
      abortSignal: abortController.signal
    }
  )) {
    events.push(event);

    if (event.type === "security_snapshot") {
      abortController.abort("user");
    }
  }

  const doneEvent = events.at(-1);

  assert.equal(doneEvent?.type, "run_done");

  if (doneEvent?.type === "run_done") {
    assert.equal(doneEvent.status, "cancelled");
  }
});

test("Runtime 在用户批准后执行被默认策略拒绝的工具", async () => {
  let runCount = 0;
  const registry = new ToolRegistry();
  const tool: AgentTool<{ value: number }, { doubled: number }> = {
    name: "dangerous_command",
    description: "测试审批工具",
    permission: "command",
    async run(input) {
      runCount += 1;
      return { doubled: input.value * 2 };
    }
  };
  const events: AgentRunEvent[] = [];

  registry.register(tool);

  for await (const event of runAgentChat(
    toolCallingProvider,
    {
      messages: [{ role: "user", content: "run tool" }]
    },
    {
      runId: "run-approval",
      messageId: "message-approval",
      createId: createSequentialId(),
      toolRegistry: registry,
      requestToolApproval: async (request) => {
        assert.equal(request.runId, "run-approval");
        assert.equal(request.toolCallId, "tool-call-approval");
        assert.equal(request.name, "dangerous_command");
        assert.equal(request.permission, "command");

        return "approved";
      }
    }
  )) {
    events.push(event);
  }

  const approvalRequest = events.find(
    (event) => event.type === "tool_approval_request"
  );
  const approvalResolved = events.find(
    (event) => event.type === "tool_approval_resolved"
  );
  const toolResult = events.find((event) => event.type === "tool_result");
  const doneEvent = events.at(-1);

  assert.equal(runCount, 1);
  assert.equal(approvalRequest?.type, "tool_approval_request");
  assert.equal(approvalResolved?.type, "tool_approval_resolved");
  assert.equal(toolResult?.type, "tool_result");

  if (approvalResolved?.type === "tool_approval_resolved") {
    assert.equal(approvalResolved.decision, "approved");
  }

  if (toolResult?.type === "tool_result") {
    assert.deepEqual(toolResult.output, {
      ok: true,
      result: { doubled: 42 }
    });
  }

  assert.equal(doneEvent?.type, "run_done");

  if (doneEvent?.type === "run_done") {
    assert.equal(doneEvent.status, "completed");
  }
});

async function collectRunEvents(
  input: ChatInput,
  provider: ModelProvider = mockProvider
): Promise<AgentRunEvent[]> {
  const events: AgentRunEvent[] = [];

  for await (const event of runAgentChat(provider, input, {
    runId: "run-test",
    messageId: "message-test"
  })) {
    events.push(event);
  }

  return events;
}

function createToolCallingOutput(input: ChatInput): ChatOutput {
  const hasToolResult = input.messages.some((message) => message.role === "tool");

  if (hasToolResult) {
    return {
      provider: "openai",
      model: "mock-model",
      content: "done"
    };
  }

  return {
    provider: "openai",
    model: "mock-model",
    content: "",
    toolCalls: [
      {
        id: "tool-call-approval",
        name: "dangerous_command",
        input: { value: 21 }
      }
    ]
  };
}

function createSequentialId(): () => string {
  let next = 0;

  return () => `generated-${++next}`;
}
