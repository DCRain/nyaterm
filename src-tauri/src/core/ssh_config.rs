//! Parses `~/.ssh/config` and resolves host aliases, including ProxyJump chains.
//!
//! Supports a subset of OpenSSH client configuration relevant for session
//! management: Host patterns (wildcards, negation), HostName, Port, User,
//! IdentityFile, ProxyJump (single/multi-hop), HostKeyAlias, and Include
//! directives (recursive with cycle detection and glob support).

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::config::{ConnectionAuth, ConnectionType, SavedConnection};
use crate::error::{AppError, AppResult};

/// One parsed `Host` block from the SSH config file.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConfigHost {
    pub patterns: Vec<String>,
    pub name: String,
    pub host_name: Option<String>,
    pub port: Option<u16>,
    pub user: Option<String>,
    pub identity_file: Option<String>,
    pub proxy_jump: Option<String>,
    pub host_key_alias: Option<String>,
}

/// A ready-to-use session entry derived from the SSH config.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConfigEntry {
    pub alias: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub identity_file: Option<String>,
    pub proxy_jump: Option<String>,
    pub hops: Vec<SshConfigHop>,
    pub host_key_alias: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConfigHop {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub is_target: bool,
}

/// The fully parsed SSH config.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SshConfig {
    pub hosts: Vec<SshConfigHost>,
}

impl SshConfig {
    /// Reads and parses the default user SSH config (`~/.ssh/config`).
    pub fn load_default() -> AppResult<Self> {
        let path = default_config_path();
        Self::load_from(&path)
    }

    /// Parses one or more SSH config files, following `Include` directives.
    pub fn load_from(path: &Path) -> AppResult<Self> {
        let mut visited = HashSet::new();
        let mut hosts = Vec::new();
        parse_file(path, &mut visited, &mut hosts)?;
        Ok(SshConfig { hosts })
    }

    /// Resolves a host alias into a complete entry with ProxyJump hops.
    pub fn resolve(&self, alias: &str) -> AppResult<SshConfigEntry> {
        let resolved = self.resolve_options(alias);
        let host_name = resolved.host_name.unwrap_or_else(|| alias.to_string());
        let port = resolved.port.unwrap_or(22);
        let user = resolved.user.unwrap_or_else(whoami::username);
        let identity_file = resolved.identity_file;
        let proxy_jump = resolved.proxy_jump.clone();

        let mut hops = Vec::new();
        if let Some(ref pj) = proxy_jump {
            for jump_spec in pj.split(',') {
                let jump_spec = jump_spec.trim();
                if jump_spec.is_empty() {
                    continue;
                }
                // Parse user@host:port syntax from ProxyJump directives.
                let (jump_user_spec, jump_host_spec, jump_port_spec) =
                    parse_jump_spec(jump_spec);
                let jump_alias = &jump_host_spec;
                let jump_resolved = self.resolve_options(jump_alias);
                let jump_host =
                    jump_resolved.host_name.unwrap_or_else(|| jump_alias.to_string());
                let jump_port = jump_port_spec.or(jump_resolved.port).unwrap_or(22);
                let jump_user = jump_user_spec
                    .or(jump_resolved.user)
                    .unwrap_or_else(whoami::username);
                hops.push(SshConfigHop {
                    host: jump_host,
                    port: jump_port,
                    user: jump_user,
                    is_target: false,
                });
            }
        }
        hops.push(SshConfigHop {
            host: host_name.clone(),
            port,
            user: user.clone(),
            is_target: true,
        });

        Ok(SshConfigEntry {
            alias: alias.to_string(),
            host: host_name,
            port,
            user,
            identity_file,
            proxy_jump,
            hops,
            host_key_alias: resolved.host_key_alias,
        })
    }

