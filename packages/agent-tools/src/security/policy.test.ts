import assert from "node:assert/strict";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ToolRegistry, createDefaultToolRegistry } from "../core/registry.js";
import { createSafeProcessEnv } from "../process/environment.js";
import { isSensitiveWorkspacePath } from "./policy.js";
import { redactSecrets } from "./redaction.js";

test("默认策略拒绝写入、patch、命令和网络能力", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "mecha-tools-"));

  try {
    const registry = createDefaultToolRegistry({ workspaceRoot });
    const networkRegistry = new ToolRegistry();
    const writeFileTool = registry.get("write_file");
    const applyPatchTool = registry.get("apply_patch");
    const runCommandTool = registry.get("run_command");
    let networkCalled = false;

    networkRegistry.register({
      name: "fetch_url",
      description: "测试用网络工具。",
      permission: "network",
      async run() {
        networkCalled = true;
        return { ok: true };
      }
    });

    assert.ok(writeFileTool);
    assert.ok(applyPatchTool);
    assert.ok(runCommandTool);
    const networkTool = networkRegistry.get("fetch_url");
    assert.ok(networkTool);

    await assert.rejects(
      () =>
        writeFileTool.run({
          path: "note.txt",
          content: "hello"
        }),
      /默认安全策略已拒绝写入能力/
    );
    await assert.rejects(
      () => access(path.join(workspaceRoot, "note.txt")),
      /ENOENT/
    );

    await assert.rejects(
      () =>
        applyPatchTool.run({
          patch: [
            "diff --git a/a.txt b/a.txt",
            "--- a/a.txt",
            "+++ b/a.txt",
            "@@ -0,0 +1 @@",
            "+hello"
          ].join("\n")
        }),
      /默认安全策略已拒绝写入能力/
    );

    await assert.rejects(
      () =>
        runCommandTool.run({
          command: "node",
          args: ["--version"]
        }),
      /默认安全策略已拒绝命令执行能力/
    );
    await assert.rejects(
      () => access(path.join(workspaceRoot, "command-created.txt")),
      /ENOENT/
    );

    await assert.rejects(
      () => networkTool.run({ url: "https://example.test" }),
      /默认安全策略已拒绝工具网络访问能力/
    );
    assert.equal(networkCalled, false);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("默认策略拒绝读取敏感文件", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "mecha-tools-"));

  try {
    await writeFile(path.join(workspaceRoot, ".env"), "OPENAI_API_KEY=sk-test");
    const registry = createDefaultToolRegistry({ workspaceRoot });
    const readFileTool = registry.get("read_file");

    assert.ok(readFileTool);

    await assert.rejects(
      () => readFileTool.run({ path: ".env" }),
      /安全策略已拒绝访问敏感路径/
    );

    assert.equal(isSensitiveWorkspacePath(".ssh/id_ed25519"), true);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("搜索和列举默认跳过敏感文件", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "mecha-tools-"));

  try {
    await writeFile(path.join(workspaceRoot, ".env"), "MECHACODE_CANARY_secret");
    await writeFile(path.join(workspaceRoot, "regular.txt"), "normal content");
    const registry = createDefaultToolRegistry({ workspaceRoot });
    const searchTextTool = registry.get("search_text");
    const listDirTool = registry.get("list_dir");

    assert.ok(searchTextTool);
    assert.ok(listDirTool);

    const searchOutput = asRecord(
      await searchTextTool.run({ query: "MECHACODE_CANARY_secret", path: "." })
    );
    const listOutput = asRecord(await listDirTool.run({ path: "." }));

    assert.deepEqual(searchOutput.matches, []);
    assert.equal(
      (listOutput.entries as Array<{ path: string }>).some(
        (entry) => entry.path === ".env"
      ),
      false
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("工具输出会脱敏常见密钥和 canary secret", () => {
  const output = redactSecrets(
    "OPENAI_API_KEY=sk-1234567890abcdef MECHACODE_CANARY_should_not_leak"
  );

  assert.equal(output.includes("sk-1234567890abcdef"), false);
  assert.equal(output.includes("MECHACODE_CANARY_should_not_leak"), false);
  assert.equal(output.includes("[已脱敏]"), true);
});

test("子进程环境只保留 allowlist 并移除疑似秘密", () => {
  const env = createSafeProcessEnv({
    Path: "C:\\Windows\\System32",
    OPENAI_API_KEY: "sk-should-not-pass",
    HTTPS_PROXY: "https://user:pass@example.test",
    USERPROFILE: "C:\\Users\\tester"
  });

  assert.equal(env.Path, "C:\\Windows\\System32");
  assert.equal(env.USERPROFILE, "C:\\Users\\tester");
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.HTTPS_PROXY, undefined);
});

test("路径安全 API 拒绝越界、ADS 和 Windows 设备名", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "mecha-tools-"));

  try {
    await writeFile(path.join(workspaceRoot, "note.txt"), "hello");
    const registry = createDefaultToolRegistry({
      workspaceRoot,
      securitySnapshot: { write: true }
    });
    const readFileTool = registry.get("read_file");
    const writeFileTool = registry.get("write_file");

    assert.ok(readFileTool);
    assert.ok(writeFileTool);

    await assert.rejects(
      () => readFileTool.run({ path: "../outside.txt" }),
      /路径不能包含上级目录引用/
    );
    await assert.rejects(
      () => readFileTool.run({ path: "note.txt:secret" }),
      /Alternate Data Streams/
    );
    await assert.rejects(
      () => writeFileTool.run({ path: "CON", content: "blocked" }),
      /Windows 设备名/
    );

    const output = await writeFileTool.run({
      path: "safe/note.txt",
      content: "ok"
    });
    assert.equal(asRecord(output).path, "safe/note.txt");
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

function asRecord(value: unknown): Record<string, unknown> {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  return value as Record<string, unknown>;
}

test("apply_patch 会在执行 git 前拒绝越界路径", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "mecha-tools-"));

  try {
    const registry = createDefaultToolRegistry({
      workspaceRoot,
      securitySnapshot: { write: true }
    });
    const applyPatchTool = registry.get("apply_patch");

    assert.ok(applyPatchTool);

    await assert.rejects(
      () =>
        applyPatchTool.run({
          patch: [
            "diff --git a/inside.txt b/../outside.txt",
            "--- a/inside.txt",
            "+++ b/../outside.txt",
            "@@ -0,0 +1 @@",
            "+blocked"
          ].join("\n")
        }),
      /路径不能包含上级目录引用/
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
