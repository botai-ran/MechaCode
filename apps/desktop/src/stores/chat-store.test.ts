import assert from "node:assert/strict";
import test from "node:test";

import { useChatStore } from "./chat-store";
import type { ChatMessage } from "../features/chat/types";

test("chat store 可以创建新会话并继承默认工作区", () => {
  resetStore();
  const state = useChatStore.getState();

  state.setDefaultWorkspaceRoot("D:/Study/Project/MechaCode");
  state.newConversation();

  const nextState = useChatStore.getState();
  const active = nextState.conversations.find(
    (conversation) => conversation.id === nextState.activeConversationId
  );

  if (!active) {
    throw new Error("新建会话后必须存在活动会话。");
  }

  assert.equal(active.workspaceRoot, "D:/Study/Project/MechaCode");
  assert.equal(nextState.draft, "");
  assert.equal(nextState.runStatus, "idle");
});

test("chat store 可以合并文本增量并标记工具失败", () => {
  resetStore();
  const conversationId = "current";
  const messageId = "assistant-1";
  const messages: ChatMessage[] = [
    {
      id: messageId,
      role: "assistant",
      content: ""
    }
  ];

  useChatStore.getState().updateConversationMessages(conversationId, () => messages);
  useChatStore.getState().processTextDelta(conversationId, messageId, "你好");
  useChatStore.getState().processToolCallStart(conversationId, messageId, {
    id: "tool-1",
    name: "write_file",
    permission: "write",
    input: { path: "note.txt" }
  });
  useChatStore.getState().processToolResult(conversationId, "tool-1", {
    ok: false,
    error: "默认安全策略已拒绝写入能力。"
  });

  const [message] = useChatStore.getState().conversations[0]?.messages ?? [];
  const [toolCall] = message?.toolCalls ?? [];

  assert.equal(message?.content, "你好");
  assert.equal(toolCall?.status, "failed");
});

test("chat store 在文本增量缺少目标消息时会补齐 assistant 消息", () => {
  resetStore();

  useChatStore.getState().processTextDelta("current", "assistant-late", "迟到的回复");

  const [message] = useChatStore.getState().conversations[0]?.messages ?? [];

  assert.equal(message?.id, "assistant-late");
  assert.equal(message?.role, "assistant");
  assert.equal(message?.content, "迟到的回复");
});

test("chat store 默认安全快照保持默认拒绝", () => {
  resetStore();
  const snapshot = useChatStore.getState().securitySnapshot;

  assert.equal(snapshot.mode, "default_deny");
  assert.equal(snapshot.read, true);
  assert.equal(snapshot.write, false);
  assert.equal(snapshot.command, false);
  assert.equal(snapshot.network, false);
  assert.equal(snapshot.sensitiveFileProtection, true);
});

function resetStore(): void {
  useChatStore.setState({
    conversations: [
      {
        id: "current",
        title: "新会话",
        updatedAt: "刚刚",
        status: "就绪",
        messages: [],
        workspaceRoot: ""
      }
    ],
    activeConversationId: "current",
    draft: "",
    provider: "openai",
    availableProviders: ["openai"],
    isSending: false,
    runStatus: "idle",
    errorMessage: null,
    defaultWorkspaceRoot: "",
    securitySnapshot: {
      mode: "default_deny",
      policyVersion: "default-deny-v0",
      read: true,
      write: false,
      command: false,
      network: false,
      sensitiveFileProtection: true
    }
  });
}
