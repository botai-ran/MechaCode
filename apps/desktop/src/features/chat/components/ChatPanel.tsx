import { MessageComposer } from "./MessageComposer";
import { MessageStream } from "./MessageStream";
import type { ChatMessage, Conversation, RuntimeProviderId } from "../types";

type ChatPanelProps = {
  conversation: Conversation;
  messages: ChatMessage[];
  draft: string;
  errorMessage: string | null;
  isSending: boolean;
  availableProviders: RuntimeProviderId[];
  provider: RuntimeProviderId;
  onDraftChange: (draft: string) => void;
  onProviderChange: (provider: RuntimeProviderId) => void;
  onSubmitMessage: () => void;
};

export function ChatPanel({
  conversation,
  messages,
  draft,
  errorMessage,
  isSending,
  availableProviders,
  provider,
  onDraftChange,
  onProviderChange,
  onSubmitMessage
}: ChatPanelProps) {
  return (
    <section className="chat-panel" aria-label="当前对话">
      <header className="chat-header">
        <div className="chat-heading">
          <span className="chat-kicker">当前会话</span>
          <h1>{conversation.title}</h1>
        </div>
        <div className="chat-controls">
          <label className="provider-select">
            <span>服务商</span>
            <select
              value={provider}
              disabled={isSending}
              onChange={(event) =>
                onProviderChange(event.target.value as RuntimeProviderId)
              }
            >
              <option
                value="openai"
                disabled={!availableProviders.includes("openai")}
              >
                OpenAI
              </option>
              <option
                value="anthropic"
                disabled={!availableProviders.includes("anthropic")}
              >
                Anthropic
              </option>
              <option
                value="deepseek"
                disabled={!availableProviders.includes("deepseek")}
              >
                DeepSeek
              </option>
            </select>
          </label>
          <div
            className="chat-status"
            aria-label={`状态：${isSending ? "运行中" : conversation.status}`}
          >
            <span aria-hidden="true" />
            {isSending ? "运行中" : conversation.status}
          </div>
        </div>
      </header>

      <MessageStream messages={messages} isSending={isSending} />

      <MessageComposer
        draft={draft}
        errorMessage={errorMessage}
        isSending={isSending}
        onDraftChange={onDraftChange}
        onSubmit={onSubmitMessage}
      />
    </section>
  );
}
