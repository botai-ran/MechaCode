# 阶段 0 验收报告

日期：2026-07-12

## 验收结论

阶段 0「安全止血与架构冻结」的代码止血项和设计冻结材料已完成当前仓库内验收。默认配置下，高风险工具能力 fail closed；秘密与敏感路径保护已有自动化回归；Windows 路径安全 API 已覆盖阶段 0 约定的主要绕过面；威胁模型、数据地图、ADR 和安全不变量已形成冻结基线。

## 验收项

| 验收项 | 结果 | 证据 |
| --- | --- | --- |
| 默认配置下写文件、patch、命令和工具网络请求全部拒绝 | 通过 | `packages/agent-tools/src/security/policy.test.ts` 的默认拒绝测试 |
| `.env`、私钥和 canary secret 不进入模型输入、工具输出、日志或诊断 | 通过 | 敏感路径拒绝、脱敏测试、子进程环境 allowlist 测试 |
| `../`、绝对路径、symlink/junction、ADS 和设备路径不能越过 workspace root | 通过 | `workspace/paths.ts` 统一安全路径 API；路径安全和 patch 越界测试 |
| UI、Runtime、Tools 三处拒绝语义一致，真正执行前由 Tools 复验 | 通过 | Protocol 安全快照、Runtime `security_snapshot` 事件、Tools registry 策略包裹 |
| 威胁模型、数据地图、关键 ADR 和安全不变量已冻结 | 通过 | `docs/security/*` 与 `docs/adr/*` |
| `pnpm check` 与新增安全定向测试通过 | 通过 | 本报告下方命令记录 |

## 命令记录

```powershell
pnpm --filter @mecha/agent-tools test
pnpm --filter @mecha/agent-runtime test
pnpm check
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

## 阶段 0 攻击清单

- 模型请求 `write_file` 写入任意文件：默认拒绝。
- 模型请求 `apply_patch` 修改工作区：默认拒绝，且 patch 路径在执行前扫描。
- 模型请求 `run_command` 执行命令：默认拒绝。
- 模型请求工具网络访问：默认拒绝。
- 读取 `.env`、`.env.*`、SSH 私钥和云凭据路径：默认拒绝。
- 搜索结果、文件读取结果和进程输出包含 provider key 或 canary：输出前脱敏。
- 子进程继承 `OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、代理凭据、Git/SSH 凭据：环境 allowlist 移除。
- 路径包含 `../`、绝对路径、UNC/设备路径、NT namespace、ADS、Windows 设备名、尾随点/空格：安全路径 API 拒绝。
- 搜索递归经过 symlink/junction 指向工作区外：进入每个候选路径前真实路径复验。
- Run 运行中 UI 设置变化试图提升权限：Runtime 在 Run 开始发出并使用冻结快照。

## 残余风险与后续阶段

- 阶段 0 以默认拒绝止血，完整审批闭环留到阶段 3 Tool Broker。
- Windows junction/reparse point 的真实系统矩阵需要继续扩展，作为阶段 0 后续安全测试增强和阶段 3 安全评测输入。
- Tauri sidecar、framed IPC、Run exactly-once 终态和进程树 Job Object 属于阶段 2。
- SQLite、诊断包和 OS 凭据库全链路验收属于阶段 4。
