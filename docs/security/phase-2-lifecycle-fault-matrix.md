# 阶段 2 生命周期故障矩阵

本矩阵用于验收 Runtime sidecar、IPC framing、取消、超时、崩溃和应用退出后的生命周期不变量。

## 已实现的不变量

- Runtime sidecar 使用 4 字节大端长度前缀 + JSON payload，单帧默认上限 1 MiB。
- sidecar 启动后必须先发送 `hello`，Tauri 在 5 秒内校验协议主版本、最大帧和能力后发送 `hello_ack`。
- 发布态不回退到 `pnpm`、`tsx` 或源码路径；debug 构建才允许 `pnpm --filter @mecha/agent-runtime sidecar`。
- `RunManager` 持有 `runId -> process/stdin/state`，重复 `runId` 会被拒绝。
- Runtime 事件经 Protocol v1 信封传输，Tauri 只把合法帧投影成前端事件。
- Tauri 对 `run_done` 做 exactly-once 终态仲裁，终态后丢弃迟到事件。
- 用户取消通过 `cancel_agent_run` 发送 framed cancel；宽限期后强制结束 sidecar。
- Windows sidecar 进程加入 Job Object，启用 kill-on-close，覆盖 sidecar 及其后代进程。
- 应用窗口关闭时对仍在运行的 Run 发送 `app_exit` 取消并触发清理。

## 自动化覆盖

| 场景 | 覆盖方式 | 期望 |
| --- | --- | --- |
| Protocol v1 合法/非法 fixture | `pnpm --filter @mecha/protocol test`、`cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` | TS 与 Rust 解码语义一致 |
| Run 状态机重复终态 | `pnpm --filter @mecha/protocol test` | 只接受首个终态 |
| Runtime failed 终态 | `pnpm --filter @mecha/agent-runtime test` | 异常以 `failed` 收口 |
| 桌面事件投影与 Rust 协议 fixture | `pnpm --filter @mecha/desktop test` | 前端/Rust 测试通过 |

## 干净 Windows VM 手工验收

| 场景 | 操作 | 通过条件 |
| --- | --- | --- |
| 无 Node 启动 | 安装发布包，确认系统未安装 Node/pnpm，发起普通对话 | Run 可完成，应用不查找源码路径 |
| 协议不兼容 | 将 sidecar hello 的主版本改为 `2.x` 后启动 | Tauri 拒绝握手并终止 sidecar |
| 非法帧 | 发送长度为 0、超长或非法 JSON 帧 | Tauri fail closed，Run 进入唯一失败终态 |
| 用户取消 | 运行中点击“取消” | UI 显示“正在取消”后进入“已取消”，无残留 sidecar |
| sidecar 崩溃 | 运行中 kill sidecar 进程 | UI 收到唯一失败终态，无 UI 回滚 |
| 应用退出 | 运行中关闭窗口 | sidecar 和其后代进程被 Job Object 清理 |
| 慢消费者 | 人为延迟前端事件处理 | Tauri 不无限缓存，Run 仍有唯一终态 |

## 发布包追踪

发布流水线需要在 sidecar 可执行文件生成后执行：

```powershell
node scripts/build-sidecar-manifest.mjs `
  apps/desktop/src-tauri/binaries/mecha-runtime-sidecar-x86_64-pc-windows-msvc.exe `
  x86_64-pc-windows-msvc `
  apps/desktop/src-tauri/binaries/mecha-runtime-sidecar-manifest.json
```

manifest 必须随安装包归档，至少包含 Runtime 版本、Protocol 版本、Git commit、target triple、sha256 和文件大小。
