//! Unified `RemoteFs` trait that all remote file system backends implement.

use super::transfer::TransferController;
use super::util::{
    FileEntry, FileProperties, RemoteBinaryFile, RemoteFileAttributeUpdate, RemotePathRef,
    RemoteTextFile, WriteRemoteTextResult,
};
use crate::error::AppResult;
use std::any::Any;
use std::sync::Arc;

/// Common interface for remote file system operations.
///
/// Each backend (SFTP, SCP Enhanced, SCP Normal) implements this trait so the
/// upper-level orchestrator can switch between them transparently.
#[async_trait::async_trait]
pub(crate) trait RemoteFs: Send + Sync {
    fn as_any(&self) -> &dyn Any;
    fn backend_name(&self) -> &'static str;

    async fn home_dir(&self) -> AppResult<String>;
    async fn list_dir(&self, path: &str) -> AppResult<Vec<FileEntry>>;
    async fn list_dir_ref(&self, path: &RemotePathRef) -> AppResult<Vec<FileEntry>> {
        self.list_dir(path.display_path()).await
    }
    async fn stat(&self, path: &str) -> AppResult<FileProperties>;
    async fn stat_ref(&self, path: &RemotePathRef) -> AppResult<FileProperties> {
        self.stat(path.display_path()).await
    }
    async fn mkdir(&self, path: &str, mode: Option<String>) -> AppResult<()>;
    async fn remove_file(&self, path: &str) -> AppResult<()>;
    async fn remove_file_ref(&self, path: &RemotePathRef) -> AppResult<()> {
        self.remove_file(path.display_path()).await
    }
    async fn rename(&self, old_path: &str, new_path: &str) -> AppResult<()>;
    async fn rename_ref(
        &self,
        old_path: &RemotePathRef,
        new_path: &RemotePathRef,
    ) -> AppResult<()> {
        self.rename(old_path.display_path(), new_path.display_path())
            .await
    }
    async fn create_file(&self, path: &str, mode: Option<String>) -> AppResult<()>;
    async fn create_symlink(&self, link_path: &str, target_path: &str) -> AppResult<()>;
    async fn update_attrs(&self, path: &str, update: &RemoteFileAttributeUpdate) -> AppResult<()>;
    async fn update_attrs_ref(
        &self,
        path: &RemotePathRef,
        update: &RemoteFileAttributeUpdate,
    ) -> AppResult<()> {
        self.update_attrs(path.display_path(), update).await
    }
    async fn read_file_text(&self, path: &str, max_bytes: u64) -> AppResult<RemoteTextFile>;
    async fn read_file_bytes(&self, path: &str, max_bytes: u64) -> AppResult<RemoteBinaryFile>;
    async fn write_file_text(
        &self,
        path: &str,
        content: &str,
        expected_mtime: Option<u64>,
        expected_size: Option<u64>,
        expected_hash: Option<&str>,
        force: bool,
    ) -> AppResult<WriteRemoteTextResult>;

    async fn download_file(
        &self,
        app: &tauri::AppHandle,
        session_id: &str,
        remote_path: &str,
        local_path: &str,
        transfer_settings: &crate::config::TransferSettings,
        transfer_id: Option<String>,
    ) -> AppResult<()>;

    async fn upload_file(
        &self,
        app: &tauri::AppHandle,
        session_id: &str,
        local_path: &str,
        remote_path: &str,
        transfer_settings: &crate::config::TransferSettings,
        transfer_id: Option<String>,
    ) -> AppResult<()>;

    async fn download_directory(
        &self,
        app: &tauri::AppHandle,
        session_id: &str,
        remote_path: &str,
        local_path: &str,
        transfer_id: Option<String>,
    ) -> AppResult<()>;

    async fn upload_directory(
        &self,
        app: &tauri::AppHandle,
        session_id: &str,
        local_path: &str,
        remote_path: &str,
        transfer_settings: &crate::config::TransferSettings,
        transfer_id: Option<String>,
    ) -> AppResult<()>;

    async fn copy_remote_file_to_local_with_controller(
        &self,
        app: &tauri::AppHandle,
        session_id: &str,
        remote_path: &str,
        local_path: &str,
        transfer_settings: &crate::config::TransferSettings,
        controller: Arc<TransferController>,
        parent_controller: Option<Arc<TransferController>>,
    ) -> AppResult<u64>;

    async fn copy_local_file_to_remote_with_controller(
        &self,
        app: &tauri::AppHandle,
        session_id: &str,
        local_path: &str,
        remote_path: &str,
        transfer_settings: &crate::config::TransferSettings,
        controller: Arc<TransferController>,
        parent_controller: Option<Arc<TransferController>>,
    ) -> AppResult<u64>;
}
