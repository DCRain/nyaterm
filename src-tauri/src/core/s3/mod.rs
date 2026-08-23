//! S3 object storage file-browser backend (opendal).

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

use opendal::layers::{RetryLayer, TimeoutLayer, TracingLayer};
use opendal::services::S3;
use opendal::{EntryMode, ErrorKind, Operator};
use serde::Serialize;
use tauri::AppHandle;
use tauri::Emitter;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex;

use crate::config::{ConnectionType, SavedConnection};
use crate::core::sftp::{DirectoryChild, FileEntry, FileProperties};
use crate::error::{AppError, AppResult};
use crate::utils::crypto;
use crate::utils::url::normalize_storage_endpoint;

const S3_PROGRESS_INTERVAL: Duration = Duration::from_millis(50);
const S3_CHUNK_SIZE: usize = 512 * 1024; // 512 KiB per chunk

/// Lightweight transfer progress event emitted to the frontend. Mirrors the
/// shape of `crate::core::sftp::transfer::TransferEvent` so the existing
/// `TransferContext` and file-explorer listeners can consume it unchanged.
#[derive(Debug, Clone, Serialize)]
pub struct S3TransferEvent {
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

/// In-memory S3 operator cache keyed by connection id.
pub struct S3Manager {
    operators: Mutex<HashMap<String, Operator>>,
}

impl S3Manager {
    pub fn new() -> Self {
        Self {
            operators: Mutex::new(HashMap::new()),
        }
    }

    async fn operator_for(&self, connection_id: &str) -> AppResult<Operator> {
        {
            let guard = self.operators.lock().await;
            if let Some(op) = guard.get(connection_id) {
                return Ok(op.clone());
            }
        }

        let connection = load_s3_connection(connection_id)?;
        let operator = build_operator_from_connection(&connection)?;
        let mut guard = self.operators.lock().await;
        guard.insert(connection_id.to_string(), operator.clone());
        Ok(operator)
    }

    pub async fn invalidate(&self, connection_id: &str) {
        self.operators.lock().await.remove(connection_id);
    }

