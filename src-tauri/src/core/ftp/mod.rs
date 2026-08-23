//! FTP file-browser backend using suppaftp, with FTPS certificate prompts.

use std::collections::{HashMap, HashSet};
use std::io::Cursor;
use std::path::Path;
use std::str::FromStr;
use std::sync::Arc;
use std::time::{Duration, Instant};

use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{ClientConfig, RootCertStore, SignatureScheme};
use serde::Serialize;
use sha2::{Digest, Sha256};
use suppaftp::list::File;
use suppaftp::tokio::{
    AsyncFtpStream, AsyncRustlsConnector, AsyncRustlsFtpStream,
};
use suppaftp::Mode;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{mpsc, oneshot, Mutex};

use crate::config::{ConnectionType, SavedConnection};
use crate::core::sftp::{DirectoryChild, FileEntry, FileProperties};
use crate::error::{AppError, AppResult};
use crate::storage::{FtpCertificateMetadata, KnownHostCheck};
use crate::utils::crypto;
use x509_cert::der::Decode as _;

const FTP_PROGRESS_INTERVAL: Duration = Duration::from_millis(50);
const FTP_CHUNK_SIZE: usize = 512 * 1024;
const CERTIFICATE_PROMPT_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Debug, Clone, Serialize)]
pub struct FtpTransferEvent {
    pub id: String,
    pub session_id: String,
    pub file_name: String,
    pub remote_path: String,
    pub local_path: String,
    pub direction: String,
    pub kind: String,
    pub status: String,
    pub size: u64,
    pub bytes_transferred: u64,
    pub total_size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item_count_total: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item_count_completed: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_msg: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FtpCertificateVerifyEvent {
    pub request_id: String,
    pub host: String,
    pub port: u16,
    pub fingerprint: String,
    pub subject: Option<String>,
    pub issuer: Option<String>,
    pub valid_from: Option<String>,
    pub valid_to: Option<String>,
    pub known_host_status: String,
    pub target_window_label: Option<String>,
}

#[derive(Clone)]
struct FtpSession {
    sender: mpsc::Sender<FtpCommand>,
}

struct FtpCertDecision {
    accepted: bool,
    remember: bool,
}

enum LiveFtp {
    Plain(AsyncFtpStream),
    Tls(AsyncRustlsFtpStream),
}

enum FtpCommand {
    List {
        path: String,
        reply: oneshot::Sender<AppResult<Vec<FileEntry>>>,
    },
    CreateDir {
        path: String,
        reply: oneshot::Sender<AppResult<()>>,
    },
    CreateFile {
        path: String,
        reply: oneshot::Sender<AppResult<()>>,
    },
    Delete {
        path: String,
        is_dir: bool,
        reply: oneshot::Sender<AppResult<()>>,
    },
    Rename {
        old_path: String,
        new_path: String,
        reply: oneshot::Sender<AppResult<()>>,
    },
    UploadFile {
        local_path: String,
        remote_path: String,
        app: Option<AppHandle>,
        transfer_id: Option<String>,
        session_id: String,
        reply: oneshot::Sender<AppResult<()>>,
    },
    DownloadFile {
        remote_path: String,
        local_path: String,
        app: Option<AppHandle>,
        transfer_id: Option<String>,
        session_id: String,
        reply: oneshot::Sender<AppResult<()>>,
    },
    DownloadDirectory {
        remote_path: String,
        local_path: String,
        app: Option<AppHandle>,
        transfer_id: Option<String>,
        session_id: String,
        reply: oneshot::Sender<AppResult<()>>,
    },
    Quit,
}

#[derive(Clone)]
pub struct FtpConnectParams {
    pub host: String,
    pub port: u16,
    pub root: String,
    pub username: String,
    pub password: String,
    pub use_tls: bool,
}

struct FtpTrustState {
    pending_certificates: Mutex<HashMap<String, oneshot::Sender<FtpCertDecision>>>,
    once_trusted: Mutex<HashSet<(String, u16, String)>>,
}

pub struct FtpManager {
    sessions: Mutex<HashMap<String, FtpSession>>,
    trust: Arc<FtpTrustState>,
}

impl FtpManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            trust: Arc::new(FtpTrustState {
                pending_certificates: Mutex::new(HashMap::new()),
                once_trusted: Mutex::new(HashSet::new()),
            }),
        }
    }

    pub async fn respond_certificate(
        &self,
        request_id: &str,
        accepted: bool,
        remember: bool,
    ) -> AppResult<()> {
        let Some(tx) = self
            .trust
            .pending_certificates
            .lock()
            .await
            .remove(request_id)
        else {
            return Err(AppError::Auth(format!(
                "No pending FTP certificate verification with id '{request_id}'"
            )));
        };
        let _ = tx.send(FtpCertDecision { accepted, remember });
        Ok(())
    }

    async fn get_session(
        &self,
        app: &AppHandle,
        connection_id: &str,
        target_window_label: Option<&str>,
    ) -> AppResult<FtpSession> {
        {
            let guard = self.sessions.lock().await;
            if let Some(session) = guard.get(connection_id) {
                return Ok(session.clone());
            }
        }

        let connection = load_ftp_connection(connection_id)?;
        let params = connect_params_from_connection(&connection)?;
        let session = spawn_session(
            app.clone(),
            self.trust.clone(),
            params,
            target_window_label.map(str::to_string),
        )
        .await?;
        let mut guard = self.sessions.lock().await;
        guard.insert(connection_id.to_string(), session.clone());
        Ok(session)
    }

    pub async fn invalidate(&self, connection_id: &str) {
        let session = self.sessions.lock().await.remove(connection_id);
        if let Some(session) = session {
            let _ = session.sender.send(FtpCommand::Quit).await;
        }
    }

    pub async fn probe(
        &self,
        app: &AppHandle,
        params: FtpConnectParams,
        target_window_label: Option<&str>,
    ) -> AppResult<()> {
        let mut ftp = connect_live(
            app,
            &self.trust,
            &params,
            target_window_label.map(str::to_string),
        )
        .await?;
        let _ = ftp_list(&mut ftp, "/").await?;
        ftp_quit(&mut ftp).await;
        Ok(())
    }

    pub async fn list_dir(
        &self,
        app: &AppHandle,
        connection_id: &str,
        path: &str,
        target_window_label: Option<&str>,
    ) -> AppResult<Vec<FileEntry>> {
        let session = self
            .get_session(app, connection_id, target_window_label)
            .await?;
        let (reply, rx) = oneshot::channel();
        session
            .sender
            .send(FtpCommand::List {
                path: path.to_string(),
                reply,
            })
            .await
            .map_err(|_| AppError::Config("FTP session closed".into()))?;
        rx.await
            .map_err(|_| AppError::Config("FTP session closed".into()))?
    }

    pub async fn file_properties(
        &self,
        app: &AppHandle,
        connection_id: &str,
        path: &str,
        _is_directory: bool,
        target_window_label: Option<&str>,
    ) -> AppResult<FileProperties> {
        if is_ftp_root(path) {
            return Ok(synthetic_dir_properties(path));
        }
        let Some((parent, name)) = ftp_parent_and_name(path) else {
            return Ok(synthetic_dir_properties(path));
        };
        let entries = self
            .list_dir(app, connection_id, &parent, target_window_label)
            .await?;
        let entry = entries
            .into_iter()
            .find(|item| item.name == name)
            .ok_or_else(|| AppError::Config(format!("FTP entry '{path}' not found")))?;
        Ok(FileProperties {
            name: entry.name,
            is_dir: entry.is_dir,
            is_symlink: entry.is_symlink,
            size: if entry.is_dir { 0 } else { entry.size },
            permissions: entry.permissions,
            owner: entry.owner,
            group: entry.group,
            uid: String::new(),
            gid: String::new(),
            mtime: entry.mtime,
            atime: entry.mtime,
        })
    }

    pub async fn list_child_directories(
        &self,
        app: &AppHandle,
        connection_id: &str,
        path: &str,
        show_hidden: bool,
        target_window_label: Option<&str>,
    ) -> AppResult<Vec<DirectoryChild>> {
        let entries = self
            .list_dir(app, connection_id, path, target_window_label)
            .await?;
        let base = normalize_ftp_prefix(path);
        Ok(entries
            .into_iter()
            .filter(|entry| entry.is_dir)
            .filter(|entry| show_hidden || !entry.name.starts_with('.'))
            .map(|entry| DirectoryChild {
                path: if base.is_empty() || base == "/" {
                    format!("/{}/", entry.name)
                } else {
                    format!("{}{}/", base.trim_end_matches('/'), entry.name)
                },
                name: entry.name,
                is_symlink: false,
                raw_path_token: None,
            })
            .collect())
    }

    pub async fn create_dir(
        &self,
        app: &AppHandle,
        connection_id: &str,
        path: &str,
        target_window_label: Option<&str>,
    ) -> AppResult<()> {
        let path = path.to_string();
        self.send_unit(app, connection_id, target_window_label, |reply| {
            FtpCommand::CreateDir { path, reply }
        })
        .await
    }

    pub async fn create_file(
        &self,
        app: &AppHandle,
        connection_id: &str,
        path: &str,
        target_window_label: Option<&str>,
    ) -> AppResult<()> {
        let path = path.to_string();
        self.send_unit(app, connection_id, target_window_label, |reply| {
            FtpCommand::CreateFile { path, reply }
        })
        .await
    }

    pub async fn delete(
        &self,
        app: &AppHandle,
        connection_id: &str,
        path: &str,
        is_dir: bool,
        target_window_label: Option<&str>,
    ) -> AppResult<()> {
        let session = self
            .get_session(app, connection_id, target_window_label)
            .await?;
        let (reply, rx) = oneshot::channel();
        session
            .sender
            .send(FtpCommand::Delete {
                path: path.to_string(),
                is_dir,
                reply,
            })
            .await
            .map_err(|_| AppError::Config("FTP session closed".into()))?;
        rx.await
            .map_err(|_| AppError::Config("FTP session closed".into()))?
    }

    pub async fn rename(
        &self,
        app: &AppHandle,
        connection_id: &str,
        old_path: &str,
        new_path: &str,
        target_window_label: Option<&str>,
    ) -> AppResult<()> {
        let session = self
            .get_session(app, connection_id, target_window_label)
            .await?;
        let (reply, rx) = oneshot::channel();
        session
            .sender
            .send(FtpCommand::Rename {
                old_path: old_path.to_string(),
                new_path: new_path.to_string(),
                reply,
            })
            .await
            .map_err(|_| AppError::Config("FTP session closed".into()))?;
        rx.await
            .map_err(|_| AppError::Config("FTP session closed".into()))?
    }

    pub async fn upload_file_with_progress(
        &self,
        connection_id: &str,
        local_path: &str,
        remote_path: &str,
        app: Option<&AppHandle>,
        transfer_id: Option<&str>,
        target_window_label: Option<&str>,
    ) -> AppResult<()> {
        let handle = app.cloned().ok_or_else(|| {
            AppError::Config("FTP upload requires an application handle".into())
        })?;
        let session = self
            .get_session(&handle, connection_id, target_window_label)
            .await?;
        let (reply, rx) = oneshot::channel();
        session
            .sender
            .send(FtpCommand::UploadFile {
                local_path: local_path.to_string(),
                remote_path: remote_path.to_string(),
                app: app.cloned(),
                transfer_id: transfer_id.map(str::to_string),
                session_id: format!("ftp:{connection_id}"),
                reply,
            })
            .await
            .map_err(|_| AppError::Config("FTP session closed".into()))?;
        rx.await
            .map_err(|_| AppError::Config("FTP session closed".into()))?
    }

    pub async fn upload_file(
        &self,
        app: &AppHandle,
        connection_id: &str,
        local_path: &str,
        remote_path: &str,
        target_window_label: Option<&str>,
    ) -> AppResult<()> {
        self.upload_file_with_progress(
            connection_id,
            local_path,
            remote_path,
            Some(app),
            None,
            target_window_label,
        )
        .await
    }

    pub async fn download_file_with_progress(
        &self,
        connection_id: &str,
        remote_path: &str,
        local_path: &str,
        app: Option<&AppHandle>,
        transfer_id: Option<&str>,
        target_window_label: Option<&str>,
    ) -> AppResult<()> {
        let handle = app.cloned().ok_or_else(|| {
            AppError::Config("FTP download requires an application handle".into())
        })?;
        let session = self
            .get_session(&handle, connection_id, target_window_label)
            .await?;
        let (reply, rx) = oneshot::channel();
        session
            .sender
            .send(FtpCommand::DownloadFile {
                remote_path: remote_path.to_string(),
                local_path: local_path.to_string(),
                app: app.cloned(),
                transfer_id: transfer_id.map(str::to_string),
                session_id: format!("ftp:{connection_id}"),
                reply,
            })
            .await
            .map_err(|_| AppError::Config("FTP session closed".into()))?;
        rx.await
            .map_err(|_| AppError::Config("FTP session closed".into()))?
    }

    pub async fn upload_directory_with_progress(
        &self,
        connection_id: &str,
        local_path: &str,
        remote_path: &str,
        app: Option<&AppHandle>,
        transfer_id: Option<&str>,
        target_window_label: Option<&str>,
    ) -> AppResult<()> {
        let handle = app
            .cloned()
            .ok_or_else(|| AppError::Config("FTP upload requires an application handle".into()))?;
        let _ = self
            .get_session(&handle, connection_id, target_window_label)
            .await?;
        let root = Path::new(local_path);
        let session_id = format!("ftp:{connection_id}");
        let display_name = local_path
            .rsplit(['/', '\\'])
            .find(|s| !s.is_empty())
            .unwrap_or(local_path)
            .to_string();
        let emit = make_emitter(
            app,
            transfer_id,
            &session_id,
            &display_name,
            remote_path,
            local_path,
            "upload",
            "directory",
            0,
        );
        if let Some(emitter) = emit.as_ref() {
            emitter.emit_status("started", 0, None);
        }
        let mut stack = vec![root.to_path_buf()];
        let result: AppResult<()> = async {
            while let Some(dir) = stack.pop() {
                let mut entries = tokio::fs::read_dir(&dir)
                    .await
                    .map_err(|err| AppError::Config(format!("Failed to read local dir: {err}")))?;
                loop {
                    let entry = match entries.next_entry().await {
                        Ok(Some(entry)) => entry,
                        Ok(None) => break,
                        Err(err) => {
                            return Err(AppError::Config(format!(
                                "Failed to read local entry: {err}"
                            )));
                        }
                    };
                    let path = entry.path();
                    let rel = path.strip_prefix(root).map_err(|err| {
                        AppError::Config(format!("Invalid relative path: {err}"))
                    })?;
                    let rel_key = rel
                        .components()
                        .map(|c| c.as_os_str().to_string_lossy())
                        .collect::<Vec<_>>()
                        .join("/");
                    let remote = if remote_path.trim_end_matches('/').is_empty() || remote_path == "/"
                    {
                        format!("/{rel_key}")
                    } else {
                        format!("{}/{}", remote_path.trim_end_matches('/'), rel_key)
                    };
                    let file_type = entry.file_type().await.map_err(|err| {
                        AppError::Config(format!("Failed to stat local entry: {err}"))
                    })?;
                    if file_type.is_dir() {
                        self.create_dir(&handle, connection_id, &remote, target_window_label)
                            .await?;
                        stack.push(path);
                    } else if file_type.is_file() {
                        self.upload_file(
                            &handle,
                            connection_id,
                            path.to_string_lossy().as_ref(),
                            &remote,
                            target_window_label,
                        )
                        .await?;
                    }
                }
            }
            Ok(())
        }
        .await;
        match result {
            Ok(()) => {
                if let Some(emitter) = emit.as_ref() {
                    emitter.emit_status("completed", 0, None);
                }
                Ok(())
            }
            Err(err) => {
                let message = err.to_string();
                if let Some(emitter) = emit.as_ref() {
                    emitter.emit_status("error", 0, Some(message.clone()));
                }
                Err(AppError::Config(message))
            }
        }
    }

    pub async fn download_directory_with_progress(
        &self,
        connection_id: &str,
        remote_path: &str,
        local_path: &str,
        app: Option<&AppHandle>,
        transfer_id: Option<&str>,
        target_window_label: Option<&str>,
    ) -> AppResult<()> {
        let handle = app.cloned().ok_or_else(|| {
            AppError::Config("FTP download requires an application handle".into())
        })?;
        let session = self
            .get_session(&handle, connection_id, target_window_label)
            .await?;
        let (reply, rx) = oneshot::channel();
        session
            .sender
            .send(FtpCommand::DownloadDirectory {
                remote_path: remote_path.to_string(),
                local_path: local_path.to_string(),
                app: app.cloned(),
                transfer_id: transfer_id.map(str::to_string),
                session_id: format!("ftp:{connection_id}"),
                reply,
            })
            .await
            .map_err(|_| AppError::Config("FTP session closed".into()))?;
        rx.await
            .map_err(|_| AppError::Config("FTP session closed".into()))?
    }

    async fn send_unit(
        &self,
        app: &AppHandle,
        connection_id: &str,
        target_window_label: Option<&str>,
        build: impl FnOnce(oneshot::Sender<AppResult<()>>) -> FtpCommand,
    ) -> AppResult<()> {
        let session = self
            .get_session(app, connection_id, target_window_label)
            .await?;
        let (reply, rx) = oneshot::channel();
        session
            .sender
            .send(build(reply))
            .await
            .map_err(|_| AppError::Config("FTP session closed".into()))?;
        rx.await
            .map_err(|_| AppError::Config("FTP session closed".into()))?
    }
}

