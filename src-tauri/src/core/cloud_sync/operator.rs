use std::collections::HashMap;
use std::io;
use std::time::Duration;

#[cfg(test)]
use std::sync::{Arc, Mutex as StdMutex};

use base64::Engine;
use base64::engine::general_purpose::{STANDARD as BASE64_STANDARD, URL_SAFE_NO_PAD};
use opendal::layers::{RetryLayer, TimeoutLayer, TracingLayer};
use opendal::services::{AliyunDrive, Gdrive, Onedrive, S3};
use opendal::{EntryMode, ErrorKind, Operator};

use crate::config::CloudSyncSettings;
use crate::error::{AppError, AppResult};
use crate::utils::url::normalize_storage_endpoint;

use super::remote::remote_path;

const GITEE_REMOTE_FILE_PREFIX: &str = "nyaterm-";
const GITEE_REMOTE_FILE_SUFFIX: &str = ".blob";
const GITEE_REMOTE_TIMEOUT: Duration = Duration::from_secs(30);
const GITHUB_GIST_API_ENDPOINT: &str = "https://api.github.com";
const GITHUB_GIST_REMOTE_TIMEOUT: Duration = Duration::from_secs(30);
const GITHUB_GIST_CONFLICT_RETRY_DELAY: Duration = Duration::from_millis(750);
const GITHUB_API_VERSION: &str = "2022-11-28";

#[derive(Clone)]
pub(super) enum CloudRemote {
    OpenDal(Operator),
    GiteeSnippet(GiteeSnippetRemote),
    GithubGist(GithubGistRemote),
    #[cfg(test)]
    Memory(MemoryRemote),
}

impl CloudRemote {
    pub(super) async fn create_dir(&self, path: &str) -> AppResult<()> {
        match self {
            Self::OpenDal(operator) => operator.create_dir(path).await.map_err(map_storage_error),
            Self::GiteeSnippet(_) => Ok(()),
            Self::GithubGist(_) => Ok(()),
            #[cfg(test)]
            Self::Memory(remote) => remote.create_dir(path),
        }
    }

    pub(super) async fn exists(&self, path: &str) -> AppResult<bool> {
        match self {
            Self::OpenDal(operator) => operator.exists(path).await.map_err(map_storage_error),
            Self::GiteeSnippet(remote) => remote.exists(path).await,
            Self::GithubGist(remote) => remote.exists(path).await,
            #[cfg(test)]
            Self::Memory(remote) => remote.exists(path),
        }
    }

    pub(super) async fn read_if_exists(&self, path: &str) -> AppResult<Option<Vec<u8>>> {
        match self {
            Self::OpenDal(operator) => {
                if !operator.exists(path).await.map_err(map_storage_error)? {
                    return Ok(None);
                }
                Ok(Some(
                    operator
                        .read(path)
                        .await
                        .map_err(map_storage_error)?
                        .to_vec(),
                ))
            }
            Self::GiteeSnippet(remote) => remote.read_if_exists(path).await,
            Self::GithubGist(remote) => remote.read_if_exists(path).await,
            #[cfg(test)]
            Self::Memory(remote) => remote.read_if_exists(path),
        }
    }

    pub(super) async fn write(&self, path: &str, content: Vec<u8>) -> AppResult<()> {
        match self {
            Self::OpenDal(operator) => {
                operator
                    .write(path, content)
                    .await
                    .map_err(map_storage_error)?;
                Ok(())
            }
            Self::GiteeSnippet(remote) => remote.write(path, &content).await,
            Self::GithubGist(remote) => remote.write(path, &content).await,
            #[cfg(test)]
            Self::Memory(remote) => remote.write(path, content),
        }
    }

    pub(super) async fn delete(&self, path: &str) -> AppResult<()> {
        match self {
            Self::OpenDal(operator) => operator.delete(path).await.map_err(map_storage_error),
            Self::GiteeSnippet(remote) => remote.delete(path).await,
            Self::GithubGist(remote) => remote.delete(path).await,
            #[cfg(test)]
            Self::Memory(remote) => remote.delete(path),
        }
    }

