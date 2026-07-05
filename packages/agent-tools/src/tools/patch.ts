import { ToolInputError } from "../core/errors.js";
import type {
  AgentTool,
  ApplyPatchInput,
  ApplyPatchOutput,
  WorkspaceToolContext
} from "../core/types.js";
import { runProcess } from "../process/run-process.js";
import { assertPlainObject } from "../workspace/validation.js";

export function createApplyPatchTool(
  context: WorkspaceToolContext
): AgentTool<ApplyPatchInput, ApplyPatchOutput> {
  return {
    name: "apply_patch",
    description: "在工作区根目录通过 git apply 校验或应用 unified diff 补丁。",
    inputSchema: {
      type: "object",
      properties: {
        patch: { type: "string", description: "unified diff 格式的补丁内容。" },
        checkOnly: {
          type: "boolean",
          description: "是否只校验补丁，不实际应用。"
        }
      },
      required: ["patch"],
      additionalProperties: false
    },
    async run(input) {
      assertPlainObject(input, "apply_patch input");

      if (input.patch.trim().length === 0) {
        throw new ToolInputError("apply_patch 的 patch 不能为空。");
      }

      const args = ["apply", "--whitespace=nowarn"];
      if (input.checkOnly === true) {
        args.push("--check");
      }

      const result = await runProcess({
        command: "git",
        args,
        cwd: context.workspaceRoot,
        input: input.patch,
        timeoutMs: context.commandTimeoutMs,
        maxOutputBytes: context.maxCommandOutputBytes
      });

      return {
        applied: input.checkOnly !== true && result.exitCode === 0,
        stdout: result.stdout,
        stderr: result.stderr
      };
    }
  };
}
