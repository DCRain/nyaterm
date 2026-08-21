use tauri::AppHandle;

use crate::core::s3::{connection_id_from_session, SharedS3Manager};
use crate::core::sftp::{DirectoryChild, FileEntry};
use crate::error::{AppError, AppResult};

fn resolve_connection_id(session_id: &str, connection_id: Option<&str>) -> AppResult<String> {
    if let Some(id) = connection_id.filter(|value| !value.is_empty()) {
        return Ok(id.to_string());
    }
    connection_id_from_session(session_id)
        .map(str::to_string)
        .ok_or_else(|| AppError::Config("S3 connection id is required".into()))
}

#[tauri::command]
pub async fn list_s3_dir(
    state: tauri::State<'_, SharedS3Manager>,
    session_id: String,
    connection_id: Option<String>,
    path: String,
) -> AppResult<Vec<FileEntry>> {
    let id = resolve_connection_id(&session_id, connection_id.as_deref())?;
    state.list_dir(&id, &path).await
}

#[tauri::command]
pub async fn list_s3_child_directories(
    state: tauri::State<'_, SharedS3Manager>,
    session_id: String,
    connection_id: Option<String>,
    path: String,
    show_hidden_files: bool,
) -> AppResult<Vec<DirectoryChild>> {
    let id = resolve_connection_id(&session_id, connection_id.as_deref())?;
    state
        .list_child_directories(&id, &path, show_hidden_files)
        .await
}

#[tauri::command]
pub async fn create_s3_dir(
    state: tauri::State<'_, SharedS3Manager>,
    session_id: String,
    connection_id: Option<String>,
    path: String,
) -> AppResult<()> {
    let id = resolve_connection_id(&session_id, connection_id.as_deref())?;
    state.create_dir(&id, &path).await
}

#[tauri::command]
pub async fn create_s3_file(
    state: tauri::State<'_, SharedS3Manager>,
    session_id: String,
    connection_id: Option<String>,
    path: String,
) -> AppResult<()> {
    let id = resolve_connection_id(&session_id, connection_id.as_deref())?;
    state.create_file(&id, &path).await
}

#[tauri::command]
pub async fn delete_s3_object(
    state: tauri::State<'_, SharedS3Manager>,
    session_id: String,
    connection_id: Option<String>,
    path: String,
    is_directory: bool,
) -> AppResult<()> {
    let id = resolve_connection_id(&session_id, connection_id.as_deref())?;
    state.delete(&id, &path, is_directory).await
}

#[tauri::command]
pub async fn rename_s3_object(
    state: tauri::State<'_, SharedS3Manager>,
    session_id: String,
    connection_id: Option<String>,
    old_path: String,
    new_path: String,
) -> AppResult<()> {
    let id = resolve_connection_id(&session_id, connection_id.as_deref())?;
    state.rename(&id, &old_path, &new_path).await
}

#[tauri::command]
pub async fn upload_local_file_to_s3(
    app: AppHandle,
    state: tauri::State<'_, SharedS3Manager>,
    session_id: String,
    connection_id: Option<String>,
    local_path: String,
    remote_path: String,
    transfer_id: Option<String>,
) -> AppResult<()> {
    let id = resolve_connection_id(&session_id, connection_id.as_deref())?;
    state
        .upload_file_with_progress(
            &id,
            &local_path,
            &remote_path,
            Some(&app),
            transfer_id.as_deref(),
        )
        .await
}

#[tauri::command]
pub async fn upload_local_directory_to_s3(
    app: AppHandle,
    state: tauri::State<'_, SharedS3Manager>,
    session_id: String,
    connection_id: Option<String>,
    local_path: String,
    remote_path: String,
    transfer_id: Option<String>,
) -> AppResult<()> {
    let id = resolve_connection_id(&session_id, connection_id.as_deref())?;
    state
        .upload_directory_with_progress(
            &id,
            &local_path,
            &remote_path,
            Some(&app),
            transfer_id.as_deref(),
        )
        .await
}

#[tauri::command]
pub async fn download_s3_file(
    app: AppHandle,
    state: tauri::State<'_, SharedS3Manager>,
    session_id: String,
    connection_id: Option<String>,
    remote_path: String,
    local_path: String,
    transfer_id: Option<String>,
) -> AppResult<()> {
    let id = resolve_connection_id(&session_id, connection_id.as_deref())?;
    state
        .download_file_with_progress(
            &id,
            &remote_path,
            &local_path,
            Some(&app),
            transfer_id.as_deref(),
        )
        .await
}

#[tauri::command]
pub async fn download_s3_directory(
    app: AppHandle,
    state: tauri::State<'_, SharedS3Manager>,
    session_id: String,
    connection_id: Option<String>,
    remote_path: String,
    local_path: String,
    transfer_id: Option<String>,
) -> AppResult<()> {
    let id = resolve_connection_id(&session_id, connection_id.as_deref())?;
    state
        .download_directory_with_progress(
            &id,
            &remote_path,
            &local_path,
            Some(&app),
            transfer_id.as_deref(),
        )
        .await
}

#[tauri::command]
pub async fn invalidate_s3_connection(
    state: tauri::State<'_, SharedS3Manager>,
    connection_id: String,
) -> AppResult<()> {
    state.invalidate(&connection_id).await;
    Ok(())
}
