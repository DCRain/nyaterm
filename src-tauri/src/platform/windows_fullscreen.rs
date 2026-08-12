//! Force the undecorated main window to cover the full monitor on Windows.
//!
//! Plain `set_size(monitor.size)` is clamped to the work area for transparent /
//! shadowed windows, which leaves the taskbar visible and a DWM shadow gap on
//! the left. This helper uses `rcMonitor` via `SetWindowPos` instead.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

use tauri::WebviewWindow;
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::Graphics::Dwm::{
    DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_DEFAULT, DWMWCP_DONOTROUND,
    DWM_WINDOW_CORNER_PREFERENCE,
};
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowPlacement, SetWindowPlacement, SetWindowPos, HWND_TOP, SWP_FRAMECHANGED,
    SWP_NOACTIVATE, SWP_SHOWWINDOW, WINDOWPLACEMENT,
};

struct SavedFullscreenState {
    placement: WINDOWPLACEMENT,
}

static SAVED: LazyLock<Mutex<HashMap<String, SavedFullscreenState>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn hwnd_of(window: &WebviewWindow) -> Result<HWND, String> {
    let hwnd = window
        .hwnd()
        .map_err(|error| format!("failed to get HWND: {error}"))?;
    Ok(HWND(hwnd.0 as *mut _))
}

fn set_window_corner_preference(hwnd: HWND, preference: DWM_WINDOW_CORNER_PREFERENCE) {
    let value = preference;
    let _ = unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            &value as *const _ as *const _,
            std::mem::size_of_val(&value) as u32,
        )
    };
}

pub fn set_terminal_fullscreen(window: &WebviewWindow, enable: bool) -> Result<(), String> {
    let label = window.label().to_string();
    let hwnd = hwnd_of(window)?;

    if enable {
        let mut placement = WINDOWPLACEMENT::default();
        placement.length = std::mem::size_of::<WINDOWPLACEMENT>() as u32;
        unsafe {
            GetWindowPlacement(hwnd, &mut placement)
                .map_err(|error| format!("GetWindowPlacement failed: {error}"))?;
        }

        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        let monitor = unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) };
        let ok = unsafe { GetMonitorInfoW(monitor, &mut info).as_bool() };
        if !ok {
            return Err("GetMonitorInfoW failed".to_string());
        }

        // Drop DWM shadow so the frame does not inset from the left edge.
        let _ = window.set_shadow(false);
        // Win11 rounds undecorated HWNDs by default — force square corners.
        set_window_corner_preference(hwnd, DWMWCP_DONOTROUND);

        // Leave maximized/fullscreen first so SetWindowPos owns the bounds.
        let _ = window.set_fullscreen(false);
        if window.is_maximized().unwrap_or(false) {
            let _ = window.unmaximize();
        }

        let rect: RECT = info.rcMonitor;
        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;
        unsafe {
            SetWindowPos(
                hwnd,
                Some(HWND_TOP),
                rect.left,
                rect.top,
                width,
                height,
                SWP_FRAMECHANGED | SWP_SHOWWINDOW | SWP_NOACTIVATE,
            )
            .map_err(|error| format!("SetWindowPos failed: {error}"))?;
        }

        if let Ok(mut guard) = SAVED.lock() {
            guard.insert(label, SavedFullscreenState { placement });
        }
        return Ok(());
    }

    let saved = SAVED
        .lock()
        .ok()
        .and_then(|mut guard| guard.remove(&label));

    let _ = window.set_fullscreen(false);
    let _ = window.set_shadow(true);
    set_window_corner_preference(hwnd, DWMWCP_DEFAULT);

    if let Some(saved) = saved {
        unsafe {
            SetWindowPlacement(hwnd, &saved.placement)
                .map_err(|error| format!("SetWindowPlacement failed: {error}"))?;
        }
    }

    Ok(())
}
