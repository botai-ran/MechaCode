import type { FormEvent, KeyboardEvent } from "react";

type MessageComposerProps = {
  draft: string;
  errorMessage: string | null;
  isSending: boolean;
  workspaceRoot: string;
  onDraftChange: (draft: string) => void;
  onWorkspaceRootChange: (workspaceRoot: string) => void;
  onSubmit: () => void;
};

export function MessageComposer({
  draft,
  errorMessage,
  isSending,
  workspaceRoot,
  onDraftChange,
  onWorkspaceRootChange,
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
      <label className="workspace-control">
        <span>Agent 工作区</span>
        <input
          value={workspaceRoot}
          disabled={isSending}
          onChange={(event) => onWorkspaceRootChange(event.target.value)}
          placeholder="输入 Agent 可访问的工作区绝对路径"
          aria-label="Agent 工作区"
        />
      </label>
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
