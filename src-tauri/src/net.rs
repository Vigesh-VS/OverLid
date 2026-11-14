//! The only way Overlid talks to the network: one client with an outbound
//! allowlist. HTTPS only, rustls, no redirects (a redirect could carry an
//! auth header somewhere else), no proxies from environment variables, short
//! timeouts. There is no telemetry.

use std::sync::OnceLock;
use std::time::Duration;

/// Every host Overlid may contact. Each provider's token goes only to its own.
pub const ALLOWED_HOSTS: [&str; 3] = [
    "api.anthropic.com", // Claude Code usage
    "chatgpt.com",       // Codex usage
    "api.github.com",    // Copilot usage
];

fn client() -> Option<&'static reqwest::Client> {
    static CLIENT: OnceLock<Option<reqwest::Client>> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .https_only(true)
                .redirect(reqwest::redirect::Policy::none())
                .no_proxy()
                .connect_timeout(Duration::from_secs(5))
                .timeout(Duration::from_secs(10))
                .user_agent(concat!("overlid/", env!("CARGO_PKG_VERSION")))
                .build()
                .map_err(|e| log::error!("http client init failed: {e}"))
                .ok()
        })
        .as_ref()
}

#[derive(Debug, thiserror::Error)]
pub enum NetError {
    #[error("network unavailable")]
    Unavailable,
    #[error("blocked request to a host that isn't allowed")]
    Blocked,
}

/// Is `url` an HTTPS URL on an allowlisted host?
pub fn allowed(url: &str) -> bool {
    reqwest::Url::parse(url).is_ok_and(|u| {
        u.scheme() == "https" && u.port().is_none() && u.host_str().is_some_and(|h| ALLOWED_HOSTS.contains(&h))
    })
}

/// A GET request to an allowlisted URL. Anything else is refused and logged.
pub fn get(url: &str) -> Result<reqwest::RequestBuilder, NetError> {
    if !allowed(url) {
        log::warn!("refused outbound request to a host that isn't allowlisted");
        return Err(NetError::Blocked);
    }
    Ok(client().ok_or(NetError::Unavailable)?.get(url))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_https_allowlisted_hosts() {
        assert!(allowed("https://api.anthropic.com/api/oauth/usage"));
        assert!(allowed("https://chatgpt.com/backend-api/wham/usage"));
        assert!(allowed("https://api.github.com/copilot_internal/user"));
        assert!(!allowed("http://api.anthropic.com/api/oauth/usage"), "plain http");
        assert!(!allowed("https://evil.example.com/"), "other host");
        assert!(!allowed("https://api.anthropic.com.evil.com/"), "suffix trick");
        assert!(!allowed("https://api.anthropic.com:8443/"), "odd port");
        assert!(!allowed("file:///C:/Windows"));
        assert!(!allowed("not a url"));
    }
}
