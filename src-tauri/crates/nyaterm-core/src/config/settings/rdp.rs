use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RdpSpecialShortcut {
    pub id: String,
    pub label: String,
    pub combo: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RdpSettings {
    #[serde(default)]
    pub special_shortcuts: Vec<RdpSpecialShortcut>,
}

impl Default for RdpSettings {
    fn default() -> Self {
        Self {
            special_shortcuts: Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rdp_settings_defaults_to_empty_custom_shortcuts() {
        let settings = RdpSettings::default();
        assert!(settings.special_shortcuts.is_empty());
    }

    #[test]
    fn rdp_settings_deserializes_missing_fields() {
        let settings: RdpSettings = serde_json::from_value(serde_json::json!({})).expect("parse");
        assert!(settings.special_shortcuts.is_empty());
    }
}
