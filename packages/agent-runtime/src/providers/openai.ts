import OpenAI from "openai";
import { ensureTextConversation, splitSystemMessage } from "./message-utils.js";
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

/** OpenAI 适配器的初始化选项。 */
export interface OpenAIProviderOptions {
  /** OpenAI API Key；未传入时读取 `OPENAI_API_KEY`。 */
  apiKey?: string;
  /** API 地址；未传入时读取 `OPENAI_BASE_URL`。 */
  baseURL?: string;
  /** 默认模型；未传入时读取 `OPENAI_MODEL` 或使用内置默认值。 */
  defaultModel?: string;
}

/** 基于 OpenAI Responses API 的模型服务商适配器。 */
export class OpenAIProvider implements ModelProvider {
  /** 服务商唯一标识。 */
  readonly id = "openai" as const;
  /** 当前适配器默认使用的模型。 */
  readonly defaultModel: string;

  /** OpenAI 官方 SDK 客户端。 */
  private readonly client: OpenAI;
  /** 兼容 OpenAI 协议的网关通常只支持 Chat Completions，因此这里保留兼容分支。 */
  private readonly useChatCompletions: boolean;

  /**
   * 创建 OpenAI 服务商适配器。
   *
   * @param options 初始化选项，通常由环境变量补齐。
   * @throws {ProviderConfigError} 当 API Key 缺失时抛出。
   */
  constructor(options: OpenAIProviderOptions = {}) {
    const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
    const baseURL = normalizeOptionalString(
      options.baseURL ?? process.env.OPENAI_BASE_URL
    );

    if (!apiKey) {
      throw new ProviderConfigError("缺少 OPENAI_API_KEY。");
    }

    this.defaultModel =
      options.defaultModel ??
      process.env.OPENAI_MODEL ??
      "gpt-5.5";
    this.useChatCompletions =
      baseURL !== undefined && !isOpenAIBaseURL(baseURL);
    this.client = new OpenAI({ apiKey, baseURL });
  }

  /**
   * 调用 OpenAI Responses API 生成一次完整回复。
   *
   * @param input 标准聊天输入。
   * @returns 标准化后的聊天输出。
   */
  async chat(input: ChatInput): Promise<ChatOutput> {
    const model = input.model ?? this.defaultModel;

    if (this.useChatCompletions || hasTools(input)) {
      const response = await this.client.chat.completions.create({
        model,
        messages: toOpenAIChatMessages(input),
        tools: toOpenAIChatTools(input.tools),
        temperature: input.temperature,
        max_tokens: input.maxOutputTokens
      }, {
        signal: input.abortSignal
      });
      const message = response.choices[0]?.message;

      return {
        provider: this.id,
        model,
        content: message?.content ?? "",
        toolCalls: toChatToolCalls(message?.tool_calls)
      };
    }

    const { system } = splitSystemMessage(input.messages);

    /* Responses API 将系统指令和对话项拆开传入，因此这里负责转换为 OpenAI 专用结构。 */
    const response = await this.client.responses.create({
      model,
      instructions: system,
      input: ensureTextConversation(input.messages).map((message) => ({
        role: message.role,
        content: message.content
      })),
      temperature: input.temperature,
      max_output_tokens: input.maxOutputTokens
    }, {
      signal: input.abortSignal
    });

    return {
      provider: this.id,
      model,
      content: response.output_text
    };
  }

