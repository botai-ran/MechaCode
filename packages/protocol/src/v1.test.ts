import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createProtocolEnvelopeV1,
  createSidecarHelloAckV1,
  createSidecarHelloV1,
  decodeProtocolEnvelopeJsonV1,
  decodeProtocolEnvelopeV1,
  encodeProtocolEnvelopeJsonV1,
  PROTOCOL_VERSION_V1,
  SIDECAR_MAX_FRAME_BYTES,
  PROTOCOL_V1_SCHEMA
} from "./index.js";
import type { AnyProtocolEnvelopeV1 } from "./index.js";

interface InvalidFixture {
  /** fixture 名称，用于失败时定位是哪一类协议边界不一致。 */
  name: string;
  /** 期望解码器返回的状态。 */
  expectedStatus: "error" | "ignored";
  /** 期望稳定错误码。 */
  expectedCode: string;
  /** 待校验的未可信协议消息。 */
  message: unknown;
}

interface ProtocolSchemaFixture {
  /** Mecha 协议测试使用的 schema 元数据。 */
  "x-mecha": typeof PROTOCOL_V1_SCHEMA;
}

const schemaFixture = readSchema<ProtocolSchemaFixture>();
const validFixtures = readFixture<AnyProtocolEnvelopeV1[]>("valid.json");
const invalidFixtures = readFixture<InvalidFixture[]>("invalid.json");

test("Protocol v1 schema 声明必要的信封字段和兼容策略", () => {
  assert.deepEqual(PROTOCOL_V1_SCHEMA, schemaFixture["x-mecha"]);
  assert.deepEqual(PROTOCOL_V1_SCHEMA.requiredEnvelopeFields, [
    "protocolVersion",
    "runId",
    "seq",
    "type",
    "payload"
  ]);
  assert.equal(PROTOCOL_V1_SCHEMA.compatibility.sameMajorVersion, "backward_compatible");
  assert.equal(PROTOCOL_V1_SCHEMA.compatibility.unknownEvent, "ignore");
  assert.equal(PROTOCOL_V1_SCHEMA.compatibility.incompatibleMajorVersion, "fail_handshake");
});

test("Protocol v1 golden fixtures 可以完成对象校验和 JSON 往返", () => {
  for (const fixture of validFixtures) {
    const objectResult = decodeProtocolEnvelopeV1(fixture);

    assert.equal(objectResult.status, "ok");

    const json = encodeProtocolEnvelopeJsonV1(fixture);
    const jsonResult = decodeProtocolEnvelopeJsonV1(json);

    assert.equal(jsonResult.status, "ok");

    if (jsonResult.status === "ok") {
      assert.deepEqual(jsonResult.message, fixture);
    }
  }
});

test("Protocol v1 创建函数会填充默认版本并校验 payload", () => {
  const message = createProtocolEnvelopeV1({
    runId: "run-created",
    seq: 1,
    type: "message_start",
    payload: {
      messageId: "message-created",
      role: "assistant"
    }
  });

  assert.equal(message.protocolVersion, PROTOCOL_VERSION_V1);
  assert.equal(message.type, "message_start");
});

test("Sidecar v1 握手消息使用 Protocol v1 和有界帧", () => {
  const hello = createSidecarHelloV1({
    runtimeVersion: "0.1.0-test",
    instanceId: "sidecar-test"
  });
  const ack = createSidecarHelloAckV1();

  assert.equal(hello.type, "hello");
  assert.equal(hello.protocolVersion, PROTOCOL_VERSION_V1);
  assert.equal(hello.maxFrameBytes, SIDECAR_MAX_FRAME_BYTES);
  assert.deepEqual(hello.capabilities, [
    "framed_ipc",
    "protocol_v1",
    "single_run",
    "cooperative_cancel"
  ]);
  assert.deepEqual(ack, {
    type: "hello_ack",
    protocolVersion: PROTOCOL_VERSION_V1,
    maxFrameBytes: SIDECAR_MAX_FRAME_BYTES
  });
});

test("Protocol v1 接受同一主版本并忽略未知字段", () => {
  const result = decodeProtocolEnvelopeV1({
    protocolVersion: "1.2.3",
    runId: "run-compatible",
    seq: 1,
    type: "text_delta",
    payload: {
      messageId: "message-compatible",
      text: "增量",
      futureField: true
    },
    futureEnvelopeField: "ignored"
  });

  assert.equal(result.status, "ok");
});

test("Protocol v1 invalid fixtures 返回稳定状态和错误码", () => {
  for (const fixture of invalidFixtures) {
    const result = decodeProtocolEnvelopeV1(fixture.message);

    assert.equal(result.status, fixture.expectedStatus, fixture.name);

    if (result.status === "error" || result.status === "ignored") {
      assert.equal(result.error.code, fixture.expectedCode, fixture.name);
    } else {
      assert.fail(`非法 fixture 不应通过校验：${fixture.name}`);
    }
  }
});

test("Protocol v1 JSON 解码拒绝超长消息和非法 JSON", () => {
  const validJson = JSON.stringify(validFixtures[0]);
  const tooLarge = decodeProtocolEnvelopeJsonV1(validJson, {
    maxBytes: 8
  });
  const invalidJson = decodeProtocolEnvelopeJsonV1("{", {
    maxBytes: 1024
  });

  assert.equal(tooLarge.status, "error");
  assert.equal(invalidJson.status, "error");

  if (tooLarge.status === "error") {
    assert.equal(tooLarge.error.code, "PROTOCOL_MESSAGE_TOO_LARGE");
  }

  if (invalidJson.status === "error") {
    assert.equal(invalidJson.error.code, "PROTOCOL_INVALID_JSON");
  }
});

function readFixture<T>(name: string): T {
  const url = new URL(`../fixtures/v1/${name}`, import.meta.url);

  return JSON.parse(readFileSync(url, "utf8")) as T;
}

function readSchema<T>(): T {
  const url = new URL("../schema/protocol-v1.schema.json", import.meta.url);

  return JSON.parse(readFileSync(url, "utf8")) as T;
}
