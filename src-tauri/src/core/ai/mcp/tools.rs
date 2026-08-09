use serde::Deserialize;
use serde_json::{Value, json};

use crate::core::ai::types::{AiChatRequest, CommandObservation};

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteCommandArgs {
    pub command: String,
    #[serde(default)]
    pub target_terminal_session_id: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
}

pub fn is_nyaterm_mcp_enabled(mode: Option<&str>) -> bool {
    mode.map(str::trim)
        .filter(|value| !value.is_empty())
        .is_none_or(|value| value.eq_ignore_ascii_case("nyaterm_mcp"))
}

pub fn parse_execute_command_args(arguments: &Value) -> Result<ExecuteCommandArgs, String> {
    let mut args: ExecuteCommandArgs = serde_json::from_value(arguments.clone())
        .map_err(|error| format!("Invalid execute_command arguments: {error}"))?;
    args.command = args.command.trim().to_string();
    if args.command.is_empty() {
        return Err("terminal command is required".to_string());
    }
    if let Some(target) = args.target_terminal_session_id.as_mut() {
        let trimmed = target.trim().to_string();
        if trimmed.is_empty() {
            args.target_terminal_session_id = None;
        } else {
            *target = trimmed;
        }
    }
    if let Some(reason) = args.reason.as_mut() {
        let trimmed = reason.trim().to_string();
        if trimmed.is_empty() {
            args.reason = None;
        } else {
            *reason = trimmed;
        }
    }
    Ok(args)
}

pub fn resolve_command_target(
    request: &AiChatRequest,
    explicit: Option<&str>,
) -> Result<Option<String>, String> {
    if let Some(target) = explicit.map(str::trim).filter(|value| !value.is_empty()) {
        return Ok(Some(target.to_string()));
    }
    if let Some(target) = request
        .terminal_session_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Ok(Some(target.to_string()));
    }
    if let Some(target) = request
        .default_target_session_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Ok(Some(target.to_string()));
    }
    if request.targets.len() == 1 {
        return Ok(Some(request.targets[0].terminal_session_id.clone()));
    }
    Err("targetTerminalSessionId is required when multiple terminals are available".to_string())
}

pub fn terminal_context_text(request: &AiChatRequest) -> String {
    serde_json::to_string_pretty(&json!({
        "primaryContext": request.context,
        "targets": request.targets,
        "targetContexts": request.target_contexts,
        "defaultTerminalSessionId": request
            .terminal_session_id
            .as_ref()
            .or(request.default_target_session_id.as_ref()),
        "instruction": "Use nyaterm_terminal.execute_command for NyaTerm terminal actions. Prefer these tools over local shell/bash when changing the user's terminal cwd or running commands in their pane. Do not use local shell/file tools for the user's remote terminal."
    }))
    .unwrap_or_else(|_| "Terminal context unavailable".to_string())
}

pub fn observation_text(observation: &CommandObservation) -> String {
    serde_json::to_string_pretty(observation).unwrap_or_else(|_| observation.output.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::ai::types::{AiAction, AiContext, AiRequestOptions, AiTerminalTarget};

    fn sample_request(terminal_session_id: Option<&str>) -> AiChatRequest {
        AiChatRequest {
            stream_id: None,
            session_id: None,
            connection_id: None,
            terminal_session_id: terminal_session_id.map(str::to_string),
            owner_scope: Default::default(),
            targets: vec![],
            target_contexts: vec![],
            mode: crate::config::AiMode::Agent,
            agent_kind: crate::config::AiAgentKind::OpenCode,
            permission_mode: crate::config::AiPermissionMode::Confirm,
            model_id: None,
            model_name: None,
            default_target_session_id: None,
            existing_external_session_id: None,
            attachments: vec![],
            action: AiAction::GenerateCommand,
            user_input: "cd D:".into(),
            context: AiContext::default(),
            options: AiRequestOptions::default(),
        }
    }

    #[test]
    fn parses_execute_command_args_and_trims() {
        let args = parse_execute_command_args(&json!({
            "command": "  Set-Location D:  ",
            "targetTerminalSessionId": "  sess-1  ",
            "reason": " switch drive "
        }))
        .expect("args");
        assert_eq!(args.command, "Set-Location D:");
        assert_eq!(args.target_terminal_session_id.as_deref(), Some("sess-1"));
        assert_eq!(args.reason.as_deref(), Some("switch drive"));
    }

    #[test]
    fn resolve_target_falls_back_to_terminal_session_id() {
        let request = sample_request(Some("term-a"));
        let target = resolve_command_target(&request, None).expect("target");
        assert_eq!(target.as_deref(), Some("term-a"));
    }

    #[test]
    fn resolve_target_requires_id_when_multiple_targets() {
        let mut request = sample_request(None);
        request.targets = vec![
            AiTerminalTarget {
                terminal_session_id: "a".into(),
                connection_id: None,
                label: "A".into(),
                host: None,
                username: None,
                session_type: "local".into(),
            },
            AiTerminalTarget {
                terminal_session_id: "b".into(),
                connection_id: None,
                label: "B".into(),
                host: None,
                username: None,
                session_type: "local".into(),
            },
        ];
        assert!(resolve_command_target(&request, None).is_err());
        let target = resolve_command_target(&request, Some("b")).expect("target");
        assert_eq!(target.as_deref(), Some("b"));
    }

    #[test]
    fn nyaterm_mcp_enabled_defaults_true() {
        assert!(is_nyaterm_mcp_enabled(None));
        assert!(is_nyaterm_mcp_enabled(Some("nyaterm_mcp")));
        assert!(!is_nyaterm_mcp_enabled(Some("none")));
    }
}
