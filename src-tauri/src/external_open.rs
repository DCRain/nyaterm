use std::collections::{HashMap, VecDeque};
use std::ffi::OsString;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{Emitter, Manager};
use uuid::Uuid;

use crate::observability::{self, StructuredLog, StructuredLogLevel};

pub const EXTERNAL_OPEN_AVAILABLE_EVENT: &str = "external-open-available";
const ALLOWED_SCHEMES: &[&str] = &["ssh", "ssh2", "telnet", "nyaterm"];
const MAX_URL_LENGTH: usize = 4096;
const MAX_URLS_PER_BATCH: usize = 10;
const DEDUPLICATION_WINDOW: Duration = Duration::from_millis(500);
const DEFAULT_SSH_PORT: u16 = 22;
const DEFAULT_SSH_USERNAME: &str = "root";

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalOpenRequest {
    pub id: String,
    pub raw_url: String,
    pub kind: ExternalOpenKind,
    pub source: ExternalOpenSource,
    pub target_window_label: String,
    pub received_at_ms: u64,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ExternalOpenKind {
    Url,
    MarkdownFile,
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
        let accepted = extract_external_open_candidates(values);
        let mut enqueued = 0;

        for candidate in accepted {
            let scheme = match candidate.kind {
                ExternalOpenKind::Url => match allowed_scheme(&candidate.value) {
                    Some(scheme) => scheme,
                    None => {
                        log_external_open(
                            StructuredLogLevel::Warn,
                            "external_open.request_rejected",
                            "Rejected external open request",
                            None,
                            Some(serde_json::json!({
                                "scheme": scheme_hint(&candidate.value),
                                "source": source.as_str(),
                                "target_window_label": target_window_label,
                                "error_type": "unsupported_scheme",
                            })),
                            None,
                        );
                        continue;
                    }
                },
                ExternalOpenKind::MarkdownFile => "file",
            };

            log_external_open(
                StructuredLogLevel::Info,
                "external_open.request_received",
                "Received external open request",
                None,
                Some(serde_json::json!({
                    "scheme": scheme,
                    "kind": match candidate.kind {
                        ExternalOpenKind::Url => "url",
                        ExternalOpenKind::MarkdownFile => "markdown_file",
                    },
                    "source": source.as_str(),
                    "target_window_label": target_window_label,
                })),
                None,
            );

            let normalized = normalize_external_url_for_deduplication(&candidate.value);
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
                raw_url: candidate.value,
                kind: candidate.kind,
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
    extract_external_open_candidates(args)
        .into_iter()
        .map(|candidate| candidate.value)
        .collect()
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ExternalOpenCandidate {
    kind: ExternalOpenKind,
    value: String,
}

pub fn extract_external_open_candidates(
    args: impl IntoIterator<Item = String>,
) -> Vec<ExternalOpenCandidate> {
    let args: Vec<String> = args.into_iter().collect();
    let mut accepted = Vec::new();
    let mut local_requested = false;
    let mut local_cwd = None;
    let mut expecting_cwd_value = false;
    let mut skip_indices = std::collections::HashSet::new();

    if let Some((url, consumed)) = try_normalize_bastion_cli(&args) {
        skip_indices.extend(consumed);
        if let Some(candidate) = sanitize_external_open_arg(&url) {
            accepted.push(candidate);
        }
    }

    for (index, arg) in args.into_iter().enumerate() {
        if skip_indices.contains(&index) {
            continue;
        }

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

        if accepted.len() >= MAX_URLS_PER_BATCH {
            break;
        }
        if let Some(url) = sanitize_external_open_arg(&arg) {
            accepted.push(url);
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

/// Normalize Xshell / SecureCRT-style argv into a single `ssh://` URL.
///
/// Returns `(url, consumed_arg_indices)` so those args are not double-counted.
fn try_normalize_bastion_cli(args: &[String]) -> Option<(String, Vec<usize>)> {
    if let Some(result) = try_normalize_xshell_cli(args) {
        return Some(result);
    }
    try_normalize_securecrt_cli(args)
}

fn try_normalize_xshell_cli(args: &[String]) -> Option<(String, Vec<usize>)> {
    let mut consumed = Vec::new();
    let mut url_value: Option<String> = None;
    let mut host: Option<String> = None;
    let mut user: Option<String> = None;
    let mut port: Option<u16> = None;
    let mut password: Option<String> = None;
    let mut saw_xshell_flag = false;

    let mut index = 0;
    while index < args.len() {
        let arg = args[index].trim();
        let lower = arg.to_ascii_lowercase();

        if let Some(value) = strip_cli_flag(arg, &["-url", "/url"]) {
            saw_xshell_flag = true;
            consumed.push(index);
            url_value = Some(value.to_string());
            index += 1;
            continue;
        }
        if matches!(lower.as_str(), "-url" | "/url") {
            if let Some(next) = args.get(index + 1) {
                saw_xshell_flag = true;
                consumed.push(index);
                consumed.push(index + 1);
                url_value = Some(next.trim().to_string());
                index += 2;
                continue;
            }
        }

        if let Some(value) = strip_cli_flag(arg, &["-host", "/host"]) {
            saw_xshell_flag = true;
            consumed.push(index);
            host = Some(value.to_string());
            index += 1;
            continue;
        }
        if matches!(lower.as_str(), "-host" | "/host") {
            if let Some(next) = args.get(index + 1) {
                saw_xshell_flag = true;
                consumed.push(index);
                consumed.push(index + 1);
                host = Some(next.trim().to_string());
                index += 2;
                continue;
            }
        }

        if let Some(value) = strip_cli_flag(arg, &["-user", "/user", "-l", "/l"]) {
            saw_xshell_flag = true;
            consumed.push(index);
            user = Some(value.to_string());
            index += 1;
            continue;
        }
        if matches!(lower.as_str(), "-user" | "/user" | "-l" | "/l") {
            if let Some(next) = args.get(index + 1) {
                saw_xshell_flag = true;
                consumed.push(index);
                consumed.push(index + 1);
                user = Some(next.trim().to_string());
                index += 2;
                continue;
            }
        }

        if let Some(value) = strip_cli_flag(arg, &["-port", "/port", "-p", "/p"]) {
            if let Ok(parsed) = value.parse::<u16>() {
                if parsed > 0 {
                    saw_xshell_flag = true;
                    consumed.push(index);
                    port = Some(parsed);
                }
            }
            index += 1;
            continue;
        }
        if matches!(lower.as_str(), "-port" | "/port" | "-p" | "/p") {
            if let Some(next) = args.get(index + 1) {
                if let Ok(parsed) = next.trim().parse::<u16>() {
                    if parsed > 0 {
                        saw_xshell_flag = true;
                        consumed.push(index);
                        consumed.push(index + 1);
                        port = Some(parsed);
                        index += 2;
                        continue;
                    }
                }
            }
        }

        if let Some(value) = strip_cli_flag(arg, &["-pw", "/pw", "-password", "/password"]) {
            saw_xshell_flag = true;
            consumed.push(index);
            password = Some(value.to_string());
            index += 1;
            continue;
        }
        if matches!(lower.as_str(), "-pw" | "/pw" | "-password" | "/password") {
            if let Some(next) = args.get(index + 1) {
                saw_xshell_flag = true;
                consumed.push(index);
                consumed.push(index + 1);
                password = Some(next.to_string());
                index += 2;
                continue;
            }
        }

        index += 1;
    }

    if !saw_xshell_flag {
        return None;
    }

    if let Some(raw_url) = url_value {
        let normalized = normalize_xshell_url_value(&raw_url)?;
        return Some((normalized, consumed));
    }

    let host = host.filter(|value| !value.is_empty())?;
    let username = user
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_SSH_USERNAME.to_string());
    let port = port.unwrap_or(DEFAULT_SSH_PORT);
    Some((
        build_ssh_url(&username, password.as_deref(), &host, port),
        consumed,
    ))
}

fn try_normalize_securecrt_cli(args: &[String]) -> Option<(String, Vec<usize>)> {
    let mut consumed = Vec::new();
    let mut saw_ssh2 = false;
    let mut user: Option<String> = None;
    let mut password: Option<String> = None;
    let mut port: Option<u16> = None;
    let mut host: Option<String> = None;

    let mut index = 0;
    while index < args.len() {
        let arg = args[index].trim();
        let lower = arg.to_ascii_lowercase();

        if matches!(lower.as_str(), "/ssh2" | "-ssh2") {
            saw_ssh2 = true;
            consumed.push(index);
            index += 1;
            continue;
        }
        // Optional tab flag — consume whenever present so a leading /T still works.
        if lower == "/t" {
            consumed.push(index);
            index += 1;
            continue;
        }

        if let Some(value) = strip_cli_flag(arg, &["/l", "-l"]) {
            saw_ssh2 = true;
            consumed.push(index);
            user = Some(value.to_string());
            index += 1;
            continue;
        }
        if matches!(lower.as_str(), "/l" | "-l") {
            if let Some(next) = args.get(index + 1) {
                saw_ssh2 = true;
                consumed.push(index);
                consumed.push(index + 1);
                user = Some(next.trim().to_string());
                index += 2;
                continue;
            }
        }

        if let Some(value) = strip_cli_flag(arg, &["/password", "-password"]) {
            saw_ssh2 = true;
            consumed.push(index);
            password = Some(value.to_string());
            index += 1;
            continue;
        }
        if matches!(lower.as_str(), "/password" | "-password") {
            if let Some(next) = args.get(index + 1) {
                saw_ssh2 = true;
                consumed.push(index);
                consumed.push(index + 1);
                password = Some(next.to_string());
                index += 2;
                continue;
            }
        }

        if let Some(value) = strip_cli_flag(arg, &["/p", "-p"]) {
            if let Ok(parsed) = value.parse::<u16>() {
                if parsed > 0 {
                    saw_ssh2 = true;
                    consumed.push(index);
                    port = Some(parsed);
                }
            }
            index += 1;
            continue;
        }
        if matches!(lower.as_str(), "/p" | "-p") {
            if let Some(next) = args.get(index + 1) {
                if let Ok(parsed) = next.trim().parse::<u16>() {
                    if parsed > 0 {
                        saw_ssh2 = true;
                        consumed.push(index);
                        consumed.push(index + 1);
                        port = Some(parsed);
                        index += 2;
                        continue;
                    }
                }
            }
        }

        // Positional host (or user@host), only once, after we know this is CRT-like.
        if saw_ssh2
            && host.is_none()
            && !arg.starts_with('/')
            && !arg.starts_with('-')
            && !arg.is_empty()
            && allowed_scheme(arg).is_none()
        {
            consumed.push(index);
            host = Some(arg.to_string());
        }

        index += 1;
    }

    if !saw_ssh2 {
        return None;
    }

    let host_spec = host.filter(|value| !value.is_empty())?;
    let (parsed_user, host_name) = split_user_at_host(&host_spec);
    if host_name.is_empty() {
        return None;
    }
    let username = user
        .or(parsed_user)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_SSH_USERNAME.to_string());
    let port = port.unwrap_or(DEFAULT_SSH_PORT);
    Some((
        build_ssh_url(&username, password.as_deref(), &host_name, port),
        consumed,
    ))
}

fn strip_cli_flag<'a>(arg: &'a str, flags: &[&str]) -> Option<&'a str> {
    for flag in flags {
        let inline_eq = format!("{flag}=");
        if arg.len() > inline_eq.len() && arg[..inline_eq.len()].eq_ignore_ascii_case(&inline_eq) {
            let value = arg[inline_eq.len()..].trim();
            return (!value.is_empty()).then_some(value);
        }
        // SecureCRT-style "/Luser" without separator is uncommon; support "-p22" style.
        if flag.len() >= 2
            && arg.len() > flag.len()
            && arg[..flag.len()].eq_ignore_ascii_case(flag)
            && !arg[flag.len()..].starts_with('=')
            && flag.chars().last().is_some_and(|ch| ch.is_ascii_alphabetic())
            && arg.as_bytes().get(flag.len()).is_some_and(|b| b.is_ascii_digit())
        {
            let value = arg[flag.len()..].trim();
            return (!value.is_empty()).then_some(value);
        }
    }
    None
}

fn normalize_xshell_url_value(raw: &str) -> Option<String> {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return None;
    }

    if allowed_scheme(trimmed).is_some() {
        return Some(rewrite_scheme_aliases(trimmed));
    }

    // Bare connection string: user:pass@host:port or user@host:port or host:port
    let (user, password, host, port) = parse_bare_ssh_target(trimmed)?;
    Some(build_ssh_url(&user, password.as_deref(), &host, port))
}

fn parse_bare_ssh_target(value: &str) -> Option<(String, Option<String>, String, u16)> {
    let mut username = DEFAULT_SSH_USERNAME.to_string();
    let mut password = None;
    let mut host_port = value;

    if let Some(at) = value.rfind('@') {
        let cred = &value[..at];
        host_port = &value[at + 1..];
        if let Some(colon) = cred.find(':') {
            username = cred[..colon].to_string();
            password = Some(cred[colon + 1..].to_string());
        } else if !cred.is_empty() {
            username = cred.to_string();
        }
    }

    let (host, port) = split_host_port(host_port)?;
    if host.is_empty() {
        return None;
    }
    Some((username, password, host, port))
}

fn split_user_at_host(value: &str) -> (Option<String>, String) {
    if let Some(at) = value.rfind('@') {
        let user = value[..at].trim();
        let host = value[at + 1..].trim();
        if user.contains(':') {
            // user:pass@host is not valid in CRT positional host; treat whole as host.
            return (None, value.to_string());
        }
        return (
            (!user.is_empty()).then(|| user.to_string()),
            host.to_string(),
        );
    }
    (None, value.to_string())
}

fn split_host_port(value: &str) -> Option<(String, u16)> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }

    if value.starts_with('[') {
        let end = value.find(']')?;
        let host = value[1..end].to_string();
        let rest = &value[end + 1..];
        if let Some(port_str) = rest.strip_prefix(':') {
            let port = port_str.parse::<u16>().ok().filter(|p| *p > 0)?;
            return Some((host, port));
        }
        return Some((host, DEFAULT_SSH_PORT));
    }

    // Prefer last colon for host:port, but avoid treating IPv6 as port.
    if let Some(colon) = value.rfind(':') {
        let host = &value[..colon];
        let port_str = &value[colon + 1..];
        if !host.is_empty() && port_str.chars().all(|ch| ch.is_ascii_digit()) {
            if let Ok(port) = port_str.parse::<u16>() {
                if port > 0 && !host.contains(':') {
                    return Some((host.to_string(), port));
                }
            }
        }
    }

    Some((value.to_string(), DEFAULT_SSH_PORT))
}

