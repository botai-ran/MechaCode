import type { ChatMessage } from "./types.js";

/**
 * 从标准消息列表中分离系统指令和普通对话消息。
 *
 * 多数服务商会把 system 消息放在专门字段中处理，因此适配器会先调用
 * 这个工具函数，再映射到各自 API 需要的请求结构。
 *
 * @param messages 标准消息列表。
 * @returns 拆分后的系统指令文本和非 system 对话消息。
 */
export function splitSystemMessage(messages: ChatMessage[]): {
  system?: string;
  conversation: ChatMessage[];
} {
  const systemMessages = messages.filter((message) => message.role === "system");
  const conversation = messages.filter((message) => message.role !== "system");

  return {
    system:
      systemMessages.length > 0
        ? systemMessages.map((message) => message.content).join("\n\n")
        : undefined,
    conversation
  };
}

/**
 * 确保传给模型 API 的对话消息列表不为空。
 *
 * @param messages 标准消息列表。
 * @returns 至少包含一条 user 消息的对话列表。
 */
export function ensureConversation(messages: ChatMessage[]): ChatMessage[] {
  const { conversation } = splitSystemMessage(messages);

  if (conversation.length > 0) {
    return conversation;
  }

  /* 大多数模型 API 会拒绝空对话，因此注入一条无副作用的起始 user 消息。 */
  return [{ role: "user", content: "Hello" }];
}
