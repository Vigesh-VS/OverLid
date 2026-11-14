//! The per-install secret the Claude Code hooks send in `X-Overlid-Token`.
//!
//! 32 random bytes from the system RNG (BCryptGenRandom), hex-encoded and
//! kept in Windows Credential Manager under the current user, never in the
//! settings file or the log. Rotating it rewrites the installed hooks.

use windows::Win32::Foundation::ERROR_NOT_FOUND;
use windows::Win32::Security::Credentials::{
    CRED_FLAGS, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC, CREDENTIALW, CredDeleteW, CredFree, CredReadW,
    CredWriteW,
};
use windows::Win32::Security::Cryptography::{BCRYPT_USE_SYSTEM_PREFERRED_RNG, BCryptGenRandom};
use windows::core::{HSTRING, PWSTR};

use crate::secret::Secret;

const TARGET: &str = "Overlid/hook-token";
/// Hex characters in a token (32 bytes).
pub const TOKEN_LEN: usize = 64;

fn random_hex() -> anyhow::Result<Secret> {
    let mut bytes = [0u8; 32];
    // SAFETY: a valid, writable buffer; no algorithm handle with this flag.
    unsafe { BCryptGenRandom(None, &mut bytes, BCRYPT_USE_SYSTEM_PREFERRED_RNG) }.ok()?;
    let mut hex = String::with_capacity(TOKEN_LEN);
    for b in bytes {
        hex.push_str(&format!("{b:02x}"));
    }
    bytes.fill(0);
    Ok(Secret::new(hex))
}

fn read() -> anyhow::Result<Option<Secret>> {
    let target = HSTRING::from(TARGET);
    let mut cred: *mut CREDENTIALW = std::ptr::null_mut();
    // SAFETY: `cred` receives a buffer we free with CredFree below.
    if let Err(e) = unsafe { CredReadW(&target, CRED_TYPE_GENERIC, None, &mut cred) } {
        if e.code() == ERROR_NOT_FOUND.to_hresult() {
            return Ok(None);
        }
        return Err(e.into());
    }
    // SAFETY: CredReadW succeeded, so `cred` points at a valid CREDENTIALW
    // whose blob is `CredentialBlobSize` bytes long.
    let value = unsafe {
        let c = &*cred;
        let blob = std::slice::from_raw_parts(c.CredentialBlob, c.CredentialBlobSize as usize);
        let value = String::from_utf8(blob.to_vec()).ok();
        CredFree(cred.cast());
        value
    };
    Ok(value
        .filter(|v| v.len() == TOKEN_LEN && v.bytes().all(|b| b.is_ascii_hexdigit()))
        .map(Secret::new))
}

fn write(token: &Secret) -> anyhow::Result<()> {
    let mut target: Vec<u16> = TARGET.encode_utf16().chain(Some(0)).collect();
    let mut user: Vec<u16> = "overlid".encode_utf16().chain(Some(0)).collect();
    let mut blob = token.expose().as_bytes().to_vec();
    let cred = CREDENTIALW {
        Flags: CRED_FLAGS(0),
        Type: CRED_TYPE_GENERIC,
        TargetName: PWSTR(target.as_mut_ptr()),
        CredentialBlobSize: u32::try_from(blob.len())?,
        CredentialBlob: blob.as_mut_ptr(),
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        UserName: PWSTR(user.as_mut_ptr()),
        ..Default::default()
    };
    // SAFETY: every pointer in `cred` outlives the call.
    let result = unsafe { CredWriteW(&cred, 0) };
    blob.fill(0);
    result.map_err(Into::into)
}

/// The stored token, created on first use.
pub fn get_or_create() -> anyhow::Result<Secret> {
    if let Some(token) = read()? {
        return Ok(token);
    }
    rotate()
}

/// Replace the token with a fresh one.
pub fn rotate() -> anyhow::Result<Secret> {
    let token = random_hex()?;
    write(&token)?;
    log::info!("created a new hook token");
    Ok(token)
}

/// Remove the token (used by "Clear all Overlid data").
pub fn delete() {
    // SAFETY: plain call with a valid target string.
    if let Err(e) = unsafe { CredDeleteW(&HSTRING::from(TARGET), CRED_TYPE_GENERIC, None) }
        && e.code() != ERROR_NOT_FOUND.to_hresult()
    {
        log::warn!("couldn't delete the hook token: {e}");
    }
}

/// Compare without leaking how many leading bytes matched.
pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let diff = a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y));
    std::hint::black_box(diff) == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn random_tokens_are_hex_and_unique() {
        let (a, b) = (random_hex().unwrap(), random_hex().unwrap());
        assert_eq!(a.expose().len(), TOKEN_LEN);
        assert!(a.expose().bytes().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a.expose(), b.expose());
    }

    #[test]
    fn compares_exactly() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"abcd"));
        assert!(!constant_time_eq(b"", b"a"));
    }
}
