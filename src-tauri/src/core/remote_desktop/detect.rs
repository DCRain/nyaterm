use std::path::PathBuf;
use std::process::Command;

use serde::{Deserialize, Serialize};

use crate::config::ConnectionType;
use crate::error::AppError;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RemoteDesktopProtocol {
    Rdp,
    Vnc,
}

impl TryFrom<&ConnectionType> for RemoteDesktopProtocol {
    type Error = AppError;

    fn try_from(value: &ConnectionType) -> Result<Self, Self::Error> {
        match value {
            ConnectionType::Rdp { .. } => Ok(Self::Rdp),
            ConnectionType::Vnc { .. } => Ok(Self::Vnc),
            _ => Err(AppError::Config(
                "Connection is not an RDP or VNC remote desktop type".into(),
            )),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteDesktopClientInfo {
    pub id: String,
    pub name: String,
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub install_hint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub download_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientInstallRecommendation {
    pub id: String,
    pub name: String,
    pub install_hint: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub download_url: Option<String>,
}

#[derive(Debug, Clone)]
pub(super) struct ClientCandidateSpec {
    pub id: &'static str,
    pub name: &'static str,
    pub kind: ClientKind,
    pub install_hint: &'static str,
    pub download_url: Option<&'static str>,
}

#[derive(Debug, Clone)]
#[allow(dead_code)] // MacApp / Builtin / Msrdc are platform-gated; all variants exist on every OS build.
pub(super) enum ClientKind {
    /// Always treat as available on this OS (built-in launcher).
    Builtin,
    /// Resolve by executable name on PATH and/or absolute path candidates.
    Executable {
        names: &'static [&'static str],
        absolute_paths: &'static [&'static str],
    },
    /// Windows App / Microsoft Remote Desktop (`msrdc.exe`), including Store installs.
    Msrdc,
    /// macOS application bundle by path.
    MacApp {
        paths: &'static [&'static str],
    },
}

pub fn list_remote_desktop_clients(protocol: RemoteDesktopProtocol) -> Vec<RemoteDesktopClientInfo> {
    candidate_specs(protocol)
        .into_iter()
        .map(|spec| {
            let path = resolve_candidate(&spec);
            let available = matches!(spec.kind, ClientKind::Builtin) || path.is_some();
            RemoteDesktopClientInfo {
                id: spec.id.to_string(),
                name: spec.name.to_string(),
                available,
                path: path.map(|p| p.to_string_lossy().into_owned()),
                install_hint: if available {
                    None
                } else {
                    Some(spec.install_hint.to_string())
                },
                download_url: if available {
                    None
                } else {
                    spec.download_url.map(str::to_string)
                },
            }
        })
        .collect()
}

pub fn install_recommendations(protocol: RemoteDesktopProtocol) -> Vec<ClientInstallRecommendation> {
    candidate_specs(protocol)
        .into_iter()
        .filter(|spec| !matches!(spec.kind, ClientKind::Builtin))
        .map(|spec| ClientInstallRecommendation {
            id: spec.id.to_string(),
            name: spec.name.to_string(),
            install_hint: spec.install_hint.to_string(),
            download_url: spec.download_url.map(str::to_string),
        })
        .collect()
}

pub(super) fn first_available_client(
    protocol: RemoteDesktopProtocol,
) -> Option<(ClientCandidateSpec, Option<PathBuf>)> {
    for spec in candidate_specs(protocol) {
        if matches!(spec.kind, ClientKind::Builtin) {
            return Some((spec, None));
        }
        if let Some(path) = resolve_candidate(&spec) {
            return Some((spec, Some(path)));
        }
    }
    None
}

/// Resolve a preferred client id, or the first available client when `preferred_id` is empty.
///
/// When a preferred id is set but that client is not installed, returns `None`
/// (caller should surface `missing_client` rather than silently falling back).
pub(super) fn resolve_client(
    protocol: RemoteDesktopProtocol,
    preferred_id: Option<&str>,
) -> Option<(ClientCandidateSpec, Option<PathBuf>)> {
    let preferred = preferred_id.map(str::trim).filter(|id| !id.is_empty());
    let Some(preferred) = preferred else {
        return first_available_client(protocol);
    };

    for spec in candidate_specs(protocol) {
        if spec.id != preferred {
            continue;
        }
        if matches!(spec.kind, ClientKind::Builtin) {
            return Some((spec, None));
        }
        if let Some(path) = resolve_candidate(&spec) {
            return Some((spec, Some(path)));
        }
        return None;
    }
    None
}

pub(super) fn candidate_specs(protocol: RemoteDesktopProtocol) -> Vec<ClientCandidateSpec> {
    match protocol {
        RemoteDesktopProtocol::Rdp => rdp_candidates(),
        RemoteDesktopProtocol::Vnc => vnc_candidates(),
    }
}

#[cfg_attr(not(test), allow(dead_code))]
pub(super) fn primary_rdp_client_id() -> &'static str {
    rdp_candidates()
        .first()
        .map(|c| c.id)
        .unwrap_or("unknown")
}

