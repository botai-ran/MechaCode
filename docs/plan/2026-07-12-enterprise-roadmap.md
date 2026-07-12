# MechaCode 企业级桌面 Agent 开发计划（2026-07-12）

> 计划周期：24 周，按单人开发的可持续节奏排期。  
> 计划口径：原始需求写作“四个阶段”，但实际列出了编号 0–4，本文按 **五个阶段** 规划。  
> 核心原则：上一阶段的退出门槛未通过，不进入下一阶段；安全问题不得以“后续补测试”方式延期。

## 1. 目标与边界

### 1.1 最终目标

在第 24 周形成一个可开源、可安装、可恢复、默认安全的 Windows 桌面 Agent：

- 干净机器无需安装 Node.js、pnpm 或项目源码即可运行。
- 未经用户授权的写入、命令、网络访问和秘密访问为零。
- Runtime 崩溃、取消或超时后无孤儿进程，并且每个 Run 只产生一次终态。
- 重启应用不丢失会话和 Run 记录，数据库升级与故障恢复可验证。
- 关键流程支持键盘操作和读屏，具备中文与英文界面基础。
- 开源贡献者可从干净检出完成 `check`、`build`、`test`。

### 1.2 本计划暂不包含

- 多租户 SaaS 控制面、团队组织与 RBAC。
- SSO、SCIM、集中式审计平台和企业策略下发。
- 云端会话同步、云端密钥托管和计费系统。
- macOS/Linux 正式支持；协议和核心代码保持可移植，但本周期只对 Windows 作发布验收。

### 1.3 架构归属

| 子项目 | 本计划中的职责 |
| --- | --- |
| `packages/protocol` | Schema-first Protocol v1、Run 状态、IPC 消息、工具审批与错误协议的唯一来源 |
| `packages/agent-runtime` | Agent 编排、上下文裁剪、provider 适配、Run 与工具调用事件编排 |
| `packages/agent-tools` | Tool Broker、路径安全、文件/命令/Git/patch 能力及其策略执行 |
| `apps/desktop/src-tauri` | Sidecar 生命周期、IPC 桥接、SQLite、凭据库、系统代理/CA、诊断与安装集成 |
| `apps/desktop/src` | 审批交互、diff/命令预览、会话与设置 UI、恢复提示、无障碍和国际化 |
| `packages/shared` | 不含业务语义的纯工具函数；不得承载安全策略或协议类型 |

如果 Tool Broker、持久化或凭据能力最终无法自然落入以上边界，必须先新增 ADR 并更新 `.codex/rules/architecture.md`，不得临时创建职责含混的公共包。

## 2. 当前工程基线

本计划以 2026-07-12 的仓库状态为起点：

- 根目录已经限制 Node.js 22 和 pnpm 11，但桌面子项目仍使用 TypeScript 5.6，其他包使用 5.9。
- 没有 `rust-toolchain.toml`，Rust stable MSVC 尚未固化到可复现配置。
- `protocol` 的类型入口指向 `src`，运行入口指向 `dist`；其余包主要依赖 `dist`，构建顺序存在隐式前提。
- Desktop、Protocol、Tools、Shared 的测试脚本仍输出“暂无测试”，Runtime 没有 `test` 脚本，根测试会产生假绿或漏测。
- Tauri 当前通过启动 Node CLI 承载 Runtime，尚未形成可分发 sidecar 和结构化双向 IPC。
- Tauri `csp` 当前为 `null`，默认 opener 权限允许通用 HTTP/HTTPS URL。
- 工具已区分 `read`、`write`、`command` 权限，但尚无强制审批闭环。
- 路径约束已有基础实现，但还缺少针对 Windows symlink、junction、reparse point、ADS 和不存在写入目标的系统性安全测试。
- Run 事件已有 `runId`，但尚无协议版本、单调序号、取消/中断终态和 exactly-once 约束。

## 3. 总体里程碑

