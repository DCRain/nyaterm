//! Shared helpers for S3 / FTP / WebDAV transfer-event payloads and control.

use std::sync::Arc;

use crate::core::sftp::transfer::{
    register_transfer, unregister_transfer, wait_for_transfer_ready, TransferController,
};
use crate::error::AppResult;

/// Resolve `size` and `total_size` for a completed transfer event.
///
/// When the backend never learned a total (stat/SIZE failed), fall back to the
/// actual byte count so the UI can show 100% instead of a stuck 0%.
pub(crate) fn finalize_completed_sizes(total_size: u64, bytes_transferred: u64) -> (u64, u64) {
    let size = total_size.max(bytes_transferred);
    let resolved_total = if total_size == 0 {
        bytes_transferred
    } else {
        total_size
    };
    (size, resolved_total)
}

/// Register a storage transfer into the shared SFTP `ACTIVE_TRANSFERS` table so
/// frontend `pause_transfer` / `cancel_transfer` / `resume_transfer` resolve.
pub(crate) fn register_storage_transfer(
    id: &str,
    session_id: &str,
    file_name: &str,
    remote_path: &str,
    local_path: &str,
    direction: &str,
    kind: &str,
    total_size: u64,
    item_count_total: Option<u64>,
) -> Arc<TransferController> {
    let controller = Arc::new(TransferController::new_with_kind(
        id.to_string(),
        session_id.to_string(),
        file_name.to_string(),
        remote_path.to_string(),
        local_path.to_string(),
        direction.to_string(),
        kind.to_string(),
        None,
        item_count_total,
        item_count_total.map(|_| 0),
    ));
    controller.update_progress(0, total_size);
    register_transfer(controller.clone());
    controller
}

pub(crate) fn try_register_storage_transfer(
    transfer_id: Option<&str>,
    session_id: &str,
    file_name: &str,
    remote_path: &str,
    local_path: &str,
    direction: &str,
    kind: &str,
    total_size: u64,
    item_count_total: Option<u64>,
) -> Option<Arc<TransferController>> {
    let id = transfer_id.filter(|value| !value.is_empty())?;
    Some(register_storage_transfer(
        id,
        session_id,
        file_name,
        remote_path,
        local_path,
        direction,
        kind,
        total_size,
        item_count_total,
    ))
}

pub(crate) async fn check_storage_control(controller: &Arc<TransferController>) -> AppResult<()> {
    wait_for_transfer_ready(controller).await
}

pub(crate) fn finish_storage_transfer(controller: Option<&Arc<TransferController>>) {
    if let Some(controller) = controller {
        unregister_transfer(&controller.id());
    }
}

pub(crate) fn is_transfer_cancelled(error: &crate::error::AppError) -> bool {
    matches!(error, crate::error::AppError::Cancelled(_))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn completed_with_known_total_keeps_total_and_sets_size() {
        assert_eq!(finalize_completed_sizes(100, 100), (100, 100));
        assert_eq!(finalize_completed_sizes(100, 80), (100, 100));
    }

    #[test]
    fn completed_with_unknown_total_uses_bytes_transferred() {
        assert_eq!(finalize_completed_sizes(0, 42), (42, 42));
        assert_eq!(finalize_completed_sizes(0, 0), (0, 0));
    }

    #[test]
    fn try_register_skips_empty_id() {
        assert!(try_register_storage_transfer(
            None,
            "s3:x",
            "a",
            "/a",
            "/tmp/a",
            "upload",
            "file",
            10,
            None,
        )
        .is_none());
        assert!(try_register_storage_transfer(
            Some(""),
            "s3:x",
            "a",
            "/a",
            "/tmp/a",
            "upload",
            "file",
            10,
            None,
        )
        .is_none());
    }

    #[test]
    fn register_and_unregister_roundtrip() {
        let controller = register_storage_transfer(
            "storage-control-test-id",
            "s3:test",
            "file.bin",
            "/file.bin",
            "/tmp/file.bin",
            "upload",
            "file",
            100,
            None,
        );
        assert_eq!(controller.id(), "storage-control-test-id");
        finish_storage_transfer(Some(&controller));
    }
}
