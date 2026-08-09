use std::fs;
use std::net::{TcpStream, ToSocketAddrs};
use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::core::ssh::{DraftSshTestInput, build_test_ssh_config, test_authenticated_ssh};
use crate::error::{AppError, AppResult};

const TCP_TIMEOUT: Duration = Duration::from_secs(5);

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
        other => Err(AppError::Config(format!(
            "Unsupported protocol for connectivity test: {other}"
        ))),
    }
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
