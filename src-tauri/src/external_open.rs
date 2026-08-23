use std::collections::{HashMap, VecDeque};
use std::ffi::OsString;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{Emitter, Manager};
use uuid::Uuid;

use crate::observability::{self, StructuredLog, StructuredLogLevel};

pub const EXTERNAL_OPEN_AVAILABLE_EVENT: &str = "external-open-available";
const ALLOWED_SCHEMES: &[&str] = &["ssh", "telnet", "nyaterm"];
const MAX_URL_LENGTH: usize = 4096;
const MAX_URLS_PER_BATCH: usize = 10;
const DEDUPLICATION_WINDOW: Duration = Duration::from_millis(500);

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalOpenRequest {
    pub id: String,
    pub raw_url: String,
    pub source: ExternalOpenSource,
    pub target_window_label: String,
    pub received_at_ms: u64,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ExternalOpenSource {
    StartupArguments,
    SecondInstance,
    DeepLink,
}

impl ExternalOpenSource {
    fn as_str(self) -> &'static str {
        match self {
            Self::StartupArguments => "startup_arguments",
            Self::SecondInstance => "second_instance",
            Self::DeepLink => "deep_link",
        }
    }
}

#[derive(Debug)]
pub struct ExternalOpenState {
    pending: Mutex<VecDeque<ExternalOpenRequest>>,
    recent: Mutex<HashMap<String, Instant>>,
}

impl Default for ExternalOpenState {
    fn default() -> Self {
        Self {
            pending: Mutex::new(VecDeque::new()),
            recent: Mutex::new(HashMap::new()),
        }
    }
}

impl ExternalOpenState {
    pub fn enqueue_batch(
        &self,
        values: impl IntoIterator<Item = String>,
        source: ExternalOpenSource,
        target_window_label: &str,
        now: Instant,
    ) -> usize {
        let accepted = extract_external_open_urls(values);
        let mut enqueued = 0;

        for candidate in accepted {
            let Some(scheme) = allowed_scheme(&candidate) else {
                log_external_open(
                    StructuredLogLevel::Warn,
                    "external_open.request_rejected",
                    "Rejected external open request",
                    None,
                    Some(serde_json::json!({
                        "scheme": scheme_hint(&candidate),
                        "source": source.as_str(),
                        "target_window_label": target_window_label,
                        "error_type": "unsupported_scheme",
                    })),
                    None,
                );
                continue;
            };

            log_external_open(
                StructuredLogLevel::Info,
                "external_open.request_received",
                "Received external open request",
                None,
                Some(serde_json::json!({
                    "scheme": scheme,
                    "source": source.as_str(),
                    "target_window_label": target_window_label,
                })),
                None,
            );

            let normalized = normalize_external_url_for_deduplication(&candidate);
            if self.is_duplicate(&normalized, now) {
                log_external_open(
                    StructuredLogLevel::Info,
                    "external_open.request_deduplicated",
                    "Deduplicated external open request",
                    None,
                    Some(serde_json::json!({
                        "scheme": scheme,
                        "source": source.as_str(),
                        "target_window_label": target_window_label,
                    })),
                    None,
                );
                continue;
            }

            let request = ExternalOpenRequest {
                id: Uuid::new_v4().to_string(),
                raw_url: candidate,
                source,
                target_window_label: target_window_label.to_string(),
                received_at_ms: current_time_ms(),
            };

            log_external_open(
                StructuredLogLevel::Info,
                "external_open.request_enqueued",
                "Enqueued external open request",
                Some(serde_json::json!({ "request_id": request.id })),
                Some(serde_json::json!({
                    "scheme": scheme,
                    "source": source.as_str(),
                    "target_window_label": target_window_label,
                })),
                None,
            );

            let mut pending = self.pending.lock().expect("external open queue poisoned");
            pending.push_back(request);
            enqueued += 1;
        }

        enqueued
    }

