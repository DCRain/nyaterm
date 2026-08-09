use std::collections::{HashMap, HashSet};
use std::env;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::{Mutex, oneshot};
use tokio::time::timeout;

use crate::config::{AiAgentKind, AiPermissionMode, AiSettings};
use crate::core::ai::agent::AgentApprovalManager;
use crate::core::ai::mcp::{
    NyaTermMcpRuntime, RegisterMcpTurnRequest, build_opencode_mcp_config_content,
    is_nyaterm_mcp_enabled,
};
use crate::core::session::SessionManager;
use crate::error::{AppError, AppResult};
use crate::utils::process::hide_window;

use super::super::history::{append_message, save_user_message, set_session_external_session_id};
use super::super::redaction::{redact_context, redact_marker_values, redact_sensitive_text};
use super::super::stream::{active_streams, emit_stream_event};
use super::super::types::{AiChatRequest, AiMessage, AiMessageRole, AiStreamEventPayload};
use super::super::types::{now_rfc3339, uuid};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenCodeCliStatus {
    pub installed: bool,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub checked_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OpenCodeAccountStatus {
    pub connected: bool,
    #[serde(default)]
    pub auth_mode: Option<String>,
    #[serde(default)]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenCodeModelInfo {
    pub id: String,
    pub name: String,
}

#[derive(Default)]
pub struct OpenCodeRuntime {
    active_turns: Mutex<HashMap<String, oneshot::Sender<()>>>,
}

impl OpenCodeRuntime {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn detect_cli(path: Option<String>) -> OpenCodeCliStatus {
        let candidates = discover_opencode_candidates(path.as_deref()).await;
        let checked_paths = candidates
            .iter()
            .map(|candidate| candidate.executable.clone())
            .collect::<Vec<_>>();
        let mut errors = Vec::new();

        for candidate in &candidates {
            match probe_opencode_cli(&candidate.executable).await {
                Ok(version) => {
                    return OpenCodeCliStatus {
                        installed: true,
                        path: Some(candidate.executable.clone()),
                        version: Some(version),
                        error: None,
                        source: Some(candidate.source.to_string()),
                        checked_paths,
                    };
                }
                Err(error) => {
                    errors.push(format!("{}: {error}", candidate.executable));
                }
            }
        }

        OpenCodeCliStatus {
            installed: false,
            path: path
                .as_deref()
                .map(|value| opencode_executable(Some(value)))
                .or_else(|| Some("opencode".to_string())),
            version: None,
            error: Some(detect_error_message(
                "OpenCode CLI was not detected",
                &errors,
            )),
            source: None,
            checked_paths,
        }
    }

    pub async fn auth_status(&self, settings: &AiSettings) -> AppResult<OpenCodeAccountStatus> {
        let status = Self::detect_cli(settings.opencode.executable_path.clone()).await;
        Ok(OpenCodeAccountStatus {
            connected: status.installed,
            auth_mode: Some("opencode".to_string()),
            message: status
                .installed
                .then(|| {
                    "OpenCode CLI is available; NyaTerm uses local OpenCode auth credentials."
                        .to_string()
                })
                .or(status.error),
        })
    }

    pub async fn list_models(path: Option<String>) -> AppResult<Vec<OpenCodeModelInfo>> {
        let cli = Self::detect_cli(path).await;
        if !cli.installed {
            return Err(AppError::Config(
                cli.error
                    .unwrap_or_else(|| "OpenCode CLI was not detected".to_string()),
            ));
        }
        let executable = cli.path.unwrap_or_else(|| opencode_executable(None));
        let mut command = build_opencode_command(&executable);
        command.arg("models");
        let output = timeout(OPENCODE_MODELS_TIMEOUT, command.output())
            .await
            .map_err(|_| AppError::Config("timed out while listing OpenCode models".to_string()))?
            .map_err(|error| AppError::Config(format!("Failed to list OpenCode models: {error}")))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let details = if !stderr.is_empty() {
                stderr
            } else if !stdout.is_empty() {
                stdout
            } else {
                output.status.to_string()
            };
            return Err(AppError::Config(format!(
                "OpenCode models failed: {details}"
            )));
        }

        let mut models = Vec::new();
        let mut seen = HashSet::new();
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            let name = line.trim();
            if name.is_empty() || !name.contains('/') {
                continue;
            }
            // Skip verbose JSON dumps if --verbose somehow leaked.
            if name.starts_with('{') {
                continue;
            }
            if !seen.insert(name.to_string()) {
                continue;
            }
            models.push(OpenCodeModelInfo {
                id: format!("opencode:{name}"),
                name: name.to_string(),
            });
        }
        Ok(models)
    }

    pub async fn cancel_turn(&self, turn_id: &str) -> AppResult<()> {
        if let Some(sender) = self.active_turns.lock().await.remove(turn_id) {
            let _ = sender.send(());
        }
        Ok(())
    }
}

