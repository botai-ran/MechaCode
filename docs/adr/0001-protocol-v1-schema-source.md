# ADR 0001：Protocol v1 schema 唯一来源与生成策略

状态：阶段 0 冻结，阶段 1 实施 schema-first。

## 背景

跨 UI、Tauri、Runtime 和 Tools 的事件、错误和安全能力需要统一语义。当前阶段先在 `packages/protocol` 定义 TypeScript 类型，阶段 1 会升级为 schema-first。

## 决策

- `packages/protocol` 是跨层协议类型唯一来源。
- 安全模式、能力快照、工具权限、Run 事件和错误信封都归属 protocol。
- Provider 原始类型不得进入 protocol。
- 阶段 1 引入可版本化 schema，并由 schema 约束 TypeScript/Rust 契约测试。

## 影响

- Runtime、Desktop 和 Tools 只能从 `@mecha/protocol` 消费跨层类型。
- 任何跨边界字段变更必须同步测试和文档。
