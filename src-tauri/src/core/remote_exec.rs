use crate::core::SessionManager;
use crate::core::ssh::SshConnectionHandles;
use crate::error::{AppError, AppResult};
use russh::ChannelMsg;
use serde::Serialize;
use std::sync::Arc;
use std::time::Duration;

#[derive(Debug, Clone, Serialize)]
pub struct RemoteCommandOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_status: Option<u32>,
}

pub async fn exec_ssh_session_command(
    manager: &Arc<SessionManager>,
    session_id: &str,
    command: &[u8],
    timeout: Duration,
) -> AppResult<RemoteCommandOutput> {
    ensure_remote_exec_enabled(manager, session_id).await?;
    let ssh_handle = get_ssh_handle(manager, session_id).await?;
    exec_ssh_command(&ssh_handle, command, None, timeout).await
}

pub async fn exec_ssh_session_command_with_stdin(
    manager: &Arc<SessionManager>,
    session_id: &str,
    command: &[u8],
    stdin: &[u8],
    timeout: Duration,
) -> AppResult<RemoteCommandOutput> {
    ensure_remote_exec_enabled(manager, session_id).await?;
    let ssh_handle = get_ssh_handle(manager, session_id).await?;
    exec_ssh_command(&ssh_handle, command, Some(stdin), timeout).await
}

async fn ensure_remote_exec_enabled(
    manager: &Arc<SessionManager>,
    session_id: &str,
) -> AppResult<()> {
    let sessions = manager.sessions.lock().await;
    let session = sessions
        .get(session_id)
        .ok_or_else(|| AppError::SessionNotFound(format!("Session '{session_id}' not found")))?;

    if session.ssh_handle.is_none() {
        return Err(AppError::Config("Not an SSH session".to_string()));
    }

    if session.info.remote_stats_enabled {
        Ok(())
    } else {
        Err(AppError::Config(
            "Remote exec probes are disabled for this SSH runtime mode".to_string(),
        ))
    }
}

async fn get_ssh_handle(
    manager: &Arc<SessionManager>,
    session_id: &str,
) -> AppResult<Arc<SshConnectionHandles>> {
    let sessions = manager.sessions.lock().await;
    let session = sessions
        .get(session_id)
        .ok_or_else(|| AppError::SessionNotFound(format!("Session '{session_id}' not found")))?;

    session
        .ssh_handle
        .as_ref()
        .ok_or_else(|| AppError::Config("Not an SSH session".to_string()))?
        .clone()
        .downcast::<SshConnectionHandles>()
        .map_err(|_| AppError::Config("Failed to get SSH handle".to_string()))
}

async fn exec_ssh_command(
    ssh_handle: &Arc<SshConnectionHandles>,
    command: &[u8],
    stdin: Option<&[u8]>,
    timeout: Duration,
) -> AppResult<RemoteCommandOutput> {
    let handle_mtx = ssh_handle.target_handle();

    tokio::time::timeout(timeout, async {
        let mut channel = {
            let handle = handle_mtx.lock().await;
            handle
                .channel_open_session()
                .await
                .map_err(|e| AppError::Channel(format!("Failed to open channel: {e}")))?
        };

        channel
            .exec(true, command)
            .await
            .map_err(|e| AppError::Channel(format!("Failed to execute command: {e}")))?;

        if let Some(stdin) = stdin {
            channel
                .data(stdin)
                .await
                .map_err(|e| AppError::Channel(format!("Failed to send command stdin: {e}")))?;
            channel
                .eof()
                .await
                .map_err(|e| AppError::Channel(format!("Failed to close command stdin: {e}")))?;
        }

        let mut stdout = String::new();
        let mut stderr = String::new();
        let mut exit_status = None;

        loop {
            match channel.wait().await {
                Some(ChannelMsg::Data { ref data }) => {
                    stdout.push_str(&String::from_utf8_lossy(data));
                }
                Some(ChannelMsg::ExtendedData { ref data, .. }) => {
                    stderr.push_str(&String::from_utf8_lossy(data));
                }
                Some(ChannelMsg::ExitStatus {
                    exit_status: status,
                }) => {
                    exit_status = Some(status);
                }
                Some(ChannelMsg::Eof) => {
                    if exit_status.is_none() {
                        if let Some(ChannelMsg::ExitStatus {
                            exit_status: status,
                        }) = channel.wait().await
                        {
                            exit_status = Some(status);
                        }
                    }
                    break;
                }
                None => break,
                _ => {}
            }
        }

        Ok::<RemoteCommandOutput, AppError>(RemoteCommandOutput {
            stdout,
            stderr,
            exit_status,
        })
    })
    .await
    .map_err(|_| AppError::Channel("Remote command timed out".to_string()))?
}

pub fn ensure_success(
    output: RemoteCommandOutput,
    context: &str,
) -> AppResult<RemoteCommandOutput> {
    if matches!(output.exit_status, Some(0) | None) {
        return Ok(output);
    }

    let stderr = output.stderr.trim();
    let stdout = output.stdout.trim();
    let detail = if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        "remote command failed"
    };

    Err(AppError::Channel(format!("{context}: {detail}")))
}

pub fn sh_quote(value: &str) -> String {
    if value.is_empty() {
        return "''".to_string();
    }
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}
