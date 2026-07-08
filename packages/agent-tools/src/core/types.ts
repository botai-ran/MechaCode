import type { ToolPermissionCategory } from "@mecha/protocol";

export type { ToolPermissionCategory };

/** 面向 tool calling 暴露的 JSON Schema 结构。 */
export type ToolInputSchema = Record<string, unknown>;

/** 所有 Agent 工具实现都遵循的统一接口。 */
export interface AgentTool<I = unknown, O = unknown> {
  /** 工具在注册表和对外协议里的稳定名称。 */
  name: string;
  /** 面向调用方的简短描述，用来解释这个工具能做什么。 */
  description: string;
  /** 工具权限分类，用于调用前展示风险等级和后续权限确认。 */
  permission: ToolPermissionCategory;
  /** 用于模型理解入参结构的 JSON Schema。 */
  inputSchema?: ToolInputSchema;
  /** 执行工具并返回结构化结果。 */
  run(input: I): Promise<O>;
}

/** 创建工作区工具时允许传入的配置。 */
export interface WorkspaceToolOptions {
  /** 工具允许访问的工作区根目录。 */
  workspaceRoot: string;
  /** 命令执行的默认超时时间，单位毫秒。 */
  commandTimeoutMs?: number;
  /** 单次命令输出允许保留的最大字节数。 */
  maxCommandOutputBytes?: number;
  /** 文本搜索默认最多返回的匹配数。 */
  maxSearchResults?: number;
}

/** 运行时标准化后的工作区上下文。 */
export interface WorkspaceToolContext {
  /** 规范化后的工作区根目录绝对路径。 */
  workspaceRoot: string;
  /** 命令执行超时时间。 */
  commandTimeoutMs: number;
  /** 命令输出允许保留的最大字节数。 */
  maxCommandOutputBytes: number;
  /** 文本搜索默认最多返回的匹配数。 */
  maxSearchResults: number;
}

/** 读取文件工具的输入。 */
export interface ReadFileInput {
  /** 待读取文件的工作区相对路径。 */
  path: string;
  /** 读取时使用的文本编码，默认 `utf8`。 */
  encoding?: BufferEncoding;
  /** 最多读取的字节数。 */
  maxBytes?: number;
}

/** 读取文件工具的输出。 */
export interface ReadFileOutput {
  /** 文件的工作区相对路径。 */
  path: string;
  /** 按编码解码后的文件内容。 */
  content: string;
  /** 实际使用的文本编码。 */
  encoding: BufferEncoding;
  /** 文件原始大小，单位字节。 */
  sizeBytes: number;
  /** 是否因字节上限而截断。 */
  truncated: boolean;
}

/** 写入文件工具的输入。 */
export interface WriteFileInput {
  /** 要写入的工作区相对路径。 */
  path: string;
  /** 要写入的文本内容。 */
  content: string;
  /** 写入时使用的文本编码，默认 `utf8`。 */
  encoding?: BufferEncoding;
  /** 是否在需要时自动创建父目录。 */
  createParentDirs?: boolean;
}

/** 写入文件工具的输出。 */
export interface WriteFileOutput {
  /** 写入后的工作区相对路径。 */
  path: string;
  /** 写入内容的字节大小。 */
  sizeBytes: number;
  /** 写入内容的 SHA-256 摘要。 */
  sha256: string;
}

/** 目录列举工具的输入。 */
export interface ListDirInput {
  /** 要列出的目录相对路径，默认当前工作区根目录。 */
  path?: string;
}

/** 单个目录项的标准化描述。 */
export interface ListDirEntry {
  /** 目录项名称。 */
  name: string;
  /** 目录项工作区相对路径。 */
  path: string;
  /** 目录项类型。 */
  type: "file" | "directory" | "symlink" | "other";
  /** 目录项大小，单位字节。 */
  sizeBytes: number;
  /** 最后修改时间，ISO 字符串格式。 */
  modifiedAt: string;
}

/** 目录列举工具的输出。 */
export interface ListDirOutput {
  /** 被列出的目录工作区相对路径。 */
  path: string;
  /** 目录下的直接子项列表。 */
  entries: ListDirEntry[];
}

/** 文本搜索工具的输入。 */
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
  /** 命中所在文件的工作区相对路径。 */
  path: string;
  /** 命中所在行号，从 1 开始。 */
  line: number;
  /** 命中所在列号，从 1 开始。 */
  column: number;
  /** 命中所在行的原始文本。 */
  text: string;
}

/** 文本搜索工具的输出。 */
export interface SearchTextOutput {
  /** 实际搜索的关键词。 */
  query: string;
  /** 命中的结果列表。 */
  matches: SearchTextMatch[];
  /** 是否因结果数量上限而截断。 */
  truncated: boolean;
}

/** 应用补丁工具的输入。 */
export interface ApplyPatchInput {
  /** unified diff 补丁文本。 */
  patch: string;
  /** 是否只校验补丁而不真正应用。 */
  checkOnly?: boolean;
}

/** 应用补丁工具的输出。 */
export interface ApplyPatchOutput {
  /** 补丁是否成功应用。 */
  applied: boolean;
  /** 命令标准输出。 */
  stdout: string;
  /** 命令标准错误输出。 */
  stderr: string;
}

/** 执行命令工具的输入。 */
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

/** 执行命令工具的输出。 */
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
  /** 是否因超时而终止。 */
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

/** Git diff 工具的输入。 */
export interface GitDiffInput {
  /** 限定 diff 的相对路径。 */
  path?: string;
  /** 是否查看暂存区 diff。 */
  staged?: boolean;
  /** 输出允许保留的最大字节数。 */
  maxOutputBytes?: number;
}

/** Git diff 工具的输出。 */
export interface GitDiffOutput {
  /** diff 标准输出。 */
  stdout: string;
  /** diff 标准错误输出。 */
  stderr: string;
  /** 是否因输出上限而截断。 */
  truncated: boolean;
}

/** Git status 工具的输入。 */
export interface GitStatusInput {
  /** 是否使用普通格式而不是精简格式。 */
  porcelain?: boolean;
}

/** Git status 工具的输出。 */
export interface GitStatusOutput {
  /** status 标准输出。 */
  stdout: string;
  /** status 标准错误输出。 */
  stderr: string;
}

/** 进程执行层的输入。 */
export interface RunProcessOptions {
  /** 要执行的命令。 */
  command: string;
  /** 命令参数数组。 */
  args: string[];
  /** 命令执行目录。 */
  cwd: string;
  /** 可选的标准输入内容。 */
  input?: string;
  /** 超时时间，单位毫秒。 */
  timeoutMs: number;
  /** 输出允许保留的最大字节数。 */
  maxOutputBytes: number;
}

/** 进程执行层的输出。 */
export interface RunProcessResult {
  /** 进程退出码。 */
  exitCode: number | null;
  /** 进程终止信号。 */
  signal: NodeJS.Signals | null;
  /** 是否因超时而终止。 */
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
