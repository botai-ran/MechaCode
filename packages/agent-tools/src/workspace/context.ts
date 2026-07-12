import path from "node:path";

import type {
  WorkspaceToolContext,
  WorkspaceToolOptions
} from "../core/types.js";
import { ToolInputError } from "../core/errors.js";
import {
  DEFAULT_COMMAND_OUTPUT_BYTES,
  DEFAULT_COMMAND_TIMEOUT_MS,
  DEFAULT_MAX_SEARCH_RESULTS
} from "./constants.js";
import { createRuntimeSecuritySnapshot } from "../security/policy.js";

/** 把外部配置标准化成运行时上下文。 */
export function createContext(
  options: WorkspaceToolOptions
): WorkspaceToolContext {
  if (options.workspaceRoot.trim().length === 0) {
    throw new ToolInputError("workspaceRoot 不能为空。");
  }

  return {
    workspaceRoot: path.resolve(options.workspaceRoot),
    securitySnapshot: createRuntimeSecuritySnapshot(options.securitySnapshot),
    commandTimeoutMs: options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
    maxCommandOutputBytes:
      options.maxCommandOutputBytes ?? DEFAULT_COMMAND_OUTPUT_BYTES,
    maxSearchResults: options.maxSearchResults ?? DEFAULT_MAX_SEARCH_RESULTS
  };
}