    pub fn claim_for_window(&self, label: &str) -> Vec<ExternalOpenRequest> {
        let mut pending = self.pending.lock().expect("external open queue poisoned");
        let mut claimed = Vec::new();
        let mut retained = VecDeque::with_capacity(pending.len());

        while let Some(request) = pending.pop_front() {
            if request.target_window_label == label {
                log_external_open(
                    StructuredLogLevel::Info,
                    "external_open.request_claimed",
                    "Claimed external open request",
                    Some(serde_json::json!({ "request_id": request.id })),
                    Some(serde_json::json!({
                        "scheme": scheme_hint(&request.raw_url),
                        "source": request.source.as_str(),
                        "target_window_label": label,
                    })),
                    None,
                );
                claimed.push(request);
            } else {
                retained.push_back(request);
            }
        }

        *pending = retained;
        claimed
    }

    fn is_duplicate(&self, normalized: &str, now: Instant) -> bool {
        let mut recent = self
            .recent
            .lock()
            .expect("external open recent map poisoned");
        recent.retain(|_, instant| now.duration_since(*instant) <= DEDUPLICATION_WINDOW);
        if let Some(last_seen) = recent.get(normalized) {
            if now.duration_since(*last_seen) <= DEDUPLICATION_WINDOW {
                return true;
            }
        }
        recent.insert(normalized.to_string(), now);
        false
    }
}

pub fn handle_external_open_args(
    app: &tauri::AppHandle,
    args: impl IntoIterator<Item = String>,
    source: ExternalOpenSource,
) -> bool {
    let urls = extract_external_open_urls(args);
    if urls.is_empty() {
        return false;
    }

    let Some(target_window) = crate::app::focused_or_first_main_window(app) else {
        log_external_open(
            StructuredLogLevel::Warn,
            "external_open.request_rejected",
            "Rejected external open request because no main window exists",
            None,
            Some(serde_json::json!({
                "source": source.as_str(),
                "error_type": "missing_target_window",
                "candidate_count": urls.len(),
            })),
            None,
        );
        return true;
    };

    let target_label = target_window.label().to_string();
    focus_target_window(&target_window);
    let state = app.state::<ExternalOpenState>();
    let enqueued = state.enqueue_batch(urls, source, &target_label, Instant::now());
    if enqueued > 0 {
        let _ = target_window.emit(EXTERNAL_OPEN_AVAILABLE_EVENT, serde_json::json!({}));
    }
    crate::tray::schedule_refresh(app);
    true
}

pub fn handle_startup_arguments(app: &tauri::AppHandle) {
    let args = std::env::args_os().skip(1).map(os_string_to_string_lossy);
    let _ = handle_external_open_args(app, args, ExternalOpenSource::StartupArguments);
}

pub fn handle_deep_link_urls(app: &tauri::AppHandle, urls: Vec<String>) {
    let _ = handle_external_open_args(app, urls, ExternalOpenSource::DeepLink);
}

pub fn extract_external_open_urls(args: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut accepted = Vec::new();
    let mut local_requested = false;
    let mut local_cwd = None;
    let mut expecting_cwd_value = false;

    for arg in args {
        if expecting_cwd_value {
            local_cwd = Some(arg);
            expecting_cwd_value = false;
            continue;
        }

        let candidate = arg.trim();
        if candidate.eq_ignore_ascii_case("--local") {
            local_requested = true;
            continue;
        }
        if candidate.eq_ignore_ascii_case("--cwd") {
            expecting_cwd_value = true;
            continue;
        }
        if let Some(value) = candidate.strip_prefix("--cwd=") {
            local_cwd = Some(value.to_string());
            continue;
        }

        if let Some(url) = sanitize_external_open_arg(&arg) {
            accepted.push(url);
            if accepted.len() >= MAX_URLS_PER_BATCH {
                return accepted;
            }
        }
    }

    if local_requested && accepted.len() < MAX_URLS_PER_BATCH {
        if let Some(url) =
            sanitize_external_open_arg(&build_local_external_open_url(local_cwd.as_deref()))
        {
            accepted.push(url);
        }
    }

    accepted
}

fn build_local_external_open_url(cwd: Option<&str>) -> String {
    match cwd {
        Some(cwd) => format!("nyaterm://connect/local?cwd={}", urlencoding::encode(cwd)),
        None => "nyaterm://connect/local".to_string(),
    }
}

