import { MessageComposer } from "./MessageComposer";
import { MessageStream } from "./MessageStream";
import type {
  AgentRunStatus,
  ChatMessage,
  Conversation,
  RuntimeProviderId
} from "../types";

type ChatPanelProps = {
  conversation: Conversation;
  messages: ChatMessage[];
  draft: string;
  errorMessage: string | null;
  isSending: boolean;
  runStatus: AgentRunStatus;
  workspaceRoot: string;
  availableProviders: RuntimeProviderId[];
  provider: RuntimeProviderId;
  onDraftChange: (draft: string) => void;
  onWorkspaceRootChange: (workspaceRoot: string) => void;
  onProviderChange: (provider: RuntimeProviderId) => void;
  onSubmitMessage: () => void;
};

export function ChatPanel({
  conversation,
  messages,
  draft,
  errorMessage,
  isSending,
  runStatus,
  workspaceRoot,
  availableProviders,
  provider,
  onDraftChange,
  onWorkspaceRootChange,
  onProviderChange,
  onSubmitMessage
}: ChatPanelProps) {
  const statusText = getRunStatusText(runStatus, isSending, conversation.status);

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
            </select>
          </label>
          <div
            className={`chat-status is-${runStatus}`}
            aria-label={`状态：${statusText}`}
          >
            <span aria-hidden="true" />
            {statusText}
          </div>
        </div>
      </header>

      <MessageStream messages={messages} isSending={isSending} />

      <MessageComposer
        draft={draft}
        errorMessage={errorMessage}
        isSending={isSending}
        workspaceRoot={workspaceRoot}
        onDraftChange={onDraftChange}
        onWorkspaceRootChange={onWorkspaceRootChange}
        onSubmit={onSubmitMessage}
      />
    </section>
  );
}

function getRunStatusText(
  runStatus: AgentRunStatus,
  isSending: boolean,
  fallback: string
): string {
  if (!isSending && runStatus === "idle") {
    return fallback;
  }

  const labels: Record<AgentRunStatus, string> = {
    calling_tool: "正在调用工具",
    completed: "已完成",
    error: "出错",
    generating: "正在生成回复",
    idle: fallback,
    thinking: "正在思考"
  };

  return labels[runStatus];
}
