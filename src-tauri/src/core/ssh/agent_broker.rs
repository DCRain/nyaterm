//! SSH Agent forwarding broker.
//!
//! The broker terminates the Agent protocol at the remote side, merges
//! identities from external providers and `NyaTerm` stored keys, and applies
//! policy filtering before routing signing requests to their providers.

use super::agent::{DynamicAgentStream, connect_agent_stream};
use crate::config::SshKey;
use crate::config::{
    MAX_SSH_AGENT_FORWARDING_IDENTITIES, SshAgentEndpoint, SshAgentForwardingConfig,
    SshAgentForwardingPolicy, decrypt_key_cert, decrypt_key_pem, load_keys, ssh_agent_endpoint_key,
    ssh_key_change_epoch, ssh_key_read_guard,
};
use crate::error::AppResult;
use crate::utils::crypto;
use base64::Engine;
use base64::engine::general_purpose::STANDARD_NO_PAD;
use futures_util::future::join_all;
use russh::client;
use russh::keys::signature::Signer;
use russh::keys::ssh_encoding::Encode;
use russh::keys::{Algorithm, HashAlg, PrivateKey, PrivateKeyWithHashAlg};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fmt;
use std::sync::{Arc, Mutex};
use tauri::AppHandle;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::sync::{Mutex as AsyncMutex, Semaphore};
use tokio::time::{Duration, timeout};

const MAX_AGENT_FRAME_LEN: usize = 256 * 1024;
const MAX_AGENT_IDENTITIES: usize = MAX_SSH_AGENT_FORWARDING_IDENTITIES;
const MAX_AGENT_COMMENT_LEN: usize = 4096;
const MAX_AGENT_CHANNELS: usize = 16;
const MAX_AGENT_SIGN_LOCKS: usize = 1024;
const MAX_AGENT_SIGN_CONCURRENCY: usize = 32;
const AGENT_IDENTITY_TIMEOUT: Duration = Duration::from_secs(5);
const AGENT_SIGN_TIMEOUT: Duration = Duration::from_mins(1);
const AGENT_FIRST_FRAME_TIMEOUT: Duration = Duration::from_secs(30);
const AGENT_IDLE_TIMEOUT: Duration = Duration::from_mins(5);

const FAILURE: u8 = 5;
const IDENTITIES_ANSWER: u8 = 12;
const SIGN_REQUEST: u8 = 13;
const SIGN_RESPONSE: u8 = 14;
const REQUEST_IDENTITIES: u8 = 11;
const EXTENSION: u8 = 27;
const EXTENSION_FAILURE: u8 = 28;
const SESSION_BIND_EXTENSION: &[u8] = b"session-bind@openssh.com";
const QUERY_EXTENSION: &[u8] = b"query";

const RSA_SHA2_256: u32 = 2;
const RSA_SHA2_512: u32 = 4;

fn agent_channel_permits() -> Arc<Semaphore> {
    static PERMITS: std::sync::OnceLock<Arc<Semaphore>> = std::sync::OnceLock::new();
    PERMITS
        .get_or_init(|| Arc::new(Semaphore::new(MAX_AGENT_CHANNELS)))
        .clone()
}

pub(crate) fn try_acquire_agent_channel_permit() -> Option<tokio::sync::OwnedSemaphorePermit> {
    agent_channel_permits().try_acquire_owned().ok()
}

fn agent_sign_permits() -> Arc<Semaphore> {
    static PERMITS: std::sync::OnceLock<Arc<Semaphore>> = std::sync::OnceLock::new();
    PERMITS
        .get_or_init(|| Arc::new(Semaphore::new(MAX_AGENT_SIGN_CONCURRENCY)))
        .clone()
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AgentForwardingIdentitySource {
    ExternalAgent,
    StoredKey,
}

#[derive(Debug, Clone, serde::Serialize)]
pub(crate) struct AgentForwardingIdentityInfo {
    pub fingerprint: String,
    pub comment: String,
    pub source: AgentForwardingIdentitySource,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_endpoint_index: Option<usize>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AgentForwardingEndpointErrorCode {
    ConnectFailed,
    IdentityEnumerationFailed,
}

#[derive(Debug, Clone, serde::Serialize)]
pub(crate) struct AgentForwardingEndpointError {
    pub custom_endpoint_index: usize,
    pub endpoint_type: String,
    pub code: AgentForwardingEndpointErrorCode,
}

#[derive(Debug, Clone, Default, serde::Serialize)]
pub(crate) struct AgentForwardingIdentityResponse {
    pub identities: Vec<AgentForwardingIdentityInfo>,
    pub endpoint_errors: Vec<AgentForwardingEndpointError>,
    pub truncated: bool,
}

#[derive(Clone)]
pub(crate) struct AgentBrokerFactory {
    app: Option<AppHandle>,
    config: SshAgentForwardingConfig,
    stored_keys: Arc<Vec<StoredKeyIdentity>>,
    stored_key_cache: Arc<AsyncMutex<Option<StoredKeySnapshot>>>,
    allowed_fingerprints: Arc<std::sync::OnceLock<HashSet<String>>>,
    sign_locks: Arc<Mutex<HashMap<String, Arc<AsyncMutex<()>>>>>,
    overflow_sign_lock: Arc<AsyncMutex<()>>,
    sign_permits: Arc<Semaphore>,
    sign_timeout: Duration,
}

#[derive(Clone)]
pub(crate) struct StoredKeyIdentity {
    pub(crate) blob: Vec<u8>,
    pub(crate) comment: String,
    pub(crate) key: Arc<PrivateKey>,
}

#[derive(Clone)]
struct StoredKeySnapshot {
    epoch: u64,
    identities: Arc<Vec<StoredKeyIdentity>>,
}

struct BoundedIdentityCollector<T> {
    items: Vec<T>,
    seen: HashSet<Vec<u8>>,
    encoded_len: usize,
    truncated: bool,
}

impl<T> BoundedIdentityCollector<T> {
    fn new() -> Self {
        Self {
            items: Vec::new(),
            seen: HashSet::new(),
            // SSH_AGENT_IDENTITIES_ANSWER plus the identity count.
            encoded_len: 1 + size_of::<u32>(),
            truncated: false,
        }
    }

    /// Adds identities in provider order until the shared protocol limits are reached.
    /// Once a limit is reached, later providers are intentionally ignored so preview
    /// and forwarding expose the same deterministic prefix.
    fn push(&mut self, blob: Vec<u8>, comment: String, build: impl FnOnce(Vec<u8>, String) -> T) {
        if self.truncated || self.seen.contains(&blob) {
            return;
        }

        let Some(encoded_len) = self
            .encoded_len
            .checked_add(size_of::<u32>())
            .and_then(|length| length.checked_add(blob.len()))
            .and_then(|length| length.checked_add(size_of::<u32>()))
            .and_then(|length| length.checked_add(comment.len()))
        else {
            self.truncated = true;
            return;
        };
        if self.items.len() >= MAX_AGENT_IDENTITIES || encoded_len > MAX_AGENT_FRAME_LEN {
            self.truncated = true;
            return;
        }

        self.seen.insert(blob.clone());
        self.encoded_len = encoded_len;
        self.items.push(build(blob, comment));
    }
}

#[derive(Clone)]
struct AgentIdentityRecord {
    blob: Vec<u8>,
    comment: String,
    fingerprint: String,
    provider: IdentityProvider,
}

#[derive(Clone)]
enum IdentityProvider {
    External(usize),
    Stored { key: Arc<PrivateKey>, epoch: u64 },
}

struct ExternalUpstream {
    endpoint: SshAgentEndpoint,
    stream: DynamicAgentStream,
    healthy: bool,
    custom_endpoint_index: usize,
}

#[derive(Clone)]
struct ExternalEndpointSpec {
    endpoint: SshAgentEndpoint,
    custom_endpoint_index: usize,
}

#[derive(Debug)]
enum BrokerError {
    Io(std::io::Error),
    Protocol(&'static str),
    Crypto(String),
    StoredKeysChanged,
}

impl From<std::io::Error> for BrokerError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl fmt::Display for BrokerError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "Agent I/O error: {error}"),
            Self::Protocol(message) => write!(formatter, "Agent protocol error: {message}"),
            Self::Crypto(message) => write!(formatter, "Agent signing error: {message}"),
            Self::StoredKeysChanged => write!(formatter, "stored Agent identities changed"),
        }
    }
}

impl std::error::Error for BrokerError {}

impl AgentBrokerFactory {
    /// Builds the forwarding provider for the final target without loading jump-host configuration.
    pub(crate) fn new(app: &AppHandle, config: &SshAgentForwardingConfig) -> AppResult<Self> {
        crate::config::validate_ssh_agent_forwarding_config(config)?;
        let allowed_fingerprints = Arc::new(std::sync::OnceLock::new());
        if let SshAgentForwardingPolicy::Allowlist { fingerprints } = &config.policy {
            let _ = allowed_fingerprints.set(fingerprints.iter().cloned().collect());
        }
        Ok(Self {
            app: Some(app.clone()),
            config: config.clone(),
            // Stored keys are loaded lazily when the remote side actually requests identities.
            stored_keys: Arc::new(Vec::new()),
            stored_key_cache: Arc::new(AsyncMutex::new(None)),
            allowed_fingerprints,
            sign_locks: Arc::new(Mutex::new(HashMap::new())),
            overflow_sign_lock: Arc::new(AsyncMutex::new(())),
            sign_permits: agent_sign_permits(),
            sign_timeout: AGENT_SIGN_TIMEOUT,
        })
    }

    pub(crate) fn spawn(
        self: Arc<Self>,
        channel: russh::Channel<client::Msg>,
        reply: client::ChannelOpenHandle,
    ) {
        let Some(permit) = try_acquire_agent_channel_permit() else {
            tokio::spawn(async move {
                reply
                    .reject(russh::ChannelOpenFailure::ResourceShortage)
                    .await;
                let _ = channel.close().await;
            });
            return;
        };
        tokio::spawn(async move {
            let _permit = permit;
            reply.accept().await;
            let remote = channel.into_stream();
            if self.serve(remote).await.is_err() {
                tracing::debug!(result = "closed", "SSH Agent forwarding broker closed");
            }
        });
    }

    async fn serve<S>(&self, mut remote: S) -> Result<(), BrokerError>
    where
        S: AsyncRead + AsyncWrite + Unpin,
    {
        let mut external = self.connect_external_upstreams().await;
        let mut identities = Vec::new();
        let mut identities_loaded = false;
        let initial_key_epoch = ssh_key_change_epoch();
        let mut first_frame = true;

        while let Some(request) = timeout(
            if first_frame {
                AGENT_FIRST_FRAME_TIMEOUT
            } else {
                AGENT_IDLE_TIMEOUT
            },
            read_frame(&mut remote),
        )
        .await
        .map_err(|_| BrokerError::Protocol("SSH Agent forwarding channel timed out"))??
        {
            first_frame = false;
            if self.config.sources.stored_keys && ssh_key_change_epoch() != initial_key_epoch {
                return Err(BrokerError::StoredKeysChanged);
            }
            let response = self
                .handle_request_with_cache(
                    &request,
                    &mut external,
                    &mut identities,
                    &mut identities_loaded,
                )
                .await
                .unwrap_or_else(|_| {
                    tracing::debug!(result = "rejected", "SSH Agent forwarding request rejected");
                    failure_frame()
                });
            write_frame(&mut remote, &response).await?;
        }

        Ok(())
    }

    async fn connect_external_upstreams(&self) -> Vec<ExternalUpstream> {
        let attempts = join_all(configured_external_endpoints(&self.config).into_iter().map(
            |spec| async move {
                let result = connect_agent_stream(&spec.endpoint).await;
                (spec, result)
            },
        ))
        .await;

        let mut upstreams = Vec::new();
        for (spec, result) in attempts {
            match result {
                Ok(stream) => upstreams.push(ExternalUpstream {
                    endpoint: spec.endpoint,
                    stream,
                    healthy: true,
                    custom_endpoint_index: spec.custom_endpoint_index,
                }),
                Err(_) => {
                    tracing::debug!(
                        custom_endpoint_index = spec.custom_endpoint_index,
                        endpoint_type = ssh_agent_endpoint_type(&spec.endpoint),
                        "External SSH Agent unavailable for forwarding"
                    );
                }
            }
        }
        upstreams
    }

    #[cfg(test)]
    async fn handle_request(
        &self,
        request: &[u8],
        external: &mut [ExternalUpstream],
        identities: &mut Vec<AgentIdentityRecord>,
    ) -> Result<Vec<u8>, BrokerError> {
        let mut identities_loaded = !identities.is_empty();
        self.handle_request_with_cache(request, external, identities, &mut identities_loaded)
            .await
    }

