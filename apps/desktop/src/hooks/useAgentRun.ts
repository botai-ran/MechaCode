import { useCallback } from "react";
import { startAgentRun } from "../features/chat/agent-client";
import type { ChatMessage } from "../features/chat/types";
import { useChatStore } from "../stores/chat-store";

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
            s.setRunStatus("error");
            s.updateConversationStatus(runConversationId, "出错");
            s.setErrorMessage(formatErrorMessage(event.message));
            s.setIsSending(false);
          }

          if (event.type === "run_done") {
            s.setRunStatus(runHadError ? "error" : "completed");
            s.updateConversationStatus(
              runConversationId,
              runHadError ? "出错" : "已完成"
            );
            s.setIsSending(false);
          }
        }
      });
    } catch (error) {
      runHadError = true;
      useChatStore.getState().setRunStatus("error");
      useChatStore.getState().updateConversationStatus(
        runConversationId,
        "出错"
      );
      useChatStore.getState().setErrorMessage(formatErrorMessage(error));
    } finally {
      useChatStore.getState().updateConversationMessages(
        runConversationId,
        (msgs) =>
          msgs.flatMap((m) => {
            if (
              m.id !== assistantMessageId ||
              m.content ||
              (m.toolCalls?.length ?? 0) > 0
            ) {
              return [m];
            }
            return [
              {
                ...m,
                isSynthetic: true as const,
                content: runHadError
                  ? "运行失败，未收到模型回复。"
                  : "模型返回了空回复。"
              }
            ];
          })
      );
      useChatStore.getState().setIsSending(false);
      useChatStore.getState().setRunStatus(
        runHadError ? "error" : "completed"
      );
      useChatStore.getState().updateConversationStatus(
        runConversationId,
        runHadError ? "出错" : "已完成"
      );
    }
  }, []);

  return { startRun, isSending, runStatus, errorMessage };
}
