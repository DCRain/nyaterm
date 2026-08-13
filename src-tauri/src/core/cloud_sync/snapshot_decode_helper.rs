use std::ffi::OsString;
use std::io::Write;
#[cfg(not(test))]
use std::path::Path;
use std::path::PathBuf;
#[cfg(not(test))]
use std::process::Stdio;
#[cfg(not(test))]
use std::time::Duration;

use serde::{Deserialize, Serialize};
#[cfg(not(test))]
use tokio::process::Command;
#[cfg(not(test))]
use uuid::Uuid;

use crate::core::portable_snapshot::{PortableSnapshot, decode_portable_snapshot};
use crate::error::{AppError, AppResult, CloudSyncError};
use crate::utils::crypto::set_master_password;
#[cfg(not(test))]
use crate::utils::process::hide_window;

use super::crypto::decrypt_snapshot_bytes;
#[cfg(not(test))]
use super::crypto::require_master_password;

const HELPER_FLAG: &str = "--nyaterm-cloud-snapshot-decode-helper";
const HELPER_MASTER_PASSWORD_ENV: &str = "NYATERM_CLOUD_SNAPSHOT_MASTER_PASSWORD";
#[cfg(not(test))]
const HELPER_TIMEOUT: Duration = Duration::from_secs(30);
#[cfg(not(test))]
const MAX_HELPER_OUTPUT_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Serialize, Deserialize)]
struct DecodeHelperRequest {
    encrypted_snapshot: Vec<u8>,
}

#[derive(Serialize, Deserialize)]
struct DecodeHelperResponse {
    snapshot: PortableSnapshot,
}

pub fn run_helper_if_requested() -> bool {
    let args: Vec<OsString> = std::env::args_os().collect();
    if args.get(1).and_then(|arg| arg.to_str()) != Some(HELPER_FLAG) {
        return false;
    }

    let result = run_helper(&args);
    if let Err(error) = result {
        eprintln!("cloud snapshot decode helper failed: {error}");
        std::process::exit(1);
    }
    true
}

fn run_helper(args: &[OsString]) -> AppResult<()> {
    if args.len() != 3 {
        return Err(AppError::Config(
            "Invalid cloud snapshot decode helper arguments".to_string(),
        ));
    }
    let input_path = PathBuf::from(&args[2]);
    let master_password = std::env::var(HELPER_MASTER_PASSWORD_ENV).map_err(|_| {
        AppError::Config("Missing cloud snapshot decode helper master password".to_string())
    })?;
    let request: DecodeHelperRequest = serde_json::from_slice(&std::fs::read(input_path)?)?;
    set_master_password(Some(master_password));
    let decrypted = decrypt_snapshot_bytes(&request.encrypted_snapshot)?;
    let snapshot = decode_portable_snapshot(&decrypted)?;
    let response = DecodeHelperResponse { snapshot };
    std::io::stdout().write_all(&serde_json::to_vec(&response)?)?;
    Ok(())
}

pub async fn decode_remote_snapshot_isolated(
    encrypted_snapshot: &[u8],
    revision: &str,
) -> AppResult<PortableSnapshot> {
    #[cfg(test)]
    {
        return decode_remote_snapshot_in_process(encrypted_snapshot, revision);
    }

    #[cfg(not(test))]
    match decode_remote_snapshot_with_helper(encrypted_snapshot).await {
        Ok(snapshot) => Ok(snapshot),
        Err(error) => {
            tracing::warn!(
                revision,
                error = %error,
                "Isolated remote sync snapshot decode failed"
            );
            Err(CloudSyncError::CorruptedSnapshot {
                revision: revision.to_string(),
            }
            .into())
        }
    }
}

#[cfg(test)]
fn decode_remote_snapshot_in_process(
    encrypted_snapshot: &[u8],
    revision: &str,
) -> AppResult<PortableSnapshot> {
    let decrypted = decrypt_snapshot_bytes(encrypted_snapshot).map_err(|_| {
        CloudSyncError::CorruptedSnapshot {
            revision: revision.to_string(),
        }
    })?;
    decode_portable_snapshot(&decrypted).map_err(|_| {
        CloudSyncError::CorruptedSnapshot {
            revision: revision.to_string(),
        }
        .into()
    })
}

#[cfg(not(test))]
async fn decode_remote_snapshot_with_helper(
    encrypted_snapshot: &[u8],
) -> AppResult<PortableSnapshot> {
    let master_password = require_master_password()?;
    let temp = DecodeHelperTempFiles::new();
    let request = DecodeHelperRequest {
        encrypted_snapshot: encrypted_snapshot.to_vec(),
    };
    tokio::fs::write(temp.input_path(), serde_json::to_vec(&request)?).await?;

    let exe = std::env::current_exe()?;
    let mut command = Command::new(exe);
    command
        .arg(HELPER_FLAG)
        .arg(temp.input_path())
        .env(HELPER_MASTER_PASSWORD_ENV, master_password)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    command.kill_on_drop(true);
    hide_window(&mut command);

    let output = tokio::time::timeout(HELPER_TIMEOUT, command.output())
        .await
        .map_err(|_| AppError::Config("cloud snapshot decode helper timed out".to_string()))??;
    if !output.status.success() {
        return Err(AppError::Config(format!(
            "cloud snapshot decode helper exited with status {}",
            output.status
        )));
    }

    if u64::try_from(output.stdout.len()).unwrap_or(u64::MAX) > MAX_HELPER_OUTPUT_BYTES {
        return Err(AppError::Config(
            "cloud snapshot decode helper output is too large".to_string(),
        ));
    }
    let response: DecodeHelperResponse = serde_json::from_slice(&output.stdout)?;
    Ok(response.snapshot)
}

#[cfg(not(test))]
struct DecodeHelperTempFiles {
    input: PathBuf,
}

#[cfg(not(test))]
impl DecodeHelperTempFiles {
    fn new() -> Self {
        let id = Uuid::new_v4();
        let base = std::env::temp_dir();
        Self {
            input: base.join(format!("nyaterm-cloud-snapshot-decode-{id}.json")),
        }
    }

    fn input_path(&self) -> &Path {
        &self.input
    }
}

#[cfg(not(test))]
impl Drop for DecodeHelperTempFiles {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.input);
    }
}