pub async fn run_opencode_stream(
    app: AppHandle,
    runtime: Arc<OpenCodeRuntime>,
    session_manager: Arc<SessionManager>,
    approval_manager: Arc<AgentApprovalManager>,
    mcp_runtime: Arc<NyaTermMcpRuntime>,
    stream_id: String,
    session_id: String,
    mut request: AiChatRequest,
    settings: AiSettings,
    mut cancel_rx: oneshot::Receiver<()>,
) {
    let result = run_opencode_stream_inner(
        app.clone(),
        runtime,
        session_manager,
        approval_manager,
        mcp_runtime,
        stream_id.clone(),
        session_id.clone(),
        &mut request,
        settings,
        &mut cancel_rx,
    )
    .await;

    if let Err(error) = result {
        active_streams().lock().unwrap().remove(&stream_id);
        emit_stream_event(
            &app,
            &stream_id,
            AiStreamEventPayload {
                event_type: "error".to_string(),
                stream_id: stream_id.clone(),
                session_id: Some(session_id),
                text_delta: None,
                reasoning_delta: None,
                message: None,
                command_cards: vec![],
                usage: None,
                error: Some(error.to_string()),
            },
        );
    }
}

async fn run_opencode_stream_inner(
    app: AppHandle,
    runtime: Arc<OpenCodeRuntime>,
    session_manager: Arc<SessionManager>,
    approval_manager: Arc<AgentApprovalManager>,
    mcp_runtime: Arc<NyaTermMcpRuntime>,
    stream_id: String,
    session_id: String,
    request: &mut AiChatRequest,
    settings: AiSettings,
    cancel_rx: &mut oneshot::Receiver<()>,
) -> AppResult<()> {
    if !settings.opencode.enabled {
        return Err(AppError::Config(
            "OpenCode integration is disabled".to_string(),
        ));
    }

    let cli = OpenCodeRuntime::detect_cli(settings.opencode.executable_path.clone()).await;
    if !cli.installed {
        return Err(AppError::Config(
            cli.error
                .unwrap_or_else(|| "OpenCode CLI was not detected".to_string()),
        ));
    }
    let executable = cli.path.unwrap_or_else(|| opencode_executable(None));

    emit_stream_event(
        &app,
        &stream_id,
        AiStreamEventPayload {
            event_type: "start".to_string(),
            stream_id: stream_id.clone(),
            session_id: Some(session_id.clone()),
            text_delta: None,
            reasoning_delta: None,
            message: None,
            command_cards: vec![],
            usage: None,
            error: None,
        },
    );

    if settings.redaction_enabled {
        redact_context(&mut request.context);
        request.user_input = redact_sensitive_text(&request.user_input);
    }
    if settings.record_history {
        save_user_message(&app, &session_id, request)?;
    }

    let mcp_enabled = should_attach_nyaterm_mcp(request, &settings);
    let mut mcp_token: Option<String> = None;
    let mut mcp_url: Option<String> = None;
    if mcp_enabled {
        match mcp_runtime
            .register_turn(RegisterMcpTurnRequest {
                app: app.clone(),
                session_manager: session_manager.clone(),
                approval_manager: approval_manager.clone(),
                stream_id: stream_id.clone(),
                session_id: session_id.clone(),
                request: request.clone(),
                settings: settings.clone(),
            })
            .await
        {
            Ok(endpoint) => {
                mcp_token = Some(endpoint.token);
                mcp_url = Some(endpoint.url);
            }
            Err(error) => {
                tracing::warn!(
                    target: "nyaterm_mcp",
                    error = %error,
                    "Failed to register OpenCode MCP turn; continuing without MCP"
                );
            }
        }
    }

    let prompt = build_opencode_turn_prompt(request, &settings, mcp_token.is_some());
    let mut child = build_opencode_command(&executable);
    child.arg("run").arg("--format").arg("json");

    match request.permission_mode {
        AiPermissionMode::Observer => {
            child.arg("--agent").arg("plan");
        }
        AiPermissionMode::Auto => {
            child.arg("--auto");
        }
        AiPermissionMode::Confirm => {}
    }

    if let Some(model) = request
        .model_name
        .as_deref()
        .or(settings.opencode.default_model.as_deref())
        .filter(|value| !value.trim().is_empty())
    {
        child.arg("--model").arg(model);
    }
    if let Some(external_session_id) = request
        .existing_external_session_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        child.arg("--session").arg(external_session_id);
    }
    if let Some(config_dir) = settings
        .opencode
        .config_directory
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        child.env("OPENCODE_CONFIG_DIR", config_dir);
    }
    if let (Some(token), Some(url)) = (mcp_token.as_deref(), mcp_url.as_deref()) {
        child.env(
            "OPENCODE_CONFIG_CONTENT",
            build_opencode_mcp_config_content(url, token),
        );
    }

    // Windows .cmd shims reject raw newlines / special batch metacharacters in argv.
    child.arg(sanitize_opencode_cli_arg(&prompt));
    child.stdin(Stdio::null());
    child.stdout(Stdio::piped());
    child.stderr(Stdio::piped());
    child.kill_on_drop(true);

    let mut child = match child.spawn() {
        Ok(child) => child,
        Err(error) => {
            if let Some(token) = mcp_token.as_deref() {
                mcp_runtime.unregister_turn(token).await;
            }
            return Err(AppError::Config(format!(
                "Failed to start OpenCode: {error}"
            )));
        }
    };
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Channel("OpenCode stdout unavailable".to_string()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::Channel("OpenCode stderr unavailable".to_string()))?;

    let turn_id = format!("opencode-turn-{}", uuid());
    let (turn_cancel_tx, mut turn_cancel_rx) = oneshot::channel();
    runtime
        .active_turns
        .lock()
        .await
        .insert(turn_id.clone(), turn_cancel_tx);

    tauri::async_runtime::spawn(async move {
        read_opencode_stderr(stderr).await;
    });

    let mut lines = BufReader::new(stdout).lines();
    let mut content = String::new();
    let mut reasoning = String::new();
    let mut external_session_id = request.existing_external_session_id.clone();
    let mut saw_text = false;

    let loop_result: AppResult<()> = loop {
        tokio::select! {
            _ = &mut *cancel_rx => {
                let _ = child.kill().await;
                break Err(AppError::Cancelled("AI stream cancelled".to_string()));
            }
            _ = &mut turn_cancel_rx => {
                let _ = child.kill().await;
                break Err(AppError::Cancelled("OpenCode turn cancelled".to_string()));
            }
            line = lines.next_line() => {
                let Some(line) = line? else {
                    break Ok(());
                };
                let Ok(value) = serde_json::from_str::<Value>(&line) else {
                    tracing::debug!("Ignoring non-JSON OpenCode stream line");
                    continue;
                };

                if external_session_id.is_none() {
                    external_session_id = extract_session_id(&value);
                    if let Some(id) = external_session_id.clone() {
                        set_session_external_session_id(
                            &app,
                            &session_id,
                            AiAgentKind::OpenCode,
                            id,
                        )?;
                    }
                }

                if let Some(delta) = extract_text_chunk(&value) {
                    saw_text = true;
                    content.push_str(&delta);
                    emit_stream_event(
                        &app,
                        &stream_id,
                        AiStreamEventPayload {
                            event_type: "delta".to_string(),
                            stream_id: stream_id.clone(),
                            session_id: Some(session_id.clone()),
                            text_delta: Some(delta),
                            reasoning_delta: None,
                            message: None,
                            command_cards: vec![],
                            usage: None,
                            error: None,
                        },
                    );
                }

                if let Some(delta) = extract_reasoning_chunk(&value) {
                    reasoning.push_str(&delta);
                    emit_stream_event(
                        &app,
                        &stream_id,
                        AiStreamEventPayload {
                            event_type: "reasoning_delta".to_string(),
                            stream_id: stream_id.clone(),
                            session_id: Some(session_id.clone()),
                            text_delta: None,
                            reasoning_delta: Some(delta),
                            message: None,
                            command_cards: vec![],
                            usage: None,
                            error: None,
                        },
                    );
                }

                if let Some(block) = format_tool_use_block(&value) {
                    // Tool results are first-class content when OpenCode executes without a final prose reply.
                    saw_text = true;
                    let delta = if content.is_empty() {
                        block
                    } else if content.ends_with('\n') {
                        format!("\n{block}")
                    } else {
                        format!("\n\n{block}")
                    };
                    content.push_str(&delta);
                    emit_stream_event(
                        &app,
                        &stream_id,
                        AiStreamEventPayload {
                            event_type: "delta".to_string(),
                            stream_id: stream_id.clone(),
                            session_id: Some(session_id.clone()),
                            text_delta: Some(delta),
                            reasoning_delta: None,
                            message: None,
                            command_cards: vec![],
                            usage: None,
                            error: None,
                        },
                    );
                }

                if let Some(error) = extract_error_message(&value) {
                    break Err(AppError::Config(error));
                }
            }
        }
    };

    runtime.active_turns.lock().await.remove(&turn_id);
    let status = child.wait().await.ok();
    if let Some(token) = mcp_token.as_deref() {
        mcp_runtime.unregister_turn(token).await;
    }
    loop_result?;
    if status.as_ref().is_some_and(|status| !status.success()) {
        return Err(AppError::Config(format!(
            "OpenCode exited with {}",
            status.unwrap()
        )));
    }
    if !saw_text && content.trim().is_empty() {
        return Err(AppError::Config(
            "OpenCode finished without streaming text. Try upgrading OpenCode or check provider auth."
                .to_string(),
        ));
    }

    active_streams().lock().unwrap().remove(&stream_id);
    let message = AiMessage {
        id: format!("msg-{}", uuid()),
        session_id: session_id.clone(),
        role: AiMessageRole::Assistant,
        content,
        created_at: now_rfc3339(),
        reasoning_content: (!reasoning.is_empty()).then_some(reasoning),
        command_cards: vec![],
    };
    if settings.record_history {
        append_message(&app, message.clone())?;
    }
    emit_stream_event(
        &app,
        &stream_id,
        AiStreamEventPayload {
            event_type: "done".to_string(),
            stream_id: stream_id.clone(),
            session_id: Some(session_id),
            text_delta: None,
            reasoning_delta: None,
            message: Some(message),
            command_cards: vec![],
            usage: None,
            error: None,
        },
    );

    Ok(())
}