| 阶段 | 累计周次 | 目标 | 退出门槛 |
| --- | ---: | --- | --- |
| 0. 安全止血与架构冻结 | 第 1–2 周 | 立即关闭高风险默认能力并冻结关键边界 | 未授权写入、命令、任意网络和秘密访问为零 |
| 1. 可复现工程基线 | 第 3–6 周 | 建立可信构建、测试和 Protocol v1 | 干净检出可 check/build/test，双端契约测试通过 |
| 2. Sidecar 与生命周期 | 第 7–12 周 | 形成无需外部 Node 的 Runtime 分发与可靠进程管理 | 干净机器可运行，崩溃/取消无孤儿进程，终态唯一 |
| 3. 安全 Agent 内核 | 第 13–18 周 | 建立 Tool Broker、审批、资源与数据外流控制 | 安全评测中秘密泄漏、越界和未审批高风险动作均为零 |
| 4. 完整桌面产品 | 第 19–24 周 | 完成本地持久化、恢复、设置、诊断与可访问性 | 重启不丢会话，迁移/恢复通过，关键流程支持键盘和读屏 |

## 4. 阶段 0：安全止血与架构冻结（第 1–2 周）

### 4.1 阶段目标

先消除当前原型中可能造成真实数据破坏或秘密泄漏的路径，并用威胁模型、数据地图和 ADR 固定后续设计前提。

### 4.2 第 1 周：默认拒绝与秘密保护

#### 工作包 0A：危险能力默认关闭

- 在 `packages/protocol` 定义运行安全模式和能力快照，至少包含 `read`、`write`、`command`、`network`。
- 默认策略只允许工作区内的非敏感读取；`write`、`command` 和工具网络能力默认拒绝。
- `packages/agent-runtime` 在一次 Run 开始时冻结能力快照，运行中不得因 UI 设置变化而提升权限。
- `packages/agent-tools` 在实际执行入口再次校验策略，禁止仅依赖 UI 隐藏按钮。
- Desktop 清晰展示当前安全模式；被拒绝时显示中文原因，不提供静默降级执行。

#### 工作包 0B：秘密与敏感文件保护