#[cfg_attr(not(test), allow(dead_code))]
pub(super) fn primary_vnc_client_id() -> &'static str {
    vnc_candidates()
        .first()
        .map(|c| c.id)
        .unwrap_or("unknown")
}

fn rdp_candidates() -> Vec<ClientCandidateSpec> {
    #[cfg(target_os = "windows")]
    {
        vec![
            ClientCandidateSpec {
                id: "mstsc",
                name: "Remote Desktop Connection (mstsc)",
                kind: ClientKind::Executable {
                    names: &["mstsc.exe", "mstsc"],
                    absolute_paths: &[
                        r"C:\Windows\System32\mstsc.exe",
                        r"C:\Windows\SysWOW64\mstsc.exe",
                    ],
                },
                install_hint: "Windows includes mstsc.exe. If missing, repair Remote Desktop Connection via Optional Features.",
                download_url: Some("https://learn.microsoft.com/windows-server/remote/remote-desktop-services/clients/remote-desktop-clients"),
            },
            ClientCandidateSpec {
                id: "windows-app",
                name: "Windows App / Microsoft Remote Desktop",
                kind: ClientKind::Msrdc,
                install_hint: "Install Windows App from the Microsoft Store (provides the windows365.exe launch alias).",
                download_url: Some("https://apps.microsoft.com/detail/9n1f85v9t8b0"),
            },
            freerdp_candidate("xfreerdp"),
            freerdp_candidate("wlfreerdp"),
            freerdp_candidate("wfreerdp"),
        ]
    }

    #[cfg(target_os = "macos")]
    {
        vec![
            ClientCandidateSpec {
                id: "macos-open-rdp",
                name: "Microsoft Remote Desktop / open",
                kind: ClientKind::Builtin,
                install_hint: "Install Microsoft Remote Desktop from the Mac App Store, or: brew install --cask microsoft-remote-desktop",
                download_url: Some("https://apps.apple.com/app/microsoft-remote-desktop/id1295203466"),
            },
            freerdp_candidate("xfreerdp"),
        ]
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        vec![
            freerdp_candidate("xfreerdp"),
            freerdp_candidate("wlfreerdp"),
            freerdp_candidate("freerdp"),
            ClientCandidateSpec {
                id: "remmina",
                name: "Remmina",
                kind: ClientKind::Executable {
                    names: &["remmina"],
                    absolute_paths: &["/usr/bin/remmina", "/usr/local/bin/remmina"],
                },
                install_hint: "sudo apt install remmina  # or: sudo dnf install remmina",
                download_url: Some("https://remmina.org/how-to-install-remmina/"),
            },
        ]
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", all(unix, not(target_os = "macos")))))]
    {
        vec![freerdp_candidate("xfreerdp")]
    }
}

fn vnc_candidates() -> Vec<ClientCandidateSpec> {
    #[cfg(target_os = "macos")]
    {
        vec![
            ClientCandidateSpec {
                id: "macos-screen-sharing",
                name: "Screen Sharing (vnc://)",
                kind: ClientKind::Builtin,
                install_hint: "macOS Screen Sharing is built-in.",
                download_url: None,
            },
            ClientCandidateSpec {
                id: "tigervnc-app",
                name: "TigerVNC Viewer",
                kind: ClientKind::MacApp {
                    paths: &[
                        "/Applications/TigerVNC Viewer.app",
                        "/Applications/TigerVNC Viewer 1.13.1.app",
                        "/Applications/TigerVNC.app",
                    ],
                },
                install_hint: "brew install --cask tigervnc-viewer",
                download_url: Some("https://tigervnc.org/"),
            },
            vncviewer_candidate(),
        ]
    }

    #[cfg(target_os = "windows")]
    {
        vec![
            ClientCandidateSpec {
                id: "vncviewer",
                name: "VNC Viewer",
                kind: ClientKind::Executable {
                    names: &["vncviewer.exe", "vncviewer", "tvnviewer.exe"],
                    absolute_paths: &[
                        r"C:\Program Files\TigerVNC\vncviewer.exe",
                        r"C:\Program Files (x86)\TigerVNC\vncviewer.exe",
                        r"C:\Program Files\UltraVNC\vncviewer.exe",
                        r"C:\Program Files (x86)\UltraVNC\vncviewer.exe",
                        r"C:\Program Files\TightVNC\tvnviewer.exe",
                        r"C:\Program Files (x86)\TightVNC\tvnviewer.exe",
                        r"C:\Program Files\RealVNC\VNC Viewer\vncviewer.exe",
                        r"C:\Program Files (x86)\RealVNC\VNC Viewer\vncviewer.exe",
                    ],
                },
                install_hint: "winget install TigerVNC.TigerVNC",
                download_url: Some("https://tigervnc.org/"),
            },
        ]
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        vec![
            vncviewer_candidate(),
            ClientCandidateSpec {
                id: "xtigervncviewer",
                name: "TigerVNC Viewer (xtigervncviewer)",
                kind: ClientKind::Executable {
                    names: &["xtigervncviewer"],
                    absolute_paths: &[
                        "/usr/bin/xtigervncviewer",
                        "/usr/local/bin/xtigervncviewer",
                    ],
                },
                install_hint: "sudo apt install tigervnc-viewer  # or: sudo dnf install tigervnc",
                download_url: Some("https://tigervnc.org/"),
            },
            ClientCandidateSpec {
                id: "remmina",
                name: "Remmina",
                kind: ClientKind::Executable {
                    names: &["remmina"],
                    absolute_paths: &["/usr/bin/remmina", "/usr/local/bin/remmina"],
                },
                install_hint: "sudo apt install remmina  # or: sudo dnf install remmina",
                download_url: Some("https://remmina.org/how-to-install-remmina/"),
            },
        ]
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", all(unix, not(target_os = "macos")))))]
    {
        vec![vncviewer_candidate()]
    }
}

fn freerdp_candidate(name: &'static str) -> ClientCandidateSpec {
    let (install_hint, download_url) = freerdp_install_meta();
    ClientCandidateSpec {
        id: name,
        name: match name {
            "xfreerdp" => "FreeRDP (xfreerdp)",
            "wlfreerdp" => "FreeRDP (wlfreerdp)",
            "wfreerdp" => "FreeRDP (wfreerdp)",
            "freerdp" => "FreeRDP",
            other => other,
        },
        kind: ClientKind::Executable {
            names: match name {
                "xfreerdp" => &["xfreerdp", "xfreerdp.exe"],
                "wlfreerdp" => &["wlfreerdp", "wlfreerdp.exe"],
                "wfreerdp" => &["wfreerdp", "wfreerdp.exe"],
                "freerdp" => &["freerdp", "freerdp.exe"],
                _ => &[],
            },
            absolute_paths: &[],
        },
        install_hint,
        download_url: Some(download_url),
    }
}

fn freerdp_install_meta() -> (&'static str, &'static str) {
    #[cfg(target_os = "windows")]
    {
        (
            "winget install FreeRDP.FreeRDP  # or download from freerdp.com",
            "https://www.freerdp.com/",
        )
    }
    #[cfg(target_os = "macos")]
    {
        ("brew install freerdp", "https://www.freerdp.com/")
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        (
            "sudo apt install freerdp2-x11  # or: sudo dnf install freerdp",
            "https://www.freerdp.com/",
        )
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", all(unix, not(target_os = "macos")))))]
    {
        ("Install FreeRDP for your platform", "https://www.freerdp.com/")
    }
}

#[cfg(any(target_os = "macos", all(unix, not(target_os = "macos"))))]
fn vncviewer_candidate() -> ClientCandidateSpec {
    #[cfg(target_os = "macos")]
    {
        ClientCandidateSpec {
            id: "vncviewer",
            name: "vncviewer",
            kind: ClientKind::Executable {
                names: &["vncviewer"],
                absolute_paths: &["/opt/homebrew/bin/vncviewer", "/usr/local/bin/vncviewer"],
            },
            install_hint: "brew install tigervnc",
            download_url: Some("https://tigervnc.org/"),
        }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        ClientCandidateSpec {
            id: "vncviewer",
            name: "vncviewer",
            kind: ClientKind::Executable {
                names: &["vncviewer"],
                absolute_paths: &["/usr/bin/vncviewer", "/usr/local/bin/vncviewer"],
            },
            install_hint: "sudo apt install tigervnc-viewer  # or: sudo dnf install tigervnc",
            download_url: Some("https://tigervnc.org/"),
        }
    }
}

fn resolve_candidate(spec: &ClientCandidateSpec) -> Option<PathBuf> {
    match &spec.kind {
        ClientKind::Builtin => None,
        ClientKind::Msrdc => find_msrdc_path(),
        ClientKind::MacApp { paths } => paths
            .iter()
            .map(PathBuf::from)
            .find(|path| path.exists()),
        ClientKind::Executable {
            names,
            absolute_paths,
        } => {
            for path in absolute_paths.iter().map(PathBuf::from) {
                if path.is_file() {
                    return Some(path);
                }
            }
            for name in *names {
                if let Some(path) = find_on_path(name) {
                    return Some(path);
                }
            }
            None
        }
    }
}

fn find_msrdc_path() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        // Store / MSIX Windows App exposes an App Execution Alias that CreateProcess can launch.
        // Direct paths under Program Files\WindowsApps are ACL-blocked for normal processes.
        if let Some(path) = find_windows365_alias() {
            return Some(path);
        }

        const FIXED_MSRDC: &[&str] = &[
            r"C:\Program Files\Remote Desktop\msrdc.exe",
            r"C:\Program Files (x86)\Remote Desktop\msrdc.exe",
        ];
        for path in FIXED_MSRDC.iter().map(PathBuf::from) {
            if path.is_file() {
                return Some(path);
            }
        }
        if let Some(path) = find_on_path("msrdc.exe").or_else(|| find_on_path("msrdc")) {
            return Some(path);
        }

        // Prefer resolving InstallLocation via Get-AppxPackage (read_dir on WindowsApps is denied).
        if let Some(path) = find_msrdc_via_appx_package() {
            return Some(path);
        }

        find_msrdc_in_windows_apps()
    }
    #[cfg(not(target_os = "windows"))]
    {
        None
    }
}

#[cfg(target_os = "windows")]
fn find_windows365_alias() -> Option<PathBuf> {
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let candidate = PathBuf::from(local)
            .join("Microsoft")
            .join("WindowsApps")
            .join("windows365.exe");
        // App execution aliases are 0-byte reparse points; use exists() not is_file().
        if candidate.exists() {
            return Some(candidate);
        }
    }
    find_on_path_existing("windows365.exe").or_else(|| find_on_path_existing("windows365"))
}