fn should_attach_nyaterm_mcp(request: &AiChatRequest, settings: &AiSettings) -> bool {
    if !is_nyaterm_mcp_enabled(settings.opencode.tool_integration_mode.as_deref()) {
        return false;
    }
    if request.permission_mode == AiPermissionMode::Observer {
        return false;
    }
    request
        .terminal_session_id
        .as_deref()
        .or(request.default_target_session_id.as_deref())
        .map(str::trim)
        .is_some_and(|value| !value.is_empty())
        || !request.targets.is_empty()
}

fn opencode_system_context(request: &AiChatRequest, mcp_attached: bool) -> String {
    let default_target = request
        .default_target_session_id
        .as_deref()
        .or(request.terminal_session_id.as_deref())
        .unwrap_or("none");
    if mcp_attached {
        format!(
            "You are running inside NyaTerm via OpenCode. NyaTerm MCP tools are available under nyaterm_terminal \
(get_context, execute_command). For any command that should run in the user's NyaTerm terminal pane \
(including changing cwd/drive), you MUST call nyaterm_terminal.execute_command instead of local bash/shell. \
Do not read SSH passwords, private keys, OAuth tokens, or internal app credentials. \
Do not create separate SSH connections to bypass NyaTerm SessionManager. Default terminal session: {default_target}."
        )
    } else {
        format!(
            "You are running inside NyaTerm via OpenCode. Prefer NyaTerm MCP tools for terminal sessions when available. \
Do not read SSH passwords, private keys, OAuth tokens, or internal app credentials. \
Do not create separate SSH connections to bypass NyaTerm SessionManager. Default terminal session: {default_target}."
        )
    }
}