- 建立敏感文件规则：`.env`、`.env.*`、私钥、SSH 凭据、云凭据、系统凭据目录和应用凭据存储默认不可被工具读取、搜索、写入或加入模型上下文。
- 仅允许应用自身的 provider 配置层读取 API Key；密钥不得进入聊天消息、工具输出、日志和诊断信息。
- 子进程环境改为显式 allowlist，移除 `OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、代理凭据、Git 凭据和其他疑似秘密变量。
- 对错误对象、命令输出和 provider 请求日志增加统一脱敏；建立 canary secret 回归测试。
- 限制 Tauri opener 权限和 CSP，禁止未经过明确业务入口的任意 URL 打开与远程内容执行。

### 4.3 第 2 周：路径安全与设计冻结

#### 工作包 0C：Windows 路径越界修复

- 在 `packages/agent-tools` 建立唯一安全路径 API，所有文件、搜索、Git、patch 和命令工作目录均通过该入口。
- 读取目标：规范化路径后解析真实路径，并验证最终目标仍在规范化后的 workspace root 内。
- 写入目标：对最近存在的父目录解析真实路径，再逐段验证不存在的后续路径，避免先检查后通过 junction/symlink 落到工作区外。
- 拒绝 Windows 设备名、UNC/设备路径、NT namespace、Alternate Data Streams、尾随点/空格混淆和大小写绕过。
- 防御 TOCTOU：高风险操作在执行前重新校验；原子替换前再次验证父目录身份。
- 增加真实 Windows 临时目录测试，覆盖 symlink、junction、相对路径、绝对路径、大小写和不存在目标。

#### 工作包 0D：威胁模型、数据地图与 ADR

- 新增威胁模型：资产、信任边界、攻击者能力、入口、滥用场景、缓解措施和残余风险。
- 新增数据地图：用户消息、文件内容、工具输出、API Key、provider 请求、日志、数据库和诊断包的来源、存储、流向、保留周期与删除方式。
- 至少完成以下 ADR：
  - Protocol v1 的 schema 唯一来源与生成策略。
  - Runtime sidecar 打包方案与 IPC framing。
  - Tool Broker 的职责边界与审批闭环。
  - Windows 路径安全与进程隔离策略。
  - 本地数据库、凭据库和日志的归属。
- 形成安全不变量清单，后续代码评审和测试均引用同一份不变量。

### 4.4 阶段 0 验收

- [ ] 默认配置下，写文件、应用 patch、执行命令和任意工具网络请求全部被拒绝。
- [ ] `.env`、私钥和 canary secret 不会出现在模型输入、工具输出、日志或诊断信息中。
- [ ] `../`、绝对路径、symlink、junction、ADS 和设备路径均不能越过 workspace root。
- [ ] 权限拒绝在 UI、Runtime 和 Tools 三处语义一致，真正执行前由 Tools 再次校验。
- [ ] 威胁模型、数据地图和关键 ADR 已评审，安全不变量可直接转成测试。
- [ ] `pnpm check` 与新增的安全定向测试通过。

### 4.5 阶段 0 退出门槛

用自动化测试和人工攻击清单证明：未经授权的写入、命令、任意网络和秘密访问为零。任何一项无法证明时，不进入阶段 1。

## 5. 阶段 1：可复现工程基线（第 3–6 周）

### 5.1 阶段目标

让任何贡献者和 CI 从干净检出得到相同的构建与测试结果，并把跨 TypeScript/Rust/Sidecar 的通信固定为可验证的 Protocol v1。

### 5.2 第 3 周：工具链与 dist 收口

#### 工作包 1A：版本统一

- 固定 Node.js 22.x、pnpm 11.x、TypeScript 单一版本和 Rust stable MSVC 版本。
- 增加 `rust-toolchain.toml`，明确 `x86_64-pc-windows-msvc` target 与必要 component。
- 统一所有 workspace 包的 TypeScript 版本、模块解析和严格模式。
- 增加环境自检命令，输出不满足要求的中文诊断。

#### 工作包 1B：构建图与产物契约

- 统一包入口策略：发布/运行只消费 `dist`，类型入口不得指向其他包的 `src`。
- 使用 pnpm workspace 拓扑构建，明确 `protocol/shared -> tools -> runtime -> desktop` 顺序。
- 每个包提供一致的 `clean`、`build`、`typecheck`、`test`；根脚本只编排，不隐式依赖旧产物。
- 增加“删除全部 dist 后构建”测试，防止本地遗留产物掩盖依赖问题。
- 校验包之间只从包入口导入，禁止 deep import。

### 5.3 第 4 周：真实测试与 Windows CI

#### 工作包 1C：测试基线

- 删除所有 `echo \"暂无测试\"` 脚本，替换为真实测试运行器。
- `packages/protocol`：schema、解析、版本兼容和无效消息拒绝测试。
- `packages/agent-tools`：路径、文件、命令、Git、patch、超时和输出截断测试。
- `packages/agent-runtime`：provider mock、工具循环、错误转换、取消和终态测试。
- `apps/desktop/src`：store、事件归并、重复事件与错误恢复测试。
- `apps/desktop/src-tauri`：IPC framing、RunManager 和路径/进程生命周期 Rust 测试。
- 测试脚本在零测试时失败，禁止空测试套件返回成功。

#### 工作包 1D：Windows CI

- 新增 Windows CI：锁定工具链、`pnpm install --frozen-lockfile`、格式/静态检查、构建、TS 测试、Rust 测试。
- 增加 clean-checkout job，不读取缓存产物；缓存仅用于依赖下载加速。
- 上传失败日志和测试报告，但上传前执行秘密脱敏。
- 合并门槛至少要求 Windows 基线 job 通过。

### 5.4 第 5 周：Schema-first Protocol v1

#### 工作包 1E：协议唯一来源