impl Default for FtpManager {
    fn default() -> Self {
        Self::new()
    }
}

async fn spawn_session(
    app: AppHandle,
    trust: Arc<FtpTrustState>,
    params: FtpConnectParams,
    target_window_label: Option<String>,
) -> AppResult<FtpSession> {
    let (tx, mut rx) = mpsc::channel::<FtpCommand>(32);
    let (ready_tx, ready_rx) = oneshot::channel::<AppResult<()>>();
    tauri::async_runtime::spawn(async move {
        let mut ftp = match connect_live(&app, &trust, &params, target_window_label).await {
            Ok(ftp) => {
                let _ = ready_tx.send(Ok(()));
                ftp
            }
            Err(err) => {
                let _ = ready_tx.send(Err(err));
                return;
            }
        };
        while let Some(cmd) = rx.recv().await {
            match cmd {
                FtpCommand::List { path, reply } => {
                    let _ = reply.send(ftp_list(&mut ftp, &path).await);
                }
                FtpCommand::CreateDir { path, reply } => {
                    let _ = reply.send(ftp_mkdir(&mut ftp, &path).await);
                }
                FtpCommand::CreateFile { path, reply } => {
                    let _ = reply.send(ftp_create_file(&mut ftp, &path).await);
                }
                FtpCommand::Delete {
                    path,
                    is_dir,
                    reply,
                } => {
                    let _ = reply.send(ftp_delete(&mut ftp, &path, is_dir).await);
                }
                FtpCommand::Rename {
                    old_path,
                    new_path,
                    reply,
                } => {
                    let _ = reply.send(ftp_rename(&mut ftp, &old_path, &new_path).await);
                }
                FtpCommand::UploadFile {
                    local_path,
                    remote_path,
                    app,
                    transfer_id,
                    session_id,
                    reply,
                } => {
                    let _ = reply.send(
                        ftp_upload_file(
                            &mut ftp,
                            &local_path,
                            &remote_path,
                            app.as_ref(),
                            transfer_id.as_deref(),
                            &session_id,
                        )
                        .await,
                    );
                }
                FtpCommand::DownloadFile {
                    remote_path,
                    local_path,
                    app,
                    transfer_id,
                    session_id,
                    reply,
                } => {
                    let _ = reply.send(
                        ftp_download_file(
                            &mut ftp,
                            &remote_path,
                            &local_path,
                            app.as_ref(),
                            transfer_id.as_deref(),
                            &session_id,
                        )
                        .await,
                    );
                }
                FtpCommand::DownloadDirectory {
                    remote_path,
                    local_path,
                    app,
                    transfer_id,
                    session_id,
                    reply,
                } => {
                    let _ = reply.send(
                        ftp_download_directory(
                            &mut ftp,
                            &remote_path,
                            &local_path,
                            app.as_ref(),
                            transfer_id.as_deref(),
                            &session_id,
                        )
                        .await,
                    );
                }
                FtpCommand::Quit => {
                    ftp_quit(&mut ftp).await;
                    break;
                }
            }
        }
    });
    ready_rx
        .await
        .map_err(|_| AppError::Config("FTP connect task ended".into()))??;
    Ok(FtpSession { sender: tx })
}

