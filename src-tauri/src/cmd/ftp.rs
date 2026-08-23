use tauri::AppHandle;
use tauri::Window;

use crate::core::ftp::{connection_id_from_session, SharedFtpManager};
use crate::core::sftp::{DirectoryChild, FileEntry, FileProperties};
use crate::error::{AppError, AppResult};

fn resolve_connection_id(session_id: &str, connection_id: Option<&str>) -> AppResult<String> {
    if let Some(id) = connection_id.filter(|value| !value.is_empty()) {
        return Ok(id.to_string());
    }
    connection_id_from_session(session_id)
        .map(str::to_string)
        .ok_or_else(|| AppError::Config("FTP connection id is required".into()))
}

fn window_label(window: &Window) -> Option<String> {
    Some(window.label().to_string())
}

#[tauri::command]
pub async fn list_ftp_dir(
    app: AppHandle,
    window: Window,
    state: tauri::State<'_, SharedFtpManager>,
    session_id: String,
    connection_id: Option<String>,
    path: String,
) -> AppResult<Vec<FileEntry>> {
    let id = resolve_connection_id(&session_id, connection_id.as_deref())?;
    state
        .list_dir(&app, &id, &path, window_label(&window).as_deref())
        .await
}

#[tauri::command]
pub async fn list_ftp_child_directories(
    app: AppHandle,
    window: Window,
    state: tauri::State<'_, SharedFtpManager>,
    session_id: String,
    connection_id: Option<String>,
    path: String,
    show_hidden_files: bool,
) -> AppResult<Vec<DirectoryChild>> {
    let id = resolve_connection_id(&session_id, connection_id.as_deref())?;
    state
        .list_child_directories(
            &app,
            &id,
            &path,
            show_hidden_files,
            window_label(&window).as_deref(),
        )
        .await
}

#[tauri::command]
pub async fn get_ftp_file_properties(
    app: AppHandle,
    window: Window,
    state: tauri::State<'_, SharedFtpManager>,
    session_id: String,
    connection_id: Option<String>,
    path: String,
    is_directory: bool,
) -> AppResult<FileProperties> {
    let id = resolve_connection_id(&session_id, connection_id.as_deref())?;
    state
        .file_properties(
            &app,
            &id,
            &path,
            is_directory,
            window_label(&window).as_deref(),
        )
        .await
}

#[tauri::command]
pub async fn create_ftp_dir(
    app: AppHandle,
    window: Window,
    state: tauri::State<'_, SharedFtpManager>,
    session_id: String,
    connection_id: Option<String>,
    path: String,
) -> AppResult<()> {
    let id = resolve_connection_id(&session_id, connection_id.as_deref())?;
    state
        .create_dir(&app, &id, &path, window_label(&window).as_deref())
        .await
}

#[tauri::command]
pub async fn create_ftp_file(
    app: AppHandle,
    window: Window,
    state: tauri::State<'_, SharedFtpManager>,
    session_id: String,
    connection_id: Option<String>,
    path: String,
) -> AppResult<()> {
    let id = resolve_connection_id(&session_id, connection_id.as_deref())?;
    state
        .create_file(&app, &id, &path, window_label(&window).as_deref())
        .await
}

#[tauri::command]
pub async fn delete_ftp_object(
    app: AppHandle,
    window: Window,
    state: tauri::State<'_, SharedFtpManager>,
    session_id: String,
    connection_id: Option<String>,
    path: String,
    is_directory: bool,
) -> AppResult<()> {
    let id = resolve_connection_id(&session_id, connection_id.as_deref())?;
    state
        .delete(
            &app,
            &id,
            &path,
            is_directory,
            window_label(&window).as_deref(),
        )
        .await
}

#[tauri::command]
pub async fn rename_ftp_object(
    app: AppHandle,
    window: Window,
    state: tauri::State<'_, SharedFtpManager>,
    session_id: String,
    connection_id: Option<String>,
    old_path: String,
    new_path: String,
) -> AppResult<()> {
    let id = resolve_connection_id(&session_id, connection_id.as_deref())?;
    state
        .rename(
            &app,
            &id,
            &old_path,
            &new_path,
            window_label(&window).as_deref(),
        )
        .await
}

#[tauri::command]
pub async fn upload_local_file_to_ftp(
    app: AppHandle,
    window: Window,
    state: tauri::State<'_, SharedFtpManager>,
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
            window_label(&window).as_deref(),
        )
        .await
}

#[tauri::command]
pub async fn upload_local_directory_to_ftp(
    app: AppHandle,
    window: Window,
    state: tauri::State<'_, SharedFtpManager>,
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
            window_label(&window).as_deref(),
        )
        .await
}

#[tauri::command]
pub async fn download_ftp_file(
    app: AppHandle,
    window: Window,
    state: tauri::State<'_, SharedFtpManager>,
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
            window_label(&window).as_deref(),
        )
        .await
}

#[tauri::command]
pub async fn download_ftp_directory(
    app: AppHandle,
    window: Window,
    state: tauri::State<'_, SharedFtpManager>,
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
            window_label(&window).as_deref(),
        )
        .await
}

#[tauri::command]
pub async fn invalidate_ftp_connection(
    state: tauri::State<'_, SharedFtpManager>,
    connection_id: String,
) -> AppResult<()> {
    state.invalidate(&connection_id).await;
    Ok(())
}

#[tauri::command]
pub async fn respond_ftp_certificate(
    state: tauri::State<'_, SharedFtpManager>,
    request_id: String,
    accepted: bool,
    remember: bool,
) -> AppResult<()> {
    state
        .respond_certificate(&request_id, accepted, remember)
        .await
}