    pub async fn list_dir(&self, connection_id: &str, path: &str) -> AppResult<Vec<FileEntry>> {
        let op = self.operator_for(connection_id).await?;
        let prefix = normalize_s3_prefix(path);
        let entries = op.list(&prefix).await.map_err(map_opendal_error)?;
        let mut result = Vec::new();
        for entry in entries {
            let meta = entry.metadata();
            let name = entry.name().trim_end_matches('/').to_string();
            if name.is_empty() || name == "." || name == ".." {
                continue;
            }
            let is_dir = matches!(meta.mode(), EntryMode::DIR);
            result.push(FileEntry {
                name,
                is_dir,
                is_symlink: false,
                size: meta.content_length(),
                permissions: if is_dir {
                    "drwxr-xr-x".into()
                } else {
                    "-rw-r--r--".into()
                },
                owner: String::new(),
                group: String::new(),
                mtime: meta
                    .last_modified()
                    .map(|t| t.into_inner().as_second().max(0) as u64)
                    .unwrap_or(0),
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

    pub async fn file_properties(
        &self,
        connection_id: &str,
        path: &str,
        is_directory: bool,
    ) -> AppResult<FileProperties> {
        let op = self.operator_for(connection_id).await?;
        if is_directory {
            let key = normalize_s3_dir_key(path);
            match op.stat(&key).await {
                Ok(meta) => Ok(storage_file_properties(path, &meta, true)),
                Err(error) if error.kind() == ErrorKind::NotFound => {
                    Ok(synthetic_dir_properties(path))
                }
                Err(error) => Err(map_opendal_error(error)),
            }
        } else {
            let key = normalize_s3_object_key(path);
            let meta = op.stat(&key).await.map_err(map_opendal_error)?;
            Ok(storage_file_properties(path, &meta, false))
        }
    }

    pub async fn list_child_directories(
        &self,
        connection_id: &str,
        path: &str,
        show_hidden: bool,
    ) -> AppResult<Vec<DirectoryChild>> {
        let entries = self.list_dir(connection_id, path).await?;
        let base = normalize_s3_prefix(path);
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

    pub async fn create_dir(&self, connection_id: &str, path: &str) -> AppResult<()> {
        let op = self.operator_for(connection_id).await?;
        let key = normalize_s3_dir_key(path);
        op.create_dir(&key).await.map_err(map_opendal_error)
    }

    pub async fn create_file(&self, connection_id: &str, path: &str) -> AppResult<()> {
        let op = self.operator_for(connection_id).await?;
        let key = normalize_s3_object_key(path);
        op.write(&key, Vec::<u8>::new())
            .await
            .map_err(map_opendal_error)?;
        Ok(())
    }

    pub async fn delete(&self, connection_id: &str, path: &str, is_dir: bool) -> AppResult<()> {
        let op = self.operator_for(connection_id).await?;
        if is_dir {
            let prefix = normalize_s3_dir_key(path);
            op.delete_with(&prefix)
                .recursive(true)
                .await
                .map_err(map_opendal_error)
        } else {
            let key = normalize_s3_object_key(path);
            op.delete(&key).await.map_err(map_opendal_error)
        }
    }

    pub async fn rename(
        &self,
        connection_id: &str,
        old_path: &str,
        new_path: &str,
    ) -> AppResult<()> {
        let op = self.operator_for(connection_id).await?;
        let src = normalize_s3_object_key(old_path);
        let dst = normalize_s3_object_key(new_path);
        // Prefer rename; fall back to copy+delete for providers without rename.
        match op.rename(&src, &dst).await {
            Ok(()) => Ok(()),
            Err(_) => {
                op.copy(&src, &dst).await.map_err(map_opendal_error)?;
                op.delete(&src).await.map_err(map_opendal_error)
            }
        }
    }

    pub async fn upload_file(
        &self,
        connection_id: &str,
        local_path: &str,
        remote_path: &str,
    ) -> AppResult<()> {
        self.upload_file_with_progress(connection_id, local_path, remote_path, None, None)
            .await
    }

    /// Upload a single file with chunked progress reporting.
    /// `app` and `transfer_id` are required to emit `transfer-event` updates.
    pub async fn upload_file_with_progress(
        &self,
        connection_id: &str,
        local_path: &str,
        remote_path: &str,
        app: Option<&AppHandle>,
        transfer_id: Option<&str>,
    ) -> AppResult<()> {
        let op = self.operator_for(connection_id).await?;
        let key = normalize_s3_object_key(remote_path);
        let file_name = local_path
            .rsplit(['/', '\\'])
            .find(|segment| !segment.is_empty())
            .unwrap_or(local_path)
            .to_string();

        let session_id = format!("s3:{connection_id}");

        let metadata = tokio::fs::metadata(local_path)
            .await
            .map_err(|err| AppError::Config(format!("Failed to read local file: {err}")))?;
        let total_size = metadata.len();

        let mut source = tokio::fs::File::open(local_path)
            .await
            .map_err(|err| AppError::Config(format!("Failed to open local file: {err}")))?;

        let emit = make_emitter(app, transfer_id, &session_id, &file_name, remote_path, local_path, "upload", "file", total_size);

        if let Some(emitter) = emit.as_ref() {
            emitter.emit_status("started", 0, None);
        }

        let result: AppResult<u64> = async {
            let mut writer = op.writer_with(&key).await.map_err(map_opendal_error)?;
            let mut buffer = vec![0u8; S3_CHUNK_SIZE];
            let mut transferred: u64 = 0;
            let mut last_progress = Instant::now();
            loop {
                let read = source
                    .read(&mut buffer)
                    .await
                    .map_err(|err| AppError::Config(format!("Failed to read local file: {err}")))?;
                if read == 0 {
                    break;
                }
                writer
                    .write(opendal::Buffer::from(buffer[..read].to_vec()))
                    .await
                    .map_err(map_opendal_error)?;
                transferred = transferred.saturating_add(read as u64);
                if let Some(emitter) = emit.as_ref() {
                    if last_progress.elapsed() >= S3_PROGRESS_INTERVAL {
                        last_progress = Instant::now();
                        emitter.emit_status("progress", transferred, None);
                    }
                }
            }
            writer.close().await.map_err(map_opendal_error)?;
            Ok(transferred)
        }
        .await;

        match &result {
            Ok(transferred) => {
                if let Some(emitter) = emit.as_ref() {
                    emitter.emit_status("completed", *transferred, None);
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

    #[allow(dead_code)]
    pub async fn download_file(
        &self,
        connection_id: &str,
        remote_path: &str,
        local_path: &str,
    ) -> AppResult<()> {
        self.download_file_with_progress(connection_id, remote_path, local_path, None, None)
            .await
    }

    pub async fn download_file_with_progress(
        &self,
        connection_id: &str,
        remote_path: &str,
        local_path: &str,
        app: Option<&AppHandle>,
        transfer_id: Option<&str>,
    ) -> AppResult<()> {
        let op = self.operator_for(connection_id).await?;
        let key = normalize_s3_object_key(remote_path);
        let file_name = key
            .rsplit('/')
            .find(|segment| !segment.is_empty())
            .unwrap_or(remote_path)
            .to_string();

        let session_id = format!("s3:{connection_id}");

        // Pre-create the local file and stream into it so we can report progress
        // while the download is in flight.
        if let Some(parent) = Path::new(local_path).parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|err| AppError::Config(format!("Failed to create local dir: {err}")))?;
        }
        let mut target = tokio::fs::File::create(local_path)
            .await
            .map_err(|err| AppError::Config(format!("Failed to create local file: {err}")))?;

        // Total size is optional for S3; we still report bytes_transferred on
        // each progress tick so the UI can show indeterminate progress.
        let total_size = op.stat(&key).await.map(|m| m.content_length()).unwrap_or(0);
        let emit = make_emitter(app, transfer_id, &session_id, &file_name, remote_path, local_path, "download", "file", total_size);
        if let Some(emitter) = emit.as_ref() {
            emitter.emit_status("started", 0, None);
        }

        let result: AppResult<u64> = async {
            let reader = op
                .reader(&key)
                .await
                .map_err(map_opendal_error)?
                .into_futures_async_read(0..)
                .await
                .map_err(map_opendal_error)?;
            let mut reader = reader;
            let mut buf = vec![0u8; S3_CHUNK_SIZE];
            let mut transferred: u64 = 0;
            let mut last_progress = Instant::now();
            use futures_util::AsyncReadExt;
            loop {
                let read = reader
                    .read(&mut buf)
                    .await
                    .map_err(|err| AppError::Config(format!("Failed to read S3 object: {err}")))?;
                if read == 0 {
                    break;
                }
                target
                    .write_all(&buf[..read])
                    .await
                    .map_err(|err| AppError::Config(format!("Failed to write local file: {err}")))?;
                transferred = transferred.saturating_add(read as u64);
                if let Some(emitter) = emit.as_ref() {
                    if last_progress.elapsed() >= S3_PROGRESS_INTERVAL {
                        last_progress = Instant::now();
                        emitter.emit_status("progress", transferred, None);
                    }
                }
            }
            target.flush().await.map_err(|err| {
                AppError::Config(format!("Failed to flush local file: {err}"))
            })?;
            Ok(transferred)
        }
        .await;

        match &result {
            Ok(transferred) => {
                if let Some(emitter) = emit.as_ref() {
                    emitter.emit_status("completed", *transferred, None);
                }
                Ok(())
            }
            Err(err) => {
                // Best-effort cleanup of partial file on failure.
                let _ = tokio::fs::remove_file(local_path).await;
                let message = err.to_string();
                if let Some(emitter) = emit.as_ref() {
                    emitter.emit_status("error", 0, Some(message.clone()));
                }
                Err(AppError::Config(message))
            }
        }
    }

    #[allow(dead_code)]
    pub async fn upload_directory(
        &self,
        connection_id: &str,
        local_path: &str,
        remote_path: &str,
    ) -> AppResult<()> {
        self.upload_directory_with_progress(connection_id, local_path, remote_path, None, None)
            .await
    }

    pub async fn upload_directory_with_progress(
        &self,
        connection_id: &str,
        local_path: &str,
        remote_path: &str,
        app: Option<&AppHandle>,
        transfer_id: Option<&str>,
    ) -> AppResult<()> {
        let root = Path::new(local_path);
        let mut stack = vec![root.to_path_buf()];
        let session_id = format!("s3:{connection_id}");
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

        let result: AppResult<()> = async {
            while let Some(dir) = stack.pop() {
                let mut entries = tokio::fs::read_dir(&dir).await.map_err(|err| {
                    AppError::Config(format!("Failed to read local dir: {err}"))
                })?;
                while let Some(entry) = entries
                    .next_entry()
                    .await
                    .map_err(|err| AppError::Config(format!("Failed to read local entry: {err}")))?
                {
                    let path = entry.path();
                    let rel = path.strip_prefix(root).map_err(|err| {
                        AppError::Config(format!("Invalid relative path: {err}"))
                    })?;
                    let rel_key = rel
                        .components()
                        .map(|c| c.as_os_str().to_string_lossy())
                        .collect::<Vec<_>>()
                        .join("/");
                    let remote = if remote_path.trim_end_matches('/').is_empty()
                        || remote_path == "/"
                    {
                        format!("/{rel_key}")
                    } else {
                        format!("{}/{}", remote_path.trim_end_matches('/'), rel_key)
                    };
                    let file_type = entry.file_type().await.map_err(|err| {
                        AppError::Config(format!("Failed to stat local entry: {err}"))
                    })?;
                    if file_type.is_dir() {
                        self.create_dir(connection_id, &remote).await?;
                        stack.push(path);
                    } else if file_type.is_file() {
                        self.upload_file(connection_id, path.to_string_lossy().as_ref(), &remote)
                            .await?;
                    }
                }
            }
            Ok(())
        }
        .await;

        match &result {
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

    #[allow(dead_code)]
    pub async fn download_directory(
        &self,
        connection_id: &str,
        remote_path: &str,
        local_path: &str,
    ) -> AppResult<()> {
        self.download_directory_with_progress(
            connection_id,
            remote_path,
            local_path,
            None,
            None,
        )
        .await
    }

    pub async fn download_directory_with_progress(
        &self,
        connection_id: &str,
        remote_path: &str,
        local_path: &str,
        app: Option<&AppHandle>,
        transfer_id: Option<&str>,
    ) -> AppResult<()> {
        let op = self.operator_for(connection_id).await?;
        let prefix = normalize_s3_dir_key(remote_path);
        let entries = op
            .list_with(&prefix)
            .recursive(true)
            .await
            .map_err(map_opendal_error)?;
        tokio::fs::create_dir_all(local_path)
            .await
            .map_err(|err| AppError::Config(format!("Failed to create local dir: {err}")))?;

        let session_id = format!("s3:{connection_id}");
        let display_name = remote_path
            .rsplit('/')
            .find(|s| !s.is_empty())
            .unwrap_or(remote_path)
            .to_string();
        let emit = make_emitter(
            app,
            transfer_id,
            &session_id,
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

        let result: AppResult<()> = async {
            for entry in entries {
                let meta = entry.metadata();
                let key = entry.path().trim_start_matches('/');
                let prefix_trim = prefix.trim_start_matches('/').trim_end_matches('/');
                let rel = key
                    .strip_prefix(prefix_trim)
                    .unwrap_or(key)
                    .trim_start_matches('/');
                if rel.is_empty() {
                    continue;
                }
                let local = Path::new(local_path).join(rel);
                if matches!(meta.mode(), EntryMode::DIR) {
                    tokio::fs::create_dir_all(&local).await.map_err(|err| {
                        AppError::Config(format!("Failed to create local dir: {err}"))
                    })?;
                } else {
                    if let Some(parent) = local.parent() {
                        tokio::fs::create_dir_all(parent).await.map_err(|err| {
                            AppError::Config(format!("Failed to create local dir: {err}"))
                        })?;
                    }
                    let data = op.read(entry.path()).await.map_err(map_opendal_error)?;
                    tokio::fs::write(&local, data.to_vec()).await.map_err(|err| {
                        AppError::Config(format!("Failed to write local file: {err}"))
                    })?;
                }
            }
            Ok(())
        }
        .await;

        match &result {
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
}

struct S3Emitter<'a> {
    app: &'a AppHandle,
    base: S3TransferEvent,
}

impl<'a> S3Emitter<'a> {
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
) -> Option<S3Emitter<'a>> {
    let (app, id) = match (app, transfer_id) {
        (Some(app), Some(id)) if !id.is_empty() => (app, id),
        _ => return None,
    };
    Some(S3Emitter {
        app,
        base: S3TransferEvent {
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

impl Default for S3Manager {
    fn default() -> Self {
        Self::new()
    }
}

fn load_s3_connection(connection_id: &str) -> AppResult<SavedConnection> {
        let mut conn = crate::storage::get_connection(connection_id)?
            .ok_or_else(|| AppError::SessionNotFound(format!("Connection '{connection_id}' not found")))?;
        decrypt_s3_secrets_in_place(&mut conn)?;
        if !matches!(conn.config, ConnectionType::S3 { .. }) {
            return Err(AppError::Config("Connection is not an S3 type".into()));
        }
        Ok(conn)
}

/// Decrypt S3 connection secrets in place. Public so connection tests and
/// other modules that need a fully-resolved operator can use it.
pub fn decrypt_s3_secrets_in_place(conn: &mut SavedConnection) -> AppResult<()> {
    let ConnectionType::S3 {
        access_key_id,
        secret_access_key,
        session_token,
        ..
    } = &mut conn.config
    else {
        return Ok(());
    };
    *access_key_id = decrypt_optional(access_key_id.take())?;
    *secret_access_key = decrypt_optional(secret_access_key.take())?;
    *session_token = decrypt_optional(session_token.take())?;
    Ok(())
}

fn decrypt_optional(value: Option<String>) -> AppResult<Option<String>> {
    match value {
        Some(cipher) if !cipher.is_empty() => Ok(Some(crypto::decrypt(&cipher)?)),
        other => Ok(other),
    }
}

pub fn build_operator_from_connection(connection: &SavedConnection) -> AppResult<Operator> {
    let ConnectionType::S3 {
        endpoint,
        bucket,
        region,
        root,
        access_key_id,
        secret_access_key,
        session_token,
        virtual_host_style,
        ..
    } = &connection.config
    else {
        return Err(AppError::Config("Connection is not an S3 type".into()));
    };

    let mut builder = S3::default().bucket(bucket);
    let normalized_endpoint = normalize_storage_endpoint(endpoint);
    if !normalized_endpoint.is_empty() {
        builder = builder.endpoint(&normalized_endpoint);
    }
    if !region.trim().is_empty() {
        builder = builder.region(region);
    }
    if !root.trim().is_empty() {
        builder = builder.root(root);
    }
    if let Some(key) = access_key_id.as_deref().filter(|v| !v.is_empty()) {
        builder = builder.access_key_id(key);
    }
    if let Some(secret) = secret_access_key.as_deref().filter(|v| !v.is_empty()) {
        builder = builder.secret_access_key(secret);
    }
    if let Some(token) = session_token.as_deref().filter(|v| !v.is_empty()) {
        builder = builder.session_token(token);
    }
    if *virtual_host_style {
        builder = builder.enable_virtual_host_style();
    }

    Ok(Operator::new(builder)
        .map_err(map_opendal_error)?
        .layer(
            TimeoutLayer::new()
                .with_timeout(Duration::from_secs(60))
                .with_io_timeout(Duration::from_secs(60)),
        )
        .layer(RetryLayer::new().with_max_times(3))
        .layer(TracingLayer::new()))
}

fn normalize_s3_prefix(path: &str) -> String {
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

fn normalize_s3_dir_key(path: &str) -> String {
    normalize_s3_prefix(path)
}

fn normalize_s3_object_key(path: &str) -> String {
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

fn storage_entry_name(path: &str) -> String {
    path.trim_end_matches('/')
        .rsplit('/')
        .find(|segment| !segment.is_empty())
        .unwrap_or("/")
        .to_string()
}

fn storage_file_properties(path: &str, meta: &opendal::Metadata, is_dir: bool) -> FileProperties {
    let mtime = meta
        .last_modified()
        .map(|t| t.into_inner().as_second().max(0) as u64)
        .unwrap_or(0);
    FileProperties {
        name: storage_entry_name(path),
        is_dir,
        is_symlink: false,
        size: if is_dir { 0 } else { meta.content_length() },
        permissions: if is_dir {
            "drwxr-xr-x".into()
        } else {
            "-rw-r--r--".into()
        },
        owner: String::new(),
        group: String::new(),
        uid: String::new(),
        gid: String::new(),
        mtime,
        atime: mtime,
    }
}

fn synthetic_dir_properties(path: &str) -> FileProperties {
    FileProperties {
        name: storage_entry_name(path),
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

fn map_opendal_error(error: opendal::Error) -> AppError {
    AppError::Config(format!("S3 error: {error}"))
}

/// Resolve connection id from a synthetic S3 workspace session id (`s3:<connectionId>`).
pub fn connection_id_from_session(session_id: &str) -> Option<&str> {
    session_id.strip_prefix("s3:")
}

pub type SharedS3Manager = Arc<S3Manager>;
