//! Per-note / per-folder encryption using a user-supplied password.
//!
//! Key derivation: Argon2id(password, salt) → AES-256 key
//! Content cipher: AES-256-GCM
//! Folder verifier: Argon2id PHC string (password hash)

use crate::config::NoteEncryptionMeta;
use crate::error::{AppError, AppResult};
use aes_gcm::aead::{Aead, OsRng};
use aes_gcm::{AeadCore, Aes256Gcm, Key, KeyInit, Nonce};
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::{Argon2, Algorithm, Params, Version};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use rand::RngCore;

const SALT_LEN: usize = 16;
const NOTE_KDF_MEMORY_KIB: u32 = 19_456;
const NOTE_KDF_ITERATIONS: u32 = 2;
const NOTE_KDF_PARALLELISM: u32 = 1;

fn argon2() -> AppResult<Argon2<'static>> {
    let params = Params::new(NOTE_KDF_MEMORY_KIB, NOTE_KDF_ITERATIONS, NOTE_KDF_PARALLELISM, Some(32))
        .map_err(|err| AppError::Crypto(format!("invalid argon2 params: {err}")))?;
    Ok(Argon2::new(Algorithm::Argon2id, Version::V0x13, params))
}

fn generate_salt() -> [u8; SALT_LEN] {
    let mut salt = [0u8; SALT_LEN];
    OsRng.fill_bytes(&mut salt);
    salt
}

fn derive_key(password: &str, salt: &[u8]) -> AppResult<[u8; 32]> {
    if password.is_empty() {
        return Err(AppError::Crypto("password must not be empty".into()));
    }
    let argon = argon2()?;
    let mut key = [0u8; 32];
    argon
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|err| AppError::Crypto(format!("key derivation failed: {err}")))?;
    Ok(key)
}

/// Encrypt markdown plaintext with a user password. Generates a fresh salt and nonce.
pub fn encrypt_markdown(
    plaintext: &str,
    password: &str,
    root_folder_id: Option<String>,
) -> AppResult<NoteEncryptionMeta> {
    let salt = generate_salt();
    let key_bytes = derive_key(password, &salt)?;
    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, plaintext.as_bytes())
        .map_err(|err| AppError::Crypto(format!("note encrypt failed: {err}")))?;
    Ok(NoteEncryptionMeta {
        root_folder_id,
        salt: B64.encode(salt),
        nonce: B64.encode(nonce),
        ciphertext: B64.encode(ciphertext),
    })
}

/// Decrypt markdown ciphertext with a user password.
pub fn decrypt_markdown(meta: &NoteEncryptionMeta, password: &str) -> AppResult<String> {
    let salt = B64
        .decode(&meta.salt)
        .map_err(|err| AppError::Crypto(format!("invalid salt: {err}")))?;
    let nonce_bytes = B64
        .decode(&meta.nonce)
        .map_err(|err| AppError::Crypto(format!("invalid nonce: {err}")))?;
    let ciphertext = B64
        .decode(&meta.ciphertext)
        .map_err(|err| AppError::Crypto(format!("invalid ciphertext: {err}")))?;
    if nonce_bytes.len() != 12 {
        return Err(AppError::Crypto("invalid nonce length".into()));
    }
    let key_bytes = derive_key(password, &salt)?;
    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let plaintext = cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|_| AppError::Crypto("wrong_password".into()))?;
    String::from_utf8(plaintext)
        .map_err(|err| AppError::Crypto(format!("decrypted note is not valid UTF-8: {err}")))
}

/// Create a password verifier (PHC string) for an encrypted folder root.
pub fn create_folder_verifier(password: &str) -> AppResult<(String, String)> {
    if password.is_empty() {
        return Err(AppError::Crypto("password must not be empty".into()));
    }
    let salt = SaltString::generate(&mut OsRng);
    let argon = argon2()?;
    let hash = argon
        .hash_password(password.as_bytes(), &salt)
        .map_err(|err| AppError::Crypto(format!("folder verifier failed: {err}")))?
        .to_string();
    Ok((salt.to_string(), hash))
}

/// Verify a password against a stored folder verifier.
pub fn verify_folder_password(password: &str, verifier: &str) -> AppResult<bool> {
    if password.is_empty() {
        return Ok(false);
    }
    let parsed = PasswordHash::new(verifier)
        .map_err(|err| AppError::Crypto(format!("invalid folder verifier: {err}")))?;
    let argon = argon2()?;
    Ok(argon.verify_password(password.as_bytes(), &parsed).is_ok())
}

/// Re-encrypt existing ciphertext under a new password, optionally rebinding `root_folder_id`.
pub fn reencrypt_markdown(
    meta: &NoteEncryptionMeta,
    old_password: &str,
    new_password: &str,
    new_root_folder_id: Option<String>,
) -> AppResult<NoteEncryptionMeta> {
    let plaintext = decrypt_markdown(meta, old_password)?;
    encrypt_markdown(&plaintext, new_password, new_root_folder_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypt_decrypt_roundtrip() {
        let meta = encrypt_markdown("# hello\n\nsecret", "pass-123", None).unwrap();
        let plain = decrypt_markdown(&meta, "pass-123").unwrap();
        assert_eq!(plain, "# hello\n\nsecret");
        assert!(meta.root_folder_id.is_none());
        assert!(!meta.salt.is_empty());
        assert!(!meta.nonce.is_empty());
        assert!(!meta.ciphertext.is_empty());
    }

    #[test]
    fn wrong_password_fails() {
        let meta = encrypt_markdown("secret", "correct", Some("folder-1".into())).unwrap();
        assert!(decrypt_markdown(&meta, "wrong").is_err());
    }

    #[test]
    fn folder_verifier_roundtrip() {
        let (_salt, verifier) = create_folder_verifier("folder-pass").unwrap();
        assert!(verify_folder_password("folder-pass", &verifier).unwrap());
        assert!(!verify_folder_password("other", &verifier).unwrap());
    }

    #[test]
    fn reencrypt_preserves_plaintext() {
        let meta = encrypt_markdown("body", "old", None).unwrap();
        let next = reencrypt_markdown(&meta, "old", "new", None).unwrap();
        assert_eq!(decrypt_markdown(&next, "new").unwrap(), "body");
        assert!(decrypt_markdown(&next, "old").is_err());
        assert!(next.root_folder_id.is_none());

        let bound = reencrypt_markdown(&meta, "old", "new", Some("folder-1".into())).unwrap();
        assert_eq!(bound.root_folder_id.as_deref(), Some("folder-1"));
    }

    #[test]
    fn empty_password_rejected() {
        assert!(encrypt_markdown("x", "", None).is_err());
        assert!(create_folder_verifier("").is_err());
    }
}
