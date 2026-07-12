import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const SOURCE_ROOTS = ["apps", "packages"];
const FILE_EXTENSIONS = new Set([".ts", ".tsx"]);
const DEEP_IMPORT_PATTERNS = [
  /from\s+["']@mecha\/[^"']+\/src(?:\/[^"']*)?["']/g,
  /import\s*\(\s*["']@mecha\/[^"']+\/src(?:\/[^"']*)?["']\s*\)/g,
  /from\s+["'][^"']*packages\/[^"']+\/src(?:\/[^"']*)?["']/g,
  /import\s*\(\s*["'][^"']*packages\/[^"']+\/src(?:\/[^"']*)?["']\s*\)/g
];

const failures = [];

for (const sourceRoot of SOURCE_ROOTS) {
  walk(path.join(ROOT, sourceRoot));
}

if (failures.length > 0) {
  console.error("工作区导入边界检查失败：禁止跨包 deep import 到另一个包的 src。");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("工作区导入边界检查通过。");

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "dist" || entry.name === "node_modules" || entry.name === "target") {
      continue;
    }

    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }

    if (!FILE_EXTENSIONS.has(path.extname(entry.name))) {
      continue;
    }

    checkFile(fullPath);
  }
}

function checkFile(filePath) {
  const content = readFileSync(filePath, "utf8");

  for (const pattern of DEEP_IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of content.matchAll(pattern)) {
      failures.push(`${path.relative(ROOT, filePath)}: ${match[0]}`);
    }
  }
}