    async fn handle_request_with_cache(
        &self,
        request: &[u8],
        external: &mut [ExternalUpstream],
        identities: &mut Vec<AgentIdentityRecord>,
        identities_loaded: &mut bool,
    ) -> Result<Vec<u8>, BrokerError> {
        let Some(&message_type) = request.first() else {
            return Err(BrokerError::Protocol("empty Agent request"));
        };

        match message_type {
            REQUEST_IDENTITIES => {
                if request.len() != 1 {
                    return Err(BrokerError::Protocol(
                        "REQUEST_IDENTITIES request has trailing data",
                    ));
                }
                *identities = self.enumerate_identities(external).await?;
                *identities_loaded = true;
                identities_frame(identities)
            }
            SIGN_REQUEST => {
                let sign = parse_sign_request(request)?;
                if !*identities_loaded {
                    *identities = self.enumerate_identities(external).await?;
                    *identities_loaded = true;
                }
                let fingerprint = fingerprint(&sign.blob);
                let Some(identity) = identities
                    .iter()
                    .find(|identity| identity.blob == sign.blob)
                else {
                    return Ok(failure_frame());
                };
                if identity.fingerprint != fingerprint || !self.allows(&fingerprint) {
                    return Ok(failure_frame());
                }

                let sign_lock = self.sign_lock_for(&fingerprint);
                let _sign_guard = sign_lock.lock().await;
                let Ok(Ok(_sign_permit)) =
                    timeout(self.sign_timeout, self.sign_permits.clone().acquire_owned()).await
                else {
                    return Ok(failure_frame());
                };

                let provider = identity.provider.clone();
                match provider {
                    IdentityProvider::External(index) => {
                        let Some(upstream) = external.get_mut(index) else {
                            return Ok(failure_frame());
                        };
                        if !upstream.healthy {
                            return Ok(failure_frame());
                        }
                        let result =
                            proxy_frame(&mut upstream.stream, request, self.sign_timeout).await;
                        if result.is_err() {
                            upstream.healthy = false;
                        }
                        result
                    }
                    IdentityProvider::Stored { key, epoch } => {
                        sign_with_stored_key_at_epoch_async(key, epoch, sign).await
                    }
                }
            }
            EXTENSION => {
                let extension_name = parse_extension_request(request)?;
                if !*identities_loaded {
                    *identities = self.enumerate_identities(external).await?;
                    *identities_loaded = true;
                }
                if (extension_name == SESSION_BIND_EXTENSION || extension_name == QUERY_EXTENSION)
                    && self.can_proxy_external_extension(external, identities)
                {
                    if !external[0].healthy {
                        return Ok(extension_failure_frame());
                    }
                    let result =
                        proxy_frame(&mut external[0].stream, request, self.sign_timeout).await;
                    if result.is_err() {
                        external[0].healthy = false;
                    }
                    result
                } else {
                    Ok(extension_failure_frame())
                }
            }
            _ => Ok(failure_frame()),
        }
    }

    async fn enumerate_identities(
        &self,
        external: &mut [ExternalUpstream],
    ) -> Result<Vec<AgentIdentityRecord>, BrokerError> {
        let mut identities = BoundedIdentityCollector::new();

        let responses = join_all(external.iter_mut().enumerate().filter_map(
            |(index, upstream)| {
                if !upstream.healthy {
                    return None;
                }
                Some(async move {
                    let result = request_external_identities(&mut upstream.stream).await;
                    (
                        index,
                        upstream.endpoint.clone(),
                        upstream.custom_endpoint_index,
                        result,
                    )
                })
            },
        ))
        .await;

        for (index, endpoint, custom_endpoint_index, result) in responses {
            if let Ok(external_identities) = result {
                for identity in external_identities {
                    let fp = fingerprint(&identity.blob);
                    if !self.allows(&fp) {
                        continue;
                    }
                    let blob = identity.blob;
                    let comment = identity.comment;
                    identities.push(blob, comment, |blob, comment| AgentIdentityRecord {
                        blob,
                        comment,
                        fingerprint: fp,
                        provider: IdentityProvider::External(index),
                    });
                }
            } else {
                if let Some(upstream) = external.get_mut(index) {
                    upstream.healthy = false;
                }
                tracing::debug!(
                    custom_endpoint_index,
                    endpoint_type = ssh_agent_endpoint_type(&endpoint),
                    result = "identity_enumeration_failed",
                    "External SSH Agent identity enumeration failed"
                );
            }
        }

        if !identities.truncated {
            let stored = self.current_stored_keys().await?;
            for identity in stored.identities.iter() {
                let fp = fingerprint(&identity.blob);
                if !self.allows(&fp) {
                    continue;
                }
                identities.push(
                    identity.blob.clone(),
                    identity.comment.clone(),
                    |blob, comment| AgentIdentityRecord {
                        blob,
                        comment,
                        fingerprint: fp,
                        provider: IdentityProvider::Stored {
                            key: identity.key.clone(),
                            epoch: stored.epoch,
                        },
                    },
                );
            }
        }

        if identities.truncated {
            tracing::debug!(
                identity_count = identities.items.len(),
                result = "truncated",
                "SSH Agent forwarding identities reached the protocol limit"
            );
        }
        Ok(identities.items)
    }

    /// Returns one parsed stored-key snapshot per key epoch.
    ///
    /// The async mutex single-flights cache misses for all forwarded channels owned by this
    /// factory. Storage replacement increments the epoch under the write side of the key-store
    /// barrier; cached signing then acquires the read side and rejects an obsolete epoch.
    async fn current_stored_keys(&self) -> Result<StoredKeySnapshot, BrokerError> {
        if !self.config.sources.stored_keys {
            return Ok(StoredKeySnapshot {
                epoch: ssh_key_change_epoch(),
                identities: Arc::new(Vec::new()),
            });
        }
        let Some(app) = self.app.clone() else {
            return Ok(StoredKeySnapshot {
                epoch: ssh_key_change_epoch(),
                identities: self.stored_keys.clone(),
            });
        };

        let expected_epoch = ssh_key_change_epoch();
        let mut cache = self.stored_key_cache.lock().await;
        if let Some(snapshot) = cache
            .as_ref()
            .filter(|item| item.epoch == expected_epoch && expected_epoch == ssh_key_change_epoch())
        {
            return Ok(snapshot.clone());
        }

        let snapshot = load_stored_key_snapshot(app).await?;
        if snapshot.epoch != ssh_key_change_epoch() {
            return Err(BrokerError::StoredKeysChanged);
        }
        *cache = Some(snapshot.clone());
        Ok(snapshot)
    }

    fn sign_lock_for(&self, fingerprint: &str) -> Arc<AsyncMutex<()>> {
        let Ok(mut locks) = self.sign_locks.lock() else {
            return self.overflow_sign_lock.clone();
        };
        if let Some(lock) = locks.get(fingerprint) {
            return lock.clone();
        }
        if locks.len() >= MAX_AGENT_SIGN_LOCKS {
            return self.overflow_sign_lock.clone();
        }
        let lock = Arc::new(AsyncMutex::new(()));
        locks.insert(fingerprint.to_string(), lock.clone());
        lock
    }

    fn allows(&self, fingerprint: &str) -> bool {
        match &self.config.policy {
            SshAgentForwardingPolicy::All => true,
            SshAgentForwardingPolicy::Allowlist { fingerprints } => self
                .allowed_fingerprints
                .get_or_init(|| fingerprints.iter().cloned().collect())
                .contains(fingerprint),
        }
    }

    fn has_internal_provider(identities: &[AgentIdentityRecord]) -> bool {
        identities
            .iter()
            .any(|identity| matches!(&identity.provider, IdentityProvider::Stored { .. }))
    }

    fn can_proxy_external_extension(
        &self,
        external: &[ExternalUpstream],
        identities: &[AgentIdentityRecord],
    ) -> bool {
        // Configuration topology decides whether an extension may be proxied;
        // the live upstream count only confirms that the single configured
        // provider is currently available.
        external.len() == 1
            && self.can_proxy_external_extension_topology(Self::has_internal_provider(identities))
    }

    fn can_proxy_external_extension_topology(&self, has_internal_provider: bool) -> bool {
        if self.config.sources.stored_keys || has_internal_provider {
            return false;
        }

        // Use the same normalized endpoint topology as upstream construction.
        // This prevents a multi-endpoint configuration from gaining extension
        // proxying merely because only one endpoint happened to connect.
        configured_external_endpoints(&self.config).len() == 1
    }

    #[cfg(test)]
    fn merge_identities(
        &self,
        external: Vec<ExternalIdentity>,
        stored_keys: &[StoredKeyIdentity],
    ) -> Vec<AgentIdentityRecord> {
        let mut identities = BoundedIdentityCollector::new();
        for identity in external {
            let fp = fingerprint(&identity.blob);
            if self.allows(&fp) {
                identities.push(identity.blob, identity.comment, |blob, comment| {
                    AgentIdentityRecord {
                        blob,
                        comment,
                        fingerprint: fp,
                        provider: IdentityProvider::External(0),
                    }
                });
            }
        }
        for identity in stored_keys {
            let fp = fingerprint(&identity.blob);
            if self.allows(&fp) {
                identities.push(
                    identity.blob.clone(),
                    identity.comment.clone(),
                    |blob, comment| AgentIdentityRecord {
                        blob,
                        comment,
                        fingerprint: fp,
                        provider: IdentityProvider::Stored {
                            key: identity.key.clone(),
                            epoch: ssh_key_change_epoch(),
                        },
                    },
                );
            }
        }
        identities.items
    }
}

fn configured_external_endpoints(config: &SshAgentForwardingConfig) -> Vec<ExternalEndpointSpec> {
    if !config.sources.external_agent {
        return Vec::new();
    }

    let mut seen = HashSet::new();
    config
        .sources
        .external_agent_endpoints
        .iter()
        .cloned()
        .enumerate()
        .map(|(custom_endpoint_index, endpoint)| ExternalEndpointSpec {
            endpoint,
            custom_endpoint_index,
        })
        .filter(|spec| seen.insert(ssh_agent_endpoint_key(&spec.endpoint)))
        .collect()
}

/// Enumerates identities without applying the connection policy so the UI can
/// build a fingerprint allowlist. Only public blobs, fingerprints, and comments
/// leave the backend; private key material stays inside the broker.
pub(crate) async fn list_forwarding_identities(
    app: &AppHandle,
    config: &SshAgentForwardingConfig,
) -> AgentForwardingIdentityResponse {
    if !config.enabled {
        return AgentForwardingIdentityResponse::default();
    }

    let attempts = join_all(configured_external_endpoints(config).into_iter().map(
        |spec| async move {
            let endpoint_type = ssh_agent_endpoint_type(&spec.endpoint).to_string();
            let Ok(mut stream) = connect_agent_stream(&spec.endpoint).await else {
                tracing::debug!(
                    custom_endpoint_index = spec.custom_endpoint_index,
                    endpoint_type = %endpoint_type,
                    "External SSH Agent unavailable for identity enumeration"
                );
                return (
                    spec,
                    endpoint_type,
                    Err(AgentForwardingEndpointErrorCode::ConnectFailed),
                );
            };
            let result = if let Ok(identities) = request_external_identities(&mut stream).await {
                Ok(identities)
            } else {
                tracing::debug!(
                    custom_endpoint_index = spec.custom_endpoint_index,
                    endpoint_type = %endpoint_type,
                    "External SSH Agent identity enumeration failed"
                );
                Err(AgentForwardingEndpointErrorCode::IdentityEnumerationFailed)
            };
            (spec, endpoint_type, result)
        },
    ))
    .await;

    let mut collected = BoundedIdentityCollector::new();
    let mut response = AgentForwardingIdentityResponse::default();
    for (spec, endpoint_type, result) in attempts {
        let identities = match result {
            Ok(identities) => identities,
            Err(code) => {
                response.endpoint_errors.push(AgentForwardingEndpointError {
                    custom_endpoint_index: spec.custom_endpoint_index,
                    endpoint_type,
                    code,
                });
                continue;
            }
        };
        for identity in identities {
            let fingerprint = fingerprint(&identity.blob);
            collected.push(identity.blob, identity.comment, |_, comment| {
                AgentForwardingIdentityInfo {
                    fingerprint,
                    comment,
                    source: AgentForwardingIdentitySource::ExternalAgent,
                    custom_endpoint_index: Some(spec.custom_endpoint_index),
                }
            });
        }
    }

    if config.sources.stored_keys && !collected.truncated {
        match load_stored_key_snapshot(app.clone()).await {
            Ok(stored) => {
                for identity in stored.identities.iter() {
                    let fingerprint = fingerprint(&identity.blob);
                    collected.push(
                        identity.blob.clone(),
                        identity.comment.clone(),
                        |_, comment| AgentForwardingIdentityInfo {
                            fingerprint,
                            comment,
                            source: AgentForwardingIdentitySource::StoredKey,
                            custom_endpoint_index: None,
                        },
                    );
                }
            }
            Err(_) => {
                tracing::warn!("Could not enumerate NyaTerm stored keys for Agent forwarding");
            }
        }
    }

    response.truncated = collected.truncated;
    response.identities = collected.items;
    response
}

