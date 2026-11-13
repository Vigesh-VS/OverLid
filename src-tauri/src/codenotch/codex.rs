//! OpenAI Codex CLI usage provider.
//!
//! Reads the ChatGPT sign-in Codex saved in `~/.codex/auth.json` (or
//! `$CODEX_HOME`), read-only, and asks the ChatGPT backend's usage endpoint
//! for the 5-hour and weekly rate-limit windows. Unofficial: labelled
//! "derived", with stale / needs-auth states instead of guesses.

use std::path::PathBuf;
use std::time::Duration;

use chrono::{Duration as ChronoDuration, Utc};
use serde_json::Value;

use super::{BoxFuture, Detection, Fidelity, ProviderError, UsageProvider, UsageSnapshot, UsageWindow, parse_time};

const USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/usage";

pub struct CodexProvider;

impl CodexProvider {
    pub fn new() -> Self {
        Self
    }
}

struct Auth {
    token: String,
    account_id: Option<String>,
}

fn auth_path() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("CODEX_HOME") {
        return Some(PathBuf::from(dir).join("auth.json"));
    }
    dirs::home_dir().map(|h| h.join(".codex").join("auth.json"))
}

fn read_auth() -> Result<Auth, ProviderError> {
    let path = auth_path().ok_or(ProviderError::NeedsAuth)?;
    let raw = std::fs::read_to_string(path).map_err(|_| ProviderError::NeedsAuth)?;
    let json: Value = serde_json::from_str(&raw).map_err(|_| ProviderError::NeedsAuth)?;
    let tokens = json.get("tokens").ok_or(ProviderError::NeedsAuth)?;
    let token = tokens
        .get("access_token")
        .and_then(Value::as_str)
        .filter(|t| !t.is_empty())
        .ok_or(ProviderError::NeedsAuth)?
        .to_owned();
    let account_id = tokens
        .get("account_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned);
    Ok(Auth { token, account_id })
}

impl UsageProvider for CodexProvider {
    fn id(&self) -> &'static str {
        "codex"
    }

    fn display_name(&self) -> &'static str {
        "Codex"
    }

    fn sign_in_hint(&self) -> &'static str {
        "run `codex login` in a terminal and sign in with ChatGPT"
    }

    fn detect(&self) -> Detection {
        match read_auth() {
            Ok(_) => Detection {
                found: true,
                detail: Some("Codex CLI ChatGPT sign-in found".into()),
            },
            Err(_) => {
                // An API-key-only setup has no plan limits to show.
                let api_key_only = auth_path()
                    .and_then(|p| std::fs::read_to_string(p).ok())
                    .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
                    .is_some_and(|j| j.get("OPENAI_API_KEY").and_then(Value::as_str).is_some_and(|k| !k.is_empty()));
                Detection {
                    found: false,
                    detail: api_key_only.then(|| {
                        "Codex is signed in with an API key, which has no plan limits. Sign in with ChatGPT to see usage.".into()
                    }),
                }
            }
        }
    }

    fn min_interval(&self) -> Duration {
        Duration::from_secs(60)
    }

    fn fetch(&self) -> BoxFuture<'_, Result<UsageSnapshot, ProviderError>> {
        Box::pin(async move {
            let client = super::http().ok_or_else(|| ProviderError::Network("http client unavailable".into()))?;
            let auth = read_auth()?;
            let mut request = client
                .get(USAGE_URL)
                .bearer_auth(&auth.token)
                .header(reqwest::header::ACCEPT, "application/json")
                .header("OAI-Product-Sku", "codex");
            if let Some(id) = &auth.account_id {
                request = request.header("ChatGPT-Account-Id", id);
            }
            let response = request
                .send()
                .await
                .map_err(|e| ProviderError::Network(e.without_url().to_string()))?;

            let status = response.status();
            if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
                return Err(ProviderError::NeedsAuth);
            }
            if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
                return Err(ProviderError::RateLimited { retry_after: None });
            }
            if !status.is_success() {
                return Err(ProviderError::Network(format!("HTTP {}", status.as_u16())));
            }
            let body: Value = response
                .json()
                .await
                .map_err(|e| ProviderError::Parse(e.without_url().to_string()))?;
            parse(&body)
        })
    }
}

