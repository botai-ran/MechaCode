import { useEffect, useState } from "react";
import { getAgentConfig, startAgentRun } from "./features/chat/agent-client";
import { ChatPanel } from "./features/chat/components/ChatPanel";
import { ConversationSidebar } from "./features/chat/components/ConversationSidebar";
import type {
  AgentRunStatus,
  ChatMessage,
  ConversationState,
  RuntimeProviderId
} from "./features/chat/types";

const initialConversation: ConversationState = {
  id: "current",
  title: "新会话",
  updatedAt: "刚刚",
  status: "就绪",
  messages: [],
  workspaceRoot: ""
};

function formatErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const normalizedMessage = message.replace(/^Error:\s*/i, "");

  return normalizedMessage.startsWith("错误：")
    ? normalizedMessage
    : `错误：${normalizedMessage}`;
}

function isFailedToolOutput(output: unknown): boolean {
  return (
    output !== null &&
    typeof output === "object" &&
    "ok" in output &&
    (output as { ok?: unknown }).ok === false
  );
}

function createConversation(workspaceRoot: string): ConversationState {
  return {
    id: crypto.randomUUID(),
    title: "新会话",
    updatedAt: "刚刚",
    status: "就绪",
    messages: [],
    workspaceRoot
  };
}

function createConversationTitle(content: string): string {
  const normalized = content.replace(/\s+/g, " ").trim();

  return normalized.length > 24 ? `${normalized.slice(0, 24)}...` : normalized;
}