- 在 `packages/protocol` 维护可版本化 schema，TypeScript 类型、运行时校验器和 Rust 数据结构均由 schema 生成或受契约测试约束。
- 所有跨边界消息包含 `protocolVersion`、`runId`、单调递增 `seq`、`type` 和受约束 payload。
- 定义稳定错误信封：错误码、中文可显示信息、可重试标记、来源和脱敏详情。
- 定义兼容策略：同一主版本向后兼容；未知事件可安全忽略；主版本不兼容时握手失败且不启动 Run。
- 禁止 provider 原始类型穿透到协议层。

#### 工作包 1F：双端契约测试

- 建立 golden fixtures，TypeScript 与 Rust 使用同一批合法/非法样本。
- 验证序列化、反序列化、必填字段、最大消息长度、未知字段和版本不兼容行为。
- CI 检查生成文件是否与 schema 同步，禁止手工修改生成结果。

### 5.5 第 6 周：Run 状态机

#### 工作包 1G：明确状态与终态

- 定义 Run 状态：`created -> starting -> running -> cancelling -> terminal`。
- 终态限定为 `completed`、`failed`、`cancelled`、`interrupted`，每个 Run 恰好一个终态。
- 工具调用定义配对状态，拒绝缺少开始事件、重复结果或终态后继续输出。
- Runtime 负责业务状态转换，Tauri 负责进程事实，Desktop 只按协议投影 UI 状态。
- 对乱序、重复、丢失、超时、provider 断流和 Runtime 异常退出建立模型测试。

### 5.6 阶段 1 验收

- [ ] 删除所有 `dist` 后，干净检出可执行安装、检查、构建和测试。
- [ ] Node、pnpm、TypeScript、Rust 版本在本地和 CI 一致。
- [ ] 所有包都有真实测试，零测试不会通过。
- [ ] Windows CI 从无缓存环境通过。
- [ ] Protocol v1 的 TypeScript/Rust golden contract tests 全部通过。
- [ ] Run 状态机覆盖重复终态、乱序事件、取消竞争和异常退出。

### 5.7 阶段 1 退出门槛

以下命令在干净检出和 Windows CI 均成功，且不依赖历史 `dist`：

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm test
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

## 6. 阶段 2：Sidecar 与生命周期（第 7–12 周）

### 6.1 阶段目标

将 Runtime 交付为 Tauri sidecar，移除用户机器上的 Node/pnpm/源码依赖，并建立可取消、可超时、可恢复且无孤儿进程的生命周期管理。

### 6.2 第 7 周：Sidecar 打包技术验证

- 用 ADR 比较 Node SEA、打包后的独立可执行文件等方案，验证 OpenAI/Anthropic SDK、ESM、source map、证书和代理兼容性。
- 选定方案后建立单一 sidecar 入口，禁止以开发期 `tsx`/源码路径作为发布回退。
- 产物命名包含 Tauri target triple，并纳入 bundle resources/externalBin。
- 生成构建清单：协议版本、Runtime 版本、Git commit、目标平台和哈希。
- 在无 Node 的 Windows Sandbox/VM 中完成最小启动验证。

### 6.3 第 8 周：长度前缀 IPC 与握手

- 使用 stdin/stdout 二进制通道，消息采用固定字节序长度前缀 + Protocol v1 payload；stderr 仅承载脱敏诊断。
- 设置单帧和累计缓冲上限，拒绝超长、截断、非法编码和 schema 不合法消息。
- 定义 `hello/hello_ack`：协议版本、Runtime 版本、能力、最大帧和实例 ID。
- 握手超时或版本不兼容时立即终止 sidecar，不允许进入半可用状态。
- 增加分片读取、粘包、多帧、非法长度和随机输入测试。

### 6.4 第 9 周：Tauri RunManager

- 在 `apps/desktop/src-tauri` 建立 RunManager，持有 `runId -> process/channel/state` 映射。
- 所有 start/cancel/status command 经过 RunManager；前端不直接接触子进程句柄。
- 限制并发 Run 数，重复 `runId` 明确拒绝。
- stdout 解析、stderr 读取和进程等待独立工作，任一路径失败都汇聚到统一终态协调器。
- RunManager 关闭应用时进入有界清理流程。

