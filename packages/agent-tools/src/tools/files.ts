import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { ToolInputError } from "../core/errors.js";
import type {
  AgentTool,
  ListDirEntry,
  ListDirInput,
  ListDirOutput,
  ReadFileInput,
  ReadFileOutput,
  WorkspaceToolContext,
  WriteFileInput,
  WriteFileOutput
} from "../core/types.js";
import { DEFAULT_READ_BYTES } from "../workspace/constants.js";
import { getDirentType } from "../workspace/fs.js";
import {
  assertPathInsideWorkspace,
  resolveExistingWorkspacePath,
  resolveWorkspacePath,
  toWorkspacePath
} from "../workspace/paths.js";
import { assertPlainObject } from "../workspace/validation.js";

export function createReadFileTool(
  context: WorkspaceToolContext
): AgentTool<ReadFileInput, ReadFileOutput> {
  return {
    name: "read_file",
    description: "读取工作区内的文本文件，可限制最大读取字节数。",
    permission: "read",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "待读取文件的工作区相对路径。" },
        encoding: { type: "string", description: "文本编码，默认 utf8。" },
        maxBytes: { type: "number", description: "最多读取的字节数。" }
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

export function createWriteFileTool(
  context: WorkspaceToolContext
): AgentTool<WriteFileInput, WriteFileOutput> {
  return {
    name: "write_file",
    description: "写入工作区内的文本文件，默认会自动创建父目录。",
    permission: "write",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "要写入的工作区相对路径。" },
        content: { type: "string", description: "要写入的文本内容。" },
        encoding: { type: "string", description: "文本编码，默认 utf8。" },
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

export function createListDirTool(
  context: WorkspaceToolContext
): AgentTool<ListDirInput, ListDirOutput> {
  return {
    name: "list_dir",
    description: "列出工作区内目录的直接子项。",
    permission: "read",
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
