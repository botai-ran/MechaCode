import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const inputDir = path.resolve(process.argv[2] ?? "ci-logs");
const outputDir = path.resolve(process.argv[3] ?? "ci-logs-redacted");

const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g,
  /\bMECHACODE_CANARY_[A-Za-z0-9_-]+\b/g,
  /\b(?:OPENAI_API_KEY|ANTHROPIC_API_KEY|API_KEY|TOKEN|SECRET|PASSWORD|AUTH|CREDENTIAL)\s*=\s*([^\s"'`]+)/gi,
  /https?:\/\/[^:\s/]+:[^@\s/]+@[^\s]+/g
];

mkdirSync(outputDir, { recursive: true });

if (!existsDirectory(inputDir)) {
  console.log(`没有找到待脱敏日志目录：${inputDir}`);
  process.exit(0);
}

for (const fileName of readdirSync(inputDir)) {
  const inputPath = path.join(inputDir, fileName);
  const stats = statSync(inputPath);

  if (!stats.isFile()) {
    continue;
  }

  const content = readFileSync(inputPath, "utf8");
  writeFileSync(path.join(outputDir, fileName), redact(content));
}

console.log(`CI 日志已脱敏输出到：${outputDir}`);

function redact(content) {
  return SECRET_PATTERNS.reduce(
    (output, pattern) =>
      output.replace(pattern, (match) => {
        const assignment = match.match(/^([^=]+)=/);
        return assignment ? `${assignment[1]}=[已脱敏]` : "[已脱敏]";
      }),
    content
  );
}

function existsDirectory(directory) {
  try {
    return statSync(directory).isDirectory();
  } catch {
    return false;
  }
}
