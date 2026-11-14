//! GitHub Copilot usage provider.
//!
//! Uses the GitHub CLI's existing sign-in (`gh auth token`, read-only) and
//! GitHub's internal Copilot endpoint for the monthly premium-request quota.
//! Unofficial and may not be available for every account or organisation:
//! labelled "derived", never guessed.

use std::os::windows::process::CommandExt;
use std::process::Command;
use std::time::Duration;

use chrono::Utc;
use serde_json::Value;

use super::{BoxFuture, Detection, Fidelity, ProviderError, UsageProvider, UsageSnapshot, UsageWindow, parse_time};

const USER_URL: &str = "https://api.github.com/copilot_internal/user";
/// Don't flash a console window when running `gh`.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub struct CopilotProvider;

impl CopilotProvider {
    pub fn new() -> Self {
        Self
    }
}

/// The token from `gh auth token`. Kept in memory for one request only.
fn gh_token() -> Result<crate::secret::Secret, ProviderError> {
    let output = Command::new("gh")
        .args(["auth", "token", "--hostname", "github.com"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|_| ProviderError::NeedsAuth)?;
    if !output.status.success() {
        return Err(ProviderError::NeedsAuth);
    }
    let raw = crate::secret::Secret::new(String::from_utf8(output.stdout).map_err(|_| ProviderError::NeedsAuth)?);
    let token = raw.expose().trim();
    if token.is_empty() {
        return Err(ProviderError::NeedsAuth);
    }
    Ok(crate::secret::Secret::new(token.to_owned()))
}

impl UsageProvider for CopilotProvider {
    fn id(&self) -> &'static str {
        "copilot"
    }

    fn display_name(&self) -> &'static str {
        "GitHub Copilot"
    }

    fn sign_in_hint(&self) -> &'static str {
        "install the GitHub CLI and run `gh auth login`"
    }

    fn detect(&self) -> Detection {
        match gh_token() {
            Ok(_) => Detection {
                found: true,
                detail: Some("GitHub CLI sign-in found. Copilot usage needs a Copilot plan on that account.".into()),
            },
            Err(_) => Detection { found: false, detail: None },
        }
    }

    fn min_interval(&self) -> Duration {
        Duration::from_secs(300)
    }

    fn fetch(&self) -> BoxFuture<'_, Result<UsageSnapshot, ProviderError>> {
        Box::pin(async move {
            let request = super::request(USER_URL)?;
            let token = tauri::async_runtime::spawn_blocking(gh_token)
                .await
                .map_err(|e| ProviderError::Network(e.to_string()))??;
            let mut auth = reqwest::header::HeaderValue::from_str(&format!("token {}", token.expose()))
                .map_err(|_| ProviderError::NeedsAuth)?;
            // Sensitive headers are never printed by reqwest's Debug output.
            auth.set_sensitive(true);
            let response = request
                .header(reqwest::header::AUTHORIZATION, auth)
                .header(reqwest::header::ACCEPT, "application/json")
                .send()
                .await
                .map_err(|e| ProviderError::Network(e.without_url().to_string()))?;
            let status = response.status();
            if status == reqwest::StatusCode::UNAUTHORIZED {
                return Err(ProviderError::NeedsAuth);
            }
            if status == reqwest::StatusCode::FORBIDDEN || status == reqwest::StatusCode::NOT_FOUND {
                return Err(ProviderError::Network(
                    "GitHub didn't return Copilot usage for this account".into(),
                ));
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

fn parse(body: &Value) -> Result<UsageSnapshot, ProviderError> {
    let snapshots = body
        .get("quota_snapshots")
        .and_then(Value::as_object)
        .ok_or_else(|| ProviderError::Parse("no quota_snapshots in response".into()))?;
    let resets_at = body.get("quota_reset_date").and_then(parse_time);
    let mut windows = Vec::new();
    for (key, label) in [
        ("premium_interactions", "Premium requests"),
        ("chat", "Chat"),
        ("completions", "Completions"),
    ] {
        let Some(q) = snapshots.get(key) else { continue };
        if q.get("unlimited").and_then(Value::as_bool).unwrap_or(false) {
            continue;
        }
        let Some(remaining) = q.get("percent_remaining").and_then(Value::as_f64) else { continue };
        windows.push(UsageWindow {
            key: key.into(),
            label: label.into(),
            used_percent: (100.0 - remaining).clamp(0.0, 100.0),
            resets_at,
        });
    }
    if windows.is_empty() {
        return Err(ProviderError::Parse("this plan has no metered Copilot quota".into()));
    }
    Ok(UsageSnapshot {
        windows,
        fetched_at: Utc::now(),
        fidelity: Fidelity::Derived,
        plan: body.get("copilot_plan").and_then(Value::as_str).map(|p| format!("Copilot {p}")),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_quota_snapshots() {
        let body = serde_json::json!({
            "copilot_plan": "individual",
            "quota_reset_date": "2026-12-01",
            "quota_snapshots": {
                "premium_interactions": { "percent_remaining": 70.0, "unlimited": false },
                "chat": { "percent_remaining": 100.0, "unlimited": true },
                "completions": { "unlimited": true }
            }
        });
        let snap = parse(&body).unwrap();
        assert_eq!(snap.windows.len(), 1);
        assert!((snap.windows[0].used_percent - 30.0).abs() < 1e-9);
        assert!(snap.windows[0].resets_at.is_some());
    }
}