  /**
   * 调用 OpenAI Responses API 生成流式回复。
   *
   * @param input 标准聊天输入。
   * @yields 标准化后的文本增量事件。
   * @returns 最终会产出 `done` 事件，其中包含完整输出。
   */
  async *streamChat(input: ChatInput): AsyncIterable<ChatStreamEvent> {
    const model = input.model ?? this.defaultModel;
    let content = "";

    if (this.useChatCompletions || hasTools(input)) {
      const stream = await this.client.chat.completions.create({
        model,
        messages: toOpenAIChatMessages(input),
        tools: toOpenAIChatTools(input.tools),
        temperature: input.temperature,
        max_tokens: input.maxOutputTokens,
        stream: true
      }, {
        signal: input.abortSignal
      });
      const toolCallDeltas = new Map<
        number,
        { id?: string; name?: string; arguments: string }
      >();

      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        const delta = choice?.delta.content;

        if (typeof delta === "string" && delta.length > 0) {
          content += delta;
          yield { type: "text_delta", text: delta };
        }

        for (const toolCall of choice?.delta.tool_calls ?? []) {
          const current = toolCallDeltas.get(toolCall.index) ?? {
            arguments: ""
          };

          if (toolCall.id) {
            current.id = toolCall.id;
          }

          if (toolCall.function?.name) {
            current.name = toolCall.function.name;
          }

          if (toolCall.function?.arguments) {
            current.arguments += toolCall.function.arguments;
          }

          toolCallDeltas.set(toolCall.index, current);
        }
      }

      yield {
        type: "done",
        output: {
          provider: this.id,
          model,
          content,
          toolCalls: Array.from(toolCallDeltas.values())
            .filter(
              (toolCall): toolCall is {
                id: string;
                name: string;
                arguments: string;
              } => Boolean(toolCall.id && toolCall.name)
            )
            .map((toolCall) => ({
              id: toolCall.id,
              name: toolCall.name,
              input: parseToolArguments(toolCall.arguments)
            }))
        }
      };
      return;
    }

    const { system } = splitSystemMessage(input.messages);

    const stream = await this.client.responses.stream({
      model,
      instructions: system,
      input: ensureTextConversation(input.messages).map((message) => ({
        role: message.role,
        content: message.content
      })),
      temperature: input.temperature,
      max_output_tokens: input.maxOutputTokens
    }, {
      signal: input.abortSignal
    });

    /* 将 OpenAI 流式事件统一成运行时事件，避免桌面端感知服务商差异。 */
    for await (const event of stream as AsyncIterable<{
      type: string;
      delta?: string;
    }>) {
      if (event.type === "response.output_text.delta" && event.delta) {
        content += event.delta;
        yield { type: "text_delta", text: event.delta };
      }
    }

    yield {
      type: "done",
      output: {
        provider: this.id,
        model,
        content
      }
    };
  }
}

function toOpenAIChatMessages(input: ChatInput): OpenAI.Chat.ChatCompletionMessageParam[] {
  const { system, conversation } = splitSystemMessage(input.messages);
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

  if (system) {
    messages.push({ role: "system", content: system });
  }

  messages.push(...conversation.map(toOpenAIChatMessage));

  return messages;
}

function toOpenAIChatMessage(
  message: ChatMessage
): OpenAI.Chat.ChatCompletionMessageParam {
  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: message.toolCallId ?? "",
      content: message.content
    };
  }

  if (message.role === "assistant") {
    return {
      role: "assistant",
      content: message.content,
      tool_calls: message.toolCalls?.map((toolCall) => ({
        id: toolCall.id,
        type: "function",
        function: {
          name: toolCall.name,
          arguments: JSON.stringify(toolCall.input)
        }
      }))
    };
  }

  return {
    role: message.role,
    content: message.content
  };
}

function toOpenAIChatTools(
  tools: ChatTool[] | undefined
): OpenAI.Chat.ChatCompletionTool[] | undefined {
  if (!tools || tools.length === 0) {
    return undefined;
  }

  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema
    }
  }));
}

function toChatToolCalls(
  toolCalls:
    | OpenAI.Chat.ChatCompletionMessageToolCall[]
    | undefined
): ChatToolCall[] | undefined {
  if (!toolCalls || toolCalls.length === 0) {
    return undefined;
  }

  return toolCalls
    .filter(
      (
        toolCall
      ): toolCall is OpenAI.Chat.ChatCompletionMessageFunctionToolCall =>
        toolCall.type === "function"
    )
    .map((toolCall) => ({
      id: toolCall.id,
      name: toolCall.function.name,
      input: parseToolArguments(toolCall.function.arguments)
    }));
}

function parseToolArguments(value: string): unknown {
  if (!value.trim()) {
    return {};
  }

  try {
    return JSON.parse(value);
  } catch {
    return {
      rawArguments: value
    };
  }
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const normalized = value?.trim();

  return normalized ? normalized : undefined;
}

function isOpenAIBaseURL(baseURL: string): boolean {
  const normalized = baseURL.replace(/\/+$/, "").toLowerCase();

  return normalized === "https://api.openai.com/v1";
}

function hasTools(input: ChatInput): boolean {
  return Boolean(input.tools && input.tools.length > 0);
}
