# 已实现功能总结

本文档记录当前代码仓库中已经落地的功能边界，便于后续继续接入工具调用、桌面端对话和 Agent loop。

## 1. 工程结构

- 已搭建 pnpm workspace monorepo。
- 根目录统一管理 `dev`、`build`、`typecheck`、`test` 等脚本。
- 当前包含以下主要模块：
  - `apps/desktop`：Tauri 桌面端应用。
  - `packages/agent-runtime`：模型调用运行时与 CLI。
  - `packages/agent-tools`：工具系统的基础注册能力。
  - `packages/protocol`：Agent 消息、工具调用、运行事件等共享协议类型。
  - `packages/shared`：通用工具类型和辅助函数。

## 2. 桌面端应用

- 已创建 Tauri 2 + React 18 + Vite 桌面端项目。
- 前端页面已实现一个基础交互界面：
  - 输入名称。
  - 点击按钮调用 Tauri 后端命令。
  - 显示 Rust 后端返回的 greeting 结果。
  - 提交时有简单的 loading 状态。
- Rust 侧已实现 `greet` Tauri command，并通过 `invoke_handler` 暴露给前端。
- 已接入 `tauri-plugin-opener` 插件。

当前桌面端仍是验证 Tauri 前后端通信的最小示例，还没有接入 `agent-runtime` 的真实对话能力。

## 3. Agent Runtime

- 已实现 `ChatRuntime` 统一入口。
- `ChatRuntime` 可以根据 provider 标识创建对应模型服务商适配器。
- 已支持以下 provider：
  - OpenAI
  - Anthropic
  - DeepSeek
- 已定义统一的聊天输入输出结构：
  - `ChatMessage`
  - `ChatInput`
  - `ChatOutput`
  - `ChatStreamEvent`
  - `ModelProvider`
- 已支持非流式聊天：
  - `runtime.chat(input)`
- 已支持流式聊天：
  - `runtime.streamChat(input)`
  - 流式事件统一为 `text_delta` 和 `done`。
- 已支持运行时默认模型配置：
  - 构造 `ChatRuntime` 时可传入 `model`。
  - 单次请求可通过 `input.model` 覆盖默认模型。

## 4. 模型服务商适配

### OpenAI

- 已使用 OpenAI 官方 SDK。
- 基于 Responses API 实现非流式与流式调用。
- 支持读取：
  - `OPENAI_API_KEY`
  - `OPENAI_MODEL`
- 未配置 API Key 时会抛出 `ProviderConfigError`。
- 已将系统消息拆分到 `instructions`，其余消息作为 conversation input。

### Anthropic

- 已使用 Anthropic 官方 SDK。
- 基于 Messages API 实现非流式与流式调用。
- 支持读取：
  - `ANTHROPIC_API_KEY`
  - `ANTHROPIC_MODEL`
- 未配置 API Key 时会抛出 `ProviderConfigError`。
- 已将统一消息格式转换为 Anthropic message 参数。
- 已将 Anthropic 流式事件转换为统一的 `text_delta`。

### DeepSeek

- 已复用 OpenAI SDK 访问 DeepSeek 的 OpenAI-compatible API。
- 支持非流式与流式聊天调用。
- 支持读取：
  - `DEEPSEEK_API_KEY`
  - `DEEPSEEK_MODEL`
  - `DEEPSEEK_BASE_URL`
- 默认 base URL 为 `https://api.deepseek.com`。
- 已将统一消息格式转换为 OpenAI chat completions 格式。

## 5. CLI 对话能力

- `@mecha/agent-runtime` 已提供 `mecha-chat` bin 入口。
- 已实现 `pnpm --filter @mecha/agent-runtime chat` 命令。
- CLI 支持参数：
  - `--provider openai|anthropic|deepseek`
  - `--model <model>`
  - `--no-stream`
  - 直接在命令行传入 prompt
- 未传入 prompt 时，会从终端交互式读取用户输入。
- 默认使用流式输出。
- CLI 启动时会尝试从当前目录或仓库根目录加载 `.env`。
- CLI 已内置一个基础 system prompt：
  - `You are Mecha Agent, a concise desktop agent prototype assistant.`

## 6. 协议类型

`packages/protocol` 中已定义 Agent 后续扩展所需的基础协议：

- `AgentRole`
  - `system`
  - `user`
  - `assistant`
  - `tool`
- `AgentMessage`
  - 消息 ID
  - 角色
  - 正文
  - 创建时间
- `ToolCall`
  - 工具调用 ID
  - 工具名称
  - 工具输入
- `RunEvent`
  - `message`
  - `tool_call`
  - `tool_result`
  - `error`

这些类型已经为后续工具调用和 Agent 事件流预留了结构基础。

## 7. 工具系统雏形

`packages/agent-tools` 中已实现轻量级工具注册表：

- `AgentTool<I, O>`
  - `name`
  - `description`
  - `run(input)`
- `ToolRegistry`
  - `register(tool)`
  - `get(name)`

当前工具系统还处于基础接口阶段，已经可以注册和按名称查找工具，但尚未接入模型 tool calling、JSON Schema、参数校验、工具执行循环或权限控制。

## 8. 通用共享能力

`packages/shared` 中已实现轻量级 `Result` 类型：

- `Result<T, E>`
- `ok(value)`
- `err(error)`
