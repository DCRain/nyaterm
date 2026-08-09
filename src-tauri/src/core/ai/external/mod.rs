#![allow(dead_code)]

use std::path::PathBuf;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::config::{AiAgentKind, AiPermissionMode, RiskLevel};
use crate::core::ai::types::AiAttachment;
use crate::error::AppResult;

pub mod claude_code;
pub mod opencode;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AgentDetectionResult {
    pub installed: bool,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub checked_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AgentAuthStatus {
    pub connected: bool,
    #[serde(default)]
    pub auth_mode: Option<String>,
    #[serde(default)]
    pub account_label: Option<String>,
    #[serde(default)]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentModel {
    pub id: String,
    pub name: String,
    pub agent_kind: AiAgentKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalAgentTurnRequest {
    pub request_id: String,
    pub chat_session_id: String,
    pub prompt: String,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub cwd: Option<PathBuf>,
    #[serde(default)]
    pub existing_external_session_id: Option<String>,
    #[serde(default)]
    pub terminal_scope: Vec<String>,
    #[serde(default)]
    pub default_target_session_id: Option<String>,
    pub permission_mode: AiPermissionMode,
    #[serde(default)]
    pub attachments: Vec<AiAttachment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalAgentTurnHandle {
    pub turn_id: String,
    #[serde(default)]
    pub external_session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalFileChange {
    pub path: String,
    pub operation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPlanItem {
    pub text: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentApprovalRequest {
    pub approval_id: String,
    pub chat_session_id: String,
    pub agent_kind: AiAgentKind,
    pub tool_name: String,
    pub arguments: Value,
    pub risk_level: RiskLevel,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AgentUsage {
    #[serde(default)]
    pub input_tokens: Option<u64>,
    #[serde(default)]
    pub output_tokens: Option<u64>,
    #[serde(default)]
    pub total_tokens: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ExternalAgentEvent {
    SessionStarted {
        external_session_id: String,
    },
    TextDelta {
        text: String,
    },
    ReasoningDelta {
        text: String,
    },
    ReasoningCompleted,
    ToolCallStarted {
        call_id: String,
        tool_name: String,
        arguments: Value,
    },
    ToolCallCompleted {
        call_id: String,
        tool_name: String,
        output: String,
        is_error: bool,
    },
    CommandStarted {
        item_id: String,
        command: String,
        cwd: Option<String>,
    },
    CommandCompleted {
        item_id: String,
        output: String,
        exit_code: Option<i32>,
    },
    FileChanged {
        item_id: String,
        changes: Vec<ExternalFileChange>,
    },
    PlanUpdated {
        items: Vec<AgentPlanItem>,
    },
    ApprovalRequested {
        request: AgentApprovalRequest,
    },
    UsageUpdated {
        usage: AgentUsage,
    },
    Warning {
        message: String,
    },
    Completed,
    Failed {
        message: String,
    },
}

#[async_trait]
pub trait ExternalAgentRuntime: Send + Sync {
    async fn detect(&self) -> AppResult<AgentDetectionResult>;
    async fn get_auth_status(&self) -> AppResult<AgentAuthStatus>;
    async fn list_models(&self) -> AppResult<Vec<AgentModel>>;
    async fn start_turn(
        &self,
        request: ExternalAgentTurnRequest,
    ) -> AppResult<ExternalAgentTurnHandle>;
    async fn resume_turn(
        &self,
        request: ExternalAgentTurnRequest,
    ) -> AppResult<ExternalAgentTurnHandle>;
    async fn cancel_turn(&self, turn_id: &str) -> AppResult<()>;
}

#[cfg(test)]
pub mod mock {
    use std::sync::{Arc, Mutex};

    use async_trait::async_trait;

    use super::*;

    #[derive(Default)]
    pub struct MockExternalAgentRuntime {
        pub started: Arc<Mutex<Vec<ExternalAgentTurnRequest>>>,
    }

    #[async_trait]
    impl ExternalAgentRuntime for MockExternalAgentRuntime {
        async fn detect(&self) -> AppResult<AgentDetectionResult> {
            Ok(AgentDetectionResult {
                installed: true,
                ..AgentDetectionResult::default()
            })
        }

        async fn get_auth_status(&self) -> AppResult<AgentAuthStatus> {
            Ok(AgentAuthStatus {
                connected: true,
                ..AgentAuthStatus::default()
            })
        }

        async fn list_models(&self) -> AppResult<Vec<AgentModel>> {
            Ok(Vec::new())
        }

        async fn start_turn(
            &self,
            request: ExternalAgentTurnRequest,
        ) -> AppResult<ExternalAgentTurnHandle> {
            self.started.lock().unwrap().push(request);
            Ok(ExternalAgentTurnHandle {
                turn_id: "mock-turn".to_string(),
                external_session_id: Some("mock-session".to_string()),
            })
        }

        async fn resume_turn(
            &self,
            request: ExternalAgentTurnRequest,
        ) -> AppResult<ExternalAgentTurnHandle> {
            self.start_turn(request).await
        }

        async fn cancel_turn(&self, _turn_id: &str) -> AppResult<()> {
            Ok(())
        }
    }
}
