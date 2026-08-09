fn build_shell_command(
    shell_path: &str,
    shell_args: &str,
    elevated: bool,
) -> Result<(CommandBuilder, String), String> {
    let mut spec = resolve_shell_command(shell_path, shell_args)?;
    let profile_name = spec.program.clone();
    if elevated {
        spec = wrap_with_elevation(spec)?;
    }
    let mut builder = CommandBuilder::new(&spec.program);
    if !spec.args.is_empty() {
        builder.args(spec.args.iter().map(String::as_str));
    }
    Ok((builder, profile_name))
}

fn wrap_with_elevation(spec: ShellCommandSpec) -> Result<ShellCommandSpec, String> {
    #[cfg(target_os = "windows")]
    {
        let helper = resolve_windows_elevation_helper().ok_or_else(|| {
            "Administrator mode needs a working elevation helper (enable Windows sudo in Developer Settings, or install gsudo)."
                .to_string()
        })?;
        let mut args = Vec::with_capacity(spec.args.len() + 1);
        args.push(spec.program);
        args.extend(spec.args);
        return Ok(ShellCommandSpec {
            program: helper,
            args,
        });
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = spec;
        Err("Administrator mode is only supported on Windows.".to_string())
    }
}

/// Returns a usable elevation helper path when admin-mode shells can be launched.
///
/// Windows Terminal-style "elevate" opens a new elevated app window; it cannot attach an
/// elevated process to an existing unelevated ConPTY tab. Same-tab elevation therefore
/// requires Windows sudo (enabled) or gsudo.
#[cfg(target_os = "windows")]
fn resolve_windows_elevation_helper() -> Option<String> {
    // Prefer gsudo: works without Developer Settings and keeps I/O in the current console.
    if let Some(path) = find_gsudo_executable() {
        return Some(path);
    }

    for system_dir in windows_system_dirs() {
        let candidate = system_dir.join("sudo.exe");
        if candidate.is_file() && is_microsoft_sudo_enabled(&candidate) {
            return Some(candidate.to_string_lossy().to_string());
        }
    }

    None
}

#[cfg(target_os = "windows")]
fn find_gsudo_executable() -> Option<String> {
    if let Some(path) = find_windows_program_on_search_path("gsudo.exe") {
        return Some(path);
    }

    let mut candidates = Vec::new();
    if let Ok(root) = std::env::var("ChocolateyInstall") {
        let root = PathBuf::from(root);
        candidates.push(root.join("bin").join("gsudo.exe"));
        candidates.push(root.join("lib").join("gsudo").join("bin").join("gsudo.exe"));
    }
    if let Some(program_data) = std::env::var_os("ProgramData").map(PathBuf::from) {
        candidates.push(
            program_data
                .join("chocolatey")
                .join("bin")
                .join("gsudo.exe"),
        );
        candidates.push(
            program_data
                .join("chocolatey")
                .join("lib")
                .join("gsudo")
                .join("bin")
                .join("gsudo.exe"),
        );
    }
    if let Some(user_profile) = std::env::var_os("USERPROFILE").map(PathBuf::from) {
        candidates.push(user_profile.join("scoop").join("shims").join("gsudo.exe"));
        candidates.push(
            user_profile
                .join("scoop")
                .join("apps")
                .join("gsudo")
                .join("current")
                .join("gsudo.exe"),
        );
    }

    candidates
        .into_iter()
        .find(|path| path.is_file())
        .map(|path| path.to_string_lossy().to_string())
}

#[cfg(target_os = "windows")]
fn is_microsoft_sudo_enabled(sudo_path: &Path) -> bool {
    let mut command = std::process::Command::new(sudo_path);
    command.arg("-h");
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let Ok(output) = command.output() else {
        return false;
    };
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let lower = text.to_ascii_lowercase();
    if text.contains("禁用")
        || lower.contains("disabled")
        || lower.contains("not enabled")
        || lower.contains("enable it")
        || lower.contains("developer settings")
    {
        return false;
    }

    // Enabled sudo prints usage/help; treat any non-disabled help output as usable.
    !text.trim().is_empty()
}

fn default_local_shell_args(program: &str) -> Vec<String> {
    if cfg!(windows) {
        return vec![];
    }

    let shell_name = program
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(program)
        .to_ascii_lowercase();

    match shell_name.as_str() {
        "bash" | "zsh" | "fish" => vec!["--login".to_string(), "-i".to_string()],
        _ => vec![],
    }
}

fn resolve_shell_command(shell_path: &str, shell_args: &str) -> Result<ShellCommandSpec, String> {
    let raw_program = shell_path.trim();
    let program = trim_wrapping_quotes(raw_program);
    if program.is_empty() {
        let (_, shell_name) = platform_default_shell();
        let args = parse_shell_args(shell_args)?;
        return Ok(ShellCommandSpec {
            args: if args.is_empty() {
                default_local_shell_args(&shell_name)
            } else {
                args
            },
            program: shell_name,
        });
    }

    let args = parse_shell_args(shell_args)?;
    #[cfg(target_os = "windows")]
    if is_windows_terminal_alias(program) {
        return Ok(resolve_windows_terminal_default_profile_shell(args.clone())
            .unwrap_or_else(|| fallback_windows_terminal_shell(args)));
    }

    if !args.is_empty() {
        return Ok(ShellCommandSpec {
            program: resolve_program_for_spawn(program),
            args,
        });
    }

    if should_treat_as_literal_program(raw_program) {
        return Ok(ShellCommandSpec {
            program: resolve_program_for_spawn(program),
            args: default_local_shell_args(program),
        });
    }

    let mut legacy_parts = parse_shell_args(program)?;
    if legacy_parts.is_empty() {
        return Err("Shell path is required".to_string());
    }
    let legacy_program = legacy_parts.remove(0);
    Ok(ShellCommandSpec {
        program: resolve_program_for_spawn(&legacy_program),
        args: legacy_parts,
    })
}