async fn connect_live(
    app: &AppHandle,
    trust: &FtpTrustState,
    params: &FtpConnectParams,
    target_window_label: Option<String>,
) -> AppResult<LiveFtp> {
    let addr = format!("{}:{}", params.host, params.port);
    let user = if params.username.is_empty() {
        "anonymous"
    } else {
        params.username.as_str()
    };

    if !params.use_tls {
        let mut ftp = connect_plain(&addr).await?;
        ftp.login(user, &params.password)
            .await
            .map_err(|err| AppError::Config(format!("FTP login failed: {err}")))?;
        let mut live = LiveFtp::Plain(ftp);
        cwd_root(&mut live, &params.root).await?;
        return Ok(live);
    }

    match try_secure(&addr, &params.host, false).await {
        Ok((mut ftp, _)) => {
            ftp.login(user, &params.password)
                .await
                .map_err(|err| AppError::Config(format!("FTP login failed: {err}")))?;
            let mut live = LiveFtp::Tls(ftp);
            cwd_root(&mut live, &params.root).await?;
            return Ok(live);
        }
        Err(_) => {}
    }

    let (mut ftp, der) = try_secure(&addr, &params.host, true).await?;
    let der = der.ok_or_else(|| {
        AppError::Config("FTP TLS connected but server certificate was unavailable".into())
    })?;
    ensure_certificate_trusted(
        app,
        trust,
        &params.host,
        params.port,
        &der,
        target_window_label,
    )
    .await?;
    ftp.login(user, &params.password)
        .await
        .map_err(|err| AppError::Config(format!("FTP login failed: {err}")))?;
    let mut live = LiveFtp::Tls(ftp);
    cwd_root(&mut live, &params.root).await?;
    Ok(live)
}

