import { invoke } from "@tauri-apps/api/core";
import type { ChatMessage, RuntimeProviderId } from "./types";

type AgentChatRequest = {
  provider: RuntimeProviderId;
  model?: string;
  messages: Array<{
    role: "assistant" | "system" | "user";
    content: string;
  }>;
};

type AgentChatResponse = {
  content: string;
};

type AgentConfigResponse = {
  defaultProvider: RuntimeProviderId;
  availableProviders: RuntimeProviderId[];
};

const SYSTEM_PROMPT =
  "你是 Mecha Agent，一个简洁、可靠的桌面 Agent 原型助手。请使用中文回答。";

export async function getAgentConfig(): Promise<AgentConfigResponse> {
  return invoke<AgentConfigResponse>("get_agent_config");
}

export async function sendAgentMessage(options: {
  provider: RuntimeProviderId;
  messages: ChatMessage[];
}): Promise<string> {
  const request: AgentChatRequest = {
    provider: options.provider,
    messages: [
      {
        role: "system",
        content: SYSTEM_PROMPT
      },
      ...options.messages
        .filter((message) => message.role !== "system")
        .map((message) => ({
          role: message.role,
          content: message.content
        }))
    ]
  };

  const response = await invoke<AgentChatResponse>("run_agent_chat", {
    request
  });

  return response.content;
}