fn build_ssh_url(username: &str, password: Option<&str>, host: &str, port: u16) -> String {
    let host_part = if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]")
    } else {
        host.to_string()
    };
    match password {
        Some(password) if !password.is_empty() => format!(
            "ssh://{}:{}@{}:{}",
            urlencoding::encode(username),
            urlencoding::encode(password),
            host_part,
            port
        ),
        _ => format!(
            "ssh://{}@{}:{}",
            urlencoding::encode(username),
            host_part,
            port
        ),
    }
}

fn rewrite_scheme_aliases(value: &str) -> String {
    let trimmed = value.trim();
    if let Some(rest) = strip_scheme_prefix(trimmed, "ssh2") {
        return format!("ssh://{rest}");
    }
    trimmed.to_string()
}

fn strip_scheme_prefix<'a>(value: &'a str, scheme: &str) -> Option<&'a str> {
    let prefix = format!("{scheme}://");
    if value.len() >= prefix.len() && value[..prefix.len()].eq_ignore_ascii_case(&prefix) {
        Some(&value[prefix.len()..])
    } else {
        None
    }
}

fn build_local_external_open_url(cwd: Option<&str>) -> String {
    match cwd {
        Some(cwd) => format!("nyaterm://connect/local?cwd={}", urlencoding::encode(cwd)),
        None => "nyaterm://connect/local".to_string(),
    }
}

