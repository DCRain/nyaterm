use crate::config::{self, SavedConnection};
use crate::error::{AppError, AppResult};
use crate::utils::crypto;
use std::collections::HashSet;

pub fn save_connection(app: &impl Sized, mut connection: SavedConnection) -> AppResult<String> {
    let mut cfg = config::load_config(app)?;

    if connection.id.is_empty() {
        connection.id = uuid::Uuid::new_v4().to_string();
    }
    let target_id = connection.id.clone();
    let existing = cfg.connections.iter().find(|c| c.id == target_id).cloned();

    normalize_connection_for_save(&mut connection);

    config::validate_ssh_agent_settings(&connection.config)?;
    validate_proxy_jump_config(&connection, &cfg.connections)?;
    validate_ssh_algorithm_config(&connection)?;
    validate_sftp_settings_config(&connection)?;
    validate_rdp_config(&connection)?;
    validate_vnc_config(&connection)?;
    validate_s3_config(&connection)?;
    validate_ftp_config(&connection)?;
    validate_webdav_config(&connection)?;
    merge_s3_secrets_for_save(&mut connection, existing.as_ref())?;
    merge_ftp_secrets_for_save(&mut connection, existing.as_ref())?;
    merge_webdav_secrets_for_save(&mut connection, existing.as_ref())?;

    if let Some(ref mut auth) = connection.auth {
        // account_id: Some("") means explicitly cleared, None means preserve existing
        match auth.account_id.as_deref() {
            Some("") => auth.account_id = None,
            None => {
                auth.account_id = existing
                    .as_ref()
                    .and_then(|entry| entry.auth.as_ref())
                    .and_then(|entry| entry.account_id.clone());
            }
            _ => {}
        }

        // password_source: Some("") means legacy/default behavior, None means preserve existing
        match auth.password_source.as_deref() {
            Some("") => auth.password_source = None,
            None => {
                auth.password_source = existing
                    .as_ref()
                    .and_then(|entry| entry.auth.as_ref())
                    .and_then(|entry| entry.password_source.clone());
            }
            _ => {}
        }

        // password_id: Some("") means explicitly cleared, None means preserve existing
        match auth.password_id.as_deref() {
            Some("") => auth.password_id = None,
            None => {
                auth.password_id = existing
                    .as_ref()
                    .and_then(|e| e.auth.as_ref())
                    .and_then(|a| a.password_id.clone());
            }
            _ => {}
        }

        if matches!(
            connection.config,
            config::ConnectionType::Ssh { .. } | config::ConnectionType::Telnet { .. }
        ) && auth.account_id.as_deref().is_some_and(|id| !id.is_empty())
        {
            auth.password_id = None;
        }

        // password: non-empty = encrypt new value, "" = explicitly clear, None = preserve
        auth.password = match auth.password.as_deref() {
            Some(plain) if !plain.is_empty() => Some(crypto::encrypt(plain)?),
            Some("") => None,
            None => existing
                .as_ref()
                .and_then(|e| e.auth.as_ref())
                .and_then(|a| a.password.clone()),
            _ => None,
        };
        auth.has_password = false;
    }

    if let Some(existing_connection) = existing.as_ref() {
        connection.asset = existing_connection.asset.clone();
    }

    if let Some(ex) = cfg.connections.iter_mut().find(|c| c.id == target_id) {
        *ex = connection;
    } else {
        cfg.connections.push(connection);
    }
    config::save_config(app, &cfg)?;
    Ok(target_id)
}

pub fn normalize_connection_for_save(connection: &mut SavedConnection) {
    config::migrate_legacy_ssh_agent_settings(connection);
    config::migrate_legacy_asset_tags(connection);
    normalize_rdp_client_mode_fields(connection);
}

/// Keep legacy `client_mode` aligned with `rdp_client_mode` when the latter is set.
fn normalize_rdp_client_mode_fields(connection: &mut SavedConnection) {
    let config::ConnectionType::Rdp {
        rdp_client_mode,
        client_mode,
        ..
    } = &mut connection.config
    else {
        return;
    };
    match rdp_client_mode.as_deref() {
        Some("builtin") => *client_mode = "builtin".to_string(),
        Some("windows") => *client_mode = "external".to_string(),
        _ => {}
    }
}

