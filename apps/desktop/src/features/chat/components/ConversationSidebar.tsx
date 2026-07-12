import { memo, useCallback, useState } from "react";
import type { Conversation } from "../types";

type ConversationSidebarProps = {
  conversations: Conversation[];
  activeConversationId: string;
  disabled: boolean;
  onNewConversation: () => void;
  onSelectConversation: (conversationId: string) => void;
};

export const ConversationSidebar = memo(function ConversationSidebar({
  conversations,
  activeConversationId,
  disabled,
  onNewConversation,
  onSelectConversation
}: ConversationSidebarProps) {
  const [isOpen, setIsOpen] = useState(false);

  const close = useCallback(() => setIsOpen(false), []);

  const handleNewClick = useCallback(() => {
    onNewConversation();
    close();
  }, [onNewConversation, close]);

  const handleSelect = useCallback(
    (id: string) => {
      onSelectConversation(id);
      close();
    },
    [onSelectConversation, close]
  );

  return (
    <>
      <button
        className="sidebar-toggle"
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-label={isOpen ? "关闭侧边栏" : "打开侧边栏"}
      >
        {isOpen ? "✕" : "☰"}
      </button>

      <div
        className={`sidebar-backdrop${isOpen ? " is-visible" : ""}`}
        onClick={close}
        aria-hidden="true"
      />

      <aside
        className={`conversation-sidebar${isOpen ? " is-open" : ""}`}
        aria-label="会话记录"
      >
        <div className="sidebar-header">
          <button
            className="new-chat-button"
            type="button"
            disabled={disabled}
            onClick={handleNewClick}
          >
            <span aria-hidden="true">+</span>
            新建会话
          </button>
        </div>

        <nav className="conversation-list" aria-label="历史会话">
          {conversations.map((conversation) => (
            <SidebarItem
              key={conversation.id}
              conversation={conversation}
              isActive={conversation.id === activeConversationId}
              disabled={disabled}
              onSelect={handleSelect}
            />
          ))}
        </nav>
      </aside>
    </>
  );
});

type SidebarItemProps = {
  conversation: Conversation;
  isActive: boolean;
  disabled: boolean;
  onSelect: (id: string) => void;
};

const SidebarItem = memo(function SidebarItem({
  conversation,
  isActive,
  disabled,
  onSelect
}: SidebarItemProps) {
  const handleClick = useCallback(() => {
    onSelect(conversation.id);
  }, [onSelect, conversation.id]);

  return (
    <button
      className={
        isActive ? "conversation-item is-active" : "conversation-item"
      }
      type="button"
      disabled={disabled}
      onClick={handleClick}
    >
      <span className="conversation-title">{conversation.title}</span>
      <span className="conversation-meta">
        <span>{conversation.updatedAt}</span>
        <span>{conversation.status}</span>
      </span>
    </button>
  );
});
