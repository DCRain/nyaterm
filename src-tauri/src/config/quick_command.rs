use crate::error::AppResult;
use crate::storage::{self, SettingsDocKey};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

fn default_execute() -> String {
    "execute".to_string()
}

/// Single quick command (label + shell command).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuickCommand {
    pub id: String,
    pub label: String,
    pub command: String,
    #[serde(default)]
    pub category_id: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub color_tag: Option<String>,
    #[serde(default)]
    pub icon_tag: Option<String>,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default = "default_execute")]
    pub execution_mode: String,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub risk_level: Option<String>,
    #[serde(default)]
    pub updated_at: Option<u64>,
    #[serde(default)]
    pub created_at: Option<u64>,
    #[serde(default)]
    pub use_count: Option<u32>,
    #[serde(default)]
    pub sort_order: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuickCommandCategory {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub sort_order: i32,
}

/// List of quick commands persisted in local app storage.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct QuickCommandsConfig {
    pub commands: Vec<QuickCommand>,
    #[serde(default)]
    pub categories: Vec<QuickCommandCategory>,
}

fn builtin_command(
    id: &str,
    label: &str,
    command: &str,
    category_id: &str,
    description: &str,
    pinned: bool,
) -> QuickCommand {
    QuickCommand {
        id: id.to_string(),
        label: label.to_string(),
        command: command.to_string(),
        category_id: Some(category_id.to_string()),
        description: Some(description.to_string()),
        color_tag: None,
        icon_tag: None,
        pinned,
        execution_mode: default_execute(),
        source: Some("builtin".to_string()),
        risk_level: Some("low".to_string()),
        updated_at: None,
        created_at: None,
        use_count: None,
    }
}

/// Built-in quick commands seeded on first launch when no document exists yet.
pub fn default_quick_commands_config() -> QuickCommandsConfig {
    QuickCommandsConfig {
        categories: vec![
            QuickCommandCategory {
                id: "system".to_string(),
                name: "System".to_string(),
                parent_id: None,
                sort_order: 0,
            },
            QuickCommandCategory {
                id: "network".to_string(),
                name: "Network".to_string(),
                parent_id: None,
                sort_order: 1,
            },
            QuickCommandCategory {
                id: "docker".to_string(),
                name: "Docker".to_string(),
                parent_id: None,
                sort_order: 2,
            },
            QuickCommandCategory {
                id: "files".to_string(),
                name: "Files".to_string(),
                parent_id: None,
                sort_order: 3,
            },
        ],
        commands: vec![
            builtin_command(
                "builtin-ls",
                "List files",
                "ls -lah",
                "files",
                "List files with details",
                true,
            ),
            builtin_command(
                "builtin-pwd",
                "Print working directory",
                "pwd",
                "files",
                "Show the current directory",
                false,
            ),
            builtin_command(
                "builtin-df",
                "Disk usage",
                "df -h",
                "system",
                "Show filesystem disk space usage",
                true,
            ),
            builtin_command(
                "builtin-free",
                "Memory usage",
                "free -h",
                "system",
                "Display amount of free and used memory",
                false,
            ),
            builtin_command(
                "builtin-top",
                "Process overview",
                "top -bn1 | head -n 20",
                "system",
                "Show a one-shot process snapshot",
                false,
            ),
            builtin_command(
                "builtin-ps-grep",
                "Find process by keyword",
                "ps aux | grep -i '{{keyword}}' | grep -v grep",
                "system",
                "Search running processes by keyword",
                true,
            ),
            builtin_command(
                "builtin-uname",
                "System info",
                "uname -a",
                "system",
                "Print system information",
                false,
            ),
            builtin_command(
                "builtin-ip",
                "Network addresses",
                "ip -br a",
                "network",
                "Show brief interface addresses",
                true,
            ),
            builtin_command(
                "builtin-ss",
                "Listening ports",
                "ss -tuln",
                "network",
                "List listening TCP/UDP sockets",
                false,
            ),
            builtin_command(
                "builtin-port",
                "Who uses a port",
                "ss -tulnp 'sport = :{{port}}'",
                "network",
                "Show which process is listening on an exact TCP/UDP port",
                true,
            ),
            builtin_command(
                "builtin-ping",
                "Ping gateway check",
                "ping -c 4 1.1.1.1",
                "network",
                "Send four ICMP echoes to Cloudflare DNS",
                false,
            ),
            builtin_command(
                "builtin-docker-ps",
                "Docker containers",
                "docker ps",
                "docker",
                "List running containers",
                true,
            ),
            builtin_command(
                "builtin-docker-images",
                "Docker images",
                "docker images",
                "docker",
                "List local Docker images",
                false,
            ),
        ],
    }
}

/// Loads quick commands from local app storage.
pub fn load_quick_commands(app: &AppHandle) -> AppResult<QuickCommandsConfig> {
    let _ = app;
    storage::load_settings_doc(SettingsDocKey::QuickCommands)
}

/// Loads quick commands, seeding built-in defaults when the document has never existed.
///
/// An existing empty document (user cleared all commands) is preserved and not re-seeded.
pub fn load_or_seed_quick_commands(app: &AppHandle) -> AppResult<QuickCommandsConfig> {
    let _ = app;
    if let Some(config) = storage::try_load_settings_doc(SettingsDocKey::QuickCommands)? {
        return Ok(config);
    }

    let config = default_quick_commands_config();
    storage::save_settings_doc(SettingsDocKey::QuickCommands, &config)?;
    Ok(config)
}

