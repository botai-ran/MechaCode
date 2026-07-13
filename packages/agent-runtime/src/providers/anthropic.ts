import Anthropic from "@anthropic-ai/sdk";
import { ensureConversation, splitSystemMessage } from "./message-utils.js";
import type {
  ChatInput,
  ChatMessage,
  ChatOutput,
  ChatStreamEvent,
  ChatTool,
  ChatToolCall,
  ModelProvider
} from "./types.js";
import { ProviderConfigError } from "./types.js";

/** Anthropic 适配器的初始化选项。 */
export interface AnthropicProviderOptions {
  /** Anthropic API Key；未传入时读取 `ANTHROPIC_API_KEY`。 */
  apiKey?: string;
  /** API 地址；未传入时读取 `ANTHROPIC_BASE_URL`。 */
  baseURL?: string;
  /** 默认模型；未传入时读取 `ANTHROPIC_MODEL` 或使用内置默认值。 */
  defaultModel?: string;
}

/** 基于 Anthropic Messages API 的模型服务商适配器。 */
export class AnthropicProvider implements ModelProvider {
  /** 服务商唯一标识。 */
  readonly id = "anthropic" as const;
  /** 当前适配器默认使用的模型。 */
  readonly defaultModel: string;

  /** Anthropic 官方 SDK 客户端。 */
  private readonly client: Anthropic;

  /**
   * 创建 Anthropic 服务商适配器。
   *
   * @param options 初始化选项，通常由环境变量补齐。
   * @throws {ProviderConfigError} 当 API Key 缺失时抛出。
   */
  constructor(options: AnthropicProviderOptions = {}) {
    const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
    const baseURL = normalizeOptionalString(
      options.baseURL ?? process.env.ANTHROPIC_BASE_URL
    );

    if (!apiKey) {
      throw new ProviderConfigError("缺少 ANTHROPIC_API_KEY。");
    }

    this.defaultModel =
      options.defaultModel ??
      process.env.ANTHROPIC_MODEL ??
      "claude-opus-4-6";
    this.client = new Anthropic({ apiKey, baseURL });
  }

  /**
   * 调用 Anthropic Messages API 生成一次完整回复。
   *
   * @param input 标准聊天输入。
   * @returns 标准化后的聊天输出。
   */
  async chat(input: ChatInput): Promise<ChatOutput> {
    const model = input.model ?? this.defaultModel;
    const { system } = splitSystemMessage(input.messages);

    const message = await this.client.messages.create({
      model,
      system,
      max_tokens: input.maxOutputTokens ?? 1024,
      temperature: input.temperature,
      tools: toAnthropicTools(input.tools),
      messages: toAnthropicMessages(input)
    }, {
      signal: input.abortSignal
    });

    return {
      provider: this.id,
      model,
      content: collectAnthropicText(message.content),
      toolCalls: collectAnthropicToolCalls(message.content)
    };
  }

  /**
   * 调用 Anthropic Messages API 生成流式回复。
   *
   * @param input 标准聊天输入。
   * @yields 标准化后的文本增量事件。
   * @returns 最终会产出 `done` 事件，其中包含完整输出。
   */
  async *streamChat(input: ChatInput): AsyncIterable<ChatStreamEvent> {
    const model = input.model ?? this.defaultModel;
    const { system } = splitSystemMessage(input.messages);
    let content = "";
    const toolUseBlocks = new Map<
      number,
      { id: string; name: string; input?: unknown; inputJson: string }
    >();

    const stream = this.client.messages.stream({
      model,
      system,
      max_tokens: input.maxOutputTokens ?? 1024,
      temperature: input.temperature,
      tools: toAnthropicTools(input.tools),
      messages: toAnthropicMessages(input)
    }, {
      signal: input.abortSignal
    });

    /* Anthropic 的事件名称不同，这里统一折叠为所有适配器共享的文本和工具调用输出。 */
    for await (const event of stream as AsyncIterable<{
      type: string;
      index?: number;
      content_block?: Anthropic.ContentBlock;
      delta?: { type?: string; text?: string; partial_json?: string };
    }>) {
      if (
        event.type === "content_block_delta" &&
        event.delta?.type === "text_delta" &&
        event.delta.text
      ) {
        content += event.delta.text;
        yield { type: "text_delta", text: event.delta.text };
      }

      if (
        event.type === "content_block_start" &&
        event.content_block?.type === "tool_use" &&
        typeof event.index === "number"
      ) {
        toolUseBlocks.set(event.index, {
          id: event.content_block.id,
          name: event.content_block.name,
          input: event.content_block.input,
          inputJson: ""
        });
      }

      if (
        event.type === "content_block_delta" &&
        event.delta?.type === "input_json_delta" &&
        typeof event.index === "number"
      ) {
        const toolUseBlock = toolUseBlocks.get(event.index);

        if (toolUseBlock) {
          toolUseBlock.inputJson += getPartialJson(event.delta);
        }
      }
    }

    yield {
      type: "done",
      output: {
        provider: this.id,
        model,
        content,
        toolCalls: toChatToolCallsFromStream(toolUseBlocks)
      }
    };
  }
}

