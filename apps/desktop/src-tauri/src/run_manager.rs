use crate::protocol_v1::{decode_protocol_envelope_v1, ProtocolDecodeStatus};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

const AGENT_RUN_EVENT: &str = "agent-run-event";
const AGENT_RUN_LOG_PREFIX: &str = "[AgentRun]";
const SIDECAR_MAX_FRAME_BYTES: usize = 1024 * 1024;
const SIDECAR_HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(5);
const SIDECAR_CANCEL_GRACE: Duration = Duration::from_millis(1_500);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentRunRequest {
    pub(crate) run_id: Option<String>,
    pub(crate) message_id: Option<String>,
    pub(crate) provider: Option<String>,
    pub(crate) model: Option<String>,
    pub(crate) workspace_root: Option<String>,
    pub(crate) messages: Vec<AgentChatMessage>,
}

#[derive(Debug, Deserialize, Serialize)]
pub(crate) struct AgentChatMessage {
    pub(crate) role: String,
    pub(crate) content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentRunStartedResponse {
    pub(crate) run_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ToolApprovalRequest {
    pub(crate) run_id: String,
    pub(crate) approval_id: String,
    pub(crate) tool_call_id: String,
    pub(crate) decision: String,
}

#[derive(Default)]
pub(crate) struct RunManager {
    runs: Mutex<HashMap<String, Arc<RunProcess>>>,
}

struct RunProcess {
    run_id: String,
    stdin: Mutex<ChildStdin>,
    child: Mutex<Child>,
    terminal_sent: AtomicBool,
    cancel_reason: Mutex<Option<CancelReason>>,
    _job: process_job::RunJob,
}

#[derive(Clone, Copy)]
#[allow(dead_code)]
enum CancelReason {
    User,
    Timeout,
    AppExit,
}

impl CancelReason {
    fn as_protocol(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Timeout => "timeout",
            Self::AppExit => "app_exit",
        }
    }

    fn terminal_status(self) -> &'static str {
        match self {
            Self::User => "cancelled",
            Self::Timeout | Self::AppExit => "interrupted",
        }
    }
}

