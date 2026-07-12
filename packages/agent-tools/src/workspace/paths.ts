import { promises as fs } from "node:fs";
import path from "node:path";

import { ToolInputError } from "../core/errors.js";
import type { WorkspaceToolContext } from "../core/types.js";

/** Windows 保留设备名，即使带扩展名也不能作为普通路径段使用。 */
const WINDOWS_DEVICE_NAME_PATTERN = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

/** Windows 设备、UNC 和 NT namespace 前缀，工具路径统一拒绝。 */
const WINDOWS_NAMESPACE_PATTERN = /^(?:\\\\|\/\/|\\\?\\|\/\/\?\/|\\\.\\|\/\/\.\/|\\\?\?\\)/;

/** 把工作区相对路径解析为绝对路径，并检查是否越界。 */
export function resolveWorkspacePath(
  context: WorkspaceToolContext,
  requestedPath: string
): string {
  assertSafeWorkspacePath(requestedPath);
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

/**
 * 解析写入目标，并按最近存在父目录的真实路径做越界复验。
 *
 * @param context 当前工具工作区上下文。
 * @param requestedPath 工具传入的工作区相对路径。
 * @param options 写入前是否允许创建缺失父目录。
 * @returns 经过词法校验和父目录真实路径校验后的绝对写入路径。
 */
export async function resolveWritableWorkspacePath(
  context: WorkspaceToolContext,
  requestedPath: string,
  options: { createParentDirs: boolean }
): Promise<string> {
  const target = resolveWorkspacePath(context, requestedPath);
  const parent = path.dirname(target);
  const nearest = await findNearestExistingParent(context, parent);

  if (!nearest.stats.isDirectory()) {
    throw new ToolInputError("写入目标的最近存在父路径必须是目录。");
  }

  await assertPathInsideWorkspace(context, nearest.path);

  if (!options.createParentDirs && nearest.path !== parent) {
    throw new ToolInputError("写入目标的父目录不存在。");
  }

  if (options.createParentDirs) {
    await fs.mkdir(parent, { recursive: true });
  }

  await assertPathInsideWorkspace(context, parent);
  await assertWritableTarget(target);

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

/** 校验工具传入路径是否是安全的工作区相对路径。 */
function assertSafeWorkspacePath(value: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ToolInputError("路径不能为空。");
  }

  if (value.includes("\u0000")) {
    throw new ToolInputError("路径不能包含空字符。");
  }

  if (path.isAbsolute(value) || /^[a-zA-Z]:/.test(value)) {
    throw new ToolInputError("工具路径必须是工作区相对路径。");
  }

  const normalized = value.replaceAll("\\", "/");
  if (WINDOWS_NAMESPACE_PATTERN.test(value) || WINDOWS_NAMESPACE_PATTERN.test(normalized)) {
    throw new ToolInputError("路径不能使用 UNC、设备路径或 NT namespace。");
  }

  for (const segment of normalized.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }

    if (segment === "..") {
      throw new ToolInputError("路径不能包含上级目录引用。");
    }

    if (segment.includes(":")) {
      throw new ToolInputError("路径不能包含 Alternate Data Streams 或冒号。");
    }

    if (/[. ]$/.test(segment)) {
      throw new ToolInputError("路径段不能以点或空格结尾。");
    }

    if (WINDOWS_DEVICE_NAME_PATTERN.test(segment)) {
      throw new ToolInputError("路径不能使用 Windows 设备名。");
    }
  }
}

async function findNearestExistingParent(
  context: WorkspaceToolContext,
  startPath: string
): Promise<{ path: string; stats: Awaited<ReturnType<typeof fs.lstat>> }> {
  let current = startPath;

  while (true) {
    assertPathInsideRoot(context.workspaceRoot, current);

    try {
      return {
        path: current,
        stats: await fs.lstat(current)
      };
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
    }

    const next = path.dirname(current);
    if (next === current) {
      throw new ToolInputError("写入目标没有可用的父目录。");
    }

    current = next;
  }
}

async function assertWritableTarget(target: string): Promise<void> {
  try {
    const stats = await fs.lstat(target);

    if (stats.isSymbolicLink()) {
      throw new ToolInputError("写入目标不能是符号链接或重解析点。");
    }

    if (stats.isDirectory()) {
      throw new ToolInputError("写入目标不能是目录。");
    }
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }
}

function isNotFoundError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