fn sanitize_external_open_arg(arg: &str) -> Option<ExternalOpenCandidate> {
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
    if allowed_scheme(candidate).is_some() {
        let value = rewrite_scheme_aliases(candidate);
        if value.len() > MAX_URL_LENGTH {
            return None;
        }
        return Some(ExternalOpenCandidate {
            kind: ExternalOpenKind::Url,
            value,
        });
    }
    if let Some(path) = markdown_path_from_arg(candidate) {
        return Some(ExternalOpenCandidate {
            kind: ExternalOpenKind::MarkdownFile,
            value: path,
        });
    }
    None
}

fn markdown_path_from_arg(value: &str) -> Option<String> {
    let lowered = value.to_ascii_lowercase();
    if lowered.starts_with("file:") {
        let path = file_url_to_path(value)?;
        return is_markdown_path(&path).then_some(path);
    }
    // Absolute or relative filesystem paths ending in .md / .markdown.
    if is_markdown_path(value) && looks_like_filesystem_path(value) {
        return Some(value.to_string());
    }
    None
}

fn looks_like_filesystem_path(value: &str) -> bool {
    let path = std::path::Path::new(value);
    path.is_absolute()
        || value.starts_with('.')
        || value.starts_with('/')
        || value.starts_with('\\')
        || (value.len() >= 3
            && value.as_bytes()[0].is_ascii_alphabetic()
            && value.as_bytes()[1] == b':'
            && (value.as_bytes()[2] == b'\\' || value.as_bytes()[2] == b'/'))
}

