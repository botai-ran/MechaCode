#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const [, , sidecarPathArg, targetTripleArg, outputPathArg] = process.argv;

if (!sidecarPathArg || !targetTripleArg || !outputPathArg) {
  console.error(
    "用法：node scripts/build-sidecar-manifest.mjs <sidecar-path> <target-triple> <output-json>"
  );
  process.exit(1);
}

const sidecarPath = resolve(sidecarPathArg);
const outputPath = resolve(outputPathArg);
const bytes = readFileSync(sidecarPath);
const packageJson = JSON.parse(
  readFileSync(resolve("packages/agent-runtime/package.json"), "utf8")
);
const gitCommit = readGitCommit();
const manifest = {
  sidecar: basename(sidecarPath),
  runtimeVersion: packageJson.version,
  protocolVersion: "1.0.0",
  targetTriple: targetTripleArg,
  gitCommit,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  sizeBytes: bytes.byteLength,
  generatedAt: new Date().toISOString()
};

writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);

function readGitCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "unknown";
  }
}
