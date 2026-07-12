# 工具链与 dist 收口契约

状态：阶段 1 基线。

## 工具链版本

- Node.js：22.x。
- pnpm：11.x。
- TypeScript：5.9.3，所有 workspace 包使用同一版本。
- Rust：`rust-toolchain.toml` 固定为 stable，并声明 `x86_64-pc-windows-msvc` target、`rustfmt` 和 `clippy`。

`pnpm env:check` 负责输出中文诊断；不满足版本要求时直接失败。

## 构建顺序

根脚本显式按以下顺序构建：

1. `@mecha/protocol`
2. `@mecha/shared`
3. `@mecha/agent-tools`
4. `@mecha/agent-runtime`
5. `@mecha/desktop`

原因：`protocol/shared` 是基础包；`agent-tools` 依赖基础包；`agent-runtime` 依赖 tools 和 protocol；desktop 消费 protocol 并负责 UI 构建。

## dist 契约

- workspace 包对外入口只指向包根导出。
- `main` 与 `exports.default` 指向 `dist/index.js`。
- `types` 与 `exports.types` 指向 `dist/index.d.ts`。
- 禁止跨包 deep import 到另一个包的 `src`。
- `pnpm lint` 会执行 `scripts/check-workspace-imports.mjs` 检查 deep import。

## 脚本契约

每个包提供一致的脚本：

- `clean`：删除本包 `dist`。
- `build`：先 `clean`，再生成本包产物。
- `typecheck`：执行 TypeScript 静态检查。
- `test`：执行本包当前测试；不得使用 `echo "暂无测试"` 作为成功占位。

根脚本：

- `pnpm clean`：按 workspace 顺序删除包产物。
- `pnpm build`：环境自检后按构建顺序生成全部前端/包产物。
- `pnpm build:tauri`：先构建包产物，再运行 Tauri 构建。
- `pnpm check`：环境自检、构建包产物、类型检查、ESLint 和导入边界检查。
- `pnpm test`：先构建包产物，再按 workspace 顺序执行测试。