    pub(super) async fn list_files(&self, path: &str) -> AppResult<Vec<String>> {
        match self {
            Self::OpenDal(operator) => {
                let entries = operator.list(path).await.map_err(map_storage_error)?;
                Ok(entries
                    .into_iter()
                    .filter_map(|entry| {
                        if entry.metadata().mode() == EntryMode::FILE {
                            Some(entry.path().to_string())
                        } else {
                            None
                        }
                    })
                    .collect())
            }
            Self::GiteeSnippet(remote) => remote.list_files(path).await,
            Self::GithubGist(remote) => remote.list_files(path).await,
            #[cfg(test)]
            Self::Memory(remote) => remote.list_files(path),
        }
    }
}

#[cfg(test)]
#[derive(Clone, Default)]
pub(super) struct MemoryRemote {
    files: Arc<StdMutex<HashMap<String, Vec<u8>>>>,
    fail_writes: Arc<StdMutex<Vec<String>>>,
}

#[cfg(test)]
impl MemoryRemote {
    pub(super) fn with_files(files: HashMap<String, Vec<u8>>) -> Self {
        Self {
            files: Arc::new(StdMutex::new(files)),
            fail_writes: Arc::new(StdMutex::new(Vec::new())),
        }
    }

    pub(super) fn fail_next_write_containing(&self, needle: &str) {
        self.fail_writes
            .lock()
            .expect("lock fail writes")
            .push(needle.to_string());
    }

    pub(super) fn file(&self, path: &str) -> Option<Vec<u8>> {
        self.files.lock().expect("lock files").get(path).cloned()
    }

    fn create_dir(&self, _path: &str) -> AppResult<()> {
        Ok(())
    }

    fn exists(&self, path: &str) -> AppResult<bool> {
        Ok(self.files.lock().expect("lock files").contains_key(path))
    }

    fn read_if_exists(&self, path: &str) -> AppResult<Option<Vec<u8>>> {
        Ok(self.files.lock().expect("lock files").get(path).cloned())
    }

    fn write(&self, path: &str, content: Vec<u8>) -> AppResult<()> {
        let mut fail_writes = self.fail_writes.lock().expect("lock fail writes");
        if let Some(index) = fail_writes
            .iter()
            .position(|needle| path.contains(needle.as_str()))
        {
            fail_writes.remove(index);
            return Err(AppError::Io(io::Error::new(
                io::ErrorKind::Other,
                format!("injected memory write failure for {path}"),
            )));
        }
        drop(fail_writes);
        self.files
            .lock()
            .expect("lock files")
            .insert(path.to_string(), content);
        Ok(())
    }

    fn delete(&self, path: &str) -> AppResult<()> {
        self.files.lock().expect("lock files").remove(path);
        Ok(())
    }

    fn list_files(&self, path: &str) -> AppResult<Vec<String>> {
        Ok(self
            .files
            .lock()
            .expect("lock files")
            .keys()
            .filter(|key| key.starts_with(path))
            .cloned()
            .collect())
    }
}

pub(super) fn build_remote(settings: &CloudSyncSettings) -> AppResult<CloudRemote> {
    opendal::install_default();
    match settings.provider.as_str() {
        "webdav" => build_webdav_operator(settings).map(CloudRemote::OpenDal),
        "s3" => build_s3_operator(settings).map(CloudRemote::OpenDal),
        "gitee_snippet" => GiteeSnippetRemote::new(settings).map(CloudRemote::GiteeSnippet),
        "google_drive" => build_google_drive_operator(settings).map(CloudRemote::OpenDal),
        "onedrive" => build_onedrive_operator(settings).map(CloudRemote::OpenDal),
        "aliyun_drive" => build_aliyun_drive_operator(settings).map(CloudRemote::OpenDal),
        "github_gist" => GithubGistRemote::new(settings).map(CloudRemote::GithubGist),
        other => Err(AppError::Config(format!(
            "Unsupported cloud provider '{}'",
            other
        ))),
    }
}

fn build_webdav_operator(settings: &CloudSyncSettings) -> AppResult<Operator> {
    crate::core::webdav::build_opendal_webdav_operator(
        &settings.webdav.endpoint,
        &settings.webdav.root,
        &settings.webdav.username,
        settings.webdav.password.as_deref().unwrap_or(""),
    )
    .map_err(map_storage_error)
}

