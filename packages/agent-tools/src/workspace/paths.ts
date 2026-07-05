import { promises as fs } from "node:fs";
import path from "node:path";

import { ToolInputError } from "../core/errors.js";
import type { WorkspaceToolContext } from "../core/types.js";

/** 把工作区相对路径解析为绝对路径，并检查是否越界。 */
export function resolveWorkspacePath(
  context: WorkspaceToolContext,
  requestedPath: string
): string {
  assertPathString(requestedPath);
  const target = path.resolve(context.workspaceRoot, requestedPath);
  assertPathInsideRoot(context.workspaceRoot, target);
  return target;
}

/** 解析一个必须已经存在的工作区路径。 */
export async function resolveExistingWorkspacePath(
  context: WorkspaceToolContext,
  requestedPath: string
): Promise<string> {
  const target = resolveWorkspacePath(context, requestedPath);
  await assertPathInsideWorkspace(context, target);
  return target;
}

/** 通过真实路径校验目标仍然位于工作区内。 */
export async function assertPathInsideWorkspace(
  context: WorkspaceToolContext,
  targetPath: string
): Promise<void> {
  const [root, target] = await Promise.all([
    fs.realpath(context.workspaceRoot),
    fs.realpath(targetPath)
  ]);
  assertPathInsideRoot(root, target);
}

/** 校验一个路径是否仍然落在给定根目录下。 */
export function assertPathInsideRoot(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ToolInputError("路径必须位于工作区根目录内。");
  }
}

/** 将绝对路径转换回工作区相对路径。 */
export function toWorkspacePath(
  context: WorkspaceToolContext,
  absolutePath: string
): string {
  const relative = path.relative(context.workspaceRoot, absolutePath);
  return relative.length === 0 ? "." : relative.replaceAll(path.sep, "/");
}

/** 校验路径字符串是否为空。 */
function assertPathString(value: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ToolInputError("路径不能为空。");
  }
}
