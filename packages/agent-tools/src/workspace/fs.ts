import type { Dirent } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";

import type { ListDirEntry } from "../core/types.js";
import { SKIPPED_SEARCH_DIRS } from "./constants.js";

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
  root: string,
  onFile: (filePath: string) => Promise<boolean>
): Promise<boolean> {
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

    const shouldContinue = await walkTextFiles(path.join(root, entry.name), onFile);
    if (!shouldContinue) {
      return false;
    }
  }

  return true;
}
