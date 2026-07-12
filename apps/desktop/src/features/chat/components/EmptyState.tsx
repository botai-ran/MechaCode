import { memo } from "react";

type EmptyStateProps = {
  onNewChat: () => void;
};

export const EmptyState = memo(function EmptyState({
  onNewChat
}: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">
        <svg
          width="48"
          height="48"
          viewBox="0 0 48 48"
          fill="none"
          aria-hidden="true"
        >
          <rect
            x="4"
            y="4"
            width="40"
            height="40"
            rx="8"
            stroke="#cbd5e1"
            strokeWidth="2"
          />
          <path
            d="M16 20h16M16 28h10"
            stroke="#94a3b8"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <circle cx="32" cy="32" r="8" fill="#e2e8f0" />
          <path
            d="M32 28v8M28 32h8"
            stroke="#64748b"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <h2 className="empty-state-title">开始新会话</h2>
      <p className="empty-state-desc">
        输入任务描述，Agent 将帮你完成代码分析、文件操作等任务。
      </p>
      <button className="empty-state-action" type="button" onClick={onNewChat}>
        新建会话
      </button>
    </div>
  );
});
