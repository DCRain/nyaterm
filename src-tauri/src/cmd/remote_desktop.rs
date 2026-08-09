use tauri::AppHandle;

use crate::core::remote_desktop::{
    LaunchRemoteDesktopRequest, LaunchRemoteDesktopResult, RemoteDesktopClientInfo,
    RemoteDesktopProtocol, launch_remote_desktop as do_launch_remote_desktop,
    list_remote_desktop_clients as do_list_remote_desktop_clients,
};
use crate::error::AppResult;

#[tauri::command]
pub fn list_remote_desktop_clients(
    protocol: RemoteDesktopProtocol,
) -> AppResult<Vec<RemoteDesktopClientInfo>> {
    Ok(do_list_remote_desktop_clients(protocol))
}

#[tauri::command]
pub fn launch_remote_desktop(
    app: AppHandle,
    request: LaunchRemoteDesktopRequest,
) -> AppResult<LaunchRemoteDesktopResult> {
    do_launch_remote_desktop(&app, request)
}
