use serde_json::{Value, json};

use crate::error::{AppError, AppResult};

pub fn build_opencode_mcp_config_content(url: &str, token: &str) -> String {
    json!({
        "mcp": {
            "nyaterm_terminal": {
                "type": "remote",
                "url": url,
                "enabled": true,
                "oauth": false,
                "headers": {
                    "Authorization": format!("Bearer {token}")
                },
                "timeout": 600_000
            }
        }
    })
    .to_string()
}

pub fn build_claude_mcp_config(url: &str, token: &str) -> Value {
    json!({
        "mcpServers": {
            "nyaterm_terminal": {
                "type": "http",
                "url": url,
                "headers": {
                    "Authorization": format!("Bearer {token}")
                }
            }
        }
    })
}

#[derive(Debug, Clone)]
pub struct ClaudeMcpConfigPaths {
    pub config_path: std::path::PathBuf,
}

pub fn write_claude_mcp_config(url: &str, token: &str) -> AppResult<ClaudeMcpConfigPaths> {
    let dir = std::env::temp_dir().join(format!("nyaterm-mcp-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir)
        .map_err(|error| AppError::Config(format!("Failed to create MCP config dir: {error}")))?;
    let config_path = dir.join("mcp.json");
    let content = serde_json::to_vec_pretty(&build_claude_mcp_config(url, token))
        .map_err(|error| AppError::Config(format!("Failed to serialize MCP config: {error}")))?;
    std::fs::write(&config_path, content)
        .map_err(|error| AppError::Config(format!("Failed to write MCP config: {error}")))?;
    Ok(ClaudeMcpConfigPaths { config_path })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opencode_config_includes_remote_mcp_and_bearer() {
        let content = build_opencode_mcp_config_content("http://127.0.0.1:9/mcp", "tok-1");
        let value: Value = serde_json::from_str(&content).expect("json");
        let server = &value["mcp"]["nyaterm_terminal"];
        assert_eq!(server["type"], "remote");
        assert_eq!(server["oauth"], false);
        assert_eq!(server["url"], "http://127.0.0.1:9/mcp");
        assert_eq!(server["headers"]["Authorization"], "Bearer tok-1");
        assert_eq!(server["timeout"], 600_000);
    }

    #[test]
    fn claude_config_uses_http_transport() {
        let value = build_claude_mcp_config("http://127.0.0.1:9/mcp", "tok-2");
        let server = &value["mcpServers"]["nyaterm_terminal"];
        assert_eq!(server["type"], "http");
        assert_eq!(server["url"], "http://127.0.0.1:9/mcp");
        assert_eq!(server["headers"]["Authorization"], "Bearer tok-2");
    }
}
