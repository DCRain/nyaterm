use std::fs;
use std::path::PathBuf;
use std::process::Command;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use super::detect::{
    ClientCandidateSpec, ClientKind, RemoteDesktopProtocol, install_recommendations,
    list_remote_desktop_clients, resolve_client,
};
use crate::config::{ConnectionType, load_connection_by_id};
use crate::error::{AppError, AppResult};

const DEFAULT_RDP_WIDTH: u16 = 1920;
const DEFAULT_RDP_HEIGHT: u16 = 1080;
const DEFAULT_RDP_USERNAME: &str = "administrator";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchRemoteDesktopRequest {
    pub connection_id: Option<String>,
    pub protocol: Option<RemoteDesktopProtocol>,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub username: Option<String>,
    pub display_mode: Option<String>,
    pub width: Option<u16>,
    pub height: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum LaunchRemoteDesktopResult {
    Launched {
        client_id: String,
        client_name: String,
    },
    MissingClient {
        protocol: RemoteDesktopProtocol,
        recommendations: Vec<super::detect::ClientInstallRecommendation>,
        clients: Vec<super::detect::RemoteDesktopClientInfo>,
    },
}

#[derive(Debug, Clone)]
struct LaunchTarget {
    protocol: RemoteDesktopProtocol,
    host: String,
    port: u16,
    username: Option<String>,
    preferred_client: String,
    rdp: Option<RdpLaunchOptions>,
}

#[derive(Debug, Clone)]
pub(super) struct RdpLaunchOptions {
    pub display_mode: String,
    pub width: u16,
    pub height: u16,
    pub redirect_clipboard: bool,
    pub redirect_printers: bool,
    pub redirect_com_ports: bool,
    pub redirect_smart_cards: bool,
    pub drive_redirect: String,
    pub device_redirect: String,
    pub camera_redirect: String,
    pub audio_mode: u8,
    pub audio_capture: bool,
    pub keyboard_hook: u8,
}

impl RdpLaunchOptions {
    pub fn is_fullscreen(&self) -> bool {
        !self.display_mode.eq_ignore_ascii_case("windowed")
    }

    pub fn normalized_resolution(&self) -> (u16, u16) {
        let width = if self.width == 0 {
            DEFAULT_RDP_WIDTH
        } else {
            self.width
        };
        let height = if self.height == 0 {
            DEFAULT_RDP_HEIGHT
        } else {
            self.height
        };
        (width, height)
    }
}

impl Default for RdpLaunchOptions {
    fn default() -> Self {
        Self {
            display_mode: "fullscreen".into(),
            width: DEFAULT_RDP_WIDTH,
            height: DEFAULT_RDP_HEIGHT,
            redirect_clipboard: true,
            redirect_printers: false,
            redirect_com_ports: false,
            redirect_smart_cards: false,
            drive_redirect: "*".into(),
            device_redirect: String::new(),
            camera_redirect: String::new(),
            audio_mode: 0,
            audio_capture: true,
            keyboard_hook: 2,
        }
    }
}

pub fn launch_remote_desktop(
    app: &AppHandle,
    request: LaunchRemoteDesktopRequest,
) -> AppResult<LaunchRemoteDesktopResult> {
    let target = resolve_launch_target(app, request)?;
    let preferred = target.preferred_client.trim();
    let Some((spec, path)) = resolve_client(
        target.protocol,
        (!preferred.is_empty()).then_some(preferred),
    ) else {
        return Ok(LaunchRemoteDesktopResult::MissingClient {
            protocol: target.protocol,
            recommendations: install_recommendations(target.protocol),
            clients: list_remote_desktop_clients(target.protocol),
        });
    };

    spawn_client(&spec, path.as_ref(), &target)?;

    Ok(LaunchRemoteDesktopResult::Launched {
        client_id: spec.id.to_string(),
        client_name: spec.name.to_string(),
    })
}

fn resolve_launch_target(
    app: &AppHandle,
    request: LaunchRemoteDesktopRequest,
) -> AppResult<LaunchTarget> {
    if let Some(connection_id) = request.connection_id.as_deref().filter(|id| !id.is_empty()) {
        let connection = load_connection_by_id(app, connection_id)?;
        return match connection.config {
            ConnectionType::Rdp { .. } => Err(AppError::Config(
                "RDP connections use the built-in RDP session; external client launch is not supported"
                    .into(),
            )),
            ConnectionType::Vnc { host, port } => Ok(LaunchTarget {
                protocol: RemoteDesktopProtocol::Vnc,
                host,
                port,
                username: None,
                preferred_client: String::new(),
                rdp: None,
            }),
            _ => Err(AppError::Config(
                "Saved connection is not an RDP or VNC type".into(),
            )),
        };
    }

    let protocol = request.protocol.ok_or_else(|| {
        AppError::Config("protocol or connection_id is required to launch remote desktop".into())
    })?;
    let host = request
        .host
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::Config("host is required".into()))?
        .to_string();
    let port = request.port.unwrap_or(match protocol {
        RemoteDesktopProtocol::Rdp => 3389,
        RemoteDesktopProtocol::Vnc => 5900,
    });
    if port == 0 {
        return Err(AppError::Config("port must be between 1 and 65535".into()));
    }

    let rdp = if matches!(protocol, RemoteDesktopProtocol::Rdp) {
        let mut options = RdpLaunchOptions::default();
        options.display_mode = normalize_display_mode(request.display_mode.unwrap_or_default());
        options.width = request.width.unwrap_or(DEFAULT_RDP_WIDTH);
        options.height = request.height.unwrap_or(DEFAULT_RDP_HEIGHT);
        Some(options)
    } else {
        None
    };

    Ok(LaunchTarget {
        protocol,
        host,
        port,
        username: request
            .username
            .map(normalize_rdp_username)
            .or_else(|| {
                matches!(protocol, RemoteDesktopProtocol::Rdp)
                    .then(|| DEFAULT_RDP_USERNAME.to_string())
            }),
        preferred_client: String::new(),
        rdp,
    })
}