/// Window label and key from its length.
fn describe(window_secs: Option<i64>, fallback_key: &str) -> (String, String) {
    match window_secs {
        Some(s) if (17_000..=19_000).contains(&s) => ("five_hour".into(), "5-hour".into()),
        Some(s) if (600_000..=610_000).contains(&s) => ("seven_day".into(), "Weekly".into()),
        Some(s) if s >= 3600 => (fallback_key.into(), format!("{}-hour", s / 3600)),
        _ => (fallback_key.into(), if fallback_key == "primary" { "Primary" } else { "Secondary" }.into()),
    }
}

fn field<'a>(v: &'a Value, snake: &str, camel: &str) -> Option<&'a Value> {
    v.get(snake).or_else(|| v.get(camel))
}

fn parse_window(w: Option<&Value>, fallback_key: &str) -> Option<UsageWindow> {
    let w = w?.as_object()?;
    let w = Value::Object(w.clone());
    let used = field(&w, "used_percent", "usedPercent")?.as_f64()?;
    let window_secs = field(&w, "limit_window_seconds", "limitWindowSeconds")
        .and_then(Value::as_i64)
        .or_else(|| field(&w, "window_duration_mins", "windowDurationMins").and_then(Value::as_i64).map(|m| m * 60));
    let resets_at = field(&w, "reset_at", "resetAt")
        .or_else(|| field(&w, "resets_at", "resetsAt"))
        .and_then(parse_time)
        .or_else(|| {
            field(&w, "reset_after_seconds", "resetAfterSeconds")
                .and_then(Value::as_i64)
                .map(|s| Utc::now() + ChronoDuration::seconds(s))
        });
    let (key, label) = describe(window_secs, fallback_key);
    Some(UsageWindow {
        key,
        label,
        used_percent: used.clamp(0.0, 100.0),
        resets_at,
    })
}

fn parse(body: &Value) -> Result<UsageSnapshot, ProviderError> {
    let limits = body
        .get("rate_limit")
        .or_else(|| body.get("rate_limits"))
        .unwrap_or(body);
    let primary = parse_window(field(limits, "primary_window", "primaryWindow").or_else(|| limits.get("primary")), "primary");
    let secondary = parse_window(
        field(limits, "secondary_window", "secondaryWindow").or_else(|| limits.get("secondary")),
        "secondary",
    );
    let windows: Vec<UsageWindow> = [primary, secondary].into_iter().flatten().collect();
    if windows.is_empty() {
        return Err(ProviderError::Parse("no rate-limit windows in response".into()));
    }
    let plan = body
        .get("plan_type")
        .and_then(Value::as_str)
        .map(|p| format!("ChatGPT {p}"));
    Ok(UsageSnapshot {
        windows,
        fetched_at: Utc::now(),
        fidelity: Fidelity::Derived,
        plan,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_backend_shape() {
        let body = serde_json::json!({
            "plan_type": "plus",
            "rate_limit": {
                "primary_window": { "used_percent": 41, "limit_window_seconds": 18000, "reset_at": 1_900_000_000 },
                "secondary_window": { "used_percent": 12.5, "limit_window_seconds": 604800, "reset_after_seconds": 3600 }
            }
        });
        let snap = parse(&body).unwrap();
        assert_eq!(snap.windows.len(), 2);
        assert_eq!(snap.windows[0].key, "five_hour");
        assert_eq!(snap.windows[1].label, "Weekly");
        assert!(snap.windows[1].resets_at.is_some());
        assert_eq!(snap.plan.as_deref(), Some("ChatGPT plus"));
    }

    #[test]
    fn empty_is_parse_error() {
        assert!(matches!(parse(&serde_json::json!({})), Err(ProviderError::Parse(_))));
    }
}
