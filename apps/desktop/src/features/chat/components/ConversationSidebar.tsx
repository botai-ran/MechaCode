import type { Conversation } from "../types";

type ConversationSidebarProps = {
  conversations: Conversation[];
  activeConversationId: string;
  onSelectConversation: (conversationId: string) => void;
};

export function ConversationSidebar({
  conversations,
  activeConversationId,
  onSelectConversation
}: ConversationSidebarProps) {
  return (
    <aside className="conversation-sidebar" aria-label="会话记录">
      <div className="sidebar-header">
        <button className="new-chat-button" type="button">
          <span aria-hidden="true">+</span>
          新建会话
        </button>
      </div>

      <nav className="conversation-list" aria-label="历史会话">
        {conversations.map((conversation) => (
          <button
            className={
              conversation.id === activeConversationId
                ? "conversation-item is-active"
                : "conversation-item"
            }
            key={conversation.id}
            type="button"
            onClick={() => onSelectConversation(conversation.id)}
          >
            <span className="conversation-title">{conversation.title}</span>
            <span className="conversation-meta">
              <span>{conversation.updatedAt}</span>
              <span>{conversation.status}</span>
            </span>
          </button>
        ))}
      </nav>
    </aside>
  );
}