### 6.5 第 10 周：取消、超时与背压

- cancel 设计为幂等命令；区分用户取消、运行超时、空闲超时和应用退出。
- 使用 AbortSignal 将取消从 Tauri 传到 Runtime、provider 请求和工具执行。
- IPC 设置有界队列和背压，慢 UI 不得导致无限内存增长。
- 超时后先请求协作式退出，在短宽限期后强制终止整个进程树。
- UI 显示“正在取消”，最终只由终态事件结束运行状态。

### 6.6 第 11 周：进程树清理与 exactly-once 终态

- Windows 上将 sidecar 及后代进程纳入 Job Object；阶段 2 先落实 kill-on-close，资源配额在阶段 3 加固。
- 命令工具产生的 shell/子进程必须加入同一 Run 生命周期域。
- 设计终态仲裁：正常完成、取消、超时、解析失败、IPC 断开和进程退出竞争时只允许首个有效终态提交。
- 终态包含退出原因、可重试标记和最后有效序号；终态后丢弃迟到事件并记录脱敏诊断。
- 增加故障注入：kill sidecar、kill child、截断帧、卡死、重复 cancel、应用强退。

### 6.7 第 12 周：发布形态验收

- 构建 Tauri 安装包，确认 sidecar 被正确签入产物并可校验哈希。
- 在全新 Windows VM 上执行安装、首次启动、普通对话、取消、超时、崩溃和卸载测试。
- 确认应用不查找系统 Node、pnpm、tsx 或仓库源码。
- 建立 sidecar 构建缓存与 SBOM/依赖清单，为后续开源发布做准备。

### 6.8 阶段 2 验收

- [ ] 无 Node/pnpm/源码的干净 Windows 机器可完成一次正常 Run。
- [ ] 版本不兼容、非法帧和握手超时会安全失败。
- [ ] cancel、timeout、sidecar 崩溃和应用退出后无残留 Runtime 或命令子进程。
- [ ] 每个 Run 恰好一个终态，终态后无 UI 状态回滚。
- [ ] IPC 在碎片、粘包、超长帧和慢消费者场景下保持有界资源占用。
- [ ] 安装包内 sidecar 版本和哈希可追踪。

### 6.9 阶段 2 退出门槛

在全新 Windows VM 运行生命周期故障矩阵，所有用例均满足“可启动、可停止、无孤儿、终态唯一”。

## 7. 阶段 3：安全 Agent 内核（第 13–18 周）

### 7.1 阶段目标

把阶段 0 的临时默认拒绝升级为完整 Tool Broker：每次高风险动作都经过策略、预览、审批、执行前复验和审计事件，同时限制秘密、网络与系统资源。

### 7.2 第 13 周：Tool Broker 骨架

- Tool Broker 作为 `packages/agent-tools` 的唯一执行入口，工具实现不得绕过 Broker 导出。
- 每次调用生成不可复用的 `toolCallId`，绑定 Run、工具名、规范化参数、workspace、策略版本和参数哈希。
- Broker 返回 `allowed`、`approval_required`、`denied`，拒绝原因使用协议错误码。
- Runtime 只负责编排审批暂停/恢复，不自行判断操作系统路径是否安全。
- 对工具注册表增加能力声明、风险等级、可预览性、资源上限和网络需求。

### 7.3 第 14 周：审批、拒绝与安全预览

- `packages/protocol` 定义 approval request/decision/expired/cancelled 事件。
- Desktop 对写入显示目标与 diff，对命令显示 executable、参数、cwd、环境摘要和超时，对网络显示目标主机与数据类别。
- 默认只提供“本次允许”和“拒绝”；持久允许规则延期到安全模型稳定后。
- 审批决定与参数哈希绑定；模型或工具修改参数后必须重新审批。
- 审批超时、Run 取消、会话切换和应用退出全部按拒绝处理。
- UI 防点击劫持与误操作：高风险确认不可由键盘默认焦点直接触发。

