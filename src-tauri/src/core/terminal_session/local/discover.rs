/// Discovered local shell options for the quick-open picker.

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalShellOption {
    pub id: String,
    pub name: String,
    pub shell_path: String,
    pub shell_args: String,
    pub kind: String,
    pub elevated: bool,
}

pub fn list_local_shells() -> Vec<LocalShellOption> {
    #[cfg(target_os = "windows")]
    {
        list_windows_local_shells()
    }
    #[cfg(not(target_os = "windows"))]
    {
        list_unix_local_shells()
    }
}

#[cfg(target_os = "windows")]
fn list_windows_local_shells() -> Vec<LocalShellOption> {
    let mut options = Vec::new();
    let mut seen_keys = std::collections::HashSet::new();
    let elevation_available = resolve_windows_elevation_helper().is_some();

    push_windows_shell_pair(
        &mut options,
        &mut seen_keys,
        "powershell",
        "Windows PowerShell",
        "powershell.exe",
        "powershell",
        elevation_available,
    );
    push_windows_shell_pair(
        &mut options,
        &mut seen_keys,
        "pwsh",
        "PowerShell 7",
        "pwsh.exe",
        "pwsh",
        elevation_available,
    );
    push_windows_shell_pair(
        &mut options,
        &mut seen_keys,
        "cmd",
        "Cmd",
        "cmd.exe",
        "cmd",
        elevation_available,
    );

    for path in git_bash_paths() {
        try_push_path(
            &mut options,
            &mut seen_keys,
            &format!("git_bash:{path}"),
            "Git Bash",
            &path,
            "",
            "git_bash",
            false,
        );
    }

    if wsl_available() {
        for distro in list_wsl_distros() {
            let id = format!("wsl:{distro}");
            let args = format!("-d {distro}");
            push_option(
                &mut options,
                &mut seen_keys,
                &id,
                &distro,
                "wsl.exe",
                &args,
                "wsl",
                false,
            );
        }
    }

    options
}

#[cfg(target_os = "windows")]
fn push_windows_shell_pair(
    options: &mut Vec<LocalShellOption>,
    seen_keys: &mut std::collections::HashSet<String>,
    id_prefix: &str,
    name: &str,
    program: &str,
    kind: &str,
    elevation_available: bool,
) {
    let resolved = resolve_program_for_spawn(program);
    if !Path::new(&resolved).is_file() {
        return;
    }

    try_push_resolved(
        options,
        seen_keys,
        id_prefix,
        name,
        program,
        "",
        kind,
        false,
    );
    if elevation_available {
        try_push_resolved(
            options,
            seen_keys,
            &format!("{id_prefix}:admin"),
            name,
            program,
            "",
            kind,
            true,
        );
    }
}

#[cfg(not(target_os = "windows"))]
fn list_unix_local_shells() -> Vec<LocalShellOption> {
    let mut options = Vec::new();
    let mut seen_keys = std::collections::HashSet::new();

    if let Ok(shell) = std::env::var("SHELL") {
        try_push_path(
            &mut options,
            &mut seen_keys,
            &format!("default:{shell}"),
            &format!("{} (default)", shell_display_name(&shell)),
            &shell,
            "",
            shell_kind(&shell),
            false,
        );
    }

    for path in [
        "/bin/zsh",
        "/bin/bash",
        "/usr/bin/zsh",
        "/usr/bin/bash",
        "/usr/bin/fish",
        "/bin/fish",
        "/bin/sh",
        "/usr/bin/sh",
    ] {
        try_push_path(
            &mut options,
            &mut seen_keys,
            path,
            &shell_display_name(path),
            path,
            "",
            shell_kind(path),
            false,
        );
    }

    options
}

fn try_push_resolved(
    options: &mut Vec<LocalShellOption>,
    seen_keys: &mut std::collections::HashSet<String>,
    id: &str,
    name: &str,
    program: &str,
    shell_args: &str,
    kind: &str,
    elevated: bool,
) {
    let resolved = resolve_program_for_spawn(program);
    if !Path::new(&resolved).is_file() {
        return;
    }
    push_option(
        options, seen_keys, id, name, &resolved, shell_args, kind, elevated,
    );
}