fn build_s3_operator(settings: &CloudSyncSettings) -> AppResult<Operator> {
    let mut builder = S3::default().bucket(&settings.s3.bucket);
    let endpoint = normalize_storage_endpoint(&settings.s3.endpoint);
    if !endpoint.is_empty() {
        builder = builder.endpoint(&endpoint);
    }
    if !settings.s3.region.trim().is_empty() {
        builder = builder.region(&settings.s3.region);
    }
    if !settings.s3.root.trim().is_empty() {
        builder = builder.root(&settings.s3.root);
    }
    if let Some(access_key_id) = settings
        .s3
        .access_key_id
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        builder = builder.access_key_id(access_key_id);
    }
    if let Some(secret_access_key) = settings
        .s3
        .secret_access_key
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        builder = builder.secret_access_key(secret_access_key);
    }
    if let Some(session_token) = settings
        .s3
        .session_token
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        builder = builder.session_token(session_token);
    }
    if settings.s3.virtual_host_style {
        builder = builder.enable_virtual_host_style();
    }
    finish_opendal_operator(builder)
}

fn build_google_drive_operator(settings: &CloudSyncSettings) -> AppResult<Operator> {
    let mut builder = Gdrive::default();
    if !settings.google_drive.root.trim().is_empty() {
        builder = builder.root(&settings.google_drive.root);
    }
    if let Some(access_token) = settings
        .google_drive
        .access_token
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        builder = builder.access_token(access_token);
    }
    if let Some(refresh_token) = settings
        .google_drive
        .refresh_token
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        builder = builder.refresh_token(refresh_token);
    }
    if let Some(client_id) = settings
        .google_drive
        .client_id
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        builder = builder.client_id(client_id);
    }
    if let Some(client_secret) = settings
        .google_drive
        .client_secret
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        builder = builder.client_secret(client_secret);
    }
    finish_opendal_operator(builder)
}

fn build_onedrive_operator(settings: &CloudSyncSettings) -> AppResult<Operator> {
    let mut builder = Onedrive::default();
    if !settings.onedrive.root.trim().is_empty() {
        builder = builder.root(&settings.onedrive.root);
    }
    if let Some(access_token) = settings
        .onedrive
        .access_token
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        builder = builder.access_token(access_token);
    }
    if let Some(refresh_token) = settings
        .onedrive
        .refresh_token
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        builder = builder.refresh_token(refresh_token);
    }
    if let Some(client_id) = settings
        .onedrive
        .client_id
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        builder = builder.client_id(client_id);
    }
    if let Some(client_secret) = settings
        .onedrive
        .client_secret
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        builder = builder.client_secret(client_secret);
    }
    finish_opendal_operator(builder)
}

fn build_aliyun_drive_operator(settings: &CloudSyncSettings) -> AppResult<Operator> {
    let mut builder = AliyunDrive::default();
    if !settings.aliyun_drive.root.trim().is_empty() {
        builder = builder.root(&settings.aliyun_drive.root);
    }
    if !settings.aliyun_drive.drive_type.trim().is_empty() {
        builder = builder.drive_type(&settings.aliyun_drive.drive_type);
    }
    if let Some(access_token) = settings
        .aliyun_drive
        .access_token
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        builder = builder.access_token(access_token);
    }
    if let Some(refresh_token) = settings
        .aliyun_drive
        .refresh_token
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        builder = builder.refresh_token(refresh_token);
    }
    if let Some(client_id) = settings
        .aliyun_drive
        .client_id
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        builder = builder.client_id(client_id);
    }
    if let Some(client_secret) = settings
        .aliyun_drive
        .client_secret
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        builder = builder.client_secret(client_secret);
    }
    finish_opendal_operator(builder)
}

fn finish_opendal_operator(builder: impl opendal::Builder) -> AppResult<Operator> {
    Ok(Operator::new(builder)
        .map_err(map_storage_error)?
        .layer(storage_timeout_layer())
        .layer(RetryLayer::new().with_max_times(3))
        .layer(TracingLayer::new()))
}

fn storage_timeout_layer() -> TimeoutLayer {
    TimeoutLayer::new()
        .with_timeout(Duration::from_secs(30))
        .with_io_timeout(Duration::from_secs(30))
}

pub(super) async fn ensure_remote_layout(remote: &CloudRemote, base_root: &str) -> AppResult<()> {
    remote
        .create_dir(&remote_path(base_root, super::remote::SYNC_SNAPSHOTS_DIR))
        .await?;
    Ok(())
}

