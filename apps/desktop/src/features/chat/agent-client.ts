import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  AgentRunEvent,
  ChatMessage,
  RuntimeCapabilitySnapshot,
  RuntimeProviderId
} from "./types";

const AGENT_RUN_EVENT = "agent-run-event";
const AGENT_RUN_LOG_PREFIX = "[AgentRun]";

type AgentChatRequest = {
  provider: RuntimeProviderId;
  model?: string;
  messages: Array<{
    role: "assistant" | "system" | "user";
    content: string;
  }>;
};

type AgentRunRequest = AgentChatRequest & {
  runId: string;
  messageId: string;
  workspaceRoot: string;
};

type AgentChatResponse = {
  content: string;
};

type AgentConfigResponse = {
  defaultProvider: RuntimeProviderId;
  availableProviders: RuntimeProviderId[];
  defaultWorkspaceRoot: string;
  securitySnapshot: RuntimeCapabilitySnapshot;
};

export async function getAgentConfig(): Promise<AgentConfigResponse> {
  return invoke<AgentConfigResponse>("get_agent_config");
}

export async function sendAgentMessage(options: {
  provider: RuntimeProviderId;
  messages: ChatMessage[];
}): Promise<string> {
  const request: AgentChatRequest = {
    provider: options.provider,
    messages: toRuntimeMessages(options.messages)
  };

  const response = await invoke<AgentChatResponse>("run_agent_chat", {
    request
  });

  return response.content;
}

export async function startAgentRun(options: {
  provider: RuntimeProviderId;
  messages: ChatMessage[];
  runId: string;
  messageId: string;
  workspaceRoot: string;
  onEvent: (event: AgentRunEvent) => void;
}): Promise<void> {
  const request: AgentRunRequest = {
    runId: options.runId,
    messageId: options.messageId,
    workspaceRoot: options.workspaceRoot,
    provider: options.provider,
    messages: toRuntimeMessages(options.messages)
  };
  let settled = false;

  console.info(AGENT_RUN_LOG_PREFIX, "前端准备发起运行请求", {
    runId: options.runId,
    messageId: options.messageId,
    provider: options.provider,
    messageCount: request.messages.length,
    workspaceRoot: options.workspaceRoot
  });

  const unlisten = await listen<AgentRunEvent>(AGENT_RUN_EVENT, (event) => {
    if (event.payload.runId !== options.runId) {
      return;
    }

    console.info(
      AGENT_RUN_LOG_PREFIX,
      "前端收到运行事件",
      summarizeAgentRunEvent(event.payload)
    );
    options.onEvent(event.payload);

    if (event.payload.type === "run_done") {
      settled = true;
      console.info(AGENT_RUN_LOG_PREFIX, "前端收到运行终态", {
        runId: options.runId,
        status: event.payload.status
      });
      unlisten();
    }
  });

  try {
    console.info(AGENT_RUN_LOG_PREFIX, "前端调用 Tauri start_agent_run", {
      runId: options.runId
    });
    await invoke("start_agent_run", { request });
    console.info(AGENT_RUN_LOG_PREFIX, "Tauri 已接受运行请求", {
      runId: options.runId
    });
  } catch (error) {
    unlisten();
    console.error(AGENT_RUN_LOG_PREFIX, "Tauri 运行请求失败", {
      runId: options.runId,
      message: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }

  await new Promise<void>((resolve) => {
    const timer = window.setInterval(() => {
      if (settled) {
        window.clearInterval(timer);
        resolve();
      }
    }, 50);
  });

  console.info(AGENT_RUN_LOG_PREFIX, "前端运行等待结束", {
    runId: options.runId
  });
}

export async function cancelAgentRun(runId: string): Promise<void> {
  await invoke("cancel_agent_run", {
    request: {
      runId
    }
  });
}

export async function resolveAgentToolApproval(options: {
  runId: string;
  approvalId: string;
  toolCallId: string;
  decision: "approved" | "denied";
}): Promise<void> {
  await invoke("resolve_agent_tool_approval", {
    request: {
      runId: options.runId,
      approvalId: options.approvalId,
      toolCallId: options.toolCallId,
      decision: options.decision
    }
  });
}

function toRuntimeMessages(messages: ChatMessage[]): AgentChatRequest["messages"] {
  return messages
    .filter((message) => !message.isSynthetic && message.content.trim().length > 0)
    .map((message) => ({
      role: message.role,
      content: message.content
    }));
}

function summarizeAgentRunEvent(event: AgentRunEvent): Record<string, unknown> {
  switch (event.type) {
    case "message_start":
    case "message_done":
      return {
        type: event.type,
        runId: event.runId,
        messageId: event.messageId
      };
    case "text_delta":
      return {
        type: event.type,
        runId: event.runId,
        messageId: event.messageId,
        textLength: event.text.length,
        textPreview: truncateLogText(event.text)
      };
    case "tool_call_start":
    case "tool_approval_request":
      return {
        type: event.type,
        runId: event.runId,
        toolCallId: event.toolCallId,
        name: event.name,
        permission: event.permission
      };
    case "tool_approval_resolved":
      return {
        type: event.type,
        runId: event.runId,
        toolCallId: event.toolCallId,
        approvalId: event.approvalId,
        decision: event.decision
      };
    case "tool_result":
      return {
        type: event.type,
        runId: event.runId,
        toolCallId: event.toolCallId,
        outputKind: getOutputKind(event.output)
      };
    case "tool_call_done":
      return {
        type: event.type,
        runId: event.runId,
        toolCallId: event.toolCallId
      };
    case "error":
      return {
        type: event.type,
        runId: event.runId,
        message: event.message
      };
    case "run_done":
      return {
        type: event.type,
        runId: event.runId,
        status: event.status
      };
    default:
      return {
        type: event.type,
        runId: event.runId
      };
  }
}

function truncateLogText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();

  return normalized.length > 80
    ? `${normalized.slice(0, 80)}...`
    : normalized;
}

function getOutputKind(output: unknown): string {
  if (output === null) {
    return "null";
  }

  if (Array.isArray(output)) {
    return "array";
  }

  return typeof output;
}
