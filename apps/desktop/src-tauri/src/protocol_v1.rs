// 这个模块先服务于 Protocol v1 双端契约测试；Runtime/Tauri 事件流切到 v1 后会接入运行路径。
#![allow(dead_code)]

use serde::Deserialize;
use serde_json::Value;

const PROTOCOL_MAJOR_VERSION_V1: u64 = 1;
const MAX_SAFE_JSON_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProtocolEnvelopeV1 {
    protocol_version: String,
    run_id: String,
    seq: u64,
    #[serde(rename = "type")]
    event_type: String,
    payload: Value,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum ProtocolDecodeStatus {
    Ok,
    Ignored,
    Error,
}

#[derive(Debug)]
pub(crate) struct ProtocolDecodeResult {
    pub(crate) status: ProtocolDecodeStatus,
    pub(crate) code: Option<&'static str>,
}

/// 校验已经解析为 JSON Value 的 Protocol v1 消息。
///
/// Rust 侧使用与 TypeScript 相同的 golden fixtures，保证 Tauri 边界理解的
/// 信封字段、版本兼容策略和 payload 约束不会和协议包漂移。
pub(crate) fn decode_protocol_envelope_v1(input: &Value) -> ProtocolDecodeResult {
    let Some(object) = input.as_object() else {
        return error("PROTOCOL_INVALID_MESSAGE");
    };

    let Some(protocol_version) = object.get("protocolVersion").and_then(Value::as_str) else {
        return error("PROTOCOL_INVALID_VERSION");
    };

    let Some(major_version) = parse_major_version(protocol_version) else {
        return error("PROTOCOL_INVALID_VERSION");
    };

    if major_version != PROTOCOL_MAJOR_VERSION_V1 {
        return error("PROTOCOL_INCOMPATIBLE_VERSION");
    }

    let Some(run_id) = object.get("runId").and_then(Value::as_str) else {
        return error("PROTOCOL_INVALID_RUN_ID");
    };

    if run_id.trim().is_empty() {
        return error("PROTOCOL_INVALID_RUN_ID");
    }

    let Some(seq) = object.get("seq").and_then(Value::as_u64) else {
        return error("PROTOCOL_INVALID_SEQ");
    };

    if seq > MAX_SAFE_JSON_INTEGER {
        return error("PROTOCOL_INVALID_SEQ");
    }

    let Some(event_type) = object.get("type").and_then(Value::as_str) else {
        return error("PROTOCOL_INVALID_TYPE");
    };

    if event_type.trim().is_empty() {
        return error("PROTOCOL_INVALID_TYPE");
    }

    if !is_known_event_type(event_type) {
        return ProtocolDecodeResult {
            status: ProtocolDecodeStatus::Ignored,
            code: Some("PROTOCOL_UNKNOWN_EVENT"),
        };
    }

    let Some(payload) = object.get("payload").and_then(Value::as_object) else {
        return error("PROTOCOL_INVALID_PAYLOAD");
    };

    let Ok(envelope) = serde_json::from_value::<ProtocolEnvelopeV1>(input.clone()) else {
        return error("PROTOCOL_INVALID_MESSAGE");
    };

    if let Some(code) = validate_payload(&envelope.event_type, payload) {
        return error(code);
    }

    ProtocolDecodeResult {
        status: ProtocolDecodeStatus::Ok,
        code: None,
    }
}

fn validate_payload(
    event_type: &str,
    payload: &serde_json::Map<String, Value>,
) -> Option<&'static str> {
    match event_type {
        "run_start" | "model_request_start" => None,
        "run_done" => validate_run_done_payload(payload),
        "security_snapshot" => validate_security_snapshot_payload(payload),
        "message_start" => validate_message_start_payload(payload),
        "text_delta" => validate_text_delta_payload(payload),
        "message_done" => validate_string_field(payload, "messageId", "PROTOCOL_INVALID_MESSAGE_ID"),
        "tool_call_start" => validate_tool_call_start_payload(payload),
        "tool_approval_request" => validate_tool_approval_request_payload(payload),
        "tool_approval_resolved" => validate_tool_approval_resolved_payload(payload),
        "tool_call_done" => {
            validate_string_field(payload, "toolCallId", "PROTOCOL_INVALID_TOOL_CALL_ID")
        }
        "tool_result" => validate_tool_result_payload(payload),
        "error" => validate_error_payload(payload),
        _ => Some("PROTOCOL_UNKNOWN_EVENT"),
    }
}