fn ssh_agent_endpoint_type(endpoint: &SshAgentEndpoint) -> &'static str {
    match endpoint {
        SshAgentEndpoint::Auto => "auto",
        SshAgentEndpoint::Environment { .. } => "environment",
        SshAgentEndpoint::UnixSocket { .. } => "unix_socket",
        SshAgentEndpoint::Pageant => "pageant",
        SshAgentEndpoint::WindowsOpenSsh => "windows_open_ssh",
    }
}

async fn load_stored_key_snapshot(app: AppHandle) -> Result<StoredKeySnapshot, BrokerError> {
    let snapshot = tokio::task::spawn_blocking(move || load_stored_key_snapshot_blocking(&app))
        .await
        .map_err(|_| BrokerError::Protocol("stored Agent identity task failed"))??;
    if snapshot.epoch != ssh_key_change_epoch() {
        return Err(BrokerError::StoredKeysChanged);
    }
    Ok(snapshot)
}

fn load_stored_key_snapshot_blocking(app: &AppHandle) -> Result<StoredKeySnapshot, BrokerError> {
    // The read lock protects only the persistent snapshot and its epoch. Expensive
    // decryption and key parsing happen after releasing it so key saves are not
    // blocked by remote identity enumeration.
    let (epoch, keys) = {
        let _key_guard = ssh_key_read_guard();
        let epoch = ssh_key_change_epoch();
        let keys = load_keys(app)
            .map_err(|_| BrokerError::Protocol("stored Agent identities are unavailable"))?;
        (epoch, keys)
    };
    let identities = keys
        .keys
        .into_iter()
        .filter_map(load_stored_key_identity)
        .collect();
    Ok(StoredKeySnapshot {
        epoch,
        identities: Arc::new(identities),
    })
}

fn load_stored_key_identity(mut key: SshKey) -> Option<StoredKeyIdentity> {
    if let Some(ciphertext) = key.passphrase.as_deref() {
        key.passphrase = crypto::decrypt(ciphertext).ok();
    }
    let pem = match decrypt_key_pem(&key) {
        Ok(Some(pem)) => pem,
        Ok(None) => return None,
        Err(_) => {
            tracing::debug!("Stored key could not be decrypted for Agent forwarding");
            return None;
        }
    };
    let Ok(private_key) = russh::keys::decode_secret_key(&pem, key.passphrase.as_deref()) else {
        tracing::debug!("Stored key passphrase is unavailable for Agent forwarding");
        return None;
    };
    let (blob, comment) = match decrypt_key_cert(&key) {
        Ok(Some(cert_data)) => match russh::keys::Certificate::from_openssh(&cert_data) {
            Ok(certificate) if certificate.public_key() == private_key.public_key().key_data() => {
                let Ok(blob) = certificate.to_bytes() else {
                    tracing::debug!("Stored certificate identity could not be encoded");
                    return None;
                };
                let comment = if certificate.comment().is_empty() {
                    key.name.clone()
                } else {
                    certificate.comment().to_string()
                };
                (blob, comment)
            }
            Ok(_) => {
                tracing::debug!("Stored certificate does not match its private key");
                encode_stored_public_identity(&private_key, key.name.clone())?
            }
            Err(_) => {
                tracing::debug!(
                    "Stored certificate could not be parsed; using the private key identity"
                );
                encode_stored_public_identity(&private_key, key.name.clone())?
            }
        },
        Ok(None) | Err(_) => encode_stored_public_identity(&private_key, key.name.clone())?,
    };
    Some(StoredKeyIdentity {
        blob,
        comment: bounded_agent_comment(comment),
        key: Arc::new(private_key),
    })
}

fn encode_stored_public_identity(
    private_key: &PrivateKey,
    comment: String,
) -> Option<(Vec<u8>, String)> {
    let Ok(blob) = private_key.public_key().key_data().encode_vec() else {
        tracing::debug!("Stored key public identity could not be encoded");
        return None;
    };
    Some((blob, comment))
}

#[cfg(test)]
pub(crate) fn stored_key_identity_from_private_key(
    private_key: Arc<PrivateKey>,
    cert_data: Option<&str>,
    comment: String,
) -> Option<StoredKeyIdentity> {
    let (blob, comment) = match cert_data {
        Some(cert_data) => match russh::keys::Certificate::from_openssh(cert_data) {
            Ok(certificate) if certificate.public_key() == private_key.public_key().key_data() => (
                certificate.to_bytes().ok()?,
                if certificate.comment().is_empty() {
                    comment
                } else {
                    certificate.comment().to_string()
                },
            ),
            _ => (
                private_key.public_key().key_data().encode_vec().ok()?,
                comment,
            ),
        },
        None => (
            private_key.public_key().key_data().encode_vec().ok()?,
            comment,
        ),
    };

    Some(StoredKeyIdentity {
        blob,
        comment: bounded_agent_comment(comment),
        key: private_key,
    })
}

fn bounded_agent_comment(mut comment: String) -> String {
    if comment.len() <= MAX_AGENT_COMMENT_LEN {
        return comment;
    }

    let mut boundary = MAX_AGENT_COMMENT_LEN;
    while !comment.is_char_boundary(boundary) {
        boundary -= 1;
    }
    comment.truncate(boundary);
    comment
}

struct ExternalIdentity {
    blob: Vec<u8>,
    comment: String,
}

struct SignRequest {
    blob: Vec<u8>,
    data: Vec<u8>,
    flags: u32,
}

fn parse_sign_request(request: &[u8]) -> Result<SignRequest, BrokerError> {
    let mut cursor = Cursor::new(&request[1..]);
    let blob = cursor.read_string()?;
    let data = cursor.read_string()?;
    let flags = cursor.read_u32()?;
    cursor.ensure_finished()?;
    Ok(SignRequest { blob, data, flags })
}

fn parse_extension_request(request: &[u8]) -> Result<Vec<u8>, BrokerError> {
    let mut cursor = Cursor::new(&request[1..]);
    let name = cursor.read_string_limited(256)?;
    match name.as_slice() {
        QUERY_EXTENSION => cursor.ensure_finished()?,
        SESSION_BIND_EXTENSION => {
            cursor.read_string()?;
            cursor.read_string()?;
            cursor.read_string()?;
            cursor.read_bool()?;
            cursor.ensure_finished()?;
        }
        _ => {}
    }
    Ok(name)
}

async fn request_external_identities(
    stream: &mut DynamicAgentStream,
) -> Result<Vec<ExternalIdentity>, BrokerError> {
    timeout(AGENT_IDENTITY_TIMEOUT, async {
        write_frame(stream, &frame(&[REQUEST_IDENTITIES])).await?;
        let Some(response) = read_frame(stream).await? else {
            return Err(BrokerError::Protocol("external Agent closed"));
        };
        parse_identities_response(&response)
    })
    .await
    .map_err(|_| BrokerError::Protocol("external Agent identity request timed out"))?
}

fn parse_identities_response(response: &[u8]) -> Result<Vec<ExternalIdentity>, BrokerError> {
    let mut cursor = Cursor::new(response);
    if cursor.read_u8()? != IDENTITIES_ANSWER {
        return Err(BrokerError::Protocol(
            "external Agent identity response failed",
        ));
    }
    let count = cursor.read_u32()? as usize;
    if count > MAX_AGENT_IDENTITIES {
        return Err(BrokerError::Protocol("too many Agent identities"));
    }
    let mut identities = Vec::with_capacity(count);
    for _ in 0..count {
        let blob = cursor.read_string()?;
        let comment = String::from_utf8(cursor.read_string_limited(MAX_AGENT_COMMENT_LEN)?)
            .map_err(|_| BrokerError::Protocol("invalid Agent comment"))?;
        identities.push(ExternalIdentity { blob, comment });
    }
    cursor.ensure_finished()?;
    Ok(identities)
}

async fn proxy_frame(
    stream: &mut DynamicAgentStream,
    request: &[u8],
    request_timeout: Duration,
) -> Result<Vec<u8>, BrokerError> {
    timeout(request_timeout, async {
        write_frame(stream, &frame(request)).await?;
        let Some(response) = read_frame(stream).await? else {
            return Err(BrokerError::Protocol(
                "external Agent closed during request",
            ));
        };
        Ok(frame(&response))
    })
    .await
    .map_err(|_| BrokerError::Protocol("external Agent request timed out"))?
}

#[cfg(test)]
fn sign_with_stored_key(
    key: &Arc<PrivateKey>,
    request: &SignRequest,
) -> Result<Vec<u8>, BrokerError> {
    sign_with_stored_key_at_epoch(key, ssh_key_change_epoch(), request)
}

async fn sign_with_stored_key_at_epoch_async(
    key: Arc<PrivateKey>,
    epoch: u64,
    request: SignRequest,
) -> Result<Vec<u8>, BrokerError> {
    tokio::task::spawn_blocking(move || sign_with_stored_key_at_epoch(&key, epoch, &request))
        .await
        .map_err(|_| BrokerError::Protocol("stored Agent signing task failed"))?
}

fn sign_with_stored_key_at_epoch(
    key: &Arc<PrivateKey>,
    epoch: u64,
    request: &SignRequest,
) -> Result<Vec<u8>, BrokerError> {
    // Signing holds the read side of the key-store barrier on a blocking worker.
    // A successful save therefore cannot invalidate a key during a signature,
    // while Tokio workers remain available for unrelated sessions.
    let _key_guard = ssh_key_read_guard();
    if ssh_key_change_epoch() != epoch {
        return Ok(failure_frame());
    }
    let algorithm = key.algorithm();
    let hash_alg = match algorithm {
        Algorithm::Rsa { .. } => match request.flags {
            0 => None,
            RSA_SHA2_256 => Some(HashAlg::Sha256),
            RSA_SHA2_512 => Some(HashAlg::Sha512),
            _ => return Ok(failure_frame()),
        },
        _ if request.flags == 0 => None,
        _ => return Ok(failure_frame()),
    };

    let key = PrivateKeyWithHashAlg::new(key.clone(), hash_alg);
    let signature = match key.key_data() {
        russh::keys::ssh_key::private::KeypairData::Rsa(rsa_keypair) => {
            let Algorithm::Rsa { hash } = key.algorithm() else {
                return Err(BrokerError::Protocol("invalid RSA algorithm"));
            };
            Signer::try_sign(&(rsa_keypair, hash), &request.data)
                .map_err(|error| BrokerError::Crypto(error.to_string()))?
        }
        keypair => Signer::try_sign(keypair, &request.data)
            .map_err(|error| BrokerError::Crypto(error.to_string()))?,
    };

    let mut signature_blob = Vec::new();
    signature
        .encode(&mut signature_blob)
        .map_err(|error| BrokerError::Crypto(error.to_string()))?;
    let mut payload = vec![SIGN_RESPONSE];
    encode_string(&signature_blob, &mut payload);
    Ok(frame(&payload))
}

fn fingerprint(blob: &[u8]) -> String {
    let digest = Sha256::digest(blob);
    format!("SHA256:{}", STANDARD_NO_PAD.encode(digest))
}

fn identities_frame(identities: &[AgentIdentityRecord]) -> Result<Vec<u8>, BrokerError> {
    if identities.len() > MAX_AGENT_IDENTITIES {
        return Err(BrokerError::Protocol("too many Agent identities"));
    }
    let mut payload = vec![IDENTITIES_ANSWER];
    encode_u32(identities.len() as u32, &mut payload);
    for identity in identities {
        encode_string(&identity.blob, &mut payload);
        encode_string(identity.comment.as_bytes(), &mut payload);
        if payload.len() > MAX_AGENT_FRAME_LEN {
            return Err(BrokerError::Protocol(
                "Agent identities response is too large",
            ));
        }
    }
    Ok(frame(&payload))
}

fn failure_frame() -> Vec<u8> {
    frame(&[FAILURE])
}

fn extension_failure_frame() -> Vec<u8> {
    frame(&[EXTENSION_FAILURE])
}

