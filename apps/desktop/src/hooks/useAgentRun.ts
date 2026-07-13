import { useCallback, useRef } from "react";
import {
  cancelAgentRun,
  resolveAgentToolApproval,
  startAgentRun
} from "../features/chat/agent-client";
import type { ChatMessage } from "../features/chat/types";
import { useChatStore } from "../stores/chat-store";

type FinalRunStatus = "completed" | "failed" | "cancelled" | "interrupted";

function formatErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const normalizedMessage = message.replace(/^Error:\s*/i, "");
  return normalizedMessage.startsWith("错误：")
    ? normalizedMessage
    : `错误：${normalizedMessage}`;
}

export function useAgentRun() {
  const isSending = useChatStore((state) => state.isSending);
  const runStatus = useChatStore((state) => state.runStatus);
  const errorMessage = useChatStore((state) => state.errorMessage);
  const activeRunIdRef = useRef<string | null>(null);

  const startRun = useCallback(async (draft: string) => {
    const state = useChatStore.getState();
    const runConversation = state.conversations.find(
      (c) => c.id === state.activeConversationId
    );
    const nextWorkspaceRoot = runConversation?.workspaceRoot.trim() ?? "";

    if (!runConversation || !draft.trim() || state.isSending) {
      return;
    }

    if (!nextWorkspaceRoot) {
      state.setErrorMessage("错误：Agent 工作区不能为空。");
      return;
    }

    const currentProvider = state.provider;
    const runConversationId = runConversation.id;
    const runId = crypto.randomUUID();
    const assistantMessageId = crypto.randomUUID();
    const shouldGenerateTitle = !runConversation.messages.some(
      (m) => m.role === "user"
    );

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: draft
    };

    const assistantMessage: ChatMessage = {
      id: assistantMessageId,
      role: "assistant",
      content: ""
    };

    let runHadError = false;
    let finalRunStatus: FinalRunStatus | null = null;
    let activeAssistantMessageId: string = assistantMessageId;

    // Optimistic update
    useChatStore.getState().updateConversationMessages(
      runConversationId,
      (msgs) => [...msgs, userMessage, assistantMessage]
    );
    if (shouldGenerateTitle) {
      const title =
        draft.replace(/\s+/g, " ").trim().length > 24
          ? `${draft.replace(/\s+/g, " ").trim().slice(0, 24)}...`
          : draft.replace(/\s+/g, " ").trim();
      useChatStore.getState().updateConversationStatus(
        runConversationId,
        title
      );
    }
    useChatStore.getState().updateConversationStatus(
      runConversationId,
      "运行中"
    );
    useChatStore.getState().setDraft("");
    useChatStore.getState().setErrorMessage(null);
    useChatStore.getState().setIsSending(true);
    useChatStore.getState().setRunStatus("thinking");
    activeRunIdRef.current = runId;

    try {
      await startAgentRun({
        provider: currentProvider,
        messages: [...runConversation.messages, userMessage],
        runId,
        messageId: assistantMessageId,
        workspaceRoot: nextWorkspaceRoot,
        onEvent: (event) => {
          const s = useChatStore.getState();

          if (
            event.type === "run_start" ||
            event.type === "model_request_start"
          ) {
            s.setRunStatus("thinking");
            s.updateConversationStatus(runConversationId, "思考中");
          }

          if (event.type === "message_start") {
            activeAssistantMessageId = event.messageId;
            s.setRunStatus("generating");
            s.updateConversationMessages(runConversationId, (msgs) =>
              msgs.some((m) => m.id === event.messageId)
                ? msgs
                : [
                    ...msgs,
                    {
                      id: event.messageId,
                      role: "assistant",
                      content: ""
                    }
                  ]
            );
          }

          if (event.type === "text_delta") {
            s.processTextDelta(
              runConversationId,
              event.messageId,
              event.text
            );
          }

          if (event.type === "tool_call_start") {
            s.setRunStatus("calling_tool");
            s.updateConversationStatus(runConversationId, "调用工具");
            s.updateConversationMessages(runConversationId, (msgs) =>
              msgs.map((m) =>
                m.id === activeAssistantMessageId
                  ? {
                      ...m,
                      toolCalls: [
                        ...(m.toolCalls ?? []),
                        {
                          id: event.toolCallId,
                          name: event.name,
                          permission: event.permission,
                          input: event.input,
                          status: "running" as const
                        }
                      ]
                    }
                  : m
              )
            );
          }

          if (event.type === "tool_approval_request") {
            s.setRunStatus("calling_tool");
            s.updateConversationStatus(runConversationId, "等待审批");
            s.updateConversationMessages(runConversationId, (msgs) =>
              msgs.map((m) =>
                m.id === activeAssistantMessageId
                  ? {
                      ...m,
                      toolCalls: (m.toolCalls ?? []).some(
                        (tc) => tc.id === event.toolCallId
                      )
                        ? (m.toolCalls ?? []).map((tc) =>
                            tc.id === event.toolCallId
                              ? {
                                  ...tc,
                                  approvalId: event.approvalId,
                                  approvalReason: event.reason,
                                  status: "waiting_approval" as const
                                }
                              : tc
                          )
                        : [
                            ...(m.toolCalls ?? []),
                            {
                              id: event.toolCallId,
                              name: event.name,
                              permission: event.permission,
                              input: event.input,
                              approvalId: event.approvalId,
                              approvalReason: event.reason,
                              status: "waiting_approval" as const
                            }
                          ]
                    }
                  : m
              )
            );
          }

          if (event.type === "tool_approval_resolved") {
            s.updateConversationMessages(runConversationId, (msgs) =>
              msgs.map((m) => ({
                ...m,
                toolCalls: m.toolCalls?.map((tc) =>
                  tc.id === event.toolCallId
                    ? {
                        ...tc,
                        status:
                          event.decision === "approved"
                            ? ("running" as const)
                            : ("failed" as const)
                      }
                    : tc
                )
              }))
            );
          }

          if (event.type === "tool_result") {
            s.updateConversationMessages(runConversationId, (msgs) =>
              msgs.map((m) => ({
                ...m,
                toolCalls: m.toolCalls?.map((tc) =>
                  tc.id === event.toolCallId
                    ? {
                        ...tc,
                        output: event.output,
                        status:
                          event.output !== null &&
                          typeof event.output === "object" &&
                          "ok" in (event.output as object) &&
                          (event.output as { ok?: unknown }).ok === false
                            ? ("failed" as const)
                            : tc.status
                      }
                    : tc
                )
              }))
            );
          }

          if (event.type === "tool_call_done") {
            s.updateConversationMessages(runConversationId, (msgs) =>
              msgs.map((m) => ({
                ...m,
                toolCalls: m.toolCalls?.map((tc) =>
                  tc.id === event.toolCallId && tc.status === "running"
                    ? { ...tc, status: "completed" as const }
                    : tc
                )
              }))
            );
          }

          if (event.type === "error") {
            runHadError = true;
            finalRunStatus = "failed";
            s.setRunStatus("error");
            s.updateConversationStatus(runConversationId, "出错");
            s.setErrorMessage(formatErrorMessage(event.message));
            s.setIsSending(false);
          }

          if (event.type === "run_done") {
            finalRunStatus = event.status ?? (runHadError ? "failed" : "completed");
            applyFinalRunStatus(s, runConversationId, finalRunStatus);
            s.setIsSending(false);
            activeRunIdRef.current = null;
          }
        }
      });
    } catch (error) {
      runHadError = true;
      finalRunStatus = "failed";
      useChatStore.getState().setRunStatus("error");
      useChatStore.getState().updateConversationStatus(
        runConversationId,
        "出错"
      );
      useChatStore.getState().setErrorMessage(formatErrorMessage(error));
    } finally {
      activeRunIdRef.current = null;
      const resolvedFinalStatus = finalRunStatus ?? (runHadError ? "failed" : "completed");

      useChatStore.getState().updateConversationMessages(
        runConversationId,
        (msgs) => {
          const hasLaterAssistantOutput = msgs.some(
            (m) =>
              m.id !== assistantMessageId &&
              m.role === "assistant" &&
              (m.content || (m.toolCalls?.length ?? 0) > 0)
          );

          return msgs.flatMap((m) => {
            if (
              m.id !== assistantMessageId ||
              m.content ||
              (m.toolCalls?.length ?? 0) > 0
            ) {
              return [m];
            }

            if (hasLaterAssistantOutput) {
              return [];
            }

            return [
              {
                ...m,
                isSynthetic: true as const,
                content: getEmptyAssistantMessage(resolvedFinalStatus)
              }
            ];
          });
        }
      );
      useChatStore.getState().setIsSending(false);
      applyFinalRunStatus(useChatStore.getState(), runConversationId, resolvedFinalStatus);
    }
  }, []);

  const cancelRun = useCallback(async () => {
    const runId = activeRunIdRef.current;

    if (!runId) {
      return;
    }

    const state = useChatStore.getState();
    state.setRunStatus("cancelling");
    state.setErrorMessage(null);

    try {
      await cancelAgentRun(runId);
    } catch (error) {
      state.setRunStatus("error");
      state.setErrorMessage(formatErrorMessage(error));
    }
  }, []);

  const approveToolCall = useCallback(
    async (approvalId: string, toolCallId: string, approved: boolean) => {
      const runId = activeRunIdRef.current;

      if (!runId) {
        return;
      }

      try {
        await resolveAgentToolApproval({
          runId,
          approvalId,
          toolCallId,
          decision: approved ? "approved" : "denied"
        });
      } catch (error) {
        useChatStore.getState().setErrorMessage(formatErrorMessage(error));
      }
    },
    []
  );

  return { startRun, cancelRun, approveToolCall, isSending, runStatus, errorMessage };
}

function applyFinalRunStatus(
  state: ReturnType<typeof useChatStore.getState>,
  conversationId: string,
  status: FinalRunStatus
): void {
  if (status === "completed") {
    state.setRunStatus("completed");
    state.updateConversationStatus(conversationId, "已完成");
    return;
  }

  if (status === "cancelled") {
    state.setRunStatus("cancelled");
    state.updateConversationStatus(conversationId, "已取消");
    return;
  }

  if (status === "interrupted") {
    state.setRunStatus("error");
    state.updateConversationStatus(conversationId, "已中断");
    state.setErrorMessage("错误：运行已中断。");
    return;
  }

  state.setRunStatus("error");
  state.updateConversationStatus(conversationId, "出错");
}

function getEmptyAssistantMessage(status: FinalRunStatus): string {
  if (status === "cancelled") {
    return "运行已取消。";
  }

  if (status === "interrupted") {
    return "运行已中断，未收到模型回复。";
  }

  if (status === "failed") {
    return "运行失败，未收到模型回复。";
  }

  return "模型返回了空回复。";
}