fn validate_tool_approval_request_payload(
    payload: &serde_json::Map<String, Value>,
) -> Option<&'static str> {
    if let Some(code) = validate_string_field(payload, "approvalId", "PROTOCOL_INVALID_APPROVAL_ID")
    {
        return Some(code);
    }

    if let Some(code) = validate_tool_call_start_payload(payload) {
        return Some(code);
    }

    validate_string_field(payload, "reason", "PROTOCOL_INVALID_APPROVAL_REASON")
}

fn validate_tool_approval_resolved_payload(
    payload: &serde_json::Map<String, Value>,
) -> Option<&'static str> {
    if let Some(code) = validate_string_field(payload, "approvalId", "PROTOCOL_INVALID_APPROVAL_ID")
    {
        return Some(code);
    }

    if let Some(code) =
        validate_string_field(payload, "toolCallId", "PROTOCOL_INVALID_TOOL_CALL_ID")
    {
        return Some(code);
    }

    let Some(decision) = payload.get("decision").and_then(Value::as_str) else {
        return Some("PROTOCOL_INVALID_APPROVAL_DECISION");
    };

    if !matches!(decision, "approved" | "denied") {
        return Some("PROTOCOL_INVALID_APPROVAL_DECISION");
    }

    None
}

fn validate_run_done_payload(payload: &serde_json::Map<String, Value>) -> Option<&'static str> {
    let Some(status) = payload.get("status").and_then(Value::as_str) else {
        return Some("PROTOCOL_INVALID_TERMINAL_STATUS");
    };

    if !matches!(status, "completed" | "failed" | "cancelled" | "interrupted") {
        return Some("PROTOCOL_INVALID_TERMINAL_STATUS");
    }

    None
}

fn validate_security_snapshot_payload(
    payload: &serde_json::Map<String, Value>,
) -> Option<&'static str> {
    let Some(snapshot) = payload.get("snapshot").and_then(Value::as_object) else {
        return Some("PROTOCOL_INVALID_SECURITY_SNAPSHOT");
    };

    if snapshot.get("mode").and_then(Value::as_str) != Some("default_deny") {
        return Some("PROTOCOL_INVALID_SECURITY_MODE");
    }

    for field in ["read", "write", "command", "network", "sensitiveFileProtection"] {
        if !snapshot.get(field).is_some_and(Value::is_boolean) {
            return Some("PROTOCOL_INVALID_SECURITY_SNAPSHOT");
        }
    }

    if !is_non_empty_string(snapshot.get("policyVersion")) {
        return Some("PROTOCOL_INVALID_POLICY_VERSION");
    }

    if snapshot
        .get("frozenAt")
        .is_some_and(|value| !value.is_string())
    {
        return Some("PROTOCOL_INVALID_FROZEN_AT");
    }

    None
}

fn validate_message_start_payload(
    payload: &serde_json::Map<String, Value>,
) -> Option<&'static str> {
    if let Some(code) = validate_string_field(payload, "messageId", "PROTOCOL_INVALID_MESSAGE_ID") {
        return Some(code);
    }

    if payload.get("role").and_then(Value::as_str) != Some("assistant") {
        return Some("PROTOCOL_INVALID_ROLE");
    }

    None
}

fn validate_text_delta_payload(
    payload: &serde_json::Map<String, Value>,
) -> Option<&'static str> {
    if let Some(code) = validate_string_field(payload, "messageId", "PROTOCOL_INVALID_MESSAGE_ID") {
        return Some(code);
    }

    if !payload.get("text").is_some_and(Value::is_string) {
        return Some("PROTOCOL_INVALID_TEXT_DELTA");
    }

    None
}

fn validate_tool_call_start_payload(
    payload: &serde_json::Map<String, Value>,
) -> Option<&'static str> {
    if let Some(code) =
        validate_string_field(payload, "toolCallId", "PROTOCOL_INVALID_TOOL_CALL_ID")
    {
        return Some(code);
    }

    if let Some(code) = validate_string_field(payload, "name", "PROTOCOL_INVALID_TOOL_NAME") {
        return Some(code);
    }

    let Some(permission) = payload.get("permission").and_then(Value::as_str) else {
        return Some("PROTOCOL_INVALID_TOOL_PERMISSION");
    };

    if !matches!(permission, "command" | "network" | "read" | "write") {
        return Some("PROTOCOL_INVALID_TOOL_PERMISSION");
    }

    if !payload.contains_key("input") {
        return Some("PROTOCOL_INVALID_TOOL_INPUT");
    }

    None
}

