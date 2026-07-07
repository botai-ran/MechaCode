# Mecha Agent

用于学习 Agent 桌面端开发的实验项目，目标是逐步实现类似 Codex 的本地桌面 Agent。

当前采用 **pnpm workspace + Tauri + React + TypeScript**，先保持架构简单，再逐步扩展 Agent Runtime、工具调用和桌面 UI。

## 技术栈

- Node.js 22
- pnpm 11
- TypeScript 5
- React 18 + Vite
- Tauri 2
- Rust stable MSVC toolchain
- OpenAI SDK
- Anthropic SDK

## 环境要求

```txt
Node.js: >=22 <23
pnpm:    >=11 <12
Rust:    stable-msvc
Tauri:   2.x
```

推荐环境：

```bash
corepack enable pnpm
corepack use pnpm@latest-11
rustup default stable-msvc
```

项目使用 `.node-version` 指定 Node.js 基准版本为 `22`。

## 项目结构

```txt
.
├─ apps/
│  └─ desktop/          # Tauri + React 桌面端
├─ packages/
│  ├─ protocol/         # 共享协议类型
│  ├─ agent-runtime/    # Agent 主循环和模型调用
│  ├─ agent-tools/      # Agent 工具系统
│  └─ shared/           # 通用工具函数
├─ package.json
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
└─ .env.example
```

## 模块职责

- `apps/desktop`：桌面端 UI、Tauri 命令、窗口与系统能力集成。
- `packages/protocol`：Message、ToolCall、RunEvent、IPC/RPC 等共享类型。
- `packages/agent-runtime`：Agent loop、上下文构建、模型调用、流式事件输出。
- `packages/agent-tools`：读取文件、搜索文本、执行命令、Git diff、应用 patch。
- `packages/shared`：通用基础类型和工具函数。

## 环境变量

参考 `.env.example`：

```txt
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.5
# OpenAI-compatible endpoints can be configured here.
OPENAI_BASE_URL=

ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-opus-4-6
ANTHROPIC_BASE_URL=
```

当前 CLI 会优先读取仓库根目录或当前目录下的 `.env` 文件，也支持直接读取系统环境变量。

## 常用命令

安装依赖：

```bash
pnpm install
```

启动桌面端：

```bash
pnpm dev
```

类型检查：

```bash
pnpm typecheck
```

构建桌面端：

```bash
pnpm build
```

运行简单对话：

```bash
pnpm --filter @mecha/agent-runtime chat -- --provider openai "你好"
pnpm --filter @mecha/agent-runtime chat -- --provider anthropic "你好"
```

指定模型：

```bash
pnpm --filter @mecha/agent-runtime chat -- --provider openai --model gpt-5.5 "你好"
```

OpenAI-compatible 服务可通过 `OPENAI_BASE_URL` 和 `OPENAI_MODEL` 接入，CLI 仍使用 `--provider openai`。

