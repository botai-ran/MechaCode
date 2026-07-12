# 安全不变量

状态：阶段 0 冻结清单。代码评审、测试和 ADR 必须引用同一组不变量。

1. 默认配置下，`write`、`command` 和工具 `network` 能力关闭。
2. UI 不是安全边界；所有工具在真实执行前必须由 `packages/agent-tools` 复验策略。
3. Runtime 在 Run 开始冻结能力快照，运行中不得因 UI 设置变化提升权限。
4. 工具路径必须是工作区相对路径，不接受绝对路径、UNC、设备路径、NT namespace、`../`、ADS、Windows 设备名和尾随点/空格混淆。
5. 读取目标必须解析真实路径，并确认最终目标仍在 workspace root 内。
6. 写入目标必须校验最近存在父目录的真实路径，创建父目录后、落盘前再次复验父目录身份。
7. 搜索递归不得跟随 symlink、junction 或 reparse point 进入 workspace root 外部。
8. `.env`、`.env.*`、私钥、SSH/云/Git 凭据、系统凭据目录和应用凭据存储默认不可被工具读取、搜索、写入或加入模型上下文。
9. 子进程环境必须采用显式 allowlist，不继承 provider key、代理凭据、Git/SSH 凭据或疑似秘密变量。
10. 工具输出、错误详情和诊断文本进入 Runtime、UI 或模型前必须统一脱敏。
11. Provider 原始请求、响应和事件类型不得穿透到 `packages/protocol`。
12. 任何无法证明安全的能力必须 fail closed。
