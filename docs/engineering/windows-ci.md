# Windows CI

状态：阶段 1 基线。

## Workflow

`.github/workflows/windows-ci.yml` 提供两个 Windows job：

- `windows-baseline`：使用依赖缓存，执行安装、环境自检、`pnpm check`、`pnpm build`、`pnpm test` 和 Rust 测试。
- `clean-checkout`：不启用依赖产物缓存，安装后先执行 `pnpm clean`，再完整执行 `check/build/test/cargo test`，用于证明不依赖历史 `dist`。

## 失败日志

CI 命令输出会写入 `ci-logs`。失败时运行：

```powershell
node scripts/redact-ci-logs.mjs ci-logs ci-logs-redacted
```

脱敏后再上传 artifact，避免 provider key、proxy 凭据、token 或 canary secret 进入失败附件。

## 本地等价命令

```powershell
pnpm install --frozen-lockfile
pnpm clean
pnpm check
pnpm build
pnpm test
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```
