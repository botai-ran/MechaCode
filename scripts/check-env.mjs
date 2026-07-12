import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const REQUIRED_NODE_MAJOR = 22;
const REQUIRED_PNPM_MAJOR = 11;
const REQUIRED_TYPESCRIPT_VERSION = "5.9.3";
const PNPM_COMMAND = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const TSC_SCRIPT = path.join(
  process.cwd(),
  "node_modules",
  "typescript",
  "bin",
  "tsc"
);

const failures = [];

checkNode();
checkPnpm();
checkTypeScript();
checkRust();

if (failures.length > 0) {
  console.error("环境自检失败：");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("环境自检通过：Node.js、pnpm、TypeScript 与 Rust 工具链满足当前阶段要求。");

function checkNode() {
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "", 10);

  if (major !== REQUIRED_NODE_MAJOR) {
    failures.push(`Node.js 需要 22.x，当前为 ${process.version}。`);
  }
}

function checkPnpm() {
  const version = readPnpmVersion();
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);

  if (!version) {
    failures.push("未找到 pnpm，请安装 pnpm 11.x。");
    return;
  }

  if (major !== REQUIRED_PNPM_MAJOR) {
    failures.push(`pnpm 需要 11.x，当前为 ${version}。`);
  }
}

function checkTypeScript() {
  const version = readCommandVersion(process.execPath, [TSC_SCRIPT, "--version"]);
  const normalized = version.replace(/^Version\s+/i, "").trim();

  if (!normalized) {
    failures.push("未能读取 TypeScript 版本。");
    return;
  }

  if (normalized !== REQUIRED_TYPESCRIPT_VERSION) {
    failures.push(
      `TypeScript 需要 ${REQUIRED_TYPESCRIPT_VERSION}，当前为 ${normalized}。`
    );
  }
}

function checkRust() {
  const version = readCommandVersion("rustc", ["--version"]);
  const verbose = readCommandVersion("rustc", ["-vV"]);
  const activeToolchain = readCommandVersion("rustup", ["show", "active-toolchain"]);

  if (!version) {
    failures.push("未找到 rustc，请安装 Rust stable MSVC 工具链。");
    return;
  }

  if (activeToolchain && !activeToolchain.startsWith("stable")) {
    failures.push(`Rust 需要 stable 工具链，当前为 ${activeToolchain}。`);
  }

  if (process.platform === "win32" && !verbose.includes("host: x86_64-pc-windows-msvc")) {
    failures.push(`Windows 发布验收需要 x86_64-pc-windows-msvc，当前 rustc 信息为 ${verbose}。`);
  }
}

function readCommandVersion(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();
  } catch {
    return "";
  }
}

function readPnpmVersion() {
  const userAgent = process.env.npm_config_user_agent ?? "";
  const match = userAgent.match(/\bpnpm\/(\d+\.\d+\.\d+)/);

  if (match?.[1]) {
    return match[1];
  }

  return readCommandVersion(PNPM_COMMAND, ["--version"]);
}
