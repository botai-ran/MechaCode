import { useEffect, useState } from "react";
import { getAgentConfig, startAgentRun } from "./features/chat/agent-client";
import { ChatPanel } from "./features/chat/components/ChatPanel";
import { ConversationSidebar } from "./features/chat/components/ConversationSidebar";
import { conversations, initialMessages } from "./features/chat/mock-data";
import type {
  ChatMessage,
  Conversation,
  RuntimeProviderId
} from "./features/chat/types";

const emptyConversation: Conversation = {
  id: "current",
  title: "新会话",
  updatedAt: "刚刚",
  status: "就绪"
};

function formatErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const normalizedMessage = message.replace(/^Error:\s*/i, "");

  return normalizedMessage.startsWith("错误：")
    ? normalizedMessage
    : `错误：${normalizedMessage}`;
}

function App() {
  const [activeConversationId, setActiveConversationId] = useState(
    conversations[0]?.id ?? ""
  );
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [provider, setProvider] = useState<RuntimeProviderId>("openai");
  const [availableProviders, setAvailableProviders] = useState<RuntimeProviderId[]>([
    "openai"
  ]);
  const [isSending, setIsSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const activeConversation =
    conversations.find((conversation) => conversation.id === activeConversationId) ??
    emptyConversation;

  useEffect(() => {
    let isMounted = true;

    getAgentConfig()
      .then((config) => {
        if (!isMounted) {
          return;
        }

        setAvailableProviders(config.availableProviders);
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

  async function handleSubmitMessage() {
    const nextMessage = draft.trim();
    if (!nextMessage || isSending) {
      return;
    }

    const runId = crypto.randomUUID();
    const assistantMessageId = crypto.randomUUID();
    const nextMessages: ChatMessage[] = [
      ...messages,
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

    setMessages(optimisticMessages);
    setDraft("");
    setErrorMessage(null);
    setIsSending(true);
    let runHadError = false;
    let receivedText = false;

    try {
      await startAgentRun({
        provider,
        messages: nextMessages,
        runId,
        messageId: assistantMessageId,
        onEvent: (event) => {
          if (event.type === "message_start") {
            setMessages((currentMessages) =>
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
            if (event.text.length > 0) {
              receivedText = true;
            }

            setMessages((currentMessages) =>
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

          if (event.type === "error") {
            runHadError = true;
            setErrorMessage(formatErrorMessage(event.message));
            setIsSending(false);
          }

          if (event.type === "run_done") {
            setIsSending(false);
          }
        }
      });
    } catch (error) {
      runHadError = true;
      setErrorMessage(formatErrorMessage(error));
    } finally {
      setMessages((currentMessages) =>
        currentMessages.flatMap((message) => {
          if (message.id !== assistantMessageId || message.content) {
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
    }
  }

  return (
    <main className="app-shell">
      <ConversationSidebar
        conversations={conversations}
        activeConversationId={activeConversationId}
        onSelectConversation={setActiveConversationId}
      />

      <ChatPanel
        conversation={activeConversation}
        messages={messages}
        draft={draft}
        errorMessage={errorMessage}
        isSending={isSending}
        availableProviders={availableProviders}
        provider={provider}
        onDraftChange={setDraft}
        onProviderChange={setProvider}
        onSubmitMessage={handleSubmitMessage}
      />
    </main>
  );
}

export default App;
