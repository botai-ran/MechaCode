# ADR 0002：Runtime sidecar 打包方案与 IPC framing

状态：阶段 2 已落实基础实现，后续发布流水线继续补齐正式二进制构建。

## 背景

最终产品要求干净 Windows 机器无需 Node.js、pnpm 或源码即可运行。当前 Tauri 仍通过开发期 Node CLI 承载 Runtime。

## 决策

- Runtime 发布形态收敛为单一 sidecar 入口：`@mecha/agent-runtime` 的 `dist/sidecar/index.js`，后续发布流水线将其打包为 `mecha-runtime-sidecar-{target-triple}` 可执行文件。
- Tauri 发布态只查找 `MECHA_RUNTIME_SIDECAR` 或 target triple 命名的 sidecar 可执行文件；`pnpm --filter @mecha/agent-runtime sidecar` 只允许在 debug 构建中作为开发回退。
- IPC 采用有界 framed message，而不是任意 stdout 文本协议。帧格式为 4 字节大端长度前缀 + UTF-8 JSON payload，单帧默认上限为 1 MiB。
- 握手必须包含协议版本、runtime 版本、能力、最大帧和实例 ID。
- 协议不兼容、非法帧或握手超时必须 fail closed，并终止 sidecar。
- 每个 sidecar 进程只承载一个 Run。Tauri `RunManager` 持有 `runId -> process/stdin/state`，负责取消、应用退出清理和终态仲裁。
- Windows 上 sidecar 进程被加入 Job Object，并启用 kill-on-close；阶段 2 先保证进程树关闭，资源配额留到阶段 3。
- Runtime 事件必须转换为 Protocol v1 信封后再通过 stdout 发送；stderr 只承载脱敏诊断。

## 影响

- 阶段 0 的 `security_snapshot` 事件为后续 IPC 契约字段之一。
- stderr 只承载脱敏诊断，不承载可被 UI 当作协议事件解析的内容。
- 旧的 JSON Lines runtime 事件流不再作为 Tauri 运行路径。非流式 `run_agent_chat` command 已迁移为兼容提示，桌面端主流程使用 `start_agent_run` 事件流。
- 需要在发布流水线中对 sidecar 可执行文件运行 `scripts/build-sidecar-manifest.mjs`，生成版本、Git commit、target triple 和 sha256 清单。