pub(super) fn map_storage_error(error: opendal::Error) -> AppError {
    let raw = error.to_string();
    if let Some(message) = map_webdav_auth_error(&raw) {
        return AppError::Config(message);
    }

    if is_storage_timeout_error(&raw) {
        return AppError::Io(io::Error::new(
            io::ErrorKind::TimedOut,
            format!("cloud storage operation timed out: {raw}"),
        ));
    }

    if error.is_temporary() {
        return AppError::Io(io::Error::new(
            io::ErrorKind::Other,
            format!("temporary cloud storage error: {raw}"),
        ));
    }

    let label = match error.kind() {
        ErrorKind::NotFound => "not found",
        ErrorKind::PermissionDenied => "permission denied",
        ErrorKind::ConfigInvalid => "invalid config",
        ErrorKind::Unsupported => "unsupported",
        ErrorKind::RateLimited => "rate limited",
        _ => "unexpected error",
    };
    AppError::Config(format!("cloud storage {label}: {raw}"))
}

fn is_storage_timeout_error(raw: &str) -> bool {
    let lower = raw.to_ascii_lowercase();
    lower.contains("operation timeout")
        || lower.contains("io timeout")
        || lower.contains("timed out")
        || lower.contains("deadline has elapsed")
}

fn map_webdav_auth_error(raw: &str) -> Option<String> {
    let lower = raw.to_ascii_lowercase();
    let is_webdav = lower.contains("service: webdav");
    let is_unauthorized = lower.contains("status: 401") || lower.contains("401 unauthorized");

    if is_webdav && is_unauthorized {
        return Some(
            "WebDAV authentication failed (401 Unauthorized). Verify the endpoint, username, password or app password, and the authentication methods enabled by your WebDAV provider."
                .to_string(),
        );
    }

    None
}

#[derive(Clone)]
pub(super) struct GiteeSnippetRemote {
    client: reqwest::Client,
    api_endpoint: String,
    gist_id: String,
    access_token: String,
}

#[derive(Debug, serde::Deserialize)]
struct GiteeSnippet {
    #[serde(default)]
    files: HashMap<String, GiteeSnippetFile>,
}

#[derive(Debug, serde::Deserialize)]
struct GiteeSnippetFile {
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    raw_url: Option<String>,
}

impl GiteeSnippetRemote {
    fn new(settings: &CloudSyncSettings) -> AppResult<Self> {
        let api_endpoint = normalize_storage_endpoint(&settings.gitee_snippet.api_endpoint);
        let gist_id = settings.gitee_snippet.gist_id.trim().to_string();
        let access_token = settings
            .gitee_snippet
            .access_token
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| AppError::Config("Gitee access token is required".to_string()))?
            .to_string();

        if api_endpoint.is_empty() {
            return Err(AppError::Config(
                "Gitee API endpoint is required".to_string(),
            ));
        }
        if gist_id.is_empty() {
            return Err(AppError::Config("Gitee snippet ID is required".to_string()));
        }

        let client = reqwest::Client::builder()
            .timeout(GITEE_REMOTE_TIMEOUT)
            .build()
            .map_err(map_gitee_client_error)?;

