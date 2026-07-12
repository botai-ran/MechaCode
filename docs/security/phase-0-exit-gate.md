# 阶段 0 退出门槛报告

日期：2026-07-12

## 结论

阶段 0 退出门槛当前判定为：通过。

进入阶段 1 的前提已经由自动化测试和人工攻击清单共同证明：默认配置下，未经授权的写入、命令、任意工具网络和秘密访问为零。阶段 0 仍保留的审批闭环、sidecar、进程树清理、持久化和诊断能力属于后续阶段范围，不阻塞阶段 1。

## 自动化证明

| 风险 | 证明方式 | 当前结果 |
| --- | --- | --- |
| 未授权写文件 | `write_file` 默认拒绝，并验证目标文件未创建 | 通过 |
| 未授权 patch | `apply_patch` 默认拒绝；开启写能力时仍拒绝越界 patch 路径 | 通过 |
| 未授权命令 | `run_command` 默认拒绝，并验证命令副作用文件不存在 | 通过 |
| 未授权工具网络 | 测试网络工具默认拒绝，并验证 mock 执行函数未被调用 | 通过 |
| `.env` 读取 | `read_file` 访问 `.env` 默认拒绝 | 通过 |
| `.env` 搜索/列举 | `search_text` 和 `list_dir` 默认跳过敏感路径 | 通过 |
| canary secret 泄漏 | 工具输出脱敏测试覆盖 provider key 和 canary secret | 通过 |
| 子进程秘密继承 | 子进程环境 allowlist 移除 API key、代理凭据等疑似秘密 | 通过 |
| 工作区逃逸 | 路径 API 拒绝 `../`、ADS、Windows 设备名；真实路径复验约束搜索递归 | 通过 |
| Run 中途提升权限 | Runtime 测试验证 `security_snapshot` 在模型请求前冻结发出 | 通过 |

## 人工攻击清单

- `read_file(".env")`：被 Tools 策略拒绝。
- `search_text({ query: "MECHACODE_CANARY", path: "." })`：敏感文件不进入搜索结果。
- `list_dir(".")`：敏感文件条目不返回给模型上下文。
- `write_file("note.txt")`：默认拒绝，目标文件不创建。
- `apply_patch(...)`：默认拒绝；越界 patch 路径在执行 `git` 前拒绝。
- `run_command("node", ["-e", "...写文件..."])`：默认拒绝，命令不会启动。
- 注册 `permission: "network"` 的工具并调用：默认拒绝，工具函数不会执行。
- `read_file("../outside.txt")`、`read_file("note.txt:secret")`、`write_file("CON")`：路径 API 拒绝。
- 子进程环境包含 `OPENAI_API_KEY`、`HTTPS_PROXY`：传入子进程前被移除。
- 工具输出包含 `sk-*` 或 `MECHACODE_CANARY_*`：进入 Runtime/UI/模型前替换为 `[已脱敏]`。

## 命令记录

```powershell
pnpm --filter @mecha/agent-tools test
pnpm --filter @mecha/agent-runtime test
pnpm check
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

## 允许进入阶段 1 的条件

- 阶段 0 安全回归测试全部通过。
- `pnpm check` 通过，无类型或 lint 阻塞。
- Tauri Rust 测试通过。
- 威胁模型、数据地图、安全不变量和关键 ADR 已写入仓库。

## 后续不得回退的安全不变量

- 默认拒绝不能改成默认允许。
- 工具执行不能绕过 `packages/agent-tools` 策略复验。
- 敏感文件不能通过读取、搜索、列举或诊断重新进入模型上下文。
- 子进程不能继承 provider key、代理凭据、Git/SSH 凭据或疑似秘密变量。
- 路径安全 API 仍是文件、搜索、Git、patch 和命令 cwd 的唯一入口。
