fn prepare_output_file_path(file_path: &str) -> AppResult<PathBuf> {
    let path = PathBuf::from(file_path);
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)
                .map_err(|e| AppError::Config(format!("Failed to create directory: {e}")))?;
        }
    }
    Ok(path)
}

fn resolve_recording_path(
    profile: &RecordingProfile,
    context: &RecordingContext,
    size_suffix: Option<u64>,
) -> AppResult<PathBuf> {
    let mut path = PathBuf::new();
    for part in expand_recording_template(&profile.path_template, profile.mode, context)
        .components()
    {
        match part {
            Component::Normal(segment) => {
                let cleaned = sanitize_path_segment(&segment.to_string_lossy());
                if !cleaned.is_empty() {
                    path.push(cleaned);
                }
            }
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                path.push("safe");
            }
        }
    }

    if path.as_os_str().is_empty() {
        path.push(default_template_for_mode(profile.mode));
    }

    if let Some(index) = size_suffix {
        path = append_numbered_suffix(path, index);
    }

    Ok(profile.base_path.join(path))
}

fn expand_recording_template(
    template: &str,
    mode: RecordingMode,
    context: &RecordingContext,
) -> PathBuf {
    let template = if template.trim().is_empty() {
        default_template_for_mode(mode)
    } else {
        template.to_string()
    };
    let local = context.started_at;
    let replacements: Vec<(&str, String)> = vec![
        ("session", context.session_name.clone()),
        ("session_id", context.session_id.clone()),
        ("session_short_id", short_session_id(&context.session_id)),
        (
            "connection_id",
            context.connection_id.clone().unwrap_or_default(),
        ),
        (
            "connection",
            context.connection_name.clone().unwrap_or_default(),
        ),
        ("group", context.group_path.clone().unwrap_or_default()),
        ("protocol", context.protocol.clone()),
        ("host", context.host.clone().unwrap_or_default()),
        (
            "port",
            context.port.map_or_else(String::new, |port| port.to_string()),
        ),
        ("username", context.username.clone().unwrap_or_default()),
        ("yyyy", format_time(local, "yyyy")),
        ("MM", format_time(local, "MM")),
        ("dd", format_time(local, "dd")),
        ("HH", format_time(local, "HH")),
        ("mm", format_time(local, "mm")),
        ("ss", format_time(local, "ss")),
        ("SSS", format_time(local, "SSS")),
    ];

    let mut expanded = template;
    for (key, value) in replacements {
        expanded = expanded.replace(&format!("{{{key}}}"), &value);
    }
    expanded = expanded.replace("{session_id:8}", short_session_id(&context.session_id).as_str());

    if matches!(mode, RecordingMode::Raw)
        && expanded.ends_with(".log")
        && !expanded.ends_with(".raw.log")
    {
        expanded.truncate(expanded.len() - ".log".len());
        expanded.push_str(".raw.log");
    }

    PathBuf::from(expanded)
}

fn default_template_for_mode(mode: RecordingMode) -> String {
    match mode {
        RecordingMode::Transcript => {
            "{group}/{session}/{yyyy}-{MM}-{dd}/{HH}-{mm}-{ss}-{SSS}-{session_short_id}.log"
                .to_string()
        }
        RecordingMode::Raw => {
            "{group}/{session}/{yyyy}-{MM}-{dd}/{HH}-{mm}-{ss}-{SSS}-{session_short_id}.raw.log"
                .to_string()
        }
    }
}

fn sanitize_path_segment(segment: &str) -> String {
    let trimmed = segment.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        return String::new();
    }

    let mut safe = String::new();
    let mut last_was_replacement = false;
    for ch in trimmed.chars() {
        let invalid = matches!(ch, '<' | '>' | ':' | '"' | '|' | '?' | '*' | '\0')
            || ch == '/'
            || ch == '\\'
            || ch.is_control();
        if invalid {
            if !last_was_replacement {
                safe.push('_');
                last_was_replacement = true;
            }
        } else {
            safe.push(ch);
            last_was_replacement = false;
        }
    }

    let safe = safe.trim_matches([' ', '.']).to_string();
    if safe.is_empty() || safe == ".." {
        "session".to_string()
    } else {
        safe
    }
}

fn open_collision_safe_path(
    requested: &Path,
    behavior: ExistingFileBehavior,
) -> AppResult<PathBuf> {
    prepare_output_file_path(&requested.to_string_lossy())?;
    if behavior != ExistingFileBehavior::Unique || !requested.exists() {
        return Ok(requested.to_path_buf());
    }

    for index in 1..10_000u32 {
        let candidate = append_numbered_suffix(requested.to_path_buf(), index.into());
        if !candidate.exists() {
            prepare_output_file_path(&candidate.to_string_lossy())?;
            return Ok(candidate);
        }
    }

    Err(AppError::Config(
        "Failed to find a unique recording file name".to_string(),
    ))
}

fn open_recording_file(path: &Path, behavior: ExistingFileBehavior) -> AppResult<File> {
    let mut options = OpenOptions::new();
    options.write(true).create(true);
    match behavior {
        ExistingFileBehavior::Unique => {
            options.create_new(true);
        }
        ExistingFileBehavior::Append => {
            options.append(true);
        }
        ExistingFileBehavior::Overwrite => {
            options.truncate(true);
        }
    }
    options
        .open(path)
        .map_err(|e| AppError::Config(format!("Failed to create recording file: {e}")))
}

