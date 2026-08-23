use crate::config::{self, ConnectionNetwork, ProxySettings};
use crate::error::{AppError, AppResult};
use std::net::SocketAddr;
use tauri::AppHandle;
use tokio::io::{AsyncRead, AsyncWrite};

pub trait AsyncReadWrite: AsyncRead + AsyncWrite {}
impl<T: AsyncRead + AsyncWrite + ?Sized> AsyncReadWrite for T {}

pub type BoxedTransportStream = Box<dyn AsyncReadWrite + Unpin + Send + Sync>;

pub struct OpenedTransport {
    pub stream: BoxedTransportStream,
    pub local_addr: Option<SocketAddr>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransportRouteKind {
    Direct,
    Proxy,
    SshJump,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedTransportRoute {
    pub kind: TransportRouteKind,
    pub proxy_id: Option<String>,
    pub proxy_jump_id: Option<String>,
}

pub fn resolve_transport_route(network: Option<&ConnectionNetwork>) -> ResolvedTransportRoute {
    let proxy_jump_id = network
        .and_then(|network| network.proxy_jump_id.as_deref())
        .filter(|id| !id.trim().is_empty())
        .map(ToOwned::to_owned);
    let proxy_id = network
        .and_then(|network| network.proxy_id.as_deref())
        .filter(|id| !id.trim().is_empty())
        .map(ToOwned::to_owned);

    if proxy_jump_id.is_some() {
        return ResolvedTransportRoute {
            kind: TransportRouteKind::SshJump,
            proxy_id,
            proxy_jump_id,
        };
    }

    if proxy_id.is_some() {
        return ResolvedTransportRoute {
            kind: TransportRouteKind::Proxy,
            proxy_id,
            proxy_jump_id: None,
        };
    }

    ResolvedTransportRoute {
        kind: TransportRouteKind::Direct,
        proxy_id: None,
        proxy_jump_id: None,
    }
}

pub async fn open_tcp_transport(
    app: &AppHandle,
    target_host: &str,
    target_port: u16,
    network: Option<&ConnectionNetwork>,
    owner_window_label: Option<String>,
) -> AppResult<OpenedTransport> {
    let route = resolve_transport_route(network);
    match route.kind {
        TransportRouteKind::SshJump => {
            let jump_id = route
                .proxy_jump_id
                .as_deref()
                .ok_or_else(|| AppError::Config("ProxyJump id is empty".to_string()))?;
            let stream = crate::core::ssh::open_ssh_direct_tcpip_stream(
                app,
                jump_id,
                target_host,
                target_port,
                owner_window_label,
            )
            .await
            .map_err(|error| AppError::Channel(format!("SSH jump connection failed: {error}")))?;
            Ok(OpenedTransport {
                stream: Box::new(stream),
                local_addr: None,
            })
        }
        TransportRouteKind::Proxy => {
            let proxy_id = route
                .proxy_id
                .as_deref()
                .ok_or_else(|| AppError::Config("Proxy id is empty".to_string()))?;
            let proxy = resolve_proxy(app, proxy_id)?;
            open_proxy_transport(proxy, target_host, target_port).await
        }
        TransportRouteKind::Direct => open_direct_transport(target_host, target_port).await,
    }
}

async fn open_direct_transport(target_host: &str, target_port: u16) -> AppResult<OpenedTransport> {
    let stream = tokio::net::TcpStream::connect((target_host, target_port))
        .await
        .map_err(|error| {
            AppError::Channel(format!(
                "Direct TCP connection to {target_host}:{target_port} failed: {error}"
            ))
        })?;
    let local_addr = stream.local_addr().ok();
    Ok(OpenedTransport {
        stream: Box::new(stream),
        local_addr,
    })
}

async fn open_proxy_transport(
    proxy: ProxySettings,
    target_host: &str,
    target_port: u16,
) -> AppResult<OpenedTransport> {
    let proxy_addr = format!("{}:{}", proxy.host, proxy.port);
    match proxy.protocol.as_str() {
        "socks5" => {
            let stream = match (&proxy.username, &proxy.password) {
                (Some(user), Some(pass)) => {
                    tokio_socks::tcp::Socks5Stream::connect_with_password(
                        proxy_addr.as_str(),
                        (target_host, target_port),
                        user,
                        pass,
                    )
                    .await
                }
                _ => {
                    tokio_socks::tcp::Socks5Stream::connect(
                        proxy_addr.as_str(),
                        (target_host, target_port),
                    )
                    .await
                }
            }
            .map_err(|error| AppError::Auth(format!("SOCKS5 proxy connection failed: {error}")))?
            .into_inner();
            let local_addr = stream.local_addr().ok();
            Ok(OpenedTransport {
                stream: Box::new(stream),
                local_addr,
            })
        }
        "http" => {
            let mut stream =
                tokio::net::TcpStream::connect(&proxy_addr)
                    .await
                    .map_err(|error| {
                        AppError::Channel(format!("HTTP proxy connection failed: {error}"))
                    })?;
            match (&proxy.username, &proxy.password) {
                (Some(user), Some(pass)) => {
                    async_http_proxy::http_connect_tokio_with_basic_auth(
                        &mut stream,
                        target_host,
                        target_port,
                        user,
                        pass,
                    )
                    .await
                }
                _ => {
                    async_http_proxy::http_connect_tokio(&mut stream, target_host, target_port)
                        .await
                }
            }
            .map_err(|error| AppError::Auth(format!("HTTP proxy tunnel failed: {error}")))?;
            let local_addr = stream.local_addr().ok();
            Ok(OpenedTransport {
                stream: Box::new(stream),
                local_addr,
            })
        }
        "proxycommand" => {
            let stream = crate::core::ssh::open_proxy_command_stream(
                proxy.command.as_deref(),
                target_host,
                target_port,
                "",
            )
            .await
            .map_err(|error| AppError::Auth(format!("ProxyCommand failed: {error}")))?;
            Ok(OpenedTransport {
                stream: Box::new(stream),
                local_addr: None,
            })
        }
        other => Err(AppError::Config(format!(
            "Unsupported proxy protocol '{other}'"
        ))),
    }
}

fn resolve_proxy(app: &AppHandle, proxy_id: &str) -> AppResult<ProxySettings> {
    let proxy_cfg = config::load_proxy_by_id(app, proxy_id)?
        .ok_or_else(|| AppError::Config(format!("Proxy '{proxy_id}' not found")))?;
    let password = proxy_cfg
        .password
        .as_ref()
        .and_then(|ciphertext| crate::utils::crypto::decrypt(ciphertext).ok());

    Ok(ProxySettings {
        enabled: true,
        protocol: proxy_cfg.protocol,
        host: proxy_cfg.host,
        port: proxy_cfg.port,
        command: proxy_cfg.command,
        username: proxy_cfg.username,
        password,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_network_resolves_direct() {
        let route = resolve_transport_route(None);
        assert_eq!(route.kind, TransportRouteKind::Direct);
    }

    #[test]
    fn proxy_id_resolves_proxy_transport() {
        let network = ConnectionNetwork {
            proxy_id: Some("proxy-1".to_string()),
            proxy_jump_id: None,
        };
        let route = resolve_transport_route(Some(&network));
        assert_eq!(route.kind, TransportRouteKind::Proxy);
        assert_eq!(route.proxy_id.as_deref(), Some("proxy-1"));
    }

    #[test]
    fn proxy_jump_id_resolves_ssh_jump_transport() {
        let network = ConnectionNetwork {
            proxy_id: Some("proxy-1".to_string()),
            proxy_jump_id: Some("jump-1".to_string()),
        };
        let route = resolve_transport_route(Some(&network));
        assert_eq!(route.kind, TransportRouteKind::SshJump);
        assert_eq!(route.proxy_jump_id.as_deref(), Some("jump-1"));
    }
}
