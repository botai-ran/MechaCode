import assert from "node:assert/strict";
import test from "node:test";

import type { RuntimeCapabilitySnapshot, ToolPermissionCategory } from "./index.js";

test("安全能力快照覆盖阶段 0 必要能力", () => {
  const permission: ToolPermissionCategory = "network";
  const snapshot: RuntimeCapabilitySnapshot = {
    mode: "default_deny",
    policyVersion: "default-deny-v0",
    read: true,
    write: false,
    command: false,
    network: false,
    sensitiveFileProtection: true
  };

  assert.equal(permission, "network");
  assert.equal(snapshot.mode, "default_deny");
  assert.equal(snapshot.write, false);
  assert.equal(snapshot.network, false);
});
