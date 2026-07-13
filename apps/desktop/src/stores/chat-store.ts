import { create } from "zustand";
import type {
  AgentRunStatus,
  ChatMessage,
  ConversationState,
  RuntimeCapabilitySnapshot,
  RuntimeProviderId,
  ToolPermissionCategory
} from "../features/chat/types";

// --------------- State ---------------

type ChatState = {
  conversations: ConversationState[];
  activeConversationId: string;
  draft: string;
  provider: RuntimeProviderId;
  availableProviders: RuntimeProviderId[];
  isSending: boolean;
  runStatus: AgentRunStatus;
  errorMessage: string | null;
  defaultWorkspaceRoot: string;
  securitySnapshot: RuntimeCapabilitySnapshot;
};

type ChatActions = {
  setDraft: (draft: string) => void;
  setProvider: (provider: RuntimeProviderId) => void;
  setRunStatus: (status: AgentRunStatus) => void;
  setErrorMessage: (message: string | null) => void;
  setIsSending: (sending: boolean) => void;
  setAvailableProviders: (providers: RuntimeProviderId[]) => void;
  setDefaultWorkspaceRoot: (root: string) => void;
  setSecuritySnapshot: (snapshot: RuntimeCapabilitySnapshot) => void;

  newConversation: () => void;
  selectConversation: (id: string) => void;
  updateConversationMessages: (
    id: string,
    updater: (messages: ChatMessage[]) => ChatMessage[]
  ) => void;
  updateConversationStatus: (id: string, status: string) => void;
  setWorkspaceRoot: (id: string, root: string) => void;

  /** 合并 3 次更新为单次 set 的 text_delta 处理器 */
  processTextDelta: (
    conversationId: string,
    messageId: string,
    text: string
  ) => void;

  /** 合并状态 + 消息更新的 tool_call_start 处理器 */
  processToolCallStart: (
    conversationId: string,
    messageId: string,
    toolCall: {
      id: string;
      name: string;
      permission: ToolPermissionCategory;
      input: unknown;
    }
  ) => void;

  /** 合并状态 + 消息更新的 tool_result 处理器 */
  processToolResult: (
    conversationId: string,
    toolCallId: string,
    output: unknown
  ) => void;

  /** 合并状态 + 消息更新的 tool_call_done 处理器 */
  processToolCallDone: (
    conversationId: string,
    toolCallId: string
  ) => void;
};

// --------------- Helpers ---------------

function createConversationList(): ConversationState[] {
  return [
    {
      id: "current",
      title: "新会话",
      updatedAt: "刚刚",
      status: "就绪",
      messages: [],
      workspaceRoot: ""
    }
  ];
}

function createConversationState(workspaceRoot: string): ConversationState {
  return {
    id: crypto.randomUUID(),
    title: "新会话",
    updatedAt: "刚刚",
    status: "就绪",
    messages: [],
    workspaceRoot
  };
}

function isFailedToolOutput(output: unknown): boolean {
  return (
    output !== null &&
    typeof output === "object" &&
    "ok" in output &&
    (output as { ok?: unknown }).ok === false
  );
}

function appendTextDeltaToConversation(
  conversation: ConversationState,
  messageId: string,
  text: string
): ConversationState {
  const hasTargetMessage = conversation.messages.some((m) => m.id === messageId);

  return {
    ...conversation,
    status: "生成中",
    messages: hasTargetMessage
      ? conversation.messages.map((m) =>
          m.id === messageId
            ? { ...m, content: m.content + text }
            : m
        )
      : [
          ...conversation.messages,
          {
            id: messageId,
            role: "assistant",
            content: text
          }
        ]
  };
}

// --------------- Store ---------------

