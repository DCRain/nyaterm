use crate::config;
use crate::core::monitoring::stats::RemoteStatsSampler;
use crate::core::ssh::{
    self, HostKeyVerifyManager, PendingAuthManager, PendingSshAuthManager, SshAuthResponse,
};
use crate::core::zmodem::ZmodemUploadConflictMode;
use crate::core::{
    self, QuickCommandsStore, RecordingManager, SessionCommand, SessionInfo, SessionManager,
    TerminalHistorySearchRequest, TerminalHistorySearchResponse,
};
use crate::error::{AppError, AppResult};
use crate::observability::{self, StructuredLog, StructuredLogLevel};
use crate::utils::fuzzy::{
    FuzzyCandidateResult, FuzzyResult, FuzzySearchCandidate,
    fuzzy_search_candidates as fuzzy_search_candidate_items, fuzzy_search_items,
};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{Emitter, Manager};

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupCommandPayload {
    command: String,
    delay_ms: u64,
}

#[tauri::command]
pub async fn create_ssh_session(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Arc<SessionManager>>,
    recording_state: tauri::State<'_, Arc<RecordingManager>>,
    connection_id: String,
    create_request_id: Option<String>,
    startup_command: Option<StartupCommandPayload>,
) -> AppResult<String> {
    let ssh_config = ssh::load_saved_ssh_config(&app, &connection_id)?;
    let pending_creation = state.begin_session_creation(create_request_id).await;
    let (guard, cancel_rx) = match pending_creation {
        Some((guard, cancel_rx)) => (Some(guard), Some(cancel_rx)),
        None => (None, None),
    };

    let session_id = ssh::create_ssh_session(
        app.clone(),
        state.inner().clone(),
        ssh_config,
        Some(connection_id.clone()),
        Some(window.label().to_string()),
        cancel_rx,
        startup_command.map(|command| ssh::SshStartupCommand {
            command: command.command,
            delay_ms: command.delay_ms,
        }),
    )
    .await?;
    drop(guard);
    if let Err(error) = crate::storage::mark_connection_used(&connection_id) {
        tracing::warn!(connection_id, %error, "Failed to mark connection as recently used");
    }
    maybe_start_auto_recording(
        &app,
        state.inner().as_ref(),
        recording_state.inner().clone(),
        &session_id,
    )
    .await;
    Ok(session_id)
}

#[tauri::command]
pub async fn create_temporary_ssh_session(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Arc<SessionManager>>,
    recording_state: tauri::State<'_, Arc<RecordingManager>>,
    config: ssh::SshConfig,
    create_request_id: Option<String>,
) -> AppResult<String> {
    let encoding = crate::config::load_app_settings(&app)
        .map(|settings| settings.interaction.default_encoding)
        .unwrap_or_else(|_| "UTF-8".to_string());
    let ssh_config = normalize_temporary_ssh_config(config, &encoding);
    let pending_creation = state.begin_session_creation(create_request_id).await;
    let (guard, cancel_rx) = match pending_creation {
        Some((guard, cancel_rx)) => (Some(guard), Some(cancel_rx)),
        None => (None, None),
    };

    let session_id = ssh::create_ssh_session(
        app.clone(),
        state.inner().clone(),
        ssh_config,
        None,
        Some(window.label().to_string()),
        cancel_rx,
        None,
    )
    .await?;
    drop(guard);
    maybe_start_auto_recording(
        &app,
        state.inner().as_ref(),
        recording_state.inner().clone(),
        &session_id,
    )
    .await;
    Ok(session_id)
}

fn normalize_temporary_ssh_config(mut config: ssh::SshConfig, encoding: &str) -> ssh::SshConfig {
    config.connection_id = None;
    config.owner_window_label = None;
    config.backspace_mode = if config.backspace_mode.trim().is_empty() {
        "del".to_string()
    } else {
        config.backspace_mode
    };
    config.x11_forwarding = false;
    config.x11_display = String::new();
    config.proxy = None;
    config.proxy_jump = None;
    config.post_login = None;
    config.ssh_algorithms = None;
    // Inherit encoding from global settings only when no explicit value was provided.
    if config.encoding.trim().is_empty() {
        config.encoding = encoding.to_string();
    }
    config
}