async fn connect_plain(addr: &str) -> AppResult<AsyncFtpStream> {
    let mut ftp = AsyncFtpStream::connect(addr)
        .await
        .map_err(|err| AppError::Config(format!("FTP connect failed: {err}")))?;
    let _ = ftp.set_mode(Mode::Passive);
    Ok(ftp)
}

async fn try_secure(
    addr: &str,
    host: &str,
    accept_invalid: bool,
) -> AppResult<(AsyncRustlsFtpStream, Option<Vec<u8>>)> {
    let mut ftp = AsyncRustlsFtpStream::connect(addr)
        .await
        .map_err(|err| AppError::Config(format!("FTP connect failed: {err}")))?;
    let _ = ftp.set_mode(Mode::Passive);
    let captured = Arc::new(std::sync::Mutex::new(None));
    let config = if accept_invalid {
        danger_client_config(captured.clone())?
    } else {
        system_client_config()?
    };
    let connector = tokio_rustls::TlsConnector::from(Arc::new(config));
    let ftp = ftp
        .into_secure(AsyncRustlsConnector::from(connector), host)
        .await
        .map_err(|err| AppError::Config(format!("FTP TLS handshake failed: {err}")))?;
    let der = captured.lock().ok().and_then(|guard| guard.clone());
    Ok((ftp, der))
}

