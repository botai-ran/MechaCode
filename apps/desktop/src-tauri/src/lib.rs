use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

const AGENT_RUN_EVENT: &str = "agent-run-event";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentChatRequest {
    provider: Option<String>,
    model: Option<String>,
    messages: Vec<AgentChatMessage>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentRunRequest {
    run_id: Option<String>,
    message_id: Option<String>,
    provider: Option<String>,
    model: Option<String>,
    workspace_root: Option<String>,
    messages: Vec<AgentChatMessage>,
}

#[derive(Debug, Deserialize, Serialize)]
struct AgentChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentChatResponse {
    content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentRunStartedResponse {
    run_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentConfigResponse {
    default_provider: String,
    available_providers: Vec<String>,
    default_workspace_root: String,
    security_snapshot: RuntimeCapabilitySnapshot,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeCapabilitySnapshot {
    mode: String,
    policy_version: String,
    read: bool,
    write: bool,
    command: bool,
    network: bool,
    sensitive_file_protection: bool,
}

#[tauri::command]
fn get_agent_config() -> Result<AgentConfigResponse, String> {
    Ok(resolve_agent_config()?)
}

#[tauri::command]
async fn run_agent_chat(request: AgentChatRequest) -> Result<AgentChatResponse, String> {
    tauri::async_runtime::spawn_blocking(move || run_agent_chat_blocking(request))
        .await
        .map_err(|error| format!("agent 后台任务执行失败：{error}"))?
}

#[tauri::command]
async fn start_agent_run(
    app: AppHandle,
    request: AgentRunRequest,
) -> Result<AgentRunStartedResponse, String> {
    let run_id = request
        .run_id
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(create_run_id);

    let response = AgentRunStartedResponse {
        run_id: run_id.clone(),
    };

    tauri::async_runtime::spawn_blocking(move || {
        if let Err(error) = run_agent_run_streaming(app.clone(), request, run_id.clone()) {
            emit_agent_error(&app, &run_id, error);
        }
    });

    Ok(response)
}

fn run_agent_chat_blocking(request: AgentChatRequest) -> Result<AgentChatResponse, String> {
    let config = resolve_agent_config()?;
    let provider = request
        .provider
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| config.default_provider.clone());

    if !matches!(provider.as_str(), "openai" | "anthropic") {
        return Err("不支持当前模型服务商。".to_string());
    }

    if request.messages.is_empty() {
        return Err("消息列表不能为空。".to_string());
    }

    let messages_json =
        serde_json::to_string(&request.messages).map_err(|error| error.to_string())?;
    let root = repo_root()?;
    let mut command = Command::new(pnpm_command());

    command
        .current_dir(root)
        .arg("--silent")
        .arg("--filter")
        .arg("@mecha/agent-runtime")
        .arg("chat")
        .arg("--")
        .arg("--provider")
        .arg(provider)
        .arg("--no-tools")
        .arg("--no-stream");

    if let Some(model) = request.model.filter(|value| !value.trim().is_empty()) {
        command.arg("--model").arg(model);
    }

    let output = command
        .arg("--messages-json-base64")
        .arg(base64_encode(messages_json.as_bytes()))
        .output()
        .map_err(|error| format!("启动 agent 运行时失败：{error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if stderr.is_empty() { stdout } else { stderr };

        let message = if detail.is_empty() {
            "agent 运行时已退出，但没有返回错误信息。".to_string()
        } else {
            format!("agent 运行时执行失败：{detail}")
        };

        return Err(message);
    }

    Ok(AgentChatResponse {
        content: String::from_utf8_lossy(&output.stdout).trim().to_string(),
    })
}

fn run_agent_run_streaming(
    app: AppHandle,
    request: AgentRunRequest,
    run_id: String,
) -> Result<(), String> {
    let config = resolve_agent_config()?;
    let provider = normalize_provider(request.provider, &config)?;

    if request.messages.is_empty() {
        return Err("消息列表不能为空。".to_string());
    }

    let messages_json =
        serde_json::to_string(&request.messages).map_err(|error| error.to_string())?;
    let root = repo_root()?;
    let workspace_root = resolve_agent_workspace_root(request.workspace_root.as_deref(), &root)?;
    let mut command = Command::new(pnpm_command());

    command
        .current_dir(root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .arg("--silent")
        .arg("--filter")
        .arg("@mecha/agent-runtime")
        .arg("chat")
        .arg("--")
        .arg("--provider")
        .arg(provider)
        .arg("--workspace-root")
        .arg(path_for_cli(&workspace_root))
        .arg("--events-json-lines")
        .arg("--run-id")
        .arg(&run_id);

    if let Some(message_id) = request.message_id.filter(|value| !value.trim().is_empty()) {
        command.arg("--message-id").arg(message_id);
    }

    if let Some(model) = request.model.filter(|value| !value.trim().is_empty()) {
        command.arg("--model").arg(model);
    }

    let mut child = command
        .arg("--messages-json-base64")
        .arg(base64_encode(messages_json.as_bytes()))
        .spawn()
        .map_err(|error| format!("启动 agent 运行时失败：{error}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "读取 agent 事件流失败：stdout 不可用。".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "读取 agent 错误流失败：stderr 不可用。".to_string())?;
    let stderr_handle = thread::spawn(move || read_stream_to_string(stderr));

    for line in BufReader::new(stdout).lines() {
        let line = line.map_err(|error| format!("读取 agent 事件失败：{error}"))?;

        if line.trim().is_empty() {
            continue;
        }

        let event: serde_json::Value =
            serde_json::from_str(&line).map_err(|error| format!("解析 agent 事件失败：{error}"))?;
        app.emit(AGENT_RUN_EVENT, event)
            .map_err(|error| format!("转发 agent 事件失败：{error}"))?;
    }

    let status = child
        .wait()
        .map_err(|error| format!("等待 agent 运行时退出失败：{error}"))?;
    let stderr = stderr_handle
        .join()
        .map_err(|_| "读取 agent 错误流线程失败。".to_string())?;

    if !status.success() {
        let detail = stderr.trim();
        let message = if detail.is_empty() {
            "agent 运行时已退出，但没有返回错误信息。".to_string()
        } else {
            format!("agent 运行时执行失败：{detail}")
        };

        return Err(message);
    }

    Ok(())
}

fn normalize_provider(
    provider: Option<String>,
    config: &AgentConfigResponse,
) -> Result<String, String> {
    let provider = provider
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| config.default_provider.clone());

    if !matches!(provider.as_str(), "openai" | "anthropic") {
        return Err("不支持当前模型服务商。".to_string());
    }

    Ok(provider)
}

fn emit_agent_error(app: &AppHandle, run_id: &str, message: String) {
    let _ = app.emit(
        AGENT_RUN_EVENT,
        json!({
            "type": "error",
            "runId": run_id,
            "message": message
        }),
    );
    let _ = app.emit(
        AGENT_RUN_EVENT,
        json!({
            "type": "run_done",
            "runId": run_id
        }),
    );
}

fn read_stream_to_string(mut stream: impl Read) -> String {
    let mut output = String::new();
    let _ = stream.read_to_string(&mut output);
    output
}

fn repo_root() -> Result<PathBuf, String> {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|path| path.parent())
        .and_then(|path| path.parent())
        .map(PathBuf::from)
        .ok_or_else(|| "解析工作区根目录失败。".to_string())
}

fn resolve_agent_workspace_root(
    requested_root: Option<&str>,
    default_root: &Path,
) -> Result<PathBuf, String> {
    let raw_path = requested_root
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| default_root.to_path_buf());
    let workspace_root = if raw_path.is_absolute() {
        raw_path
    } else {
        default_root.join(raw_path)
    };
    let metadata = fs::metadata(&workspace_root).map_err(|error| {
        format!(
            "读取 Agent 工作区失败：{}，原因：{error}",
            workspace_root.display()
        )
    })?;

    if !metadata.is_dir() {
        return Err(format!(
            "Agent 工作区必须是目录：{}",
            workspace_root.display()
        ));
    }

    Ok(workspace_root)
}

fn path_for_cli(path: &Path) -> String {
    normalize_windows_extended_path(path.to_string_lossy().as_ref())
}

#[cfg(target_os = "windows")]
fn normalize_windows_extended_path(path: &str) -> String {
    if let Some(rest) = path.strip_prefix("\\\\?\\UNC\\") {
        return format!("\\\\{rest}");
    }

    if let Some(rest) = path.strip_prefix("\\\\?\\") {
        return rest.to_string();
    }

    if let Some(rest) = path.strip_prefix("\\?\\") {
        return rest.to_string();
    }

    path.to_string()
}

#[cfg(not(target_os = "windows"))]
fn normalize_windows_extended_path(path: &str) -> String {
    path.to_string()
}

#[cfg(test)]
mod tests {
    use super::normalize_windows_extended_path;

    #[cfg(target_os = "windows")]
    #[test]
    fn normalizes_windows_extended_drive_path() {
        assert_eq!(
            normalize_windows_extended_path(r"\\?\D:\Study\Project\MechaCode"),
            r"D:\Study\Project\MechaCode"
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn normalizes_malformed_windows_extended_drive_path() {
        assert_eq!(
            normalize_windows_extended_path(r"\?\D:\Study\Project\MechaCode"),
            r"D:\Study\Project\MechaCode"
        );
    }
}

fn create_run_id() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();

    format!("run-{millis}")
}

fn resolve_agent_config() -> Result<AgentConfigResponse, String> {
    let root = repo_root()?;
    let env_content = fs::read_to_string(root.join(".env")).unwrap_or_default();
    let mut available_providers = Vec::new();

    if has_config_value(&env_content, "OPENAI_API_KEY") {
        available_providers.push("openai".to_string());
    }

    if has_config_value(&env_content, "ANTHROPIC_API_KEY") {
        available_providers.push("anthropic".to_string());
    }

    let default_provider = available_providers
        .first()
        .cloned()
        .unwrap_or_else(|| "openai".to_string());

    Ok(AgentConfigResponse {
        default_provider,
        available_providers,
        default_workspace_root: root.to_string_lossy().to_string(),
        security_snapshot: default_security_snapshot(),
    })
}

fn default_security_snapshot() -> RuntimeCapabilitySnapshot {
    RuntimeCapabilitySnapshot {
        mode: "default_deny".to_string(),
        policy_version: "default-deny-v0".to_string(),
        read: true,
        write: false,
        command: false,
        network: false,
        sensitive_file_protection: true,
    }
}

fn has_config_value(env_content: &str, key: &str) -> bool {
    if std::env::var(key)
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
    {
        return true;
    }

    env_content.lines().any(|line| {
        let trimmed = line.trim();

        if trimmed.starts_with('#') {
            return false;
        }

        let Some((name, value)) = trimmed.split_once('=') else {
            return false;
        };

        name.trim() == key && !value.trim().is_empty()
    })
}

#[cfg(target_os = "windows")]
fn pnpm_command() -> &'static str {
    "pnpm.cmd"
}

#[cfg(not(target_os = "windows"))]
fn pnpm_command() -> &'static str {
    "pnpm"
}

fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = String::with_capacity(bytes.len().div_ceil(3) * 4);

    for chunk in bytes.chunks(3) {
        let first = chunk[0];
        let second = *chunk.get(1).unwrap_or(&0);
        let third = *chunk.get(2).unwrap_or(&0);
        let combined = ((first as u32) << 16) | ((second as u32) << 8) | third as u32;

        output.push(TABLE[((combined >> 18) & 0x3f) as usize] as char);
        output.push(TABLE[((combined >> 12) & 0x3f) as usize] as char);

        if chunk.len() > 1 {
            output.push(TABLE[((combined >> 6) & 0x3f) as usize] as char);
        } else {
            output.push('=');
        }

        if chunk.len() > 2 {
            output.push(TABLE[(combined & 0x3f) as usize] as char);
        } else {
            output.push('=');
        }
    }

    output
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_agent_config,
            run_agent_chat,
            start_agent_run
        ])
        .run(tauri::generate_context!())
        .expect("运行 Tauri 应用时出错");
}