#[tauri::command]
pub async fn create_multiplexed_ssh_session(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<SessionManager>>,
    recording_state: tauri::State<'_, Arc<RecordingManager>>,
    source_session_id: String,
    startup_command: Option<StartupCommandPayload>,
) -> AppResult<String> {
    let session_id = ssh::create_multiplexed_ssh_session(
        app.clone(),
        state.inner().clone(),
        &source_session_id,
        startup_command.map(|command| ssh::SshStartupCommand {
            command: command.command,
            delay_ms: command.delay_ms,
        }),
    )
    .await?;
    maybe_start_auto_recording(
        &app,
        state.inner().as_ref(),
        recording_state.inner().clone(),
        &session_id,
    )
    .await;
    Ok(session_id)
}

#[tauri::command]
pub async fn create_local_session(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Arc<SessionManager>>,
    recording_state: tauri::State<'_, Arc<RecordingManager>>,
    connection_id: Option<String>,
    create_request_id: Option<String>,
) -> AppResult<String> {
    let pending_creation = state.begin_session_creation(create_request_id).await;
    let (guard, _cancel_rx) = match pending_creation {
        Some((guard, cancel_rx)) => (Some(guard), Some(cancel_rx)),
        None => (None, None),
    };
    let config = if let Some(ref cid) = connection_id {
        let conn = config::load_connection_by_id(&app, cid)?;
        let encoding = config::resolve_connection_encoding(&app, &conn);
        match conn.config {
            config::ConnectionType::LocalTerminal {
                shell_path,
                shell_args,
                working_dir,
                ..
            } => Some(core::LocalSessionConfig {
                shell_path,
                shell_args,
                working_dir,
                name: conn.name,
                encoding,
            }),
            _ => None,
        }
    } else {
        None
    };
    let session_id = core::create_local_session(
        app.clone(),
        state.inner().clone(),
        config,
        Some(window.label().to_string()),
    )
    .await?;
    drop(guard);
    if let Some(connection_id) = connection_id {
        if let Err(error) = crate::storage::mark_connection_used(&connection_id) {
            tracing::warn!(connection_id, %error, "Failed to mark connection as recently used");
        }
    }
    maybe_start_auto_recording(
        &app,
        state.inner().as_ref(),
        recording_state.inner().clone(),
        &session_id,
    )
    .await;
    Ok(session_id)
}

#[tauri::command]
pub async fn create_telnet_session(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Arc<SessionManager>>,
    recording_state: tauri::State<'_, Arc<RecordingManager>>,
    connection_id: Option<String>,
    host: Option<String>,
    port: Option<u16>,
    name: Option<String>,
    create_request_id: Option<String>,
    startup_command: Option<StartupCommandPayload>,
) -> AppResult<String> {
    let pending_creation = state.begin_session_creation(create_request_id).await;
    let (guard, _cancel_rx) = match pending_creation {
        Some((guard, cancel_rx)) => (Some(guard), Some(cancel_rx)),
        None => (None, None),
    };
    let cfg = if let Some(ref cid) = connection_id {
        let conn = config::load_connection_by_id(&app, cid)?;
        let telnet_password = resolve_telnet_connection_password(&app, conn.auth.as_ref())?;
        let encoding = config::resolve_connection_encoding(&app, &conn);
        match conn.config {
            config::ConnectionType::Telnet {
                host: ref ch,
                port: cp,
                username,
                backspace_mode,
                raw_tcp_cli,
                enter_mode,
                local_echo,
                local_line_edit,
                force_character_at_a_time,
                send_naws,
                send_sga,
                auto_login,
                ..
            } => core::TelnetSessionConfig {
                host: ch.clone(),
                port: cp,
                name: conn.name.clone(),
                username,
                password: telnet_password,
                backspace_mode,
                raw_tcp_cli,
                enter_mode: core::TelnetEnterMode::from_config_value(&enter_mode),
                local_echo,
                local_line_edit,
                force_character_at_a_time,
                send_naws,
                send_sga,
                auto_login: core::TelnetAutoLoginConfig::from(auto_login),
                encoding,
            },
            _ => {
                return Err(AppError::Config(
                    "Connection is not a Telnet connection".to_string(),
                ));
            }
        }
    } else {
        core::TelnetSessionConfig {
            host: host.ok_or_else(|| AppError::Config("host is required".to_string()))?,
            port: port.unwrap_or(23),
            name: name.unwrap_or_else(|| "Telnet".to_string()),
            ..Default::default()
        }
    };
    let marked_connection_id = connection_id.clone();
    let session_id = core::create_telnet_session(
        app.clone(),
        state.inner().clone(),
        cfg,
        connection_id,
        Some(window.label().to_string()),
        startup_command.map(|command| core::TelnetStartupCommand {
            command: command.command,
            delay_ms: command.delay_ms,
        }),
    )
    .await?;
    drop(guard);
    if let Some(connection_id) = marked_connection_id {
        if let Err(error) = crate::storage::mark_connection_used(&connection_id) {
            tracing::warn!(connection_id, %error, "Failed to mark connection as recently used");
        }
    }
    maybe_start_auto_recording(
        &app,
        state.inner().as_ref(),
        recording_state.inner().clone(),
        &session_id,
    )
    .await;
    Ok(session_id)
}