fn normalize_display_mode(value: String) -> String {
    if value.eq_ignore_ascii_case("windowed") {
        "windowed".to_string()
    } else {
        "fullscreen".to_string()
    }
}

pub(super) fn normalize_rdp_username(value: String) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        DEFAULT_RDP_USERNAME.to_string()
    } else {
        trimmed.to_string()
    }
}

fn normalize_audio_mode(value: u8) -> u8 {
    if value > 2 { 0 } else { value }
}

fn normalize_keyboard_hook(value: u8) -> u8 {
    if value > 2 { 2 } else { value }
}

fn spawn_client(
    spec: &ClientCandidateSpec,
    path: Option<&PathBuf>,
    target: &LaunchTarget,
) -> AppResult<()> {
    match (target.protocol, spec.id) {
        (RemoteDesktopProtocol::Rdp, id @ ("mstsc" | "windows-app")) => {
            let exe = path.cloned().unwrap_or_else(|| {
                PathBuf::from(if id == "windows-app" {
                    "windows365.exe"
                } else {
                    "mstsc.exe"
                })
            });
            let options = target.rdp.clone().unwrap_or_default();
            let rdp_path = write_temp_rdp_file(
                &target.host,
                target.port,
                target.username.as_deref(),
                &options,
            )?;
            let mut command = Command::new(exe);
            command.arg(rdp_path);
            spawn_detached(command)
        }
        (RemoteDesktopProtocol::Rdp, "macos-open-rdp") => {
            let options = target.rdp.clone().unwrap_or_default();
            let rdp_path = write_temp_rdp_file(
                &target.host,
                target.port,
                target.username.as_deref(),
                &options,
            )?;
            let mut command = Command::new("open");
            command.arg(rdp_path);
            spawn_detached(command)
        }
        (
            RemoteDesktopProtocol::Rdp,
            id @ ("xfreerdp" | "wlfreerdp" | "wfreerdp" | "freerdp"),
        ) => {
            let exe = path
                .cloned()
                .unwrap_or_else(|| PathBuf::from(id));
            let options = target.rdp.clone().unwrap_or_default();
            let mut command = Command::new(exe);
            for arg in build_freerdp_args(
                &target.host,
                target.port,
                target.username.as_deref(),
                &options,
            ) {
                command.arg(arg);
            }
            spawn_detached(command)
        }
        (RemoteDesktopProtocol::Rdp, "remmina") => {
            let exe = path
                .cloned()
                .unwrap_or_else(|| PathBuf::from("remmina"));
            let mut uri = format!("rdp://{}:{}", target.host, target.port);
            if let Some(user) = target.username.as_deref() {
                uri = format!("rdp://{}@{}:{}", user, target.host, target.port);
            }
            let mut command = Command::new(exe);
            command.args(["-c", &uri]);
            spawn_detached(command)
        }
        (RemoteDesktopProtocol::Vnc, "macos-screen-sharing") => {
            let mut command = Command::new("open");
            command.arg(format!("vnc://{}:{}", target.host, target.port));
            spawn_detached(command)
        }
        (RemoteDesktopProtocol::Vnc, "tigervnc-app") => {
            let app_path = path.ok_or_else(|| {
                AppError::Config("TigerVNC Viewer.app path was not resolved".into())
            })?;
            let mut command = Command::new("open");
            command
                .arg("-a")
                .arg(app_path)
                .arg(build_vncviewer_target(&target.host, target.port));
            spawn_detached(command)
        }
        (RemoteDesktopProtocol::Vnc, "remmina") => {
            let exe = path
                .cloned()
                .unwrap_or_else(|| PathBuf::from("remmina"));
            let uri = format!("vnc://{}:{}", target.host, target.port);
            let mut command = Command::new(exe);
            command.args(["-c", &uri]);
            spawn_detached(command)
        }
        (RemoteDesktopProtocol::Vnc, _) => {
            let exe = path.cloned().unwrap_or_else(|| {
                PathBuf::from(if matches!(spec.kind, ClientKind::Executable { .. }) {
                    spec.id
                } else {
                    "vncviewer"
                })
            });
            let mut command = Command::new(exe);
            command.arg(build_vncviewer_target(&target.host, target.port));
            spawn_detached(command)
        }
        _ => Err(AppError::Config(format!(
            "Unsupported remote desktop client '{}'",
            spec.id
        ))),
    }
}

