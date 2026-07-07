# Codex 项目入口规则

本文件只保留项目级大纲。具体执行细则放在 `.codex/rules`，Codex 修改代码前必须先读取相关规则文件。

## 技术栈

- Monorepo：pnpm workspace、TypeScript
- 桌面端：Tauri 2、React 18、Vite、SCSS
- Runtime：Node.js 22、OpenAI SDK、Anthropic SDK
- 工具链：ESLint、TypeScript、Rust stable MSVC

## 架构设计

- `apps/desktop`：桌面 UI、Tauri command/event 桥接和用户交互状态。
- `packages/protocol`：跨 UI、Tauri、Runtime、Tools 共享的协议类型唯一来源。
- `packages/agent-runtime`：Agent 流程、上下文构建、模型调用、provider 适配和事件编排。
- `packages/agent-tools`：文件、命令、搜索、Git、patch 等受控本地工具能力。
- `packages/shared`：无业务语义的基础类型和纯工具函数。

## 规则目录

- `.codex/rules/architecture.md`：项目边界、依赖方向、公共类型归属和新增能力放置规则。
- `.codex/rules/code-language.md`：中文输出、注释、错误信息、日志和测试文案规则。
- `docs/plan/`：阶段计划和复盘记录，仅在规划、排期或追踪历史决策时读取。

## 执行要求

- 改代码前先判断改动属于哪个子项目、哪一层，并读取对应规则。
- 新增跨层类型优先放入 `packages/protocol`，不得重复定义同概念公共类型。
- 如果改动不属于现有任何子项目或层级，必须先提醒用户补充或修改架构约定。
- 包之间默认只从包入口导入，禁止跨包 deep import 到另一个包内部文件。
- 修改后在最终说明中写明影响到的子项目，以及是否遵守架构边界。
