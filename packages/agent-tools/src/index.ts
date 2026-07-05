import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

/** 面向模型 tool calling 暴露的 JSON Schema。 */
export type ToolInputSchema = Record<string, unknown>;

/** Agent 可调用工具的统一接口。 */
export interface AgentTool<I = unknown, O = unknown> {
  /** 工具名称，用于注册和查找。 */
  name: string;
  /** 面向模型或调用方的工具能力说明。 */
  description: string;
  /** 工具输入参数的 JSON Schema，用于暴露给模型。 */
  inputSchema?: ToolInputSchema;
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

/** 工作区工具运行时共享的上下文信息。 */
interface WorkspaceToolContext {
  /** 工作区允许访问的根目录。 */
  workspaceRoot: string;
  /** 命令执行的超时时间。 */
  commandTimeoutMs: number;
  /** 命令输出允许保留的最大字节数。 */
  maxCommandOutputBytes: number;
  /** 文本搜索默认允许返回的最大命中数。 */
  maxSearchResults: number;
}

/** 读取文件工具的输入参数。 */
export interface ReadFileInput {
  /** 待读取文件的相对路径。 */
  path: string;
  /** 读取文件时使用的文本编码。 */
  encoding?: BufferEncoding;
  /** 单次最多读取的字节数。 */
  maxBytes?: number;
}

/** 读取文件工具的返回结果。 */
export interface ReadFileOutput {
  /** 文件的相对路径。 */
  path: string;
  /** 按编码解码后的文件内容。 */
  content: string;
  /** 实际采用的文本编码。 */
  encoding: BufferEncoding;
  /** 文件原始大小，单位字节。 */
  sizeBytes: number;
  /** 是否因为字节上限而被截断。 */
  truncated: boolean;
}

/** 写入文件工具的输入参数。 */
export interface WriteFileInput {
  /** 要写入的文件相对路径。 */
  path: string;
  /** 要写入的文件内容。 */
  content: string;
  /** 写入时使用的文本编码。 */
  encoding?: BufferEncoding;
  /** 是否在需要时自动创建父目录，默认会创建。 */
  createParentDirs?: boolean;
}

/** 写入文件工具的返回结果。 */
export interface WriteFileOutput {
  /** 写入后的文件相对路径。 */
  path: string;
  /** 写入内容的字节大小。 */
  sizeBytes: number;
  /** 写入内容的 SHA-256 摘要。 */
  sha256: string;
}

/** 目录列表工具的输入参数。 */
export interface ListDirInput {
  /** 要列出的目录相对路径。 */
  path?: string;
}

/** 目录项的标准化描述。 */
export interface ListDirEntry {
  /** 目录项名称。 */
  name: string;
  /** 目录项相对路径。 */
  path: string;
  /** 目录项类型。 */
  type: "file" | "directory" | "symlink" | "other";
  /** 目录项大小，单位字节。 */
  sizeBytes: number;
  /** 最后修改时间。 */
  modifiedAt: string;
}

/** 目录列表工具的返回结果。 */
export interface ListDirOutput {
  /** 被列出的目录相对路径。 */
  path: string;
  /** 目录下的直接子项列表。 */
  entries: ListDirEntry[];
}

/** 文本搜索工具的输入参数。 */
export interface SearchTextInput {
  /** 要搜索的关键词。 */
  query: string;
  /** 要搜索的目录或文件相对路径。 */
  path?: string;
  /** 是否区分大小写。 */
  caseSensitive?: boolean;
  /** 返回结果的最大数量。 */
  maxResults?: number;
}

/** 文本搜索命中的单条结果。 */
export interface SearchTextMatch {
  /** 命中所在的文件相对路径。 */
  path: string;
  /** 命中所在行号，从 1 开始。 */
  line: number;
  /** 命中所在列号，从 1 开始。 */
  column: number;
  /** 命中所在行的原始文本。 */
  text: string;
}

/** 文本搜索工具的返回结果。 */
export interface SearchTextOutput {
  /** 实际搜索的关键词。 */
  query: string;
  /** 命中的结果列表。 */
  matches: SearchTextMatch[];
  /** 是否因为结果数量上限而截断。 */
  truncated: boolean;
}

/** 应用补丁工具的输入参数。 */
export interface ApplyPatchInput {
  /** unified diff 补丁文本。 */
  patch: string;
  /** 是否只校验补丁而不真正应用。 */
  checkOnly?: boolean;
}

/** 应用补丁工具的返回结果。 */
export interface ApplyPatchOutput {
  /** 补丁是否成功应用。 */
  applied: boolean;
  /** 命令标准输出。 */
  stdout: string;
  /** 命令标准错误输出。 */
  stderr: string;
}

/** 执行命令工具的输入参数。 */
export interface RunCommandInput {
  /** 要执行的命令名。 */
  command: string;
  /** 命令参数数组。 */
  args?: string[];
  /** 命令执行目录。 */
  cwd?: string;
  /** 运行超时时间，单位毫秒。 */
  timeoutMs?: number;
  /** 单次输出允许保留的最大字节数。 */
  maxOutputBytes?: number;
}

/** 执行命令工具的返回结果。 */
export interface RunCommandOutput {
  /** 实际执行的命令名。 */
  command: string;
  /** 实际传入的参数数组。 */
  args: string[];
  /** 实际执行目录。 */
  cwd: string;
  /** 进程退出码。 */
  exitCode: number | null;
  /** 进程终止信号。 */
  signal: NodeJS.Signals | null;
  /** 是否因为超时而终止。 */
  timedOut: boolean;
  /** 标准输出内容。 */
  stdout: string;
  /** 标准错误内容。 */
  stderr: string;
  /** 标准输出是否被截断。 */
  stdoutTruncated: boolean;
  /** 标准错误是否被截断。 */
  stderrTruncated: boolean;
}

/** Git diff 工具的输入参数。 */
export interface GitDiffInput {
  /** 限定 diff 的相对路径。 */
  path?: string;
  /** 是否查看暂存区 diff。 */
  staged?: boolean;
  /** 输出允许保留的最大字节数。 */
  maxOutputBytes?: number;
}

/** Git diff 工具的返回结果。 */
export interface GitDiffOutput {
  /** diff 标准输出。 */
  stdout: string;
  /** diff 标准错误输出。 */
  stderr: string;
  /** 是否因为输出上限而截断。 */
  truncated: boolean;
}

/** Git status 工具的输入参数。 */
export interface GitStatusInput {
  /** 是否使用普通格式而不是精简格式。 */
  porcelain?: boolean;
}

/** Git status 工具的返回结果。 */
export interface GitStatusOutput {
  /** status 标准输出。 */
  stdout: string;
  /** status 标准错误输出。 */
  stderr: string;
}

/** 命令执行默认超时时间，单位毫秒。 */
const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
/** 单次命令允许保留的最大输出字节数。 */
const DEFAULT_COMMAND_OUTPUT_BYTES = 64 * 1024;
/** 文本搜索默认最多返回的匹配数。 */
const DEFAULT_MAX_SEARCH_RESULTS = 200;
/** 默认单文件读取上限，避免一次读入过大的文件。 */
const DEFAULT_READ_BYTES = 512 * 1024;
/** 搜索时默认跳过的目录，避免扫描依赖和构建产物。 */
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

/**
 * 创建读取文件工具。
 *
 * 这个工具会把工作区外路径拦住，并在超长时只返回前一段内容。
 *
 * @param context 工作区共享上下文。
 * @returns 读取文件工具实例。
 */
function createReadFileTool(
  context: WorkspaceToolContext
): AgentTool<ReadFileInput, ReadFileOutput> {
  return {
    name: "read_file",
    description: "读取工作区内的文本文件，可限制最大读取字节数。",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "待读取文件的工作区相对路径。" },
        encoding: {
          type: "string",
          description: "文本编码，默认 utf8。"
        },
        maxBytes: {
          type: "number",
          description: "最多读取的字节数。"
        }
      },
      required: ["path"],
      additionalProperties: false
    },
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

