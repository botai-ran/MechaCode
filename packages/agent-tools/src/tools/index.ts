import type { AgentTool, WorkspaceToolOptions } from "../core/types.js";
import { createContext } from "../workspace/context.js";
import { createApplyPatchTool } from "./patch.js";
import { createGitDiffTool, createGitStatusTool } from "./git.js";
import {
  createListDirTool,
  createReadFileTool,
  createWriteFileTool
} from "./files.js";
import { createRunCommandTool } from "./command.js";
import { createSearchTextTool } from "./search.js";

/** 组装一套默认工作区工具。 */
export function createWorkspaceTools(options: WorkspaceToolOptions): AgentTool[] {
  const context = createContext(options);

  return [
    createReadFileTool(context),
    createWriteFileTool(context),
    createListDirTool(context),
    createSearchTextTool(context),
    createApplyPatchTool(context),
    createRunCommandTool(context),
    createGitDiffTool(context),
    createGitStatusTool(context)
  ];
}
