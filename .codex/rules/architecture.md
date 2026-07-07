# 架构边界规则

Codex 修改代码前必须先判断本次改动属于哪个子项目和哪一层。

## 子项目职责

- `apps/desktop` 负责 React UI、交互状态、前端 service 和 Tauri command/event 桥接。
- `packages/protocol` 是跨 UI、Tauri、Runtime、Tools 的共享协议唯一来源。
- `packages/agent-runtime` 负责 Agent 流程、模型调用、provider 适配和运行事件编排。
- `packages/agent-tools` 负责文件、命令、搜索、Git、patch 等可执行工具能力。
- `packages/shared` 只放无业务语义的基础工具。

## 依赖边界

- `packages/protocol` 不依赖任何业务包。
- `packages/shared` 不依赖任何业务包。
- `packages/agent-runtime` 不引入 React、Tauri 前端 API 或桌面 UI 代码。
- `packages/agent-tools` 不负责模型调用、Agent 对话流程或 UI 展示。
- `apps/desktop/src` 不直接调用 provider SDK、执行命令、读写文件、操作 Git 或引用 runtime/tools 的内部 `src` 文件。
- 包之间默认只允许从包入口导入，例如 `@mecha/protocol`；禁止跨包 deep import 到另一个包内部文件。

## 公共类型归属

- 只在单个 React feature 内使用的类型，放在 feature 的 `types.ts`。
- React 与 Tauri command/event 共享的类型，放在 `packages/protocol`。
- Runtime 与 Desktop 都要理解的事件、消息、工具调用类型，放在 `packages/protocol`。
- Runtime 内部编排状态，放在 `packages/agent-runtime` 内部，不从根入口导出。
- Provider 原始请求、响应和事件类型，只能留在 provider 适配层内部。

## 新增能力放置规则

1. 跨 UI、Tauri、Runtime 的通信形状，放入 `packages/protocol`。
2. React 组件、页面状态或用户交互，放入 `apps/desktop/src`。
3. Tauri command、系统桥接或桌面本地进程集成，放入 `apps/desktop/src-tauri`。
4. 模型调用、Agent 流程、上下文构建或事件流编排，放入 `packages/agent-runtime`。
5. 文件、命令、搜索、Git、patch 等可执行工具能力，放入 `packages/agent-tools`。
6. 完全无业务语义的通用工具，放入 `packages/shared`。

如果一个文件看起来同时属于多个答案，应先拆出协议类型或 service 边界，再实现具体流程。

如果新增能力不属于以上任何一种，Codex 不应把它硬塞进现有目录。必须先提醒用户补充或修改架构约定，明确新的子项目、层级或职责边界后再继续实现。