/**
 * 创建写入文件工具。
 *
 * 默认要求目标路径位于工作区内；如果开启 `createParentDirs`，
 * 会先补齐父目录再写入内容。
 *
 * @param context 工作区共享上下文。
 * @returns 写入文件工具实例。
 */
function createWriteFileTool(
  context: WorkspaceToolContext
): AgentTool<WriteFileInput, WriteFileOutput> {
  return {
    name: "write_file",
    description: "写入工作区内的文本文件，默认会自动创建父目录。",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "要写入的工作区相对路径。" },
        content: { type: "string", description: "要写入的文本内容。" },
        encoding: {
          type: "string",
          description: "文本编码，默认 utf8。"
        },
        createParentDirs: {
          type: "boolean",
          description: "父目录不存在时是否自动创建，默认 true。"
        }
      },
      required: ["path", "content"],
      additionalProperties: false
    },
    async run(input) {
      assertPlainObject(input, "write_file input");
      const encoding = input.encoding ?? "utf8";
      const target = resolveWorkspacePath(context, input.path);
      const parent = path.dirname(target);

      if (input.createParentDirs !== false) {
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

/**
 * 创建目录列表工具。
 *
 * 只返回当前目录的一层子项，方便模型快速扫目录结构而不是递归展开。
 *
 * @param context 工作区共享上下文。
 * @returns 目录列表工具实例。
 */
function createListDirTool(
  context: WorkspaceToolContext
): AgentTool<ListDirInput, ListDirOutput> {
  return {
    name: "list_dir",
    description: "列出工作区内目录的直接子项。",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "要列出的工作区相对目录，默认当前工作区根目录。"
        }
      },
      additionalProperties: false
    },
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

/**
 * 创建全文搜索工具。
 *
 * 会递归扫描工作区文本文件，并默认跳过依赖目录和构建产物。
 *
 * @param context 工作区共享上下文。
 * @returns 文本搜索工具实例。
 */
function createSearchTextTool(
  context: WorkspaceToolContext
): AgentTool<SearchTextInput, SearchTextOutput> {
  return {
    name: "search_text",
    description: "在工作区内递归全文搜索文本内容。",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "要搜索的文本。" },
        path: {
          type: "string",
          description: "要搜索的工作区相对路径，默认当前工作区根目录。"
        },
        caseSensitive: {
          type: "boolean",
          description: "是否区分大小写。"
        },
        maxResults: {
          type: "number",
          description: "最多返回的匹配数量。"
        }
      },
      required: ["query"],
      additionalProperties: false
    },
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

