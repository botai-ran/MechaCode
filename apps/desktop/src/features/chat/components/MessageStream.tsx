import { useEffect, useRef } from "react";
import type { ChatMessage } from "../types";

type MessageStreamProps = {
  messages: ChatMessage[];
  isSending: boolean;
};

export function MessageStream({ messages, isSending }: MessageStreamProps) {
  const streamRef = useRef<HTMLDivElement>(null);
  const visibleMessages = messages.filter((message) => message.role !== "system");

  useEffect(() => {
    const stream = streamRef.current;

    if (stream) {
      stream.scrollTop = stream.scrollHeight;
    }
  }, [visibleMessages, isSending]);

  return (
    <div className="message-stream" ref={streamRef}>
      {visibleMessages.map((message) => (
        <article
          className={`message ${message.role}${
            isSending && message.role === "assistant" && !message.content
              ? " is-pending"
              : ""
          }`}
          key={message.id}
        >
          <span className="message-role">
            {message.role === "assistant" ? "助手" : "你"}
          </span>
          <div className="message-content">
            {message.content || "正在生成回复..."}
          </div>
        </article>
      ))}
    </div>
  );
}
