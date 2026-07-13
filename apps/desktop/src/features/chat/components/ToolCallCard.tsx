import { memo } from "react";
import type { ToolCallView, ToolCallStatus, ToolPermissionCategory } from "../types";

type ToolCallCardProps = {
  toolCall: ToolCallView;
  onResolveApproval: (
    approvalId: string,
    toolCallId: string,
    approved: boolean
  ) => void;
};

export const ToolCallCard = memo(function ToolCallCard({
  toolCall,
  onResolveApproval
}: ToolCallCardProps) {
  const isWaitingApproval =
    toolCall.status === "waiting_approval" && toolCall.approvalId;

  return (
    <section className={`tool-call is-${toolCall.status}`}>
      <header className="tool-call-header">
        <span className="tool-call-name">{toolCall.name}</span>
        <span className="tool-call-badges">
          <span className={`tool-call-permission is-${toolCall.permission}`}>
            {getToolPermissionText(toolCall.permission)}
          </span>
          <span className="tool-call-status">
            {getToolStatusText(toolCall.status)}
          </span>
        </span>
      </header>
      <p className="tool-call-summary">{summarizeToolInput(toolCall)}</p>
      {toolCall.approvalReason ? (
        <p className="tool-call-result">{toolCall.approvalReason}</p>
      ) : null}
      {isWaitingApproval ? (
        <div className="tool-call-actions">
          <button
            type="button"
            onClick={() =>
              onResolveApproval(toolCall.approvalId!, toolCall.id, true)
            }
          >
            允许
          </button>
          <button
            type="button"
            onClick={() =>
              onResolveApproval(toolCall.approvalId!, toolCall.id, false)
            }
          >
            拒绝
          </button>
        </div>
      ) : null}
      {toolCall.output !== undefined ? (
        <p className="tool-call-result">{summarizeToolOutput(toolCall)}</p>
      ) : null}
    </section>
  );
});

function getToolPermissionText(permission: ToolPermissionCategory): string {
  const labels: Record<ToolPermissionCategory, string> = {
    command: "命令",
    network: "网络",
    read: "只读",
    write: "写入"
  };
  return labels[permission];
}

function getToolStatusText(status: ToolCallStatus): string {
  const labels: Record<ToolCallStatus, string> = {
    completed: "已完成",
    failed: "失败",
    running: "执行中",
    waiting_approval: "等待审批"
  };
  return labels[status];
}

function summarizeToolInput(toolCall: ToolCallView): string {
  const input = asRecord(toolCall.input);

  if (toolCall.name === "read_file") {
    return `读取文件 ${formatField(input.path)}${formatMaxBytes(input.maxBytes)}`;
  }
  if (toolCall.name === "list_dir") {
    return `列出目录 ${formatField(input.path, ".")}`;
  }
  if (toolCall.name === "search_text") {
    return `搜索 ${formatQuoted(input.query)}，范围 ${formatField(input.path, ".")}`;
  }
  if (toolCall.name === "run_command") {
    return `执行命令 ${formatCommand(input.command, input.args)}`;
  }
  if (toolCall.name === "git_diff") {
    const target = input.path ? `，路径 ${formatField(input.path)}` : "";
    const staged = input.staged === true ? "暂存区" : "工作区";
    return `读取 Git diff（${staged}${target}）`;
  }
  if (toolCall.name === "git_status") {
    return "读取 Git 状态";
  }
  return `入参 ${formatUnknown(toolCall.input, 160)}`;
}

function summarizeToolOutput(toolCall: ToolCallView): string {
  const output = asRecord(toolCall.output);

  if (output.ok === false) {
    return `工具失败：${formatField(output.error, "未知错误")}`;
  }

  const result = asRecord(output.result ?? toolCall.output);

  if (toolCall.name === "read_file") {
    const preview = formatPreview(result.content);
    const suffix = result.truncated === true ? "，内容已截断" : "";
    return `已读取 ${formatField(result.path)}，大小 ${formatBytes(result.sizeBytes)}${suffix}${preview}`;
  }
  if (toolCall.name === "list_dir") {
    const entries = Array.isArray(result.entries) ? result.entries : [];
    const names = entries
      .slice(0, 5)
      .map((entry) => formatField(asRecord(entry).name))
      .join("、");
    const suffix = entries.length > 5 ? " 等" : "";
    return `共 ${entries.length} 项${names ? `：${names}${suffix}` : ""}`;
  }
  if (toolCall.name === "search_text") {
    const matches = Array.isArray(result.matches) ? result.matches : [];
    const firstMatch = asRecord(matches[0]);
    const location = firstMatch.path
      ? `，首个命中 ${formatField(firstMatch.path)}:${formatField(firstMatch.line)}`
      : "";
    const suffix = result.truncated === true ? "，结果已截断" : "";
    return `找到 ${matches.length} 处匹配${location}${suffix}`;
  }
  if (toolCall.name === "run_command") {
    const stdout = formatPreview(result.stdout, "stdout");
    const stderr = formatPreview(result.stderr, "stderr");
    const timedOut = result.timedOut === true ? "，已超时" : "";
    return `退出码 ${formatField(result.exitCode, "无")}${timedOut}${stdout}${stderr}`;
  }
  if (toolCall.name === "git_diff") {
    const stdout = String(result.stdout ?? "");
    const stderr = formatPreview(result.stderr, "stderr");
    const suffix = result.truncated === true ? "，输出已截断" : "";
    return stdout.trim()
      ? `diff 输出约 ${stdout.length} 字符${suffix}${stderr}`
      : `没有 diff 输出${stderr}`;
  }
  if (toolCall.name === "git_status") {
    const stdout = String(result.stdout ?? "").trim();
    const stderr = formatPreview(result.stderr, "stderr");
    return stdout ? `状态：${truncateText(stdout, 180)}${stderr}` : `工作区干净${stderr}`;
  }
  return `结果 ${formatUnknown(toolCall.output, 220)}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function formatField(value: unknown, fallback = "未指定"): string {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function formatQuoted(value: unknown): string {
  return `“${formatField(value)}”`;
}

function formatMaxBytes(value: unknown): string {
  return typeof value === "number" ? `，最多 ${value} 字节` : "";
}

function formatBytes(value: unknown): string {
  return typeof value === "number" ? `${value} 字节` : "未知";
}

function formatCommand(command: unknown, args: unknown): string {
  const parts = [
    formatField(command),
    ...(Array.isArray(args) ? args.map((arg) => String(arg)) : [])
  ];
  return parts.join(" ");
}

function formatPreview(value: unknown, label = "预览"): string {
  if (typeof value !== "string" || value.trim().length === 0) return "";
  return `，${label}：${truncateText(value.trim(), 180)}`;
}

function formatUnknown(value: unknown, maxLength: number): string {
  try {
    return truncateText(JSON.stringify(value), maxLength);
  } catch {
    return truncateText(String(value), maxLength);
  }
}

function truncateText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength)}...`
    : normalized;
}