/**
 * 将标准聊天输入转换为 Anthropic Messages API 可接受的消息数组。
 *
 * @param input 标准聊天输入。
 * @returns Anthropic 消息数组。
 */
function toAnthropicMessages(input: ChatInput): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = [];
  let toolResults: Anthropic.ToolResultBlockParam[] = [];

  for (const message of ensureConversation(input.messages)) {
    if (message.role === "tool") {
      toolResults.push(toAnthropicToolResult(message));
      continue;
    }

    if (toolResults.length > 0) {
      messages.push({
        role: "user",
        content: toolResults
      });
      toolResults = [];
    }

    messages.push(toAnthropicMessage(message));
  }

  if (toolResults.length > 0) {
    messages.push({
      role: "user",
      content: toolResults
    });
  }

  return messages;
}

function toAnthropicMessage(message: ChatMessage): Anthropic.MessageParam {
  if (message.role === "tool") {
    return {
      role: "user",
      content: [toAnthropicToolResult(message)]
    };
  }

  if (message.role === "assistant" && message.toolCalls?.length) {
    const content: Anthropic.ContentBlockParam[] = [];

    if (message.content) {
      content.push({
        type: "text",
        text: message.content
      });
    }

    content.push(
      ...message.toolCalls.map((toolCall) => ({
        type: "tool_use" as const,
        id: toolCall.id,
        name: toolCall.name,
        input: toolCall.input
      }))
    );

    return {
      role: "assistant",
      content
    };
  }

  return {
    role: message.role,
    content: message.content
  };
}

function toAnthropicToolResult(
  message: ChatMessage
): Anthropic.ToolResultBlockParam {
  return {
    type: "tool_result",
    tool_use_id: message.toolCallId ?? "",
    content: message.content,
    is_error: isErrorToolResult(message.content)
  };
}

function toAnthropicTools(
  tools: ChatTool[] | undefined
): Anthropic.Tool[] | undefined {
  if (!tools || tools.length === 0) {
    return undefined;
  }

  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: toAnthropicInputSchema(tool.inputSchema)
  }));
}

function toAnthropicInputSchema(
  inputSchema: Record<string, unknown>
): Anthropic.Tool.InputSchema {
  return {
    ...inputSchema,
    type: "object"
  };
}

/**
 * 从 Anthropic 返回的内容块中提取所有文本块并拼接为完整回复。
 *
 * @param content Anthropic Messages API 返回的内容块列表。
 * @returns 拼接后的纯文本内容。
 */
function collectAnthropicText(content: Anthropic.Message["content"]): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}

function collectAnthropicToolCalls(
  content: Anthropic.Message["content"]
): ChatToolCall[] | undefined {
  const toolCalls = content
    .filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use")
    .map((block) => ({
      id: block.id,
      name: block.name,
      input: block.input
    }));

  return toolCalls.length > 0 ? toolCalls : undefined;
}

function toChatToolCallsFromStream(
  toolUseBlocks: Map<
    number,
    { id: string; name: string; input?: unknown; inputJson: string }
  >
): ChatToolCall[] | undefined {
  const toolCalls = Array.from(toolUseBlocks.values()).map((block) => ({
    id: block.id,
    name: block.name,
    input: parseAnthropicToolInput(block.inputJson, block.input)
  }));

  return toolCalls.length > 0 ? toolCalls : undefined;
}

function parseAnthropicToolInput(inputJson: string, fallback: unknown): unknown {
  if (!inputJson.trim()) {
    return fallback ?? {};
  }

  try {
    return JSON.parse(inputJson);
  } catch {
    return {
      rawArguments: inputJson
    };
  }
}

function getPartialJson(delta: { partial_json?: unknown }): string {
  return typeof delta.partial_json === "string" ? delta.partial_json : "";
}

function isErrorToolResult(content: string): boolean {
  try {
    const parsed = JSON.parse(content) as { ok?: unknown };

    return parsed.ok === false;
  } catch {
    return false;
  }
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const normalized = value?.trim();

  return normalized ? normalized : undefined;
}
