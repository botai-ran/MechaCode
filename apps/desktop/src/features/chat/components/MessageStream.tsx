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
  }, [visibleMessages.length, isSending]);

  return (
    <div className="message-stream" ref={streamRef}>
      {visibleMessages.map((message) => (
        <article className={`message ${message.role}`} key={message.id}>
          <span className="message-role">
            {message.role === "assistant" ? "助手" : "你"}
          </span>
          <div className="message-content">{message.content}</div>
        </article>
      ))}
      {isSending ? (
        <article className="message assistant is-pending" aria-live="polite">
          <span className="message-role">助手</span>
          <div className="message-content">正在调用模型和工具，请稍候...</div>
        </article>
      ) : null}
    </div>
  );
}