fn sanitize_external_open_arg(arg: &str) -> Option<String> {
    let candidate = arg.trim();
    if candidate.is_empty() {
        return None;
    }
    if candidate.len() > MAX_URL_LENGTH {
        log_external_open(
            StructuredLogLevel::Warn,
            "external_open.request_rejected",
            "Rejected oversized external open request",
            None,
            Some(serde_json::json!({
                "scheme": scheme_hint(candidate),
                "error_type": "too_long",
            })),
            None,
        );
        return None;
    }
    if allowed_scheme(candidate).is_none() {
        return None;
    }
    Some(candidate.to_string())
}

fn allowed_scheme(value: &str) -> Option<&'static str> {
    let index = value.find(':')?;
    if value[..index].chars().any(|ch| !ch.is_ascii_alphanumeric()) {
        return None;
    }
    let scheme = value[..index].to_ascii_lowercase();
    ALLOWED_SCHEMES
        .iter()
        .copied()
        .find(|allowed| *allowed == scheme)
}

fn scheme_hint(value: &str) -> String {
    value
        .find(':')
        .map(|index| value[..index].to_ascii_lowercase())
        .unwrap_or_else(|| "none".to_string())
}

fn normalize_external_url_for_deduplication(value: &str) -> String {
    let trimmed = value.trim();
    if let Some(index) = trimmed.find(':') {
        format!(
            "{}{}",
            trimmed[..index].to_ascii_lowercase(),
            &trimmed[index..]
        )
    } else {
        trimmed.to_string()
    }
}

fn os_string_to_string_lossy(value: OsString) -> String {
    value.to_string_lossy().into_owned()
}

fn current_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().try_into().unwrap_or(u64::MAX))
        .unwrap_or(0)
}

fn focus_target_window(window: &tauri::WebviewWindow) {
    if window.is_minimized().unwrap_or(false) {
        let _ = window.unminimize();
    }
    let _ = window.show();
    let _ = window.set_focus();
}

fn log_external_open(
    level: StructuredLogLevel,
    event: &str,
    message: &str,
    ids: Option<serde_json::Value>,
    data: Option<serde_json::Value>,
    error: Option<serde_json::Value>,
) {
    observability::log_event(StructuredLog {
        level,
        domain: "app.lifecycle".to_string(),
        event: event.to_string(),
        message: message.to_string(),
        ids,
        data,
        error,
        client_timestamp: None,
    });
}

#[cfg(test)]
mod tests {
    use std::time::Instant;

    use super::*;

    #[test]
    fn extracts_ssh_url_from_startup_args() {
        let args = vec![
            "--flag".to_string(),
            "ssh://root@192.168.1.10:22".to_string(),
        ];
        assert_eq!(
            extract_external_open_urls(args),
            vec!["ssh://root@192.168.1.10:22".to_string()]
        );
    }

    #[test]
    fn extracts_telnet_url_from_startup_args() {
        let args = vec!["telnet://192.168.1.10:23".to_string()];
        assert_eq!(
            extract_external_open_urls(args),
            vec!["telnet://192.168.1.10:23".to_string()]
        );
    }

    #[test]
    fn extracts_local_request_from_startup_args() {
        let args = vec!["--local".to_string()];
        assert_eq!(
            extract_external_open_urls(args),
            vec!["nyaterm://connect/local".to_string()]
        );
    }

    #[test]
    fn extracts_local_request_with_unix_cwd() {
        let args = vec![
            "--local".to_string(),
            "--cwd".to_string(),
            "/tmp/test".to_string(),
        ];
        assert_eq!(
            extract_external_open_urls(args),
            vec!["nyaterm://connect/local?cwd=%2Ftmp%2Ftest".to_string()]
        );
    }

    #[test]
    fn extracts_local_request_with_windows_cwd() {
        let args = vec![
            "--local".to_string(),
            "--cwd".to_string(),
            r"C:\Users\Test User\project".to_string(),
        ];
        assert_eq!(
            extract_external_open_urls(args),
            vec!["nyaterm://connect/local?cwd=C%3A%5CUsers%5CTest%20User%5Cproject".to_string()]
        );
    }

    #[test]
    fn extracts_local_request_with_unicode_cwd() {
        let args = vec![
            "--local".to_string(),
            "--cwd".to_string(),
            r"D:\项目\测试".to_string(),
        ];
        assert_eq!(
            extract_external_open_urls(args),
            vec![
                "nyaterm://connect/local?cwd=D%3A%5C%E9%A1%B9%E7%9B%AE%5C%E6%B5%8B%E8%AF%95"
                    .to_string()
            ]
        );
    }