fn write_temp_rdp_file(
    host: &str,
    port: u16,
    username: Option<&str>,
    options: &RdpLaunchOptions,
) -> AppResult<PathBuf> {
    let dir = std::env::temp_dir().join("nyaterm-remote-desktop");
    fs::create_dir_all(&dir)?;
    let file_name = format!(
        "nyaterm-{}-{}.rdp",
        sanitize_file_part(host),
        std::process::id()
    );
    let path = dir.join(file_name);
    let screen = primary_screen_size();
    let contents = build_rdp_file_contents(host, port, username, options, screen);
    fs::write(&path, contents)?;
    Ok(path)
}

pub(super) fn primary_screen_size() -> (u32, u32) {
    #[cfg(windows)]
    {
        use windows::Win32::UI::WindowsAndMessaging::{
            GetSystemMetrics, SM_CXSCREEN, SM_CYSCREEN,
        };
        let width = unsafe { GetSystemMetrics(SM_CXSCREEN) };
        let height = unsafe { GetSystemMetrics(SM_CYSCREEN) };
        if width > 0 && height > 0 {
            return (width as u32, height as u32);
        }
    }
    (1920, 1080)
}

pub(super) fn centered_winposstr(
    width: u16,
    height: u16,
    screen: (u32, u32),
) -> String {
    let screen_w = screen.0 as i32;
    let screen_h = screen.1 as i32;
    let win_w = width as i32;
    let win_h = height as i32;
    let left = ((screen_w - win_w) / 2).max(0);
    let top = ((screen_h - win_h) / 2).max(0);
    let right = left + win_w;
    let bottom = top + win_h;
    format!("0,1,{left},{top},{right},{bottom}")
}