impl RunManager {
    pub(crate) fn start_run(
        self: &Arc<Self>,
        app: AppHandle,
        request: AgentRunRequest,
    ) -> Result<AgentRunStartedResponse, String> {
        let config = resolve_agent_config()?;
        let provider = normalize_provider(request.provider.clone(), &config)?;

        if request.messages.is_empty() {
            return Err("消息列表不能为空。".to_string());
        }

        let run_id = request
            .run_id
            .clone()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(create_run_id);
        let root = repo_root()?;
        let workspace_root = resolve_agent_workspace_root(request.workspace_root.as_deref(), &root)?;
        let sidecar_command = resolve_sidecar_command(&root)?;
        let mut command = sidecar_command.command();

        eprintln!(
            "{AGENT_RUN_LOG_PREFIX} Tauri 收到 start_agent_run：runId={run_id}，provider={provider}，messageCount={}，workspaceRoot={}",
            request.messages.len(),
            workspace_root.display()
        );

        command
            .current_dir(&root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = command
            .spawn()
            .map_err(|error| format!("启动 Runtime sidecar 失败：{error}"))?;
        eprintln!(
            "{AGENT_RUN_LOG_PREFIX} Runtime sidecar 已启动：runId={run_id}，pid={}",
            child.id()
        );
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Runtime sidecar stdin 不可用。".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Runtime sidecar stdout 不可用。".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Runtime sidecar stderr 不可用。".to_string())?;
        let job = process_job::assign_to_job(&child)
            .map_err(|error| format!("绑定 Runtime sidecar 进程树失败：{error}"))?;
        let process = Arc::new(RunProcess {
            run_id: run_id.clone(),
            stdin: Mutex::new(stdin),
            child: Mutex::new(child),
            terminal_sent: AtomicBool::new(false),
            cancel_reason: Mutex::new(None),
            _job: job,
        });

        {
            let mut runs = self
                .runs
                .lock()
                .map_err(|_| "RunManager 状态锁已损坏。".to_string())?;

            if runs.contains_key(&run_id) {
                return Err("相同 runId 的 Run 已经存在。".to_string());
            }

            runs.insert(run_id.clone(), process.clone());
        }

        let run_start = json!({
            "type": "run_start",
            "runId": run_id,
            "messageId": request.message_id.filter(|value| !value.trim().is_empty()),
            "provider": provider,
            "model": request.model.filter(|value| !value.trim().is_empty()),
            "workspaceRoot": path_for_cli(&workspace_root),
            "messages": request.messages,
            "useTools": true
        });
        let manager = Arc::clone(self);

        thread::spawn(move || {
            let stderr_handle = thread::spawn(move || read_stream_to_string(stderr));
            let result = drive_sidecar_run(app.clone(), manager.clone(), process.clone(), stdout, run_start);
            let stderr = stderr_handle.join().unwrap_or_default();

            if let Err(error) = result {
                let detail = if stderr.trim().is_empty() {
                    error
                } else {
                    format!("{error}；诊断：{}", stderr.trim())
                };

                manager.finish_run(&app, &process.run_id, "failed", Some(detail));
            }

            manager.remove_run(&process.run_id);
        });

        Ok(AgentRunStartedResponse { run_id })
    }

    pub(crate) fn cancel_run(&self, run_id: &str) -> Result<(), String> {
        let process = self
            .get_run(run_id)?
            .ok_or_else(|| "未找到可取消的 Run。".to_string())?;

        self.request_cancel(process, CancelReason::User)
    }

    pub(crate) fn resolve_tool_approval(&self, request: ToolApprovalRequest) -> Result<(), String> {
        if !matches!(request.decision.as_str(), "approved" | "denied") {
            return Err("工具审批决策必须是 approved 或 denied。".to_string());
        }

        let process = self
            .get_run(&request.run_id)?
            .ok_or_else(|| "未找到等待审批的 Run。".to_string())?;
        let message = json!({
            "type": "tool_approval",
            "runId": request.run_id,
            "approvalId": request.approval_id,
            "toolCallId": request.tool_call_id,
            "decision": request.decision
        });

        write_frame_locked(&process, &message)
    }

    pub(crate) fn shutdown_all(&self) {
        let runs = self.snapshot_runs();

        for process in runs {
            let _ = self.request_cancel(process.clone(), CancelReason::AppExit);
            force_kill_after_grace(process, SIDECAR_CANCEL_GRACE);
        }
    }

    fn request_cancel(&self, process: Arc<RunProcess>, reason: CancelReason) -> Result<(), String> {
        {
            let mut cancel_reason = process
                .cancel_reason
                .lock()
                .map_err(|_| "Run 取消状态锁已损坏。".to_string())?;

            if cancel_reason.is_none() {
                *cancel_reason = Some(reason);
            }
        }

        let message = json!({
            "type": "cancel",
            "runId": process.run_id,
            "reason": reason.as_protocol()
        });

        write_frame_locked(&process, &message)?;
        force_kill_after_grace(process, SIDECAR_CANCEL_GRACE);

        Ok(())
    }

    fn finish_run(
        &self,
        app: &AppHandle,
        run_id: &str,
        status: &str,
        error_message: Option<String>,
    ) {
        let Some(process) = self.get_run(run_id).ok().flatten() else {
            return;
        };

        if process.terminal_sent.swap(true, Ordering::SeqCst) {
            return;
        }

        if let Some(message) = error_message {
            let _ = app.emit(
                AGENT_RUN_EVENT,
                json!({
                    "type": "error",
                    "runId": run_id,
                    "message": message
                }),
            );
        }

        let _ = app.emit(
            AGENT_RUN_EVENT,
            json!({
                "type": "run_done",
                "runId": run_id,
                "status": status
            }),
        );
    }

    fn get_run(&self, run_id: &str) -> Result<Option<Arc<RunProcess>>, String> {
        self.runs
            .lock()
            .map(|runs| runs.get(run_id).cloned())
            .map_err(|_| "RunManager 状态锁已损坏。".to_string())
    }

    fn remove_run(&self, run_id: &str) {
        if let Ok(mut runs) = self.runs.lock() {
            runs.remove(run_id);
        }
    }

    fn snapshot_runs(&self) -> Vec<Arc<RunProcess>> {
        self.runs
            .lock()
            .map(|runs| runs.values().cloned().collect())
            .unwrap_or_default()
    }

}

fn drive_sidecar_run(
    app: AppHandle,
    manager: Arc<RunManager>,
    process: Arc<RunProcess>,
    stdout: impl Read + Send + 'static,
    run_start: Value,
) -> Result<(), String> {
    let (tx, rx) = mpsc::channel();

    thread::spawn(move || read_frames(stdout, tx));

    let hello = rx
        .recv_timeout(SIDECAR_HANDSHAKE_TIMEOUT)
        .map_err(|_| "Runtime sidecar 握手超时。".to_string())??;
    validate_hello(&hello)?;
    eprintln!(
        "{AGENT_RUN_LOG_PREFIX} Runtime sidecar 握手成功：runId={}",
        process.run_id
    );
    write_frame_locked(
        &process,
        &json!({
            "type": "hello_ack",
            "protocolVersion": "1.0.0",
            "maxFrameBytes": SIDECAR_MAX_FRAME_BYTES
        }),
    )?;
    write_frame_locked(&process, &run_start)?;
    eprintln!(
        "{AGENT_RUN_LOG_PREFIX} 已向 Runtime sidecar 发送 run_start：runId={}",
        process.run_id
    );

    loop {
        match rx.recv() {
            Ok(Ok(frame)) => handle_runtime_frame(&app, &manager, &process, frame)?,
            Ok(Err(error)) => return Err(error),
            Err(_) => break,
        }
    }

    let status = process
        .child
        .lock()
        .map_err(|_| "Runtime sidecar 进程锁已损坏。".to_string())?
        .wait()
        .map_err(|error| format!("等待 Runtime sidecar 退出失败：{error}"))?;

    if !process.terminal_sent.load(Ordering::SeqCst) {
        let terminal = process
            .cancel_reason
            .lock()
            .ok()
            .and_then(|reason| *reason)
            .map(CancelReason::terminal_status)
            .unwrap_or(if status.success() { "interrupted" } else { "failed" });
        let error = if status.success() {
            None
        } else {
            Some("Runtime sidecar 在发送终态前退出。".to_string())
        };

        manager.finish_run(&app, &process.run_id, terminal, error);
    }

    Ok(())
}

fn handle_runtime_frame(
    app: &AppHandle,
    manager: &RunManager,
    process: &RunProcess,
    frame: Value,
) -> Result<(), String> {
    let decode = decode_protocol_envelope_v1(&frame);

    match decode.status {
        ProtocolDecodeStatus::Ok => {}
        ProtocolDecodeStatus::Ignored => return Ok(()),
        ProtocolDecodeStatus::Error => {
            return Err(format!(
                "Runtime sidecar 发送了非法协议帧：{}",
                decode.code.unwrap_or("UNKNOWN")
            ));
        }
    }

    let event_type = frame
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| "Runtime sidecar 协议帧缺少 type。".to_string())?;
    let run_id = frame
        .get("runId")
        .and_then(Value::as_str)
        .ok_or_else(|| "Runtime sidecar 协议帧缺少 runId。".to_string())?;
    let payload = frame.get("payload").cloned().unwrap_or_else(|| json!({}));