    #[test]
    fn ignores_cwd_without_local_request() {
        let args = vec!["--cwd".to_string(), "/tmp/test".to_string()];
        assert!(extract_external_open_urls(args).is_empty());
    }

    #[test]
    fn extracts_nyaterm_ssh_url_from_startup_args() {
        let args = vec!["nyaterm://connect/ssh?host=example.com".to_string()];
        assert_eq!(
            extract_external_open_urls(args),
            vec!["nyaterm://connect/ssh?host=example.com".to_string()]
        );
    }

    #[test]
    fn enqueues_ssh_and_telnet_urls_from_deep_links() {
        let state = ExternalOpenState::default();
        let enqueued = state.enqueue_batch(
            vec![
                "ssh://root@example.com:22".to_string(),
                "telnet://example.com:23".to_string(),
            ],
            ExternalOpenSource::DeepLink,
            "main",
            Instant::now(),
        );

        let claimed = state.claim_for_window("main");
        assert_eq!(enqueued, 2);
        assert_eq!(claimed.len(), 2);
        assert_eq!(claimed[0].source, ExternalOpenSource::DeepLink);
        assert_eq!(claimed[0].raw_url, "ssh://root@example.com:22");
        assert_eq!(claimed[1].source, ExternalOpenSource::DeepLink);
        assert_eq!(claimed[1].raw_url, "telnet://example.com:23");
    }

    #[test]
    fn ignores_plain_arguments() {
        let args = vec![
            "--help".to_string(),
            "C:\\Users\\user\\file.txt".to_string(),
            "not-a-url".to_string(),
        ];
        assert!(extract_external_open_urls(args).is_empty());
    }

    #[test]
    fn rejects_oversized_urls() {
        let oversized = format!("ssh://{}", "a".repeat(MAX_URL_LENGTH));
        assert!(extract_external_open_urls(vec![oversized]).is_empty());
    }

    #[test]
    fn limits_batch_to_ten_urls() {
        let args = (0..12)
            .map(|index| format!("ssh://root@host{index}:22"))
            .collect::<Vec<_>>();
        assert_eq!(extract_external_open_urls(args).len(), MAX_URLS_PER_BATCH);
    }

    #[test]
    fn deduplicates_within_window() {
        let state = ExternalOpenState::default();
        let now = Instant::now();
        let first = state.enqueue_batch(
            vec!["ssh://root@host:22".to_string()],
            ExternalOpenSource::StartupArguments,
            "main",
            now,
        );
        let second = state.enqueue_batch(
            vec!["ssh://root@host:22".to_string()],
            ExternalOpenSource::SecondInstance,
            "main",
            now + Duration::from_millis(100),
        );
        assert_eq!(first, 1);
        assert_eq!(second, 0);
    }

    #[test]
    fn deduplicates_local_requests_within_window() {
        let state = ExternalOpenState::default();
        let now = Instant::now();
        let first = state.enqueue_batch(
            vec!["--local".to_string()],
            ExternalOpenSource::StartupArguments,
            "main",
            now,
        );
        let second = state.enqueue_batch(
            vec!["nyaterm://connect/local".to_string()],
            ExternalOpenSource::SecondInstance,
            "main",
            now + Duration::from_millis(100),
        );
        assert_eq!(first, 1);
        assert_eq!(second, 0);
    }

    #[test]
    fn claims_by_window_label() {
        let state = ExternalOpenState::default();
        let now = Instant::now();
        state.enqueue_batch(
            vec!["ssh://root@host-a:22".to_string()],
            ExternalOpenSource::StartupArguments,
            "main",
            now,
        );
        state.enqueue_batch(
            vec!["ssh://root@host-b:22".to_string()],
            ExternalOpenSource::StartupArguments,
            "main-secondary",
            now,
        );

        let claimed = state.claim_for_window("main");
        assert_eq!(claimed.len(), 1);
        assert_eq!(claimed[0].target_window_label, "main");
        assert_eq!(state.claim_for_window("main-secondary").len(), 1);
    }

    #[test]
    fn plain_second_instance_is_not_external_open() {
        let args = vec!["--new-window".to_string(), "notes.txt".to_string()];
        assert!(extract_external_open_urls(args).is_empty());
    }
}