pub fn validate_ssh_algorithm_config(connection: &SavedConnection) -> AppResult<()> {
    if !matches!(
        connection.config,
        config::ConnectionType::Ssh { .. } | config::ConnectionType::Sftp { .. }
    ) {
        return Ok(());
    }

    let Some(preferences) = connection.ssh_algorithms.as_ref() else {
        return Ok(());
    };

    crate::ssh::algorithms::validate_ssh_algorithm_preferences(preferences)
}

pub fn validate_sftp_settings_config(connection: &SavedConnection) -> AppResult<()> {
    if !matches!(
        connection.config,
        config::ConnectionType::Ssh { .. } | config::ConnectionType::Sftp { .. }
    ) {
        return Ok(());
    }

    let timeout_ms = connection.sftp.shell_detection_timeout_ms;
    if !(config::MIN_SFTP_SHELL_DETECTION_TIMEOUT_MS..=config::MAX_SFTP_SHELL_DETECTION_TIMEOUT_MS)
        .contains(&timeout_ms)
    {
        return Err(AppError::Config(format!(
            "SFTP shell detection timeout must be between {} and {} ms",
            config::MIN_SFTP_SHELL_DETECTION_TIMEOUT_MS,
            config::MAX_SFTP_SHELL_DETECTION_TIMEOUT_MS
        )));
    }

    Ok(())
}

pub fn validate_rdp_config(connection: &SavedConnection) -> AppResult<()> {
    let config::ConnectionType::Rdp {
        rdp_client_mode,
        host,
        port,
        username,
        security,
        display,
        clipboard,
        reconnect,
        ..
    } = &connection.config
    else {
        return Ok(());
    };

    if let Some(mode) = rdp_client_mode
        && !matches!(mode.as_str(), "builtin" | "windows")
    {
        return Err(AppError::Config("RDP client mode is invalid".to_string()));
    }

    if host.trim().is_empty() {
        return Err(AppError::Config("RDP host is required".to_string()));
    }
    if *port == 0 {
        return Err(AppError::Config(
            "RDP port must be between 1 and 65535".to_string(),
        ));
    }
    if username.trim().is_empty() {
        return Err(AppError::Config("RDP username is required".to_string()));
    }
    if !matches!(
        security.certificate_policy.as_str(),
        "strict" | "prompt" | "accept-temporarily"
    ) {
        return Err(AppError::Config(
            "RDP certificate policy is invalid".to_string(),
        ));
    }
    if !matches!(display.mode.as_str(), "fit-window" | "fixed" | "native") {
        return Err(AppError::Config("RDP display mode is invalid".to_string()));
    }
    if !(640..=7680).contains(&display.width) || !(480..=4320).contains(&display.height) {
        return Err(AppError::Config(
            "RDP display size is outside the supported range".to_string(),
        ));
    }
    if !matches!(display.color_depth, 16 | 24 | 32) {
        return Err(AppError::Config("RDP color depth is invalid".to_string()));
    }
    if !matches!(
        clipboard.mode.as_str(),
        "disabled" | "text-only" | "text-and-files"
    ) {
        return Err(AppError::Config(
            "RDP clipboard mode is invalid".to_string(),
        ));
    }
    if reconnect.max_attempts > 20 {
        return Err(AppError::Config(
            "RDP reconnect attempts must be 20 or fewer".to_string(),
        ));
    }

    Ok(())
}

pub fn validate_vnc_config(connection: &SavedConnection) -> AppResult<()> {
    let config::ConnectionType::Vnc {
        host,
        port,
        security,
        display,
        reconnect,
        ..
    } = &connection.config
    else {
        return Ok(());
    };

    if host.trim().is_empty() {
        return Err(AppError::Config("VNC host is required".to_string()));
    }
    if *port == 0 {
        return Err(AppError::Config(
            "VNC port must be between 1 and 65535".to_string(),
        ));
    }
    if !matches!(security.mode.as_str(), "auto" | "vnc-auth" | "none") {
        return Err(AppError::Config("VNC security mode is invalid".to_string()));
    }
    if !matches!(display.scale_mode.as_str(), "fit" | "actual" | "stretch") {
        return Err(AppError::Config("VNC scale mode is invalid".to_string()));
    }
    if reconnect.max_attempts > 20 {
        return Err(AppError::Config(
            "VNC reconnect attempts must be 20 or fewer".to_string(),
        ));
    }

    Ok(())
}