        Ok(Self {
            client,
            api_endpoint,
            gist_id,
            access_token,
        })
    }

    async fn exists(&self, path: &str) -> AppResult<bool> {
        let snippet = self.fetch_snippet().await?;
        Ok(snippet.files.contains_key(&gitee_remote_filename(path)))
    }

    async fn read_if_exists(&self, path: &str) -> AppResult<Option<Vec<u8>>> {
        let filename = gitee_remote_filename(path);
        if let Ok(content) = self.fetch_raw_filename(&filename).await {
            return decode_gitee_file_content(&content).map(Some);
        }

        let snippet = self.fetch_snippet().await?;
        let Some(file) = snippet.files.get(&filename) else {
            return Ok(None);
        };
        let content = match file
            .content
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            Some(content) => content.to_string(),
            None => self.fetch_raw_file(&filename, file).await?,
        };
        decode_gitee_file_content(&content).map(Some)
    }

    async fn write(&self, path: &str, content: &[u8]) -> AppResult<()> {
        let encoded = BASE64_STANDARD.encode(content);
        self.patch_file(&gitee_remote_filename(path), encoded).await
    }

    async fn delete(&self, path: &str) -> AppResult<()> {
        self.delete_file(&gitee_remote_filename(path)).await
    }

    async fn list_files(&self, path: &str) -> AppResult<Vec<String>> {
        let snippet = self.fetch_snippet().await?;
        let prefix = path.trim_start_matches('/');
        Ok(snippet
            .files
            .keys()
            .filter_map(|filename| gitee_remote_path(filename))
            .filter(|remote_path| remote_path.starts_with(prefix))
            .collect())
    }

    async fn fetch_snippet(&self) -> AppResult<GiteeSnippet> {
        let url = format!("{}/gists/{}", self.api_endpoint, self.gist_id);
        let response = self
            .client
            .get(url)
            .query(&[("access_token", self.access_token.as_str())])
            .send()
            .await
            .map_err(map_gitee_client_error)?;
        decode_gitee_response(response).await
    }

    async fn fetch_raw_file(&self, filename: &str, file: &GiteeSnippetFile) -> AppResult<String> {
        let raw_url = file.raw_url.as_deref().filter(|value| !value.is_empty());
        let url = raw_url.map(str::to_string).unwrap_or_else(|| {
            format!(
                "{}/gists/{}/raw/{}",
                self.api_endpoint, self.gist_id, filename
            )
        });
        let response = self
            .client
            .get(url)
            .query(&[("access_token", self.access_token.as_str())])
            .send()
            .await
            .map_err(map_gitee_client_error)?;
        decode_gitee_text_response(response).await
    }

    async fn fetch_raw_filename(&self, filename: &str) -> AppResult<String> {
        let url = format!(
            "{}/gists/{}/raw/{}",
            self.api_endpoint, self.gist_id, filename
        );
        let response = self
            .client
            .get(url)
            .query(&[("access_token", self.access_token.as_str())])
            .send()
            .await
            .map_err(map_gitee_client_error)?;
        decode_gitee_text_response(response).await
    }

    async fn patch_file(&self, filename: &str, content: String) -> AppResult<()> {
        let file_value = serde_json::json!({ "content": content });
        let mut files = serde_json::Map::new();
        files.insert(filename.to_string(), file_value);
        self.patch_files(files).await
    }

    async fn delete_file(&self, filename: &str) -> AppResult<()> {
        let mut files = serde_json::Map::new();
        files.insert(filename.to_string(), serde_json::Value::Null);
        self.patch_files(files).await
    }

    async fn patch_files(
        &self,
        files: serde_json::Map<String, serde_json::Value>,
    ) -> AppResult<()> {
        let body = gitee_patch_body(self.access_token.as_str(), files);
        let url = format!("{}/gists/{}", self.api_endpoint, self.gist_id);
        let response = self
            .client
            .patch(url)
            .json(&body)
            .send()
            .await
            .map_err(map_gitee_client_error)?;
        let _: serde_json::Value = decode_gitee_response(response).await?;
        Ok(())
    }
}

fn gitee_remote_filename(path: &str) -> String {
    format!(
        "{}{}{}",
        GITEE_REMOTE_FILE_PREFIX,
        URL_SAFE_NO_PAD.encode(path.as_bytes()),
        GITEE_REMOTE_FILE_SUFFIX
    )
}

fn gitee_remote_path(filename: &str) -> Option<String> {
    let encoded = filename
        .strip_prefix(GITEE_REMOTE_FILE_PREFIX)?
        .strip_suffix(GITEE_REMOTE_FILE_SUFFIX)?;
    let bytes = URL_SAFE_NO_PAD.decode(encoded).ok()?;
    String::from_utf8(bytes).ok()
}

fn gitee_patch_body(
    access_token: &str,
    files: serde_json::Map<String, serde_json::Value>,
) -> serde_json::Value {
    serde_json::json!({
        "access_token": access_token,
        "files": files,
    })
}

fn decode_gitee_file_content(content: &str) -> AppResult<Vec<u8>> {
    BASE64_STANDARD
        .decode(content.trim())
        .map_err(|error| AppError::Config(format!("Invalid Gitee snippet content: {error}")))
}

async fn decode_gitee_response<T: serde::de::DeserializeOwned>(
    response: reqwest::Response,
) -> AppResult<T> {
    let text = decode_gitee_text_response(response).await?;
    serde_json::from_str(&text).map_err(Into::into)
}

async fn decode_gitee_text_response(response: reqwest::Response) -> AppResult<String> {
    let status = response.status();
    let text = response.text().await.map_err(map_gitee_client_error)?;
    if !status.is_success() {
        return Err(AppError::Config(format!(
            "Gitee snippet request failed ({status}): {}",
            text.trim()
        )));
    }
    Ok(text)
}

