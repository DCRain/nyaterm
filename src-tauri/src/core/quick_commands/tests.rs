#[cfg(test)]
mod tests {
    use super::*;

    fn empty_config() -> QuickCommandsConfig {
        QuickCommandsConfig {
            commands: Vec::new(),
            categories: Vec::new(),
        }
    }

    fn import_windterm_commands(raw: &str) -> QuickCommandsConfig {
        let import_config = parse_windterm_quickbar(raw).unwrap();
        let mut config = empty_config();
        merge_import(&mut config, import_config).unwrap();
        config
    }

    #[test]
    fn imports_nyaterm_config_json() {
        let raw = r#"{
            "categories": [{"id": "general", "name": "General"}],
            "commands": [{
                "id": "cmd-list",
                "label": "List",
                "command": "ls -la",
                "category_id": "general",
                "execution_mode": "execute",
                "source": "manual",
                "risk_level": "low"
            }]
        }"#;
        let import_config = parse_nyaterm_import(raw).unwrap();
        let mut config = empty_config();

        let stats = merge_import(&mut config, import_config).unwrap();

        assert_eq!(stats.added_commands, 1);
        assert_eq!(stats.added_categories, 1);
        assert_eq!(config.commands[0].label, "List");
        assert_eq!(config.commands[0].category_id.as_deref(), Some("general"));
    }

    #[test]
    fn imports_nyaterm_command_array_json() {
        let raw = r#"[{"label":"Pods","command":"kubectl get pods -A","category":"Kubernetes","execution_mode":"append"}]"#;
        let import_config = parse_nyaterm_import(raw).unwrap();
        let mut config = empty_config();

        let stats = merge_import(&mut config, import_config).unwrap();

        assert_eq!(stats.added_commands, 1);
        assert_eq!(stats.added_categories, 1);
        assert_eq!(config.commands[0].execution_mode, "append");
        assert_eq!(config.categories[0].name, "Kubernetes");
    }

    #[test]
    fn imports_windterm_quickbar_json() {
        let raw = r#"[{
            "quick.group": "快速",
            "quick.icon": "session::arrow-coral",
            "quick.label": "miniconda3 安装",
            "quick.text": "echo install",
            "quick.type": "Send Text",
            "quick.uuid": "70127d80-24b8-46eb-958d-f944c5e423dd"
        }]"#;
        let import_config = parse_windterm_quickbar(raw).unwrap();
        let mut config = empty_config();

        let stats = merge_import(&mut config, import_config).unwrap();

        assert_eq!(stats.added_commands, 1);
        assert_eq!(stats.added_categories, 1);
        assert_eq!(
            config.commands[0].id,
            "70127d80-24b8-46eb-958d-f944c5e423dd"
        );
        assert_eq!(config.commands[0].label, "miniconda3 安装");
        assert_eq!(config.commands[0].command, "echo install");
        assert_eq!(config.commands[0].execution_mode, "append");
        assert_eq!(config.categories[0].name, "快速");
    }

    #[test]
    fn parses_windterm_command_terminator() {
        assert_eq!(split_windterm_command("pwd"), ("pwd", false));
        assert_eq!(split_windterm_command("pwd\n"), ("pwd", true));
        assert_eq!(split_windterm_command("pwd\r"), ("pwd", true));
        assert_eq!(split_windterm_command("pwd\r\n"), ("pwd", true));
        assert_eq!(split_windterm_command("pwd\n\n"), ("pwd\n", true));
    }

    #[test]
    fn imports_windterm_command_with_lf_as_execute() {
        let config = import_windterm_commands(
            r#"[{
                "quick.label": "List",
                "quick.text": "ls -la\n",
                "quick.type": "Send Text"
            }]"#,
        );

        assert_eq!(config.commands.len(), 1);
        assert_eq!(config.commands[0].command, "ls -la");
        assert_eq!(config.commands[0].execution_mode, "execute");
    }

    #[test]
    fn imports_windterm_command_with_crlf_as_execute() {
        let config = import_windterm_commands(
            r#"[{
                "quick.label": "List",
                "quick.text": "ls -la\r\n",
                "quick.type": "Send Text"
            }]"#,
        );

        assert_eq!(config.commands.len(), 1);
        assert_eq!(config.commands[0].command, "ls -la");
        assert_eq!(config.commands[0].execution_mode, "execute");
    }

    #[test]
    fn imports_windterm_command_with_cr_as_execute() {
        let config = import_windterm_commands(
            r#"[{
                "quick.label": "Show Version",
                "quick.text": "show version\r",
                "quick.type": "Send Text"
            }]"#,
        );

        assert_eq!(config.commands.len(), 1);
        assert_eq!(config.commands[0].command, "show version");
        assert_eq!(config.commands[0].execution_mode, "execute");
    }

    #[test]
    fn imports_windterm_multiline_command_with_terminal_newline_as_execute() {
        let config = import_windterm_commands(
            r#"[{
                "quick.label": "Two Lines",
                "quick.text": "echo first\necho second\n",
                "quick.type": "Send Text"
            }]"#,
        );

        assert_eq!(config.commands.len(), 1);
        assert_eq!(config.commands[0].command, "echo first\necho second");
        assert_eq!(config.commands[0].execution_mode, "execute");
    }

    #[test]
    fn imports_windterm_command_with_double_lf_by_removing_only_one() {
        let config = import_windterm_commands(
            r#"[{
                "quick.label": "Double Enter",
                "quick.text": "echo test\n\n",
                "quick.type": "Send Text"
            }]"#,
        );

        assert_eq!(config.commands.len(), 1);
        assert_eq!(config.commands[0].command, "echo test\n");
        assert_eq!(config.commands[0].execution_mode, "execute");
    }

    #[test]
    fn windterm_ignores_whitespace_only_commands() {
        let import_config = parse_windterm_quickbar(
            r#"[
                {"quick.label":"Blank CRLF","quick.text":"\r\n","quick.type":"Send Text"},
                {"quick.label":"Blank Spaces","quick.text":"   \n","quick.type":"Send Text"}
            ]"#,
        )
        .unwrap();

        assert!(import_config.commands.is_empty());
    }

    #[test]
    fn imports_xshell_quick_buttons_type_one_only() {
        let raw = r#"[Info]
Version=8.2
Count=3
Expanded=1
[QuickButton]
Button_0_Name=测试
Button_1_Name=TEST
Button_2_Name=Ignored
Button_0_Type=1
Button_1_Type=1
Button_2_Type=2
Button_0_Action=ls -la
Button_1_Action=pwd
Button_2_Action=whoami
"#;
        let import_config = parse_xshell_quick_buttons_content(raw);
        let mut config = empty_config();

        let stats = merge_import(&mut config, import_config).unwrap();

        assert_eq!(stats.added_commands, 2);
        assert_eq!(config.commands[0].label, "测试");
        assert_eq!(config.commands[0].command, "ls -la");
        assert_eq!(config.commands[0].execution_mode, "append");
        assert_eq!(config.commands[1].label, "TEST");
        assert_eq!(config.commands[1].command, "pwd");
    }

    #[test]
    fn updates_same_id_and_preserves_created_at_and_use_count() {
        let mut config = QuickCommandsConfig {
            commands: vec![QuickCommand {
                id: "same".to_string(),
                label: "Old".to_string(),
                command: "old".to_string(),
                category_id: None,
                description: None,
                color_tag: None,
                icon_tag: None,
                pinned: false,
                execution_mode: "execute".to_string(),
                source: Some("manual".to_string()),
                risk_level: None,
                updated_at: Some(10),
                created_at: Some(5),
                use_count: Some(7),
            }],
            categories: Vec::new(),
        };
        let import_config = parse_nyaterm_import(
            r#"[{"id":"same","label":"New","command":"new","execution_mode":"append"}]"#,
        )
        .unwrap();

        let stats = merge_import(&mut config, import_config).unwrap();

        assert_eq!(stats.added_commands, 0);
        assert_eq!(stats.updated_commands, 1);
        assert_eq!(config.commands[0].label, "New");
        assert_eq!(config.commands[0].created_at, Some(5));
        assert_eq!(config.commands[0].use_count, Some(7));
        assert_eq!(config.commands[0].execution_mode, "append");
    }

    #[test]
    fn rejects_invalid_execution_mode() {
        let import_config =
            parse_nyaterm_import(r#"[{"label":"Bad","command":"bad","execution_mode":"run"}]"#)
                .unwrap();
        let mut config = empty_config();

        let error = merge_import(&mut config, import_config).unwrap_err();

        assert!(error.to_string().contains("command.execution_mode"));
    }

    #[test]
    fn windterm_without_valid_commands_is_empty() {
        let import_config = parse_windterm_quickbar(
            r#"[{"quick.label":"","quick.text":"echo no"},{"quick.label":"No text"}]"#,
        )
        .unwrap();

        assert!(import_config.commands.is_empty());
    }
}