/// Like `find_on_path`, but accepts App Execution Alias reparse points (`exists`, not only `is_file`).
fn find_on_path_existing(name: &str) -> Option<PathBuf> {
    if let Some(path) = which_command_existing(name) {
        return Some(path);
    }

    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(name);
        if path_is_launchable(&candidate) {
            return Some(candidate);
        }
        #[cfg(windows)]
        {
            if !name.contains('.') {
                let with_exe = dir.join(format!("{name}.exe"));
                if path_is_launchable(&with_exe) {
                    return Some(with_exe);
                }
            }
        }
    }
    None
}

fn path_is_launchable(path: &std::path::Path) -> bool {
    path.exists() && !path.is_dir()
}

fn which_command_existing(name: &str) -> Option<PathBuf> {
    let mut command = if cfg!(windows) {
        let mut command = Command::new("where.exe");
        command.arg(name);
        command
    } else {
        let mut command = Command::new("which");
        command.arg(name);
        command
    };

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let line = String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())?
        .to_string();
    let path = PathBuf::from(line);
    path_is_launchable(&path).then_some(path)
}

#[cfg(target_os = "windows")]
fn find_msrdc_via_appx_package() -> Option<PathBuf> {
    const PACKAGE_NAMES: &[&str] = &[
        "MicrosoftCorporationII.Windows365",
        "MicrosoftCorporationII.MicrosoftRemoteDesktop",
        "Microsoft.RemoteDesktop",
    ];
    for package in PACKAGE_NAMES {
        let Some(install_location) = appx_install_location(package) else {
            continue;
        };
        if !install_location.exists() {
            continue;
        }
        // Always prefer the App Execution Alias — CreateProcess on WindowsApps\msrdc.exe is denied.
        if let Some(alias) = find_windows365_alias() {
            return Some(alias);
        }
        return Some(PathBuf::from("windows365.exe"));
    }
    None
}

