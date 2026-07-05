import { promises as fs } from "node:fs";

import { ToolInputError } from "../core/errors.js";
import type {
  AgentTool,
  SearchTextInput,
  SearchTextMatch,
  SearchTextOutput,
  WorkspaceToolContext
} from "../core/types.js";
import { walkTextFiles } from "../workspace/fs.js";
import {
  resolveExistingWorkspacePath,
  toWorkspacePath
} from "../workspace/paths.js";
import { assertPlainObject } from "../workspace/validation.js";

export function createSearchTextTool(
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
        caseSensitive: { type: "boolean", description: "是否区分大小写。" },
        maxResults: { type: "number", description: "最多返回的匹配数量。" }
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
