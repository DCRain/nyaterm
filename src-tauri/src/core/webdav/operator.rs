//! Shared OpenDAL WebDAV operator (Basic + Digest HTTP transport).

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use http::header::{AUTHORIZATION, WWW_AUTHENTICATE};
use http::{HeaderValue, Request, Response};
use md5::{Digest, Md5};
use opendal::layers::{RetryLayer, TimeoutLayer, TracingLayer};
use opendal::services::Webdav;
use opendal::{
    Buffer, Error, ErrorKind, HttpBody, HttpTransport, HttpTransporter, OperationContext, Operator,
};
use rand::RngCore;
use sha2::Sha256;

use crate::utils::url::normalize_storage_endpoint;

/// Build an OpenDAL WebDAV operator with timeout/retry and Digest-capable HTTP.
pub fn build_opendal_webdav_operator(
    endpoint: &str,
    root: &str,
    username: &str,
    password: &str,
) -> Result<Operator, opendal::Error> {
    opendal::install_default();
    let endpoint = normalize_storage_endpoint(endpoint);
    let mut builder = Webdav::default().endpoint(&endpoint);
    if !root.trim().is_empty() {
        builder = builder.root(root);
    }
    if !username.trim().is_empty() {
        builder = builder.username(username);
    }
    if !password.is_empty() {
        builder = builder.password(password);
    }
    let digest_client = WebdavDigestHttpClient::new(username.to_string(), password.to_string());
    let transport = HttpTransporter::new(digest_client);
    Ok(Operator::new(builder)?
        .with_context(OperationContext::new().with_http_transport(transport))
        .layer(
            TimeoutLayer::new()
                .with_timeout(Duration::from_secs(60))
                .with_io_timeout(Duration::from_secs(60)),
        )
        .layer(RetryLayer::new().with_max_times(3))
        .layer(TracingLayer::new()))
}

#[derive(Clone)]
struct WebdavDigestHttpClient {
    inner: HttpTransporter,
    username: Arc<str>,
    password: Arc<str>,
}

impl WebdavDigestHttpClient {
    fn new(username: String, password: String) -> Self {
        Self {
            inner: HttpTransporter::default(),
            username: Arc::from(username),
            password: Arc::from(password),
        }
    }
}

impl HttpTransport for WebdavDigestHttpClient {
    async fn fetch(&self, req: Request<Buffer>) -> opendal::Result<Response<HttpBody>> {
        let original = clone_request(&req)?;
        let has_credentials = !self.username.is_empty() || !self.password.is_empty();
        let resp = if has_credentials {
            let basic = build_basic_authorization(self.username.as_ref(), self.password.as_ref())?;
            fetch_with_authorization(&self.inner, req, &basic).await?
        } else {
            self.inner.fetch(req).await?
        };
        if resp.status() != http::StatusCode::UNAUTHORIZED {
            return Ok(resp);
        }
        if !has_credentials {
            return Err(unauthorized_webdav_error());
        }

        if let Some(challenge) = digest_challenge(resp.headers()) {
            let auth = build_digest_authorization(
                &challenge,
                self.username.as_ref(),
                self.password.as_ref(),
                original.method().as_str(),
                original
                    .uri()
                    .path_and_query()
                    .map_or("/", |path| path.as_str()),
                &random_cnonce(),
                "00000001",
            )?;
            let retry_resp =
                fetch_with_authorization(&self.inner, clone_request(&original)?, &auth).await?;
            if retry_resp.status() != http::StatusCode::UNAUTHORIZED {
                return Ok(retry_resp);
            }
        }

        Err(unauthorized_webdav_error())
    }
}

async fn fetch_with_authorization(
    inner: &HttpTransporter,
    mut req: Request<Buffer>,
    authorization: &str,
) -> opendal::Result<Response<HttpBody>> {
    let header = HeaderValue::from_str(authorization).map_err(|err| {
        Error::new(
            ErrorKind::Unexpected,
            "build WebDAV authorization header",
        )
        .set_source(err)
    })?;
    req.headers_mut().insert(AUTHORIZATION, header);
    inner.fetch(req).await
}

