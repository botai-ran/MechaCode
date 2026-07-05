import { useEffect, useState } from "react";
import { getAgentConfig, sendAgentMessage } from "./features/chat/agent-client";
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
  const [provider, setProvider] = useState<RuntimeProviderId>("deepseek");
  const [availableProviders, setAvailableProviders] = useState<RuntimeProviderId[]>([
    "deepseek"
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

    const nextMessages: ChatMessage[] = [
      ...messages,
      {
        id: crypto.randomUUID(),
        role: "user",
        content: nextMessage
      }
    ];

    setMessages(nextMessages);
    setDraft("");
    setErrorMessage(null);
    setIsSending(true);

    try {
      const response = await sendAgentMessage({
        provider,
        messages: nextMessages
      });

      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: response || "模型返回了空回复。"
        }
      ]);
    } catch (error) {
      setErrorMessage(formatErrorMessage(error));
    } finally {
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