fn append_numbered_suffix(mut path: PathBuf, index: u64) -> PathBuf {
    let parent = path.parent().map(Path::to_path_buf).unwrap_or_default();
    let stem = path
        .file_stem()
        .map(|stem| stem.to_string_lossy().to_string())
        .unwrap_or_else(|| "recording".to_string());
    let extension = path.extension().map(|ext| ext.to_string_lossy().to_string());

    let mut filename = format!("{stem}-{index}");
    if let Some(extension) = extension {
        filename.push('.');
        filename.push_str(&extension);
    }
    path = parent;
    path.push(filename);
    path
}

fn format_session_header(context: &RecordingContext) -> String {
    let mut lines = vec![
        "========== NyaTerm Session ==========".to_string(),
        format!("Session: {}", context.session_name),
        format!("Protocol: {}", context.protocol),
    ];
    if let Some(connection_id) = context
        .connection_id
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        lines.push(format!("Connection ID: {connection_id}"));
    }
    if let Some(host) = context.host.as_ref() {
        let host_line = context
            .port
            .map_or_else(|| host.clone(), |port| format!("{host}:{port}"));
        lines.push(format!("Host: {host_line}"));
    }
    if let Some(username) = context.username.as_ref().filter(|value| !value.is_empty()) {
        lines.push(format!("User: {username}"));
    }
    lines.push(format!("Started: {}", format_recording_time(context.started_at)));
    lines.push("======================================".to_string());
    lines.push(String::new());
    lines.join("\n")
}

fn format_session_footer(context: &RecordingContext, reason: &str) -> String {
    let ended = OffsetDateTime::now_local().unwrap_or_else(|_| OffsetDateTime::now_utc());
    let duration = ended - context.started_at;
    format!(
        "\n========== Session End ==========\nEnded: {}\nDuration: {}\nReason: {}\n=================================\n",
        format_recording_time(ended),
        format_duration(duration),
        reason
    )
}

fn format_recording_time(value: OffsetDateTime) -> String {
    value
        .format(time::macros::format_description!(
            "[year]-[month]-[day] [hour]:[minute]:[second].[subsecond digits:3]"
        ))
        .unwrap_or_else(|_| "1970-01-01 00:00:00.000".to_string())
}

fn format_duration(duration: time::Duration) -> String {
    let seconds = duration.whole_seconds().max(0);
    let hours = seconds / 3600;
    let minutes = (seconds % 3600) / 60;
    let seconds = seconds % 60;
    format!("{hours:02}:{minutes:02}:{seconds:02}")
}

fn format_time(value: OffsetDateTime, token: &str) -> String {
    match token {
        "yyyy" => value
            .format(time::macros::format_description!("[year]"))
            .unwrap_or_default(),
        "MM" => value
            .format(time::macros::format_description!("[month]"))
            .unwrap_or_default(),
        "dd" => value
            .format(time::macros::format_description!("[day]"))
            .unwrap_or_default(),
        "HH" => value
            .format(time::macros::format_description!("[hour]"))
            .unwrap_or_default(),
        "mm" => value
            .format(time::macros::format_description!("[minute]"))
            .unwrap_or_default(),
        "ss" => value
            .format(time::macros::format_description!("[second]"))
            .unwrap_or_default(),
        "SSS" => value
            .format(time::macros::format_description!("[subsecond digits:3]"))
            .unwrap_or_default(),
        _ => String::new(),
    }
}

fn short_session_id(session_id: &str) -> String {
    session_id.chars().take(8).collect()
}

fn local_day_key(value: OffsetDateTime) -> String {
    value
        .format(time::macros::format_description!(
            "[year]-[month]-[day]"
        ))
        .unwrap_or_else(|_| "1970-01-01".to_string())
}

fn format_record_parts(
    timestamp: &str,
    label: &str,
    data: &str,
    include_io_labels: bool,
    include_timestamps: bool,
) -> String {
    match (include_timestamps, include_io_labels) {
        (true, true) => format!("[{timestamp}] [{label}] {data}\n"),
        (true, false) => format!("[{timestamp}] {data}\n"),
        (false, true) => format!("[{label}] {data}\n"),
        (false, false) => format!("{data}\n"),
    }
}

fn chrono_timestamp() -> String {
    let now = OffsetDateTime::now_local().unwrap_or_else(|_| OffsetDateTime::now_utc());
    now.format(time::macros::format_description!(
        "[year]-[month]-[day] [hour]:[minute]:[second].[subsecond digits:3]"
    ))
    .unwrap_or_else(|_| "1970-01-01 00:00:00.000".to_string())
}

#[cfg(test)]
fn consume_matching_prefix(prefix_buffer: &mut String, text: &str) -> usize {
    let mut prefix_idx = 0;
    let mut text_idx = 0;

    while prefix_idx < prefix_buffer.len() && text_idx < text.len() {
        let prefix_char = prefix_buffer[prefix_idx..].chars().next();
        let text_char = text[text_idx..].chars().next();

        match (prefix_char, text_char) {
            (Some(left), Some(right)) if left == right => {
                prefix_idx += left.len_utf8();
                text_idx += right.len_utf8();
            }
            _ => break,
        }
    }

    if prefix_idx > 0 {
        prefix_buffer.drain(..prefix_idx);
    }

    text_idx
}

fn strip_one_leading_newline(text: &str) -> &str {
    text.strip_prefix('\n').unwrap_or(text)
}

fn lock_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn rw_read_recover<T>(lock: &RwLock<T>) -> RwLockReadGuard<'_, T> {
    lock.read().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn rw_write_recover<T>(lock: &RwLock<T>) -> RwLockWriteGuard<'_, T> {
    lock.write().unwrap_or_else(|poisoned| poisoned.into_inner())
}