fn resolve_telnet_connection_password(
    app: &tauri::AppHandle,
    auth: Option<&config::ConnectionAuth>,
) -> AppResult<Option<String>> {
    resolve_telnet_connection_password_with(auth, |password_id| {
        Ok(config::load_password_by_id(app, password_id)?.password)
    })
}

fn resolve_telnet_connection_password_with<F>(
    auth: Option<&config::ConnectionAuth>,
    mut load_saved_password: F,
) -> AppResult<Option<String>>
where
    F: FnMut(&str) -> AppResult<Option<String>>,
{
    let Some(auth) = auth else {
        return Ok(None);
    };
    if auth.mode != "password" {
        return Ok(None);
    }

    if let Some(password_id) = auth.password_id.as_deref().filter(|id| !id.is_empty()) {
        return load_saved_password(password_id);
    }

    crate::utils::crypto::decrypt_optional(&auth.password)
}

#[tauri::command]
pub async fn create_serial_session(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Arc<SessionManager>>,
    recording_state: tauri::State<'_, Arc<RecordingManager>>,
    connection_id: Option<String>,
    port_name: Option<String>,
    baud_rate: Option<u32>,
    data_bits: Option<u8>,
    parity: Option<String>,
    stop_bits: Option<String>,
    name: Option<String>,
    create_request_id: Option<String>,
) -> AppResult<String> {
    let pending_creation = state.begin_session_creation(create_request_id).await;
    let (guard, _cancel_rx) = match pending_creation {
        Some((guard, cancel_rx)) => (Some(guard), Some(cancel_rx)),
        None => (None, None),
    };
    let cfg = if let Some(ref cid) = connection_id {
        let conn = config::load_connection_by_id(&app, cid)?;
        let encoding = config::resolve_connection_encoding(&app, &conn);
        match conn.config {
            config::ConnectionType::Serial {
                port_name,
                baud_rate,
                data_bits,
                parity,
                stop_bits,
                backspace_mode,
                ..
            } => core::SerialConfig {
                port_name,
                baud_rate,
                data_bits,
                parity,
                stop_bits,
                name: conn.name,
                backspace_mode,
                encoding,
            },
            _ => {
                return Err(AppError::Config(
                    "Connection is not a Serial connection".to_string(),
                ));
            }
        }
    } else {
        let encoding = crate::config::load_app_settings(&app)
            .map(|s| s.interaction.default_encoding)
            .unwrap_or_else(|_| "UTF-8".to_string());
        core::SerialConfig {
            port_name: port_name
                .ok_or_else(|| AppError::Config("port_name is required".to_string()))?,
            baud_rate: baud_rate.unwrap_or(115_200),
            data_bits: data_bits.unwrap_or(8),
            parity: parity.unwrap_or_else(|| "none".to_string()),
            stop_bits: stop_bits.unwrap_or_else(|| "1".to_string()),
            name: name.unwrap_or_else(|| "Serial".to_string()),
            backspace_mode: "ctrl_h".to_string(),
            encoding,
        }
    };
    let marked_connection_id = connection_id.clone();
    let session_id = core::create_serial_session(
        app.clone(),
        state.inner().clone(),
        cfg,
        connection_id,
        Some(window.label().to_string()),
    )
    .await?;
    drop(guard);
    if let Some(connection_id) = marked_connection_id {
        if let Err(error) = crate::storage::mark_connection_used(&connection_id) {
            tracing::warn!(connection_id, %error, "Failed to mark connection as recently used");
        }
    }
    maybe_start_auto_recording(
        &app,
        state.inner().as_ref(),
        recording_state.inner().clone(),
        &session_id,
    )
    .await;
    Ok(session_id)
}