fn map_gitee_client_error(error: reqwest::Error) -> AppError {
    if error.is_timeout() {
        AppError::Io(io::Error::new(
            io::ErrorKind::TimedOut,
            format!("Gitee snippet operation timed out: {error}"),
        ))
    } else {
        AppError::Config(format!("Gitee snippet request failed: {error}"))
    }
}

#[derive(Clone)]
pub(super) struct GithubGistRemote {
    client: reqwest::Client,
    gist_id: String,
    access_token: String,
}

#[derive(Debug, serde::Deserialize)]
struct GithubGist {
    #[serde(default)]
    files: HashMap<String, GithubGistFile>,
}

#[derive(Debug, serde::Deserialize)]
struct GithubGistFile {
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    raw_url: Option<String>,
    #[serde(default)]
    truncated: bool,
}

impl GithubGistRemote {
    fn new(settings: &CloudSyncSettings) -> AppResult<Self> {
        let gist_id = settings.github_gist.gist_id.trim().to_string();
        let access_token = settings
            .github_gist
            .access_token
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| AppError::Config("GitHub Gist access token is required".to_string()))?
            .to_string();

        if gist_id.is_empty() {
            return Err(AppError::Config("GitHub Gist ID is required".to_string()));
        }

        let client = github_client()?;

        Ok(Self {
            client,
            gist_id,
            access_token,
        })
    }

    async fn exists(&self, path: &str) -> AppResult<bool> {
        let gist = self.fetch_gist().await?;
        Ok(gist.files.contains_key(&github_gist_remote_filename(path)))
    }

    async fn read_if_exists(&self, path: &str) -> AppResult<Option<Vec<u8>>> {
        let filename = github_gist_remote_filename(path);
        let gist = self.fetch_gist().await?;
        let Some(file) = gist.files.get(&filename) else {
            return Ok(None);
        };
        let content = if file.truncated {
            self.fetch_raw_file(file).await?
        } else {
            match file
                .content
                .as_deref()
                .filter(|value| !value.trim().is_empty())
            {
                Some(content) => content.to_string(),
                None => self.fetch_raw_file(file).await?,
            }
        };
        decode_github_gist_file_content(&content).map(Some)
    }

    async fn write(&self, path: &str, content: &[u8]) -> AppResult<()> {
        let encoded = BASE64_STANDARD.encode(content);
        self.patch_file(&github_gist_remote_filename(path), encoded)
            .await
    }

    async fn delete(&self, path: &str) -> AppResult<()> {
        self.delete_file(&github_gist_remote_filename(path)).await
    }

    async fn list_files(&self, path: &str) -> AppResult<Vec<String>> {
        let gist = self.fetch_gist().await?;
        let prefix = path.trim_start_matches('/');
        Ok(gist
            .files
            .keys()
            .filter_map(|filename| github_gist_remote_path(filename))
            .filter(|remote_path| remote_path.starts_with(prefix))
            .collect())
    }

    async fn fetch_gist(&self) -> AppResult<GithubGist> {
        let response = self
            .client
            .get(format!("{GITHUB_GIST_API_ENDPOINT}/gists/{}", self.gist_id))
            .bearer_auth(&self.access_token)
            .header("X-GitHub-Api-Version", GITHUB_API_VERSION)
            .send()
            .await
            .map_err(map_github_gist_client_error)?;
        decode_github_gist_response(response).await
    }

    async fn fetch_raw_file(&self, file: &GithubGistFile) -> AppResult<String> {
        let raw_url = file
            .raw_url
            .as_deref()
            .filter(|value| !value.is_empty())
            .ok_or_else(|| AppError::Config("GitHub Gist file raw URL is missing".to_string()))?;
        let response = self
            .client
            .get(raw_url)
            .bearer_auth(&self.access_token)
            .send()
            .await
            .map_err(map_github_gist_client_error)?;
        decode_github_gist_text_response(response).await
    }

    async fn patch_file(&self, filename: &str, content: String) -> AppResult<()> {
        let file_value = serde_json::json!({ "content": content });
        let mut files = serde_json::Map::new();
        files.insert(filename.to_string(), file_value);
        self.patch_files(files).await
    }

    async fn delete_file(&self, filename: &str) -> AppResult<()> {
        let mut files = serde_json::Map::new();
        files.insert(filename.to_string(), serde_json::Value::Null);
        self.patch_files(files).await
    }

    async fn patch_files(
        &self,
        files: serde_json::Map<String, serde_json::Value>,
    ) -> AppResult<()> {
        match self.patch_files_once(&files).await {
            Ok(()) => Ok(()),
            Err(error) if is_github_gist_update_conflict(&error) => {
                tracing::warn!(
                    gist_id = %self.gist_id,
                    "GitHub Gist update conflict; retrying once"
                );
                tokio::time::sleep(GITHUB_GIST_CONFLICT_RETRY_DELAY).await;
                self.patch_files_once(&files).await
            }
            Err(error) => Err(error),
        }
    }

    async fn patch_files_once(
        &self,
        files: &serde_json::Map<String, serde_json::Value>,
    ) -> AppResult<()> {
        let body = serde_json::json!({ "files": files });
        let response = self
            .client
            .patch(format!("{GITHUB_GIST_API_ENDPOINT}/gists/{}", self.gist_id))
            .bearer_auth(&self.access_token)
            .header("X-GitHub-Api-Version", GITHUB_API_VERSION)
            .json(&body)
            .send()
            .await
            .map_err(map_github_gist_client_error)?;
        let _: serde_json::Value = decode_github_gist_response(response).await?;
        Ok(())
    }
}

