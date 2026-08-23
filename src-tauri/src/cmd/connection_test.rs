use std::fs;
use std::net::{TcpStream, ToSocketAddrs};
use std::path::PathBuf;
use std::time::{Duration, Instant};

use opendal::services::S3;
use opendal::Operator;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Window};

use crate::core::ftp::{FtpConnectParams, SharedFtpManager};

use crate::core::ssh::{DraftSshTestInput, build_test_ssh_config, test_authenticated_ssh};
use crate::error::{AppError, AppResult};
use crate::utils::url::normalize_storage_endpoint;

const TCP_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestS3Input {
    #[serde(default)]
    pub endpoint: String,
    #[serde(default)]
    pub bucket: String,
    #[serde(default)]
    pub region: String,
    #[serde(default)]
    pub root: String,
    #[serde(default)]
    pub access_key_id: Option<String>,
    #[serde(default)]
    pub secret_access_key: Option<String>,
    #[serde(default)]
    pub session_token: Option<String>,
    #[serde(default)]
    pub virtual_host_style: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestFtpInput {
    #[serde(default)]
    pub host: String,
    #[serde(default = "default_ftp_test_port")]
    pub port: u16,
    #[serde(default = "default_ftp_test_root")]
    pub root: String,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub use_tls: bool,
}

fn default_ftp_test_port() -> u16 {
    21
}

fn default_ftp_test_root() -> String {
    "/".to_string()
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestWebDavInput {
    #[serde(default)]
    pub endpoint: String,
    #[serde(default)]
    pub root: String,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestConnectionEndpointRequest {
    pub protocol: String,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub shell_path: Option<String>,
    pub port_name: Option<String>,
    pub baud_rate: Option<u32>,
    pub data_bits: Option<u8>,
    pub parity: Option<String>,
    pub stop_bits: Option<String>,
    pub username: Option<String>,
    pub auth_mode: Option<String>,
    pub password: Option<String>,
    pub password_id: Option<String>,
    pub key_id: Option<String>,
    pub otp_id: Option<String>,
    pub auto_fill_otp: Option<bool>,
    pub proxy_id: Option<String>,
    pub jump_host_id: Option<String>,
    pub connection_id: Option<String>,
    pub use_stored_password: Option<bool>,
    #[serde(default)]
    pub s3: Option<TestS3Input>,
    #[serde(default)]
    pub ftp: Option<TestFtpInput>,
    #[serde(default)]
    pub webdav: Option<TestWebDavInput>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TestConnectionEndpointParams {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port_name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestConnectionEndpointResult {
    pub ok: bool,
    pub code: String,
    pub params: TestConnectionEndpointParams,
}

fn result(
    ok: bool,
    code: &str,
    params: TestConnectionEndpointParams,
) -> TestConnectionEndpointResult {
    TestConnectionEndpointResult {
        ok,
        code: code.to_string(),
        params,
    }
}

#[tauri::command]
pub async fn test_connection_endpoint(
    app: AppHandle,
    window: Window,
    request: TestConnectionEndpointRequest,
) -> AppResult<TestConnectionEndpointResult> {
    match request.protocol.as_str() {
        "ssh" => Ok(test_ssh(&app, request).await),
        "telnet" | "rdp" | "vnc" => Ok(test_tcp(request.host.as_deref(), request.port)),
        "local_terminal" | "local" => Ok(test_local_shell(request.shell_path.as_deref())),
        "serial" => Ok(test_serial(
            request.port_name.as_deref(),
            request.baud_rate.unwrap_or(115_200),
            request.data_bits.unwrap_or(8),
            request.parity.as_deref().unwrap_or("none"),
            request.stop_bits.as_deref().unwrap_or("1"),
        )),
        "s3" => Ok(test_s3(request.s3.as_ref(), request.connection_id.as_deref()).await),
        "ftp" => Ok(test_ftp(&app, window.label(), request.ftp.as_ref()).await),
        "webdav" => Ok(test_webdav(request.webdav.as_ref()).await),
        other => Err(AppError::Config(format!(
            "Unsupported protocol for connectivity test: {other}"
        ))),
    }
}

async fn test_s3(
    input: Option<&TestS3Input>,
    connection_id: Option<&str>,
) -> TestConnectionEndpointResult {
    let bucket = input
        .map(|i| i.bucket.trim().to_string())
        .unwrap_or_default();
    if bucket.is_empty() {
        return result(
            false,
            "s3_bucket_required",
            TestConnectionEndpointParams::default(),
        );
    }

    let operator = match build_s3_test_operator(input, connection_id) {
        Ok(op) => op,
        Err(err) => {
            return result(
                false,
                "s3_config_invalid",
                TestConnectionEndpointParams {
                    detail: Some(err.to_string()),
                    ..Default::default()
                },
            );
        }
    };

    // Probe the bucket with a cheap listing. Credentials and bucket reachability
    // are the most important signals here; an empty bucket is still a success.
    run_s3_probe(operator, &bucket).await
}

async fn test_ftp(
    app: &AppHandle,
    window_label: &str,
    input: Option<&TestFtpInput>,
) -> TestConnectionEndpointResult {
    let host = input
        .map(|value| value.host.trim().to_string())
        .unwrap_or_default();
    if host.is_empty() {
        return result(
            false,
            "ftp_host_required",
            TestConnectionEndpointParams::default(),
        );
    }
    let Some(input) = input else {
        return result(
            false,
            "ftp_config_invalid",
            TestConnectionEndpointParams::default(),
        );
    };

    let ftp_manager = app.state::<SharedFtpManager>().inner().clone();
    let params = FtpConnectParams {
        host: host.clone(),
        port: input.port,
        root: input.root.clone(),
        username: input
            .username
            .clone()
            .unwrap_or_default()
            .trim()
            .to_string(),
        password: input
            .password
            .clone()
            .unwrap_or_default()
            .trim()
            .to_string(),
        use_tls: input.use_tls,
    };
    let started = Instant::now();
    match ftp_manager
        .probe(app, params, Some(window_label))
        .await
    {
        Ok(()) => {
            tracing::debug!(
                target: "user_action",
                action = "test",
                entity = "ftp_connection",
                host = %host,
                elapsed_ms = started.elapsed().as_millis() as u64,
                "FTP connectivity test succeeded"
            );
            result(
                true,
                "ok",
                TestConnectionEndpointParams {
                    host: Some(host),
                    port: Some(input.port),
                    ..Default::default()
                },
            )
        }
        Err(err) => result(
            false,
            "ftp_fail",
            TestConnectionEndpointParams {
                host: Some(host),
                port: Some(input.port),
                detail: Some(err.to_string()),
                ..Default::default()
            },
        ),
    }
}

async fn run_s3_probe(operator: Operator, bucket: &str) -> TestConnectionEndpointResult {
    let started = Instant::now();
    let probe = operator.list("/").await;
    match probe {
        Ok(entries) => {
            let _ = bucket; // bucket is exercised by the operator config
            tracing::debug!(
                target: "user_action",
                action = "test",
                entity = "s3_connection",
                bucket = %bucket,
                entry_count = entries.len(),
                elapsed_ms = started.elapsed().as_millis() as u64,
                "S3 connectivity test succeeded"
            );
            result(
                true,
                "ok",
                TestConnectionEndpointParams {
                    host: Some(bucket.to_string()),
                    ..Default::default()
                },
            )
        }
        Err(err) => result(
            false,
            "s3_fail",
            TestConnectionEndpointParams {
                host: Some(bucket.to_string()),
                detail: Some(err.to_string()),
                ..Default::default()
            },
        ),
    }
}

async fn test_webdav(input: Option<&TestWebDavInput>) -> TestConnectionEndpointResult {
    let endpoint = input
        .map(|value| value.endpoint.trim().to_string())
        .unwrap_or_default();
    if endpoint.is_empty() {
        return result(
            false,
            "webdav_endpoint_required",
            TestConnectionEndpointParams::default(),
        );
    }

    let operator = match crate::core::webdav::build_opendal_webdav_operator(
        &endpoint,
        input.map(|value| value.root.as_str()).unwrap_or(""),
        input
            .and_then(|value| value.username.as_deref())
            .unwrap_or(""),
        input
            .and_then(|value| value.password.as_deref())
            .unwrap_or(""),
    ) {
        Ok(op) => op,
        Err(err) => {
            return result(
                false,
                "webdav_config_invalid",
                TestConnectionEndpointParams {
                    host: Some(endpoint),
                    detail: Some(err.to_string()),
                    ..Default::default()
                },
            );
        }
    };

    match operator.list("/").await {
        Ok(_) => result(
            true,
            "ok",
            TestConnectionEndpointParams {
                host: Some(endpoint),
                ..Default::default()
            },
        ),
        Err(err) => result(
            false,
            crate::core::webdav::webdav_test_error_code(&err),
            TestConnectionEndpointParams {
                host: Some(endpoint),
                ..Default::default()
            },
        ),
    }
}

fn build_s3_test_operator(
    input: Option<&TestS3Input>,
    _connection_id: Option<&str>,
) -> AppResult<Operator> {
    let input = input.ok_or_else(|| {
        AppError::Config("S3 test requires form fields".into())
    })?;

    let mut builder = S3::default().bucket(&input.bucket);
    let normalized_endpoint = normalize_storage_endpoint(&input.endpoint);
    if !normalized_endpoint.is_empty() {
        builder = builder.endpoint(&normalized_endpoint);
    }
    if !input.region.trim().is_empty() {
        builder = builder.region(&input.region);
    }
    if !input.root.trim().is_empty() {
        builder = builder.root(&input.root);
    }
    if let Some(key) = input
        .access_key_id
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        builder = builder.access_key_id(key);
    }
    if let Some(secret) = input
        .secret_access_key
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        builder = builder.secret_access_key(secret);
    }
    if let Some(token) = input
        .session_token
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        builder = builder.session_token(token);
    }
    if input.virtual_host_style {
        builder = builder.enable_virtual_host_style();
    }

    Ok(Operator::new(builder).map_err(|err| AppError::Config(format!("S3 error: {err}")))?)
}

async fn test_ssh(
    app: &AppHandle,
    request: TestConnectionEndpointRequest,
) -> TestConnectionEndpointResult {
    let host = match request
        .host
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(host) => host.to_string(),
        None => {
            return result(
                false,
                "host_required",
                TestConnectionEndpointParams::default(),
            );
        }
    };
    let port = match request.port.filter(|value| *value > 0) {
        Some(port) => port,
        None => {
            return result(
                false,
                "port_required",
                TestConnectionEndpointParams {
                    host: Some(host),
                    ..Default::default()
                },
            );
        }
    };
    let username = match request
        .username
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(username) => username.to_string(),
        None => {
            return result(
                false,
                "username_required",
                TestConnectionEndpointParams {
                    host: Some(host),
                    port: Some(port),
                    ..Default::default()
                },
            );
        }
    };

    let auth_mode = request
        .auth_mode
        .as_deref()
        .unwrap_or("password")
        .to_string();

    let input = DraftSshTestInput {
        host: host.clone(),
        port,
        username,
        auth_mode,
        password: request.password,
        password_id: request.password_id,
        key_id: request.key_id,
        otp_id: request.otp_id,
        auto_fill_otp: request.auto_fill_otp.unwrap_or(false),
        proxy_id: request.proxy_id,
        jump_host_id: request.jump_host_id,
        connection_id: request.connection_id,
        use_stored_password: request.use_stored_password.unwrap_or(false),
    };

    let config = match build_test_ssh_config(app, input) {
        Ok(config) => config,
        Err(error) => return map_ssh_error(&host, port, &error),
    };

    match test_authenticated_ssh(app, &config).await {
        Ok(()) => result(
            true,
            "ssh_ok",
            TestConnectionEndpointParams {
                host: Some(host),
                port: Some(port),
                ..Default::default()
            },
        ),
        Err(error) => map_ssh_error(&host, port, &error),
    }
}

