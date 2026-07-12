import type { Dirent } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";

import type { ListDirEntry, WorkspaceToolContext } from "../core/types.js";
import { isSensitiveWorkspacePath } from "../security/policy.js";
import { SKIPPED_SEARCH_DIRS } from "./constants.js";
import { assertPathInsideWorkspace, toWorkspacePath } from "./paths.js";

export function getDirentType(entry: Dirent): ListDirEntry["type"] {
  if (entry.isFile()) {
    return "file";
  }

  if (entry.isDirectory()) {
    return "directory";
  }

  if (entry.isSymbolicLink()) {
    return "symlink";
  }

  return "other";
}

export async function walkTextFiles(
  context: WorkspaceToolContext,
  root: string,
  onFile: (filePath: string) => Promise<boolean>
): Promise<boolean> {
  await assertPathInsideWorkspace(context, root);
  const stats = await fs.lstat(root);

  if (stats.isFile()) {
    return onFile(root);
  }

  if (!stats.isDirectory()) {
    return true;
  }

  const entries = await fs.readdir(root, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory() && SKIPPED_SEARCH_DIRS.has(entry.name)) {
      continue;
    }

    const childPath = path.join(root, entry.name);
    await assertPathInsideWorkspace(context, childPath);

    if (isSensitiveWorkspacePath(toWorkspacePath(context, childPath))) {
      continue;
    }

    const shouldContinue = await walkTextFiles(context, childPath, onFile);
    if (!shouldContinue) {
      return false;
    }
  }

  return true;
}