fn github_client() -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(GITHUB_GIST_REMOTE_TIMEOUT)
        .user_agent("NyaTerm")
        .build()
        .map_err(map_github_gist_client_error)
}

fn github_gist_remote_filename(path: &str) -> String {
    format!(
        "{}{}{}",
        GITEE_REMOTE_FILE_PREFIX,
        URL_SAFE_NO_PAD.encode(path.as_bytes()),
        GITEE_REMOTE_FILE_SUFFIX
    )
}

fn github_gist_remote_path(filename: &str) -> Option<String> {
    let encoded = filename
        .strip_prefix(GITEE_REMOTE_FILE_PREFIX)?
        .strip_suffix(GITEE_REMOTE_FILE_SUFFIX)?;
    let bytes = URL_SAFE_NO_PAD.decode(encoded).ok()?;
    String::from_utf8(bytes).ok()
}

fn decode_github_gist_file_content(content: &str) -> AppResult<Vec<u8>> {
    BASE64_STANDARD
        .decode(content.trim())
        .map_err(|error| AppError::Config(format!("Invalid GitHub Gist content: {error}")))
}

async fn decode_github_gist_response<T: serde::de::DeserializeOwned>(
    response: reqwest::Response,
) -> AppResult<T> {
    let text = decode_github_gist_text_response(response).await?;
    serde_json::from_str(&text).map_err(Into::into)
}

async fn decode_github_gist_text_response(response: reqwest::Response) -> AppResult<String> {
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(map_github_gist_client_error)?;
    if !status.is_success() {
        return Err(AppError::Config(format!(
            "GitHub Gist request failed ({status}): {}",
            text.trim()
        )));
    }
    Ok(text)
}

fn map_github_gist_client_error(error: reqwest::Error) -> AppError {
    if error.is_timeout() {
        AppError::Io(io::Error::new(
            io::ErrorKind::TimedOut,
            format!("GitHub Gist operation timed out: {error}"),
        ))
    } else {
        AppError::Config(format!("GitHub Gist request failed: {error}"))
    }
}

