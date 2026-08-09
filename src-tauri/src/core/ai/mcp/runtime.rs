use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use axum::Router;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use serde_json::{Value, json};
use tauri::AppHandle;
use tokio::net::TcpListener;
use tokio::sync::{Mutex, OnceCell};
use tower_http::cors::{Any, CorsLayer};
use uuid::Uuid;

use crate::config::AiSettings;
use crate::core::ai::agent::{AgentApprovalManager, run_external_agent_command_step};
use crate::core::ai::types::AiChatRequest;
use crate::core::session::SessionManager;
use crate::error::{AppError, AppResult};

use super::tools::{
    observation_text, parse_execute_command_args, resolve_command_target, terminal_context_text,
};

#[derive(Debug, Clone)]
pub struct McpEndpoint {
    pub url: String,
    pub token: String,
}

pub struct RegisterMcpTurnRequest {
    pub app: AppHandle,
    pub session_manager: Arc<SessionManager>,
    pub approval_manager: Arc<AgentApprovalManager>,
    pub stream_id: String,
    pub session_id: String,
    pub request: AiChatRequest,
    pub settings: AiSettings,
}

#[derive(Clone)]
struct ActiveMcpTurn {
    app: AppHandle,
    session_manager: Arc<SessionManager>,
    approval_manager: Arc<AgentApprovalManager>,
    stream_id: String,
    session_id: String,
    request: AiChatRequest,
    settings: AiSettings,
    step_counter: Arc<Mutex<u16>>,
}

#[derive(Clone)]
struct McpHttpState {
    turns: Arc<Mutex<HashMap<String, ActiveMcpTurn>>>,
}

pub struct NyaTermMcpRuntime {
    turns: Arc<Mutex<HashMap<String, ActiveMcpTurn>>>,
    endpoint_url: OnceCell<String>,
    started: AtomicBool,
}

impl Default for NyaTermMcpRuntime {
    fn default() -> Self {
        Self::new()
    }
}

impl NyaTermMcpRuntime {
    pub fn new() -> Self {
        Self {
            turns: Arc::new(Mutex::new(HashMap::new())),
            endpoint_url: OnceCell::new(),
            started: AtomicBool::new(false),
        }
    }

    pub async fn register_turn(
        &self,
        request: RegisterMcpTurnRequest,
    ) -> AppResult<McpEndpoint> {
        self.ensure_started().await?;
        let url = self
            .endpoint_url
            .get()
            .cloned()
            .ok_or_else(|| AppError::Config("MCP endpoint is not ready".to_string()))?;
        let token = format!("nyt-{}", Uuid::new_v4());
        self.turns.lock().await.insert(
            token.clone(),
            ActiveMcpTurn {
                app: request.app,
                session_manager: request.session_manager,
                approval_manager: request.approval_manager,
                stream_id: request.stream_id,
                session_id: request.session_id,
                request: request.request,
                settings: request.settings,
                step_counter: Arc::new(Mutex::new(0)),
            },
        );
        Ok(McpEndpoint { url, token })
    }

    pub async fn unregister_turn(&self, token: &str) {
        self.turns.lock().await.remove(token);
    }

    async fn ensure_started(&self) -> AppResult<()> {
        if self.started.load(Ordering::SeqCst) && self.endpoint_url.get().is_some() {
            return Ok(());
        }
        if self
            .started
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            for _ in 0..50 {
                if self.endpoint_url.get().is_some() {
                    return Ok(());
                }
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            }
            return Err(AppError::Config(
                "Timed out waiting for MCP server".to_string(),
            ));
        }

        let listener = TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0)))
            .await
            .map_err(|error| AppError::Config(format!("Failed to bind MCP server: {error}")))?;
        let addr = listener
            .local_addr()
            .map_err(|error| AppError::Config(format!("Failed to read MCP bind address: {error}")))?;
        let url = format!("http://127.0.0.1:{}/mcp", addr.port());
        let _ = self.endpoint_url.set(url);

        let state = McpHttpState {
            turns: self.turns.clone(),
        };
        let app = Router::new()
            .route("/mcp", post(handle_mcp_post).get(handle_mcp_get))
            .route("/health", get(|| async { StatusCode::OK }))
            .layer(
                CorsLayer::new()
                    .allow_origin(Any)
                    .allow_methods(Any)
                    .allow_headers(Any),
            )
            .with_state(state);

        tauri::async_runtime::spawn(async move {
            if let Err(error) = axum::serve(listener, app).await {
                tracing::error!(target: "nyaterm_mcp", "MCP HTTP server stopped: {error}");
            }
        });
        Ok(())
    }
}

fn extract_bearer_token(headers: &HeaderMap) -> Option<String> {
    let value = headers.get(axum::http::header::AUTHORIZATION)?.to_str().ok()?;
    let token = value
        .strip_prefix("Bearer ")
        .or_else(|| value.strip_prefix("bearer "))
        .unwrap_or(value)
        .trim();
    (!token.is_empty()).then(|| token.to_string())
}

async fn handle_mcp_get() -> impl IntoResponse {
    (
        StatusCode::METHOD_NOT_ALLOWED,
        json!({
            "jsonrpc": "2.0",
            "error": {
                "code": -32600,
                "message": "SSE GET is not required; use POST Streamable HTTP"
            }
        })
        .to_string(),
    )
}