/**
 * 创建补丁应用工具。
 *
 * 该工具直接调用 `git apply`，既能校验补丁格式，也能真正应用修改。
 *
 * @param context 工作区共享上下文。
 * @returns 补丁应用工具实例。
 */
function createApplyPatchTool(
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

/**
 * 创建命令执行工具。
 *
 * 使用非 shell 方式启动进程，避免把命令字符串交给 shell 解释。
 *
 * @param context 工作区共享上下文。
 * @returns 命令执行工具实例。
 */
function createRunCommandTool(
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
        timeoutMs: {
          type: "number",
          description: "超时时间，单位毫秒。"
        },
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

/**
 * 创建 Git diff 工具。
 *
 * 支持读取暂存区或工作区 diff，也可以只查看某个路径对应的差异。
 *
 * @param context 工作区共享上下文。
 * @returns Git diff 工具实例。
 */
function createGitDiffTool(
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

/**
 * 创建 Git status 工具。
 *
 * 默认返回更适合机器解析的精简状态输出，方便后续 Agent 处理。
 *
 * @param context 工作区共享上下文。
 * @returns Git status 工具实例。
 */
function createGitStatusTool(
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

/**
 * 组装工作区工具运行时上下文。
 *
 * 这里负责把默认值补齐，并把 workspaceRoot 规范化成绝对路径。
 *
 * @param options 工具创建选项。
 * @returns 标准化后的工具上下文。
 */
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

/**
 * 把调用方传入的相对路径解析成工作区内的绝对路径。
 *
 * @param context 工作区共享上下文。
 * @param requestedPath 调用方请求访问的路径。
 * @returns 解析后的绝对路径。
 */
function resolveWorkspacePath(
  context: WorkspaceToolContext,
  requestedPath: string
): string {
  const target = path.resolve(context.workspaceRoot, requestedPath);
  assertPathString(requestedPath);
  assertPathInsideRoot(context.workspaceRoot, target);
  return target;
}

/**
 * 解析工作区内必须已经存在的路径。
 *
 * 这个函数会额外检查真实路径，避免符号链接把访问引到工作区外。
 *
 * @param context 工作区共享上下文。
 * @param requestedPath 调用方请求访问的路径。
 * @returns 已确认存在且位于工作区内的绝对路径。
 */
async function resolveExistingWorkspacePath(
  context: WorkspaceToolContext,
  requestedPath: string
): Promise<string> {
  const target = resolveWorkspacePath(context, requestedPath);
  await assertPathInsideWorkspace(context, target);
  return target;
}

/**
 * 校验路径真实位置仍然在工作区根目录之内。
 *
 * @param context 工作区共享上下文。
 * @param targetPath 待校验的绝对路径。
 */
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

/**
 * 检查目标路径是否位于指定根目录下。
 *
 * @param root 根目录绝对路径。
 * @param target 待检查的绝对路径。
 */
function assertPathInsideRoot(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ToolInputError("路径必须位于工作区根目录内。");
  }
}

/**
 * 校验路径字符串是否为空。
 *
 * @param value 待校验的路径字符串。
 */
function assertPathString(value: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ToolInputError("路径不能为空。");
  }
}

/**
 * 把绝对路径转回工作区相对路径，便于返回给调用方。
 *
 * @param context 工作区共享上下文。
 * @param absolutePath 工作区内的绝对路径。
 * @returns 规范化后的相对路径。
 */
function toWorkspacePath(context: WorkspaceToolContext, absolutePath: string): string {
  const relative = path.relative(context.workspaceRoot, absolutePath);
  return relative.length === 0 ? "." : relative.replaceAll(path.sep, "/");
}

/**
 * 校验工具输入是否为普通对象。
 *
 * @param value 待校验的值。
 * @param label 错误提示里使用的对象名称。
 */
function assertPlainObject(value: unknown, label: string): asserts value is object {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ToolInputError(`${label} 必须是对象。`);
  }
}

/**
 * 把 `Dirent` 转成工具返回里使用的统一类型字符串。
 *
 * @param entry 文件系统目录项。
 * @returns 统一后的目录项类型。
 */
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

/**
 * 递归遍历文本文件并逐个回调。
 *
 * 遇到目录时会继续下探，遇到普通文件时会交给 `onFile` 决定是否继续。
 *
 * @param root 起始路径。
 * @param onFile 处理单个文件的回调。
 * @returns 是否继续遍历完了全部路径。
 */
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

/**
 * 执行子进程并收集输出。
 *
 * 这里统一处理超时、退出码和 stdout/stderr 截断，避免每个工具重复实现。
 *
 * @param options 进程执行参数。
 * @returns 进程运行结果。
 */
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

/**
 * 创建按字节上限截断的输出收集器。
 *
 * @param maxBytes 单流允许保留的最大字节数。
 * @returns 输出收集器。
 */
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