### 7.4 第 15 周：命令隔离与资源配额

- 子进程环境采用最小 allowlist，只传必要系统变量和明确配置；禁止继承 provider key 与凭据变量。
- 默认禁止 shell 字符串拼接，优先 executable + args；确需 shell 时提升风险等级并展示完整预览。
- 规范化 executable 与 cwd，限制 PowerShell profile、AutoRun、脚本策略和命令搜索路径劫持。
- 使用 Job Object 设置进程数、内存、CPU 时间和 kill-on-close；设置 stdout/stderr 字节上限。
- 超限、超时和取消均返回结构化工具结果，不把原始系统错误直接暴露给模型或 UI。

### 7.5 第 16 周：安全路径 API 与原子写

- 将阶段 0 的路径校验收敛为强类型 API，例如只允许工具接收已验证的 workspace path handle。
- 读、列举、搜索、Git 和 patch 全部移除私有路径拼接逻辑。
- 写文件采用同目录临时文件、flush、可选备份、原子 replace；失败时清理临时文件。
- 写入前后校验文件身份与父目录，防止审批后替换为 junction/symlink。
- diff 基于实际落盘前内容生成；审批后内容变化时使批准失效。

### 7.6 第 17 周：网络策略与 prompt injection 防御

- 将 provider 网络与工具网络分离：provider 仅访问用户配置端点，工具网络继续默认关闭。
- 对允许的网络请求校验 scheme、host、port、重定向和 DNS 解析结果；阻止 localhost、link-local、内网和云 metadata 地址，除非用户明确配置。
- 请求体按数据类别最小化，秘密、完整环境和未批准文件内容不得外发。
- 将网页、仓库文件、工具输出视为不可信内容；在上下文中标记来源和信任等级。
- 外部内容中的指令不得改变 system policy、能力快照或审批状态。
- 在 tool result 到模型的边界进行尺寸限制、结构化封装和危险指令提示，不依赖单一 prompt 文案作为安全控制。

### 7.7 第 18 周：安全评测与修复周

- 建立可重复安全评测集：秘密 canary、路径逃逸、命令注入、参数替换、审批绕过、prompt injection、SSRF、资源耗尽和日志泄漏。
- 每类攻击至少包含正向、反向和 Windows 特有案例。
- 执行 fuzz/property tests：路径、IPC frame、协议解析、命令参数和审批状态机。
- 将所有发现按 P0–P3 分级；P0/P1 必须在阶段退出前清零。
- 输出残余风险、已知限制和开源安全报告模板。

### 7.8 阶段 3 验收

- [ ] 所有工具执行均经过 Tool Broker，无法从公开入口绕过。
- [ ] 写入、命令和网络动作未经有效审批不会执行；修改参数后旧审批失效。
- [ ] 子进程无法读取 provider key、Git 凭据或 canary secret。
- [ ] Job Object 配额、超时和 kill-on-close 对完整进程树生效。
- [ ] 所有文件工具通过同一安全路径 API，原子写失败不会破坏原文件。
- [ ] SSRF、prompt injection 和恶意工具输出不能提升权限或触发未批准动作。
- [ ] 安全评测中秘密泄漏、workspace 逃逸、未审批高风险动作均为零。

### 7.9 阶段 3 退出门槛

安全回归套件和人工红队清单全部通过，P0/P1 安全问题为零；失败样本必须进入永久回归集。

## 8. 阶段 4：完整桌面产品（第 19–24 周）

### 8.1 阶段目标

在安全内核之上完成可长期使用的本地桌面产品：数据可持久化、崩溃可恢复、操作可预览、配置可迁移、问题可诊断、关键功能可访问。

### 8.2 第 19 周：SQLite/WAL 与迁移框架