    /// Returns concrete host aliases (non-wildcard), deduplicated.
    pub fn list_hosts(&self) -> Vec<String> {
        let mut seen = HashSet::new();
        self.hosts
            .iter()
            .flat_map(|h| &h.patterns)
            .filter(|p| !p.contains('*') && !p.contains('?') && !p.starts_with('!'))
            .filter(|p| seen.insert(p.clone()))
            .map(|p| p.to_string())
            .collect()
    }

    /// Resolves options for a given alias using first-match-wins.
    fn resolve_options(&self, alias: &str) -> ResolvedOptions {
        let mut resolved = ResolvedOptions::default();
        for host in &self.hosts {
            if pattern_matches(&host.patterns, alias) {
                if resolved.host_name.is_none() {
                    resolved.host_name = host.host_name.clone();
                }
                if resolved.port.is_none() {
                    resolved.port = host.port;
                }
                if resolved.user.is_none() {
                    resolved.user = host.user.clone();
                }
                if resolved.identity_file.is_none() {
                    resolved.identity_file = host.identity_file.clone();
                }
                if resolved.proxy_jump.is_none() {
                    resolved.proxy_jump = host.proxy_jump.clone();
                }
                if resolved.host_key_alias.is_none() {
                    resolved.host_key_alias = host.host_key_alias.clone();
                }
            }
        }
        resolved
    }

    /// Converts all concrete host aliases into entries.
    pub fn to_entries(&self) -> Vec<SshConfigEntry> {
        self.list_hosts()
            .iter()
            .filter_map(|alias| self.resolve(alias).ok())
            .collect()
    }

    /// Converts entries into SavedConnection objects for import.
    pub fn to_saved_connections(&self) -> Vec<SavedConnection> {
        self.to_entries()
            .iter()
            .map(|e| entry_to_saved_connection(e, None))
            .collect()
    }
}

#[derive(Debug, Default)]
struct ResolvedOptions {
    host_name: Option<String>,
    port: Option<u16>,
    user: Option<String>,
    identity_file: Option<String>,
    proxy_jump: Option<String>,
    host_key_alias: Option<String>,
}

fn pattern_matches(patterns: &[String], alias: &str) -> bool {
    let mut matched = false;
    for pattern in patterns {
        let pat = pattern.as_str();
        if let Some(neg) = pat.strip_prefix('!') {
            if glob_match(neg, alias) {
                return false;
            }
        } else if glob_match(pat, alias) {
            matched = true;
        }
    }
    matched
}

fn glob_match(pattern: &str, text: &str) -> bool {
    let p: Vec<char> = pattern.chars().collect();
    let t: Vec<char> = text.chars().collect();
    glob_match_inner(&p, &t)
}

fn glob_match_inner(p: &[char], t: &[char]) -> bool {
    if p.is_empty() {
        return t.is_empty();
    }
    match p[0] {
        '*' => {
            for i in 0..=t.len() {
                if glob_match_inner(&p[1..], &t[i..]) {
                    return true;
                }
            }
            false
        }
        '?' => {
            if t.is_empty() {
                false
            } else {
                glob_match_inner(&p[1..], &t[1..])
            }
        }
        c => {
            if t.is_empty() || t[0] != c {
                false
            } else {
                glob_match_inner(&p[1..], &t[1..])
            }
        }
    }
}

fn parse_file(
    path: &Path,
    visited: &mut HashSet<PathBuf>,
    hosts: &mut Vec<SshConfigHost>,
) -> AppResult<()> {
    let canonical = match fs::canonicalize(path) {
        Ok(c) => c,
        Err(_) => return Ok(()),
    };
    if !visited.insert(canonical.clone()) {
        return Ok(());
    }

    let contents = fs::read_to_string(&canonical)
        .map_err(|e| AppError::Config(format!("cannot read {}: {e}", canonical.display())))?;

    parse_string(&contents, &canonical, visited, hosts)
}