fn frame(payload: &[u8]) -> Vec<u8> {
    let mut result = Vec::with_capacity(payload.len() + 4);
    encode_u32(payload.len() as u32, &mut result);
    result.extend_from_slice(payload);
    result
}

async fn read_frame<S>(stream: &mut S) -> Result<Option<Vec<u8>>, BrokerError>
where
    S: AsyncRead + Unpin,
{
    let mut length = [0u8; 4];
    match stream.read_exact(&mut length).await {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(error) => return Err(BrokerError::Io(error)),
    }
    let length = u32::from_be_bytes(length) as usize;
    if length == 0 || length > MAX_AGENT_FRAME_LEN {
        return Err(BrokerError::Protocol("invalid Agent frame length"));
    }
    let mut payload = vec![0u8; length];
    stream.read_exact(&mut payload).await?;
    Ok(Some(payload))
}

async fn write_frame<S>(stream: &mut S, frame: &[u8]) -> Result<(), BrokerError>
where
    S: AsyncWrite + Unpin,
{
    stream.write_all(frame).await?;
    stream.flush().await?;
    Ok(())
}

fn encode_u32(value: u32, output: &mut Vec<u8>) {
    output.extend_from_slice(&value.to_be_bytes());
}

fn encode_string(value: &[u8], output: &mut Vec<u8>) {
    encode_u32(value.len() as u32, output);
    output.extend_from_slice(value);
}

struct Cursor<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> Cursor<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }

    fn read_u8(&mut self) -> Result<u8, BrokerError> {
        let value = *self
            .bytes
            .get(self.offset)
            .ok_or(BrokerError::Protocol("truncated Agent request"))?;
        self.offset += 1;
        Ok(value)
    }

    fn read_u32(&mut self) -> Result<u32, BrokerError> {
        let end = self
            .offset
            .checked_add(4)
            .ok_or(BrokerError::Protocol("Agent request offset overflow"))?;
        let bytes = self
            .bytes
            .get(self.offset..end)
            .ok_or(BrokerError::Protocol("truncated Agent request"))?;
        self.offset = end;
        Ok(u32::from_be_bytes(
            bytes.try_into().expect("four-byte slice"),
        ))
    }

    fn read_string(&mut self) -> Result<Vec<u8>, BrokerError> {
        self.read_string_limited(MAX_AGENT_FRAME_LEN)
    }

    fn read_string_limited(&mut self, max: usize) -> Result<Vec<u8>, BrokerError> {
        let length = self.read_u32()? as usize;
        if length > max {
            return Err(BrokerError::Protocol("Agent string is too long"));
        }
        let end = self
            .offset
            .checked_add(length)
            .ok_or(BrokerError::Protocol("Agent string offset overflow"))?;
        let value = self
            .bytes
            .get(self.offset..end)
            .ok_or(BrokerError::Protocol("truncated Agent string"))?;
        self.offset = end;
        Ok(value.to_vec())
    }

    fn ensure_finished(&self) -> Result<(), BrokerError> {
        if self.offset == self.bytes.len() {
            Ok(())
        } else {
            Err(BrokerError::Protocol("trailing Agent request data"))
        }
    }

    fn read_bool(&mut self) -> Result<bool, BrokerError> {
        match self.read_u8()? {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err(BrokerError::Protocol("invalid Agent boolean")),
        }
    }
}