    if run_id != process.run_id {
        return Err("Runtime sidecar 协议帧 runId 与当前 Run 不一致。".to_string());
    }

    if event_type == "run_done" {
        let status = payload
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("failed");

        log_runtime_frame(event_type, run_id, &payload);
        manager.finish_run(app, run_id, status, None);
        return Ok(());
    }

    if process.terminal_sent.load(Ordering::SeqCst) {
        return Ok(());
    }

    log_runtime_frame(event_type, run_id, &payload);

    let event = protocol_payload_to_legacy_event(event_type, run_id, payload)?;

    app.emit(AGENT_RUN_EVENT, event)
        .map_err(|error| format!("转发 Runtime sidecar 事件失败：{error}"))?;

    Ok(())
}

fn protocol_payload_to_legacy_event(
    event_type: &str,
    run_id: &str,
    payload: Value,
) -> Result<Value, String> {
    match event_type {
        "run_start" | "model_request_start" => Ok(json!({
            "type": event_type,
            "runId": run_id
        })),
        "security_snapshot" => Ok(json!({
            "type": "security_snapshot",
            "runId": run_id,
            "snapshot": payload.get("snapshot").cloned().unwrap_or_else(|| json!({}))
        })),
        "message_start" => Ok(json!({
            "type": "message_start",
            "runId": run_id,
            "messageId": payload.get("messageId").and_then(Value::as_str).unwrap_or_default(),
            "role": payload.get("role").and_then(Value::as_str).unwrap_or("assistant")
        })),
        "text_delta" => Ok(json!({
            "type": "text_delta",
            "runId": run_id,
            "messageId": payload.get("messageId").and_then(Value::as_str).unwrap_or_default(),
            "text": payload.get("text").and_then(Value::as_str).unwrap_or_default()
        })),
        "message_done" => Ok(json!({
            "type": "message_done",
            "runId": run_id,
            "messageId": payload.get("messageId").and_then(Value::as_str).unwrap_or_default()
        })),
        "tool_call_start" => Ok(json!({
            "type": "tool_call_start",
            "runId": run_id,
            "toolCallId": payload.get("toolCallId").and_then(Value::as_str).unwrap_or_default(),
            "name": payload.get("name").and_then(Value::as_str).unwrap_or_default(),
            "permission": payload.get("permission").and_then(Value::as_str).unwrap_or("command"),
            "input": payload.get("input").cloned().unwrap_or(Value::Null)
        })),
        "tool_approval_request" => Ok(json!({
            "type": "tool_approval_request",
            "runId": run_id,
            "approvalId": payload.get("approvalId").and_then(Value::as_str).unwrap_or_default(),
            "toolCallId": payload.get("toolCallId").and_then(Value::as_str).unwrap_or_default(),
            "name": payload.get("name").and_then(Value::as_str).unwrap_or_default(),
            "permission": payload.get("permission").and_then(Value::as_str).unwrap_or("command"),
            "input": payload.get("input").cloned().unwrap_or(Value::Null),
            "reason": payload.get("reason").and_then(Value::as_str).unwrap_or_default()
        })),
        "tool_approval_resolved" => Ok(json!({
            "type": "tool_approval_resolved",
            "runId": run_id,
            "approvalId": payload.get("approvalId").and_then(Value::as_str).unwrap_or_default(),
            "toolCallId": payload.get("toolCallId").and_then(Value::as_str).unwrap_or_default(),
            "decision": payload.get("decision").and_then(Value::as_str).unwrap_or("denied")
        })),
        "tool_result" => Ok(json!({
            "type": "tool_result",
            "runId": run_id,
            "toolCallId": payload.get("toolCallId").and_then(Value::as_str).unwrap_or_default(),
            "output": payload.get("output").cloned().unwrap_or(Value::Null)
        })),
        "tool_call_done" => Ok(json!({
            "type": "tool_call_done",
            "runId": run_id,
            "toolCallId": payload.get("toolCallId").and_then(Value::as_str).unwrap_or_default()
        })),
        "error" => Ok(json!({
            "type": "error",
            "runId": run_id,
            "message": payload.get("message").and_then(Value::as_str).unwrap_or("Runtime sidecar 执行失败。")
        })),
        other => Err(format!("未知 Runtime sidecar 事件：{other}")),
    }
}