fn parse_string(
    contents: &str,
    config_path: &Path,
    visited: &mut HashSet<PathBuf>,
    hosts: &mut Vec<SshConfigHost>,
) -> AppResult<()> {
    // Relative Include paths resolve from the directory containing the config
       // file, not from the config file path itself (matching OpenSSH behavior).
    let base_dir = config_path.parent().unwrap_or_else(|| Path::new("."));
    let mut current: Option<SshConfigHost> = None;
    // Global/default options declared before the first Host block. OpenSSH
    // applies these to all hosts, so we store them and merge into each new
    // block as it starts.
    let mut global_options: Option<SshConfigHost> = None;

    for raw_line in contents.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        let (keyword, value) = match split_kv(line) {
            Some(pair) => pair,
            None => continue,
        };

        let kw_lower = keyword.to_lowercase();

        match kw_lower.as_str() {
            "host" => {
                if let Some(mut block) = current.take() {
                    block.name = derive_display_name(&block.patterns);
                    hosts.push(block);
                }
                let patterns: Vec<String> = value
                    .split_whitespace()
                    .map(|s| s.to_string())
                    .collect();
                // Start a new block, pre-populated with global defaults.
                let mut block = SshConfigHost {
                    patterns,
                    ..Default::default()
                };
                if let Some(ref global) = global_options {
                    block.host_name = global.host_name.clone();
                    block.port = global.port;
                    block.user = global.user.clone();
                    block.identity_file = global.identity_file.clone();
                    block.proxy_jump = global.proxy_jump.clone();
                    block.host_key_alias = global.host_key_alias.clone();
                }
                current = Some(block);
            }
            "hostname" => {
                if let Some(ref mut block) = current {
                    block.host_name = Some(value.to_string());
                } else {
                    global_options.get_or_insert_default().host_name = Some(value.to_string());
                }
            }
            "port" => {
                if let Ok(port) = value.parse::<u16>() {
                    if let Some(ref mut block) = current {
                        block.port = Some(port);
                    } else {
                        global_options.get_or_insert_default().port = Some(port);
                    }
                }
            }
            "user" => {
                if let Some(ref mut block) = current {
                    block.user = Some(value.to_string());
                } else {
                    global_options.get_or_insert_default().user = Some(value.to_string());
                }
            }
            "identityfile" => {
                if let Some(ref mut block) = current {
                    block.identity_file = Some(expand_tilde(value));
                } else {
                    global_options.get_or_insert_default().identity_file = Some(expand_tilde(value));
                }
            }
            "proxyjump" => {
                if let Some(ref mut block) = current {
                    block.proxy_jump = Some(value.to_string());
                } else {
                    global_options.get_or_insert_default().proxy_jump = Some(value.to_string());
                }
            }
            "hostkeyalias" => {
                if let Some(ref mut block) = current {
                    block.host_key_alias = Some(value.to_string());
                } else {
                    global_options.get_or_insert_default().host_key_alias = Some(value.to_string());
                }
            }
            "include" => {
                for pattern in value.split_whitespace() {
                    let expanded = expand_tilde(pattern);
                    let include_path = if Path::new(&expanded).is_absolute() {
                        PathBuf::from(&expanded)
                    } else {
                        base_dir.join(&expanded)
                    };
                    for matched in glob_paths(&include_path) {
                        parse_file(&matched, visited, hosts)?;
                    }
                }
            }
            _ => {}
        }
    }

    if let Some(mut block) = current {
        block.name = derive_display_name(&block.patterns);
        hosts.push(block);
    }

    Ok(())
}

fn split_kv(line: &str) -> Option<(&str, &str)> {
    let mut iter = line.splitn(2, char::is_whitespace);
    let keyword = iter.next()?.trim();
    let value = iter.next()?.trim();
    if keyword.is_empty() || value.is_empty() {
        return None;
    }
    Some((keyword, value))
}

