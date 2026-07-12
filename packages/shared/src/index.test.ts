import assert from "node:assert/strict";
import test from "node:test";

import { err, ok } from "./index.js";

test("Result helper 可以表达成功和失败分支", () => {
  assert.deepEqual(ok("done"), { ok: true, value: "done" });
  assert.deepEqual(err("失败"), { ok: false, error: "失败" });
});
