//! Claude Code usage provider.
//!
//! Reads the OAuth token Claude Code stores in `~/.claude/.credentials.json`.
//! The token is read-only here: never written, refreshed, logged or sent
//! anywhere except the usage endpoint.

use std::path::PathBuf;
use std::time::Duration;

use chrono::{DateTime, Utc};
use serde_json::Value;

use super::{BoxFuture, Detection, Fidelity, ProviderError, UsageProvider, UsageSnapshot, UsageWindow};

const USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";
const BETA_HEADER: &str = "oauth-2025-04-20";

/// Response keys we know, in display order.
const WINDOWS: [(&str, &str); 4] = [
    ("five_hour", "5-hour"),
    ("seven_day", "7-day"),
    ("seven_day_opus", "7-day Opus"),
    ("seven_day_sonnet", "7-day Sonnet"),
];

pub struct ClaudeProvider;

impl ClaudeProvider {
    pub fn new() -> Self {
        Self
    }
}

impl UsageProvider for ClaudeProvider {
    fn id(&self) -> &'static str {
        "claude"
    }

    fn display_name(&self) -> &'static str {
        "Claude Code"
    }

    fn sign_in_hint(&self) -> &'static str {
        "run `claude` in a terminal and type /login"
    }

    fn detect(&self) -> Detection {
        match read_oauth() {
            Ok(oauth) => {
                let plan = oauth
                    .get("subscriptionType")
                    .and_then(Value::as_str)
                    .map(|p| format!(" ({} plan)", capitalise(p)))
                    .unwrap_or_default();
                Detection {
                    found: read_token().is_ok(),
                    detail: Some(if read_token().is_ok() {
                        format!("Claude Code sign-in found{plan}")
                    } else {
                        "Claude Code's sign-in has expired. Run `claude` once to refresh it.".into()
                    }),
                }
            }
            Err(_) => Detection { found: false, detail: None },
        }
    }

    fn min_interval(&self) -> Duration {
        Duration::from_secs(60)
    }

    fn fetch(&self) -> BoxFuture<'_, Result<UsageSnapshot, ProviderError>> {
        Box::pin(async move {
            let request = super::request(USAGE_URL)?;
            // Read at the moment of the request; wiped when this scope ends.
            let token = read_token()?;

            let response = request
                .bearer_auth(token.expose())
                .header("anthropic-beta", BETA_HEADER)
                .header(reqwest::header::ACCEPT, "application/json")
                .send()
                .await
                .map_err(|e| ProviderError::Network(e.without_url().to_string()))?;

            let status = response.status();
            if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
                return Err(ProviderError::NeedsAuth);
            }
            if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
                let retry_after = response
                    .headers()
                    .get(reqwest::header::RETRY_AFTER)
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| v.trim().parse::<u64>().ok())
                    .map(Duration::from_secs);
                return Err(ProviderError::RateLimited { retry_after });
            }
            if !status.is_success() {
                return Err(ProviderError::Network(format!("HTTP {}", status.as_u16())));
            }

            let body: Value = response
                .json()
                .await
                .map_err(|e| ProviderError::Parse(e.without_url().to_string()))?;
            parse_usage(&body)
        })
    }
}

fn credentials_path() -> Option<PathBuf> {
    // Claude Code honours CLAUDE_CONFIG_DIR; default is ~/.claude.
    if let Some(dir) = std::env::var_os("CLAUDE_CONFIG_DIR") {
        return Some(PathBuf::from(dir).join(".credentials.json"));
    }
    dirs::home_dir().map(|h| h.join(".claude").join(".credentials.json"))
}

fn capitalise(s: &str) -> String {
    let mut c = s.chars();
    c.next().map(|f| f.to_uppercase().chain(c).collect()).unwrap_or_default()
}

fn read_oauth() -> Result<Value, ProviderError> {
    let path = credentials_path().ok_or(ProviderError::NeedsAuth)?;
    let raw = super::read_secret_file(&path)?;
    let json: Value = serde_json::from_str(raw.expose()).map_err(|_| ProviderError::NeedsAuth)?;
    json.get("claudeAiOauth").cloned().ok_or(ProviderError::NeedsAuth)
}

fn read_token() -> Result<crate::secret::Secret, ProviderError> {
    let oauth = read_oauth()?;
    let token = oauth
        .get("accessToken")
        .and_then(Value::as_str)
        .filter(|t| !t.is_empty())
        .ok_or(ProviderError::NeedsAuth)?;

    // expiresAt is epoch milliseconds. An expired token means Claude Code
    // hasn't refreshed it; we never refresh it ourselves.
    if let Some(expires) = oauth.get("expiresAt").and_then(Value::as_i64)
        && expires <= Utc::now().timestamp_millis()
    {
        return Err(ProviderError::NeedsAuth);
    }
    Ok(crate::secret::Secret::new(token.to_owned()))
}

/// Defensive parse: unknown or null fields are skipped, never fatal.
fn parse_usage(body: &Value) -> Result<UsageSnapshot, ProviderError> {
    let mut windows = Vec::new();
    for (key, label) in WINDOWS {
        if let Some(w) = parse_window(body.get(key), key, label) {
            windows.push(w);
        }
    }
    if let Some(w) = parse_window(body.get("extra_usage"), "extra_usage", "Extra usage") {
        windows.push(w);
    }
    if windows.is_empty() {
        return Err(ProviderError::Parse("no usage windows in response".into()));
    }
    Ok(UsageSnapshot {
        windows,
        fetched_at: Utc::now(),
        fidelity: Fidelity::Derived,
        plan: None,
    })
}

fn parse_window(value: Option<&Value>, key: &str, label: &str) -> Option<UsageWindow> {
    let obj = value?.as_object()?;
    let used = obj.get("utilization")?.as_f64()?;
    if !used.is_finite() {
        return None;
    }
    let resets_at = obj
        .get("resets_at")
        .and_then(Value::as_str)
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|t| t.with_timezone(&Utc));
    Some(UsageWindow {
        key: key.into(),
        label: label.into(),
        used_percent: used.clamp(0.0, 100.0),
        resets_at,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_known_and_skips_null_windows() {
        let body = serde_json::json!({
            "five_hour": { "utilization": 42.5, "resets_at": "2026-11-13T18:00:00Z" },
            "seven_day": { "utilization": 63, "resets_at": null },
            "seven_day_opus": null,
            "something_new": { "utilization": 5 }
        });
        let snap = parse_usage(&body).unwrap();
        assert_eq!(snap.windows.len(), 2);
        assert_eq!(snap.windows[0].label, "5-hour");
        assert!(snap.windows[0].resets_at.is_some());
        assert!((snap.windows[1].used_percent - 63.0).abs() < f64::EPSILON);
        assert!(snap.windows[1].resets_at.is_none());
    }

    #[test]
    fn empty_response_is_a_parse_error() {
        assert!(matches!(
            parse_usage(&serde_json::json!({})),
            Err(ProviderError::Parse(_))
        ));
    }
}
