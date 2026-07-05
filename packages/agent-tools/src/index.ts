import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

/** Agent 可调用工具的统一接口。 */
export interface AgentTool<I = unknown, O = unknown> {
  /** 工具名称，用于注册和查找。 */
  name: string;
  /** 面向模型或调用方的工具能力说明。 */
  description: string;
  /**
   * 执行工具逻辑。
   *
   * @param input 工具输入。
   * @returns 工具输出。
   */
  run(input: I): Promise<O>;
}

/** 按名称注册和解析 Agent 工具的轻量注册表。 */
export class ToolRegistry {
  /** 已注册工具的内部索引。 */
  private readonly tools = new Map<string, AgentTool>();

  /**
   * 注册或覆盖一个工具。
   *
   * @param tool 待注册的工具实例。
   */
  register(tool: AgentTool): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * 一次注册多个工具。
   *
   * @param tools 待注册的工具列表。
   */
  registerMany(tools: AgentTool[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /**
   * 按名称查找工具。
   *
   * @param name 工具名称。
   * @returns 找到的工具；不存在时返回 `undefined`。
   */
  get(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  /**
   * 列出当前注册的所有工具。
   *
   * @returns 工具列表副本。
   */
  list(): AgentTool[] {
    return [...this.tools.values()];
  }
}

/** 创建工作区工具时需要的上下文。 */
export interface WorkspaceToolOptions {
  /** 工具允许访问的工作区根目录。 */
  workspaceRoot: string;
  /** 命令执行的默认超时时间，单位毫秒。 */
  commandTimeoutMs?: number;
  /** 单次命令 stdout/stderr 的最大保留字节数。 */
  maxCommandOutputBytes?: number;
  /** 单次文本搜索的默认最大结果数。 */
  maxSearchResults?: number;
}

interface WorkspaceToolContext {
  workspaceRoot: string;
  commandTimeoutMs: number;
  maxCommandOutputBytes: number;
  maxSearchResults: number;
}

export interface ReadFileInput {
  path: string;
  encoding?: BufferEncoding;
  maxBytes?: number;
}

export interface ReadFileOutput {
  path: string;
  content: string;
  encoding: BufferEncoding;
  sizeBytes: number;
  truncated: boolean;
}

export interface WriteFileInput {
  path: string;
  content: string;
  encoding?: BufferEncoding;
  createParentDirs?: boolean;
}

export interface WriteFileOutput {
  path: string;
  sizeBytes: number;
  sha256: string;
}

export interface ListDirInput {
  path?: string;
}

export interface ListDirEntry {
  name: string;
  path: string;
  type: "file" | "directory" | "symlink" | "other";
  sizeBytes: number;
  modifiedAt: string;
}

export interface ListDirOutput {
  path: string;
  entries: ListDirEntry[];
}

export interface SearchTextInput {
  query: string;
  path?: string;
  caseSensitive?: boolean;
  maxResults?: number;
}

export interface SearchTextMatch {
  path: string;
  line: number;
  column: number;
  text: string;
}

export interface SearchTextOutput {
  query: string;
  matches: SearchTextMatch[];
  truncated: boolean;
}

export interface ApplyPatchInput {
  patch: string;
  checkOnly?: boolean;
}

export interface ApplyPatchOutput {
  applied: boolean;
  stdout: string;
  stderr: string;
}

export interface RunCommandInput {
  command: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface RunCommandOutput {
  command: string;
  args: string[];
  cwd: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

export interface GitDiffInput {
  path?: string;
  staged?: boolean;
  maxOutputBytes?: number;
}

export interface GitDiffOutput {
  stdout: string;
  stderr: string;
  truncated: boolean;
}

export interface GitStatusInput {
  porcelain?: boolean;
}

export interface GitStatusOutput {
  stdout: string;
  stderr: string;
}

const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
const DEFAULT_COMMAND_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_MAX_SEARCH_RESULTS = 200;
const DEFAULT_READ_BYTES = 512 * 1024;
const SKIPPED_SEARCH_DIRS = new Set([
  ".git",
  "dist",
  "node_modules",
  "target",
  "vendor"
]);

/**
 * 创建默认工具注册表。
 *
 * @param options 工作区工具配置。
 * @returns 已注册 8 个基础工具的注册表。
 */
export function createDefaultToolRegistry(
  options: WorkspaceToolOptions
): ToolRegistry {
  const registry = new ToolRegistry();
  registry.registerMany(createWorkspaceTools(options));
  return registry;
}

/**
 * 创建文件、搜索、命令和 Git 基础工具。
 *
 * @param options 工作区工具配置。
 * @returns 可直接注册的工具列表。
 */
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

// + read_file：读取工作区内的文本文件，并按字节上限截断超长内容。
function createReadFileTool(
  context: WorkspaceToolContext
): AgentTool<ReadFileInput, ReadFileOutput> {
  return {
    name: "read_file",
    description: "读取工作区内的文本文件，可限制最大读取字节数。",
    async run(input) {
      assertPlainObject(input, "read_file input");
      const encoding = input.encoding ?? "utf8";
      const maxBytes = input.maxBytes ?? DEFAULT_READ_BYTES;
      const target = await resolveExistingWorkspacePath(context, input.path);
      const stats = await fs.stat(target);

      if (!stats.isFile()) {
        throw new ToolInputError("read_file 只能读取普通文件。");
      }

      const buffer = await fs.readFile(target);
      const truncated = buffer.byteLength > maxBytes;
      const content = buffer.subarray(0, maxBytes).toString(encoding);

      return {
        path: toWorkspacePath(context, target),
        content,
        encoding,
        sizeBytes: stats.size,
        truncated
      };
    }
  };
}

// + write_file：写入工作区内的文本文件，可选择自动创建父目录。
function createWriteFileTool(
  context: WorkspaceToolContext
): AgentTool<WriteFileInput, WriteFileOutput> {
  return {
    name: "write_file",
    description: "写入工作区内的文本文件，默认不自动创建父目录。",
    async run(input) {
      assertPlainObject(input, "write_file input");
      const encoding = input.encoding ?? "utf8";
      const target = resolveWorkspacePath(context, input.path);
      const parent = path.dirname(target);

      if (input.createParentDirs === true) {
        await fs.mkdir(parent, { recursive: true });
      }

      await assertPathInsideWorkspace(context, parent);
      await fs.writeFile(target, input.content, { encoding });
      const buffer = Buffer.from(input.content, encoding);

      return {
        path: toWorkspacePath(context, target),
        sizeBytes: buffer.byteLength,
        sha256: createHash("sha256").update(buffer).digest("hex")
      };
    }
  };
}

// + list_dir：列出工作区内目录的直接子项，返回类型、大小和修改时间。
function createListDirTool(
  context: WorkspaceToolContext
): AgentTool<ListDirInput, ListDirOutput> {
  return {
    name: "list_dir",
    description: "列出工作区内目录的直接子项。",
    async run(input = {}) {
      assertPlainObject(input, "list_dir input");
      const target = await resolveExistingWorkspacePath(context, input.path ?? ".");
      const entries = await fs.readdir(target, { withFileTypes: true });
      const output: ListDirEntry[] = [];

      for (const entry of entries) {
        const absolutePath = path.join(target, entry.name);
        const stats = await fs.lstat(absolutePath);
        output.push({
          name: entry.name,
          path: toWorkspacePath(context, absolutePath),
          type: getDirentType(entry),
          sizeBytes: stats.size,
          modifiedAt: stats.mtime.toISOString()
        });
      }

      output.sort((a, b) => a.path.localeCompare(b.path));

      return {
        path: toWorkspacePath(context, target),
        entries: output
      };
    }
  };
}

// + search_text：递归搜索工作区文本内容，默认跳过依赖、构建产物和 Git 目录。
function createSearchTextTool(
  context: WorkspaceToolContext
): AgentTool<SearchTextInput, SearchTextOutput> {
  return {
    name: "search_text",
    description: "在工作区内递归全文搜索文本内容。",
    async run(input) {
      assertPlainObject(input, "search_text input");

      if (input.query.length === 0) {
        throw new ToolInputError("search_text 的 query 不能为空。");
      }

      const target = await resolveExistingWorkspacePath(context, input.path ?? ".");
      const maxResults = input.maxResults ?? context.maxSearchResults;
      const needle = input.caseSensitive === true
        ? input.query
        : input.query.toLowerCase();
      const matches: SearchTextMatch[] = [];
      let truncated = false;

      await walkTextFiles(target, async (filePath) => {
        if (matches.length >= maxResults) {
          truncated = true;
          return false;
        }

        const content = await fs.readFile(filePath, "utf8");
        if (content.includes("\u0000")) {
          return true;
        }

        const lines = content.split(/\r?\n/);
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index] ?? "";
          const haystack = input.caseSensitive === true ? line : line.toLowerCase();
          const column = haystack.indexOf(needle);

          if (column !== -1) {
            matches.push({
              path: toWorkspacePath(context, filePath),
              line: index + 1,
              column: column + 1,
              text: line
            });
          }

          if (matches.length >= maxResults) {
            truncated = true;
            return false;
          }
        }

        return true;
      });

      return {
        query: input.query,
        matches,
        truncated
      };
    }
  };
}

// + apply_patch：通过 git apply 校验或应用 unified diff 补丁。
function createApplyPatchTool(
  context: WorkspaceToolContext
): AgentTool<ApplyPatchInput, ApplyPatchOutput> {
  return {
    name: "apply_patch",
    description: "在工作区根目录通过 git apply 校验或应用 unified diff 补丁。",
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

// + run_command：在工作区内执行非 shell 命令，捕获退出码和截断后的输出。
function createRunCommandTool(
  context: WorkspaceToolContext
): AgentTool<RunCommandInput, RunCommandOutput> {
  return {
    name: "run_command",
    description: "在工作区内执行命令和参数数组，返回退出码、stdout 与 stderr。",
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

// + git_diff：读取当前工作区 diff，可选 staged 或限定单个路径。
function createGitDiffTool(
  context: WorkspaceToolContext
): AgentTool<GitDiffInput, GitDiffOutput> {
  return {
    name: "git_diff",
    description: "读取当前 Git diff，可选 staged 或限定工作区内单个路径。",
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

// + git_status：读取仓库状态，默认使用适合工具解析的 short branch 格式。
function createGitStatusTool(
  context: WorkspaceToolContext
): AgentTool<GitStatusInput, GitStatusOutput> {
  return {
    name: "git_status",
    description: "读取当前 Git 仓库状态。",
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

function createContext(options: WorkspaceToolOptions): WorkspaceToolContext {
  if (options.workspaceRoot.trim().length === 0) {
    throw new ToolInputError("workspaceRoot 不能为空。");
  }

  return {
    workspaceRoot: path.resolve(options.workspaceRoot),
    commandTimeoutMs: options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
    maxCommandOutputBytes:
      options.maxCommandOutputBytes ?? DEFAULT_COMMAND_OUTPUT_BYTES,
    maxSearchResults: options.maxSearchResults ?? DEFAULT_MAX_SEARCH_RESULTS
  };
}

function resolveWorkspacePath(
  context: WorkspaceToolContext,
  requestedPath: string
): string {
  const target = path.resolve(context.workspaceRoot, requestedPath);
  assertPathString(requestedPath);
  assertPathInsideRoot(context.workspaceRoot, target);
  return target;
}

async function resolveExistingWorkspacePath(
  context: WorkspaceToolContext,
  requestedPath: string
): Promise<string> {
  const target = resolveWorkspacePath(context, requestedPath);
  await assertPathInsideWorkspace(context, target);
  return target;
}

async function assertPathInsideWorkspace(
  context: WorkspaceToolContext,
  targetPath: string
): Promise<void> {
  const [root, target] = await Promise.all([
    fs.realpath(context.workspaceRoot),
    fs.realpath(targetPath)
  ]);
  assertPathInsideRoot(root, target);
}

function assertPathInsideRoot(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ToolInputError("路径必须位于工作区根目录内。");
  }
}

function assertPathString(value: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ToolInputError("路径不能为空。");
  }
}

function toWorkspacePath(context: WorkspaceToolContext, absolutePath: string): string {
  const relative = path.relative(context.workspaceRoot, absolutePath);
  return relative.length === 0 ? "." : relative.replaceAll(path.sep, "/");
}

function assertPlainObject(value: unknown, label: string): asserts value is object {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ToolInputError(`${label} 必须是对象。`);
  }
}

function getDirentType(entry: import("node:fs").Dirent): ListDirEntry["type"] {
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

async function walkTextFiles(
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

interface RunProcessOptions {
  command: string;
  args: string[];
  cwd: string;
  input?: string;
  timeoutMs: number;
  maxOutputBytes: number;
}

interface RunProcessResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

function runProcess(options: RunProcessOptions): Promise<RunProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      shell: false,
      windowsHide: true
    });
    const stdout = createOutputCollector(options.maxOutputBytes);
    const stderr = createOutputCollector(options.maxOutputBytes);
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolve({
        exitCode,
        signal,
        timedOut,
        stdout: stdout.text(),
        stderr: stderr.text(),
        stdoutTruncated: stdout.truncated(),
        stderrTruncated: stderr.truncated()
      });
    });

    if (options.input !== undefined) {
      child.stdin.end(options.input);
    }
  });
}

function createOutputCollector(maxBytes: number): {
  push(chunk: Buffer): void;
  text(): string;
  truncated(): boolean;
} {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  let wasTruncated = false;

  return {
    push(chunk) {
      if (totalBytes >= maxBytes) {
        wasTruncated = true;
        return;
      }

      const remaining = maxBytes - totalBytes;
      const nextChunk = chunk.byteLength > remaining
        ? chunk.subarray(0, remaining)
        : chunk;

      chunks.push(nextChunk);
      totalBytes += nextChunk.byteLength;

      if (nextChunk.byteLength < chunk.byteLength) {
        wasTruncated = true;
      }
    },
    text() {
      return Buffer.concat(chunks).toString("utf8");
    },
    truncated() {
      return wasTruncated;
    }
  };
}

/** 工具输入不合法时抛出的错误。 */
export class ToolInputError extends Error {
  /**
   * 创建工具输入错误。
   *
   * @param message 面向调用方的错误信息。
   */
  constructor(message: string) {
    super(message);
    this.name = "ToolInputError";
  }
}