async fn maybe_start_auto_recording(
    app: &tauri::AppHandle,
    session_manager: &SessionManager,
    recording_manager: Arc<RecordingManager>,
    session_id: &str,
) {
    let settings = match config::load_app_settings(app) {
        Ok(settings) => settings,
        Err(error) => {
            tracing::warn!(session_id, %error, "Failed to load settings for auto recording");
            return;
        }
    };
    let transfer = settings.transfer;
    if !transfer.recording_auto_start {
        return;
    }

    let session_info = match session_manager.session_info(session_id).await {
        Ok(info) => info,
        Err(error) => {
            tracing::warn!(session_id, %error, "Failed to load session info for auto recording");
            return;
        }
    };

    let file_path =
        match build_auto_recording_file_path(app, &transfer.recording_path, &session_info.name) {
            Ok(path) => path,
            Err(error) => {
                tracing::warn!(session_id, %error, "Failed to build auto recording path");
                return;
            }
        };
    let file_path = file_path.to_string_lossy().to_string();
    let include_io_labels = transfer.recording_include_io_labels;
    let include_timestamps = transfer.recording_include_timestamps;
    let task_session_id = session_id.to_string();
    let log_session_id = task_session_id.clone();

    let result = tokio::task::spawn_blocking(move || {
        recording_manager.start(
            &task_session_id,
            &file_path,
            include_io_labels,
            include_timestamps,
        )
    })
    .await;

    match result {
        Ok(Ok(())) => {
            let _ = app.emit("sessions-changed", ());
        }
        Ok(Err(error)) => {
            tracing::warn!(session_id = %log_session_id, %error, "Failed to auto-start recording");
        }
        Err(error) => {
            tracing::warn!(session_id = %log_session_id, %error, "Auto recording task failed");
        }
    }
}

fn build_auto_recording_file_path(
    app: &tauri::AppHandle,
    configured_dir: &str,
    session_name: &str,
) -> AppResult<PathBuf> {
    let dir = if configured_dir.trim().is_empty() {
        default_recording_dir(app)?
    } else {
        PathBuf::from(configured_dir)
    };
    let timestamp = time::OffsetDateTime::now_local()
        .unwrap_or_else(|_| time::OffsetDateTime::now_utc())
        .format(time::macros::format_description!(
            "[year]-[month]-[day]T[hour]-[minute]-[second]"
        ))
        .unwrap_or_else(|_| "1970-01-01T00-00-00".to_string());

    Ok(dir.join(format!(
        "recording-{}-{timestamp}.log",
        safe_recording_name(session_name)
    )))
}

fn default_recording_dir(app: &tauri::AppHandle) -> AppResult<PathBuf> {
    match app.path().download_dir() {
        Ok(path) => Ok(path),
        Err(_) => dirs::download_dir()
            .or_else(|| dirs::home_dir().map(|home| home.join("Downloads")))
            .ok_or_else(|| AppError::Config("Failed to resolve Downloads directory".to_string())),
    }
}

fn safe_recording_name(name: &str) -> String {
    let mut safe = String::new();
    let mut last_was_replacement = false;

    for ch in name.chars() {
        if ch.is_alphanumeric() || matches!(ch, '.' | '_' | '-') {
            safe.push(ch);
            last_was_replacement = false;
        } else if !last_was_replacement {
            safe.push('_');
            last_was_replacement = true;
        }
    }

    if safe.is_empty() {
        "session".to_string()
    } else {
        safe
    }
}

#[cfg(test)]
mod tests {
    use super::{
        normalize_temporary_ssh_config, resolve_telnet_connection_password_with,
        safe_recording_name,
    };
    use crate::config::ConnectionAuth;

    #[test]
    fn safe_recording_name_preserves_readable_parts() {
        assert_eq!(safe_recording_name(""), "session");
        assert_eq!(safe_recording_name("my session!/prod"), "my_session_prod");
        assert_eq!(safe_recording_name("中台 算法库"), "中台_算法库");
        assert_eq!(safe_recording_name("ssh.host_01-prod"), "ssh.host_01-prod");
    }

    #[test]
    fn temporary_ssh_config_drops_saved_connection_features() {
        let config = serde_json::from_value(serde_json::json!({
            "connection_id": "saved-1",
            "owner_window_label": "main",
            "name": "root@example.com:22",
            "host": "example.com",
            "port": 22,
            "username": "root",
            "auth": { "type": "none" },
            "backspace_mode": "",
            "x11_forwarding": true,
            "x11_display": ":0",
            "proxy": {
                "enabled": true,
                "protocol": "socks5",
                "host": "127.0.0.1",
                "port": 1080
            },
            "proxy_jump": {
                "name": "jump",
                "host": "jump.example.com",
                "port": 22,
                "username": "root",
                "auth": { "type": "none" }
            },
            "post_login": {
                "command": "uptime",
                "delay_ms": 1000
            }
        }))
        .expect("temporary ssh config");

        let normalized = normalize_temporary_ssh_config(config, "UTF-8");

        assert!(normalized.connection_id.is_none());
        assert!(normalized.owner_window_label.is_none());
        assert_eq!(normalized.backspace_mode, "del");
        assert!(!normalized.x11_forwarding);
        assert!(normalized.x11_display.is_empty());
        assert!(normalized.proxy.is_none());
        assert!(normalized.proxy_jump.is_none());
        assert!(normalized.post_login.is_none());
    }