async fn handle_mcp_post(
    State(state): State<McpHttpState>,
    headers: HeaderMap,
    body: String,
) -> Response {
    let Some(token) = extract_bearer_token(&headers) else {
        return (
            StatusCode::UNAUTHORIZED,
            [(axum::http::header::CONTENT_TYPE, "application/json")],
            json!({"jsonrpc":"2.0","error":{"code":-32001,"message":"Missing Authorization bearer token"}}).to_string(),
        )
            .into_response();
    };

    let turn = {
        let turns = state.turns.lock().await;
        turns.get(&token).cloned()
    };
    let Some(turn) = turn else {
        return (
            StatusCode::UNAUTHORIZED,
            [(axum::http::header::CONTENT_TYPE, "application/json")],
            json!({"jsonrpc":"2.0","error":{"code":-32001,"message":"Unknown or expired MCP turn token"}}).to_string(),
        )
            .into_response();
    };

    let Ok(payload) = serde_json::from_str::<Value>(&body) else {
        return json_rpc_error(None, -32700, "Parse error").into_response();
    };

    // Batch requests are uncommon for MCP clients we care about; reject clearly.
    if payload.as_array().is_some() {
        return json_rpc_error(None, -32600, "Batch JSON-RPC is not supported").into_response();
    }

    // Notifications have no id and need no response body content beyond 202/empty.
    let is_notification = payload.get("id").is_none();
    let method = payload
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if is_notification {
        if method == "notifications/initialized" || method == "initialized" {
            return StatusCode::ACCEPTED.into_response();
        }
        return StatusCode::ACCEPTED.into_response();
    }

    let id = payload.get("id").cloned().unwrap_or(Value::Null);
    match method {
        "initialize" => json_rpc_result(
            id,
            json!({
                "protocolVersion": "2024-11-05",
                "capabilities": {
                    "tools": { "listChanged": false }
                },
                "serverInfo": {
                    "name": "nyaterm_terminal",
                    "version": env!("CARGO_PKG_VERSION")
                },
                "instructions": "Operate the active NyaTerm terminal sessions. Prefer these tools over local shell/bash when working with the user's NyaTerm terminal pane."
            }),
        )
        .into_response(),
        "ping" => json_rpc_result(id, json!({})).into_response(),
        "tools/list" => json_rpc_result(id, json!({ "tools": tool_descriptors() })).into_response(),
        "tools/call" => {
            let params = payload.get("params").cloned().unwrap_or(Value::Null);
            match handle_tools_call(&turn, params).await {
                Ok(result) => json_rpc_result(id, result).into_response(),
                Err(message) => json_rpc_result(
                    id,
                    json!({
                        "content": [{ "type": "text", "text": message }],
                        "isError": true
                    }),
                )
                .into_response(),
            }
        }
        other => json_rpc_error(Some(id), -32601, &format!("Method not found: {other}"))
            .into_response(),
    }
}

fn tool_descriptors() -> Value {
    json!([
        {
            "name": "get_context",
            "description": "Read the available NyaTerm terminal targets and recent terminal context.",
            "inputSchema": {
                "type": "object",
                "properties": {}
            }
        },
        {
            "name": "execute_command",
            "description": "Execute a shell command in a NyaTerm terminal session after NyaTerm approval policy is applied. Omit targetTerminalSessionId to use the current/default terminal session.",
            "inputSchema": {
                "type": "object",
                "required": ["command"],
                "properties": {
                    "targetTerminalSessionId": { "type": "string" },
                    "command": { "type": "string" },
                    "reason": { "type": "string" }
                }
            }
        }
    ])
}

async fn handle_tools_call(turn: &ActiveMcpTurn, params: Value) -> Result<Value, String> {
    let name = params
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(|| "tool name is required".to_string())?;
    let arguments = params.get("arguments").cloned().unwrap_or(Value::Null);

    match name {
        "get_context" => Ok(json!({
            "content": [{
                "type": "text",
                "text": terminal_context_text(&turn.request)
            }],
            "isError": false
        })),
        "execute_command" => {
            let args = parse_execute_command_args(&arguments)?;
            let target = resolve_command_target(
                &turn.request,
                args.target_terminal_session_id.as_deref(),
            )?;
            let step_index = {
                let mut counter = turn.step_counter.lock().await;
                *counter = counter.saturating_add(1);
                *counter
            };
            match run_external_agent_command_step(
                &turn.app,
                turn.session_manager.clone(),
                turn.approval_manager.clone(),
                &turn.stream_id,
                &turn.session_id,
                &turn.request,
                &turn.settings,
                step_index,
                args.command,
                args.reason,
                target,
            )
            .await
            {
                Ok(observation) => Ok(json!({
                    "content": [{
                        "type": "text",
                        "text": observation_text(&observation)
                    }],
                    "isError": false
                })),
                Err(error) => Ok(json!({
                    "content": [{
                        "type": "text",
                        "text": error.to_string()
                    }],
                    "isError": true
                })),
            }
        }
        other => Err(format!("Unknown tool: {other}")),
    }
}

fn json_rpc_result(id: Value, result: Value) -> (StatusCode, [(axum::http::HeaderName, &'static str); 1], String)
{
    (
        StatusCode::OK,
        [(axum::http::header::CONTENT_TYPE, "application/json")],
        json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": result
        })
        .to_string(),
    )
}

fn json_rpc_error(
    id: Option<Value>,
    code: i64,
    message: &str,
) -> (StatusCode, [(axum::http::HeaderName, &'static str); 1], String) {
    (
        StatusCode::OK,
        [(axum::http::header::CONTENT_TYPE, "application/json")],
        json!({
            "jsonrpc": "2.0",
            "id": id.unwrap_or(Value::Null),
            "error": {
                "code": code,
                "message": message
            }
        })
        .to_string(),
    )
}
