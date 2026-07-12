# ADR 0004：Windows 路径安全与进程隔离策略

状态：阶段 0 已建立默认路径 API，阶段 2/3 继续进程树隔离。

## 背景

Windows 路径存在 symlink、junction、reparse point、ADS、设备名、UNC/NT namespace、大小写和尾随点/空格等绕过面。

## 决策

- 工具路径只接受工作区相对路径。
- 统一安全路径 API 拒绝 `../`、绝对路径、UNC、设备路径、NT namespace、ADS、Windows 设备名和尾随点/空格。
- 读取目标通过真实路径确认最终目标仍在 workspace root 内。
- 写入目标先验证最近存在父目录的真实路径，创建父目录后、落盘前复验父目录身份。
- 子进程环境采用显式 allowlist；阶段 2/3 使用 Job Object 管理完整进程树。

## 影响

- 文件、搜索、Git、patch 和命令 cwd 均不得自行拼接私有路径逻辑。
- Windows 特有路径攻击样本必须进入安全回归测试。