fn build_basic_authorization(username: &str, password: &str) -> opendal::Result<String> {
    Ok(format!(
        "Basic {}",
        BASE64_STANDARD.encode(format!("{username}:{password}"))
    ))
}

fn unauthorized_webdav_error() -> Error {
    Error::new(
        ErrorKind::PermissionDenied,
        "WebDAV authentication failed (401 Unauthorized). Verify the endpoint, username, password or app password, and the authentication methods enabled by your WebDAV provider.",
    )
}

fn clone_request(req: &Request<Buffer>) -> opendal::Result<Request<Buffer>> {
    let mut builder = Request::builder()
        .method(req.method().clone())
        .uri(req.uri().clone())
        .version(req.version());
    *builder.headers_mut().expect("request builder has headers") = req.headers().clone();
    builder.body(req.body().clone()).map_err(|err| {
        Error::new(ErrorKind::Unexpected, "clone WebDAV Digest retry request").set_source(err)
    })
}

fn digest_challenge(headers: &http::HeaderMap) -> Option<String> {
    headers
        .get_all(WWW_AUTHENTICATE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .find_map(|value| {
            value
                .split_once("Digest")
                .map(|(_, challenge)| challenge.trim().to_string())
        })
        .filter(|value| !value.is_empty())
}

pub(crate) fn build_digest_authorization(
    challenge: &str,
    username: &str,
    password: &str,
    method: &str,
    uri: &str,
    cnonce: &str,
    nc: &str,
) -> opendal::Result<String> {
    let params = parse_digest_challenge(challenge);
    let realm = required_digest_param(&params, "realm")?;
    let nonce = required_digest_param(&params, "nonce")?;
    let qop = choose_digest_qop(params.get("qop").map(String::as_str))?;
    let algorithm = params
        .get("algorithm")
        .map_or("MD5", String::as_str)
        .trim()
        .to_ascii_uppercase();

    let ha1 = digest_hash(&algorithm, &format!("{username}:{realm}:{password}"))?;
    let ha2 = digest_hash(&algorithm, &format!("{method}:{uri}"))?;
    let response = digest_hash(
        &algorithm,
        &format!("{ha1}:{nonce}:{nc}:{cnonce}:{qop}:{ha2}"),
    )?;

    let opaque = params
        .get("opaque")
        .map(|value| format!(", opaque=\"{}\"", escape_digest_value(value)))
        .unwrap_or_default();

    Ok(format!(
        "Digest username=\"{}\", realm=\"{}\", nonce=\"{}\", uri=\"{}\", algorithm={}, response=\"{}\", qop={}, nc={}, cnonce=\"{}\"{}",
        escape_digest_value(username),
        escape_digest_value(realm),
        escape_digest_value(nonce),
        escape_digest_value(uri),
        algorithm,
        response,
        qop,
        nc,
        escape_digest_value(cnonce),
        opaque
    ))
}

pub(crate) fn parse_digest_challenge(challenge: &str) -> HashMap<String, String> {
    let mut values = HashMap::new();
    let mut rest = challenge.trim();
    while !rest.is_empty() {
        rest = rest.trim_start_matches(|ch: char| ch == ',' || ch.is_whitespace());
        let Some((key, after_key)) = rest.split_once('=') else {
            break;
        };
        let key = key.trim().to_ascii_lowercase();
        let after_key = after_key.trim_start();
        let (value, next) = if let Some(quoted) = after_key.strip_prefix('"') {
            parse_quoted_digest_value(quoted)
        } else {
            let split_at = after_key.find(',').unwrap_or(after_key.len());
            (
                after_key[..split_at].trim().to_string(),
                after_key[split_at..].trim_start_matches(','),
            )
        };
        if !key.is_empty() {
            values.insert(key, value);
        }
        rest = next;
    }
    values
}

fn parse_quoted_digest_value(input: &str) -> (String, &str) {
    let mut value = String::new();
    let mut escaped = false;
    for (index, ch) in input.char_indices() {
        if escaped {
            value.push(ch);
            escaped = false;
            continue;
        }
        match ch {
            '\\' => escaped = true,
            '"' => return (value, &input[index + ch.len_utf8()..]),
            _ => value.push(ch),
        }
    }
    (value, "")
}

fn required_digest_param<'a>(
    params: &'a HashMap<String, String>,
    key: &str,
) -> opendal::Result<&'a str> {
    params
        .get(key)
        .map(String::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            Error::new(
                ErrorKind::ConfigInvalid,
                format!("WebDAV Digest authentication challenge is missing {key}"),
            )
        })
}