#[cfg(target_os = "windows")]
fn appx_install_location(package_name: &str) -> Option<PathBuf> {
    let script = format!(
        "(Get-AppxPackage -Name '{}').InstallLocation",
        package_name.replace('\'', "''")
    );
    let mut command = Command::new("powershell.exe");
    command.args([
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        &script,
    ]);
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let line = String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())?
        .to_string();
    let path = PathBuf::from(line);
    path.exists().then_some(path)
}

#[cfg(target_os = "windows")]
fn find_msrdc_in_windows_apps() -> Option<PathBuf> {
    let apps_root = PathBuf::from(r"C:\Program Files\WindowsApps");
    let entries = std::fs::read_dir(&apps_root).ok()?;
    let mut package_dirs: Vec<PathBuf> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_dir()
                && path.file_name().and_then(|n| n.to_str()).is_some_and(|name| {
                    name.starts_with("MicrosoftCorporationII.Windows365")
                        || name.starts_with("MicrosoftCorporationII.MicrosoftRemoteDesktop")
                        || name.starts_with("Microsoft.RemoteDesktop")
                        || name.starts_with("Microsoft.Windows365")
                })
        })
        .collect();
    // Prefer newer package folders when names include version segments.
    package_dirs.sort_by(|a, b| b.cmp(a));

    for dir in package_dirs {
        for relative in ["msrdc\\msrdc.exe", "msrdc.exe"] {
            let candidate = dir.join(relative);
            if candidate.is_file() {
                if let Some(alias) = find_windows365_alias() {
                    return Some(alias);
                }
                return Some(candidate);
            }
        }
    }
    None
}

fn find_on_path(name: &str) -> Option<PathBuf> {
    if let Some(path) = which_command(name) {
        return Some(path);
    }

    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
        #[cfg(windows)]
        {
            if !name.contains('.') {
                let with_exe = dir.join(format!("{name}.exe"));
                if with_exe.is_file() {
                    return Some(with_exe);
                }
            }
        }
    }
    None
}

fn which_command(name: &str) -> Option<PathBuf> {
    let mut command = if cfg!(windows) {
        let mut command = Command::new("where.exe");
        command.arg(name);
        command
    } else {
        let mut command = Command::new("which");
        command.arg(name);
        command
    };

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let line = String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())?
        .to_string();
    let path = PathBuf::from(line);
    path.is_file().then_some(path)
}