fn validate_tool_result_payload(
    payload: &serde_json::Map<String, Value>,
) -> Option<&'static str> {
    if let Some(code) =
        validate_string_field(payload, "toolCallId", "PROTOCOL_INVALID_TOOL_CALL_ID")
    {
        return Some(code);
    }

    if !payload.contains_key("output") {
        return Some("PROTOCOL_INVALID_TOOL_OUTPUT");
    }

    None
}

fn validate_error_payload(payload: &serde_json::Map<String, Value>) -> Option<&'static str> {
    if let Some(code) = validate_string_field(payload, "code", "PROTOCOL_INVALID_ERROR_CODE") {
        return Some(code);
    }

    if let Some(code) = validate_string_field(payload, "message", "PROTOCOL_INVALID_ERROR_MESSAGE")
    {
        return Some(code);
    }

    if !payload.get("retryable").is_some_and(Value::is_boolean) {
        return Some("PROTOCOL_INVALID_ERROR_RETRYABLE");
    }

    let Some(source) = payload.get("source").and_then(Value::as_str) else {
        return Some("PROTOCOL_INVALID_ERROR_SOURCE");
    };

    if !matches!(
        source,
        "desktop" | "tauri" | "runtime" | "tools" | "provider" | "protocol"
    ) {
        return Some("PROTOCOL_INVALID_ERROR_SOURCE");
    }

    if payload
        .get("details")
        .is_some_and(|value| !value.is_object())
    {
        return Some("PROTOCOL_INVALID_ERROR_DETAILS");
    }

    None
}

fn validate_string_field(
    payload: &serde_json::Map<String, Value>,
    field: &str,
    code: &'static str,
) -> Option<&'static str> {
    if is_non_empty_string(payload.get(field)) {
        None
    } else {
        Some(code)
    }
}

fn is_known_event_type(event_type: &str) -> bool {
    matches!(
        event_type,
        "run_start"
            | "security_snapshot"
            | "model_request_start"
            | "message_start"
            | "text_delta"
            | "message_done"
            | "tool_call_start"
            | "tool_approval_request"
            | "tool_approval_resolved"
            | "tool_call_done"
            | "tool_result"
            | "error"
            | "run_done"
    )
}

fn is_non_empty_string(value: Option<&Value>) -> bool {
    value
        .and_then(Value::as_str)
        .is_some_and(|value| !value.trim().is_empty())
}

fn parse_major_version(version: &str) -> Option<u64> {
    let mut parts = version.split('.');
    let major = parts.next()?.parse::<u64>().ok()?;
    let minor = parts.next()?;
    let patch = parts.next()?;

    if parts.next().is_some() || minor.parse::<u64>().is_err() || patch.parse::<u64>().is_err() {
        return None;
    }

    Some(major)
}

fn error(code: &'static str) -> ProtocolDecodeResult {
    ProtocolDecodeResult {
        status: ProtocolDecodeStatus::Error,
        code: Some(code),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct InvalidFixture {
        name: String,
        expected_status: String,
        expected_code: String,
        message: Value,
    }

    const VALID_FIXTURES: &str = include_str!("../../../../packages/protocol/fixtures/v1/valid.json");
    const INVALID_FIXTURES: &str =
        include_str!("../../../../packages/protocol/fixtures/v1/invalid.json");

    #[test]
    fn protocol_v1_valid_fixtures_can_be_decoded() {
        let fixtures: Vec<Value> =
            serde_json::from_str(VALID_FIXTURES).expect("合法 fixture 必须是 JSON 数组");

        for fixture in fixtures {
            let result = decode_protocol_envelope_v1(&fixture);

            assert_eq!(result.status, ProtocolDecodeStatus::Ok, "{fixture:?}");
            assert_eq!(result.code, None, "{fixture:?}");
        }
    }

    #[test]
    fn protocol_v1_invalid_fixtures_return_stable_codes() {
        let fixtures: Vec<InvalidFixture> =
            serde_json::from_str(INVALID_FIXTURES).expect("非法 fixture 必须是 JSON 数组");

        for fixture in fixtures {
            let result = decode_protocol_envelope_v1(&fixture.message);
            let expected_status = match fixture.expected_status.as_str() {
                "error" => ProtocolDecodeStatus::Error,
                "ignored" => ProtocolDecodeStatus::Ignored,
                other => panic!("未知 fixture 期望状态：{other}"),
            };

            assert_eq!(result.status, expected_status, "{}", fixture.name);
            assert_eq!(
                result.code.as_deref(),
                Some(fixture.expected_code.as_str()),
                "{}",
                fixture.name
            );
        }
    }
}