fn log_runtime_frame(event_type: &str, run_id: &str, payload: &Value) {
    match event_type {
        "text_delta" => {
            let message_id = payload
                .get("messageId")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let text = payload
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or_default();

            eprintln!(
                "{AGENT_RUN_LOG_PREFIX} Tauri 收到 runtime 文本增量：runId={run_id}，messageId={message_id}，textChars={}，preview={}",
                text.chars().count(),
                truncate_log_text(text)
            );
        }
        "message_start" | "message_done" => {
            let message_id = payload
                .get("messageId")
                .and_then(Value::as_str)
                .unwrap_or_default();

            eprintln!(
                "{AGENT_RUN_LOG_PREFIX} Tauri 收到 runtime 消息事件：type={event_type}，runId={run_id}，messageId={message_id}"
            );
        }
        "tool_call_start"
        | "tool_approval_request"
        | "tool_approval_resolved"
        | "tool_result"
        | "tool_call_done" => {
            let tool_call_id = payload
                .get("toolCallId")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let name = payload
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default();

            eprintln!(
                "{AGENT_RUN_LOG_PREFIX} Tauri 收到 runtime 工具事件：type={event_type}，runId={run_id}，toolCallId={tool_call_id}，name={name}"
            );
        }
        "run_done" => {
            let status = payload
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("failed");

            eprintln!(
                "{AGENT_RUN_LOG_PREFIX} Tauri 收到 runtime 终态：runId={run_id}，status={status}"
            );
        }
        "error" => {
            let message = payload
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("Runtime sidecar 执行失败。");

            eprintln!(
                "{AGENT_RUN_LOG_PREFIX} Tauri 收到 runtime 错误：runId={run_id}，message={message}"
            );
        }
        _ => {
            eprintln!(
                "{AGENT_RUN_LOG_PREFIX} Tauri 收到 runtime 事件：type={event_type}，runId={run_id}"
            );
        }
    }
}