pub(super) fn build_rdp_file_contents(
    host: &str,
    port: u16,
    username: Option<&str>,
    options: &RdpLaunchOptions,
    screen: (u32, u32),
) -> String {
    let (width, height) = options.normalized_resolution();
    let screen_mode = if options.is_fullscreen() { 2 } else { 1 };
    let mut lines = vec![
        format!("screen mode id:i:{screen_mode}"),
        format!("desktopwidth:i:{width}"),
        format!("desktopheight:i:{height}"),
        format!("full address:s:{host}:{port}"),
        "prompt for credentials:i:1".to_string(),
        "authentication level:i:2".to_string(),
        format!(
            "redirectclipboard:i:{}",
            if options.redirect_clipboard { 1 } else { 0 }
        ),
        format!(
            "redirectprinters:i:{}",
            if options.redirect_printers { 1 } else { 0 }
        ),
        format!(
            "redirectcomports:i:{}",
            if options.redirect_com_ports { 1 } else { 0 }
        ),
        format!(
            "redirectsmartcards:i:{}",
            if options.redirect_smart_cards { 1 } else { 0 }
        ),
        format!("drivestoredirect:s:{}", options.drive_redirect),
        format!("devicestoredirect:s:{}", options.device_redirect),
        format!("camerastoredirect:s:{}", options.camera_redirect),
        format!("audiomode:i:{}", options.audio_mode),
        format!(
            "audiocapturemode:i:{}",
            if options.audio_capture { 1 } else { 0 }
        ),
        format!("keyboardhook:i:{}", options.keyboard_hook),
        format!(
            "dynamic resolution:i:{}",
            if options.is_fullscreen() { 0 } else { 1 }
        ),
    ];
    if !options.is_fullscreen() {
        lines.push(format!(
            "winposstr:s:{}",
            centered_winposstr(width, height, screen)
        ));
    }
    let user = username
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_RDP_USERNAME);
    lines.push(format!("username:s:{user}"));
    lines.push(String::new());
    lines.join("\r\n")
}

pub(super) fn build_freerdp_args(
    host: &str,
    port: u16,
    username: Option<&str>,
    options: &RdpLaunchOptions,
) -> Vec<String> {
    let (width, height) = options.normalized_resolution();
    let mut args = vec![
        format!("/v:{host}:{port}"),
        format!("/w:{width}"),
        format!("/h:{height}"),
    ];
    let user = username
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_RDP_USERNAME);
    args.push(format!("/u:{user}"));
    if options.is_fullscreen() {
        args.push("/f".to_string());
    } else {
        args.push("+dynamic-resolution".to_string());
    }
    if options.redirect_clipboard {
        args.push("+clipboard".to_string());
    } else {
        args.push("-clipboard".to_string());
    }
    args.push(format!("/audio-mode:{}", options.audio_mode));
    if options.audio_capture {
        args.push("/microphone".to_string());
    }
    match options.drive_redirect.trim() {
        "" => {}
        "*" => args.push("/drive:*,*".to_string()),
        drives => {
            for drive in drives.split(';').map(str::trim).filter(|d| !d.is_empty()) {
                let letter = drive.trim_end_matches(':');
                if !letter.is_empty() {
                    args.push(format!("/drive:{letter},{letter}:"));
                }
            }
        }
    }
    args
}

pub(super) fn build_vncviewer_target(host: &str, port: u16) -> String {
    format!("{host}::{port}")
}

fn sanitize_file_part(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.' {
                ch
            } else {
                '_'
            }
        })
        .take(48)
        .collect()
}

fn spawn_detached(mut command: Command) -> AppResult<()> {
    command
        .spawn()
        .map(|_| ())
        .map_err(|err| AppError::Config(format!("Failed to launch remote desktop client: {err}")))
}
