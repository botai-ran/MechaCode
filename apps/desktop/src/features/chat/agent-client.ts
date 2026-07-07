import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AgentRunEvent, ChatMessage, RuntimeProviderId } from "./types";

const AGENT_RUN_EVENT = "agent-run-event";

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
};

type AgentChatResponse = {
  content: string;
};

type AgentConfigResponse = {
  defaultProvider: RuntimeProviderId;
  availableProviders: RuntimeProviderId[];
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
  onEvent: (event: AgentRunEvent) => void;
}): Promise<void> {
  const request: AgentRunRequest = {
    runId: options.runId,
    messageId: options.messageId,
    provider: options.provider,
    messages: toRuntimeMessages(options.messages)
  };
  let settled = false;

  const unlisten = await listen<AgentRunEvent>(AGENT_RUN_EVENT, (event) => {
    if (event.payload.runId !== options.runId) {
      return;
    }

    options.onEvent(event.payload);

    if (event.payload.type === "run_done") {
      settled = true;
      unlisten();
    }
  });

  try {
    await invoke("start_agent_run", { request });
  } catch (error) {
    unlisten();
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
}

function toRuntimeMessages(messages: ChatMessage[]): AgentChatRequest["messages"] {
  return messages
    .filter((message) => !message.isSynthetic)
    .map((message) => ({
      role: message.role,
      content: message.content
    }));
}