fn truncate_log_text(text: &str) -> String {
    let normalized = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let preview: String = normalized.chars().take(80).collect();

    if normalized.chars().count() > 80 {
        format!("{preview}...")
    } else {
        preview
    }
}

fn validate_hello(frame: &Value) -> Result<(), String> {
    if frame.get("type").and_then(Value::as_str) != Some("hello") {
        return Err("Runtime sidecar 首帧不是 hello。".to_string());
    }

    let protocol_version = frame
        .get("protocolVersion")
        .and_then(Value::as_str)
        .ok_or_else(|| "Runtime sidecar hello 缺少 protocolVersion。".to_string())?;

    if !protocol_version.starts_with("1.") {
        return Err("Runtime sidecar 协议主版本不兼容。".to_string());
    }

    let max_frame = frame
        .get("maxFrameBytes")
        .and_then(Value::as_u64)
        .ok_or_else(|| "Runtime sidecar hello 缺少 maxFrameBytes。".to_string())?;

    if max_frame == 0 || max_frame as usize > SIDECAR_MAX_FRAME_BYTES {
        return Err("Runtime sidecar 帧大小上限不兼容。".to_string());
    }

    Ok(())
}

fn read_frames(mut reader: impl Read, tx: mpsc::Sender<Result<Value, String>>) {
    loop {
        match read_frame(&mut reader) {
            Ok(Some(value)) => {
                if tx.send(Ok(value)).is_err() {
                    return;
                }
            }
            Ok(None) => return,
            Err(error) => {
                let _ = tx.send(Err(error));
                return;
            }
        }
    }
}

fn read_frame(reader: &mut impl Read) -> Result<Option<Value>, String> {
    let mut header = [0_u8; 4];

    match reader.read_exact(&mut header) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(error) => return Err(format!("读取 Runtime sidecar 帧头失败：{error}")),
    }

    let length = u32::from_be_bytes(header) as usize;

    if length == 0 || length > SIDECAR_MAX_FRAME_BYTES {
        return Err("Runtime sidecar 帧长度非法。".to_string());
    }

    let mut payload = vec![0_u8; length];
    reader
        .read_exact(&mut payload)
        .map_err(|error| format!("读取 Runtime sidecar 帧正文失败：{error}"))?;

    serde_json::from_slice(&payload).map(Some).map_err(|error| {
        format!("Runtime sidecar 帧不是合法 JSON：{error}")
    })
}

