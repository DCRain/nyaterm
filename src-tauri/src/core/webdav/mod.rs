//! WebDAV file-browser backend (OpenDAL).

mod operator;

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

use opendal::{EntryMode, ErrorKind, Operator};

pub use self::operator::build_opendal_webdav_operator;
use serde::Serialize;
use tauri::AppHandle;
use tauri::Emitter;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex;

use crate::config::{ConnectionType, SavedConnection};
use crate::core::sftp::{DirectoryChild, FileEntry};
use crate::error::{AppError, AppResult};
use crate::utils::crypto;

const WEBDAV_PROGRESS_INTERVAL: Duration = Duration::from_millis(50);
const WEBDAV_CHUNK_SIZE: usize = 512 * 1024; // 512 KiB per chunk

/// Lightweight transfer progress event emitted to the frontend. Mirrors the
/// shape of `crate::core::sftp::transfer::TransferEvent` so the existing
/// `TransferContext` and file-explorer listeners can consume it unchanged.
#[derive(Debug, Clone, Serialize)]
pub struct WebDavTransferEvent {
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

/// In-memory WebDAV operator cache keyed by connection id.
pub struct WebDavManager {
    operators: Mutex<HashMap<String, Operator>>,
}

impl WebDavManager {
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

        let connection = load_webdav_connection(connection_id)?;
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
        let prefix = normalize_webdav_prefix(path);
        let entries = op.list(&prefix).await.map_err(map_opendal_error)?;
        let mut result = Vec::new();
        for entry in entries {
            if is_webdav_list_self_entry(&prefix, entry.path()) {
                continue;
            }
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

    pub async fn list_child_directories(
        &self,
        connection_id: &str,
        path: &str,
        show_hidden: bool,
    ) -> AppResult<Vec<DirectoryChild>> {
        let entries = self.list_dir(connection_id, path).await?;
        let base = normalize_webdav_prefix(path);
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
        let key = normalize_webdav_dir_key(path);
        let existed = op
            .stat(&key)
            .await
            .ok()
            .is_some_and(|meta| matches!(meta.mode(), EntryMode::DIR));
        op.create_dir(&key).await.map_err(map_opendal_error)?;
        if existed {
            return Ok(());
        }
        // OpenDAL treats MKCOL 405 as "already exists" (RFC wording). Many
        // servers (including GoWebDAV) use 405 to mean the method is forbidden.
        match op.stat(&key).await {
            Ok(meta) if matches!(meta.mode(), EntryMode::DIR) => Ok(()),
            Ok(_) => Err(AppError::Config("webdav:methodNotAllowed".into())),
            Err(error) if error.kind() == ErrorKind::NotFound => {
                Err(AppError::Config("webdav:methodNotAllowed".into()))
            }
            Err(error) => Err(map_opendal_error(error)),
        }
    }

    pub async fn create_file(&self, connection_id: &str, path: &str) -> AppResult<()> {
        let op = self.operator_for(connection_id).await?;
        let key = normalize_webdav_object_key(path);
        op.write(&key, Vec::<u8>::new())
            .await
            .map_err(map_opendal_error)?;
        Ok(())
    }

    pub async fn delete(&self, connection_id: &str, path: &str, is_dir: bool) -> AppResult<()> {
        let op = self.operator_for(connection_id).await?;
        if is_dir {
            let prefix = normalize_webdav_dir_key(path);
            // Collection DELETE; avoid recursive listing (Depth: infinity) which
            // some servers reject with 405 even when a single DELETE is allowed.
            op.delete(&prefix).await.map_err(map_opendal_error)
        } else {
            let key = normalize_webdav_object_key(path);
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
        let src = normalize_webdav_object_key(old_path);
        let dst = normalize_webdav_object_key(new_path);
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
        let key = normalize_webdav_object_key(remote_path);
        let file_name = local_path
            .rsplit(['/', '\\'])
            .find(|segment| !segment.is_empty())
            .unwrap_or(local_path)
            .to_string();

        let session_id = format!("webdav:{connection_id}");

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
            let mut buffer = vec![0u8; WEBDAV_CHUNK_SIZE];
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
                    if last_progress.elapsed() >= WEBDAV_PROGRESS_INTERVAL {
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
        let key = normalize_webdav_object_key(remote_path);
        let file_name = key
            .rsplit('/')
            .find(|segment| !segment.is_empty())
            .unwrap_or(remote_path)
            .to_string();

        let session_id = format!("webdav:{connection_id}");

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
            let mut buf = vec![0u8; WEBDAV_CHUNK_SIZE];
            let mut transferred: u64 = 0;
            let mut last_progress = Instant::now();
            use futures_util::AsyncReadExt;
            loop {
                let read = reader
                    .read(&mut buf)
                    .await
                    .map_err(|err| AppError::Config(format!("Failed to read WebDAV object: {err}")))?;
                if read == 0 {
                    break;
                }
                target
                    .write_all(&buf[..read])
                    .await
                    .map_err(|err| AppError::Config(format!("Failed to write local file: {err}")))?;
                transferred = transferred.saturating_add(read as u64);
                if let Some(emitter) = emit.as_ref() {
                    if last_progress.elapsed() >= WEBDAV_PROGRESS_INTERVAL {
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
        let session_id = format!("webdav:{connection_id}");
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
        let prefix = normalize_webdav_dir_key(remote_path);
        let entries = op
            .list_with(&prefix)
            .recursive(true)
            .await
            .map_err(map_opendal_error)?;
        tokio::fs::create_dir_all(local_path)
            .await
            .map_err(|err| AppError::Config(format!("Failed to create local dir: {err}")))?;

        let session_id = format!("webdav:{connection_id}");
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
    base: WebDavTransferEvent,
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
        base: WebDavTransferEvent {
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

impl Default for WebDavManager {
    fn default() -> Self {
        Self::new()
    }
}

fn load_webdav_connection(connection_id: &str) -> AppResult<SavedConnection> {
        let mut conn = crate::storage::get_connection(connection_id)?
            .ok_or_else(|| AppError::SessionNotFound(format!("Connection '{connection_id}' not found")))?;
        decrypt_webdav_secrets_in_place(&mut conn)?;
        if !matches!(conn.config, ConnectionType::WebDav { .. }) {
            return Err(AppError::Config("Connection is not a WebDAV type".into()));
        }
        Ok(conn)
}

/// Decrypt WebDAV connection secrets in place.
pub fn decrypt_webdav_secrets_in_place(conn: &mut SavedConnection) -> AppResult<()> {
    let ConnectionType::WebDav {
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

pub fn build_operator_from_connection(connection: &SavedConnection) -> AppResult<Operator> {
    let ConnectionType::WebDav {
        endpoint,
        root,
        username,
        password,
        ..
    } = &connection.config
    else {
        return Err(AppError::Config("Connection is not a WebDAV type".into()));
    };

    build_opendal_webdav_operator(
        endpoint,
        root,
        username.as_deref().unwrap_or(""),
        password.as_deref().unwrap_or(""),
    )
    .map_err(map_opendal_error)
}

fn is_webdav_list_self_entry(listed_prefix: &str, entry_path: &str) -> bool {
    normalize_webdav_prefix(listed_prefix) == normalize_webdav_prefix(entry_path)
}

fn normalize_webdav_prefix(path: &str) -> String {
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

fn normalize_webdav_dir_key(path: &str) -> String {
    normalize_webdav_prefix(path)
}

fn normalize_webdav_object_key(path: &str) -> String {
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

fn map_opendal_error(error: opendal::Error) -> AppError {
    AppError::Config(classify_webdav_error(error.kind(), &error.to_string()).to_string())
}

pub(crate) fn webdav_test_error_code(error: &opendal::Error) -> &'static str {
    match classify_webdav_error(error.kind(), &error.to_string()) {
        "webdav:unauthorized" => "webdav_unauthorized",
        "webdav:forbidden" => "webdav_forbidden",
        "webdav:methodNotAllowed" => "webdav_method_not_allowed",
        "webdav:notFound" => "webdav_not_found",
        _ => "webdav_fail",
    }
}

pub(crate) fn classify_webdav_error(kind: ErrorKind, raw: &str) -> &'static str {
    match webdav_http_status(raw) {
        Some(401) => return "webdav:unauthorized",
        Some(403) => return "webdav:forbidden",
        Some(404) => return "webdav:notFound",
        Some(405) => return "webdav:methodNotAllowed",
        _ => {}
    }

    match kind {
        ErrorKind::PermissionDenied => "webdav:unauthorized",
        ErrorKind::NotFound => "webdav:notFound",
        ErrorKind::Unsupported => "webdav:unsupported",
        _ => "webdav:failed",
    }
}

fn webdav_http_status(raw: &str) -> Option<u16> {
    let lower = raw.to_ascii_lowercase();
    for code in [401_u16, 403, 404, 405] {
        if lower.contains(&format!("status: {code}")) {
            return Some(code);
        }
    }
    if lower.contains("401 unauthorized") {
        return Some(401);
    }
    if lower.contains("403 forbidden") {
        return Some(403);
    }
    if lower.contains("404 not found") {
        return Some(404);
    }
    if lower.contains("method not allowed") {
        return Some(405);
    }
    None
}

/// Resolve connection id from a synthetic WebDAV workspace session id (`webdav:<connectionId>`).
pub fn connection_id_from_session(session_id: &str) -> Option<&str> {
    session_id.strip_prefix("webdav:")
}

pub type SharedWebDavManager = Arc<WebDavManager>;

#[cfg(test)]
mod tests {
    use super::{
        classify_webdav_error, is_webdav_list_self_entry, normalize_webdav_prefix, webdav_http_status,
    };
    use opendal::ErrorKind;

    #[test]
    fn list_dir_skips_collection_self_entry_but_keeps_children() {
        let prefix = normalize_webdav_prefix("/A/");
        assert!(is_webdav_list_self_entry(&prefix, "/A/"));
        assert!(is_webdav_list_self_entry(&prefix, "/A"));
        assert!(!is_webdav_list_self_entry(&prefix, "/A/B/"));
        assert!(!is_webdav_list_self_entry(&prefix, "/A/A/"));
    }

    #[test]
    fn classifies_405_write_as_method_not_allowed() {
        let raw = "Unexpected (persistent) at write => status: 405, Method Not Allowed Created";
        assert_eq!(webdav_http_status(raw), Some(405));
        assert_eq!(
            classify_webdav_error(ErrorKind::Unexpected, raw),
            "webdav:methodNotAllowed"
        );
    }

    #[test]
    fn classifies_permission_denied_as_unauthorized() {
        assert_eq!(
            classify_webdav_error(ErrorKind::PermissionDenied, "no status"),
            "webdav:unauthorized"
        );
    }

    #[test]
    fn classifies_403_as_forbidden() {
        assert_eq!(
            classify_webdav_error(ErrorKind::Unexpected, "status: 403"),
            "webdav:forbidden"
        );
    }
}