fn rustls_provider() -> Arc<rustls::crypto::CryptoProvider> {
    Arc::new(rustls::crypto::ring::default_provider())
}

fn system_client_config() -> AppResult<ClientConfig> {
    let mut roots = RootCertStore::empty();
    let native = rustls_native_certs::load_native_certs();
    for cert in native.certs {
        let _ = roots.add(cert);
    }
    ClientConfig::builder_with_provider(rustls_provider())
        .with_safe_default_protocol_versions()
        .map_err(|err| AppError::Config(format!("FTP TLS config failed: {err}")))
        .map(|builder| {
            builder
                .with_root_certificates(roots)
                .with_no_client_auth()
        })
}

fn danger_client_config(
    captured: Arc<std::sync::Mutex<Option<Vec<u8>>>>,
) -> AppResult<ClientConfig> {
    let verifier = Arc::new(StoringAcceptAll { captured });
    ClientConfig::builder_with_provider(rustls_provider())
        .with_safe_default_protocol_versions()
        .map_err(|err| AppError::Config(format!("FTP TLS config failed: {err}")))
        .map(|builder| {
            builder
                .dangerous()
                .with_custom_certificate_verifier(verifier)
                .with_no_client_auth()
        })
}

#[derive(Debug)]
struct StoringAcceptAll {
    captured: Arc<std::sync::Mutex<Option<Vec<u8>>>>,
}

impl ServerCertVerifier for StoringAcceptAll {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        if let Ok(mut guard) = self.captured.lock() {
            *guard = Some(end_entity.as_ref().to_vec());
        }
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        rustls::crypto::ring::default_provider()
            .signature_verification_algorithms
            .supported_schemes()
    }
}

async fn ensure_certificate_trusted(
    app: &AppHandle,
    trust: &FtpTrustState,
    host: &str,
    port: u16,
    der: &[u8],
    target_window_label: Option<String>,
) -> AppResult<()> {
    let fingerprint = ftp_certificate_fingerprint(der);
    let metadata = parse_ftp_certificate_metadata(der);
    let host_key = host.trim().to_ascii_lowercase();
    {
        let once = trust.once_trusted.lock().await;
        if once.contains(&(host_key.clone(), port, fingerprint.clone())) {
            return Ok(());
        }
    }
    let status = crate::storage::check_ftp_known_host(host, port, &fingerprint)?;
    if matches!(status, KnownHostCheck::Match) {
        return Ok(());
    }

    let request_id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = oneshot::channel();
    trust
        .pending_certificates
        .lock()
        .await
        .insert(request_id.clone(), tx);
    let payload = FtpCertificateVerifyEvent {
        request_id: request_id.clone(),
        host: host.to_string(),
        port,
        fingerprint: fingerprint.clone(),
        subject: metadata.subject.clone(),
        issuer: metadata.issuer.clone(),
        valid_from: metadata.valid_from.clone(),
        valid_to: metadata.valid_to.clone(),
        known_host_status: known_host_status_label(status).to_string(),
        target_window_label,
    };
    let _ = app.emit("ftp-certificate-verify", payload);
    let decision = match tokio::time::timeout(CERTIFICATE_PROMPT_TIMEOUT, rx).await {
        Ok(Ok(decision)) => decision,
        _ => {
            trust.pending_certificates.lock().await.remove(&request_id);
            return Err(AppError::Auth("FTP certificate rejected".into()));
        }
    };
    if !decision.accepted {
        return Err(AppError::Auth("FTP certificate rejected".into()));
    }
    if decision.remember {
        crate::storage::upsert_ftp_known_host(host, port, &fingerprint, metadata)?;
    } else {
        trust
            .once_trusted
            .lock()
            .await
            .insert((host_key, port, fingerprint));
    }
    Ok(())
}

fn ftp_certificate_fingerprint(der: &[u8]) -> String {
    let digest = Sha256::digest(der);
    format!("SHA256:{}", hex::encode(digest))
}

fn parse_ftp_certificate_metadata(der: &[u8]) -> FtpCertificateMetadata {
    let Ok(cert) = x509_cert::Certificate::from_der(der) else {
        return FtpCertificateMetadata::default();
    };
    FtpCertificateMetadata {
        subject: Some(cert.tbs_certificate.subject.to_string()),
        issuer: Some(cert.tbs_certificate.issuer.to_string()),
        valid_from: Some(cert.tbs_certificate.validity.not_before.to_string()),
        valid_to: Some(cert.tbs_certificate.validity.not_after.to_string()),
    }
}

fn known_host_status_label(status: KnownHostCheck) -> &'static str {
    match status {
        KnownHostCheck::Match => "match",
        KnownHostCheck::HostSeen => "changed",
        KnownHostCheck::UnknownHost => "unknown",
    }
}

async fn cwd_root(ftp: &mut LiveFtp, root: &str) -> AppResult<()> {
    if !root.is_empty() && root != "/" {
        ftp_cwd(ftp, root).await?;
    }
    Ok(())
}

fn map_ftp<T, E: std::fmt::Display>(result: Result<T, E>) -> AppResult<T> {
    result.map_err(|err| AppError::Config(format!("FTP error: {err}")))
}

async fn ftp_cwd(ftp: &mut LiveFtp, path: &str) -> AppResult<()> {
    let path = normalize_ftp_object_key(path);
    match ftp {
        LiveFtp::Plain(s) => map_ftp(s.cwd(&path).await),
        LiveFtp::Tls(s) => map_ftp(s.cwd(&path).await),
    }
}

