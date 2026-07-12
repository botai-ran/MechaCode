# ADR 0002：Runtime sidecar 打包方案与 IPC framing

状态：阶段 0 冻结方向，阶段 2 完成技术选型。

## 背景

最终产品要求干净 Windows 机器无需 Node.js、pnpm 或源码即可运行。当前 Tauri 仍通过开发期 Node CLI 承载 Runtime。

## 决策

- Runtime 发布形态必须收敛为 Tauri sidecar，不以 `tsx` 或源码路径作为发布回退。
- IPC 采用有界 framed message，而不是任意 stdout 文本协议。
- 握手必须包含协议版本、runtime 版本、能力、最大帧和实例 ID。
- 协议不兼容、非法帧或握手超时必须 fail closed，并终止 sidecar。

## 影响

- 阶段 0 的 `security_snapshot` 事件为后续 IPC 契约字段之一。
- stderr 只承载脱敏诊断，不承载可被 UI 当作协议事件解析的内容。
