#[cfg(test)]
mod tests {
    use super::configure_local_pty_environment;
    #[cfg(target_os = "macos")]
    use super::is_utf8_locale;
    use super::{
        build_local_startup_script_for_platform, parse_shell_args, resolve_shell_command,
        should_emit_visible_output,
    };
    use crate::core::ssh::osc::build_ready_marker;
    use portable_pty::CommandBuilder;

    fn ready_marker() -> String {
        build_ready_marker("session-1")
    }

    #[test]
    fn shell_path_with_spaces_stays_single_program() {
        let spec =
            resolve_shell_command(r"D:\Soft wares\Git\bin\bash.exe", "").expect("command spec");

        assert_eq!(spec.program, r"D:\Soft wares\Git\bin\bash.exe");
        assert!(spec.args.is_empty());
    }

    #[test]
    fn shell_args_are_split_separately_from_program() {
        let spec = resolve_shell_command("pwsh.exe", "-NoLogo -NoExit").expect("command spec");

        assert!(
            spec.program.ends_with("pwsh.exe"),
            "program was {}",
            spec.program
        );
        assert_eq!(spec.args, vec!["-NoLogo", "-NoExit"]);
    }

    #[test]
    fn unix_bash_defaults_to_login_interactive_when_args_are_empty() {
        let spec = resolve_shell_command("/bin/bash", "").expect("command spec");

        assert_eq!(spec.program, "/bin/bash");
        if cfg!(windows) {
            assert!(spec.args.is_empty());
        } else {
            assert_eq!(spec.args, vec!["--login", "-i"]);
        }
    }

    #[test]
    fn explicit_shell_args_override_unix_interactive_defaults() {
        let spec = resolve_shell_command("/bin/bash", "--noprofile --norc").expect("command spec");

        assert_eq!(spec.program, "/bin/bash");
        assert_eq!(spec.args, vec!["--noprofile", "--norc"]);
    }

    #[test]
    fn legacy_shell_path_command_with_args_is_still_supported() {
        let spec = resolve_shell_command("pwsh.exe -NoLogo", "").expect("command spec");

        assert!(
            spec.program.ends_with("pwsh.exe"),
            "program was {}",
            spec.program
        );
        assert_eq!(spec.args, vec!["-NoLogo"]);
    }

    #[test]
    fn windows_builtin_shell_names_resolve_to_spawnable_programs() {
        if !cfg!(windows) {
            return;
        }

        for shell in ["cmd.exe", "powershell.exe"] {
            let spec = resolve_shell_command(shell, "").expect("command spec");

            assert!(
                spec.program.contains('\\') || spec.program.contains('/'),
                "{shell} should resolve to an absolute executable path, got {}",
                spec.program
            );
            assert!(
                spec.program.to_ascii_lowercase().ends_with(shell),
                "{shell} resolved to unexpected program {}",
                spec.program
            );
        }
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn windows_terminal_alias_does_not_spawn_wt_host() {
        let spec = resolve_shell_command("wt.exe", "").expect("command spec");

        assert!(
            !spec.program.to_ascii_lowercase().ends_with("wt.exe"),
            "wt.exe should resolve to an embeddable shell, got {}",
            spec.program
        );
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn windows_terminal_profile_commandline_is_parsed_as_shell_spec() {
        let spec = super::shell_spec_from_windows_commandline(
            r#"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe -NoLogo"#,
            vec!["-NoExit".to_string()],
        )
        .expect("command spec");

        assert!(
            spec.program
                .to_ascii_lowercase()
                .ends_with("powershell.exe"),
            "program was {}",
            spec.program
        );
        assert_eq!(spec.args, vec!["-NoLogo", "-NoExit"]);
    }

    #[test]
    fn shell_args_support_quotes_and_windows_paths() {
        let args = parse_shell_args(r#"-Command "echo hi" "C:\Program Files\Tool""#).expect("args");

        assert_eq!(args, vec!["-Command", "echo hi", r"C:\Program Files\Tool"]);
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn utf8_locale_detection_accepts_common_spellings() {
        assert!(is_utf8_locale("en_US.UTF-8"));
        assert!(is_utf8_locale("zh_CN.utf8"));
        assert!(!is_utf8_locale("C"));
        assert!(!is_utf8_locale("zh_CN.GBK"));
    }

    #[test]
    fn local_pty_environment_sets_terminal() {
        let shell = if cfg!(target_os = "windows") {
            "powershell.exe"
        } else if cfg!(target_os = "macos") {
            "/bin/zsh"
        } else {
            "/bin/bash"
        };
        let mut cmd = CommandBuilder::new(shell);
        configure_local_pty_environment(&mut cmd);

        assert_eq!(
            cmd.get_env("TERM").and_then(|value| value.to_str()),
            Some("xterm-256color")
        );
        assert_eq!(
            cmd.get_env("COLORTERM").and_then(|value| value.to_str()),
            Some("truecolor")
        );
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn local_pty_environment_sets_utf8_locale() {
        let mut cmd = CommandBuilder::new("/bin/zsh");
        configure_local_pty_environment(&mut cmd);

        assert!(
            cmd.get_env("LANG")
                .and_then(|value| value.to_str())
                .is_some_and(is_utf8_locale)
        );
        assert!(
            cmd.get_env("LC_CTYPE")
                .and_then(|value| value.to_str())
                .is_some_and(is_utf8_locale)
        );
    }

    #[test]
    fn startup_suppression_hides_chunks_until_ready_marker() {
        let mut suppress_visible = true;

        assert!(!should_emit_visible_output(&mut suppress_visible, false));
        assert!(suppress_visible);
    }

    #[test]
    fn startup_suppression_emits_visible_text_from_ready_chunk() {
        let mut suppress_visible = true;

        assert!(should_emit_visible_output(&mut suppress_visible, true));
        assert!(!suppress_visible);
    }

    #[test]
    fn startup_suppression_emits_subsequent_chunks_after_ready() {
        let mut suppress_visible = true;

        assert!(should_emit_visible_output(&mut suppress_visible, true));
        assert!(should_emit_visible_output(&mut suppress_visible, false));
        assert!(!suppress_visible);
    }

    #[test]
    fn local_startup_does_not_inject_supported_unix_shells() {
        let marker = ready_marker();

        for shell in ["/bin/bash", "/bin/zsh", "/usr/local/bin/fish", "/bin/sh"] {
            let startup = build_local_startup_script_for_platform(shell, &marker, true);

            assert!(!startup.shell_integration_active);
            assert!(
                startup.script.is_none(),
                "{shell} should not receive a startup script"
            );
        }
    }

    #[test]
    fn local_startup_does_not_inject_unknown_or_windows_style_shells() {
        let marker = ready_marker();

        for shell in ["nu", "powershell.exe", r"C:\Windows\System32\cmd.exe"] {
            let startup = build_local_startup_script_for_platform(shell, &marker, true);

            assert!(!startup.shell_integration_active);
            assert!(
                startup.script.is_none(),
                "{shell} should not receive a startup script"
            );
        }
    }

    #[test]
    fn local_startup_does_not_inject_when_unix_prelude_is_disabled() {
        let marker = ready_marker();
        let startup = build_local_startup_script_for_platform("/bin/zsh", &marker, false);

        assert!(!startup.shell_integration_active);
        assert!(startup.script.is_none());
    }
}