    #[test]
    fn telnet_password_resolution_ignores_non_password_auth() {
        let auth = ConnectionAuth {
            mode: "none".to_string(),
            password: Some("ignored".to_string()),
            ..ConnectionAuth::default()
        };

        let resolved =
            resolve_telnet_connection_password_with(Some(&auth), |_| Ok(Some("saved".to_string())))
                .expect("password resolution");

        assert_eq!(resolved, None);
    }

    #[test]
    fn telnet_password_resolution_decrypts_inline_password() {
        crate::utils::crypto::set_master_password(None);
        let auth = ConnectionAuth {
            mode: "password".to_string(),
            password: Some(crate::utils::crypto::encrypt("inline-secret").expect("encrypt")),
            ..ConnectionAuth::default()
        };

        let resolved = resolve_telnet_connection_password_with(Some(&auth), |_| Ok(None))
            .expect("password resolution");

        assert_eq!(resolved.as_deref(), Some("inline-secret"));
    }

    #[test]
    fn telnet_password_resolution_prefers_saved_password_id() {
        let auth = ConnectionAuth {
            mode: "password".to_string(),
            password_id: Some("saved-1".to_string()),
            password: Some("ignored".to_string()),
            ..ConnectionAuth::default()
        };

        let resolved = resolve_telnet_connection_password_with(Some(&auth), |id| {
            assert_eq!(id, "saved-1");
            Ok(Some("saved-secret".to_string()))
        })
        .expect("password resolution");

        assert_eq!(resolved.as_deref(), Some("saved-secret"));
    }
}

#[tauri::command]
pub async fn cancel_session_creation(
    state: tauri::State<'_, Arc<SessionManager>>,
    create_request_id: String,
) -> AppResult<bool> {
    Ok(state.cancel_session_creation(&create_request_id).await)
}

#[tauri::command]
pub fn list_serial_ports() -> AppResult<Vec<String>> {
    core::list_serial_ports()
}

#[tauri::command]
pub async fn write_to_session(
    state: tauri::State<'_, Arc<SessionManager>>,
    session_id: String,
    data: String,
) -> AppResult<()> {
    state
        .send_command(
            &session_id,
            SessionCommand::Write {
                data: data.into_bytes(),
                automated: false,
            },
        )
        .await
}

#[tauri::command]
pub async fn set_session_output_paused(
    state: tauri::State<'_, Arc<SessionManager>>,
    session_id: String,
    paused: bool,
) -> AppResult<()> {
    let command = if paused {
        SessionCommand::PauseOutput
    } else {
        SessionCommand::ResumeOutput
    };
    state.send_command(&session_id, command).await
}

#[tauri::command]
pub async fn ack_session_output(
    state: tauri::State<'_, Arc<SessionManager>>,
    session_id: String,
    bytes: usize,
) -> AppResult<()> {
    state
        .send_command(&session_id, SessionCommand::AckOutput { bytes })
        .await
}

#[tauri::command]
pub async fn zmodem_accept_download(
    state: tauri::State<'_, Arc<SessionManager>>,
    session_id: String,
    save_dir: String,
) -> AppResult<()> {
    state
        .send_command(
            &session_id,
            SessionCommand::ZmodemAcceptDownload {
                save_dir: std::path::PathBuf::from(save_dir),
            },
        )
        .await
}

#[tauri::command]
pub async fn zmodem_accept_upload(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<SessionManager>>,
    session_id: String,
    file_paths: Vec<String>,
    conflict_mode: Option<String>,
) -> AppResult<()> {
    let transfer_settings = match config::load_app_settings(&app) {
        Ok(settings) => settings.transfer,
        Err(error) => {
            tracing::warn!(
                %error,
                "Failed to load transfer settings for ZMODEM upload; using defaults"
            );
            config::TransferSettings::default()
        }
    };

    state
        .send_command(
            &session_id,
            SessionCommand::ZmodemAcceptUpload {
                files: file_paths
                    .into_iter()
                    .map(std::path::PathBuf::from)
                    .collect(),
                conflict_mode: ZmodemUploadConflictMode::from_wire(conflict_mode.as_deref()),
                preserve_timestamps: transfer_settings.preserve_timestamps,
            },
        )
        .await
}