#[cfg(test)]
mod tests {
    #[cfg(unix)]
    use super::AGENT_IDENTITY_TIMEOUT;
    use super::{
        AGENT_FIRST_FRAME_TIMEOUT, AGENT_SIGN_TIMEOUT, AgentBrokerFactory,
        AgentForwardingEndpointError, ExternalIdentity, IdentityProvider, MAX_AGENT_COMMENT_LEN,
        MAX_AGENT_FRAME_LEN, SshAgentForwardingConfig, SshAgentForwardingPolicy, StoredKeyIdentity,
        agent_sign_permits, bounded_agent_comment, fingerprint, frame, parse_extension_request,
        parse_sign_request, sign_with_stored_key, stored_key_identity_from_private_key,
    };
    use russh::keys::ssh_encoding::Encode;
    use russh::keys::{Algorithm, PrivateKey};
    use std::collections::HashMap;
    #[cfg(unix)]
    use std::path::PathBuf;
    #[cfg(unix)]
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};
    #[cfg(unix)]
    use tokio::io::AsyncReadExt;
    use tokio::io::AsyncWriteExt;
    use tokio::io::duplex;
    #[cfg(unix)]
    use tokio::net::{UnixListener, UnixStream};
    #[cfg(unix)]
    use tokio::sync::oneshot;
    use tokio::sync::{Mutex as AsyncMutex, Semaphore};
    #[cfg(unix)]
    use tokio::time::timeout;
    use tokio::time::{Duration, advance, pause};

    #[test]
    fn fingerprints_use_standard_openssh_prefix_and_base64() {
        assert_eq!(
            fingerprint(b"agent-key"),
            "SHA256:ESqNMeKw+z8gcDH+8y96ckX3h7TU6FtF9lqluDQ1Now"
        );
    }

    #[test]
    fn stored_identity_comments_are_bounded_on_utf8_boundaries() {
        let comment = "猫".repeat(MAX_AGENT_COMMENT_LEN);
        let bounded = bounded_agent_comment(comment);

        assert!(bounded.len() <= MAX_AGENT_COMMENT_LEN);
        assert!(bounded.is_char_boundary(bounded.len()));
    }

    #[test]
    fn identity_collection_uses_a_deterministic_bounded_prefix() {
        let mut collected = super::BoundedIdentityCollector::new();
        for index in 0..=super::MAX_AGENT_IDENTITIES {
            let blob = index.to_be_bytes().to_vec();
            collected.push(blob, String::new(), |blob, _| blob);
        }

        assert_eq!(collected.items.len(), super::MAX_AGENT_IDENTITIES);
        assert_eq!(collected.items[0], 0usize.to_be_bytes());
        assert_eq!(
            collected.items.last().unwrap(),
            &(super::MAX_AGENT_IDENTITIES - 1).to_be_bytes()
        );
        assert!(collected.truncated);
    }

    #[test]
    fn identity_collection_applies_the_protocol_frame_limit() {
        let mut collected = super::BoundedIdentityCollector::new();
        collected.push(
            vec![0; super::MAX_AGENT_FRAME_LEN],
            String::new(),
            |blob, _| blob,
        );

        assert!(collected.items.is_empty());
        assert!(collected.truncated);
    }

    #[test]
    fn sign_request_rejects_trailing_data() {
        let mut payload = vec![13];
        payload.extend_from_slice(&1u32.to_be_bytes());
        payload.push(1);
        payload.extend_from_slice(&1u32.to_be_bytes());
        payload.push(2);
        payload.extend_from_slice(&0u32.to_be_bytes());
        payload.push(9);
        let request = frame(&payload);
        assert!(parse_sign_request(&request[4..]).is_err());
    }

    #[test]
    fn query_extension_has_no_contents_field() {
        let mut request = vec![super::EXTENSION];
        super::encode_string(super::QUERY_EXTENSION, &mut request);
        assert_eq!(
            parse_extension_request(&request).expect("query extension"),
            super::QUERY_EXTENSION.to_vec()
        );
    }

    #[test]
    fn session_bind_extension_validates_all_fields() {
        let mut request = vec![super::EXTENSION];
        super::encode_string(super::SESSION_BIND_EXTENSION, &mut request);
        super::encode_string(b"host-key", &mut request);
        super::encode_string(b"session-id", &mut request);
        super::encode_string(b"signature", &mut request);
        request.push(1);
        assert_eq!(
            parse_extension_request(&request).expect("session-bind extension"),
            super::SESSION_BIND_EXTENSION.to_vec()
        );

        request.push(0);
        assert!(parse_extension_request(&request).is_err());
    }

    #[tokio::test]
    async fn identities_request_rejects_trailing_data() {
        let factory = AgentBrokerFactory {
            app: None,
            config: SshAgentForwardingConfig::default(),
            stored_keys: Arc::new(Vec::new()),
            stored_key_cache: Arc::new(AsyncMutex::new(None)),
            allowed_fingerprints: Arc::new(std::sync::OnceLock::new()),
            sign_locks: Arc::new(Mutex::new(HashMap::new())),
            overflow_sign_lock: Arc::new(AsyncMutex::new(())),
            sign_permits: agent_sign_permits(),
            sign_timeout: AGENT_SIGN_TIMEOUT,
        };
        let request = vec![super::REQUEST_IDENTITIES, 0];
        let mut external = Vec::new();
        let mut identities = Vec::new();
        let result = factory
            .handle_request(&request, &mut external, &mut identities)
            .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn broker_closes_a_channel_that_never_sends_its_first_frame() {
        let factory = AgentBrokerFactory {
            app: None,
            config: SshAgentForwardingConfig {
                enabled: true,
                sources: crate::config::SshAgentForwardingSources {
                    external_agent: false,
                    external_agent_endpoints: Vec::new(),
                    stored_keys: false,
                },
                policy: SshAgentForwardingPolicy::All,
            },
            stored_keys: Arc::new(Vec::new()),
            stored_key_cache: Arc::new(AsyncMutex::new(None)),
            allowed_fingerprints: Arc::new(std::sync::OnceLock::new()),
            sign_locks: Arc::new(Mutex::new(HashMap::new())),
            overflow_sign_lock: Arc::new(AsyncMutex::new(())),
            sign_permits: agent_sign_permits(),
            sign_timeout: AGENT_SIGN_TIMEOUT,
        };
        let (remote, _client) = duplex(64);
        pause();
        let task = tokio::spawn(async move { factory.serve(remote).await });
        tokio::task::yield_now().await;
        advance(AGENT_FIRST_FRAME_TIMEOUT + Duration::from_secs(1)).await;
        tokio::task::yield_now().await;
        let result = task.await.expect("broker task should finish");
        assert!(result.is_err());
        tokio::time::resume();
    }

    #[test]
    fn empty_allowlist_does_not_expose_any_identity() {
        let factory = AgentBrokerFactory {
            app: None,
            config: SshAgentForwardingConfig {
                enabled: true,
                sources: crate::config::SshAgentForwardingSources {
                    external_agent: true,
                    external_agent_endpoints: Vec::new(),
                    stored_keys: false,
                },
                policy: SshAgentForwardingPolicy::Allowlist {
                    fingerprints: Vec::new(),
                },
            },
            stored_keys: Arc::new(Vec::new()),
            stored_key_cache: Arc::new(AsyncMutex::new(None)),
            allowed_fingerprints: Arc::new(std::sync::OnceLock::new()),
            sign_locks: Arc::new(Mutex::new(HashMap::new())),
            overflow_sign_lock: Arc::new(AsyncMutex::new(())),
            sign_permits: agent_sign_permits(),
            sign_timeout: AGENT_SIGN_TIMEOUT,
        };
        let mut rng = russh::keys::key::safe_rng();
        let key = PrivateKey::random(&mut rng, Algorithm::Ed25519).unwrap();
        let blob = key.public_key().key_data().encode_vec().unwrap();
        assert!(
            factory
                .merge_identities(
                    vec![ExternalIdentity {
                        blob,
                        comment: "denied".to_string(),
                    }],
                    &[],
                )
                .is_empty()
        );
    }

    #[test]
    fn endpoint_error_serialization_does_not_include_socket_paths() {
        let error = AgentForwardingEndpointError {
            custom_endpoint_index: 3,
            endpoint_type: "unix_socket".to_string(),
            code: super::AgentForwardingEndpointErrorCode::ConnectFailed,
        };
        let value = serde_json::to_value(error).expect("endpoint error serialization");
        assert_eq!(value["custom_endpoint_index"], 3);
        assert!(!value.to_string().contains("/tmp"));
    }

    #[test]
    fn signing_semaphore_has_a_bounded_global_capacity() {
        let semaphore = agent_sign_permits();
        let mut permits = Vec::new();
        for _ in 0..super::MAX_AGENT_SIGN_CONCURRENCY {
            permits.push(
                semaphore
                    .clone()
                    .try_acquire_owned()
                    .expect("global signing permit"),
            );
        }
        assert!(semaphore.clone().try_acquire_owned().is_err());
        drop(permits);
        assert!(semaphore.try_acquire().is_ok());
    }

    #[tokio::test]
    async fn broker_rejects_mutation_unknown_extension_and_oversized_frames() {
        let factory = AgentBrokerFactory {
            app: None,
            config: SshAgentForwardingConfig::default(),
            stored_keys: Arc::new(Vec::new()),
            stored_key_cache: Arc::new(AsyncMutex::new(None)),
            allowed_fingerprints: Arc::new(std::sync::OnceLock::new()),
            sign_locks: Arc::new(Mutex::new(HashMap::new())),
            overflow_sign_lock: Arc::new(AsyncMutex::new(())),
            sign_permits: agent_sign_permits(),
            sign_timeout: AGENT_SIGN_TIMEOUT,
        };
        for message_type in [17u8, 18, 19, 20, 21, 22, 23, 99] {
            let mut external = Vec::new();
            let mut identities = Vec::new();
            let response = factory
                .handle_request(&[message_type], &mut external, &mut identities)
                .await
                .expect("unsupported Agent message should return failure");
            assert_eq!(response[4], super::FAILURE);
        }

        let mut extension = vec![super::EXTENSION];
        super::encode_string(b"unknown-agent-extension", &mut extension);
        let mut external = Vec::new();
        let mut identities = Vec::new();
        let response = factory
            .handle_request(&extension, &mut external, &mut identities)
            .await
            .expect("unknown extension should return failure");
        assert_eq!(response[4], super::EXTENSION_FAILURE);

        let (mut writer, mut reader) = duplex(16);
        writer
            .write_all(&((MAX_AGENT_FRAME_LEN as u32) + 1).to_be_bytes())
            .await
            .expect("write oversized frame header");
        let error = super::read_frame(&mut reader)
            .await
            .expect_err("oversized Agent frame should be rejected");
        assert!(error.to_string().contains("invalid Agent frame length"));
    }

    #[tokio::test]
    async fn exhausted_sign_permits_fail_without_leaking_the_permit() {
        let mut rng = russh::keys::key::safe_rng();
        let key = Arc::new(PrivateKey::random(&mut rng, Algorithm::Ed25519).unwrap());
        let blob = key.public_key().key_data().encode_vec().unwrap();
        let sign_permits = Arc::new(Semaphore::new(1));
        let held_permit = sign_permits
            .clone()
            .acquire_owned()
            .await
            .expect("test sign permit");
        let factory = AgentBrokerFactory {
            app: None,
            config: SshAgentForwardingConfig {
                enabled: true,
                sources: crate::config::SshAgentForwardingSources {
                    external_agent: false,
                    external_agent_endpoints: Vec::new(),
                    stored_keys: true,
                },
                policy: SshAgentForwardingPolicy::All,
            },
            stored_keys: Arc::new(vec![StoredKeyIdentity {
                blob: blob.clone(),
                comment: "permit-test".to_string(),
                key,
            }]),
            stored_key_cache: Arc::new(AsyncMutex::new(None)),
            allowed_fingerprints: Arc::new(std::sync::OnceLock::new()),
            sign_locks: Arc::new(Mutex::new(HashMap::new())),
            overflow_sign_lock: Arc::new(AsyncMutex::new(())),
            sign_permits: sign_permits.clone(),
            sign_timeout: Duration::from_secs(1),
        };
        let mut sign_request = vec![super::SIGN_REQUEST];
        super::encode_string(&blob, &mut sign_request);
        super::encode_string(b"permit-exhaustion-test", &mut sign_request);
        super::encode_u32(0, &mut sign_request);

        pause();
        let task = tokio::spawn(async move {
            let mut external = Vec::new();
            let mut identities = Vec::new();
            factory
                .handle_request(&sign_request, &mut external, &mut identities)
                .await
        });
        for _ in 0..4 {
            tokio::task::yield_now().await;
        }
        advance(Duration::from_secs(2)).await;
        let response = task
            .await
            .expect("permit exhaustion task")
            .expect("permit exhaustion should return a failure frame");
        assert_eq!(response[4], super::FAILURE);

        drop(held_permit);
        assert!(sign_permits.try_acquire().is_ok());
        tokio::time::resume();
    }

    #[test]
    fn extension_forwarding_is_blocked_only_when_a_local_provider_is_exposed() {
        let identities = Vec::new();
        assert!(!AgentBrokerFactory::has_internal_provider(&identities));

        let mut rng = russh::keys::key::safe_rng();
        let key = Arc::new(PrivateKey::random(&mut rng, Algorithm::Ed25519).unwrap());
        let identities = vec![super::AgentIdentityRecord {
            blob: key.public_key().key_data().encode_vec().unwrap(),
            comment: "stored".to_string(),
            fingerprint: "fingerprint".to_string(),
            provider: IdentityProvider::Stored { key, epoch: 0 },
        }];
        assert!(AgentBrokerFactory::has_internal_provider(&identities));
    }

    #[test]
    fn extension_proxy_requires_a_single_configured_external_provider() {
        let config = SshAgentForwardingConfig {
            enabled: true,
            sources: crate::config::SshAgentForwardingSources {
                external_agent: true,
                external_agent_endpoints: vec![crate::config::SshAgentEndpoint::Auto],
                stored_keys: false,
            },
            policy: SshAgentForwardingPolicy::All,
        };
        let factory = AgentBrokerFactory {
            app: None,
            stored_keys: Arc::new(Vec::new()),
            stored_key_cache: Arc::new(AsyncMutex::new(None)),
            allowed_fingerprints: Arc::new(std::sync::OnceLock::new()),
            sign_locks: Arc::new(Mutex::new(HashMap::new())),
            overflow_sign_lock: Arc::new(AsyncMutex::new(())),
            sign_permits: agent_sign_permits(),
            sign_timeout: AGENT_SIGN_TIMEOUT,
            config: config.clone(),
        };
        assert!(factory.can_proxy_external_extension_topology(false));

        let mut multi_endpoint_config = config.clone();
        multi_endpoint_config.sources.external_agent_endpoints.push(
            crate::config::SshAgentEndpoint::UnixSocket {
                path: "/tmp/second-agent".to_string(),
            },
        );
        let factory = AgentBrokerFactory {
            app: None,
            stored_keys: Arc::new(Vec::new()),
            stored_key_cache: Arc::new(AsyncMutex::new(None)),
            allowed_fingerprints: Arc::new(std::sync::OnceLock::new()),
            sign_locks: Arc::new(Mutex::new(HashMap::new())),
            overflow_sign_lock: Arc::new(AsyncMutex::new(())),
            sign_permits: agent_sign_permits(),
            sign_timeout: AGENT_SIGN_TIMEOUT,
            config: multi_endpoint_config,
        };
        assert!(!factory.can_proxy_external_extension_topology(false));

        let mut stored_keys_config = config;
        stored_keys_config.sources.stored_keys = true;
        let factory = AgentBrokerFactory {
            app: None,
            stored_keys: Arc::new(Vec::new()),
            stored_key_cache: Arc::new(AsyncMutex::new(None)),
            allowed_fingerprints: Arc::new(std::sync::OnceLock::new()),
            sign_locks: Arc::new(Mutex::new(HashMap::new())),
            overflow_sign_lock: Arc::new(AsyncMutex::new(())),
            sign_permits: agent_sign_permits(),
            sign_timeout: AGENT_SIGN_TIMEOUT,
            config: stored_keys_config,
        };
        assert!(!factory.can_proxy_external_extension_topology(false));
    }

    #[test]
    fn merged_identities_apply_allowlist_to_both_sources_and_prefer_external_duplicates() {
        let mut rng = russh::keys::key::safe_rng();
        let external_key = PrivateKey::random(&mut rng, Algorithm::Ed25519).unwrap();
        let stored_key = PrivateKey::random(&mut rng, Algorithm::Ed25519).unwrap();
        let duplicate_blob = external_key.public_key().key_data().encode_vec().unwrap();
        let stored_blob = stored_key.public_key().key_data().encode_vec().unwrap();
        let allowlist = vec![fingerprint(&duplicate_blob), fingerprint(&stored_blob)];
        let factory = AgentBrokerFactory {
            app: None,
            config: SshAgentForwardingConfig {
                enabled: true,
                sources: crate::config::SshAgentForwardingSources {
                    external_agent: true,
                    external_agent_endpoints: vec![crate::config::SshAgentEndpoint::Auto],
                    stored_keys: true,
                },
                policy: SshAgentForwardingPolicy::Allowlist {
                    fingerprints: allowlist,
                },
            },
            stored_keys: Arc::new(vec![
                StoredKeyIdentity {
                    blob: duplicate_blob.clone(),
                    comment: "stored duplicate".to_string(),
                    key: Arc::new(external_key.clone()),
                },
                StoredKeyIdentity {
                    blob: stored_blob.clone(),
                    comment: "stored key".to_string(),
                    key: Arc::new(stored_key),
                },
            ]),
            stored_key_cache: Arc::new(AsyncMutex::new(None)),
            allowed_fingerprints: Arc::new(std::sync::OnceLock::new()),
            sign_locks: Arc::new(Mutex::new(HashMap::new())),
            overflow_sign_lock: Arc::new(AsyncMutex::new(())),
            sign_permits: agent_sign_permits(),
            sign_timeout: AGENT_SIGN_TIMEOUT,
        };

        let identities = factory.merge_identities(
            vec![ExternalIdentity {
                blob: duplicate_blob,
                comment: "external duplicate".to_string(),
            }],
            factory.stored_keys.as_ref(),
        );

        assert_eq!(identities.len(), 2);
        assert!(matches!(
            identities[0].provider,
            IdentityProvider::External(_)
        ));
        assert_eq!(identities[0].comment, "external duplicate");
        assert!(matches!(
            identities[1].provider,
            IdentityProvider::Stored { .. }
        ));
    }

    #[test]
    fn stored_sign_response_contains_an_encoded_ssh_signature_blob() {
        let mut rng = russh::keys::key::safe_rng();
        let key = Arc::new(PrivateKey::random(&mut rng, Algorithm::Ed25519).unwrap());
        let blob = key.public_key().key_data().encode_vec().unwrap();
        let request = super::SignRequest {
            blob,
            data: b"agent-signature-test".to_vec(),
            flags: 0,
        };

        let response = sign_with_stored_key(&key, &request).unwrap();
        assert_eq!(response[4], super::SIGN_RESPONSE);
        let signature_length = u32::from_be_bytes(response[5..9].try_into().unwrap()) as usize;
        assert_eq!(signature_length, response.len() - 9);
        assert!(response[9..].starts_with(&[0, 0, 0, 11]));
        assert_eq!(&response[13..24], b"ssh-ed25519");
    }

    #[test]
    fn stored_signing_rejects_a_stale_key_epoch() {
        let mut rng = russh::keys::key::safe_rng();
        let key = Arc::new(PrivateKey::random(&mut rng, Algorithm::Ed25519).unwrap());
        let request = super::SignRequest {
            blob: key.public_key().key_data().encode_vec().unwrap(),
            data: b"stale-key-test".to_vec(),
            flags: 0,
        };

        let response = super::sign_with_stored_key_at_epoch(
            &key,
            crate::config::ssh_key_change_epoch().wrapping_sub(1),
            &request,
        )
        .expect("stale key should return an Agent failure frame");
        assert_eq!(response[4], super::FAILURE);
    }

    #[test]
    fn stored_rsa_signing_accepts_supported_flags_and_rejects_unknown_flags() {
        let mut rng = russh::keys::key::safe_rng();
        let key = Arc::new(
            PrivateKey::random(&mut rng, Algorithm::Rsa { hash: None })
                .expect("generate RSA test key"),
        );
        let blob = key.public_key().key_data().encode_vec().unwrap();

        for flags in [0, super::RSA_SHA2_256, super::RSA_SHA2_512] {
            let request = super::SignRequest {
                blob: blob.clone(),
                data: b"rsa-agent-signature-test".to_vec(),
                flags,
            };
            let response = sign_with_stored_key(&key, &request).expect("RSA signature");
            assert_eq!(response[4], super::SIGN_RESPONSE);
        }

        for flags in [1, 8] {
            let request = super::SignRequest {
                blob: blob.clone(),
                data: b"rsa-agent-signature-test".to_vec(),
                flags,
            };
            let response = sign_with_stored_key(&key, &request).expect("RSA failure response");
            assert_eq!(response[4], super::FAILURE);
        }
    }

    #[test]
    fn stored_ecdsa_signing_uses_the_generic_ssh_signer() {
        let mut rng = russh::keys::key::safe_rng();
        let key = Arc::new(
            PrivateKey::random(
                &mut rng,
                Algorithm::Ecdsa {
                    curve: russh::keys::EcdsaCurve::NistP256,
                },
            )
            .expect("generate ECDSA test key"),
        );
        let request = super::SignRequest {
            blob: key.public_key().key_data().encode_vec().unwrap(),
            data: b"ecdsa-agent-signature-test".to_vec(),
            flags: 0,
        };
        let response = sign_with_stored_key(&key, &request).expect("ECDSA signature");
        assert_eq!(response[4], super::SIGN_RESPONSE);
    }

    #[test]
    fn stored_certificate_identity_uses_the_complete_certificate_blob() {
        use std::time::{SystemTime, UNIX_EPOCH};

        let mut rng = rand::thread_rng();
        let ca_key = ssh_key::PrivateKey::random(&mut rng, ssh_key::Algorithm::Ed25519)
            .expect("generate certificate CA key");
        let user_key = ssh_key::PrivateKey::random(&mut rng, ssh_key::Algorithm::Ed25519)
            .expect("generate certificate user key");
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let mut builder = ssh_key::certificate::Builder::new_with_random_nonce(
            &mut rng,
            user_key.public_key(),
            now.saturating_sub(3600),
            now + 3600,
        )
        .expect("certificate builder");
        builder.serial(1).unwrap();
        builder.key_id("broker-cert").unwrap();
        builder
            .cert_type(ssh_key::certificate::CertType::User)
            .unwrap();
        builder.valid_principal("testuser").unwrap();
        let certificate = builder.sign(&ca_key).expect("sign certificate");
        let certificate_text = certificate.to_openssh().expect("encode certificate");
        let private_key_text = user_key
            .to_openssh(ssh_key::LineEnding::LF)
            .expect("encode private key");
        let private_key =
            russh::keys::decode_secret_key(&private_key_text, None).expect("decode private key");

        let identity = stored_key_identity_from_private_key(
            Arc::new(private_key),
            Some(&certificate_text),
            "stored certificate".to_string(),
        )
        .expect("stored certificate identity");
        let expected = russh::keys::Certificate::from_openssh(&certificate_text)
            .expect("decode certificate")
            .to_bytes()
            .expect("encode certificate blob");
        assert_eq!(identity.blob, expected);
    }

    #[cfg(unix)]
    async fn read_fake_agent_frame(stream: &mut UnixStream) -> Option<Vec<u8>> {
        let mut length = [0u8; 4];
        stream.read_exact(&mut length).await.ok()?;
        let mut payload = vec![0u8; u32::from_be_bytes(length) as usize];
        stream.read_exact(&mut payload).await.ok()?;
        Some(payload)
    }

    #[cfg(unix)]
    async fn write_fake_agent_frame(
        stream: &mut UnixStream,
        payload: &[u8],
    ) -> std::io::Result<()> {
        stream.write_all(&frame(payload)).await?;
        stream.flush().await
    }

    #[cfg(unix)]
    fn fake_agent_socket_path(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!("n-{label}-{}", uuid::Uuid::new_v4()))
    }

    #[cfg(unix)]
    fn spawn_fake_agent(
        label: &str,
        identity: Vec<u8>,
        sign_count: Arc<AtomicUsize>,
    ) -> (PathBuf, tokio::task::JoinHandle<()>) {
        let path = fake_agent_socket_path(label);
        let listener = UnixListener::bind(&path).expect("bind fake Agent socket");
        let server = tokio::spawn(async move {
            let Ok((mut stream, _)) = listener.accept().await else {
                return;
            };
            while let Some(request) = read_fake_agent_frame(&mut stream).await {
                let response = match request.first().copied() {
                    Some(super::REQUEST_IDENTITIES) => {
                        let mut payload = vec![super::IDENTITIES_ANSWER];
                        super::encode_u32(1, &mut payload);
                        super::encode_string(&identity, &mut payload);
                        super::encode_string(b"fake-agent-identity", &mut payload);
                        payload
                    }
                    Some(super::SIGN_REQUEST) => {
                        sign_count.fetch_add(1, Ordering::SeqCst);
                        let mut signature_blob = Vec::new();
                        super::encode_string(b"ssh-ed25519", &mut signature_blob);
                        super::encode_string(&[0x42; 64], &mut signature_blob);
                        let mut payload = vec![super::SIGN_RESPONSE];
                        super::encode_string(&signature_blob, &mut payload);
                        payload
                    }
                    _ => vec![super::FAILURE],
                };
                if write_fake_agent_frame(&mut stream, &response)
                    .await
                    .is_err()
                {
                    break;
                }
            }
        });
        (path, server)
    }

    #[cfg(unix)]
    fn spawn_malformed_agent(label: &str) -> (PathBuf, tokio::task::JoinHandle<()>) {
        let path = fake_agent_socket_path(label);
        let listener = UnixListener::bind(&path).expect("bind malformed Agent socket");
        let server = tokio::spawn(async move {
            let Ok((mut stream, _)) = listener.accept().await else {
                return;
            };
            if read_fake_agent_frame(&mut stream).await.is_some() {
                let _ =
                    write_fake_agent_frame(&mut stream, &[super::IDENTITIES_ANSWER, 0, 0, 0, 1])
                        .await;
            }
        });
        (path, server)
    }

    #[cfg(unix)]
    fn spawn_hanging_identity_agent(
        label: &str,
    ) -> (PathBuf, tokio::task::JoinHandle<()>, oneshot::Receiver<()>) {
        let path = fake_agent_socket_path(label);
        let listener = UnixListener::bind(&path).expect("bind hanging Agent socket");
        let (started_tx, started_rx) = oneshot::channel();
        let server = tokio::spawn(async move {
            let Ok((mut stream, _)) = listener.accept().await else {
                return;
            };
            if read_fake_agent_frame(&mut stream).await == Some(vec![super::REQUEST_IDENTITIES]) {
                let _ = started_tx.send(());
                std::future::pending::<()>().await;
            }
        });
        (path, server, started_rx)
    }

    #[cfg(unix)]
    fn spawn_hanging_sign_agent(
        label: &str,
        identity: Vec<u8>,
    ) -> (PathBuf, tokio::task::JoinHandle<()>, oneshot::Receiver<()>) {
        let path = fake_agent_socket_path(label);
        let listener = UnixListener::bind(&path).expect("bind hanging-sign Agent socket");
        let (started_tx, started_rx) = oneshot::channel();
        let server = tokio::spawn(async move {
            let mut started_tx = Some(started_tx);
            let Ok((mut stream, _)) = listener.accept().await else {
                return;
            };
            while let Some(request) = read_fake_agent_frame(&mut stream).await {
                match request.first().copied() {
                    Some(super::REQUEST_IDENTITIES) => {
                        let mut payload = vec![super::IDENTITIES_ANSWER];
                        super::encode_u32(1, &mut payload);
                        super::encode_string(&identity, &mut payload);
                        super::encode_string(b"hanging-sign-agent", &mut payload);
                        if write_fake_agent_frame(&mut stream, &payload).await.is_err() {
                            return;
                        }
                    }
                    Some(super::SIGN_REQUEST) => {
                        if let Some(started_tx) = started_tx.take() {
                            let _ = started_tx.send(());
                        }
                        std::future::pending::<()>().await;
                    }
                    _ => return,
                }
            }
        });
        (path, server, started_rx)
    }

    #[cfg(unix)]
    fn spawn_gated_sign_agent(
        label: &str,
        identity: Vec<u8>,
        sign_count: Arc<AtomicUsize>,
    ) -> (
        PathBuf,
        tokio::task::JoinHandle<()>,
        oneshot::Receiver<()>,
        oneshot::Sender<()>,
    ) {
        let path = fake_agent_socket_path(label);
        let listener = UnixListener::bind(&path).expect("bind gated-sign Agent socket");
        let (started_tx, started_rx) = oneshot::channel();
        let (release_tx, release_rx) = oneshot::channel();
        let server = tokio::spawn(async move {
            let mut started_tx = Some(started_tx);
            let mut release_rx = Some(release_rx);
            let Ok((mut stream, _)) = listener.accept().await else {
                return;
            };
            while let Some(request) = read_fake_agent_frame(&mut stream).await {
                match request.first().copied() {
                    Some(super::REQUEST_IDENTITIES) => {
                        let mut payload = vec![super::IDENTITIES_ANSWER];
                        super::encode_u32(1, &mut payload);
                        super::encode_string(&identity, &mut payload);
                        super::encode_string(b"gated-sign-agent", &mut payload);
                        if write_fake_agent_frame(&mut stream, &payload).await.is_err() {
                            return;
                        }
                    }
                    Some(super::SIGN_REQUEST) => {
                        sign_count.fetch_add(1, Ordering::SeqCst);
                        if let Some(started_tx) = started_tx.take() {
                            let _ = started_tx.send(());
                        }
                        if let Some(release_rx) = release_rx.take() {
                            let _ = release_rx.await;
                        }
                        let mut signature_blob = Vec::new();
                        super::encode_string(b"ssh-ed25519", &mut signature_blob);
                        super::encode_string(&[0x42; 64], &mut signature_blob);
                        let mut payload = vec![super::SIGN_RESPONSE];
                        super::encode_string(&signature_blob, &mut payload);
                        if write_fake_agent_frame(&mut stream, &payload).await.is_err() {
                            return;
                        }
                    }
                    _ => return,
                }
            }
        });
        (path, server, started_rx, release_tx)
    }

    #[cfg(unix)]
    fn spawn_failing_sign_agent(
        label: &str,
        identity: Vec<u8>,
        sign_count: Arc<AtomicUsize>,
    ) -> (PathBuf, tokio::task::JoinHandle<()>) {
        let path = fake_agent_socket_path(label);
        let listener = UnixListener::bind(&path).expect("bind failing-sign Agent socket");
        let server = tokio::spawn(async move {
            let Ok((mut stream, _)) = listener.accept().await else {
                return;
            };
            while let Some(request) = read_fake_agent_frame(&mut stream).await {
                let response = match request.first().copied() {
                    Some(super::REQUEST_IDENTITIES) => {
                        let mut payload = vec![super::IDENTITIES_ANSWER];
                        super::encode_u32(1, &mut payload);
                        super::encode_string(&identity, &mut payload);
                        super::encode_string(b"failing-sign-agent", &mut payload);
                        payload
                    }
                    Some(super::SIGN_REQUEST) => {
                        sign_count.fetch_add(1, Ordering::SeqCst);
                        vec![super::FAILURE]
                    }
                    _ => vec![super::FAILURE],
                };
                if write_fake_agent_frame(&mut stream, &response)
                    .await
                    .is_err()
                {
                    break;
                }
            }
        });
        (path, server)
    }

    #[cfg(unix)]
    fn spawn_closing_sign_agent(
        label: &str,
        identity: Vec<u8>,
    ) -> (PathBuf, tokio::task::JoinHandle<()>) {
        let path = fake_agent_socket_path(label);
        let listener = UnixListener::bind(&path).expect("bind closing-sign Agent socket");
        let server = tokio::spawn(async move {
            let Ok((mut stream, _)) = listener.accept().await else {
                return;
            };
            while let Some(request) = read_fake_agent_frame(&mut stream).await {
                match request.first().copied() {
                    Some(super::REQUEST_IDENTITIES) => {
                        let mut payload = vec![super::IDENTITIES_ANSWER];
                        super::encode_u32(1, &mut payload);
                        super::encode_string(&identity, &mut payload);
                        super::encode_string(b"closing-sign-agent", &mut payload);
                        if write_fake_agent_frame(&mut stream, &payload).await.is_err() {
                            return;
                        }
                    }
                    _ => return,
                }
            }
        });
        (path, server)
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn failed_external_agent_does_not_hide_healthy_identities() {
        let mut rng = russh::keys::key::safe_rng();
        let key = PrivateKey::random(&mut rng, Algorithm::Ed25519).unwrap();
        let blob = key.public_key().key_data().encode_vec().unwrap();
        let sign_count = Arc::new(AtomicUsize::new(0));
        let (healthy_path, healthy_server) = spawn_fake_agent("healthy", blob, sign_count);
        let missing_path = fake_agent_socket_path("missing");

        let factory = AgentBrokerFactory {
            app: None,
            config: SshAgentForwardingConfig {
                enabled: true,
                sources: crate::config::SshAgentForwardingSources {
                    external_agent: true,
                    external_agent_endpoints: vec![
                        crate::config::SshAgentEndpoint::UnixSocket {
                            path: missing_path.to_string_lossy().into_owned(),
                        },
                        crate::config::SshAgentEndpoint::UnixSocket {
                            path: healthy_path.to_string_lossy().into_owned(),
                        },
                    ],
                    stored_keys: false,
                },
                policy: SshAgentForwardingPolicy::All,
            },
            stored_keys: Arc::new(Vec::new()),
            stored_key_cache: Arc::new(AsyncMutex::new(None)),
            allowed_fingerprints: Arc::new(std::sync::OnceLock::new()),
            sign_locks: Arc::new(Mutex::new(HashMap::new())),
            overflow_sign_lock: Arc::new(AsyncMutex::new(())),
            sign_permits: agent_sign_permits(),
            sign_timeout: AGENT_SIGN_TIMEOUT,
        };

        let mut external = factory.connect_external_upstreams().await;
        assert_eq!(external.len(), 1);
        let mut identities = Vec::new();
        factory
            .handle_request(&[super::REQUEST_IDENTITIES], &mut external, &mut identities)
            .await
            .expect("identity response");
        assert_eq!(identities.len(), 1);

        drop(external);
        timeout(Duration::from_secs(1), healthy_server)
            .await
            .expect("healthy fake Agent shutdown")
            .expect("healthy fake Agent task");
        let _ = std::fs::remove_file(healthy_path);
        let _ = std::fs::remove_file(missing_path);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn malformed_external_agent_does_not_hide_healthy_identities() {
        let mut rng = russh::keys::key::safe_rng();
        let key = PrivateKey::random(&mut rng, Algorithm::Ed25519).unwrap();
        let blob = key.public_key().key_data().encode_vec().unwrap();
        let sign_count = Arc::new(AtomicUsize::new(0));
        let (healthy_path, healthy_server) = spawn_fake_agent("hm", blob, sign_count);
        let (malformed_path, malformed_server) = spawn_malformed_agent("bad");

        let factory = AgentBrokerFactory {
            app: None,
            config: SshAgentForwardingConfig {
                enabled: true,
                sources: crate::config::SshAgentForwardingSources {
                    external_agent: true,
                    external_agent_endpoints: vec![
                        crate::config::SshAgentEndpoint::UnixSocket {
                            path: malformed_path.to_string_lossy().into_owned(),
                        },
                        crate::config::SshAgentEndpoint::UnixSocket {
                            path: healthy_path.to_string_lossy().into_owned(),
                        },
                    ],
                    stored_keys: false,
                },
                policy: SshAgentForwardingPolicy::All,
            },
            stored_keys: Arc::new(Vec::new()),
            stored_key_cache: Arc::new(AsyncMutex::new(None)),
            allowed_fingerprints: Arc::new(std::sync::OnceLock::new()),
            sign_locks: Arc::new(Mutex::new(HashMap::new())),
            overflow_sign_lock: Arc::new(AsyncMutex::new(())),
            sign_permits: agent_sign_permits(),
            sign_timeout: AGENT_SIGN_TIMEOUT,
        };

        let mut external = factory.connect_external_upstreams().await;
        assert_eq!(external.len(), 2);
        let mut identities = Vec::new();
        factory
            .handle_request(&[super::REQUEST_IDENTITIES], &mut external, &mut identities)
            .await
            .expect("identity response");
        assert_eq!(identities.len(), 1);

        drop(external);
        timeout(Duration::from_secs(1), healthy_server)
            .await
            .expect("healthy fake Agent shutdown")
            .expect("healthy fake Agent task");
        timeout(Duration::from_secs(1), malformed_server)
            .await
            .expect("malformed fake Agent shutdown")
            .expect("malformed fake Agent task");
        let _ = std::fs::remove_file(healthy_path);
        let _ = std::fs::remove_file(malformed_path);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn timed_out_external_agent_does_not_hide_healthy_identities() {
        let mut rng = russh::keys::key::safe_rng();
        let key = PrivateKey::random(&mut rng, Algorithm::Ed25519).unwrap();
        let blob = key.public_key().key_data().encode_vec().unwrap();
        let sign_count = Arc::new(AtomicUsize::new(0));
        let (slow_path, slow_server, slow_started) = spawn_hanging_identity_agent("timeout");
        let (healthy_path, healthy_server) = spawn_fake_agent("timeout-healthy", blob, sign_count);

        let factory = AgentBrokerFactory {
            app: None,
            config: SshAgentForwardingConfig {
                enabled: true,
                sources: crate::config::SshAgentForwardingSources {
                    external_agent: true,
                    external_agent_endpoints: vec![
                        crate::config::SshAgentEndpoint::UnixSocket {
                            path: slow_path.to_string_lossy().into_owned(),
                        },
                        crate::config::SshAgentEndpoint::UnixSocket {
                            path: healthy_path.to_string_lossy().into_owned(),
                        },
                    ],
                    stored_keys: false,
                },
                policy: SshAgentForwardingPolicy::All,
            },
            stored_keys: Arc::new(Vec::new()),
            stored_key_cache: Arc::new(AsyncMutex::new(None)),
            allowed_fingerprints: Arc::new(std::sync::OnceLock::new()),
            sign_locks: Arc::new(Mutex::new(HashMap::new())),
            overflow_sign_lock: Arc::new(AsyncMutex::new(())),
            sign_permits: agent_sign_permits(),
            sign_timeout: AGENT_SIGN_TIMEOUT,
        };

        pause();
        let mut external = factory.connect_external_upstreams().await;
        let request_task = tokio::spawn(async move {
            let mut identities = Vec::new();
            let result = factory
                .handle_request(&[super::REQUEST_IDENTITIES], &mut external, &mut identities)
                .await;
            (result, external, identities)
        });
        slow_started
            .await
            .expect("hanging Agent should receive identity request");
        advance(AGENT_IDENTITY_TIMEOUT + Duration::from_secs(1)).await;
        let (result, external, identities) = request_task.await.expect("identity task");
        let response = result.expect("partial identity response");
        assert_eq!(response[4], super::IDENTITIES_ANSWER);
        assert_eq!(identities.len(), 1);
        assert!(!external[0].healthy);
        assert!(external[1].healthy);

        drop(external);
        slow_server.abort();
        let _ = slow_server.await;
        timeout(Duration::from_secs(1), healthy_server)
            .await
            .expect("healthy fake Agent shutdown")
            .expect("healthy fake Agent task");
        tokio::time::resume();
        let _ = std::fs::remove_file(slow_path);
        let _ = std::fs::remove_file(healthy_path);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn timed_out_external_signature_marks_the_provider_unhealthy() {
        let mut rng = russh::keys::key::safe_rng();
        let key = PrivateKey::random(&mut rng, Algorithm::Ed25519).unwrap();
        let blob = key.public_key().key_data().encode_vec().unwrap();
        let (path, server, sign_started) = spawn_hanging_sign_agent("sign-timeout", blob.clone());

        let factory = AgentBrokerFactory {
            app: None,
            config: SshAgentForwardingConfig {
                enabled: true,
                sources: crate::config::SshAgentForwardingSources {
                    external_agent: true,
                    external_agent_endpoints: vec![crate::config::SshAgentEndpoint::UnixSocket {
                        path: path.to_string_lossy().into_owned(),
                    }],
                    stored_keys: false,
                },
                policy: SshAgentForwardingPolicy::All,
            },
            stored_keys: Arc::new(Vec::new()),
            stored_key_cache: Arc::new(AsyncMutex::new(None)),
            allowed_fingerprints: Arc::new(std::sync::OnceLock::new()),
            sign_locks: Arc::new(Mutex::new(HashMap::new())),
            overflow_sign_lock: Arc::new(AsyncMutex::new(())),
            sign_permits: agent_sign_permits(),
            sign_timeout: AGENT_SIGN_TIMEOUT,
        };

        pause();
        let mut external = factory.connect_external_upstreams().await;
        let mut identities = Vec::new();
        factory
            .handle_request(&[super::REQUEST_IDENTITIES], &mut external, &mut identities)
            .await
            .expect("identity response");

        let mut sign_request = vec![super::SIGN_REQUEST];
        super::encode_string(&blob, &mut sign_request);
        super::encode_string(b"timeout-signature-test", &mut sign_request);
        super::encode_u32(0, &mut sign_request);
        let request_task = tokio::spawn(async move {
            let result = factory
                .handle_request(&sign_request, &mut external, &mut identities)
                .await;
            (result, external)
        });
        sign_started
            .await
            .expect("hanging Agent should receive sign request");
        advance(AGENT_SIGN_TIMEOUT + Duration::from_secs(1)).await;
        let (result, external) = request_task.await.expect("signature task");
        let error = result.expect_err("broker should reject a timed-out upstream");
        assert!(
            error
                .to_string()
                .contains("external Agent request timed out")
        );
        assert!(!external[0].healthy);

        drop(external);
        server.abort();
        let _ = server.await;
        tokio::time::resume();
        let _ = std::fs::remove_file(path);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn broker_merges_multiple_external_agents_and_routes_signatures() {
        let mut rng = russh::keys::key::safe_rng();
        let key_a = PrivateKey::random(&mut rng, Algorithm::Ed25519).unwrap();
        let key_b = PrivateKey::random(&mut rng, Algorithm::Ed25519).unwrap();
        let blob_a = key_a.public_key().key_data().encode_vec().unwrap();
        let blob_b = key_b.public_key().key_data().encode_vec().unwrap();
        let count_a = Arc::new(AtomicUsize::new(0));
        let count_b = Arc::new(AtomicUsize::new(0));
        let (path_a, server_a) = spawn_fake_agent("a", blob_a.clone(), count_a.clone());
        let (path_b, server_b) = spawn_fake_agent("b", blob_b.clone(), count_b.clone());

        let factory = AgentBrokerFactory {
            app: None,
            config: SshAgentForwardingConfig {
                enabled: true,
                sources: crate::config::SshAgentForwardingSources {
                    external_agent: true,
                    external_agent_endpoints: vec![
                        crate::config::SshAgentEndpoint::UnixSocket {
                            path: path_a.to_string_lossy().into_owned(),
                        },
                        crate::config::SshAgentEndpoint::UnixSocket {
                            path: path_b.to_string_lossy().into_owned(),
                        },
                    ],
                    stored_keys: false,
                },
                policy: SshAgentForwardingPolicy::All,
            },
            stored_keys: Arc::new(Vec::new()),
            stored_key_cache: Arc::new(AsyncMutex::new(None)),
            allowed_fingerprints: Arc::new(std::sync::OnceLock::new()),
            sign_locks: Arc::new(Mutex::new(HashMap::new())),
            overflow_sign_lock: Arc::new(AsyncMutex::new(())),
            sign_permits: agent_sign_permits(),
            sign_timeout: AGENT_SIGN_TIMEOUT,
        };

        let mut external = factory.connect_external_upstreams().await;
        assert_eq!(external.len(), 2);
        let mut identities = Vec::new();
        let response = factory
            .handle_request(&[super::REQUEST_IDENTITIES], &mut external, &mut identities)
            .await
            .expect("identity response");
        assert_eq!(response[4], super::IDENTITIES_ANSWER);
        assert_eq!(identities.len(), 2);
        assert!(matches!(
            identities[0].provider,
            IdentityProvider::External(0)
        ));
        assert!(matches!(
            identities[1].provider,
            IdentityProvider::External(1)
        ));

        let mut sign_request = vec![super::SIGN_REQUEST];
        super::encode_string(&blob_b, &mut sign_request);
        super::encode_string(b"broker-signature-test", &mut sign_request);
        super::encode_u32(0, &mut sign_request);
        let response = factory
            .handle_request(&sign_request, &mut external, &mut identities)
            .await
            .expect("signature response");
        assert_eq!(response[4], super::SIGN_RESPONSE);
        assert_eq!(count_a.load(Ordering::SeqCst), 0);
        assert_eq!(count_b.load(Ordering::SeqCst), 1);

        drop(external);
        timeout(Duration::from_secs(1), server_a)
            .await
            .expect("fake Agent A shutdown")
            .expect("fake Agent A task");
        timeout(Duration::from_secs(1), server_b)
            .await
            .expect("fake Agent B shutdown")
            .expect("fake Agent B task");
        let _ = std::fs::remove_file(path_a);
        let _ = std::fs::remove_file(path_b);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn different_fingerprints_share_the_global_signing_permit() {
        let mut rng = russh::keys::key::safe_rng();
        let key_a = PrivateKey::random(&mut rng, Algorithm::Ed25519).unwrap();
        let key_b = PrivateKey::random(&mut rng, Algorithm::Ed25519).unwrap();
        let blob_a = key_a.public_key().key_data().encode_vec().unwrap();
        let blob_b = key_b.public_key().key_data().encode_vec().unwrap();
        let count_a = Arc::new(AtomicUsize::new(0));
        let count_b = Arc::new(AtomicUsize::new(0));
        let (path_a, server_a, started_a, release_a) =
            spawn_gated_sign_agent("permit-a", blob_a.clone(), count_a.clone());
        let (path_b, server_b, started_b, release_b) =
            spawn_gated_sign_agent("permit-b", blob_b.clone(), count_b.clone());
        let sign_permits = Arc::new(Semaphore::new(1));

        let make_factory = |path: PathBuf| AgentBrokerFactory {
            app: None,
            config: SshAgentForwardingConfig {
                enabled: true,
                sources: crate::config::SshAgentForwardingSources {
                    external_agent: true,
                    external_agent_endpoints: vec![crate::config::SshAgentEndpoint::UnixSocket {
                        path: path.to_string_lossy().into_owned(),
                    }],
                    stored_keys: false,
                },
                policy: SshAgentForwardingPolicy::All,
            },
            stored_keys: Arc::new(Vec::new()),
            stored_key_cache: Arc::new(AsyncMutex::new(None)),
            allowed_fingerprints: Arc::new(std::sync::OnceLock::new()),
            sign_locks: Arc::new(Mutex::new(HashMap::new())),
            overflow_sign_lock: Arc::new(AsyncMutex::new(())),
            sign_permits: sign_permits.clone(),
            sign_timeout: AGENT_SIGN_TIMEOUT,
        };

        let factory_a = make_factory(path_a.clone());
        let factory_b = make_factory(path_b.clone());
        let mut external_a = factory_a.connect_external_upstreams().await;
        let mut external_b = factory_b.connect_external_upstreams().await;
        let mut identities_a = Vec::new();
        let mut identities_b = Vec::new();
        factory_a
            .handle_request(
                &[super::REQUEST_IDENTITIES],
                &mut external_a,
                &mut identities_a,
            )
            .await
            .expect("identity response A");
        factory_b
            .handle_request(
                &[super::REQUEST_IDENTITIES],
                &mut external_b,
                &mut identities_b,
            )
            .await
            .expect("identity response B");

        let mut request_a = vec![super::SIGN_REQUEST];
        super::encode_string(&blob_a, &mut request_a);
        super::encode_string(b"permit-a-signature", &mut request_a);
        super::encode_u32(0, &mut request_a);
        let task_a = tokio::spawn(async move {
            factory_a
                .handle_request(&request_a, &mut external_a, &mut identities_a)
                .await
        });
        timeout(Duration::from_secs(1), started_a)
            .await
            .expect("Agent A should receive the first signature request")
            .expect("Agent A start signal");

        let mut request_b = vec![super::SIGN_REQUEST];
        super::encode_string(&blob_b, &mut request_b);
        super::encode_string(b"permit-b-signature", &mut request_b);
        super::encode_u32(0, &mut request_b);
        let task_b = tokio::spawn(async move {
            factory_b
                .handle_request(&request_b, &mut external_b, &mut identities_b)
                .await
        });
        for _ in 0..8 {
            tokio::task::yield_now().await;
        }
        assert_eq!(count_b.load(Ordering::SeqCst), 0);

        release_a.send(()).expect("release Agent A signing request");
        let response_a = timeout(Duration::from_secs(1), task_a)
            .await
            .expect("Agent A signature task")
            .expect("Agent A task join")
            .expect("Agent A signature response");
        assert_eq!(response_a[4], super::SIGN_RESPONSE);

        timeout(Duration::from_secs(1), started_b)
            .await
            .expect("Agent B should receive the second signature request")
            .expect("Agent B start signal");
        release_b.send(()).expect("release Agent B signing request");
        let response_b = timeout(Duration::from_secs(1), task_b)
            .await
            .expect("Agent B signature task")
            .expect("Agent B task join")
            .expect("Agent B signature response");
        assert_eq!(response_b[4], super::SIGN_RESPONSE);
        assert_eq!(count_a.load(Ordering::SeqCst), 1);
        assert_eq!(count_b.load(Ordering::SeqCst), 1);

        timeout(Duration::from_secs(1), server_a)
            .await
            .expect("gated Agent A shutdown")
            .expect("gated Agent A task");
        timeout(Duration::from_secs(1), server_b)
            .await
            .expect("gated Agent B shutdown")
            .expect("gated Agent B task");
        let _ = std::fs::remove_file(path_a);
        let _ = std::fs::remove_file(path_b);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn duplicate_identity_signature_failure_does_not_fallback_to_later_provider() {
        let mut rng = russh::keys::key::safe_rng();
        let key = PrivateKey::random(&mut rng, Algorithm::Ed25519).unwrap();
        let blob = key.public_key().key_data().encode_vec().unwrap();
        let first_count = Arc::new(AtomicUsize::new(0));
        let second_count = Arc::new(AtomicUsize::new(0));
        let (first_path, first_server) =
            spawn_failing_sign_agent("dup-f", blob.clone(), first_count.clone());
        let (second_path, second_server) =
            spawn_fake_agent("dup-s", blob.clone(), second_count.clone());

        let factory = AgentBrokerFactory {
            app: None,
            config: SshAgentForwardingConfig {
                enabled: true,
                sources: crate::config::SshAgentForwardingSources {
                    external_agent: true,
                    external_agent_endpoints: vec![
                        crate::config::SshAgentEndpoint::UnixSocket {
                            path: first_path.to_string_lossy().into_owned(),
                        },
                        crate::config::SshAgentEndpoint::UnixSocket {
                            path: second_path.to_string_lossy().into_owned(),
                        },
                    ],
                    stored_keys: false,
                },
                policy: SshAgentForwardingPolicy::All,
            },
            stored_keys: Arc::new(Vec::new()),
            stored_key_cache: Arc::new(AsyncMutex::new(None)),
            allowed_fingerprints: Arc::new(std::sync::OnceLock::new()),
            sign_locks: Arc::new(Mutex::new(HashMap::new())),
            overflow_sign_lock: Arc::new(AsyncMutex::new(())),
            sign_permits: agent_sign_permits(),
            sign_timeout: AGENT_SIGN_TIMEOUT,
        };

        let mut external = factory.connect_external_upstreams().await;
        let mut identities = Vec::new();
        factory
            .handle_request(&[super::REQUEST_IDENTITIES], &mut external, &mut identities)
            .await
            .expect("identity response");
        assert_eq!(identities.len(), 1);
        assert!(matches!(
            identities[0].provider,
            IdentityProvider::External(0)
        ));

        let mut sign_request = vec![super::SIGN_REQUEST];
        super::encode_string(&blob, &mut sign_request);
        super::encode_string(b"duplicate-signature-test", &mut sign_request);
        super::encode_u32(0, &mut sign_request);
        let response = factory
            .handle_request(&sign_request, &mut external, &mut identities)
            .await
            .expect("upstream failure response");
        assert_eq!(response[4], super::FAILURE);
        assert_eq!(first_count.load(Ordering::SeqCst), 1);
        assert_eq!(second_count.load(Ordering::SeqCst), 0);

        drop(external);
        timeout(Duration::from_secs(1), first_server)
            .await
            .expect("first fake Agent shutdown")
            .expect("first fake Agent task");
        timeout(Duration::from_secs(1), second_server)
            .await
            .expect("second fake Agent shutdown")
            .expect("second fake Agent task");
        let _ = std::fs::remove_file(first_path);
        let _ = std::fs::remove_file(second_path);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn closed_external_signature_channel_marks_provider_unhealthy() {
        let mut rng = russh::keys::key::safe_rng();
        let key = PrivateKey::random(&mut rng, Algorithm::Ed25519).unwrap();
        let blob = key.public_key().key_data().encode_vec().unwrap();
        let (path, server) = spawn_closing_sign_agent("closed-sign", blob.clone());
        let factory = AgentBrokerFactory {
            app: None,
            config: SshAgentForwardingConfig {
                enabled: true,
                sources: crate::config::SshAgentForwardingSources {
                    external_agent: true,
                    external_agent_endpoints: vec![crate::config::SshAgentEndpoint::UnixSocket {
                        path: path.to_string_lossy().into_owned(),
                    }],
                    stored_keys: false,
                },
                policy: SshAgentForwardingPolicy::All,
            },
            stored_keys: Arc::new(Vec::new()),
            stored_key_cache: Arc::new(AsyncMutex::new(None)),
            allowed_fingerprints: Arc::new(std::sync::OnceLock::new()),
            sign_locks: Arc::new(Mutex::new(HashMap::new())),
            overflow_sign_lock: Arc::new(AsyncMutex::new(())),
            sign_permits: agent_sign_permits(),
            sign_timeout: AGENT_SIGN_TIMEOUT,
        };

        let mut external = factory.connect_external_upstreams().await;
        let mut identities = Vec::new();
        factory
            .handle_request(&[super::REQUEST_IDENTITIES], &mut external, &mut identities)
            .await
            .expect("identity response");
        let mut sign_request = vec![super::SIGN_REQUEST];
        super::encode_string(&blob, &mut sign_request);
        super::encode_string(b"closed-signature-test", &mut sign_request);
        super::encode_u32(0, &mut sign_request);
        let error = factory
            .handle_request(&sign_request, &mut external, &mut identities)
            .await
            .expect_err("closed upstream should fail the signature request");
        assert!(error.to_string().contains("external Agent closed"));
        assert!(!external[0].healthy);

        drop(external);
        timeout(Duration::from_secs(1), server)
            .await
            .expect("closing fake Agent shutdown")
            .expect("closing fake Agent task");
        let _ = std::fs::remove_file(path);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn closed_provider_does_not_block_a_healthy_provider() {
        let mut rng = russh::keys::key::safe_rng();
        let key_a = PrivateKey::random(&mut rng, Algorithm::Ed25519).unwrap();
        let key_b = PrivateKey::random(&mut rng, Algorithm::Ed25519).unwrap();
        let blob_a = key_a.public_key().key_data().encode_vec().unwrap();
        let blob_b = key_b.public_key().key_data().encode_vec().unwrap();
        let count_b = Arc::new(AtomicUsize::new(0));
        let (path_a, server_a) = spawn_closing_sign_agent("ci", blob_a.clone());
        let (path_b, server_b) = spawn_fake_agent("hi", blob_b.clone(), count_b.clone());
        let factory = AgentBrokerFactory {
            app: None,
            config: SshAgentForwardingConfig {
                enabled: true,
                sources: crate::config::SshAgentForwardingSources {
                    external_agent: true,
                    external_agent_endpoints: vec![
                        crate::config::SshAgentEndpoint::UnixSocket {
                            path: path_a.to_string_lossy().into_owned(),
                        },
                        crate::config::SshAgentEndpoint::UnixSocket {
                            path: path_b.to_string_lossy().into_owned(),
                        },
                    ],
                    stored_keys: false,
                },
                policy: SshAgentForwardingPolicy::All,
            },
            stored_keys: Arc::new(Vec::new()),
            stored_key_cache: Arc::new(AsyncMutex::new(None)),
            allowed_fingerprints: Arc::new(std::sync::OnceLock::new()),
            sign_locks: Arc::new(Mutex::new(HashMap::new())),
            overflow_sign_lock: Arc::new(AsyncMutex::new(())),
            sign_permits: agent_sign_permits(),
            sign_timeout: AGENT_SIGN_TIMEOUT,
        };

        let mut external = factory.connect_external_upstreams().await;
        let mut identities = Vec::new();
        factory
            .handle_request(&[super::REQUEST_IDENTITIES], &mut external, &mut identities)
            .await
            .expect("identity response");
        assert_eq!(identities.len(), 2);

        let mut request_a = vec![super::SIGN_REQUEST];
        super::encode_string(&blob_a, &mut request_a);
        super::encode_string(b"closed-isolation-signature", &mut request_a);
        super::encode_u32(0, &mut request_a);
        let response_a = factory
            .handle_request(&request_a, &mut external, &mut identities)
            .await
            .expect_err("closed provider should fail");
        assert!(response_a.to_string().contains("external Agent closed"));
        assert!(!external[0].healthy);

        let mut request_b = vec![super::SIGN_REQUEST];
        super::encode_string(&blob_b, &mut request_b);
        super::encode_string(b"healthy-isolation-signature", &mut request_b);
        super::encode_u32(0, &mut request_b);
        let response_b = factory
            .handle_request(&request_b, &mut external, &mut identities)
            .await
            .expect("healthy provider should remain usable");
        assert_eq!(response_b[4], super::SIGN_RESPONSE);
        assert_eq!(count_b.load(Ordering::SeqCst), 1);

        drop(external);
        timeout(Duration::from_secs(1), server_a)
            .await
            .expect("closing Agent shutdown")
            .expect("closing Agent task");
        timeout(Duration::from_secs(1), server_b)
            .await
            .expect("healthy Agent shutdown")
            .expect("healthy Agent task");
        let _ = std::fs::remove_file(path_a);
        let _ = std::fs::remove_file(path_b);
    }
}