async fn ftp_list(ftp: &mut LiveFtp, path: &str) -> AppResult<Vec<FileEntry>> {
    let prefix = normalize_ftp_object_key(path);
    let lines = match ftp {
        LiveFtp::Plain(s) => map_ftp(s.list(Some(&prefix)).await)?,
        LiveFtp::Tls(s) => map_ftp(s.list(Some(&prefix)).await)?,
    };
    let mut result = Vec::new();
    for line in lines {
        let Ok(file) = File::from_str(&line) else {
            continue;
        };
        let name = file.name().trim_end_matches('/').to_string();
        if name.is_empty() || name == "." || name == ".." {
            continue;
        }
        let is_dir = file.is_directory();
        let mtime = file
            .modified()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        result.push(FileEntry {
            name,
            is_dir,
            is_symlink: file.is_symlink(),
            size: file.size() as u64,
            permissions: if is_dir {
                "drwxr-xr-x".into()
            } else {
                "-rw-r--r--".into()
            },
            owner: String::new(),
            group: String::new(),
            mtime,
            raw_path_token: None,
        });
    }
    result.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(result)
}

async fn ftp_mkdir(ftp: &mut LiveFtp, path: &str) -> AppResult<()> {
    let key = normalize_ftp_object_key(path);
    match ftp {
        LiveFtp::Plain(s) => map_ftp(s.mkdir(&key).await),
        LiveFtp::Tls(s) => map_ftp(s.mkdir(&key).await),
    }
}

async fn ftp_create_file(ftp: &mut LiveFtp, path: &str) -> AppResult<()> {
    let key = normalize_ftp_object_key(path);
    let mut cursor = Cursor::new(Vec::<u8>::new());
    match ftp {
        LiveFtp::Plain(s) => {
            map_ftp(s.put_file(&key, &mut cursor).await)?;
        }
        LiveFtp::Tls(s) => {
            map_ftp(s.put_file(&key, &mut cursor).await)?;
        }
    }
    Ok(())
}

async fn ftp_rename(ftp: &mut LiveFtp, old_path: &str, new_path: &str) -> AppResult<()> {
    let src = normalize_ftp_object_key(old_path);
    let dst = normalize_ftp_object_key(new_path);
    match ftp {
        LiveFtp::Plain(s) => map_ftp(s.rename(&src, &dst).await),
        LiveFtp::Tls(s) => map_ftp(s.rename(&src, &dst).await),
    }
}

fn ftp_delete<'a>(
    ftp: &'a mut LiveFtp,
    path: &'a str,
    is_dir: bool,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = AppResult<()>> + Send + 'a>> {
    Box::pin(async move {
        let key = normalize_ftp_object_key(path);
        if is_dir {
            let entries = ftp_list(ftp, &key).await?;
            for entry in entries {
                let child = format!("{}/{}", key.trim_end_matches('/'), entry.name);
                ftp_delete(ftp, &child, entry.is_dir).await?;
            }
            match ftp {
                LiveFtp::Plain(s) => map_ftp(s.rmdir(&key).await),
                LiveFtp::Tls(s) => map_ftp(s.rmdir(&key).await),
            }
        } else {
            match ftp {
                LiveFtp::Plain(s) => map_ftp(s.rm(&key).await),
                LiveFtp::Tls(s) => map_ftp(s.rm(&key).await),
            }
        }
    })
}

async fn ftp_quit(ftp: &mut LiveFtp) {
    match ftp {
        LiveFtp::Plain(s) => {
            let _ = s.quit().await;
        }
        LiveFtp::Tls(s) => {
            let _ = s.quit().await;
        }
    }
}

async fn ftp_upload_file(
    ftp: &mut LiveFtp,
    local_path: &str,
    remote_path: &str,
    app: Option<&AppHandle>,
    transfer_id: Option<&str>,
    session_id: &str,
) -> AppResult<()> {
    let key = normalize_ftp_object_key(remote_path);
    let file_name = local_path
        .rsplit(['/', '\\'])
        .find(|segment| !segment.is_empty())
        .unwrap_or(local_path)
        .to_string();
    let metadata = tokio::fs::metadata(local_path)
        .await
        .map_err(|err| AppError::Config(format!("Failed to read local file: {err}")))?;
    let total_size = metadata.len();
    let mut source = tokio::fs::File::open(local_path)
        .await
        .map_err(|err| AppError::Config(format!("Failed to open local file: {err}")))?;
    let emit = make_emitter(
        app,
        transfer_id,
        session_id,
        &file_name,
        remote_path,
        local_path,
        "upload",
        "file",
        total_size,
    );
    if let Some(emitter) = emit.as_ref() {
        emitter.emit_status("started", 0, None);
    }

    let mut data = Vec::new();
    source
        .read_to_end(&mut data)
        .await
        .map_err(|err| AppError::Config(format!("Failed to read local file: {err}")))?;
    let mut cursor = Cursor::new(data);
    let result = match ftp {
        LiveFtp::Plain(s) => map_ftp(s.put_file(&key, &mut cursor).await).map(|_| ()),
        LiveFtp::Tls(s) => map_ftp(s.put_file(&key, &mut cursor).await).map(|_| ()),
    };
    match result {
        Ok(()) => {
            if let Some(emitter) = emit.as_ref() {
                emitter.emit_status("completed", total_size, None);
            }
            Ok(())
        }
        Err(err) => {
            let message = err.to_string();
            if let Some(emitter) = emit.as_ref() {
                emitter.emit_status("error", 0, Some(message.clone()));
            }
            Err(AppError::Config(message))
        }
    }
}