fn is_markdown_path(value: &str) -> bool {
    let path = std::path::Path::new(value);
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            let lower = ext.to_ascii_lowercase();
            lower == "md" || lower == "markdown"
        })
        .unwrap_or(false)
}

fn file_url_to_path(value: &str) -> Option<String> {
    let url = value.trim();
    let without_scheme = url
        .strip_prefix("file://")
        .or_else(|| url.strip_prefix("FILE://"))?;
    // file:///C:/path or file://localhost/C:/path or file:///home/...
    let path = without_scheme
        .strip_prefix("localhost")
        .unwrap_or(without_scheme);
    let path = if cfg!(windows) {
        let trimmed = path.trim_start_matches('/');
        // Keep leading slash for Unix-like; on Windows prefer C:/...
        if trimmed.len() >= 2 && trimmed.as_bytes()[1] == b':' {
            trimmed.to_string()
        } else {
            format!("/{trimmed}")
        }
    } else if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
    };
    let decoded = percent_decode_path(&path);
    Some(decoded)
}

fn percent_decode_path(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (from_hex(bytes[i + 1]), from_hex(bytes[i + 2])) {
                out.push((hi << 4) | lo);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn from_hex(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
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
    fn extracts_markdown_file_paths() {
        let args = vec![
            "C:\\Users\\user\\notes\\readme.md".to_string(),
            "/tmp/doc.markdown".to_string(),
            "file:///C:/Users/user/notes/todo.md".to_string(),
        ];
        let extracted = extract_external_open_candidates(args);
        assert_eq!(extracted.len(), 3);
        assert!(extracted.iter().all(|item| item.kind == ExternalOpenKind::MarkdownFile));
        assert_eq!(extracted[0].value, "C:\\Users\\user\\notes\\readme.md");
        assert_eq!(extracted[1].value, "/tmp/doc.markdown");
        assert!(extracted[2].value.to_ascii_lowercase().ends_with("todo.md"));
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

    #[test]
    fn rewrites_ssh2_scheme_to_ssh() {
        let args = vec!["ssh2://root@example.com:22".to_string()];
        assert_eq!(
            extract_external_open_urls(args),
            vec!["ssh://root@example.com:22".to_string()]
        );
    }

    #[test]
    fn normalizes_xshell_url_flag_with_ssh_scheme() {
        let args = vec![
            "-url".to_string(),
            "ssh://admin:s3cret@10.0.0.5:2222".to_string(),
        ];
        assert_eq!(
            extract_external_open_urls(args),
            vec!["ssh://admin:s3cret@10.0.0.5:2222".to_string()]
        );
    }

    #[test]
    fn normalizes_xshell_url_flag_with_bare_target() {
        let args = vec!["-url".to_string(), "admin:secret@10.0.0.5:2222".to_string()];
        assert_eq!(
            extract_external_open_urls(args),
            vec!["ssh://admin:secret@10.0.0.5:2222".to_string()]
        );
    }

    #[test]
    fn normalizes_xshell_discrete_flags() {
        let args = vec![
            "-host".to_string(),
            "10.0.0.8".to_string(),
            "-user".to_string(),
            "ops".to_string(),
            "-port".to_string(),
            "2200".to_string(),
            "-pw".to_string(),
            "one-time".to_string(),
        ];
        assert_eq!(
            extract_external_open_urls(args),
            vec!["ssh://ops:one-time@10.0.0.8:2200".to_string()]
        );
    }

    #[test]
    fn normalizes_securecrt_ssh2_cli() {
        let args = vec![
            "/SSH2".to_string(),
            "/L".to_string(),
            "deploy".to_string(),
            "/PASSWORD".to_string(),
            "temp-pass".to_string(),
            "/P".to_string(),
            "2222".to_string(),
            "192.168.1.20".to_string(),
        ];
        assert_eq!(
            extract_external_open_urls(args),
            vec!["ssh://deploy:temp-pass@192.168.1.20:2222".to_string()]
        );
    }

    #[test]
    fn normalizes_securecrt_cli_with_tab_flag_and_user_at_host() {
        let args = vec![
            "/T".to_string(),
            "/SSH2".to_string(),
            "/PASSWORD".to_string(),
            "p@ss:word".to_string(),
            "root@bastion.example.com".to_string(),
        ];
        assert_eq!(
            extract_external_open_urls(args),
            vec!["ssh://root:p%40ss%3Aword@bastion.example.com:22".to_string()]
        );
    }

    #[test]
    fn xshell_url_does_not_double_count_ssh_arg() {
        let args = vec![
            "-url".to_string(),
            "ssh://root@host:22".to_string(),
            "--local".to_string(),
        ];
        assert_eq!(
            extract_external_open_urls(args),
            vec![
                "ssh://root@host:22".to_string(),
                "nyaterm://connect/local".to_string(),
            ]
        );
    }

    #[test]
    fn encodes_special_characters_in_bastion_password() {
        let args = vec![
            "-host".to_string(),
            "h".to_string(),
            "-user".to_string(),
            "u".to_string(),
            "-pw".to_string(),
            "a/b?c#d".to_string(),
        ];
        assert_eq!(
            extract_external_open_urls(args),
            vec!["ssh://u:a%2Fb%3Fc%23d@h:22".to_string()]
        );
    }
}