fn write_frame_locked(process: &RunProcess, value: &Value) -> Result<(), String> {
    let payload = serde_json::to_vec(value).map_err(|error| error.to_string())?;

    if payload.len() > SIDECAR_MAX_FRAME_BYTES {
        return Err("发送给 Runtime sidecar 的帧超过最大长度限制。".to_string());
    }

    let mut stdin = process
        .stdin
        .lock()
        .map_err(|_| "Runtime sidecar stdin 锁已损坏。".to_string())?;

    stdin
        .write_all(&(payload.len() as u32).to_be_bytes())
        .and_then(|_| stdin.write_all(&payload))
        .and_then(|_| stdin.flush())
        .map_err(|error| format!("写入 Runtime sidecar 帧失败：{error}"))
}

fn force_kill_after_grace(process: Arc<RunProcess>, grace: Duration) {
    thread::spawn(move || {
        thread::sleep(grace);

        if process.terminal_sent.load(Ordering::SeqCst) {
            return;
        }

        if let Ok(mut child) = process.child.lock() {
            let _ = child.kill();
        }
    });
}

fn resolve_sidecar_command(root: &Path) -> Result<SidecarCommand, String> {
    if let Ok(path) = std::env::var("MECHA_RUNTIME_SIDECAR") {
        let path = PathBuf::from(path);

        if path.exists() {
            return Ok(SidecarCommand::Executable(path));
        }
    }

    for path in sidecar_binary_candidates(root)? {
        if path.exists() {
            return Ok(SidecarCommand::Executable(path));
        }
    }

    #[cfg(debug_assertions)]
    {
        return Ok(SidecarCommand::DevPnpm(root.to_path_buf()));
    }

    #[cfg(not(debug_assertions))]
    {
        Err("未找到 Runtime sidecar 可执行文件，发布包不能回退到 Node/pnpm。".to_string())
    }
}

fn sidecar_binary_candidates(root: &Path) -> Result<Vec<PathBuf>, String> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(PathBuf::from));
    let target_triple = tauri_target_triple();
    let exe_name = if cfg!(target_os = "windows") {
        format!("mecha-runtime-sidecar-{target_triple}.exe")
    } else {
        format!("mecha-runtime-sidecar-{target_triple}")
    };
    let mut candidates = Vec::new();

    if let Some(dir) = exe_dir {
        candidates.push(dir.join(&exe_name));
        candidates.push(dir.join("resources").join(&exe_name));
    }

    candidates.push(root.join("apps").join("desktop").join("src-tauri").join("binaries").join(&exe_name));

    Ok(candidates)
}

fn tauri_target_triple() -> &'static str {
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        "x86_64-pc-windows-msvc"
    }

    #[cfg(not(all(target_os = "windows", target_arch = "x86_64")))]
    {
        "unknown-target"
    }
}

enum SidecarCommand {
    Executable(PathBuf),
    DevPnpm(PathBuf),
}

impl SidecarCommand {
    fn command(&self) -> Command {
        match self {
            Self::Executable(path) => Command::new(path),
            Self::DevPnpm(root) => {
                let mut command = Command::new(pnpm_command());

                command
                    .current_dir(root)
                    .arg("--silent")
                    .arg("--filter")
                    .arg("@mecha/agent-runtime")
                    .arg("sidecar");

                command
            }
        }
    }
}

pub(crate) fn resolve_agent_config() -> Result<crate::AgentConfigResponse, String> {
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

    Ok(crate::AgentConfigResponse {
        default_provider,
        available_providers,
        default_workspace_root: root.to_string_lossy().to_string(),
        security_snapshot: crate::default_security_snapshot(),
    })
}

fn normalize_provider(
    provider: Option<String>,
    config: &crate::AgentConfigResponse,
) -> Result<String, String> {
    let provider = provider
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| config.default_provider.clone());

    if !matches!(provider.as_str(), "openai" | "anthropic") {
        return Err("不支持当前模型服务商。".to_string());
    }

    Ok(provider)
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

fn create_run_id() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();

    format!("run-{millis}")
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

fn read_stream_to_string(mut stream: impl Read) -> String {
    let mut output = String::new();
    let _ = stream.read_to_string(&mut output);
    output
}

