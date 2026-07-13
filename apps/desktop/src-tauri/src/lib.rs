use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State, WindowEvent};

mod protocol_v1;
mod run_manager;

use run_manager::{
    resolve_agent_config, AgentRunRequest, AgentRunStartedResponse, RunManager, ToolApprovalRequest,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentChatResponse {
    content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CancelAgentRunRequest {
    run_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentConfigResponse {
    pub(crate) default_provider: String,
    pub(crate) available_providers: Vec<String>,
    pub(crate) default_workspace_root: String,
    pub(crate) security_snapshot: RuntimeCapabilitySnapshot,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RuntimeCapabilitySnapshot {
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
    resolve_agent_config()
}

#[tauri::command]
async fn run_agent_chat(_request: Value) -> Result<AgentChatResponse, String> {
    Err("非流式聊天命令已迁移到 Runtime sidecar，请使用 start_agent_run 事件流。".to_string())
}

#[tauri::command]
async fn start_agent_run(
    app: AppHandle,
    manager: State<'_, Arc<RunManager>>,
    request: AgentRunRequest,
) -> Result<AgentRunStartedResponse, String> {
    manager.start_run(app, request)
}

#[tauri::command]
async fn cancel_agent_run(
    manager: State<'_, Arc<RunManager>>,
    request: CancelAgentRunRequest,
) -> Result<(), String> {
    manager.cancel_run(&request.run_id)
}

#[tauri::command]
async fn resolve_agent_tool_approval(
    manager: State<'_, Arc<RunManager>>,
    request: ToolApprovalRequest,
) -> Result<(), String> {
    manager.resolve_tool_approval(request)
}

pub(crate) fn default_security_snapshot() -> RuntimeCapabilitySnapshot {
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let run_manager = Arc::new(RunManager::default());

    tauri::Builder::default()
        .manage(run_manager)
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_agent_config,
            run_agent_chat,
            start_agent_run,
            cancel_agent_run,
            resolve_agent_tool_approval
        ])
        .on_window_event(|window, event| {
            if matches!(event, WindowEvent::CloseRequested { .. }) {
                let manager = window.app_handle().state::<Arc<RunManager>>();
                manager.shutdown_all();
            }
        })
        .run(tauri::generate_context!())
        .expect("运行 Tauri 应用时出错");
}