- SQLite 归属 `apps/desktop/src-tauri`，前端通过受控 command 访问，不直接拼 SQL。
- 启用 WAL、foreign keys、busy timeout 和明确的同步级别。
- 建立 schema version 与顺序迁移；迁移在事务中执行，失败回滚并保留可恢复副本。
- 首批表覆盖 conversation、message、run、run_event、tool_call、approval 和 app_setting 元数据。
- API Key 不进入 SQLite，凭据只保存引用标识。
- 为数据删除、会话导出和未来隐私要求保留稳定边界。

### 8.3 第 20 周：Run journal 与崩溃恢复

- Run 关键事件先持久化 journal，再更新 UI 投影；高频 text delta 可批量提交但需有界丢失窗口。
- 启动时扫描非终态 Run，统一标记为 `interrupted`，恢复可显示消息和工具历史。
- 校验 seq 连续性与终态唯一性，发现损坏时隔离坏记录而不是阻止整个应用启动。
- 增加断电/kill 故障注入、WAL 恢复、磁盘已满、数据库锁定和损坏副本测试。
- 提供备份、恢复和迁移失败回退路径。

### 8.4 第 21 周：上下文裁剪与核心交互

- Runtime 实现确定性的 token budget、历史裁剪、摘要与工具结果压缩；记录裁剪决策便于诊断。
- 不将秘密或被策略排除的内容重新带入摘要。
- Desktop 完成 diff 预览、命令预览、审批/拒绝、取消和失败重试主流程。
- 大 diff、长命令输出和长会话使用虚拟化/渐进加载，避免阻塞 UI。
- 用户可以查看“模型将看到什么”的上下文来源摘要。

### 8.5 第 22 周：设置、凭据、代理与自定义 CA

- 建立类型化设置 schema、默认值、版本迁移、导入/导出和无效配置回退。
- API Key 存入 Windows Credential Manager 或等价 OS 凭据库；内存中按需读取并尽快释放引用。
- 支持系统代理、用户代理、NO_PROXY、代理认证和自定义 CA；日志不得记录认证信息或证书私钥。
- provider 配置提供连接测试、明确超时和可操作的中文错误。
- 设置变更仅影响新 Run，当前 Run 继续使用启动时冻结的配置快照。

### 8.6 第 23 周：诊断、无障碍与国际化

- 生成用户主动触发的诊断包：版本、平台、脱敏日志、协议握手、配置摘要和最近错误；默认不包含聊天正文、文件内容和密钥。
- 诊断包生成前展示内容清单，用户可逐项取消；最终再次执行 canary 脱敏扫描。
- 建立中英文消息目录，UI 文案、错误、空状态和权限说明不得散落硬编码。
- 关键流程支持仅键盘完成：新会话、发送、取消、查看工具、审批/拒绝、设置与恢复。
- 补充语义标签、焦点管理、状态播报、对比度、缩放和减少动画支持，并用读屏进行人工验收。

### 8.7 第 24 周：发布候选与恢复演练

- 构建安装、升级、降级阻止、卸载和重装测试矩阵。
- 执行从旧数据库版本逐级迁移、迁移中断、WAL 恢复和备份还原演练。
- 生成 SBOM、第三方许可证、版本说明和安全公告入口。
- 准备代码签名与更新签名流程；开源测试构建可无商业证书，但正式发布不得绕过完整性校验。
- 在干净 VM 完成端到端回归：安装 -> 配置凭据 -> 对话 -> 审批工具 -> 取消 -> 崩溃恢复 -> 导出诊断 -> 卸载。

### 8.8 阶段 4 验收

- [ ] 应用重启后会话、消息、Run 和工具记录不丢失。
- [ ] 非终态 Run 在崩溃恢复后统一变为 `interrupted`，不存在“永久执行中”。
- [ ] 数据库迁移、迁移失败回滚、WAL 恢复、备份还原和磁盘故障测试通过。
- [ ] 凭据不进入 SQLite、日志、诊断包或子进程环境。
- [ ] diff/命令预览与审批闭环覆盖所有高风险工具。
- [ ] 系统代理、自定义 CA 和连接诊断可用且错误可理解。
- [ ] 核心流程可完全用键盘操作，并通过至少一种 Windows 读屏软件验收。
- [ ] 中英文界面不存在关键流程缺失翻译。