fn choose_digest_qop(qop: Option<&str>) -> opendal::Result<&'static str> {
    let Some(qop) = qop else {
        return Err(Error::new(
            ErrorKind::Unsupported,
            "WebDAV Digest authentication without qop=auth is not supported",
        ));
    };
    if qop
        .split(',')
        .map(|value| value.trim().trim_matches('"').to_ascii_lowercase())
        .any(|value| value == "auth")
    {
        Ok("auth")
    } else {
        Err(Error::new(
            ErrorKind::Unsupported,
            "WebDAV Digest authentication requires qop=auth",
        ))
    }
}

fn digest_hash(algorithm: &str, value: &str) -> opendal::Result<String> {
    match algorithm {
        "MD5" => {
            let mut hasher = Md5::new();
            hasher.update(value.as_bytes());
            Ok(hex::encode(hasher.finalize()))
        }
        "SHA-256" | "SHA256" => {
            let mut hasher = Sha256::new();
            hasher.update(value.as_bytes());
            Ok(hex::encode(hasher.finalize()))
        }
        other => Err(Error::new(
            ErrorKind::Unsupported,
            format!("WebDAV Digest algorithm {other} is not supported"),
        )),
    }
}

fn random_cnonce() -> String {
    let mut bytes = [0_u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

fn escape_digest_value(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn digest_challenge_parser_handles_quoted_commas() {
        let parsed = parse_digest_challenge(
            r#"realm="Nya,Term", nonce="abc", algorithm=MD5, qop="auth,auth-int", opaque="xyz""#,
        );

        assert_eq!(parsed.get("realm").map(String::as_str), Some("Nya,Term"));
        assert_eq!(parsed.get("nonce").map(String::as_str), Some("abc"));
        assert_eq!(parsed.get("qop").map(String::as_str), Some("auth,auth-int"));
    }

    #[test]
    fn digest_authorization_supports_md5_qop_auth() {
        let header = build_digest_authorization(
            r#"realm="testrealm@host.com", qop="auth", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41""#,
            "Mufasa",
            "Circle Of Life",
            "GET",
            "/dir/index.html",
            "0a4f113b",
            "00000001",
        )
        .expect("digest auth header");

        assert!(header.contains("Digest username=\"Mufasa\""));
        assert!(header.contains("qop=auth"));
        assert!(header.contains("response=\"6629fae49393a05397450978507c4ef1\""));
    }

    #[test]
    fn digest_authorization_rejects_unsupported_qop() {
        let error = build_digest_authorization(
            r#"realm="test", qop="auth-int", nonce="abc""#,
            "user",
            "pass",
            "GET",
            "/",
            "cnonce",
            "00000001",
        )
        .expect_err("auth-int is unsupported");

        assert_eq!(error.kind(), ErrorKind::Unsupported);
    }

    #[test]
    fn basic_authorization_encodes_user_and_password() {
        assert_eq!(
            build_basic_authorization("admin", "123456").expect("basic header"),
            "Basic YWRtaW46MTIzNDU2"
        );
    }

    #[test]
    fn unauthorized_webdav_error_is_permission_denied() {
        assert_eq!(
            unauthorized_webdav_error().kind(),
            ErrorKind::PermissionDenied
        );
    }
}
