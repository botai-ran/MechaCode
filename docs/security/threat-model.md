# 阶段 0 威胁模型

状态：阶段 0 基线，后续 ADR 或实现改变安全边界时必须同步更新。

## 资产

- 用户消息、系统提示词、模型上下文摘要。
- 工作区文件内容、Git diff、patch 内容和命令输出。
- Provider API Key、代理凭据、Git/SSH/云凭据、canary secret。
- Run 事件、工具调用参数、工具结果、日志和诊断信息。
- 本地数据库、未来 OS 凭据库引用和应用设置。

## 信任边界

- UI 只负责展示状态和收集用户意图，不作为安全边界。
- Runtime 负责冻结 Run 级能力快照、编排模型与工具循环，不自行判断操作系统路径是否安全。
- Tools 是文件、搜索、Git、patch、命令执行的强制复验边界。
- Provider 配置层是唯一允许读取 API Key 的应用内部入口。
- 外部网页、仓库内容、工具输出和模型回复均视为不可信输入。

## 攻击者能力

- 通过 prompt injection 诱导模型调用工具、读取秘密或执行命令。
- 在工作区中放置恶意 symlink、junction、reparse point、ADS 或 Windows 设备名路径。
- 构造 patch、Git 路径、搜索路径或命令 cwd 触发工作区逃逸。
- 在文件内容、命令输出或错误对象中夹带秘密或危险指令。
- 依赖 UI 隐藏按钮或运行中设置变化绕过实际执行前校验。

## 入口

- 用户消息、历史消息和模型生成的工具调用参数。
- `read_file`、`list_dir`、`search_text`、`git_diff`、`git_status`、`apply_patch`、`run_command`。
- Tauri command、runtime CLI 参数、子进程环境和 stderr/stdout。
- `.env`、系统环境变量、代理配置和未来凭据库。

## 滥用场景与缓解

| 场景 | 缓解 |
| --- | --- |
| 模型请求写文件、应用 patch 或执行命令 | 默认安全快照关闭 `write`、`command`、`network`，Tools 执行前复验 |
| 读取 `.env`、SSH 私钥或云凭据 | 敏感路径规则默认拒绝读取、搜索、写入和加入模型上下文 |
| 通过 `../`、绝对路径、ADS 或设备名越界 | 统一安全路径 API 拒绝上级目录、绝对路径、UNC/设备路径、NT namespace、ADS、尾随点/空格和设备名 |
| 通过 symlink/junction 搜索工作区外内容 | 读取和搜索在真实路径上复验最终目标仍在 workspace root 内 |
| 子进程继承 provider key 或代理凭据 | 子进程环境使用显式 allowlist，疑似秘密变量一律移除 |
| 工具输出泄漏 key 或 canary | 文件读取、搜索结果和进程输出进入 Runtime 前统一脱敏 |
| UI 设置在 Run 中途提升权限 | Runtime 在 Run 开始冻结能力快照，后续事件使用同一快照 |

## 残余风险

- 阶段 0 暂未实现完整审批闭环；高风险动作以默认拒绝止血。
- patch 路径扫描是保守防线，后续阶段需要 Tool Broker 预览、审批和执行前复验。
- Windows reparse point 行为需要真实 Windows 临时目录和 junction 用例继续扩展。
- Provider 请求日志与诊断包的全链路脱敏会在诊断功能阶段继续加固。