pub fn validate_proxy_jump_config(
    connection: &SavedConnection,
    existing_connections: &[SavedConnection],
) -> AppResult<()> {
    let proxy_jump_id = connection
        .network
        .as_ref()
        .and_then(|network| network.proxy_jump_id.as_deref());

    let Some(proxy_jump_id) = proxy_jump_id else {
        return Ok(());
    };

    if !matches!(
        connection.config,
        config::ConnectionType::Ssh { .. }
            | config::ConnectionType::Sftp { .. }
            | config::ConnectionType::Telnet { .. }
            | config::ConnectionType::Rdp { .. }
            | config::ConnectionType::Vnc { .. }
    ) {
        return Err(AppError::Config(
            "ProxyJump is only supported for SSH, SFTP, Telnet, RDP, and VNC connections"
                .to_string(),
        ));
    }

    let mut visited = HashSet::new();
    visited.insert(connection.id.as_str());
    let mut current_jump_id = proxy_jump_id;

    loop {
        if visited.len() > 8 {
            return Err(AppError::Config("SSH jump chain exceeds 8 hops".into()));
        }
        if !visited.insert(current_jump_id) {
            if connection.id == current_jump_id {
                return Err(AppError::Config(
                    "A connection cannot use itself as a jump host".to_string(),
                ));
            }
            return Err(AppError::Config(format!(
                "ProxyJump chain contains a cycle at '{}'",
                current_jump_id
            )));
        }

        let jump_connection =
            find_connection_for_proxy_jump(connection, existing_connections, current_jump_id)
                .ok_or_else(|| {
                    AppError::Config(format!("Jump host '{}' not found", current_jump_id))
                })?;

        if !matches!(jump_connection.config, config::ConnectionType::Ssh { .. }) {
            return Err(AppError::Config(
                "Only SSH connections can be used as jump hosts".to_string(),
            ));
        }

        let Some(next_jump_id) = jump_connection
            .network
            .as_ref()
            .and_then(|network| network.proxy_jump_id.as_deref())
        else {
            break;
        };

        current_jump_id = next_jump_id;
    }

    Ok(())
}

fn find_connection_for_proxy_jump<'a>(
    edited_connection: &'a SavedConnection,
    existing_connections: &'a [SavedConnection],
    id: &str,
) -> Option<&'a SavedConnection> {
    if edited_connection.id == id {
        return Some(edited_connection);
    }

    existing_connections
        .iter()
        .find(|candidate| candidate.id == id)
}

fn missing_private_key_passphrase_error(error: &russh::keys::Error) -> bool {
    let message = error.to_string().to_lowercase();
    message.contains("encrypted")
        || message.contains("passphrase")
        || message.contains("password")
        || message.contains("cipher")
}

pub fn validate_private_key_content(content: &str, passphrase: Option<&str>) -> AppResult<()> {
    let usable_passphrase = passphrase.filter(|value| !value.is_empty());
    match russh::keys::decode_secret_key(content, usable_passphrase) {
        Ok(_) => Ok(()),
        Err(error)
            if usable_passphrase.is_none() && missing_private_key_passphrase_error(&error) =>
        {
            Ok(())
        }
        Err(error) => Err(AppError::Config(format!(
            "invalid SSH private key: {error}"
        ))),
    }
}

