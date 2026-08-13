use crate::core::SessionManager;
use crate::core::monitoring::process::{
    PROCESS_LIST_SCRIPT, PROCESS_LIST_UNSUPPORTED_ERROR, RemoteProcess,
    is_process_list_unsupported, parse_process_output,
};
use crate::core::remote_exec::{RemoteCommandOutput, ensure_success, exec_ssh_session_command};
use crate::error::{AppError, AppResult};
use std::sync::Arc;
use std::time::Duration;

const PROCESS_TIMEOUT: Duration = Duration::from_secs(10);

#[tauri::command]
pub async fn get_remote_processes(
    state: tauri::State<'_, Arc<SessionManager>>,
    session_id: String,
) -> AppResult<Vec<RemoteProcess>> {
    let output = exec_ssh_session_command(
        state.inner(),
        &session_id,
        PROCESS_LIST_SCRIPT.as_bytes(),
        PROCESS_TIMEOUT,
    )
    .await?;
    if is_process_list_unsupported(&output.stdout) || is_process_list_unsupported(&output.stderr) {
        return Err(AppError::Config(PROCESS_LIST_UNSUPPORTED_ERROR.to_string()));
    }
    let output = ensure_success(output, "Failed to list processes")?;
    if is_process_list_unsupported(&output.stdout) || is_process_list_unsupported(&output.stderr) {
        return Err(AppError::Config(PROCESS_LIST_UNSUPPORTED_ERROR.to_string()));
    }
    Ok(parse_process_output(&output.stdout))
}

#[tauri::command]
pub async fn signal_remote_process(
    state: tauri::State<'_, Arc<SessionManager>>,
    session_id: String,
    pid: u32,
    signal: String,
) -> AppResult<RemoteCommandOutput> {
    let signal = normalize_signal(&signal)?;
    let command = format!("kill -{signal} -- {pid}");
    let output = exec_ssh_session_command(
        state.inner(),
        &session_id,
        command.as_bytes(),
        PROCESS_TIMEOUT,
    )
    .await?;
    ensure_success(output, "Failed to signal process")
}

fn normalize_signal(signal: &str) -> AppResult<&'static str> {
    match signal.trim().to_ascii_uppercase().as_str() {
        "TERM" | "SIGTERM" | "15" => Ok("TERM"),
        "KILL" | "SIGKILL" | "9" => Ok("KILL"),
        "HUP" | "SIGHUP" | "1" => Ok("HUP"),
        "STOP" | "SIGSTOP" | "19" => Ok("STOP"),
        "CONT" | "SIGCONT" | "18" => Ok("CONT"),
        _ => Err(AppError::Config("Unsupported process signal".to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_allowed_signals() {
        assert_eq!(normalize_signal("sigterm").unwrap(), "TERM");
        assert_eq!(normalize_signal("9").unwrap(), "KILL");
        assert!(normalize_signal("USR1").is_err());
    }
}