#[tauri::command]
pub async fn zmodem_cancel(
    state: tauri::State<'_, Arc<SessionManager>>,
    session_id: String,
) -> AppResult<()> {
    state
        .send_command(&session_id, SessionCommand::ZmodemCancel)
        .await
}

#[tauri::command]
pub async fn resize_session(
    state: tauri::State<'_, Arc<SessionManager>>,
    session_id: String,
    cols: u32,
    rows: u32,
) -> AppResult<()> {
    state
        .send_command(&session_id, SessionCommand::Resize { cols, rows })
        .await
}

#[tauri::command]
pub async fn attach_session(
    state: tauri::State<'_, Arc<SessionManager>>,
    session_id: String,
) -> AppResult<()> {
    observability::log_event(StructuredLog {
        level: StructuredLogLevel::Debug,
        domain: "session.lifecycle".to_string(),
        event: "session.attach_requested".to_string(),
        message: "Attaching session renderer".to_string(),
        ids: Some(serde_json::json!({ "session_id": session_id.clone() })),
        data: None,
        error: None,
        client_timestamp: None,
    });

    state
        .send_command(&session_id, SessionCommand::Attach)
        .await
}

#[tauri::command]
pub async fn detach_session_renderer(
    state: tauri::State<'_, Arc<SessionManager>>,
    session_id: String,
) -> AppResult<()> {
    observability::log_event(StructuredLog {
        level: StructuredLogLevel::Debug,
        domain: "session.lifecycle".to_string(),
        event: "session.detach_renderer_requested".to_string(),
        message: "Detaching session renderer".to_string(),
        ids: Some(serde_json::json!({ "session_id": session_id.clone() })),
        data: None,
        error: None,
        client_timestamp: None,
    });

    state
        .send_command(&session_id, SessionCommand::DetachRenderer)
        .await
}

#[tauri::command]
pub async fn close_session(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<SessionManager>>,
    stats_sampler: tauri::State<'_, Arc<RemoteStatsSampler>>,
    session_id: String,
) -> AppResult<()> {
    let session_id_clone = session_id.clone();

    observability::log_event(StructuredLog {
        level: StructuredLogLevel::Info,
        domain: "session.lifecycle".to_string(),
        event: "session.close_requested".to_string(),
        message: "Closing session".to_string(),
        ids: Some(serde_json::json!({ "session_id": session_id.clone() })),
        data: None,
        error: None,
        client_timestamp: None,
    });

    let res = match state.send_command(&session_id, SessionCommand::Close).await {
        Err(AppError::SessionNotFound(_)) => Ok(()),
        other => other,
    };

    stats_sampler.clear_session(&session_id).await;

    // Concurrently tidy up any downloaded/watcher temporary files stored in the OS temp directory
    tauri::async_runtime::spawn(async move {
        if let Ok(temp_dir) = app.path().temp_dir() {
            let session_temp_dir = temp_dir.join("nyaterm").join(&session_id_clone);
            if session_temp_dir.exists() {
                if let Err(e) = tokio::fs::remove_dir_all(&session_temp_dir).await {
                    observability::log_event(StructuredLog {
                        level: StructuredLogLevel::Warn,
                        domain: "session.lifecycle".to_string(),
                        event: "session.temp_cleanup_failed".to_string(),
                        message: "Failed to clean up session temp directory".to_string(),
                        ids: Some(serde_json::json!({ "session_id": session_id_clone })),
                        data: Some(serde_json::json!({
                            "temp_dir": session_temp_dir,
                        })),
                        error: Some(serde_json::json!({ "message": e.to_string() })),
                        client_timestamp: None,
                    });
                } else {
                    observability::log_event(StructuredLog {
                        level: StructuredLogLevel::Info,
                        domain: "session.lifecycle".to_string(),
                        event: "session.temp_cleanup_succeeded".to_string(),
                        message: "Cleaned up session temp directory".to_string(),
                        ids: Some(serde_json::json!({ "session_id": session_id_clone })),
                        data: Some(serde_json::json!({
                            "temp_dir": session_temp_dir,
                        })),
                        error: None,
                        client_timestamp: None,
                    });
                }
            }
        }
    });

    res
}

#[tauri::command]
pub async fn list_sessions(
    state: tauri::State<'_, Arc<SessionManager>>,
) -> AppResult<Vec<SessionInfo>> {
    Ok(state.list_sessions().await)
}

#[tauri::command]
pub async fn add_command_history(
    state: tauri::State<'_, Arc<SessionManager>>,
    session_id: String,
    command: String,
) -> AppResult<()> {
    state.add_command(&session_id, command).await;
    Ok(())
}