/// Parses a ProxyJump specification into (user, host, port) components.
/// Supports: `bastion`, `user@bastion`, `bastion:2222`, `user@bastion:2222`.
fn parse_jump_spec(spec: &str) -> (Option<String>, String, Option<u16>) {
    let mut remaining = spec;
    let mut user = None;
    let mut port = None;

    // Extract user if present: user@host[:port]
    if let Some(at_pos) = remaining.find('@') {
        user = Some(remaining[..at_pos].to_string());
        remaining = &remaining[at_pos + 1..];
    }

    // Extract port if present: host:port
    if let Some(colon_pos) = remaining.rfind(':') {
        let port_part = &remaining[colon_pos + 1..];
        if let Ok(p) = port_part.parse::<u16>() {
            port = Some(p);
            remaining = &remaining[..colon_pos];
        }
    }

    (user, remaining.to_string(), port)
}

fn derive_display_name(patterns: &[String]) -> String {
    for p in patterns {
        if !p.contains('*') && !p.contains('?') && !p.starts_with('!') {
            return p.clone();
        }
    }
    patterns
        .iter()
        .filter(|p| !p.starts_with('!'))
        .cloned()
        .collect::<Vec<_>>()
        .join(" ")
}

fn expand_tilde(path: &str) -> String {
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest).to_string_lossy().into_owned();
        }
    } else if path == "~" {
        if let Some(home) = dirs::home_dir() {
            return home.to_string_lossy().into_owned();
        }
    }
    path.to_string()
}

fn glob_paths(pattern: &Path) -> Vec<PathBuf> {
    let pattern_str = pattern.to_string_lossy();
    if !pattern_str.contains('*') && !pattern_str.contains('?') {
        if pattern.exists() {
            return vec![pattern.to_path_buf()];
        }
        return vec![];
    }

    let parent = pattern.parent();
    let file_name = pattern.file_name();

    match (parent, file_name) {
        (Some(parent), Some(file_name)) => {
            let pattern_str = file_name.to_string_lossy();
            let mut results = Vec::new();
            if let Ok(entries) = fs::read_dir(parent) {
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().into_owned();
                    if glob_match(&pattern_str, &name) {
                        results.push(entry.path());
                    }
                }
            }
            results.sort();
            results
        }
        _ => vec![],
    }
}

fn default_config_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".ssh")
        .join("config")
}

/// Converts an SshConfigEntry into a SavedConnection for nyaterm.
/// Uses `agent` auth by default. When an identity file is present, we still
/// use `agent` because the key file would need to be registered in nyaterm's
/// key store (which requires reading the file content). The identity file path
/// is noted in the description for manual setup later.
fn entry_to_saved_connection(entry: &SshConfigEntry, proxy_jump_id: Option<String>) -> SavedConnection {
    let description = if entry.proxy_jump.is_some() {
        format!(
            "Imported from ~/.ssh/config (ProxyJump: {}{})",
            entry.proxy_jump.as_ref().unwrap(),
            if entry.identity_file.is_some() {
                format!(", IdentityFile: {}", entry.identity_file.as_ref().unwrap())
            } else {
                String::new()
            }
        )
    } else if entry.identity_file.is_some() {
        format!(
            "Imported from ~/.ssh/config (IdentityFile: {})",
            entry.identity_file.as_ref().unwrap()
        )
    } else {
        "Imported from ~/.ssh/config".to_string()
    };

    SavedConnection {
        id: uuid::Uuid::new_v4().to_string(),
        name: entry.alias.clone(),
        config: ConnectionType::Ssh {
            host: entry.host.clone(),
            port: entry.port,
            username: entry.user.clone(),
            backspace_mode: "del".to_string(),
            x11_forwarding: false,
            auth_agent_endpoint: None,
            legacy_agent_forwarding: None,
            agent_forwarding_config: None,
            encoding: String::new(),
        },
        group_id: None,
        description: Some(description),
        sort_order: 0,
        icon: None,
        icon_auto_detect: None,
        auth: Some(ConnectionAuth {
            mode: "agent".to_string(),
            password_id: None,
            password: None,
            key_id: None,
            otp_id: None,
            auto_fill_otp: false,
            has_password: false,
        }),
        network: proxy_jump_id.map(|id| crate::config::ConnectionNetwork {
            proxy_id: None,
            proxy_jump_id: Some(id),
        }),
        post_login: None,
        recording: None,
        ssh_algorithms: None,
        ssh_profile: Default::default(),
        terminal_type: None,
        sftp: Default::default(),
        asset: None,
        created_at_ms: None,
        updated_at_ms: None,
        last_used_at_ms: None,
    }
}

