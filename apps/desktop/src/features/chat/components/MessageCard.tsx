import { memo, useMemo } from "react";
import hljs from "highlight.js";
import type { ChatMessage } from "../types";
import { ToolCallCard } from "./ToolCallCard";

type MessageCardProps = {
  message: ChatMessage;
  isStreaming?: boolean;
};

export const MessageCard = memo(function MessageCard({
  message,
  isStreaming
}: MessageCardProps) {
  const parsedContent = useMemo(
    () => renderContent(message.content),
    [message.content]
  );

  return (
    <article
      className={`message ${message.role}${
        isStreaming ? " is-pending is-streaming" : ""
      }`}
    >
      <span className="message-role">
        {message.role === "assistant" ? "助手" : "你"}
      </span>
      <div className="message-content">
        {parsedContent ||
          ((message.toolCalls?.length ?? 0) > 0
            ? "正在整理工具结果..."
            : "正在生成回复...")}
      </div>
      {message.toolCalls && message.toolCalls.length > 0 ? (
        <div className="tool-call-list" aria-label="工具调用过程">
          {message.toolCalls.map((tc) => (
            <ToolCallCard key={tc.id} toolCall={tc} />
          ))}
        </div>
      ) : null}
    </article>
  );
});

type ContentSegment =
  | { type: "text"; text: string }
  | { type: "code"; language: string; code: string };

function splitContent(content: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  const regex = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    // Text before this code block
    if (match.index > lastIndex) {
      segments.push({
        type: "text",
        text: content.slice(lastIndex, match.index)
      });
    }

    segments.push({
      type: "code",
      language: match[1] || "",
      code: match[2]
    });

    lastIndex = match.index + match[0].length;
  }

  // Remaining text
  if (lastIndex < content.length) {
    segments.push({
      type: "text",
      text: content.slice(lastIndex)
    });
  }

  return segments;
}

function renderContent(content: string): React.ReactNode {
  if (!content) return null;

  const segments = splitContent(content);

  return segments.map((segment, i) => {
    if (segment.type === "code") {
      let highlighted: string;
      try {
        highlighted = segment.language
          ? hljs.highlight(segment.code, {
              language: segment.language
            }).value
          : hljs.highlightAuto(segment.code).value;
      } catch {
        highlighted = escapeHtml(segment.code);
      }

      return (
        <pre key={i}>
          <code
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
        </pre>
      );
    }

    return <span key={i}>{segment.text}</span>;
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