fn is_github_gist_update_conflict(error: &AppError) -> bool {
    matches!(
        error,
        AppError::Config(message)
            if message.contains("GitHub Gist request failed (409 Conflict)")
                && message.contains("Gist cannot be updated")
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use opendal::Error;

    #[test]
    fn webdav_401_error_reports_generic_auth_hint() {
        let message = map_webdav_auth_error(
            "Unexpected (persistent) at stat, context: { service: webdav, response: Parts { status: 401 } } => 401 Unauthorized",
        );

        assert!(message.is_some());
        let message = message.unwrap();
        assert!(message.contains("WebDAV authentication failed"));
        assert!(!message.contains("currently supports"));
    }

    #[test]
    fn cloud_storage_endpoint_accepts_trailing_slashes() {
        assert_eq!(
            normalize_storage_endpoint("https://dav.example.com/remote.php/webdav"),
            "https://dav.example.com/remote.php/webdav"
        );
        assert_eq!(
            normalize_storage_endpoint("https://dav.example.com/remote.php/webdav/"),
            "https://dav.example.com/remote.php/webdav"
        );
        assert_eq!(
            normalize_storage_endpoint(" https://s3.example.com// "),
            "https://s3.example.com"
        );
    }

    #[test]
    fn non_webdav_error_does_not_report_digest_hint() {
        let message = map_webdav_auth_error(
            "Unexpected (persistent) at stat, context: { service: s3, response: Parts { status: 401 } } => 401 Unauthorized",
        );

        assert!(message.is_none());
    }

    #[test]
    fn gitee_remote_filename_is_path_safe() {
        let filename = gitee_remote_filename("nyaterm/sync/latest.redb");

        assert!(filename.starts_with(GITEE_REMOTE_FILE_PREFIX));
        assert!(filename.ends_with(GITEE_REMOTE_FILE_SUFFIX));
        assert!(!filename.contains('/'));
    }

    #[test]
    fn gitee_remote_filename_roundtrips_path() {
        let path = "nyaterm/sync/snapshots/rev.redb.enc";
        let filename = gitee_remote_filename(path);

        assert_eq!(gitee_remote_path(&filename).as_deref(), Some(path));
    }

    #[test]
    fn github_gist_remote_filename_roundtrips_path() {
        let path = "nyaterm/backups/snapshots/rev.redb.enc";
        let filename = github_gist_remote_filename(path);

        assert!(filename.starts_with(GITEE_REMOTE_FILE_PREFIX));
        assert!(filename.ends_with(GITEE_REMOTE_FILE_SUFFIX));
        assert!(!filename.contains('/'));
        assert_eq!(github_gist_remote_path(&filename).as_deref(), Some(path));
    }

    #[test]
    fn github_gist_file_deserializes_truncated_flag() {
        let file: GithubGistFile = serde_json::from_str(
            r#"{"content":"partial","raw_url":"https://gist.githubusercontent.com/raw","truncated":true}"#,
        )
        .expect("deserialize gist file");

        assert!(file.truncated);
    }

    #[test]
    fn github_gist_update_conflict_is_retryable() {
        let error = AppError::Config(
            "GitHub Gist request failed (409 Conflict): {\"message\":\"Gist cannot be updated.\"}"
                .to_string(),
        );

        assert!(is_github_gist_update_conflict(&error));
    }

    #[test]
    fn github_gist_non_conflict_error_is_not_retryable() {
        let error = AppError::Config(
            "GitHub Gist request failed (404 Not Found): {\"message\":\"Not Found\"}".to_string(),
        );

        assert!(!is_github_gist_update_conflict(&error));
    }

    #[test]
    fn gitee_delete_patch_body_marks_file_as_null() {
        let filename = gitee_remote_filename("nyaterm/sync/snapshots/rev.redb.enc");
        let mut files = serde_json::Map::new();
        files.insert(filename.clone(), serde_json::Value::Null);
        let body = gitee_patch_body("token", files);

        assert_eq!(body["access_token"], "token");
        assert!(body["files"][filename].is_null());
    }

    #[test]
    fn timeout_storage_error_maps_to_retryable_io() {
        let mapped = map_storage_error(
            Error::new(ErrorKind::Unexpected, "operation timeout reached").set_temporary(),
        );

        match mapped {
            AppError::Io(error) => assert_eq!(error.kind(), io::ErrorKind::TimedOut),
            other => panic!("expected timeout IO error, got {other:?}"),
        }
    }

    #[test]
    fn temporary_storage_error_maps_to_retryable_io() {
        let mapped = map_storage_error(
            Error::new(ErrorKind::Unexpected, "service temporarily unavailable").set_temporary(),
        );

        assert!(matches!(mapped, AppError::Io(_)));
    }

    #[test]
    fn webdav_401_storage_error_stays_config_error() {
        let mapped = map_storage_error(
            Error::new(
                ErrorKind::Unexpected,
                "Unexpected at stat, context: { service: webdav, response: Parts { status: 401 } } => 401 Unauthorized",
            )
            .set_temporary(),
        );

        match mapped {
            AppError::Config(message) => assert!(message.contains("WebDAV authentication failed")),
            other => panic!("expected config auth error, got {other:?}"),
        }
    }

    #[test]
    fn unsupported_provider_reports_config_error() {
        let mut settings = CloudSyncSettings::default();
        settings.provider = "unknown".to_string();

        let error = match build_remote(&settings) {
            Ok(_) => panic!("unknown provider should fail"),
            Err(error) => error,
        };

        assert!(
            matches!(error, AppError::Config(message) if message.contains("Unsupported cloud provider"))
        );
    }
}
