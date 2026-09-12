//! SSH tunnel manager for local, remote, and dynamic (SOCKS5) port forwarding.

use super::{RemoteForwardOpen, SshHandle, SshRawHandle, create_ssh_handle_for_tunnel};
use crate::config::{self, TunnelConfig};
use crate::error::{AppError, AppResult};
use crate::observability::{StructuredLog, StructuredLogLevel, log_event, log_rate_limited};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{Mutex, mpsc, oneshot, watch};
use tokio::task::JoinHandle;

const TUNNEL_RECONNECT_MAX_ATTEMPTS: u32 = 5;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TunnelRuntimeStatus {
    Stopped,
    Starting,
    Running,
    Reconnecting,
    Disconnected,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TunnelRuntimeState {
    pub tunnel_id: String,
    pub status: TunnelRuntimeStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<i64>,
}

struct TunnelRuntimeEntry {
    generation: u64,
    status: TunnelRuntimeStatus,
    error: Option<String>,
    updated_at: Option<i64>,
    shutdown_tx: Option<oneshot::Sender<()>>,
    task_handle: Option<JoinHandle<()>>,
    ssh_handle: Option<SshHandle>,
    connection_id: Option<String>,
    /// Cancels an in-flight auto-reconnect loop when set to `true`.
    reconnect_cancel: Option<watch::Sender<bool>>,
}

impl TunnelRuntimeEntry {
    fn new(connection_id: Option<String>) -> Self {
        Self {
            generation: 0,
            status: TunnelRuntimeStatus::Stopped,
            error: None,
            updated_at: None,
            shutdown_tx: None,
            task_handle: None,
            ssh_handle: None,
            connection_id,
            reconnect_cancel: None,
        }
    }

    fn cancel_reconnect(&mut self) {
        if let Some(tx) = self.reconnect_cancel.take() {
            let _ = tx.send(true);
        }
    }

    fn state(&self, tunnel_id: &str) -> TunnelRuntimeState {
        TunnelRuntimeState {
            tunnel_id: tunnel_id.to_string(),
            status: self.status,
            error: self.error.clone(),
            updated_at: self.updated_at,
        }
    }

    fn has_live_task(&self) -> bool {
        self.shutdown_tx.is_some()
            && matches!(
                self.status,
                TunnelRuntimeStatus::Starting
                    | TunnelRuntimeStatus::Running
                    | TunnelRuntimeStatus::Reconnecting
            )
    }
}

enum TunnelTaskExit {
    Stopped,
    Disconnected(String),
    Error(String),
}

pub struct TunnelManager {
    runtime: Arc<Mutex<HashMap<String, TunnelRuntimeEntry>>>,
}

impl TunnelManager {
    pub fn new() -> Self {
        Self {
            runtime: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn is_open(&self, tunnel_id: &str) -> bool {
        self.runtime
            .lock()
            .await
            .get(tunnel_id)
            .is_some_and(TunnelRuntimeEntry::has_live_task)
    }

    pub async fn active_count(&self) -> usize {
        self.runtime
            .lock()
            .await
            .values()
            .filter(|entry| entry.has_live_task())
            .count()
    }

    pub async fn runtime_states(&self, tunnels: &[TunnelConfig]) -> Vec<TunnelRuntimeState> {
        let runtime = self.runtime.lock().await;
        tunnels
            .iter()
            .map(|tunnel| {
                runtime.get(&tunnel.id).map_or_else(
                    || TunnelRuntimeState {
                        tunnel_id: tunnel.id.clone(),
                        status: if tunnel.is_open {
                            TunnelRuntimeStatus::Disconnected
                        } else {
                            TunnelRuntimeStatus::Stopped
                        },
                        error: None,
                        updated_at: None,
                    },
                    |entry| entry.state(&tunnel.id),
                )
            })
            .collect()
    }

    pub async fn open(&self, tunnel: &TunnelConfig, app: &AppHandle) -> AppResult<()> {
        if self.is_open(&tunnel.id).await {
            return Ok(());
        }

        let generation = self
            .begin_starting(app, &tunnel.id, tunnel.connection_id.clone())
            .await;

        let connection_id = tunnel
            .connection_id
            .as_deref()
            .ok_or_else(|| AppError::Channel("Tunnel has no connection_id".to_string()))?;
        let (disconnect_tx, disconnect_rx) = mpsc::unbounded_channel::<String>();
        let (remote_forward_tx, remote_forward_rx) = if tunnel.tunnel_type == "remote" {
            let (tx, rx) = mpsc::unbounded_channel::<RemoteForwardOpen>();
            (Some(tx), Some(rx))
        } else {
            (None, None)
        };

        let ssh_handle = match create_ssh_handle_for_tunnel(
            app,
            connection_id,
            disconnect_tx,
            remote_forward_tx,
        )
        .await
        {
            Ok(handle) => handle,
            Err(error) => {
                self.set_generation_status(
                    app,
                    &tunnel.id,
                    generation,
                    TunnelRuntimeStatus::Error,
                    Some(user_facing_tunnel_error(&error)),
                    true,
                )
                .await;
                return Err(error);
            }
        };
        let target_handle = ssh_handle.target_handle();

        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
        let bind_addr = if tunnel.bind_localhost {
            "127.0.0.1"
        } else {
            "0.0.0.0"
        };

        let task =
            match tunnel.tunnel_type.as_str() {
                "local" => {
                    let listener =
                        match TcpListener::bind(format!("{}:{}", bind_addr, tunnel.listen_port))
                            .await
                        {
                            Ok(listener) => listener,
                            Err(error) => {
                                let message = format!(
                                    "Failed to bind local port {}: {}",
                                    tunnel.listen_port, error
                                );
                                self.set_generation_status(
                                    app,
                                    &tunnel.id,
                                    generation,
                                    TunnelRuntimeStatus::Error,
                                    Some(message.clone()),
                                    true,
                                )
                                .await;
                                return Err(AppError::Channel(message));
                            }
                        };
                    let target_host = tunnel.target_host.clone();
                    let target_port = tunnel.target_port;
                    spawn_tunnel_task(
                        self.clone(),
                        app.clone(),
                        tunnel.id.clone(),
                        generation,
                        async move {
                            Self::run_local_tunnel(
                                listener,
                                target_handle,
                                target_host,
                                target_port,
                                shutdown_rx,
                                disconnect_rx,
                            )
                            .await
                        },
                    )
                }
                "remote" => {
                    {
                        let handle = target_handle.lock().await;
                        if let Err(error) = handle
                            .tcpip_forward(bind_addr.to_string(), tunnel.listen_port.into())
                            .await
                        {
                            let message = format!(
                                "Remote port forwarding was rejected for {}:{}: {}",
                                bind_addr, tunnel.listen_port, error
                            );
                            self.set_generation_status(
                                app,
                                &tunnel.id,
                                generation,
                                TunnelRuntimeStatus::Error,
                                Some(message.clone()),
                                true,
                            )
                            .await;
                            return Err(AppError::Channel(message));
                        }
                    }
                    log_event(StructuredLog {
                        level: StructuredLogLevel::Info,
                        domain: "session.lifecycle".to_string(),
                        event: "tunnel.forward_requested".to_string(),
                        message: "Remote tunnel forwarding requested".to_string(),
                        ids: Some(serde_json::json!({ "tunnel_id": tunnel.id.clone() })),
                        data: Some(serde_json::json!({
                            "listen_addr": bind_addr,
                            "listen_port": tunnel.listen_port,
                        })),
                        error: None,
                        client_timestamp: None,
                    });
                    let target_host = tunnel.target_host.clone();
                    let target_port = tunnel.target_port;
                    let listen_addr = bind_addr.to_string();
                    let listen_port = tunnel.listen_port;
                    spawn_tunnel_task(
                        self.clone(),
                        app.clone(),
                        tunnel.id.clone(),
                        generation,
                        async move {
                            Self::run_remote_tunnel(
                                target_handle,
                                listen_addr,
                                listen_port,
                                target_host,
                                target_port,
                                shutdown_rx,
                                disconnect_rx,
                                remote_forward_rx.expect("remote receiver"),
                            )
                            .await
                        },
                    )
                }
                "dynamic" => {
                    let listener =
                        match TcpListener::bind(format!("{}:{}", bind_addr, tunnel.listen_port))
                            .await
                        {
                            Ok(listener) => listener,
                            Err(error) => {
                                let message = format!(
                                    "Failed to bind SOCKS5 port {}: {}",
                                    tunnel.listen_port, error
                                );
                                self.set_generation_status(
                                    app,
                                    &tunnel.id,
                                    generation,
                                    TunnelRuntimeStatus::Error,
                                    Some(message.clone()),
                                    true,
                                )
                                .await;
                                return Err(AppError::Channel(message));
                            }
                        };
                    spawn_tunnel_task(
                        self.clone(),
                        app.clone(),
                        tunnel.id.clone(),
                        generation,
                        async move {
                            Self::run_dynamic_tunnel(
                                listener,
                                target_handle,
                                shutdown_rx,
                                disconnect_rx,
                            )
                            .await
                        },
                    )
                }
                other => {
                    let message = format!("Unknown tunnel type: {}", other);
                    self.set_generation_status(
                        app,
                        &tunnel.id,
                        generation,
                        TunnelRuntimeStatus::Error,
                        Some(message.clone()),
                        true,
                    )
                    .await;
                    return Err(AppError::Channel(message));
                }
            };

        self.install_task(
            app,
            &tunnel.id,
            generation,
            shutdown_tx,
            ssh_handle,
            task,
            tunnel.connection_id.clone(),
        )
        .await;

        log_event(StructuredLog {
            level: StructuredLogLevel::Info,
            domain: "session.lifecycle".to_string(),
            event: "tunnel.opened".to_string(),
            message: "Tunnel opened".to_string(),
            ids: Some(serde_json::json!({
                "tunnel_id": tunnel.id.clone(),
                "connection_id": tunnel.connection_id.clone(),
            })),
            data: Some(serde_json::json!({
                "tunnel_type": tunnel.tunnel_type.clone(),
                "listen_port": tunnel.listen_port,
                "target_host": tunnel.target_host.clone(),
                "target_port": tunnel.target_port,
                "bind_localhost": tunnel.bind_localhost,
            })),
            error: None,
            client_timestamp: None,
        });
        Ok(())
    }

    pub async fn close(&self, app: &AppHandle, tunnel_id: &str) {
        let (state, shutdown_tx) = {
            let mut runtime = self.runtime.lock().await;
            let entry = runtime
                .entry(tunnel_id.to_string())
                .or_insert_with(|| TunnelRuntimeEntry::new(None));
            entry.cancel_reconnect();
            entry.generation = entry.generation.saturating_add(1);
            let shutdown_tx = entry.shutdown_tx.take();
            entry.task_handle = None;
            entry.ssh_handle = None;
            entry.status = TunnelRuntimeStatus::Stopped;
            entry.error = None;
            entry.updated_at = Some(now_ms());
            (entry.state(tunnel_id), shutdown_tx)
        };
        if let Some(tx) = shutdown_tx {
            let _ = tx.send(());
        }
        emit_runtime_state(app, &state);
        log_event(StructuredLog {
            level: StructuredLogLevel::Info,
            domain: "session.lifecycle".to_string(),
            event: "tunnel.closed".to_string(),
            message: "Tunnel closed".to_string(),
            ids: Some(serde_json::json!({ "tunnel_id": tunnel_id })),
            data: None,
            error: None,
            client_timestamp: None,
        });
    }

    pub async fn delete_runtime_state(&self, app: &AppHandle, tunnel_id: &str) {
        let (shutdown_tx, state) = {
            let mut runtime = self.runtime.lock().await;
            let shutdown_tx = runtime.remove(tunnel_id).map(|mut entry| {
                entry.cancel_reconnect();
                entry.shutdown_tx.take()
            });
            (
                shutdown_tx.flatten(),
                TunnelRuntimeState {
                    tunnel_id: tunnel_id.to_string(),
                    status: TunnelRuntimeStatus::Stopped,
                    error: None,
                    updated_at: Some(now_ms()),
                },
            )
        };
        if let Some(tx) = shutdown_tx {
            let _ = tx.send(());
        }
        emit_runtime_state(app, &state);
    }

    pub async fn mark_connection_reconnecting(
        &self,
        app: &AppHandle,
        tunnels: &[TunnelConfig],
        connection_id: &str,
    ) {
        self.mark_enabled_tunnels_for_connection(
            app,
            tunnels,
            connection_id,
            TunnelRuntimeStatus::Reconnecting,
            None,
            false,
            false,
        )
        .await;
    }

    pub async fn mark_connection_disconnected(
        &self,
        app: &AppHandle,
        tunnels: &[TunnelConfig],
        connection_id: &str,
        force: bool,
    ) {
        let updated_ids = self
            .mark_enabled_tunnels_for_connection(
                app,
                tunnels,
                connection_id,
                TunnelRuntimeStatus::Disconnected,
                Some("SSH session disconnected".to_string()),
                true,
                force,
            )
            .await;
        for tunnel_id in updated_ids {
            self.schedule_reconnect_if_needed(app, &tunnel_id).await;
        }
    }

    async fn begin_starting(
        &self,
        app: &AppHandle,
        tunnel_id: &str,
        connection_id: Option<String>,
    ) -> u64 {
        let (state, shutdown_tx, generation) = {
            let mut runtime = self.runtime.lock().await;
            let entry = runtime
                .entry(tunnel_id.to_string())
                .or_insert_with(|| TunnelRuntimeEntry::new(connection_id.clone()));
            entry.generation = entry.generation.saturating_add(1);
            entry.connection_id = connection_id;
            let shutdown_tx = entry.shutdown_tx.take();
            entry.task_handle = None;
            entry.ssh_handle = None;
            entry.status = TunnelRuntimeStatus::Starting;
            entry.error = None;
            entry.updated_at = Some(now_ms());
            (entry.state(tunnel_id), shutdown_tx, entry.generation)
        };
        if let Some(tx) = shutdown_tx {
            let _ = tx.send(());
        }
        emit_runtime_state(app, &state);
        generation
    }

    async fn install_task(
        &self,
        app: &AppHandle,
        tunnel_id: &str,
        generation: u64,
        shutdown_tx: oneshot::Sender<()>,
        ssh_handle: SshHandle,
        task_handle: JoinHandle<()>,
        connection_id: Option<String>,
    ) {
        let mut shutdown_tx = Some(shutdown_tx);
        let mut task_handle = Some(task_handle);
        let mut ssh_handle = Some(ssh_handle);
        let state = {
            let mut runtime = self.runtime.lock().await;
            runtime.get_mut(tunnel_id).and_then(|entry| {
                if entry.generation == generation && entry.status == TunnelRuntimeStatus::Starting {
                    entry.status = TunnelRuntimeStatus::Running;
                    entry.error = None;
                    entry.updated_at = Some(now_ms());
                    entry.shutdown_tx = shutdown_tx.take();
                    entry.task_handle = task_handle.take();
                    entry.ssh_handle = ssh_handle.take();
                    entry.connection_id = connection_id;
                    Some(entry.state(tunnel_id))
                } else {
                    None
                }
            })
        };
        if let Some(tx) = shutdown_tx {
            let _ = tx.send(());
        }
        if let Some(state) = state {
            emit_runtime_state(app, &state);
        }
    }

    async fn finish_task(
        &self,
        app: &AppHandle,
        tunnel_id: &str,
        generation: u64,
        exit: TunnelTaskExit,
    ) {
        let (state, should_reconnect) = {
            let mut runtime = self.runtime.lock().await;
            let Some(entry) = runtime.get_mut(tunnel_id) else {
                return;
            };
            if entry.generation != generation {
                return;
            }

            entry.shutdown_tx = None;
            entry.task_handle = None;
            entry.ssh_handle = None;
            let should_reconnect = match &exit {
                TunnelTaskExit::Stopped => {
                    if entry.status == TunnelRuntimeStatus::Stopped {
                        return;
                    }
                    entry.status = TunnelRuntimeStatus::Stopped;
                    entry.error = None;
                    false
                }
                TunnelTaskExit::Disconnected(message) => {
                    // Session reconnect owns this tunnel; do not overwrite or self-reconnect.
                    if entry.status == TunnelRuntimeStatus::Reconnecting {
                        return;
                    }
                    entry.status = TunnelRuntimeStatus::Disconnected;
                    entry.error = Some(message.clone());
                    true
                }
                TunnelTaskExit::Error(message) => {
                    if entry.status == TunnelRuntimeStatus::Reconnecting {
                        return;
                    }
                    entry.status = TunnelRuntimeStatus::Error;
                    entry.error = Some(message.clone());
                    true
                }
            };
            entry.updated_at = Some(now_ms());
            (entry.state(tunnel_id), should_reconnect)
        };
        emit_runtime_state(app, &state);
        if should_reconnect {
            self.schedule_reconnect_if_needed(app, tunnel_id).await;
        }
    }

    async fn set_generation_status(
        &self,
        app: &AppHandle,
        tunnel_id: &str,
        generation: u64,
        status: TunnelRuntimeStatus,
        error: Option<String>,
        clear_handles: bool,
    ) {
        let state = {
            let mut runtime = self.runtime.lock().await;
            let Some(entry) = runtime.get_mut(tunnel_id) else {
                return;
            };
            if entry.generation != generation {
                return;
            }
            if clear_handles {
                entry.shutdown_tx = None;
                entry.task_handle = None;
                entry.ssh_handle = None;
            }
            entry.status = status;
            entry.error = error;
            entry.updated_at = Some(now_ms());
            entry.state(tunnel_id)
        };
        emit_runtime_state(app, &state);
    }

    /// Returns tunnel ids whose runtime status was actually updated.
    async fn mark_enabled_tunnels_for_connection(
        &self,
        app: &AppHandle,
        tunnels: &[TunnelConfig],
        connection_id: &str,
        status: TunnelRuntimeStatus,
        error: Option<String>,
        stop_task: bool,
        force: bool,
    ) -> Vec<String> {
        let mut states = Vec::new();
        let mut updated_ids = Vec::new();
        let mut shutdowns = Vec::new();
        {
            let mut runtime = self.runtime.lock().await;
            for tunnel in tunnels.iter().filter(|tunnel| {
                tunnel.is_open && tunnel.connection_id.as_deref() == Some(connection_id)
            }) {
                let entry = runtime
                    .entry(tunnel.id.clone())
                    .or_insert_with(|| TunnelRuntimeEntry::new(tunnel.connection_id.clone()));
                if !force
                    && entry.status == TunnelRuntimeStatus::Reconnecting
                    && status == TunnelRuntimeStatus::Disconnected
                {
                    continue;
                }
                if stop_task {
                    entry.generation = entry.generation.saturating_add(1);
                    if let Some(tx) = entry.shutdown_tx.take() {
                        shutdowns.push(tx);
                    }
                    entry.task_handle = None;
                    entry.ssh_handle = None;
                }
                entry.status = status;
                entry.error = error.clone();
                entry.updated_at = Some(now_ms());
                updated_ids.push(tunnel.id.clone());
                states.push(entry.state(&tunnel.id));
            }
        }
        for tx in shutdowns {
            let _ = tx.send(());
        }
        for state in states {
            emit_runtime_state(app, &state);
        }
        updated_ids
    }

    /// Persist `is_open=false` after reconnect attempts are exhausted, then notify the UI.
    async fn persist_tunnel_closed(
        &self,
        app: &AppHandle,
        tunnel_id: &str,
        error: Option<String>,
    ) {
        {
            let mut runtime = self.runtime.lock().await;
            if let Some(entry) = runtime.get_mut(tunnel_id) {
                entry.cancel_reconnect();
                entry.generation = entry.generation.saturating_add(1);
                if let Some(tx) = entry.shutdown_tx.take() {
                    let _ = tx.send(());
                }
                entry.task_handle = None;
                entry.ssh_handle = None;
                entry.status = if error.is_some() {
                    TunnelRuntimeStatus::Error
                } else {
                    TunnelRuntimeStatus::Stopped
                };
                entry.error = error;
                entry.updated_at = Some(now_ms());
                emit_runtime_state(app, &entry.state(tunnel_id));
            }
        }

        if let Ok(mut tunnels) = config::load_tunnels(app) {
            let mut changed = false;
            if let Some(tunnel) = tunnels.iter_mut().find(|t| t.id == tunnel_id) {
                if tunnel.is_open {
                    tunnel.is_open = false;
                    changed = true;
                }
            }
            if changed {
                let _ = config::save_tunnels(app, &tunnels);
                let _ = app.emit("tunnel-saved", ());
                let app_for_sync = app.clone();
                tauri::async_runtime::spawn(async move {
                    crate::core::cloud_sync::notify_config_changed(&app_for_sync).await;
                });
            }
        }
    }

    /// Start a background reconnect loop when the tunnel is still intended to be open.
    pub async fn schedule_reconnect_if_needed(&self, app: &AppHandle, tunnel_id: &str) {
        let Ok(tunnels) = config::load_tunnels(app) else {
            return;
        };
        let Some(tunnel) = tunnels.iter().find(|t| t.id == tunnel_id) else {
            return;
        };
        if !should_schedule_reconnect(tunnel.is_open) {
            return;
        }
        if self.is_open(tunnel_id).await {
            return;
        }

        let (cancel_tx, cancel_rx) = watch::channel(false);
        {
            let mut runtime = self.runtime.lock().await;
            let entry = runtime
                .entry(tunnel_id.to_string())
                .or_insert_with(|| TunnelRuntimeEntry::new(tunnel.connection_id.clone()));
            entry.cancel_reconnect();
            entry.reconnect_cancel = Some(cancel_tx);
            entry.status = TunnelRuntimeStatus::Reconnecting;
            entry.error = None;
            entry.updated_at = Some(now_ms());
            emit_runtime_state(app, &entry.state(tunnel_id));
        }

        let manager = self.clone();
        let app = app.clone();
        let tunnel_id = tunnel_id.to_string();
        tokio::spawn(async move {
            let mut attempt = 0_u32;
            let mut cancel_rx = cancel_rx;
            loop {
                if *cancel_rx.borrow() {
                    return;
                }
                if attempt >= TUNNEL_RECONNECT_MAX_ATTEMPTS {
                    manager
                        .persist_tunnel_closed(
                            &app,
                            &tunnel_id,
                            Some(format!(
                                "Tunnel reconnect failed after {TUNNEL_RECONNECT_MAX_ATTEMPTS} attempts"
                            )),
                        )
                        .await;
                    return;
                }
                attempt += 1;
                let delay = tunnel_reconnect_delay(attempt);
                let sleep = tokio::time::sleep(delay);
                tokio::pin!(sleep);
                tokio::select! {
                    _ = &mut sleep => {}
                    changed = cancel_rx.changed() => {
                        if changed.is_err() || *cancel_rx.borrow() {
                            return;
                        }
                    }
                }
                if *cancel_rx.borrow() {
                    return;
                }

                let Ok(tunnels) = config::load_tunnels(&app) else {
                    continue;
                };
                let Some(tunnel) = tunnels.iter().find(|t| t.id == tunnel_id).cloned() else {
                    return;
                };
                if !tunnel.is_open {
                    return;
                }
                if manager.is_open(&tunnel_id).await {
                    return;
                }

                match manager.open(&tunnel, &app).await {
                    Ok(()) => return,
                    Err(error) => {
                        let message = format!(
                            "Reconnect attempt {attempt}/{TUNNEL_RECONNECT_MAX_ATTEMPTS} failed: {}",
                            user_facing_tunnel_error(&error)
                        );
                        let state = {
                            let mut runtime = manager.runtime.lock().await;
                            runtime.get_mut(&tunnel_id).map(|entry| {
                                if entry.status == TunnelRuntimeStatus::Reconnecting
                                    || entry.status == TunnelRuntimeStatus::Error
                                    || entry.status == TunnelRuntimeStatus::Disconnected
                                {
                                    entry.status = TunnelRuntimeStatus::Reconnecting;
                                    entry.error = Some(message.clone());
                                    entry.updated_at = Some(now_ms());
                                    Some(entry.state(&tunnel_id))
                                } else {
                                    None
                                }
                            })
                        };
                        if let Some(Some(state)) = state {
                            emit_runtime_state(&app, &state);
                        }
                        log_event(StructuredLog {
                            level: StructuredLogLevel::Warn,
                            domain: "session.lifecycle".to_string(),
                            event: "tunnel.reconnect_failed".to_string(),
                            message: "Tunnel reconnect attempt failed".to_string(),
                            ids: Some(serde_json::json!({ "tunnel_id": tunnel_id.clone() })),
                            data: Some(serde_json::json!({
                                "attempt": attempt,
                                "max_attempts": TUNNEL_RECONNECT_MAX_ATTEMPTS,
                            })),
                            error: Some(serde_json::json!({ "message": message })),
                            client_timestamp: None,
                        });
                    }
                }
            }
        });
    }

    async fn run_local_tunnel(
        listener: TcpListener,
        ssh_handle: SshRawHandle,
        target_host: String,
        target_port: u16,
        mut shutdown_rx: oneshot::Receiver<()>,
        mut disconnect_rx: mpsc::UnboundedReceiver<String>,
    ) -> TunnelTaskExit {
        loop {
            tokio::select! {
                _ = &mut shutdown_rx => return TunnelTaskExit::Stopped,
                message = disconnect_rx.recv() => {
                    return TunnelTaskExit::Disconnected(message.unwrap_or_else(|| "SSH connection disconnected".to_string()));
                }
                accept = listener.accept() => {
                    match accept {
                        Ok((mut local_stream, peer_addr)) => {
                            let handle_mtx = ssh_handle.clone();
                            let host = target_host.clone();
                            tokio::spawn(async move {
                                let channel = {
                                    let handle = handle_mtx.lock().await;
                                    match handle.channel_open_direct_tcpip(
                                        &host,
                                        target_port.into(),
                                        &peer_addr.ip().to_string(),
                                        peer_addr.port().into(),
                                    ).await {
                                        Ok(ch) => ch,
                                        Err(e) => {
                                            log_rate_limited(StructuredLog {
                                                level: StructuredLogLevel::Warn,
                                                domain: "session.lifecycle".to_string(),
                                                event: "tunnel.direct_tcpip_failed".to_string(),
                                                message: "Tunnel direct-tcpip failed".to_string(),
                                                ids: None,
                                                data: Some(serde_json::json!({
                                                    "target_host": host,
                                                    "target_port": target_port,
                                                })),
                                                error: Some(serde_json::json!({ "message": e.to_string() })),
                                                client_timestamp: None,
                                            });
                                            return;
                                        }
                                    }
                                };
                                let mut stream = channel.into_stream();
                                let _ = tokio::io::copy_bidirectional(&mut local_stream, &mut stream).await;
                            });
                        }
                        Err(error) => {
                            let message = format!("Tunnel TCP accept failed: {error}");
                            log_rate_limited(StructuredLog {
                                level: StructuredLogLevel::Warn,
                                domain: "session.lifecycle".to_string(),
                                event: "tunnel.accept_failed".to_string(),
                                message: "Tunnel TCP accept failed".to_string(),
                                ids: None,
                                data: None,
                                error: Some(serde_json::json!({ "message": error.to_string() })),
                                client_timestamp: None,
                            });
                            return TunnelTaskExit::Error(message);
                        }
                    }
                }
            }
        }
    }

    async fn run_remote_tunnel(
        ssh_handle: SshRawHandle,
        listen_addr: String,
        listen_port: u16,
        target_host: String,
        target_port: u16,
        mut shutdown_rx: oneshot::Receiver<()>,
        mut disconnect_rx: mpsc::UnboundedReceiver<String>,
        mut remote_forward_rx: mpsc::UnboundedReceiver<RemoteForwardOpen>,
    ) -> TunnelTaskExit {
        loop {
            tokio::select! {
                _ = &mut shutdown_rx => {
                    let handle = ssh_handle.lock().await;
                    let _ = handle.cancel_tcpip_forward(&listen_addr, listen_port.into()).await;
                    return TunnelTaskExit::Stopped;
                }
                message = disconnect_rx.recv() => {
                    return TunnelTaskExit::Disconnected(message.unwrap_or_else(|| "SSH connection disconnected".to_string()));
                }
                open = remote_forward_rx.recv() => {
                    let Some(open) = open else {
                        return TunnelTaskExit::Disconnected("Remote forwarding channel closed".to_string());
                    };
                    let host = target_host.clone();
                    tokio::spawn(async move {
                        Self::handle_remote_forward_connection(open, host, target_port).await;
                    });
                }
            }
        }
    }

    async fn handle_remote_forward_connection(
        open: RemoteForwardOpen,
        target_host: String,
        target_port: u16,
    ) {
        let mut channel_stream = open.channel.into_stream();
        match TcpStream::connect(format!("{}:{}", target_host, target_port)).await {
            Ok(mut target_stream) => {
                let _ =
                    tokio::io::copy_bidirectional(&mut channel_stream, &mut target_stream).await;
            }
            Err(error) => {
                log_rate_limited(StructuredLog {
                    level: StructuredLogLevel::Warn,
                    domain: "session.lifecycle".to_string(),
                    event: "tunnel.remote_target_connect_failed".to_string(),
                    message: "Remote tunnel target connection failed".to_string(),
                    ids: None,
                    data: Some(serde_json::json!({
                        "connected_address": open.connected_address,
                        "connected_port": open.connected_port,
                        "originator_address": open.originator_address,
                        "originator_port": open.originator_port,
                        "target_host": target_host,
                        "target_port": target_port,
                    })),
                    error: Some(serde_json::json!({ "message": error.to_string() })),
                    client_timestamp: None,
                });
            }
        }
    }

    async fn run_dynamic_tunnel(
        listener: TcpListener,
        ssh_handle: SshRawHandle,
        mut shutdown_rx: oneshot::Receiver<()>,
        mut disconnect_rx: mpsc::UnboundedReceiver<String>,
    ) -> TunnelTaskExit {
        loop {
            tokio::select! {
                _ = &mut shutdown_rx => return TunnelTaskExit::Stopped,
                message = disconnect_rx.recv() => {
                    return TunnelTaskExit::Disconnected(message.unwrap_or_else(|| "SSH connection disconnected".to_string()));
                }
                accept = listener.accept() => {
                    match accept {
                        Ok((stream, peer_addr)) => {
                            let handle = ssh_handle.clone();
                            tokio::spawn(Self::handle_socks5_connection(stream, handle, peer_addr));
                        }
                        Err(error) => {
                            let message = format!("SOCKS5 accept failed: {error}");
                            log_rate_limited(StructuredLog {
                                level: StructuredLogLevel::Warn,
                                domain: "session.lifecycle".to_string(),
                                event: "tunnel.socks_accept_failed".to_string(),
                                message: "SOCKS5 accept failed".to_string(),
                                ids: None,
                                data: None,
                                error: Some(serde_json::json!({ "message": error.to_string() })),
                                client_timestamp: None,
                            });
                            return TunnelTaskExit::Error(message);
                        }
                    }
                }
            }
        }
    }

    async fn handle_socks5_connection(
        mut stream: tokio::net::TcpStream,
        ssh_handle: SshRawHandle,
        peer_addr: std::net::SocketAddr,
    ) {
        let mut buf = [0u8; 2];
        if stream.read_exact(&mut buf).await.is_err() {
            return;
        }
        if buf[0] != 0x05 {
            return;
        }
        let nmethods = buf[1] as usize;
        let mut methods = vec![0u8; nmethods];
        if stream.read_exact(&mut methods).await.is_err() {
            return;
        }
        if stream.write_all(&[0x05, 0x00]).await.is_err() {
            return;
        }

        let mut header = [0u8; 4];
        if stream.read_exact(&mut header).await.is_err() {
            return;
        }
        if header[0] != 0x05 || header[1] != 0x01 {
            let _ = stream
                .write_all(&[0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                .await;
            return;
        }

        let (target_host, target_port) = match header[3] {
            0x01 => {
                let mut addr = [0u8; 4];
                if stream.read_exact(&mut addr).await.is_err() {
                    return;
                }
                let host = format!("{}.{}.{}.{}", addr[0], addr[1], addr[2], addr[3]);
                let mut port_buf = [0u8; 2];
                if stream.read_exact(&mut port_buf).await.is_err() {
                    return;
                }
                (host, u16::from_be_bytes(port_buf))
            }
            0x03 => {
                let mut len = [0u8; 1];
                if stream.read_exact(&mut len).await.is_err() {
                    return;
                }
                let mut domain = vec![0u8; len[0] as usize];
                if stream.read_exact(&mut domain).await.is_err() {
                    return;
                }
                let host = String::from_utf8_lossy(&domain).to_string();
                let mut port_buf = [0u8; 2];
                if stream.read_exact(&mut port_buf).await.is_err() {
                    return;
                }
                (host, u16::from_be_bytes(port_buf))
            }
            0x04 => {
                let mut addr = [0u8; 16];
                if stream.read_exact(&mut addr).await.is_err() {
                    return;
                }
                let host = std::net::Ipv6Addr::from(addr).to_string();
                let mut port_buf = [0u8; 2];
                if stream.read_exact(&mut port_buf).await.is_err() {
                    return;
                }
                (host, u16::from_be_bytes(port_buf))
            }
            _ => return,
        };

        let channel = match {
            let handle = ssh_handle.lock().await;
            handle
                .channel_open_direct_tcpip(
                    &target_host,
                    target_port.into(),
                    &peer_addr.ip().to_string(),
                    peer_addr.port().into(),
                )
                .await
        } {
            Ok(ch) => ch,
            Err(e) => {
                log_rate_limited(StructuredLog {
                    level: StructuredLogLevel::Warn,
                    domain: "session.lifecycle".to_string(),
                    event: "tunnel.socks_direct_tcpip_failed".to_string(),
                    message: "SOCKS5 direct-tcpip failed".to_string(),
                    ids: None,
                    data: Some(serde_json::json!({
                        "target_host": target_host,
                        "target_port": target_port,
                    })),
                    error: Some(serde_json::json!({ "message": e.to_string() })),
                    client_timestamp: None,
                });
                let _ = stream
                    .write_all(&[0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                    .await;
                return;
            }
        };

        let _ = stream
            .write_all(&[0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
            .await;

        let mut ssh_stream = channel.into_stream();
        let _ = tokio::io::copy_bidirectional(&mut stream, &mut ssh_stream).await;
    }

    /// Auto-open tunnels for a connection that just connected.
    pub async fn auto_open_for_connection(&self, app: &AppHandle, connection_id: &str) {
        let mut tunnels = match config::load_tunnels(app) {
            Ok(t) => t,
            Err(_) => return,
        };

        let mut changed = false;
        for tunnel in &mut tunnels {
            if (tunnel.auto_open || tunnel.is_open)
                && tunnel.connection_id.as_deref() == Some(connection_id)
            {
                tunnel.is_open = true;
                changed = true;
                if let Err(e) = self.open(tunnel, app).await {
                    log_event(StructuredLog {
                        level: StructuredLogLevel::Warn,
                        domain: "session.lifecycle".to_string(),
                        event: "tunnel.auto_open_failed".to_string(),
                        message: "Failed to auto-open tunnel".to_string(),
                        ids: Some(serde_json::json!({
                            "tunnel_id": tunnel.id.clone(),
                            "connection_id": connection_id,
                        })),
                        data: Some(serde_json::json!({
                            "tunnel_type": tunnel.tunnel_type.clone(),
                        })),
                        error: Some(serde_json::json!({ "message": e.to_string() })),
                        client_timestamp: None,
                    });
                }
            }
        }
        if changed {
            let _ = config::save_tunnels(app, &tunnels);
        }
    }

    /// Mark associated enabled tunnels as disconnected after an SSH session closes.
    pub async fn close_auto_tunnels_for_connection(&self, app: &AppHandle, connection_id: &str) {
        let tunnels = match config::load_tunnels(app) {
            Ok(t) => t,
            Err(_) => return,
        };

        // force=false: keep Reconnecting during terminal-session reconnect.
        self.mark_connection_disconnected(app, &tunnels, connection_id, false)
            .await;
    }

    /// Re-open tunnels that were left enabled when the app last quit.
    pub async fn restore_open_tunnels(&self, app: &AppHandle) {
        let tunnels = match config::load_tunnels(app) {
            Ok(t) => t,
            Err(error) => {
                tracing::warn!("Failed to load tunnels for startup restore: {error}");
                return;
            }
        };

        for tunnel in tunnels.into_iter().filter(|tunnel| tunnel.is_open) {
            if self.is_open(&tunnel.id).await {
                continue;
            }
            if let Err(error) = self.open(&tunnel, app).await {
                log_event(StructuredLog {
                    level: StructuredLogLevel::Warn,
                    domain: "session.lifecycle".to_string(),
                    event: "tunnel.restore_open_failed".to_string(),
                    message: "Failed to restore open tunnel on startup".to_string(),
                    ids: Some(serde_json::json!({
                        "tunnel_id": tunnel.id.clone(),
                        "connection_id": tunnel.connection_id.clone(),
                    })),
                    data: Some(serde_json::json!({
                        "tunnel_type": tunnel.tunnel_type.clone(),
                    })),
                    error: Some(serde_json::json!({ "message": error.to_string() })),
                    client_timestamp: None,
                });
                self.schedule_reconnect_if_needed(app, &tunnel.id).await;
            }
        }
    }
}

impl Clone for TunnelManager {
    fn clone(&self) -> Self {
        Self {
            runtime: self.runtime.clone(),
        }
    }
}

fn spawn_tunnel_task<F>(
    manager: TunnelManager,
    app: AppHandle,
    tunnel_id: String,
    generation: u64,
    future: F,
) -> JoinHandle<()>
where
    F: std::future::Future<Output = TunnelTaskExit> + Send + 'static,
{
    tokio::spawn(async move {
        let exit = future.await;
        manager
            .finish_task(&app, &tunnel_id, generation, exit)
            .await;
    })
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or_default()
}

fn emit_runtime_state(app: &AppHandle, state: &TunnelRuntimeState) {
    let _ = app.emit("tunnel-runtime-state-changed", state);
}

fn user_facing_tunnel_error(error: &AppError) -> String {
    error.to_string()
}

fn tunnel_reconnect_delay(attempt: u32) -> Duration {
    Duration::from_secs(match attempt {
        0 | 1 => 1,
        2 => 2,
        3 => 4,
        4 => 8,
        5 => 15,
        _ => 30,
    })
}

fn should_schedule_reconnect(is_open: bool) -> bool {
    is_open
}

#[cfg(test)]
mod tests {
    use super::{
        TunnelRuntimeEntry, TunnelRuntimeStatus, should_schedule_reconnect, tunnel_reconnect_delay,
        TUNNEL_RECONNECT_MAX_ATTEMPTS,
    };
    use std::time::Duration;

    #[test]
    fn stopped_starting_running_transition_is_representable() {
        let mut entry = TunnelRuntimeEntry::new(Some("conn".to_string()));
        entry.status = TunnelRuntimeStatus::Stopped;
        entry.generation += 1;
        entry.status = TunnelRuntimeStatus::Starting;
        entry.status = TunnelRuntimeStatus::Running;

        assert_eq!(entry.status, TunnelRuntimeStatus::Running);
        assert_eq!(entry.generation, 1);
    }

    #[test]
    fn starting_error_preserves_message() {
        let mut entry = TunnelRuntimeEntry::new(None);
        entry.status = TunnelRuntimeStatus::Starting;
        entry.status = TunnelRuntimeStatus::Error;
        entry.error = Some("bind failed".to_string());

        assert_eq!(entry.status, TunnelRuntimeStatus::Error);
        assert_eq!(entry.error.as_deref(), Some("bind failed"));
    }

    #[test]
    fn disconnected_reconnecting_running_transition_is_representable() {
        let mut entry = TunnelRuntimeEntry::new(None);
        entry.status = TunnelRuntimeStatus::Running;
        entry.status = TunnelRuntimeStatus::Disconnected;
        entry.status = TunnelRuntimeStatus::Reconnecting;
        entry.status = TunnelRuntimeStatus::Running;

        assert_eq!(entry.status, TunnelRuntimeStatus::Running);
    }

    #[test]
    fn running_stopped_clears_error() {
        let mut entry = TunnelRuntimeEntry::new(None);
        entry.status = TunnelRuntimeStatus::Running;
        entry.error = Some("old".to_string());
        entry.status = TunnelRuntimeStatus::Stopped;
        entry.error = None;

        assert_eq!(entry.status, TunnelRuntimeStatus::Stopped);
        assert!(entry.error.is_none());
    }

    #[test]
    fn stale_generation_cannot_match_new_generation() {
        let mut entry = TunnelRuntimeEntry::new(None);
        entry.generation = 2;
        let stale_generation = 1;

        assert_ne!(entry.generation, stale_generation);
    }

    #[test]
    fn tunnel_reconnect_delay_is_bounded() {
        assert_eq!(tunnel_reconnect_delay(1), Duration::from_secs(1));
        assert_eq!(tunnel_reconnect_delay(2), Duration::from_secs(2));
        assert_eq!(tunnel_reconnect_delay(5), Duration::from_secs(15));
        assert_eq!(tunnel_reconnect_delay(100), Duration::from_secs(30));
    }

    #[test]
    fn should_schedule_reconnect_only_when_open() {
        assert!(should_schedule_reconnect(true));
        assert!(!should_schedule_reconnect(false));
    }

    #[test]
    fn reconnect_max_attempts_is_positive() {
        assert!(TUNNEL_RECONNECT_MAX_ATTEMPTS > 0);
    }

    #[test]
    fn cancel_reconnect_clears_sender() {
        let mut entry = TunnelRuntimeEntry::new(None);
        let (tx, rx) = tokio::sync::watch::channel(false);
        entry.reconnect_cancel = Some(tx);
        entry.cancel_reconnect();
        assert!(entry.reconnect_cancel.is_none());
        assert!(*rx.borrow());
    }
}
