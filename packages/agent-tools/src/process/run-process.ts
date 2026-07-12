import { spawn } from "node:child_process";

import type { RunProcessOptions, RunProcessResult } from "../core/types.js";
import { redactSecrets } from "../security/redaction.js";
import { createSafeProcessEnv } from "./environment.js";

/**
 * 启动子进程并收集标准输出与标准错误。
 *
 * 该实现统一处理超时、退出信息和输出截断，避免每个工具重复造轮子。
 */
export function runProcess(
  options: RunProcessOptions
): Promise<RunProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: createSafeProcessEnv(),
      shell: false,
      windowsHide: true
    });
    const stdout = createOutputCollector(options.maxOutputBytes);
    const stderr = createOutputCollector(options.maxOutputBytes);
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolve({
        exitCode,
        signal,
        timedOut,
        stdout: redactSecrets(stdout.text()),
        stderr: redactSecrets(stderr.text()),
        stdoutTruncated: stdout.truncated(),
        stderrTruncated: stderr.truncated()
      });
    });

    if (options.input !== undefined) {
      child.stdin.end(options.input);
    }
  });
}

/** 按字节数上限截断输出的收集器。 */
function createOutputCollector(maxBytes: number): {
  push(chunk: Buffer): void;
  text(): string;
  truncated(): boolean;
} {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  let wasTruncated = false;

  return {
    push(chunk) {
      if (totalBytes >= maxBytes) {
        wasTruncated = true;
        return;
      }

      const remaining = maxBytes - totalBytes;
      const nextChunk = chunk.byteLength > remaining
        ? chunk.subarray(0, remaining)
        : chunk;

      chunks.push(nextChunk);
      totalBytes += nextChunk.byteLength;

      if (nextChunk.byteLength < chunk.byteLength) {
        wasTruncated = true;
      }
    },
    text() {
      return Buffer.concat(chunks).toString("utf8");
    },
    truncated() {
      return wasTruncated;
    }
  };
}
