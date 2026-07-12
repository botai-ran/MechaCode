# ADR 0003：Tool Broker 职责边界与审批闭环

状态：阶段 0 先默认拒绝，阶段 3 完整实现 Tool Broker。

## 背景

工具能力会触及文件、命令、Git、patch 和未来网络。UI 隐藏按钮不能构成安全控制。

## 决策

- `packages/agent-tools` 是工具真实执行前的强制策略复验边界。
- 阶段 0 默认拒绝 `write`、`command` 和工具 `network`；只允许工作区内非敏感读取。
- Runtime 只负责编排工具调用和未来审批暂停/恢复，不判断操作系统路径是否安全。
- 阶段 3 Tool Broker 返回 `allowed`、`approval_required`、`denied`，并绑定工具调用参数哈希。

## 影响

- 所有工具注册必须经过统一 registry 或后续 Broker。
- 高风险工具即使被模型调用，也会在 Tools 层 fail closed。
