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
};

export type RuntimeProviderId = "openai" | "anthropic" | "deepseek";