fn map_ssh_error(host: &str, port: u16, error: &AppError) -> TestConnectionEndpointResult {
    let detail = error.to_string();
    let lower = detail.to_ascii_lowercase();
    let code = if lower.contains("credentials_required")
        || lower.contains("password is required")
        || lower.contains("no usable default openssh")
        || lower.contains("no key data")
    {
        "credentials_required"
    } else if lower.contains("interactive authentication required")
        || lower.contains("interactive 2fa required")
    {
        "auth_prompt_required"
    } else if lower.contains("could not reach")
        || lower.contains("timed out")
        || lower.contains("connection refused")
        || lower.contains("failed to resolve")
        || lower.contains("network")
        || lower.contains("os error")
        || lower.contains("i/o error")
        || lower.contains("io error")
    {
        "tcp_fail"
    } else {
        "ssh_auth_fail"
    };

    result(
        false,
        code,
        TestConnectionEndpointParams {
            host: Some(host.to_string()),
            port: Some(port),
            detail: Some(detail),
            ..Default::default()
        },
    )
}

fn test_tcp(host: Option<&str>, port: Option<u16>) -> TestConnectionEndpointResult {
    let host = match host.map(str::trim).filter(|value| !value.is_empty()) {
        Some(host) => host.to_string(),
        None => {
            return result(
                false,
                "host_required",
                TestConnectionEndpointParams::default(),
            );
        }
    };
    let port = match port.filter(|value| *value > 0) {
        Some(port) => port,
        None => {
            return result(
                false,
                "port_required",
                TestConnectionEndpointParams {
                    host: Some(host),
                    ..Default::default()
                },
            );
        }
    };

    let addr = format!("{host}:{port}");
    let mut last_error = String::from("name resolution failed");
    let addrs = match (host.as_str(), port).to_socket_addrs() {
        Ok(addrs) => addrs,
        Err(err) => {
            return result(
                false,
                "tcp_fail",
                TestConnectionEndpointParams {
                    host: Some(host),
                    port: Some(port),
                    detail: Some(format!("Failed to resolve {addr}: {err}")),
                    ..Default::default()
                },
            );
        }
    };

    for socket_addr in addrs {
        match TcpStream::connect_timeout(&socket_addr, TCP_TIMEOUT) {
            Ok(stream) => {
                let _ = stream.shutdown(std::net::Shutdown::Both);
                return result(
                    true,
                    "tcp_ok",
                    TestConnectionEndpointParams {
                        host: Some(host),
                        port: Some(port),
                        ..Default::default()
                    },
                );
            }
            Err(err) => {
                last_error = err.to_string();
            }
        }
    }

    result(
        false,
        "tcp_fail",
        TestConnectionEndpointParams {
            host: Some(host),
            port: Some(port),
            detail: Some(last_error),
            ..Default::default()
        },
    )
}