/// Merge missing built-in categories/commands into an existing config.
///
/// Missing ids are added. Existing items that still have `source = "builtin"`
/// get their command/description refreshed from the current defaults so built-in
/// fixes can be applied without overwriting user-customized entries.
pub fn merge_missing_builtin_quick_commands(
    config: &mut QuickCommandsConfig,
) -> QuickCommandsRestoreResult {
    let defaults = default_quick_commands_config();
    let mut added_categories = 0usize;
    let mut added_commands = 0usize;
    let mut updated_commands = 0usize;

    for category in defaults.categories {
        if config
            .categories
            .iter()
            .any(|existing| existing.id == category.id)
        {
            continue;
        }
        config.categories.push(category);
        added_categories += 1;
    }

    for command in defaults.commands {
        if let Some(existing) = config
            .commands
            .iter_mut()
            .find(|existing| existing.id == command.id)
        {
            if existing.source.as_deref() == Some("builtin")
                && (existing.command != command.command
                    || existing.description != command.description
                    || existing.label != command.label)
            {
                existing.command = command.command;
                existing.description = command.description;
                existing.label = command.label;
                existing.risk_level = command.risk_level;
                existing.execution_mode = command.execution_mode;
                existing.pinned = command.pinned;
                updated_commands += 1;
            }
            continue;
        }
        config.commands.push(command);
        added_commands += 1;
    }

    QuickCommandsRestoreResult {
        added_commands,
        added_categories,
        updated_commands,
        total_commands: config.commands.len(),
        total_categories: config.categories.len(),
    }
}

/// Result of restoring built-in quick commands into an existing config.
#[derive(Debug, Clone, Serialize)]
pub struct QuickCommandsRestoreResult {
    pub added_commands: usize,
    pub added_categories: usize,
    pub updated_commands: usize,
    pub total_commands: usize,
    pub total_categories: usize,
}

/// Saves quick commands to local app storage.
pub fn save_quick_commands(app: &AppHandle, config: &QuickCommandsConfig) -> AppResult<()> {
    let _ = app;
    storage::save_settings_doc(SettingsDocKey::QuickCommands, config)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn default_quick_commands_have_unique_ids_and_valid_categories() {
        let config = default_quick_commands_config();

        assert!(!config.commands.is_empty());
        assert!(!config.categories.is_empty());

        let category_ids: HashSet<&str> = config
            .categories
            .iter()
            .map(|category| category.id.as_str())
            .collect();
        assert_eq!(category_ids.len(), config.categories.len());

        let command_ids: HashSet<&str> =
            config.commands.iter().map(|command| command.id.as_str()).collect();
        assert_eq!(command_ids.len(), config.commands.len());

        for command in &config.commands {
            let category_id = command
                .category_id
                .as_deref()
                .expect("builtin command should have a category");
            assert!(
                category_ids.contains(category_id),
                "missing category {} for {}",
                category_id,
                command.id
            );
            assert_eq!(command.source.as_deref(), Some("builtin"));
            assert_eq!(command.risk_level.as_deref(), Some("low"));
            assert_eq!(command.execution_mode, "execute");
            assert!(!command.command.is_empty());
            assert!(!command.label.is_empty());
        }

        let by_id: std::collections::HashMap<&str, &QuickCommand> = config
            .commands
            .iter()
            .map(|command| (command.id.as_str(), command))
            .collect();
        assert!(
            by_id["builtin-ps-grep"]
                .command
                .contains("{{keyword}}")
        );
        assert!(
            by_id["builtin-port"]
                .command
                .contains("sport = :{{port}}")
        );
        assert!(!by_id["builtin-port"].command.contains("grep"));
    }

    #[test]
    fn merge_refreshes_unmodified_builtin_command_text() {
        let mut config = default_quick_commands_config();
        let port = config
            .commands
            .iter_mut()
            .find(|command| command.id == "builtin-port")
            .expect("port command");
        port.command = "ss -tulnp | grep ':{{port}}'".to_string();

        let result = merge_missing_builtin_quick_commands(&mut config);
        assert_eq!(result.updated_commands, 1);
        assert_eq!(result.added_commands, 0);
        let refreshed = config
            .commands
            .iter()
            .find(|command| command.id == "builtin-port")
            .expect("port command");
        assert!(refreshed.command.contains("sport = :{{port}}"));
    }

    #[test]
    fn merge_missing_builtins_adds_only_absent_items() {
        let mut config = default_quick_commands_config();
        config.commands.retain(|command| command.id != "builtin-ls");
        config.categories.retain(|category| category.id != "docker");
        config
            .commands
            .retain(|command| command.category_id.as_deref() != Some("docker"));

        let before_commands = config.commands.len();
        let before_categories = config.categories.len();
        let result = merge_missing_builtin_quick_commands(&mut config);

        assert_eq!(result.added_commands, 1 + 2); // ls + two docker commands
        assert_eq!(result.added_categories, 1);
        assert_eq!(config.commands.len(), before_commands + result.added_commands);
        assert_eq!(
            config.categories.len(),
            before_categories + result.added_categories
        );
        assert!(config.commands.iter().any(|command| command.id == "builtin-ls"));
        assert!(config.categories.iter().any(|category| category.id == "docker"));

        let second = merge_missing_builtin_quick_commands(&mut config);
        assert_eq!(second.added_commands, 0);
        assert_eq!(second.added_categories, 0);
    }
}