pub fn derive_public_key_for_copy(content: &str, passphrase: Option<&str>) -> AppResult<String> {
    let usable_passphrase = passphrase.filter(|value| !value.is_empty());
    if let Ok(private_key) = russh::keys::decode_secret_key(content, usable_passphrase) {
        return private_key.public_key().to_openssh().map_err(|error| {
            AppError::Config(format!("failed to encode SSH public key: {error}"))
        });
    }

    // OpenSSH containers keep the public key outside the encrypted private payload.
    let private_key = ssh_key::PrivateKey::from_openssh(content)
        .map_err(|error| AppError::Config(format!("failed to derive SSH public key: {error}")))?;
    private_key
        .public_key()
        .to_openssh()
        .map_err(|error| AppError::Config(format!("failed to encode SSH public key: {error}")))
}

pub fn validate_certificate_content(content: &str) -> AppResult<()> {
    russh::keys::Certificate::from_openssh(content)
        .map(|_| ())
        .map_err(|error| AppError::Config(format!("invalid OpenSSH certificate: {error}")))
}

pub fn validate_s3_config(connection: &SavedConnection) -> AppResult<()> {
    let config::ConnectionType::S3 { bucket, .. } = &connection.config else {
        return Ok(());
    };

    if bucket.trim().is_empty() {
        return Err(AppError::Config("S3 bucket is required".to_string()));
    }
    Ok(())
}

pub fn merge_s3_secrets_for_save(
    connection: &mut SavedConnection,
    existing: Option<&SavedConnection>,
) -> AppResult<()> {
    let config::ConnectionType::S3 {
        access_key_id,
        secret_access_key,
        session_token,
        has_secret_access_key,
        ..
    } = &mut connection.config
    else {
        return Ok(());
    };

    let existing_s3 = existing.and_then(|conn| match &conn.config {
        config::ConnectionType::S3 {
            access_key_id,
            secret_access_key,
            session_token,
            ..
        } => Some((
            access_key_id.clone(),
            secret_access_key.clone(),
            session_token.clone(),
        )),
        _ => None,
    });

    *access_key_id = match access_key_id.as_deref() {
        Some(config::MASKED_SECRET_VALUE) | None => {
            existing_s3.as_ref().and_then(|(id, _, _)| id.clone())
        }
        Some("") => None,
        Some(plain) => Some(crypto::encrypt(plain)?),
    };
    *secret_access_key = match secret_access_key.as_deref() {
        Some(config::MASKED_SECRET_VALUE) | None => {
            existing_s3.as_ref().and_then(|(_, secret, _)| secret.clone())
        }
        Some("") => None,
        Some(plain) => Some(crypto::encrypt(plain)?),
    };
    *session_token = match session_token.as_deref() {
        Some(config::MASKED_SECRET_VALUE) | None => {
            existing_s3.as_ref().and_then(|(_, _, token)| token.clone())
        }
        Some("") => None,
        Some(plain) => Some(crypto::encrypt(plain)?),
    };
    *has_secret_access_key = false;
    Ok(())
}

pub fn validate_ftp_config(connection: &SavedConnection) -> AppResult<()> {
    let config::ConnectionType::Ftp { host, .. } = &connection.config else {
        return Ok(());
    };

    if host.trim().is_empty() {
        return Err(AppError::Config("FTP host is required".to_string()));
    }
    Ok(())
}

pub fn merge_ftp_secrets_for_save(
    connection: &mut SavedConnection,
    existing: Option<&SavedConnection>,
) -> AppResult<()> {
    let config::ConnectionType::Ftp {
        username,
        password,
        has_password,
        ..
    } = &mut connection.config
    else {
        return Ok(());
    };

    let existing_ftp = existing.and_then(|conn| match &conn.config {
        config::ConnectionType::Ftp {
            username, password, ..
        } => Some((username.clone(), password.clone())),
        _ => None,
    });

    *username = match username.as_deref() {
        Some(config::MASKED_SECRET_VALUE) | None => {
            existing_ftp.as_ref().and_then(|(user, _)| user.clone())
        }
        Some("") => None,
        Some(plain) => Some(crypto::encrypt(plain)?),
    };
    *password = match password.as_deref() {
        Some(config::MASKED_SECRET_VALUE) | None => {
            existing_ftp.as_ref().and_then(|(_, pass)| pass.clone())
        }
        Some("") => None,
        Some(plain) => Some(crypto::encrypt(plain)?),
    };
    *has_password = false;
    Ok(())
}

