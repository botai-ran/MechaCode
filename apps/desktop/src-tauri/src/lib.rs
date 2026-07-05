use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentChatRequest {
    provider: Option<String>,
    model: Option<String>,
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
struct AgentConfigResponse {
    default_provider: String,
    available_providers: Vec<String>,
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

fn run_agent_chat_blocking(request: AgentChatRequest) -> Result<AgentChatResponse, String> {
    let config = resolve_agent_config()?;
    let provider = request
        .provider
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| config.default_provider.clone());

    if !matches!(provider.as_str(), "openai" | "anthropic" | "deepseek") {
        return Err("不支持当前模型服务商。".to_string());
    }

    if request.messages.is_empty() {
        return Err("消息列表不能为空。".to_string());
    }

    let messages_json =
        serde_json::to_string(&request.messages).map_err(|error| error.to_string())?;
    let root = workspace_root()?;
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

fn workspace_root() -> Result<PathBuf, String> {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|path| path.parent())
        .and_then(|path| path.parent())
        .map(PathBuf::from)
        .ok_or_else(|| "解析工作区根目录失败。".to_string())
}

fn resolve_agent_config() -> Result<AgentConfigResponse, String> {
    let root = workspace_root()?;
    let env_content = fs::read_to_string(root.join(".env")).unwrap_or_default();
    let mut available_providers = Vec::new();

    if has_config_value(&env_content, "OPENAI_API_KEY") {
        available_providers.push("openai".to_string());
    }

    if has_config_value(&env_content, "ANTHROPIC_API_KEY") {
        available_providers.push("anthropic".to_string());
    }

    if has_config_value(&env_content, "DEEPSEEK_API_KEY") {
        available_providers.push("deepseek".to_string());
    }

    let default_provider = available_providers
        .first()
        .cloned()
        .unwrap_or_else(|| "openai".to_string());

    Ok(AgentConfigResponse {
        default_provider,
        available_providers,
    })
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
    const TABLE: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
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
        .invoke_handler(tauri::generate_handler![get_agent_config, run_agent_chat])
        .run(tauri::generate_context!())
        .expect("运行 Tauri 应用时出错");
}
