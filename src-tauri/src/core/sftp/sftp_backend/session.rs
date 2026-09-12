//! Internal pieces of the SFTP backend moved out of `sftp_backend.rs`.

use super::*;

#[derive(Clone)]
pub(super) struct SftpSessionPool {
    sessions: Arc<Vec<Arc<ManagedSftpSession>>>,
}

impl SftpSessionPool {
    pub(super) async fn new(
        backend: &SftpBackend,
        size: usize,
        config: SftpClientConfig,
    ) -> AppResult<Self> {
        let mut sessions = Vec::with_capacity(size);
        for _ in 0..size {
            sessions.push(Arc::new(
                backend.open_sftp_with_client_config(config.clone()).await?,
            ));
        }
        Ok(Self {
            sessions: Arc::new(sessions),
        })
    }

    pub(super) fn session_for(&self, index: usize) -> Arc<ManagedSftpSession> {
        self.sessions[index % self.sessions.len()].clone()
    }

    pub(super) async fn close_all(self) {
        for session in self.sessions.iter() {
            let _ = session.close().await;
        }
    }
}

pub(super) struct ManagedSftpSession {
    inner: SftpSession,
    _permit: OwnedSemaphorePermit,
}

impl ManagedSftpSession {
    pub(super) fn new(inner: SftpSession, permit: OwnedSemaphorePermit) -> Self {
        Self {
            inner,
            _permit: permit,
        }
    }
}

impl Deref for ManagedSftpSession {
    type Target = SftpSession;

    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}

impl SftpBackend {
    pub(crate) async fn probe(ssh_handle: &Arc<SshConnectionHandles>) -> AppResult<()> {
        let sftp = Self::open_sftp_raw(ssh_handle.clone(), SftpClientConfig::default()).await?;
        let _ = sftp.close().await;
        Ok(())
    }

    pub(super) async fn open_sftp_raw(
        ssh_handle: Arc<SshConnectionHandles>,
        config: SftpClientConfig,
    ) -> AppResult<ManagedSftpSession> {
        for attempt in 0..=SFTP_CHANNEL_OPEN_RETRY_DELAYS.len() {
            let permit = ssh_handle.acquire_sftp_channel_permit().await?;
            let setup_result = tokio::time::timeout(SFTP_SESSION_SETUP_TIMEOUT, async {
                let channel_result = {
                    let handle_mtx = ssh_handle.target_handle();
                    let handle = handle_mtx.lock().await;
                    handle.channel_open_session().await
                };
                let channel = match channel_result {
                    Ok(channel) => channel,
                    Err(error) => return Ok(Err(error)),
                };

                channel.request_subsystem(true, "sftp").await.map_err(|e| {
                    AppError::Channel(format!("Failed to start SFTP subsystem: {}", e))
                })?;

                let sftp =
                    SftpSession::new_with_config(channel.into_stream(), config.clone()).await?;
                AppResult::Ok(Ok(ManagedSftpSession::new(sftp, permit)))
            })
            .await
            .map_err(|_| {
                AppError::Channel("SFTP session setup timed out after 10 seconds".to_string())
            })??;

            match setup_result {
                Ok(session) => return Ok(session),
                Err(error)
                    if attempt < SFTP_CHANNEL_OPEN_RETRY_DELAYS.len()
                        && is_retryable_sftp_channel_open_error(&error) =>
                {
                    tokio::time::sleep(SFTP_CHANNEL_OPEN_RETRY_DELAYS[attempt]).await;
                    continue;
                }
                Err(error) => {
                    return Err(AppError::Channel(format!(
                        "Failed to open SFTP channel: {}",
                        error
                    )));
                }
            }
        }

        unreachable!("SFTP channel open retry loop always returns or continues");
    }

    pub(super) async fn open_sftp(&self) -> AppResult<ManagedSftpSession> {
        Self::open_sftp_raw(self.ssh_handle.clone(), SftpClientConfig::default()).await
    }

    pub(super) async fn open_sftp_with_client_config(
        &self,
        config: SftpClientConfig,
    ) -> AppResult<ManagedSftpSession> {
        Self::open_sftp_raw(self.ssh_handle.clone(), config).await
    }

    pub(super) async fn exec(&self, command: &str) -> AppResult<ExecResult> {
        let handle_mtx = self.ssh_handle.target_handle();
        let mut channel = {
            let handle = handle_mtx.lock().await;
            handle
                .channel_open_session()
                .await
                .map_err(|e| AppError::Channel(format!("Failed to open exec channel: {}", e)))?
        };

        channel.exec(true, command.as_bytes()).await?;

        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let mut exit_code: Option<u32> = None;

        loop {
            match channel.wait().await {
                Some(ChannelMsg::Data { data }) => {
                    stdout.extend_from_slice(&data);
                }
                Some(ChannelMsg::ExtendedData { data, ext }) => {
                    if ext == 1 {
                        stderr.extend_from_slice(&data);
                    }
                }
                Some(ChannelMsg::ExitStatus { exit_status }) => {
                    exit_code = Some(exit_status);
                }
                Some(ChannelMsg::Eof) | None => {
                    if exit_code.is_none() {
                        if let Some(ChannelMsg::ExitStatus { exit_status }) = channel.wait().await {
                            exit_code = Some(exit_status);
                        }
                    }
                    break;
                }
                _ => {}
            }
        }

        Ok(ExecResult {
            exit_code: exit_code.unwrap_or(255),
            stdout,
            stderr,
        })
    }

    pub(super) async fn exec_ok(&self, command: &str) -> AppResult<Vec<u8>> {
        let result = self.exec(command).await?;
        if result.exit_code != 0 {
            let msg = String::from_utf8_lossy(&result.stderr);
            return Err(AppError::Channel(format!(
                "Remote command failed (exit {}): {}",
                result.exit_code,
                msg.trim()
            )));
        }
        Ok(result.stdout)
    }
}