#[cfg(target_os = "windows")]
fn pnpm_command() -> &'static str {
    "pnpm.cmd"
}

#[cfg(not(target_os = "windows"))]
fn pnpm_command() -> &'static str {
    "pnpm"
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

#[cfg(target_os = "windows")]
mod process_job {
    use std::ffi::c_void;
    use std::mem::size_of;
    use std::os::windows::io::AsRawHandle;
    use std::process::Child;
    use std::ptr::null_mut;

    type Handle = *mut c_void;

    const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: u32 = 0x0000_2000;
    const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS: u32 = 9;

    #[repr(C)]
    struct IoCounters {
        read_operation_count: u64,
        write_operation_count: u64,
        other_operation_count: u64,
        read_transfer_count: u64,
        write_transfer_count: u64,
        other_transfer_count: u64,
    }

    #[repr(C)]
    struct JobObjectBasicLimitInformation {
        per_process_user_time_limit: i64,
        per_job_user_time_limit: i64,
        limit_flags: u32,
        minimum_working_set_size: usize,
        maximum_working_set_size: usize,
        active_process_limit: u32,
        affinity: usize,
        priority_class: u32,
        scheduling_class: u32,
    }

    #[repr(C)]
    struct JobObjectExtendedLimitInformation {
        basic_limit_information: JobObjectBasicLimitInformation,
        io_info: IoCounters,
        process_memory_limit: usize,
        job_memory_limit: usize,
        peak_process_memory_used: usize,
        peak_job_memory_used: usize,
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateJobObjectW(attributes: *mut c_void, name: *const u16) -> Handle;
        fn SetInformationJobObject(
            job: Handle,
            info_class: u32,
            info: *const c_void,
            info_length: u32,
        ) -> i32;
        fn AssignProcessToJobObject(job: Handle, process: Handle) -> i32;
        fn CloseHandle(handle: Handle) -> i32;
    }

    pub(crate) struct RunJob {
        handle: Handle,
    }

    unsafe impl Send for RunJob {}
    unsafe impl Sync for RunJob {}

    impl Drop for RunJob {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.handle);
            }
        }
    }

    pub(crate) fn assign_to_job(child: &Child) -> Result<RunJob, String> {
        unsafe {
            let job = CreateJobObjectW(null_mut(), std::ptr::null());

            if job.is_null() {
                return Err("CreateJobObjectW 返回空句柄。".to_string());
            }

            let info = JobObjectExtendedLimitInformation {
                basic_limit_information: JobObjectBasicLimitInformation {
                    per_process_user_time_limit: 0,
                    per_job_user_time_limit: 0,
                    limit_flags: JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                    minimum_working_set_size: 0,
                    maximum_working_set_size: 0,
                    active_process_limit: 0,
                    affinity: 0,
                    priority_class: 0,
                    scheduling_class: 0,
                },
                io_info: IoCounters {
                    read_operation_count: 0,
                    write_operation_count: 0,
                    other_operation_count: 0,
                    read_transfer_count: 0,
                    write_transfer_count: 0,
                    other_transfer_count: 0,
                },
                process_memory_limit: 0,
                job_memory_limit: 0,
                peak_process_memory_used: 0,
                peak_job_memory_used: 0,
            };

            let set_ok = SetInformationJobObject(
                job,
                JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS,
                &info as *const _ as *const c_void,
                size_of::<JobObjectExtendedLimitInformation>() as u32,
            );

            if set_ok == 0 {
                CloseHandle(job);
                return Err("设置 Job Object kill-on-close 失败。".to_string());
            }

            let assign_ok = AssignProcessToJobObject(job, child.as_raw_handle() as Handle);

            if assign_ok == 0 {
                CloseHandle(job);
                return Err("将 Runtime sidecar 加入 Job Object 失败。".to_string());
            }

            Ok(RunJob { handle: job })
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod process_job {
    use std::process::Child;

    pub(crate) struct RunJob;

    pub(crate) fn assign_to_job(_child: &Child) -> Result<RunJob, String> {
        Ok(RunJob)
    }
}
