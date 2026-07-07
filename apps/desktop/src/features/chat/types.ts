import type { AgentRunEvent } from "@mecha/protocol";

export type Conversation = {
  id: string;
  title: string;
  updatedAt: string;
  status: string;
};

export type ChatMessage = {
  id: string;
  role: "assistant" | "system" | "user";
  content: string;
  isSynthetic?: boolean;
};

export type RuntimeProviderId = "openai" | "anthropic";

export type { AgentRunEvent };
