import type { FormEvent, KeyboardEvent } from "react";

type MessageComposerProps = {
  draft: string;
  errorMessage: string | null;
  isSending: boolean;
  onDraftChange: (draft: string) => void;
  onSubmit: () => void;
};

export function MessageComposer({
  draft,
  errorMessage,
  isSending,
  onDraftChange,
  onSubmit
}: MessageComposerProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      onSubmit();
    }
  }

  return (
    <form className="composer" onSubmit={handleSubmit}>
      <textarea
        value={draft}
        disabled={isSending}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="输入任务或继续对话"
        aria-label="输入消息"
        rows={3}
      />
      {errorMessage ? (
        <p className="composer-error" role="alert">
          {errorMessage}
        </p>
      ) : null}
      <div className="composer-actions">
        <span className="composer-hint">Enter 发送，Shift + Enter 换行</span>
        <button type="submit" disabled={isSending || !draft.trim()}>
          {isSending ? "发送中" : "发送"}
        </button>
      </div>
    </form>
  );
}
