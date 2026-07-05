import type {
  AgentTool,
  GitDiffInput,
  GitDiffOutput,
  GitStatusInput,
  GitStatusOutput,
  WorkspaceToolContext
} from "../core/types.js";
import { runProcess } from "../process/run-process.js";
import {
  resolveWorkspacePath,
  toWorkspacePath
} from "../workspace/paths.js";
import { assertPlainObject } from "../workspace/validation.js";

export function createGitDiffTool(
  context: WorkspaceToolContext
): AgentTool<GitDiffInput, GitDiffOutput> {
  return {
    name: "git_diff",
    description: "读取当前 Git diff，可选 staged 或限定工作区内单个路径。",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "限定 diff 的工作区相对路径。" },
        staged: { type: "boolean", description: "是否查看暂存区 diff。" },
        maxOutputBytes: {
          type: "number",
          description: "最多保留的输出字节数。"
        }
      },
      additionalProperties: false
    },
    async run(input = {}) {
      assertPlainObject(input, "git_diff input");
      const args = ["diff"];

      if (input.staged === true) {
        args.push("--staged");
      }

      if (input.path !== undefined) {
        const target = resolveWorkspacePath(context, input.path);
        args.push("--", toWorkspacePath(context, target));
      }

      const maxOutputBytes = input.maxOutputBytes ?? context.maxCommandOutputBytes;
      const result = await runProcess({
        command: "git",
        args,
        cwd: context.workspaceRoot,
        timeoutMs: context.commandTimeoutMs,
        maxOutputBytes
      });

      return {
        stdout: result.stdout,
        stderr: result.stderr,
        truncated: result.stdoutTruncated || result.stderrTruncated
      };
    }
  };
}

export function createGitStatusTool(
  context: WorkspaceToolContext
): AgentTool<GitStatusInput, GitStatusOutput> {
  return {
    name: "git_status",
    description: "读取当前 Git 仓库状态。",
    inputSchema: {
      type: "object",
      properties: {
        porcelain: {
          type: "boolean",
          description: "传 false 时返回普通 git status；默认返回 short branch 格式。"
        }
      },
      additionalProperties: false
    },
    async run(input = {}) {
      assertPlainObject(input, "git_status input");
      const args = input.porcelain === false
        ? ["status"]
        : ["status", "--short", "--branch"];
      const result = await runProcess({
        command: "git",
        args,
        cwd: context.workspaceRoot,
        timeoutMs: context.commandTimeoutMs,
        maxOutputBytes: context.maxCommandOutputBytes
      });

      return {
        stdout: result.stdout,
        stderr: result.stderr
      };
    }
  };
}
