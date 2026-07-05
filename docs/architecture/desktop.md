# 桌面端工程架构约定

本文档用于约束 Mecha Agent 桌面端的代码拆分、模块边界和后续演进顺序。当前阶段优先保证结构清晰、职责稳定，再逐步接入真实 Agent Runtime、工具调用和会话持久化。

## 架构目标

- UI 层只负责展示、输入、交互状态和轻量编排。
- Agent Runtime 负责模型调用、上下文构建、流式事件和工具调用循环。
- Protocol 包沉淀跨 UI、Tauri、Runtime 共享的事件与数据结构。
- Desktop 通过 Tauri command/event 与本地能力通信，不在 React 组件里直接写系统能力逻辑。
- 每次新增能力都先确认所属边界，避免把页面组件变成业务和基础设施的混合入口。

## 分层边界

```txt
apps/desktop
├─ src/
│  ├─ App.tsx                  # 应用组合入口，只保留页面级状态与布局组合
│  ├─ styles.css               # 当前阶段的全局样式入口
│  ├─ features/
│  │  └─ chat/
│  │     ├─ types.ts           # 桌面端聊天 UI 类型
│  │     ├─ mock-data.ts       # 原型阶段静态数据
│  │     └─ components/        # 聊天界面组件
│  ├─ services/                # 后续封装 Tauri invoke / event 订阅
│  ├─ state/                   # 后续放全局应用状态或 store
│  └─ lib/                     # 仅放无业务含义的前端工具函数
└─ src-tauri/
   └─ src/                     # Tauri commands、本地进程、系统能力桥接

packages
├─ protocol                    # AgentMessage、RunEvent、ToolCall、IPC payload
├─ agent-runtime               # ChatRuntime、provider adapter、Agent loop
├─ agent-tools                 # 文件、命令、搜索、Git、patch 等工具
└─ shared                      # Result 等通用基础工具
```

## Desktop 内部拆分规则

`App.tsx` 是组合层，只做三件事：

- 持有页面级状态，例如当前会话、输入草稿、消息列表。
- 组合 feature 组件，例如 `ConversationSidebar` 和 `ChatPanel`。
- 连接后续 service/store，不承载复杂 UI 细节。

`features/chat` 是当前对话体验的归属边界：

- `types.ts` 定义 UI 需要的最小类型，不直接扩散到 runtime。
- `mock-data.ts` 只服务原型阶段，后续由会话 service 或 store 替代。
- `components` 内组件按 UI 区域拆分，组件接收 props，不直接读写全局数据源。

`services` 后续用于隔离 Tauri 能力：

- `chat-service.ts`：发起对话、订阅流式事件、取消运行。
- `conversation-service.ts`：会话创建、重命名、删除、列表读取。
- `settings-service.ts`：模型服务商、模型、API key 状态读取。

## Runtime 接入路径

第一阶段保留静态数据，完成 UI 结构拆分。

第二阶段新增 Tauri command：

- `chat_send_message`：提交用户消息，返回 run id。
- `chat_cancel_run`：取消当前 run。
- `conversation_list`：读取会话列表。
- `conversation_create`：创建新会话。

第三阶段通过 Tauri event 推送 Runtime 流式事件：

- `run_started`
- `message_delta`
- `message_completed`
- `tool_call_started`
- `tool_call_completed`
- `run_failed`
- `run_cancelled`

第四阶段再把 `packages/protocol` 扩展为 UI 与 Runtime 都能复用的 IPC 协议，避免 desktop 自己定义一套、runtime 又定义一套。

## 状态模型

桌面端建议围绕四类状态组织：

- 会话状态：会话列表、当前会话、会话标题。
- 消息状态：消息列表、流式生成中的消息、错误消息。
- 运行状态：当前 run id、是否生成中、是否可取消。
- 配置状态：provider、model、workspace root、权限状态。

当前不急于引入复杂状态库。只有当跨页面共享、持久化同步、流式事件合并开始变复杂时，再评估 Zustand 或 Redux Toolkit。

## 设计约束

- 不在组件里直接调用 provider SDK。
- 不在组件里直接执行命令、读写文件或操作 Git。
- 不在 `packages/agent-runtime` 里引入 React/Tauri 依赖。
- 不把 UI 文案、mock 数据和组件结构长期混在同一个文件。
- 不为尚未出现的复杂度提前铺过厚抽象。

## 下一步建议

1. 保持当前两栏聊天 UI，把 `App.tsx` 拆为 feature 组件。
2. 扩展 `packages/protocol`，定义桌面端运行事件。
3. 在 Tauri Rust 侧新增最小 chat command，先调用已有 CLI/runtime 能力。
4. 在前端增加 `services/chat-service.ts`，统一处理 invoke 与事件订阅。
5. 再考虑会话持久化、工具调用面板、权限确认和设置页。