/// Build a natural-language turn for OpenCode.
/// Do not reuse NyaTerm Ask `build_prompt`, which forces a commands JSON schema.
fn build_opencode_turn_prompt(
    request: &AiChatRequest,
    settings: &AiSettings,
    mcp_attached: bool,
) -> String {
    let ctx = &request.context;
    let cwd = ctx.cwd.as_deref().unwrap_or("-");
    let os = ctx.os.as_deref().unwrap_or("-");
    let connection = ctx.connection_name.as_deref().unwrap_or("-");
    let host = ctx.host.as_deref().unwrap_or("-");
    let username = ctx.username.as_deref().unwrap_or("-");
    let selected = ctx.selected_text.trim();
    let recent = truncate_for_opencode_context(&ctx.recent_output, settings.context_line_limit);
    let user_input = request.user_input.trim();

    let mut prompt = String::new();
    prompt.push_str(&opencode_system_context(request, mcp_attached));
    prompt.push_str("\n\n");
    prompt.push_str("Terminal context (facts only; do not invent beyond this):\n");
    prompt.push_str(&format!("- connection: {connection}\n"));
    prompt.push_str(&format!("- host: {host}\n"));
    prompt.push_str(&format!("- user: {username}\n"));
    prompt.push_str(&format!("- cwd: {cwd}\n"));
    prompt.push_str(&format!("- os: {os}\n"));
    if !selected.is_empty() {
        prompt.push_str("\nSelected text:\n");
        prompt.push_str(selected);
        prompt.push('\n');
    }
    if !recent.trim().is_empty() {
        prompt.push_str("\nRecent terminal output:\n");
        prompt.push_str(recent.trim());
        prompt.push('\n');
    }
    prompt.push_str("\nUser request:\n");
    prompt.push_str(if user_input.is_empty() { "-" } else { user_input });
    if mcp_attached {
        prompt.push_str(
            "\n\nRespond as the OpenCode coding agent. Prefer nyaterm_terminal.execute_command for terminal work \
in the user's NyaTerm pane. Local bash does NOT change the user's terminal cwd. \
Do NOT answer with a NyaTerm Ask-mode JSON object containing keys like \"commands\", \"reasoning\", or \"safety_mode\". \
After tool calls, always write a short natural-language result for the user (what you did and the outcome).",
        );
    } else {
        prompt.push_str(
            "\n\nRespond as the OpenCode coding agent. Use your tools (shell/bash, files, etc.) when helpful. \
Do NOT answer with a NyaTerm Ask-mode JSON object containing keys like \"commands\", \"reasoning\", or \"safety_mode\". \
After tool calls, always write a short natural-language result for the user (what you did and the outcome). \
Note: your bash tool runs in OpenCode's own process, not inside the user's NyaTerm terminal pane. \
Speak naturally and perform the requested work when appropriate.",
        );
    }
    prompt
}