async fn ftp_download_file(
    ftp: &mut LiveFtp,
    remote_path: &str,
    local_path: &str,
    app: Option<&AppHandle>,
    transfer_id: Option<&str>,
    session_id: &str,
) -> AppResult<()> {
    let key = normalize_ftp_object_key(remote_path);
    let file_name = key
        .rsplit('/')
        .find(|segment| !segment.is_empty())
        .unwrap_or(remote_path)
        .to_string();
    if let Some(parent) = Path::new(local_path).parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|err| AppError::Config(format!("Failed to create local dir: {err}")))?;
    }
    let mut target = tokio::fs::File::create(local_path)
        .await
        .map_err(|err| AppError::Config(format!("Failed to create local file: {err}")))?;
    let emit = make_emitter(
        app,
        transfer_id,
        session_id,
        &file_name,
        remote_path,
        local_path,
        "download",
        "file",
        0,
    );
    if let Some(emitter) = emit.as_ref() {
        emitter.emit_status("started", 0, None);
    }

    let result: AppResult<u64> = async {
        let transferred = match ftp {
            LiveFtp::Plain(s) => copy_retr_plain(s, &key, &mut target, emit.as_ref()).await?,
            LiveFtp::Tls(s) => copy_retr_tls(s, &key, &mut target, emit.as_ref()).await?,
        };
        target
            .flush()
            .await
            .map_err(|err| AppError::Config(format!("Failed to flush local file: {err}")))?;
        Ok(transferred)
    }
    .await;

    match result {
        Ok(transferred) => {
            if let Some(emitter) = emit.as_ref() {
                emitter.emit_status("completed", transferred, None);
            }
            Ok(())
        }
        Err(err) => {
            let _ = tokio::fs::remove_file(local_path).await;
            let message = err.to_string();
            if let Some(emitter) = emit.as_ref() {
                emitter.emit_status("error", 0, Some(message.clone()));
            }
            Err(AppError::Config(message))
        }
    }
}

async fn copy_retr_plain(
    ftp: &mut AsyncFtpStream,
    key: &str,
    target: &mut tokio::fs::File,
    emit: Option<&FtpEmitter<'_>>,
) -> AppResult<u64> {
    let mut stream = map_ftp(ftp.retr_as_stream(key).await)?;
    let mut buf = vec![0u8; FTP_CHUNK_SIZE.min(64 * 1024)];
    let mut transferred = 0u64;
    let mut last_progress = Instant::now();
    loop {
        let read = AsyncReadExt::read(&mut stream, &mut buf)
            .await
            .map_err(|err| AppError::Config(format!("Failed to read FTP file: {err}")))?;
        if read == 0 {
            break;
        }
        target
            .write_all(&buf[..read])
            .await
            .map_err(|err| AppError::Config(format!("Failed to write local file: {err}")))?;
        transferred = transferred.saturating_add(read as u64);
        if let Some(emitter) = emit {
            if last_progress.elapsed() >= FTP_PROGRESS_INTERVAL {
                last_progress = Instant::now();
                emitter.emit_status("progress", transferred, None);
            }
        }
    }
    map_ftp(ftp.finalize_retr_stream(stream).await)?;
    Ok(transferred)
}

async fn copy_retr_tls(
    ftp: &mut AsyncRustlsFtpStream,
    key: &str,
    target: &mut tokio::fs::File,
    emit: Option<&FtpEmitter<'_>>,
) -> AppResult<u64> {
    let mut stream = map_ftp(ftp.retr_as_stream(key).await)?;
    let mut buf = vec![0u8; FTP_CHUNK_SIZE.min(64 * 1024)];
    let mut transferred = 0u64;
    let mut last_progress = Instant::now();
    loop {
        let read = AsyncReadExt::read(&mut stream, &mut buf)
            .await
            .map_err(|err| AppError::Config(format!("Failed to read FTP file: {err}")))?;
        if read == 0 {
            break;
        }
        target
            .write_all(&buf[..read])
            .await
            .map_err(|err| AppError::Config(format!("Failed to write local file: {err}")))?;
        transferred = transferred.saturating_add(read as u64);
        if let Some(emitter) = emit {
            if last_progress.elapsed() >= FTP_PROGRESS_INTERVAL {
                last_progress = Instant::now();
                emitter.emit_status("progress", transferred, None);
            }
        }
    }
    map_ftp(ftp.finalize_retr_stream(stream).await)?;
    Ok(transferred)
}

fn ftp_download_directory<'a>(
    ftp: &'a mut LiveFtp,
    remote_path: &'a str,
    local_path: &'a str,
    app: Option<&'a AppHandle>,
    transfer_id: Option<&'a str>,
    session_id: &'a str,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = AppResult<()>> + Send + 'a>> {
    Box::pin(async move {
        let session_id_owned = session_id.to_string();
        let display_name = remote_path
            .rsplit('/')
            .find(|s| !s.is_empty())
            .unwrap_or(remote_path)
            .to_string();
        let emit = make_emitter(
            app,
            transfer_id,
            &session_id_owned,
            &display_name,
            remote_path,
            local_path,
            "download",
            "directory",
            0,
        );
        if let Some(emitter) = emit.as_ref() {
            emitter.emit_status("started", 0, None);
        }
        tokio::fs::create_dir_all(local_path)
            .await
            .map_err(|err| AppError::Config(format!("Failed to create local dir: {err}")))?;
        let result = download_dir_tree(ftp, remote_path, Path::new(local_path)).await;
        match result {
            Ok(()) => {
                if let Some(emitter) = emit.as_ref() {
                    emitter.emit_status("completed", 0, None);
                }
                Ok(())
            }
            Err(err) => {
                let message = err.to_string();
                if let Some(emitter) = emit.as_ref() {
                    emitter.emit_status("error", 0, Some(message.clone()));
                }
                Err(AppError::Config(message))
            }
        }
    })
}