function App() {
  const [conversationStates, setConversationStates] = useState<
    ConversationState[]
  >([initialConversation]);
  const [activeConversationId, setActiveConversationId] = useState(
    initialConversation.id
  );
  const [draft, setDraft] = useState("");
  const [provider, setProvider] = useState<RuntimeProviderId>("openai");
  const [availableProviders, setAvailableProviders] = useState<RuntimeProviderId[]>([
    "openai"
  ]);
  const [isSending, setIsSending] = useState(false);
  const [runStatus, setRunStatus] = useState<AgentRunStatus>("idle");
  const [defaultWorkspaceRoot, setDefaultWorkspaceRoot] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const activeConversation =
    conversationStates.find(
      (conversation) => conversation.id === activeConversationId
    ) ??
    conversationStates[0] ??
    initialConversation;

  useEffect(() => {
    let isMounted = true;

    getAgentConfig()
      .then((config) => {
        if (!isMounted) {
          return;
        }

        setAvailableProviders(config.availableProviders);
        setDefaultWorkspaceRoot(config.defaultWorkspaceRoot);
        setConversationStates((currentConversations) =>
          currentConversations.map((conversation) =>
            conversation.workspaceRoot
              ? conversation
              : {
                  ...conversation,
                  workspaceRoot: config.defaultWorkspaceRoot
                }
          )
        );
        setProvider((currentProvider) =>
          config.availableProviders.includes(currentProvider)
            ? currentProvider
            : config.defaultProvider
        );
      })
      .catch((error) => {
        if (isMounted) {
          setErrorMessage(formatErrorMessage(error));
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  function handleNewConversation() {
    if (isSending) {
      return;
    }

    const conversation = createConversation(
      activeConversation?.workspaceRoot || defaultWorkspaceRoot
    );

    setConversationStates((currentConversations) => [
      conversation,
      ...currentConversations
    ]);
    setActiveConversationId(conversation.id);
    setDraft("");
    setErrorMessage(null);
    setRunStatus("idle");
  }

  function handleSelectConversation(conversationId: string) {
    if (isSending) {
      return;
    }

    setActiveConversationId(conversationId);
    setDraft("");
    setErrorMessage(null);
    setRunStatus("idle");
  }

  function handleWorkspaceRootChange(workspaceRoot: string) {
    setConversationStates((currentConversations) =>
      currentConversations.map((conversation) =>
        conversation.id === activeConversationId
          ? {
              ...conversation,
              workspaceRoot
            }
          : conversation
      )
    );
  }

  function updateConversationMessages(
    conversationId: string,
    updater: (messages: ChatMessage[]) => ChatMessage[]
  ) {
    setConversationStates((currentConversations) =>
      currentConversations.map((conversation) =>
        conversation.id === conversationId
          ? {
              ...conversation,
              messages: updater(conversation.messages)
            }
          : conversation
      )
    );
  }

  function updateConversationStatus(
    conversationId: string,
    status: string
  ) {
    setConversationStates((currentConversations) =>
      currentConversations.map((conversation) =>
        conversation.id === conversationId
          ? {
              ...conversation,
              status,
              updatedAt: "刚刚"
            }
          : conversation
      )
    );
  }

  async function handleSubmitMessage() {
    const nextMessage = draft.trim();
    const runConversation = activeConversation;
    const nextWorkspaceRoot = runConversation?.workspaceRoot.trim() ?? "";

    if (!runConversation || !nextMessage || isSending) {
      return;
    }

    if (!nextWorkspaceRoot) {
      setErrorMessage("错误：Agent 工作区不能为空。");
      return;
    }

    const runId = crypto.randomUUID();
    const assistantMessageId = crypto.randomUUID();
    const runConversationId = runConversation.id;
    const shouldGenerateTitle = !runConversation.messages.some(
      (message) => message.role === "user"
    );
    const nextMessages: ChatMessage[] = [
      ...runConversation.messages,
      {
        id: crypto.randomUUID(),
        role: "user",
        content: nextMessage
      }
    ];
    const optimisticMessages: ChatMessage[] = [
      ...nextMessages,
      {
        id: assistantMessageId,
        role: "assistant",
        content: ""
      }
    ];

    setConversationStates((currentConversations) =>
      currentConversations.map((conversation) =>
        conversation.id === runConversationId
          ? {
              ...conversation,
              title: shouldGenerateTitle
                ? createConversationTitle(nextMessage)
                : conversation.title,
              updatedAt: "刚刚",
              status: "运行中",
              workspaceRoot: nextWorkspaceRoot,
              messages: optimisticMessages
            }
          : conversation
      )
    );
    setDraft("");
    setErrorMessage(null);
    setIsSending(true);
    setRunStatus("thinking");
    let runHadError = false;
    let receivedText = false;
    let activeAssistantMessageId: string = assistantMessageId;

    try {
      await startAgentRun({
        provider,
        messages: nextMessages,
        runId,
        messageId: assistantMessageId,
        workspaceRoot: nextWorkspaceRoot,
        onEvent: (event) => {
          if (event.type === "run_start" || event.type === "model_request_start") {
            setRunStatus("thinking");
            updateConversationStatus(runConversationId, "思考中");
          }

          if (event.type === "message_start") {
            activeAssistantMessageId = event.messageId;
            setRunStatus("generating");
            updateConversationMessages(runConversationId, (currentMessages) =>
              currentMessages.some((message) => message.id === event.messageId)
                ? currentMessages
                : [
                    ...currentMessages,
                    {
                      id: event.messageId,
                      role: "assistant",
                      content: ""
                    }
                  ]
            );
          }

          if (event.type === "text_delta") {
            setRunStatus("generating");
            updateConversationStatus(runConversationId, "生成中");
            if (event.text.length > 0) {
              receivedText = true;
            }

            updateConversationMessages(runConversationId, (currentMessages) =>
              currentMessages.map((message) =>
                message.id === event.messageId
                  ? {
                      ...message,
                      content: message.content + event.text
                    }
                  : message
              )
            );
          }

          if (event.type === "tool_call_start") {
            setRunStatus("calling_tool");
            updateConversationStatus(runConversationId, "调用工具");
            updateConversationMessages(runConversationId, (currentMessages) =>
              currentMessages.map((message) =>
                message.id === activeAssistantMessageId
                  ? {
                      ...message,
                      toolCalls: [
                        ...(message.toolCalls ?? []),
                        {
                          id: event.toolCallId,
                          name: event.name,
                          permission: event.permission,
                          input: event.input,
                          status: "running"
                        }
                      ]
                    }
                  : message
              )
            );
          }

          if (event.type === "tool_result") {
            updateConversationMessages(runConversationId, (currentMessages) =>
              currentMessages.map((message) => ({
                ...message,
                toolCalls: message.toolCalls?.map((toolCall) =>
                  toolCall.id === event.toolCallId
                    ? {
                        ...toolCall,
                        output: event.output,
                        status: isFailedToolOutput(event.output) ? "failed" : toolCall.status
                      }
                    : toolCall
                )
              }))
            );
          }

          if (event.type === "tool_call_done") {
            updateConversationMessages(runConversationId, (currentMessages) =>
              currentMessages.map((message) => ({
                ...message,
                toolCalls: message.toolCalls?.map((toolCall) =>
                  toolCall.id === event.toolCallId && toolCall.status === "running"
                    ? {
                        ...toolCall,
                        status: "completed"
                      }
                    : toolCall
                )
              }))
            );
          }

          if (event.type === "error") {
            runHadError = true;
            setRunStatus("error");
            updateConversationStatus(runConversationId, "出错");
            setErrorMessage(formatErrorMessage(event.message));
            setIsSending(false);
          }

          if (event.type === "run_done") {
            setRunStatus(runHadError ? "error" : "completed");
            updateConversationStatus(runConversationId, runHadError ? "出错" : "已完成");
            setIsSending(false);
          }
        }
      });
    } catch (error) {
      runHadError = true;
      setRunStatus("error");
      updateConversationStatus(runConversationId, "出错");
      setErrorMessage(formatErrorMessage(error));
    } finally {
      updateConversationMessages(runConversationId, (currentMessages) =>
        currentMessages.flatMap((message) => {
          if (
            message.id !== assistantMessageId ||
            message.content ||
            (message.toolCalls?.length ?? 0) > 0
          ) {
            return [message];
          }

          if (receivedText) {
            return [];
          }

          return [
            {
              ...message,
              isSynthetic: true,
              content: runHadError
                ? "运行失败，未收到模型回复。"
                : "模型返回了空回复。"
            }
          ];
        })
      );
      setIsSending(false);
      setRunStatus((currentStatus) =>
        currentStatus === "error" ? currentStatus : "completed"
      );
      updateConversationStatus(runConversationId, runHadError ? "出错" : "已完成");
    }
  }

  return (
    <main className="app-shell">
      <ConversationSidebar
        conversations={conversationStates}
        activeConversationId={activeConversationId}
        disabled={isSending}
        onNewConversation={handleNewConversation}
        onSelectConversation={handleSelectConversation}
      />

      <ChatPanel
        conversation={activeConversation}
        messages={activeConversation?.messages ?? []}
        draft={draft}
        errorMessage={errorMessage}
        isSending={isSending}
        runStatus={runStatus}
        workspaceRoot={activeConversation?.workspaceRoot ?? ""}
        availableProviders={availableProviders}
        provider={provider}
        onDraftChange={setDraft}
        onWorkspaceRootChange={handleWorkspaceRootChange}
        onProviderChange={setProvider}
        onSubmitMessage={handleSubmitMessage}
      />
    </main>
  );
}

export default App;