#[tauri::command]
pub async fn register_command_submission(
    state: tauri::State<'_, Arc<SessionManager>>,
    session_id: String,
    command: String,
) -> AppResult<()> {
    state
        .register_command_submission(&session_id, command)
        .await;
    Ok(())
}

#[tauri::command]
pub async fn get_command_history(
    state: tauri::State<'_, Arc<SessionManager>>,
) -> AppResult<Vec<String>> {
    Ok(state.get_all_history().await)
}

#[tauri::command]
pub async fn delete_command_history(
    state: tauri::State<'_, Arc<SessionManager>>,
    command: String,
) -> AppResult<()> {
    state.delete_history_command(command).await;
    Ok(())
}

#[tauri::command]
pub async fn fuzzy_search_history(
    state: tauri::State<'_, Arc<SessionManager>>,
    pattern: String,
    limit: usize,
    min_command_length: Option<usize>,
    max_command_length: Option<usize>,
) -> AppResult<Vec<FuzzyResult>> {
    Ok(state
        .fuzzy_search(&pattern, limit, min_command_length, max_command_length)
        .await)
}

#[tauri::command]
pub async fn fuzzy_search_commands(
    state: tauri::State<'_, Arc<QuickCommandsStore>>,
    pattern: String,
    limit: usize,
) -> AppResult<Vec<FuzzyResult>> {
    let cfg = state.snapshot();
    let items: Vec<(&str, &str)> = cfg
        .commands
        .iter()
        .map(|c| (c.label.as_str(), c.command.as_str()))
        .collect();
    Ok(fuzzy_search_items(
        &items,
        &pattern,
        "quickCommand",
        limit,
        None,
        None,
    ))
}

#[tauri::command]
pub async fn fuzzy_search_candidates(
    pattern: String,
    items: Vec<FuzzySearchCandidate>,
    limit: usize,
) -> AppResult<Vec<FuzzyCandidateResult>> {
    Ok(fuzzy_search_candidate_items(&items, &pattern, limit))
}

#[tauri::command]
pub async fn start_recording(
    state: tauri::State<'_, Arc<RecordingManager>>,
    session_id: String,
    file_path: String,
    include_io_labels: bool,
    include_timestamps: bool,
) -> AppResult<()> {
    let mgr = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        mgr.start(
            &session_id,
            &file_path,
            include_io_labels,
            include_timestamps,
        )
    })
    .await
    .map_err(|e| AppError::Config(format!("Task join error: {e}")))?
}

#[tauri::command]
pub async fn stop_recording(
    state: tauri::State<'_, Arc<RecordingManager>>,
    session_id: String,
) -> AppResult<String> {
    let mgr = state.inner().clone();
    tokio::task::spawn_blocking(move || mgr.stop(&session_id))
        .await
        .map_err(|e| AppError::Config(format!("Task join error: {e}")))?
}

#[tauri::command]
pub async fn is_recording(
    state: tauri::State<'_, Arc<RecordingManager>>,
    session_id: String,
) -> AppResult<bool> {
    Ok(state.is_recording(&session_id))
}

#[tauri::command]
pub async fn save_session_transcript(
    state: tauri::State<'_, Arc<RecordingManager>>,
    session_id: String,
    file_path: String,
    include_io_labels: bool,
    include_timestamps: bool,
) -> AppResult<String> {
    let mgr = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        mgr.save_transcript(
            &session_id,
            &file_path,
            include_io_labels,
            include_timestamps,
        )
    })
    .await
    .map_err(|e| AppError::Config(format!("Task join error: {e}")))?
}

#[tauri::command]
pub async fn terminal_history_search(
    state: tauri::State<'_, Arc<RecordingManager>>,
    request: TerminalHistorySearchRequest,
) -> AppResult<TerminalHistorySearchResponse> {
    let mgr = state.inner().clone();
    tokio::task::spawn_blocking(move || mgr.search_history(request))
        .await
        .map_err(|e| AppError::Config(format!("Task join error: {e}")))?
}

#[tauri::command]
pub async fn list_recording_sessions(
    state: tauri::State<'_, Arc<RecordingManager>>,
) -> AppResult<Vec<String>> {
    Ok(state.list_recording_sessions())
}

#[tauri::command]
pub async fn set_recording_memory_limit(
    state: tauri::State<'_, Arc<RecordingManager>>,
    max_bytes: usize,
) -> AppResult<()> {
    state.set_memory_limit(max_bytes);
    Ok(())
}

