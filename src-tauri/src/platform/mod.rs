#[cfg(windows)]
mod windows_external_drop;
#[cfg(windows)]
mod windows_fullscreen;

#[cfg(windows)]
pub use windows_external_drop::install_external_file_drop_bridge;
#[cfg(windows)]
pub use windows_fullscreen::set_terminal_fullscreen;

#[cfg(not(windows))]
pub fn install_external_file_drop_bridge(
    _window: &tauri::WebviewWindow,
) -> Result<(), Box<dyn std::error::Error>> {
    Ok(())
}

#[cfg(not(windows))]
pub fn set_terminal_fullscreen(window: &tauri::WebviewWindow, enable: bool) -> Result<(), String> {
    let _ = window.set_shadow(!enable);
    window
        .set_fullscreen(enable)
        .map_err(|error| format!("set_fullscreen failed: {error}"))
}

pub mod window_transparency;
pub use window_transparency::{WindowTransparency, apply_to_all_main_windows, apply_to_window};
