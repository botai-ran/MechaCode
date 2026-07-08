import { randomUUID } from "node:crypto";
import type { AgentRunEvent } from "@mecha/protocol";
import type { AgentTool, ToolRegistry } from "@mecha/agent-tools";
import type {
  ChatInput,
  ChatTool,
  ChatToolCall,
  ChatOutput,
  ModelProvider
} from "../providers/index.js";

export type { AgentRunEvent } from "@mecha/protocol";

/** runtime 默认允许模型连续发起的最大工具调用轮数。 */
const DEFAULT_MAX_TOOL_ROUNDS = 8;

/** 控制一次聊天运行时使用的可选标识与 ID 生成策略。 */
export interface AgentRunChatOptions {
  /** 外部传入的运行 ID；用于把多段事件串到同一轮任务里。 */
  runId?: string;
  /** 外部传入的消息 ID；用于对齐前端的消息归并逻辑。 */
  messageId?: string;
  /** 自定义 ID 生成函数；测试或外部系统可注入稳定 ID。 */
  createId?: () => string;
  /** 可选工具注册表；传入后 runtime 会把工具定义暴露给模型并执行工具调用。 */
  toolRegistry?: ToolRegistry;
  /** 最大工具调用轮数；默认限制为 8 轮，避免模型陷入无限工具循环。 */
  maxToolRounds?: number;
}

/**
 * 将模型服务商的流式聊天结果，包装成统一的 agent 运行事件流。
 *
 * 当传入 `toolRegistry` 时，这个入口会在 runtime 层执行 provider-agnostic
 * 工具调用循环：模型返回工具调用后执行工具，把工具结果追加为 `tool`
 * 消息，再发起下一轮模型请求，直到模型不再请求工具或达到最大轮数。
 *
 * @param provider 负责实际模型请求的服务商适配器。
 * @param input 标准聊天输入。
 * @param options 运行级别的可选 ID 配置。
 * @returns 统一的 agent 运行事件序列。
 */
export async function* runAgentChat(
  provider: ModelProvider,
  input: ChatInput,
  options: AgentRunChatOptions = {}
): AsyncIterable<AgentRunEvent> {
  const createId = options.createId ?? randomUUID;
  const runId = options.runId ?? createId();
  const tools = createChatTools(options.toolRegistry);
  const maxToolRounds = options.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
  const messages = [...input.messages];
  let toolRounds = 0;

  // 先发出运行与消息开始事件，方便 UI 立即建立占位节点。
  yield { type: "run_start", runId };

  try {
    while (true) {
      const messageId =
        toolRounds === 0 && options.messageId ? options.messageId : createId();
      const output = yield* runModelTurn(provider, {
        ...input,
        messages,
        tools: tools ?? input.tools
      }, {
        runId,
        messageId
      });

      const toolCalls = output.toolCalls ?? [];

      if (!options.toolRegistry || toolCalls.length === 0) {
        break;
      }

      if (toolRounds >= maxToolRounds) {
        yield {
          type: "error",
          runId,
          message: `已达到最大工具调用轮数 ${maxToolRounds}，本次运行停止继续调用工具。`
        };
        break;
      }

      toolRounds += 1;
      messages.push({
        role: "assistant",
        content: output.content,
        toolCalls
      });

      for (const toolCall of toolCalls) {
        yield {
          type: "tool_call_start",
          runId,
          toolCallId: toolCall.id,
          name: toolCall.name,
          permission: options.toolRegistry.get(toolCall.name)?.permission ?? "command",
          input: toolCall.input
        };

        const toolOutput = await runToolCall(options.toolRegistry, toolCall);

        yield {
          type: "tool_result",
          runId,
          toolCallId: toolCall.id,
          output: toolOutput
        };
        yield {
          type: "tool_call_done",
          runId,
          toolCallId: toolCall.id
        };

        messages.push({
          role: "tool",
          toolCallId: toolCall.id,
          content: JSON.stringify(toolOutput)
        });
      }
    }
  } catch (error) {
    yield {
      type: "error",
      runId,
      message: getErrorMessage(error)
    };
  } finally {
    yield { type: "run_done", runId };
  }
}

/**
 * 执行一次模型请求，并把 provider 的流式输出转换为单条 assistant 消息事件。
 *
 * @param provider 负责实际模型请求的服务商适配器。
 * @param input 当前轮模型输入。
 * @param context 当前 run 和消息 ID。
 * @returns provider 在 `done` 事件中返回的完整输出。
 */
async function* runModelTurn(
  provider: ModelProvider,
  input: ChatInput,
  context: { runId: string; messageId: string }
): AsyncGenerator<AgentRunEvent, ChatOutput, void> {
  let output: ChatOutput | undefined;
  let content = "";
  let messageDone = false;

  yield { type: "model_request_start", runId: context.runId };
  yield {
    type: "message_start",
    runId: context.runId,
    messageId: context.messageId,
    role: "assistant"
  };

  for await (const event of provider.streamChat(input)) {
    if (event.type === "text_delta") {
      content += event.text;
      yield {
        type: "text_delta",
        runId: context.runId,
        messageId: context.messageId,
        text: event.text
      };
      continue;
    }

    if (event.type === "done") {
      output = event.output;

      const missingText = getMissingFinalText(content, event.output.content);
      if (missingText) {
        content += missingText;
        yield {
          type: "text_delta",
          runId: context.runId,
          messageId: context.messageId,
          text: missingText
        };
      }

      if (!messageDone) {
        messageDone = true;
        yield {
          type: "message_done",
          runId: context.runId,
          messageId: context.messageId
        };
      }
    }
  }

  // 某些 provider 可能只结束流而不显式发 done，这里补一个收口事件。
  if (!messageDone) {
    yield {
      type: "message_done",
      runId: context.runId,
      messageId: context.messageId
    };
  }

  return (
    output ?? {
      provider: provider.id,
      model: input.model ?? provider.defaultModel,
      content
    }
  );
}

function getMissingFinalText(streamedText: string, finalText: string): string {
  if (!finalText || finalText === streamedText) {
    return "";
  }

  if (!streamedText) {
    return finalText;
  }

  return finalText.startsWith(streamedText)
    ? finalText.slice(streamedText.length)
    : "";
}

function createChatTools(
  registry: ToolRegistry | undefined
): ChatTool[] | undefined {
  const tools = registry?.list().map(toChatTool);

  return tools && tools.length > 0 ? tools : undefined;
}

function toChatTool(tool: AgentTool): ChatTool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema ?? {
      type: "object",
      properties: {}
    }
  };
}

async function runToolCall(
  registry: ToolRegistry,
  toolCall: ChatToolCall
): Promise<unknown> {
  const tool = registry.get(toolCall.name);

  if (!tool) {
    return {
      ok: false,
      error: `未找到工具：${toolCall.name}`
    };
  }

  try {
    return {
      ok: true,
      result: await tool.run(toolCall.input)
    };
  } catch (error) {
    return {
      ok: false,
      error: getErrorMessage(error)
    };
  }
}

/**
 * 将任意异常转换为适合前端展示的错误文本。
 *
 * @param error 捕获到的异常值。
 * @returns 可直接展示给调用方的错误信息。
 */
function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
