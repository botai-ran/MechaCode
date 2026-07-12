import assert from "node:assert/strict";
import test from "node:test";

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
});

async function collectRunEvents(input: ChatInput): Promise<AgentRunEvent[]> {
  const events: AgentRunEvent[] = [];

  for await (const event of runAgentChat(mockProvider, input, {
    runId: "run-test",
    messageId: "message-test"
  })) {
    events.push(event);
  }

  return events;
}