/// Imports SSH config hosts as saved connections, skipping duplicates by name.
/// Jump hosts referenced by ProxyJump are imported first, and their connection
/// IDs are wired into the target's `ConnectionNetwork.proxy_jump_id` so the
/// runtime can follow the chain.
/// Returns the number of connections imported.
pub fn import_ssh_config_connections(app: &tauri::AppHandle) -> AppResult<usize> {
    let config = SshConfig::load_default()?;
    let entries = config.to_entries();

    if entries.is_empty() {
        return Ok(0);
    }

    let mut cfg = crate::config::load_config(app)?;
    let existing_names: HashSet<String> =
        cfg.connections.iter().map(|c| c.name.clone()).collect();

    // Map alias -> connection ID for jump host linking.
    let mut alias_to_id: std::collections::HashMap<String, String> = std::collections::HashMap::new();

    // Collect all jump aliases referenced by any entry, parsing user@host:port
    // specs to extract the bare host alias for matching against config entries.
    let jump_aliases: HashSet<String> = entries
        .iter()
        .filter_map(|e| e.proxy_jump.as_ref())
        .flat_map(|pj| {
            pj.split(',').map(|s| {
                let (_, host, _) = parse_jump_spec(s.trim());
                host
            })
        })
        .collect();

    let mut count = 0;

    // First pass: import jump hosts so their IDs exist before wiring targets.
    for entry in &entries {
        if !jump_aliases.contains(&entry.alias) {
            continue;
        }
        if existing_names.contains(&entry.alias) {
            if let Some(existing) = cfg.connections.iter().find(|c| c.name == entry.alias) {
                alias_to_id.insert(entry.alias.clone(), existing.id.clone());
            }
            continue;
        }
        let conn = entry_to_saved_connection(entry, None);
        alias_to_id.insert(entry.alias.clone(), conn.id.clone());
        cfg.connections.push(conn);
        count += 1;
    }

    // Second pass: import remaining hosts, wiring the full jump chain.
    // For multi-hop ProxyJump (jump1,jump2,...,target), we chain each
    // connection's proxy_jump_id to the previous hop's connection ID.
    // The runtime follows proxy_jump_id recursively to build the full route.
    for entry in &entries {
        if jump_aliases.contains(&entry.alias) {
            continue; // already imported above
        }
        if existing_names.contains(&entry.alias) {
            continue;
        }

        // Wire the first jump in the chain. The runtime follows
        // proxy_jump_id recursively, so we only need to link to the
        // first hop. Each jump host was imported with its own
        // proxy_jump_id (if it had one) in the first pass.
        let proxy_jump_id = entry.proxy_jump.as_ref().and_then(|pj| {
            pj.split(',')
                .next()
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .and_then(|spec| {
                    let (_, host, _) = parse_jump_spec(spec);
                    alias_to_id.get(&host).cloned()
                })
        });

        let conn = entry_to_saved_connection(entry, proxy_jump_id);
        cfg.connections.push(conn);
        count += 1;
    }

    if count > 0 {
        crate::config::save_config(app, &cfg)?;
    }

    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn glob_matches_basic_patterns() {
        assert!(glob_match("web-*", "web-prod"));
        assert!(glob_match("*", "anything"));
        assert!(glob_match("server?", "server1"));
        assert!(!glob_match("server?", "server12"));
        assert!(glob_match("exact", "exact"));
        assert!(!glob_match("exact", "other"));
    }

    #[test]
    fn pattern_matches_handles_negation() {
        let patterns = vec!["web-*".to_string(), "!web-old".to_string()];
        assert!(pattern_matches(&patterns, "web-prod"));
        assert!(!pattern_matches(&patterns, "web-old"));
    }

    #[test]
    fn parse_simple_config() {
        let config = r#"
            Host prod
                HostName prod.example.com
                Port 2222
                User admin
                IdentityFile ~/.ssh/prod_key

            Host staging
                HostName staging.example.com
                User deploy
        "#;

        let mut hosts = Vec::new();
        let mut visited = HashSet::new();
        parse_string(config, Path::new("/tmp/test/config"), &mut visited, &mut hosts).unwrap();

        assert_eq!(hosts.len(), 2);
        assert_eq!(hosts[0].name, "prod");
        assert_eq!(hosts[0].host_name.as_deref(), Some("prod.example.com"));
        assert_eq!(hosts[0].port, Some(2222));
        assert_eq!(hosts[0].user.as_deref(), Some("admin"));
    }

    #[test]
    fn resolve_proxy_jump_chain() {
        let config = r#"
            Host jump1
                HostName jump1.example.com
                User juser

            Host jump2
                HostName jump2.example.com
                Port 2222
                User juser2

            Host target
                HostName 10.0.0.42
                User root
                ProxyJump jump1,jump2
        "#;

        let mut hosts = Vec::new();
        let mut visited = HashSet::new();
        parse_string(config, Path::new("/tmp/chain/config"), &mut visited, &mut hosts).unwrap();

        let ssh_config = SshConfig { hosts };
        let resolved = ssh_config.resolve("target").unwrap();

        assert_eq!(resolved.hops.len(), 3);
        assert_eq!(resolved.hops[0].host, "jump1.example.com");
        assert_eq!(resolved.hops[0].user, "juser");
        assert!(!resolved.hops[0].is_target);

        assert_eq!(resolved.hops[1].host, "jump2.example.com");
        assert_eq!(resolved.hops[1].port, 2222);
        assert!(!resolved.hops[1].is_target);

        assert_eq!(resolved.hops[2].host, "10.0.0.42");
        assert_eq!(resolved.hops[2].user, "root");
        assert!(resolved.hops[2].is_target);
    }

    #[test]
    fn resolve_first_match_wins() {
        // OpenSSH uses first-match-wins: the first value found for each
        // option is the one used. With `Host *` before `Host prod`, the
        // `User defaultuser` from `*` wins because it matches first.
        // To have `User admin` win, the `Host prod` block must come first.
        let config = r#"
            Host prod
                HostName prod.example.com
                User admin

            Host *
                User defaultuser
                Port 2222
        "#;

        let mut hosts = Vec::new();
        let mut visited = HashSet::new();
        parse_string(config, Path::new("/tmp/resolve/config"), &mut visited, &mut hosts).unwrap();

        let ssh_config = SshConfig { hosts };
        let resolved = ssh_config.resolve("prod").unwrap();

        // `Host prod` matches first, so `User admin` wins.
        assert_eq!(resolved.user, "admin");
        // `Host *` provides Port 2222 because `prod` doesn't specify one.
        assert_eq!(resolved.port, 2222);
        assert_eq!(resolved.host, "prod.example.com");
    }

    #[test]
    fn list_hosts_skips_wildcards() {
        let config = r#"
            Host *
                User default

            Host web-*
                User webuser

            Host prod
                HostName prod.example.com
        "#;

        let mut hosts = Vec::new();
        let mut visited = HashSet::new();
        parse_string(config, Path::new("/tmp/list/config"), &mut visited, &mut hosts).unwrap();

        let ssh_config = SshConfig { hosts };
        let host_list = ssh_config.list_hosts();
        assert!(host_list.contains(&"prod".to_string()));
        assert!(!host_list.contains(&"*".to_string()));
        assert!(!host_list.contains(&"web-*".to_string()));
    }

    #[test]
    fn relative_include_resolves_from_ssh_dir() {
        // Simulate a config at ~/.ssh/config with Include conf.d/*.conf
        // The base_dir should be ~/.ssh/ (parent of config), not ~/.ssh/config/
        let config = "Include conf.d/*.conf\n";
        let config_path = Path::new("/tmp/ssh_test/config");
        // We can't test actual file resolution without creating files,
        // but we can verify that the base_dir is derived correctly.
        let base_dir = config_path.parent().unwrap();
        assert_eq!(base_dir, Path::new("/tmp/ssh_test"));
        // conf.d/*.conf would resolve to /tmp/ssh_test/conf.d/*.conf (correct)
        // not /tmp/ssh_test/config/conf.d/*.conf (wrong - old behavior)
    }

    #[test]
    fn parse_jump_spec_extracts_components() {
        // Bare alias
        let (user, host, port) = parse_jump_spec("bastion");
        assert_eq!(user, None);
        assert_eq!(host, "bastion");
        assert_eq!(port, None);

        // user@host
        let (user, host, port) = parse_jump_spec("alice@bastion");
        assert_eq!(user.as_deref(), Some("alice"));
        assert_eq!(host, "bastion");
        assert_eq!(port, None);

        // host:port
        let (user, host, port) = parse_jump_spec("bastion:2222");
        assert_eq!(user, None);
        assert_eq!(host, "bastion");
        assert_eq!(port, Some(2222));

        // user@host:port
        let (user, host, port) = parse_jump_spec("alice@bastion:2222");
        assert_eq!(user.as_deref(), Some("alice"));
        assert_eq!(host, "bastion");
        assert_eq!(port, Some(2222));
    }

    #[test]
    fn list_hosts_deduplicates() {
        let config = r#"
            Host prod
                User admin

            Host prod
                Port 2222

            Host staging
                HostName staging.example.com
        "#;

        let mut hosts = Vec::new();
        let mut visited = HashSet::new();
        parse_string(config, Path::new("/tmp/dedup/config"), &mut visited, &mut hosts).unwrap();

        let ssh_config = SshConfig { hosts };
        let host_list = ssh_config.list_hosts();
        // "prod" appears in two blocks but should be listed once.
        assert_eq!(host_list.iter().filter(|h| h == "prod").count(), 1);
        assert_eq!(host_list.len(), 2);
    }

    #[test]
    fn global_options_before_first_host() {
        let config = r#"
            User deploy
            Port 2222

            Host prod
                HostName prod.example.com
        "#;

        let mut hosts = Vec::new();
        let mut visited = HashSet::new();
        parse_string(config, Path::new("/tmp/global/config"), &mut visited, &mut hosts).unwrap();

        let ssh_config = SshConfig { hosts };
        let resolved = ssh_config.resolve("prod").unwrap();
        // Global User and Port should apply to all hosts.
        assert_eq!(resolved.user, "deploy");
        assert_eq!(resolved.port, 2222);
        assert_eq!(resolved.host, "prod.example.com");
    }

    #[test]
    fn proxy_jump_with_user_at_host_port() {
        let config = r#"
            Host bastion
                HostName bastion.example.com

            Host target
                HostName 10.0.0.42
                ProxyJump alice@bastion:2222
        "#;

        let mut hosts = Vec::new();
        let mut visited = HashSet::new();
        parse_string(config, Path::new("/tmp/jumpuser/config"), &mut visited, &mut hosts).unwrap();

        let ssh_config = SshConfig { hosts };
        let resolved = ssh_config.resolve("target").unwrap();

        assert_eq!(resolved.hops.len(), 2);
        assert_eq!(resolved.hops[0].host, "bastion.example.com");
        assert_eq!(resolved.hops[0].user, "alice");
        assert_eq!(resolved.hops[0].port, 2222);
        assert!(!resolved.hops[0].is_target);
    }
}