export const useChatStore = create<ChatState & ChatActions>()((set) => ({
  // ---- State ----
  conversations: createConversationList(),
  activeConversationId: "current",
  draft: "",
  provider: "openai",
  availableProviders: ["openai"],
  isSending: false,
  runStatus: "idle" as AgentRunStatus,
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
  },

  // ---- Simple setters ----
  setDraft: (draft) => set({ draft }),
  setProvider: (provider) => set({ provider }),
  setRunStatus: (runStatus) => set({ runStatus }),
  setErrorMessage: (errorMessage) => set({ errorMessage }),
  setIsSending: (isSending) => set({ isSending }),
  setAvailableProviders: (availableProviders) => set({ availableProviders }),
  setDefaultWorkspaceRoot: (defaultWorkspaceRoot) => set({ defaultWorkspaceRoot }),
  setSecuritySnapshot: (securitySnapshot) => set({ securitySnapshot }),

  // ---- Conversation management ----
  newConversation: () =>
    set((state) => {
      const conversation = createConversationState(
        state.defaultWorkspaceRoot
      );
      return {
        conversations: [conversation, ...state.conversations],
        activeConversationId: conversation.id,
        draft: "",
        errorMessage: null,
        runStatus: "idle" as AgentRunStatus
      };
    }),

  selectConversation: (id) =>
    set({
      activeConversationId: id,
      draft: "",
      errorMessage: null,
      runStatus: "idle" as AgentRunStatus
    }),

  updateConversationMessages: (id, updater) =>
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === id ? { ...c, messages: updater(c.messages) } : c
      )
    })),

  updateConversationStatus: (id, status) =>
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === id ? { ...c, status, updatedAt: "刚刚" } : c
      )
    })),

  setWorkspaceRoot: (id, root) =>
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === id ? { ...c, workspaceRoot: root } : c
      )
    })),

  // ---- Composite actions for event batching ----
  processTextDelta: (conversationId, messageId, text) =>
    set((state) => ({
      runStatus: "generating" as AgentRunStatus,
      conversations: state.conversations.map((c) =>
        c.id === conversationId
          ? appendTextDeltaToConversation(c, messageId, text)
          : c
      )
    })),

  processToolCallStart: (conversationId, messageId, toolCall) =>
    set((state) => ({
      runStatus: "calling_tool" as AgentRunStatus,
      conversations: state.conversations.map((c) =>
        c.id === conversationId
          ? {
              ...c,
              status: "调用工具",
              messages: c.messages.map((m) =>
                m.id === messageId
                  ? {
                      ...m,
                      toolCalls: [
                        ...(m.toolCalls ?? []),
                        {
                          id: toolCall.id,
                          name: toolCall.name,
                          permission: toolCall.permission,
                          input: toolCall.input,
                          status: "running" as const
                        }
                      ]
                    }
                  : m
              )
            }
          : c
      )
    })),

  processToolResult: (conversationId, toolCallId, output) =>
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === conversationId
          ? {
              ...c,
              messages: c.messages.map((m) => ({
                ...m,
                toolCalls: m.toolCalls?.map((tc) =>
                  tc.id === toolCallId
                    ? {
                        ...tc,
                        output,
                        status: isFailedToolOutput(output)
                          ? ("failed" as const)
                          : tc.status
                      }
                    : tc
                )
              }))
            }
          : c
      )
    })),

  processToolCallDone: (conversationId, toolCallId) =>
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === conversationId
          ? {
              ...c,
              messages: c.messages.map((m) => ({
                ...m,
                toolCalls: m.toolCalls?.map((tc) =>
                  tc.id === toolCallId && tc.status === "running"
                    ? { ...tc, status: "completed" as const }
                    : tc
                )
              }))
            }
          : c
      )
    }))
}));

// --------------- Selectors ---------------

export function useActiveConversation(): ConversationState | undefined {
  return useChatStore((state) => {
    const conversation =
      state.conversations.find(
        (c) => c.id === state.activeConversationId
      ) ?? state.conversations[0];
    return conversation;
  });
}

export function useConversationSummaries(): ConversationState[] {
  return useChatStore((state) => state.conversations);
}