fn download_dir_tree<'a>(
    ftp: &'a mut LiveFtp,
    remote_path: &'a str,
    local_dir: &'a Path,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = AppResult<()>> + Send + 'a>> {
    Box::pin(async move {
        let entries = ftp_list(ftp, remote_path).await?;
        for entry in entries {
            let remote = format!(
                "{}/{}",
                normalize_ftp_object_key(remote_path).trim_end_matches('/'),
                entry.name
            );
            let local = local_dir.join(&entry.name);
            if entry.is_dir {
                tokio::fs::create_dir_all(&local)
                    .await
                    .map_err(|err| AppError::Config(format!("Failed to create local dir: {err}")))?;
                download_dir_tree(ftp, &remote, &local).await?;
            } else {
                ftp_download_file(
                    ftp,
                    &remote,
                    local.to_string_lossy().as_ref(),
                    None,
                    None,
                    "",
                )
                .await?;
            }
        }
        Ok(())
    })
}

struct FtpEmitter<'a> {
    app: &'a AppHandle,
    base: FtpTransferEvent,
}

impl<'a> FtpEmitter<'a> {
    fn emit_status(&self, status: &str, bytes_transferred: u64, error_msg: Option<String>) {
        let mut event = self.base.clone();
        event.status = status.to_string();
        event.bytes_transferred = bytes_transferred;
        event.error_msg = error_msg;
        let _ = self.app.emit("transfer-event", &event);
    }
}

fn make_emitter<'a>(
    app: Option<&'a AppHandle>,
    transfer_id: Option<&'a str>,
    session_id: &str,
    file_name: &str,
    remote_path: &str,
    local_path: &str,
    direction: &str,
    kind: &str,
    total_size: u64,
) -> Option<FtpEmitter<'a>> {
    let (app, id) = match (app, transfer_id) {
        (Some(app), Some(id)) if !id.is_empty() => (app, id),
        _ => return None,
    };
    Some(FtpEmitter {
        app,
        base: FtpTransferEvent {
            id: id.to_string(),
            session_id: session_id.to_string(),
            file_name: file_name.to_string(),
            remote_path: remote_path.to_string(),
            local_path: local_path.to_string(),
            direction: direction.to_string(),
            kind: kind.to_string(),
            status: String::new(),
            size: 0,
            bytes_transferred: 0,
            total_size,
            parent_id: None,
            item_count_total: None,
            item_count_completed: None,
            error_msg: None,
        },
    })
}

fn load_ftp_connection(connection_id: &str) -> AppResult<SavedConnection> {
    let mut conn = crate::storage::get_connection(connection_id)?.ok_or_else(|| {
        AppError::SessionNotFound(format!("Connection '{connection_id}' not found"))
    })?;
    decrypt_ftp_secrets_in_place(&mut conn)?;
    if !matches!(conn.config, ConnectionType::Ftp { .. }) {
        return Err(AppError::Config("Connection is not an FTP type".into()));
    }
    Ok(conn)
}

pub fn decrypt_ftp_secrets_in_place(conn: &mut SavedConnection) -> AppResult<()> {
    let ConnectionType::Ftp {
        username,
        password,
        ..
    } = &mut conn.config
    else {
        return Ok(());
    };
    *username = decrypt_optional(username.take())?;
    *password = decrypt_optional(password.take())?;
    Ok(())
}

fn decrypt_optional(value: Option<String>) -> AppResult<Option<String>> {
    match value {
        Some(cipher) if !cipher.is_empty() => Ok(Some(crypto::decrypt(&cipher)?)),
        other => Ok(other),
    }
}

fn connect_params_from_connection(connection: &SavedConnection) -> AppResult<FtpConnectParams> {
    let ConnectionType::Ftp {
        host,
        port,
        root,
        username,
        password,
        use_tls,
        ..
    } = &connection.config
    else {
        return Err(AppError::Config("Connection is not an FTP type".into()));
    };
    Ok(FtpConnectParams {
        host: host.clone(),
        port: *port,
        root: root.clone(),
        username: username.clone().unwrap_or_default(),
        password: password.clone().unwrap_or_default(),
        use_tls: *use_tls,
    })
}

fn is_ftp_root(path: &str) -> bool {
    let trimmed = path.trim();
    trimmed.is_empty() || trimmed == "/"
}

fn ftp_parent_and_name(path: &str) -> Option<(String, String)> {
    let trimmed = path.trim().trim_end_matches('/');
    if trimmed.is_empty() || trimmed == "/" {
        return None;
    }
    let name = trimmed
        .rsplit('/')
        .find(|segment| !segment.is_empty())?
        .to_string();
    let parent = match trimmed.rsplit_once('/') {
        Some(("", _)) | None => "/".to_string(),
        Some((parent, _)) if parent.is_empty() => "/".to_string(),
        Some((parent, _)) => parent.to_string(),
    };
    Some((parent, name))
}

fn synthetic_dir_properties(path: &str) -> FileProperties {
    let name = path
        .trim_end_matches('/')
        .rsplit('/')
        .find(|segment| !segment.is_empty())
        .unwrap_or("/")
        .to_string();
    FileProperties {
        name,
        is_dir: true,
        is_symlink: false,
        size: 0,
        permissions: "drwxr-xr-x".into(),
        owner: String::new(),
        group: String::new(),
        uid: String::new(),
        gid: String::new(),
        mtime: 0,
        atime: 0,
    }
}

fn normalize_ftp_prefix(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.is_empty() || trimmed == "/" {
        return "/".to_string();
    }
    let mut value = trimmed.to_string();
    if !value.starts_with('/') {
        value.insert(0, '/');
    }
    if !value.ends_with('/') {
        value.push('/');
    }
    value
}

fn normalize_ftp_object_key(path: &str) -> String {
    let trimmed = path.trim().trim_end_matches('/');
    if trimmed.is_empty() || trimmed == "/" {
        return "/".to_string();
    }
    if trimmed.starts_with('/') {
        trimmed.to_string()
    } else {
        format!("/{trimmed}")
    }
}

pub fn connection_id_from_session(session_id: &str) -> Option<&str> {
    session_id.strip_prefix("ftp:")
}

pub type SharedFtpManager = Arc<FtpManager>;