fn test_local_shell(shell_path: Option<&str>) -> TestConnectionEndpointResult {
    let shell_path = match shell_path.map(str::trim).filter(|value| !value.is_empty()) {
        Some(path) => path.to_string(),
        None => {
            return result(
                false,
                "shell_path_required",
                TestConnectionEndpointParams::default(),
            );
        }
    };

    let path = PathBuf::from(&shell_path);
    if !path.exists() {
        return result(
            false,
            "shell_missing",
            TestConnectionEndpointParams {
                path: Some(shell_path),
                ..Default::default()
            },
        );
    }
    match fs::metadata(&path) {
        Ok(meta) if meta.is_file() => result(
            true,
            "shell_ok",
            TestConnectionEndpointParams {
                path: Some(shell_path),
                ..Default::default()
            },
        ),
        Ok(_) => result(
            false,
            "shell_missing",
            TestConnectionEndpointParams {
                path: Some(shell_path),
                detail: Some("Shell path is not a file".to_string()),
                ..Default::default()
            },
        ),
        Err(err) => result(
            false,
            "shell_missing",
            TestConnectionEndpointParams {
                path: Some(shell_path),
                detail: Some(err.to_string()),
                ..Default::default()
            },
        ),
    }
}

fn test_serial(
    port_name: Option<&str>,
    baud_rate: u32,
    data_bits: u8,
    parity: &str,
    stop_bits: &str,
) -> TestConnectionEndpointResult {
    let port_name = match port_name.map(str::trim).filter(|value| !value.is_empty()) {
        Some(name) => name.to_string(),
        None => {
            return result(
                false,
                "serial_port_required",
                TestConnectionEndpointParams::default(),
            );
        }
    };

    let data_bits = match data_bits {
        5 => serialport::DataBits::Five,
        6 => serialport::DataBits::Six,
        7 => serialport::DataBits::Seven,
        _ => serialport::DataBits::Eight,
    };
    let parity = match parity.to_ascii_lowercase().as_str() {
        "even" => serialport::Parity::Even,
        "odd" => serialport::Parity::Odd,
        _ => serialport::Parity::None,
    };
    let stop_bits = match stop_bits {
        "2" | "two" => serialport::StopBits::Two,
        _ => serialport::StopBits::One,
    };

    match serialport::new(&port_name, baud_rate)
        .data_bits(data_bits)
        .parity(parity)
        .stop_bits(stop_bits)
        .timeout(Duration::from_millis(500))
        .open()
    {
        Ok(_port) => result(
            true,
            "serial_ok",
            TestConnectionEndpointParams {
                port_name: Some(port_name),
                ..Default::default()
            },
        ),
        Err(err) => result(
            false,
            "serial_fail",
            TestConnectionEndpointParams {
                port_name: Some(port_name),
                detail: Some(err.to_string()),
                ..Default::default()
            },
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tcp_requires_host() {
        let result = test_tcp(None, Some(22));
        assert!(!result.ok);
        assert_eq!(result.code, "host_required");
    }

    #[test]
    fn local_shell_missing_path_fails() {
        let result = test_local_shell(Some(
            "__nyaterm_missing_shell_path_that_should_not_exist__",
        ));
        assert!(!result.ok);
        assert_eq!(result.code, "shell_missing");
    }
}
