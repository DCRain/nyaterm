fn platform_default_shell() -> (CommandBuilder, String) {
    #[cfg(target_os = "windows")]
    {
        let shell = resolve_program_for_spawn("powershell.exe");
        (CommandBuilder::new(&shell), shell)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
        let mut builder = CommandBuilder::new(&shell);
        let default_args = default_local_shell_args(&shell);
        if !default_args.is_empty() {
            builder.args(default_args.iter().map(String::as_str));
        }
        (builder, shell)
    }
}

#[cfg(target_os = "macos")]
fn ensure_macos_interactive_path(cmd: &mut CommandBuilder) {
    let current_path = std::env::var("PATH").unwrap_or_default();
    let mut paths: Vec<String> = current_path
        .split(':')
        .filter(|part| !part.is_empty())
        .map(ToString::to_string)
        .collect();

    for path in ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin"] {
        if !paths.iter().any(|existing| existing == path) && Path::new(path).exists() {
            paths.push(path.to_string());
        }
    }

    if !paths.is_empty() {
        cmd.env("PATH", paths.join(":"));
    }
}

/// Advertise a color-capable terminal to local shells and CLI tools.
///
/// Windows ConPTY sessions previously skipped this, so many programs (git, ls,
/// ripgrep, Node CLIs, etc.) fell back to monochrome output. Match common
/// emulators by setting both TERM and COLORTERM.
fn configure_local_pty_environment(cmd: &mut CommandBuilder) {
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    #[cfg(target_os = "macos")]
    {
        set_utf8_env_if_missing_or_non_utf8(cmd, "LANG", "en_US.UTF-8");
        set_utf8_env_if_missing_or_non_utf8(cmd, "LC_CTYPE", "UTF-8");
    }
}

#[cfg(target_os = "macos")]
fn set_utf8_env_if_missing_or_non_utf8(cmd: &mut CommandBuilder, key: &str, default_value: &str) {
    let value = std::env::var(key)
        .ok()
        .filter(|value| is_utf8_locale(value))
        .unwrap_or_else(|| default_value.to_string());
    cmd.env(key, value);
}

#[cfg(target_os = "macos")]
fn is_utf8_locale(value: &str) -> bool {
    let normalized = value.to_ascii_lowercase().replace('_', "-");
    normalized.contains("utf-8") || normalized.contains("utf8")
}

fn infer_local_ai_execution_profile(shell_name: &str) -> AiExecutionProfile {
    let shell = shell_name.to_ascii_lowercase();
    if shell.contains("powershell") || shell.contains("pwsh") {
        AiExecutionProfile::Powershell
    } else if shell.contains("cmd") {
        AiExecutionProfile::Cmd
    } else if shell.contains("bash")
        || shell.contains("zsh")
        || shell.contains("fish")
        || shell.contains("wsl")
        || shell.ends_with("sh")
        || shell.contains("/sh")
        || shell.contains("\\sh")
    {
        AiExecutionProfile::Posix
    } else {
        AiExecutionProfile::SendOnly
    }
}
