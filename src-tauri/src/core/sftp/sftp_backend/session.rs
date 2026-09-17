//! Internal pieces of the SFTP backend moved out of `sftp_backend.rs`.

use super::*;

static NEXT_SFTP_SESSION_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Clone)]
pub(super) struct SftpSessionPool {
    sessions: Arc<Vec<Arc<ManagedSftpSession>>>,
}

impl SftpSessionPool {
    pub(super) async fn new(
        backend: &SftpBackend,
        size: usize,
        config: SftpClientConfig,
        operation: &'static str,
    ) -> AppResult<Self> {
        let mut sessions = Vec::with_capacity(size);
        for _ in 0..size {
            sessions.push(Arc::new(
                backend
                    .open_sftp_with_client_config_for_operation(config.clone(), operation)
                    .await?,
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
    sftp_session_id: u64,
    operation: &'static str,
}

impl ManagedSftpSession {
    pub(super) fn new(
        inner: SftpSession,
        permit: OwnedSemaphorePermit,
        sftp_session_id: u64,
        operation: &'static str,
    ) -> Self {
        Self {
            inner,
            _permit: permit,
            sftp_session_id,
            operation,
        }
    }

    pub(super) fn sftp_session_id(&self) -> u64 {
        self.sftp_session_id
    }

    pub(super) async fn close(&self) -> Result<(), SftpError> {
        tracing::debug!(
            sftp_session_id = self.sftp_session_id,
            operation = self.operation,
            stage = "close_session",
            "SFTP session closing"
        );
        let result = self.inner.close().await;
        match &result {
            Ok(()) => tracing::debug!(
                sftp_session_id = self.sftp_session_id,
                operation = self.operation,
                stage = "close_session",
                "SFTP session closed"
            ),
            Err(error) => tracing::warn!(
                sftp_session_id = self.sftp_session_id,
                operation = self.operation,
                stage = "close_session",
                error = %error,
                stream_closed = is_sftp_stream_closed_error(error),
                "SFTP session close failed"
            ),
        }
        result
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
        tracing::debug!(operation = "probe", "SFTP probe started");
        let sftp =
            Self::open_sftp_raw(ssh_handle.clone(), SftpClientConfig::default(), "probe").await?;
        tracing::debug!(
            sftp_session_id = sftp.sftp_session_id(),
            operation = "probe",
            "SFTP probe session opened"
        );
        tracing::debug!(
            sftp_session_id = sftp.sftp_session_id(),
            operation = "probe",
            stage = "close_session",
            "SFTP probe session close requested"
        );
        let _ = sftp.close().await;
        tracing::debug!(
            sftp_session_id = sftp.sftp_session_id(),
            operation = "probe",
            "SFTP probe succeeded"
        );
        Ok(())
    }

    pub(super) async fn open_sftp_raw(
        ssh_handle: Arc<SshConnectionHandles>,
        config: SftpClientConfig,
        operation: &'static str,
    ) -> AppResult<ManagedSftpSession> {
        for attempt in 0..=SFTP_CHANNEL_OPEN_RETRY_DELAYS.len() {
            let sftp_session_id = NEXT_SFTP_SESSION_ID.fetch_add(1, Ordering::Relaxed);
            tracing::debug!(
                sftp_session_id,
                operation,
                attempt,
                stage = "acquire_permit",
                "SFTP session opening"
            );
            let permit = match ssh_handle.acquire_sftp_channel_permit().await {
                Ok(permit) => permit,
                Err(error) => {
                    tracing::warn!(
                        sftp_session_id,
                        operation,
                        attempt,
                        stage = "acquire_permit",
                        error = %error,
                        "SFTP session setup failed"
                    );
                    return Err(error);
                }
            };
            let setup_result = tokio::time::timeout(SFTP_SESSION_SETUP_TIMEOUT, async {
                let channel_result = {
                    let handle_mtx = ssh_handle.target_handle();
                    let handle = handle_mtx.lock().await;
                    handle.channel_open_session().await
                };
                let channel = match channel_result {
                    Ok(channel) => {
                        tracing::debug!(
                            sftp_session_id,
                            operation,
                            attempt,
                            stage = "channel_open",
                            "SSH session channel opened for SFTP"
                        );
                        channel
                    }
                    Err(error) => {
                        tracing::warn!(
                            sftp_session_id,
                            operation,
                            attempt,
                            stage = "channel_open",
                            error = %error,
                            "SFTP session setup failed"
                        );
                        return Ok(Err(error));
                    }
                };

                if let Err(error) = channel.request_subsystem(true, "sftp").await {
                    let error =
                        AppError::Channel(format!("Failed to start SFTP subsystem: {}", error));
                    tracing::warn!(
                        sftp_session_id,
                        operation,
                        attempt,
                        stage = "request_subsystem",
                        error = %error,
                        "SFTP session setup failed"
                    );
                    return Err(error);
                }
                tracing::debug!(
                    sftp_session_id,
                    operation,
                    attempt,
                    stage = "request_subsystem",
                    "SFTP subsystem request accepted"
                );

                let sftp = match SftpSession::new_with_config(channel.into_stream(), config.clone())
                    .await
                {
                    Ok(sftp) => sftp,
                    Err(error) => {
                        tracing::warn!(
                            sftp_session_id,
                            operation,
                            attempt,
                            stage = "sftp_client_init",
                            error = %error,
                            stream_closed = is_sftp_stream_closed_error(&error),
                            "SFTP session setup failed"
                        );
                        return Err(error.into());
                    }
                };
                tracing::debug!(
                    sftp_session_id,
                    operation,
                    attempt,
                    stage = "sftp_client_init",
                    "SFTP client initialized"
                );
                AppResult::Ok(Ok(ManagedSftpSession::new(
                    sftp,
                    permit,
                    sftp_session_id,
                    operation,
                )))
            })
            .await;
            let setup_result = match setup_result {
                Ok(Ok(result)) => result,
                Ok(Err(error)) => return Err(error),
                Err(_) => {
                    let error = AppError::Channel(
                        "SFTP session setup timed out after 10 seconds".to_string(),
                    );
                    tracing::warn!(
                        sftp_session_id,
                        operation,
                        attempt,
                        stage = "setup_timeout",
                        error = %error,
                        "SFTP session setup failed"
                    );
                    return Err(error);
                }
            };

            match setup_result {
                Ok(session) => {
                    tracing::debug!(
                        sftp_session_id,
                        operation,
                        attempt,
                        stage = "ready",
                        "SFTP session ready"
                    );
                    return Ok(session);
                }
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
        self.open_sftp_for_operation("business").await
    }

    pub(super) async fn open_sftp_for_operation(
        &self,
        operation: &'static str,
    ) -> AppResult<ManagedSftpSession> {
        Self::open_sftp_raw(
            self.ssh_handle.clone(),
            SftpClientConfig::default(),
            operation,
        )
        .await
    }

    pub(super) async fn open_sftp_with_client_config(
        &self,
        config: SftpClientConfig,
    ) -> AppResult<ManagedSftpSession> {
        self.open_sftp_with_client_config_for_operation(config, "business")
            .await
    }

    pub(super) async fn open_sftp_with_client_config_for_operation(
        &self,
        config: SftpClientConfig,
        operation: &'static str,
    ) -> AppResult<ManagedSftpSession> {
        Self::open_sftp_raw(self.ssh_handle.clone(), config, operation).await
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