### 8.9 阶段 4 退出门槛

发布候选在干净 Windows VM 完成端到端测试；重启不丢会话，数据库迁移与恢复全部通过，关键流程支持键盘和读屏，诊断包通过秘密扫描。

## 9. 横向质量要求

以下要求贯穿全部阶段，不单独等待“质量周”处理：

- **架构边界**：跨层类型只进入 `packages/protocol`；包之间只从入口导入。
- **安全默认值**：缺失配置、解析失败、超时和不兼容一律 fail closed。
- **可观测性**：日志使用结构化事件、关联 `runId/toolCallId`，默认脱敏且有大小/保留上限。
- **错误体验**：内部错误码稳定，外层提供中文上下文；不得向用户展示秘密或无上下文的第三方堆栈。
- **测试策略**：单元测试覆盖纯逻辑，契约测试覆盖边界，集成测试覆盖真实 Windows 行为，端到端测试覆盖发布包。
- **依赖治理**：锁文件、许可证、SBOM 和高危漏洞检查进入 CI；升级依赖必须通过完整回归。
- **文档同步**：协议、安全不变量、ADR、迁移和发布流程发生变化时，与代码在同一变更中更新。

## 10. 每阶段交付物清单

| 阶段 | 必须交付的代码 | 必须交付的文档/证据 |
| --- | --- | --- |
| 0 | 默认拒绝策略、秘密保护、安全路径修复、安全定向测试 | 威胁模型、数据地图、安全不变量、关键 ADR |
| 1 | 可复现脚本、Windows CI、真实测试、Protocol v1、Run 状态机 | 构建矩阵、golden fixtures、干净检出报告 |
| 2 | Sidecar、framed IPC、握手、RunManager、取消/超时、进程树清理 | 打包 ADR、生命周期故障矩阵、干净 VM 报告 |
| 3 | Tool Broker、审批协议、环境清洗、Job Object 配额、安全路径 API、网络策略 | 安全评测集、红队报告、残余风险清单 |
| 4 | SQLite/WAL、journal、恢复、上下文裁剪、完整 UI、凭据/代理/CA、诊断、i18n/a11y | 迁移演练、恢复演练、读屏验收、发布清单、SBOM |

## 11. 单人开发执行建议

- 每周只设置一个主里程碑，预留约 20% 时间修复安全与集成问题。
- 每个工作包拆成 0.5–2 天可完成的 Issue，并附验收命令或攻击样例。
- 阶段内优先完成纵向闭环，再扩展边缘能力；例如先让一种写工具完成“预览—审批—执行—记录”，再覆盖全部写工具。
- 第 2、3、4 阶段各保留一周用于故障注入、修复和文档，不把 24 周排成纯功能开发。
- 若进度延误，优先缩减非核心 UI、持久授权规则和多平台适配，不削减秘密保护、路径安全、进程清理、协议契约与恢复测试。

## 12. 最终完成定义

全部阶段完成需要同时满足：

- 干净检出可稳定执行 `check/build/test`，Windows CI 无假绿。
- 安装包在无开发环境的干净 Windows 机器可运行。
- 协议跨 TypeScript/Rust 契约一致，Run exactly-once 终态成立。
- 未授权写入、命令、网络、秘密访问，工作区逃逸和秘密泄漏均为零。
- Runtime/工具进程在完成、取消、超时、崩溃和应用退出后无残留。
- 会话和 Run journal 可持久化，崩溃、迁移和数据库故障可恢复。
- 高风险操作可预览、可拒绝、可审计，设置与凭据符合本地安全边界。
- 核心桌面流程支持键盘和读屏，具备中英文基础。
- 架构边界、威胁模型、ADR、发布和贡献文档与实现保持一致。