fn truncate_for_opencode_context(output: &str, line_limit: u32) -> String {
    let limit = line_limit.max(1) as usize;
    let lines: Vec<&str> = output.lines().collect();
    if lines.len() <= limit {
        return output.to_string();
    }
    lines[lines.len() - limit..].join("\n")
}

fn extract_session_id(value: &Value) -> Option<String> {
    value
        .get("sessionID")
        .or_else(|| value.get("sessionId"))
        .or_else(|| value.get("session_id"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn extract_error_message(value: &Value) -> Option<String> {
    if value.get("type").and_then(Value::as_str) != Some("error") {
        return None;
    }
    value
        .pointer("/error/data/message")
        .or_else(|| value.pointer("/error/message"))
        .or_else(|| value.get("message"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| {
            value
                .get("error")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
}

fn extract_text_chunk(value: &Value) -> Option<String> {
    let event_type = value.get("type").and_then(Value::as_str)?;
    if event_type != "text" {
        return None;
    }
    value
        .pointer("/part/text")
        .or_else(|| value.get("text"))
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

fn extract_reasoning_chunk(value: &Value) -> Option<String> {
    let event_type = value.get("type").and_then(Value::as_str)?;
    if event_type != "reasoning" {
        return None;
    }
    value
        .pointer("/part/text")
        .or_else(|| value.get("text"))
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

fn format_tool_use_block(value: &Value) -> Option<String> {
    let event_type = value.get("type").and_then(Value::as_str)?;
    if event_type != "tool_use" {
        return None;
    }

    let part = value.get("part").unwrap_or(value);
    let tool = part
        .get("tool")
        .and_then(Value::as_str)
        .unwrap_or("tool")
        .trim();
    let state = part.get("state").unwrap_or(part);
    let status = state
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("completed");
    // Pending/running tool events (if ever emitted) have no useful output yet.
    if matches!(status, "pending" | "running") {
        return None;
    }

    let input = state.get("input").cloned().unwrap_or(Value::Null);
    let detail = tool_input_detail(tool, &input);
    let title = state
        .get("title")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty() && !value.eq_ignore_ascii_case(tool))
        .or_else(|| {
            input
                .get("description")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
        });
    let output = state
        .get("output")
        .and_then(Value::as_str)
        .or_else(|| state.get("error").and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let exit_code = state
        .pointer("/metadata/exit")
        .and_then(Value::as_i64)
        .or_else(|| {
            state
                .pointer("/metadata/exit")
                .and_then(Value::as_u64)
                .map(|v| v as i64)
        });

    // Skip empty placeholders that only repeat the tool name.
    if detail.is_none() && output.is_none() && title.is_none() {
        return None;
    }

    let mut block = String::new();
    block.push_str("```");
    block.push_str(if tool.eq_ignore_ascii_case("bash") {
        "shell"
    } else {
        "text"
    });
    block.push('\n');
    if let Some(title) = title {
        block.push_str(&format!("# {tool}: {title}\n"));
    } else {
        block.push_str(&format!("# {tool}\n"));
    }
    if let Some(detail) = detail.as_deref() {
        block.push_str(detail);
        if !detail.ends_with('\n') {
            block.push('\n');
        }
    }
    if let Some(output) = output.as_deref() {
        block.push_str("---\n");
        block.push_str(output);
        if !output.ends_with('\n') {
            block.push('\n');
        }
    }
    if let Some(exit_code) = exit_code {
        block.push_str(&format!("(exit {exit_code})\n"));
    }
    block.push_str("```\n");
    Some(block)
}

fn tool_input_detail(tool: &str, input: &Value) -> Option<String> {
    if let Some(command) = input
        .get("command")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Some(format!("$ {command}"));
    }
    if let Some(path) = input
        .get("path")
        .or_else(|| input.get("filePath"))
        .or_else(|| input.get("file_path"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let label = if tool.eq_ignore_ascii_case("read") {
            "read"
        } else if tool.eq_ignore_ascii_case("write") || tool.eq_ignore_ascii_case("edit") {
            "path"
        } else {
            "path"
        };
        return Some(format!("{label}: {path}"));
    }
    if let Some(pattern) = input
        .get("pattern")
        .or_else(|| input.get("glob"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Some(format!("pattern: {pattern}"));
    }
    if let Some(query) = input
        .get("query")
        .or_else(|| input.get("url"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Some(query.to_string());
    }
    None
}

const OPENCODE_DETECT_TIMEOUT: Duration = Duration::from_secs(5);
const OPENCODE_MODELS_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone)]
struct OpenCodeCliCandidate {
    executable: String,
    source: &'static str,
}

fn opencode_executable(path: Option<&str>) -> String {
    path.map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("opencode")
        .to_string()
}

async fn discover_opencode_candidates(path: Option<&str>) -> Vec<OpenCodeCliCandidate> {
    let mut candidates = Vec::new();
    let mut seen = HashSet::new();

    if let Some(path) = path.map(str::trim).filter(|value| !value.is_empty()) {
        add_opencode_candidate(&mut candidates, &mut seen, path, "configured");
    }
    add_opencode_candidate(&mut candidates, &mut seen, "opencode", "path");
    add_common_opencode_candidates(&mut candidates, &mut seen);
    for discovered in discover_opencode_with_path_command().await {
        add_opencode_candidate(&mut candidates, &mut seen, discovered, "path_lookup");
    }

    // Prefer native binaries over Windows cmd/bat shims — CreateProcess rejects
    // many argv characters when the application itself is a batch file.
    candidates.sort_by_key(|candidate| is_windows_batch_script(&candidate.executable));
    candidates
}

fn is_windows_batch_script(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    lower.ends_with(".cmd") || lower.ends_with(".bat")
}

fn build_opencode_command(executable: &str) -> Command {
    #[cfg(windows)]
    {
        if is_windows_batch_script(executable) {
            // Spawning a .cmd/.bat via CreateProcess with complex args fails with
            // "batch file arguments are invalid". Route through cmd.exe instead.
            let mut command = Command::new("cmd.exe");
            hide_window(&mut command);
            command.arg("/D").arg("/C").arg(executable);
            return command;
        }
    }

    let mut command = Command::new(executable);
    hide_window(&mut command);
    command
}

fn sanitize_opencode_cli_arg(value: &str) -> String {
    // Batch parsers treat newlines as argument separators / invalid syntax.
    let mut sanitized = value.replace(['\r', '\n'], " ");
    #[cfg(windows)]
    {
        // cmd.exe expands %VAR%; neutralize when going through .cmd wrappers.
        sanitized = sanitized.replace('%', "%%");
    }
    sanitized
}

fn add_opencode_candidate(
    candidates: &mut Vec<OpenCodeCliCandidate>,
    seen: &mut HashSet<String>,
    executable: impl AsRef<str>,
    source: &'static str,
) {
    let executable = executable.as_ref().trim();
    if executable.is_empty() {
        return;
    }
    let key = opencode_candidate_key(executable);
    if seen.insert(key) {
        candidates.push(OpenCodeCliCandidate {
            executable: executable.to_string(),
            source,
        });
    }
}

fn add_existing_opencode_candidate(
    candidates: &mut Vec<OpenCodeCliCandidate>,
    seen: &mut HashSet<String>,
    path: PathBuf,
    source: &'static str,
) {
    if path.exists() {
        add_opencode_candidate(candidates, seen, path.to_string_lossy(), source);
    }
}

fn opencode_candidate_key(executable: &str) -> String {
    #[cfg(windows)]
    {
        executable.to_ascii_lowercase()
    }
    #[cfg(not(windows))]
    {
        executable.to_string()
    }
}

fn add_common_opencode_candidates(
    candidates: &mut Vec<OpenCodeCliCandidate>,
    seen: &mut HashSet<String>,
) {
    #[cfg(windows)]
    {
        if let Ok(appdata) = env::var("APPDATA") {
            let npm = Path::new(&appdata).join("npm");
            for name in ["opencode.exe", "opencode.cmd", "opencode"] {
                add_existing_opencode_candidate(candidates, seen, npm.join(name), "common");
            }
        }
        if let Ok(local_appdata) = env::var("LOCALAPPDATA") {
            let pnpm = Path::new(&local_appdata).join("pnpm");
            for name in ["opencode.exe", "opencode.cmd", "opencode"] {
                add_existing_opencode_candidate(candidates, seen, pnpm.join(name), "common");
            }
            let opencode_home = Path::new(&local_appdata).join("opencode");
            for name in ["opencode.exe", "opencode.cmd", "opencode"] {
                add_existing_opencode_candidate(candidates, seen, opencode_home.join(name), "common");
            }
        }
        if let Ok(userprofile) = env::var("USERPROFILE") {
            let home = Path::new(&userprofile);
            for dir in [
                home.join("scoop").join("shims"),
                home.join(".bun").join("bin"),
                home.join(".opencode").join("bin"),
                home.join(".local").join("bin"),
            ] {
                for name in ["opencode.exe", "opencode.cmd", "opencode"] {
                    add_existing_opencode_candidate(candidates, seen, dir.join(name), "common");
                }
            }
        }
    }

    #[cfg(not(windows))]
    {
        if let Ok(home) = env::var("HOME") {
            let home = Path::new(&home);
            for path in [
                home.join(".local").join("bin").join("opencode"),
                home.join(".opencode").join("bin").join("opencode"),
                home.join(".npm-global").join("bin").join("opencode"),
                home.join(".bun").join("bin").join("opencode"),
            ] {
                add_existing_opencode_candidate(candidates, seen, path, "common");
            }
        }
        for path in [
            PathBuf::from("/opt/homebrew/bin/opencode"),
            PathBuf::from("/usr/local/bin/opencode"),
            PathBuf::from("/usr/bin/opencode"),
        ] {
            add_existing_opencode_candidate(candidates, seen, path, "common");
        }
    }
}

async fn discover_opencode_with_path_command() -> Vec<String> {
    let mut command = if cfg!(windows) {
        let mut command = Command::new("where.exe");
        command.arg("opencode");
        command
    } else {
        let mut command = Command::new("which");
        command.args(["-a", "opencode"]);
        command
    };
    hide_window(&mut command);
    let output = command.output().await;

    let Ok(output) = output else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect()
}

async fn probe_opencode_cli(executable: &str) -> Result<String, String> {
    let mut command = build_opencode_command(executable);
    command.arg("--version");
    let output = timeout(OPENCODE_DETECT_TIMEOUT, command.output())
        .await
        .map_err(|_| "timed out while running --version".to_string())?
        .map_err(|error| error.to_string())?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Ok(if stdout.is_empty() { stderr } else { stdout });
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let details = if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        output.status.to_string()
    };
    Err(details)
}

fn detect_error_message(prefix: &str, errors: &[String]) -> String {
    if errors.is_empty() {
        return format!("{prefix} in PATH or common install locations");
    }

    let mut message = prefix.to_string();
    for error in errors.iter().take(4) {
        message.push_str("; ");
        message.push_str(error);
    }
    if errors.len() > 4 {
        message.push_str(&format!("; {} more candidates failed", errors.len() - 4));
    }
    message
}

async fn read_opencode_stderr(stderr: tokio::process::ChildStderr) {
    let mut lines = BufReader::new(stderr).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let sanitized = sanitize_opencode_log_line(&line);
        if !sanitized.trim().is_empty() {
            tracing::debug!(target: "opencode", message = %sanitized);
        }
    }
}

fn sanitize_opencode_log_line(line: &str) -> String {
    redact_marker_values(
        line,
        &[
            "access_token=",
            "refresh_token=",
            "id_token=",
            "api_key=",
            "code=",
        ],
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_text_and_reasoning_chunks() {
        let text = serde_json::json!({
            "type": "text",
            "sessionID": "ses_abc",
            "part": { "type": "text", "text": "hello" }
        });
        let reasoning = serde_json::json!({
            "type": "reasoning",
            "part": { "type": "reasoning", "text": "thinking" }
        });

        assert_eq!(extract_text_chunk(&text).as_deref(), Some("hello"));
        assert_eq!(
            extract_reasoning_chunk(&reasoning).as_deref(),
            Some("thinking")
        );
        assert_eq!(extract_session_id(&text).as_deref(), Some("ses_abc"));
    }

    #[test]
    fn extracts_tool_summary() {
        let tool = serde_json::json!({
            "type": "tool_use",
            "part": {
                "tool": "bash",
                "state": {
                    "status": "completed",
                    "title": "Switch drive",
                    "input": { "command": "Set-Location D:" },
                    "output": "D:\\",
                    "metadata": { "exit": 0 }
                }
            }
        });
        let block = format_tool_use_block(&tool).expect("tool block");
        assert!(block.contains("$ Set-Location D:"));
        assert!(block.contains("D:\\"));
        assert!(block.contains("(exit 0)"));
        assert!(!block.contains("[OpenCode bash"));
    }

    #[test]
    fn skips_placeholder_tool_use_without_detail() {
        let tool = serde_json::json!({
            "type": "tool_use",
            "part": {
                "tool": "bash",
                "state": {
                    "status": "completed",
                    "title": "bash",
                    "input": {}
                }
            }
        });
        assert!(format_tool_use_block(&tool).is_none());
    }

    #[test]
    fn sanitizes_cli_args_for_windows_batch() {
        let sanitized = sanitize_opencode_cli_arg("line1\r\nline2 %PATH%");
        assert!(!sanitized.contains('\n'));
        assert!(!sanitized.contains('\r'));
        #[cfg(windows)]
        assert!(sanitized.contains("%%PATH%%"));
    }

    #[test]
    fn opencode_prompt_is_not_ask_json_schema() {
        use crate::core::ai::types::{AiAction, AiContext, AiRequestOptions};

        let request = AiChatRequest {
            stream_id: None,
            session_id: None,
            connection_id: None,
            terminal_session_id: None,
            owner_scope: Default::default(),
            targets: vec![],
            target_contexts: vec![],
            mode: crate::config::AiMode::Agent,
            agent_kind: crate::config::AiAgentKind::OpenCode,
            permission_mode: AiPermissionMode::Confirm,
            model_id: None,
            model_name: Some("opencode/gpt".into()),
            default_target_session_id: None,
            existing_external_session_id: None,
            attachments: vec![],
            action: AiAction::GenerateCommand,
            user_input: "切换到d盘".into(),
            context: AiContext {
                connection_name: Some("local".into()),
                cwd: Some("C:\\Users\\me".into()),
                os: Some("windows".into()),
                ..AiContext::default()
            },
            options: AiRequestOptions {
                language: "zh-CN".into(),
                safety_mode: "strict".into(),
                max_output_commands: 2,
                ..AiRequestOptions::default()
            },
        };
        let settings = AiSettings::default();
        let prompt = build_opencode_turn_prompt(&request, &settings, true);
        assert!(prompt.contains("切换到d盘"));
        assert!(prompt.contains("Do NOT answer with a NyaTerm Ask-mode JSON"));
        assert!(prompt.contains("nyaterm_terminal.execute_command"));
        assert!(!prompt.contains("必须返回 JSON 对象"));
        assert!(!prompt.contains("must return a JSON object"));
    }
}