pub fn validate_webdav_config(connection: &SavedConnection) -> AppResult<()> {
    let config::ConnectionType::WebDav { endpoint, .. } = &connection.config else {
        return Ok(());
    };

    if endpoint.trim().is_empty() {
        return Err(AppError::Config("WebDAV endpoint is required".to_string()));
    }
    Ok(())
}

pub fn merge_webdav_secrets_for_save(
    connection: &mut SavedConnection,
    existing: Option<&SavedConnection>,
) -> AppResult<()> {
    let config::ConnectionType::WebDav {
        username,
        password,
        has_password,
        ..
    } = &mut connection.config
    else {
        return Ok(());
    };

    let existing_webdav = existing.and_then(|conn| match &conn.config {
        config::ConnectionType::WebDav {
            username, password, ..
        } => Some((username.clone(), password.clone())),
        _ => None,
    });

    *username = match username.as_deref() {
        Some(config::MASKED_SECRET_VALUE) | None => {
            existing_webdav.as_ref().and_then(|(user, _)| user.clone())
        }
        Some("") => None,
        Some(plain) => Some(crypto::encrypt(plain)?),
    };
    *password = match password.as_deref() {
        Some(config::MASKED_SECRET_VALUE) | None => {
            existing_webdav.as_ref().and_then(|(_, pass)| pass.clone())
        }
        Some("") => None,
        Some(plain) => Some(crypto::encrypt(plain)?),
    };
    *has_password = false;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{
        ConnectionType, RdpClipboardSettings, RdpDisplaySettings, RdpReconnectSettings,
        RdpSecuritySettings, SavedConnection,
    };

    fn sample_rdp(rdp_client_mode: Option<&str>, client_mode: &str) -> SavedConnection {
        SavedConnection {
            id: "rdp-1".to_string(),
            name: "RDP".to_string(),
            config: ConnectionType::Rdp {
                rdp_client_mode: rdp_client_mode.map(str::to_string),
                host: "example.com".to_string(),
                port: 3389,
                username: "administrator".to_string(),
                domain: String::new(),
                client_mode: client_mode.to_string(),
                security: RdpSecuritySettings::default(),
                display: RdpDisplaySettings::default(),
                clipboard: RdpClipboardSettings::default(),
                reconnect: RdpReconnectSettings::default(),
                display_mode: "fullscreen".to_string(),
                width: 1920,
                height: 1080,
                redirect_clipboard: true,
                redirect_printers: false,
                redirect_com_ports: false,
                redirect_smart_cards: false,
                drive_redirect: String::new(),
                device_redirect: String::new(),
                camera_redirect: String::new(),
                audio_mode: 0,
                audio_capture: true,
                keyboard_hook: 2,
                preferred_client: String::new(),
            },
            group_id: None,
            description: None,
            tags: Vec::new(),
            sort_order: 0,
            open_on_startup: false,
            icon: None,
            icon_auto_detect: None,
            auth: None,
            network: None,
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

    #[test]
    fn normalize_syncs_legacy_client_mode_from_rdp_client_mode() {
        let mut builtin = sample_rdp(Some("builtin"), "external");
        normalize_connection_for_save(&mut builtin);
        let ConnectionType::Rdp {
            client_mode,
            rdp_client_mode,
            ..
        } = &builtin.config
        else {
            panic!("expected RDP");
        };
        assert_eq!(rdp_client_mode.as_deref(), Some("builtin"));
        assert_eq!(client_mode, "builtin");

        let mut windows = sample_rdp(Some("windows"), "builtin");
        normalize_connection_for_save(&mut windows);
        let ConnectionType::Rdp { client_mode, .. } = &windows.config else {
            panic!("expected RDP");
        };
        assert_eq!(client_mode, "external");

        let mut legacy = sample_rdp(None, "external");
        normalize_connection_for_save(&mut legacy);
        let ConnectionType::Rdp { client_mode, .. } = &legacy.config else {
            panic!("expected RDP");
        };
        assert_eq!(client_mode, "external");
    }
}
