import { memo, useEffect, useRef, useState } from "react";
import { List, useDynamicRowHeight, useListCallbackRef } from "react-window";
import type { RowComponentProps } from "react-window";
import type { ChatMessage } from "../types";
import { MessageCard } from "./MessageCard";

type MessageStreamProps = {
  messages: ChatMessage[];
  isSending: boolean;
};

type MessageRowProps = {
  messages: ChatMessage[];
  isSending: boolean;
};

export const MessageStream = memo(function MessageStream({
  messages,
  isSending
}: MessageStreamProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState(0);
  const [listRef, setListRef] = useListCallbackRef();
  const dynamicRowHeight = useDynamicRowHeight({ defaultRowHeight: 120 });

  const visibleMessages = messages.filter((m) => m.role !== "system");

  // Measure container height
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (listRef && visibleMessages.length > 0) {
      listRef.scrollToRow({
        index: visibleMessages.length - 1,
        align: "end",
        behavior: "auto"
      });
    }
  }, [visibleMessages.length, listRef]);

  // Fallback render when container height isn't measured yet
  if (containerHeight === 0) {
    return (
      <div className="message-stream" ref={containerRef}>
        {visibleMessages.map((message) => (
          <MessageCard
            key={message.id}
            message={message}
            isStreaming={false}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="message-stream" ref={containerRef}>
      <List
        listRef={setListRef}
        rowCount={visibleMessages.length}
        rowHeight={dynamicRowHeight}
        rowComponent={MessageRow}
        rowProps={
          { messages: visibleMessages, isSending } satisfies MessageRowProps
        }
        style={{ height: containerHeight, width: "100%" }}
        overscanCount={3}
      />
    </div>
  );
});

function MessageRow({
  index,
  style,
  messages,
  isSending
}: RowComponentProps<MessageRowProps>) {
  const message = messages[index];
  const isLastAssistant =
    isSending &&
    message.role === "assistant" &&
    index === messages.length - 1;

  return (
    <div style={style}>
      <MessageCard message={message} isStreaming={isLastAssistant} />
    </div>
  );
}
