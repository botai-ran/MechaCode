import type {
  AgentTool,
  RunCommandInput,
  RunCommandOutput,
  WorkspaceToolContext
} from "../core/types.js";
import { runProcess } from "../process/run-process.js";
import {
  resolveExistingWorkspacePath,
  toWorkspacePath
} from "../workspace/paths.js";
import { assertPlainObject } from "../workspace/validation.js";

export function createRunCommandTool(
  context: WorkspaceToolContext
): AgentTool<RunCommandInput, RunCommandOutput> {
  return {
    name: "run_command",
    description: "在工作区内执行命令和参数数组，返回退出码、stdout 与 stderr。",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "要执行的命令名。" },
        args: {
          type: "array",
          items: { type: "string" },
          description: "命令参数数组。"
        },
        cwd: {
          type: "string",
          description: "命令执行目录，必须位于工作区内。"
        },
        timeoutMs: { type: "number", description: "超时时间，单位毫秒。" },
        maxOutputBytes: {
          type: "number",
          description: "最多保留的 stdout/stderr 字节数。"
        }
      },
      required: ["command"],
      additionalProperties: false
    },
    async run(input) {
      assertPlainObject(input, "run_command input");
      const cwd = await resolveExistingWorkspacePath(context, input.cwd ?? ".");
      const args = input.args ?? [];
      const result = await runProcess({
        command: input.command,
        args,
        cwd,
        timeoutMs: input.timeoutMs ?? context.commandTimeoutMs,
        maxOutputBytes: input.maxOutputBytes ?? context.maxCommandOutputBytes
      });

      return {
        command: input.command,
        args,
        cwd: toWorkspacePath(context, cwd),
        ...result
      };
    }
  };
}