fn try_push_path(
    options: &mut Vec<LocalShellOption>,
    seen_keys: &mut std::collections::HashSet<String>,
    id: &str,
    name: &str,
    path: &str,
    shell_args: &str,
    kind: &str,
    elevated: bool,
) {
    if !Path::new(path).is_file() {
        return;
    }
    push_option(
        options, seen_keys, id, name, path, shell_args, kind, elevated,
    );
}

fn push_option(
    options: &mut Vec<LocalShellOption>,
    seen_keys: &mut std::collections::HashSet<String>,
    id: &str,
    name: &str,
    shell_path: &str,
    shell_args: &str,
    kind: &str,
    elevated: bool,
) {
    let dedupe_key = format!(
        "{}|{}|{}",
        shell_path.replace('\\', "/").to_ascii_lowercase(),
        shell_args.trim().to_ascii_lowercase(),
        elevated
    );
    if !seen_keys.insert(dedupe_key) {
        return;
    }

    options.push(LocalShellOption {
        id: id.to_string(),
        name: name.to_string(),
        shell_path: shell_path.to_string(),
        shell_args: shell_args.to_string(),
        kind: kind.to_string(),
        elevated,
    });
}

#[cfg(not(target_os = "windows"))]
fn shell_display_name(path: &str) -> String {
    Path::new(path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(path)
        .to_string()
}

#[cfg(not(target_os = "windows"))]
fn shell_kind(path: &str) -> &'static str {
    let name = Path::new(path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(path)
        .to_ascii_lowercase();
    match name.as_str() {
        "zsh" => "zsh",
        "bash" => "bash",
        "fish" => "fish",
        "sh" => "sh",
        "powershell" => "powershell",
        "pwsh" => "pwsh",
        "cmd" => "cmd",
        _ => "shell",
    }
}

#[cfg(target_os = "windows")]
fn git_bash_paths() -> Vec<String> {
    let mut roots = Vec::new();
    let mut seen = std::collections::HashSet::new();

    let mut push_root = |root: PathBuf| {
        let key = root.to_string_lossy().replace('/', "\\").to_ascii_lowercase();
        if seen.insert(key) {
            roots.push(root);
        }
    };

    for root in git_install_roots_from_registry() {
        push_root(root);
    }
    if let Some(git_exe) = find_windows_program_on_search_path("git.exe") {
        if let Some(root) = git_root_from_git_exe(Path::new(&git_exe)) {
            push_root(root);
        }
    }
    for env_key in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] {
        if let Ok(base) = std::env::var(env_key) {
            push_root(PathBuf::from(base).join("Git"));
        }
    }
    if let Some(user_profile) = std::env::var_os("USERPROFILE").map(PathBuf::from) {
        push_root(
            user_profile
                .join("scoop")
                .join("apps")
                .join("git")
                .join("current"),
        );
        push_root(
            user_profile
                .join("AppData")
                .join("Local")
                .join("Programs")
                .join("Git"),
        );
    }

    let mut paths = Vec::new();
    let mut seen_bash = std::collections::HashSet::new();
    for root in roots {
        for relative in ["bin\\bash.exe", "usr\\bin\\bash.exe"] {
            let bash = root.join(relative);
            if !bash.is_file() {
                continue;
            }
            let key = bash.to_string_lossy().replace('/', "\\").to_ascii_lowercase();
            if !seen_bash.insert(key) {
                continue;
            }
            paths.push(bash.to_string_lossy().to_string());
            break;
        }
    }
    paths
}

#[cfg(target_os = "windows")]
fn git_install_roots_from_registry() -> Vec<PathBuf> {
    const KEYS: &[&str] = &[
        r"HKLM\SOFTWARE\GitForWindows",
        r"HKLM\SOFTWARE\WOW6432Node\GitForWindows",
        r"HKCU\SOFTWARE\GitForWindows",
    ];

    let mut roots = Vec::new();
    for key in KEYS {
        if let Some(path) = reg_query_install_path(key) {
            roots.push(path);
        }
    }
    roots
}