#[tauri::command]
pub async fn submit_otp_response(
    state: tauri::State<'_, Arc<PendingAuthManager>>,
    request_id: String,
    responses: Vec<String>,
) -> AppResult<()> {
    if state.respond(&request_id, Some(responses)).await {
        observability::log_event(StructuredLog {
            level: StructuredLogLevel::Info,
            domain: "security.flow".to_string(),
            event: "otp.response_received".to_string(),
            message: "Received OTP response from frontend".to_string(),
            ids: Some(serde_json::json!({ "request_id": request_id })),
            data: None,
            error: None,
            client_timestamp: None,
        });
        Ok(())
    } else {
        observability::log_event(StructuredLog {
            level: StructuredLogLevel::Warn,
            domain: "security.flow".to_string(),
            event: "otp.response_rejected".to_string(),
            message: "Rejected OTP response for missing request".to_string(),
            ids: Some(serde_json::json!({ "request_id": request_id.clone() })),
            data: None,
            error: None,
            client_timestamp: None,
        });
        Err(AppError::Auth(format!(
            "No pending OTP request with id '{}'",
            request_id
        )))
    }
}

#[tauri::command]
pub async fn cancel_otp_request(
    state: tauri::State<'_, Arc<PendingAuthManager>>,
    request_id: String,
) -> AppResult<()> {
    let cancelled = state.respond(&request_id, None).await;
    observability::log_event(StructuredLog {
        level: if cancelled {
            StructuredLogLevel::Info
        } else {
            StructuredLogLevel::Warn
        },
        domain: "security.flow".to_string(),
        event: if cancelled {
            "otp.request_cancelled".to_string()
        } else {
            "otp.request_cancel_missing".to_string()
        },
        message: if cancelled {
            "Cancelled OTP request".to_string()
        } else {
            "OTP request was already missing when cancellation arrived".to_string()
        },
        ids: Some(serde_json::json!({ "request_id": request_id })),
        data: None,
        error: None,
        client_timestamp: None,
    });
    Ok(())
}

#[tauri::command]
pub async fn submit_ssh_auth_response(
    state: tauri::State<'_, Arc<PendingSshAuthManager>>,
    request_id: String,
    response: SshAuthResponse,
) -> AppResult<()> {
    if state.respond(&request_id, Some(response)).await {
        observability::log_event(StructuredLog {
            level: StructuredLogLevel::Info,
            domain: "security.flow".to_string(),
            event: "ssh_auth.response_received".to_string(),
            message: "Received SSH credential response from frontend".to_string(),
            ids: Some(serde_json::json!({ "request_id": request_id })),
            data: None,
            error: None,
            client_timestamp: None,
        });
        Ok(())
    } else {
        Err(AppError::Auth(format!(
            "No pending SSH authentication request with id '{}'",
            request_id
        )))
    }
}

#[tauri::command]
pub async fn cancel_ssh_auth_request(
    state: tauri::State<'_, Arc<PendingSshAuthManager>>,
    request_id: String,
) -> AppResult<()> {
    let cancelled = state.respond(&request_id, None).await;
    observability::log_event(StructuredLog {
        level: if cancelled {
            StructuredLogLevel::Info
        } else {
            StructuredLogLevel::Warn
        },
        domain: "security.flow".to_string(),
        event: if cancelled {
            "ssh_auth.request_cancelled".to_string()
        } else {
            "ssh_auth.request_cancel_missing".to_string()
        },
        message: if cancelled {
            "Cancelled SSH credential request".to_string()
        } else {
            "SSH credential request was already missing when cancellation arrived".to_string()
        },
        ids: Some(serde_json::json!({ "request_id": request_id })),
        data: None,
        error: None,
        client_timestamp: None,
    });
    Ok(())
}

#[tauri::command]
pub async fn respond_host_key_verify(
    state: tauri::State<'_, Arc<HostKeyVerifyManager>>,
    request_id: String,
    accepted: bool,
) -> AppResult<()> {
    let resolved = state.respond(&request_id, accepted).await;
    observability::log_event(StructuredLog {
        level: if resolved {
            StructuredLogLevel::Info
        } else {
            StructuredLogLevel::Warn
        },
        domain: "security.flow".to_string(),
        event: if accepted {
            "host_key.accepted".to_string()
        } else {
            "host_key.rejected".to_string()
        },
        message: if resolved {
            format!(
                "Host key verification response received (accepted={})",
                accepted
            )
        } else {
            "Host key verification response for missing request".to_string()
        },
        ids: Some(serde_json::json!({ "request_id": request_id })),
        data: None,
        error: None,
        client_timestamp: None,
    });
    if resolved {
        Ok(())
    } else {
        Err(AppError::Auth(format!(
            "No pending host key verification with id '{}'",
            request_id
        )))
    }
}