#[cfg(target_os = "windows")]
fn reg_query_install_path(key: &str) -> Option<PathBuf> {
    let mut command = std::process::Command::new("reg");
    command.args(["query", key, "/v", "InstallPath"]);
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }

    let text = String::from_utf8_lossy(&output.stdout);
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('H') {
            continue;
        }
        // InstallPath    REG_SZ    D:\Softs\Develop\Git
        let mut parts = trimmed.split_whitespace();
        let Some(name) = parts.next() else {
            continue;
        };
        if !name.eq_ignore_ascii_case("InstallPath") {
            continue;
        }
        let Some(kind) = parts.next() else {
            continue;
        };
        if !kind.eq_ignore_ascii_case("REG_SZ") {
            continue;
        }
        let value = parts.collect::<Vec<_>>().join(" ");
        if value.is_empty() {
            continue;
        }
        let path = PathBuf::from(value);
        if path.is_dir() {
            return Some(path);
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn git_root_from_git_exe(git_exe: &Path) -> Option<PathBuf> {
    let parent = git_exe.parent()?;
    let parent_name = parent.file_name()?.to_string_lossy().to_ascii_lowercase();
    match parent_name.as_str() {
        "cmd" => parent.parent().map(Path::to_path_buf),
        "bin" => {
            let grand = parent.parent()?;
            let grand_name = grand.file_name()?.to_string_lossy().to_ascii_lowercase();
            if grand_name == "mingw64" || grand_name == "mingw32" {
                grand.parent().map(Path::to_path_buf)
            } else {
                Some(grand.to_path_buf())
            }
        }
        _ => None,
    }
}

#[cfg(target_os = "windows")]
fn wsl_available() -> bool {
    let resolved = resolve_program_for_spawn("wsl.exe");
    Path::new(&resolved).is_file() || find_windows_program_on_search_path("wsl.exe").is_some()
}

#[cfg(target_os = "windows")]
fn list_wsl_distros() -> Vec<String> {
    let mut command = std::process::Command::new("wsl.exe");
    command.args(["-l", "-q"]);
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let Ok(output) = command.output() else {
        return Vec::new();
    };
    if !output.status.success() && output.stdout.is_empty() {
        return Vec::new();
    }

    parse_wsl_list_output(&output.stdout)
}

#[cfg(target_os = "windows")]
fn parse_wsl_list_output(raw: &[u8]) -> Vec<String> {
    let text = decode_wsl_list_bytes(raw);
    text.lines()
        .map(|line| line.trim().trim_start_matches(['*', ' ']))
        .filter(|line| !line.is_empty())
        .filter(|line| {
            let lower = line.to_ascii_lowercase();
            lower != "docker-desktop"
                && lower != "docker-desktop-data"
                && !lower.contains("windows subsystem for linux")
        })
        .map(ToString::to_string)
        .collect()
}

#[cfg(target_os = "windows")]
fn decode_wsl_list_bytes(raw: &[u8]) -> String {
    if raw.len() >= 2 && raw.iter().skip(1).step_by(2).take(8).all(|&b| b == 0) {
        let u16s: Vec<u16> = raw
            .chunks_exact(2)
            .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
            .collect();
        String::from_utf16_lossy(&u16s)
    } else if raw.starts_with(&[0xFF, 0xFE]) {
        let u16s: Vec<u16> = raw[2..]
            .chunks_exact(2)
            .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
            .collect();
        String::from_utf16_lossy(&u16s)
    } else {
        String::from_utf8_lossy(raw).into_owned()
    }
}

#[cfg(test)]
mod discover_tests {
    #[cfg(target_os = "windows")]
    use super::{git_root_from_git_exe, parse_wsl_list_output};
    #[cfg(target_os = "windows")]
    use std::path::Path;

    #[test]
    #[cfg(target_os = "windows")]
    fn parses_utf16le_wsl_list() {
        let mut raw = Vec::new();
        for ch in "Ubuntu\0Debian\0".encode_utf16() {
            raw.extend_from_slice(&ch.to_le_bytes());
        }
        assert_eq!(parse_wsl_list_output(&raw), vec!["Ubuntu", "Debian"]);
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn parses_utf8_wsl_list() {
        assert_eq!(
            parse_wsl_list_output(b"Ubuntu\nDebian\n"),
            vec!["Ubuntu", "Debian"]
        );
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn git_root_from_cmd_git_exe() {
        let root = git_root_from_git_exe(Path::new(r"D:\Softs\Develop\Git\cmd\git.exe"));
        assert_eq!(root.as_deref(), Some(Path::new(r"D:\Softs\Develop\Git")));
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn git_root_from_mingw_git_exe() {
        let root =
            git_root_from_git_exe(Path::new(r"D:\Softs\Develop\Git\mingw64\bin\git.exe"));
        assert_eq!(root.as_deref(), Some(Path::new(r"D:\Softs\Develop\Git")));
    }
}
