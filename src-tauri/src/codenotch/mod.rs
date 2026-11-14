//! CodeNotch: AI coding-agent usage and live session status.
//!
//! Usage is only fetched for providers the user explicitly connected
//! (Settings › AI tools). "Connect" detects the provider CLI's existing local
//! sign-in and asks the user to confirm using it. Tokens are only ever read,
//! never written or refreshed, and only sent to that provider's endpoint.

pub mod claude;
pub mod codex;
pub mod copilot;
pub mod hook_installer;
pub mod hook_server;
pub mod hook_token;
pub mod sessions;

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use chrono::{DateTime, Utc};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Notify;

use crate::peek::{self, Peek, PeekKind, Tone};
use crate::settings;

pub const USAGE_EVENT: &str = "code://usage";

/// Never poll faster than this, whatever the settings or provider say.
const MIN_POLL: Duration = Duration::from_secs(60);
const BUSY_POLL: Duration = Duration::from_secs(60);
const MAX_BACKOFF: Duration = Duration::from_secs(30 * 60);

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Result of looking for a provider CLI's existing sign-in on this PC.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Detection {
    pub found: bool,
    /// What was found, e.g. "Claude Code sign-in (Max plan)".
    pub detail: Option<String>,
}

/// One AI provider's usage source. Add more by implementing this and
/// registering it in [`providers`].
pub trait UsageProvider: Send + Sync {
    fn id(&self) -> &'static str;
    fn display_name(&self) -> &'static str;
    /// The exact command to sign in with that provider's CLI.
    fn sign_in_hint(&self) -> &'static str;
    /// False ships the provider disabled as "coming soon".
    fn available(&self) -> bool {
        true
    }
    fn detect(&self) -> Detection;
    fn fetch(&self) -> BoxFuture<'_, Result<UsageSnapshot, ProviderError>>;
    fn min_interval(&self) -> Duration;
}

fn providers() -> &'static [Arc<dyn UsageProvider>] {
    static LIST: OnceLock<Vec<Arc<dyn UsageProvider>>> = OnceLock::new();
    LIST.get_or_init(|| {
        vec![
            Arc::new(claude::ClaudeProvider::new()),
            Arc::new(codex::CodexProvider::new()),
            Arc::new(copilot::CopilotProvider::new()),
        ]
    })
}

fn provider(id: &str) -> Option<Arc<dyn UsageProvider>> {
    providers().iter().find(|p| p.id() == id).cloned()
}

/// An allowlisted GET request (see `crate::net`), as a provider error.
pub fn request(url: &str) -> Result<reqwest::RequestBuilder, ProviderError> {
    crate::net::get(url).map_err(|e| ProviderError::Network(e.to_string()))
}

/// Read a credential file into a wiped-on-drop buffer.
pub fn read_secret_file(path: &std::path::Path) -> Result<crate::secret::Secret, ProviderError> {
    std::fs::read_to_string(path)
        .map(crate::secret::Secret::new)
        .map_err(|_| ProviderError::NeedsAuth)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Fidelity {
    /// Read from an unofficial endpoint; shown as "derived" in the UI.
    Derived,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    pub key: String,
    pub label: String,
    pub used_percent: f64,
    pub resets_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSnapshot {
    pub windows: Vec<UsageWindow>,
    pub fetched_at: DateTime<Utc>,
    pub fidelity: Fidelity,
    /// Plan or account info, if the provider reports it.
    pub plan: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum ProviderError {
    #[error("auth failed: sign in again")]
    NeedsAuth,
    #[error("rate limited")]
    RateLimited { retry_after: Option<Duration> },
    #[error("network error: {0}")]
    Network(String),
    #[error("unexpected response: {0}")]
    Parse(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum UsageState {
    Loading,
    Ok,
    NeedsAuth,
    RateLimited,
    Error,
    Disabled,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatus {
    pub provider_id: String,
    pub display_name: String,
    pub state: UsageState,
    /// Last good snapshot, kept across failures so the UI can show its age.
    pub snapshot: Option<UsageSnapshot>,
    pub message: Option<String>,
    pub last_attempt_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInfo {
    pub id: String,
    pub name: String,
    pub available: bool,
    pub connected: bool,
    pub sign_in_hint: String,
}

pub struct UsageStore {
    statuses: Mutex<HashMap<String, ProviderStatus>>,
    refresh: Notify,
}

fn initial_status(p: &dyn UsageProvider) -> ProviderStatus {
    ProviderStatus {
        provider_id: p.id().into(),
        display_name: p.display_name().into(),
        state: UsageState::Loading,
        snapshot: None,
        message: None,
        last_attempt_at: None,
    }
}

pub fn start(app: &AppHandle) {
    let statuses = providers()
        .iter()
        .map(|p| (p.id().to_owned(), initial_status(p.as_ref())))
        .collect();
    app.manage(UsageStore {
        statuses: Mutex::new(statuses),
        refresh: Notify::new(),
    });

    for provider in providers().iter().filter(|p| p.available()) {
        let app = app.clone();
        let provider = Arc::clone(provider);
        tauri::async_runtime::spawn(async move { poll_loop(app, provider).await });
    }
}

fn is_connected(app: &AppHandle, id: &str) -> bool {
    settings::current(app).code.connected.iter().any(|c| c == id)
}

/// Statuses of connected providers, in the user's order (first = primary).
fn connected_statuses(app: &AppHandle) -> Vec<ProviderStatus> {
    let order = settings::current(app).code.connected;
    let Some(store) = app.try_state::<UsageStore>() else { return Vec::new() };
    let Ok(statuses) = store.statuses.lock() else { return Vec::new() };
    order.iter().filter_map(|id| statuses.get(id).cloned()).collect()
}

fn emit(app: &AppHandle) {
    if let Err(e) = app.emit(USAGE_EVENT, connected_statuses(app)) {
        log::warn!("emit {USAGE_EVENT} failed: {e}");
    }
}

#[tauri::command]
pub fn code_usage(app: AppHandle) -> Vec<ProviderStatus> {
    connected_statuses(&app)
}

#[tauri::command]
pub fn code_refresh_usage(store: tauri::State<'_, UsageStore>) {
    store.refresh.notify_waiters();
}

#[tauri::command]
pub fn code_providers(app: AppHandle) -> Vec<ProviderInfo> {
    let connected = settings::current(&app).code.connected;
    providers()
        .iter()
        .map(|p| ProviderInfo {
            id: p.id().into(),
            name: p.display_name().into(),
            available: p.available(),
            connected: connected.iter().any(|c| c == p.id()),
            sign_in_hint: p.sign_in_hint().into(),
        })
        .collect()
}

/// Look for the provider CLI's sign-in so the user can confirm using it.
#[tauri::command]
pub async fn code_detect(id: String) -> Result<Detection, String> {
    let p = provider(&id).ok_or_else(|| format!("unknown provider {id}"))?;
    if !p.available() {
        return Err(format!("{} usage is coming soon.", p.display_name()));
    }
    tauri::async_runtime::spawn_blocking(move || p.detect())
        .await
        .map_err(|e| e.to_string())
}

/// Connect a provider after the user confirmed its detected sign-in.
#[tauri::command]
pub fn code_connect_provider(app: AppHandle, id: String) -> Result<(), String> {
    let p = provider(&id).ok_or_else(|| format!("unknown provider {id}"))?;
    if !p.available() {
        return Err(format!("{} usage is coming soon.", p.display_name()));
    }
    let mut next = settings::current(&app);
    if !next.code.connected.contains(&id) {
        next.code.connected.push(id);
    }
    settings::replace(&app, next);
    emit(&app);
    Ok(())
}

#[tauri::command]
pub fn code_disconnect_provider(app: AppHandle, id: String) {
    let mut next = settings::current(&app);
    next.code.connected.retain(|c| *c != id);
    settings::replace(&app, next);
    if let Some(store) = app.try_state::<UsageStore>()
        && let Ok(mut statuses) = store.statuses.lock()
        && let Some(p) = provider(&id)
    {
        statuses.insert(id, initial_status(p.as_ref()));
    }
    emit(&app);
}

/// Make a connected provider the primary one (first in the list).
#[tauri::command]
pub fn code_set_primary(app: AppHandle, id: String) {
    let mut next = settings::current(&app);
    if let Some(pos) = next.code.connected.iter().position(|c| *c == id) {
        let item = next.code.connected.remove(pos);
        next.code.connected.insert(0, item);
        settings::replace(&app, next);
        emit(&app);
    }
}

#[tauri::command]
pub fn code_hook_status(app: AppHandle) -> hook_installer::HookStatus {
    hook_installer::status(hook_server::bound_port(&app))
}

/// "Connect live sessions": back up and merge our hooks into ~/.claude/settings.json.
#[tauri::command]
pub async fn code_connect(app: AppHandle) -> Result<hook_installer::ChangeReport, String> {
    let port = hook_server::bound_port(&app)
        .ok_or_else(|| "The hook receiver isn't running, so there's nothing to connect to.".to_owned())?;
    let token = hook_server::token(&app).ok_or_else(|| "The hook receiver has no token yet.".to_owned())?;
    hook_installer::install(port, &token).map_err(|e| {
        log::warn!("hook install failed: {e:#}");
        format!("{e:#}")
    })
}

/// "Disconnect": remove only Overlid's hooks.
#[tauri::command]
pub async fn code_disconnect(app: AppHandle) -> Result<hook_installer::ChangeReport, String> {
    hook_installer::uninstall(hook_server::bound_port(&app)).map_err(|e| {
        log::warn!("hook uninstall failed: {e:#}");
        format!("{e:#}")
    })
}

pub fn refresh_now(app: &AppHandle) {
    if let Some(store) = app.try_state::<UsageStore>() {
        store.refresh.notify_waiters();
    }
}

fn update(app: &AppHandle, id: &str, f: impl FnOnce(&mut ProviderStatus)) {
    let Some(store) = app.try_state::<UsageStore>() else { return };
    {
        let Ok(mut statuses) = store.statuses.lock() else { return };
        let Some(status) = statuses.get_mut(id) else { return };
        f(status);
    }
    emit(app);
}

async fn poll_loop(app: AppHandle, provider: Arc<dyn UsageProvider>) {
    let id = provider.id();
    let mut backoff = Duration::ZERO;
    let mut levels: HashMap<String, u8> = HashMap::new();
    let mut first = true;

    loop {
        let code = settings::current(&app).code;
        if !code.enabled || !is_connected(&app, id) {
            // Not connected: stay idle until settings change.
            first = true;
            levels.clear();
            update(&app, id, |s| {
                s.state = UsageState::Disabled;
                s.message = None;
            });
            wait(&app, Duration::from_secs(300)).await;
            continue;
        }

        let result = provider.fetch().await;
        let now = Utc::now();
        let mut next = Duration::from_secs(code.poll_secs)
            .max(provider.min_interval())
            .max(MIN_POLL);
        if id == "claude" && sessions::any_busy(&app) {
            next = next.min(BUSY_POLL);
        }

        match result {
            Ok(snapshot) => {
                backoff = Duration::ZERO;
                check_thresholds(&app, provider.as_ref(), &snapshot, &mut levels, first, &code);
                first = false;
                update(&app, id, |s| {
                    s.state = UsageState::Ok;
                    s.snapshot = Some(snapshot);
                    s.message = None;
                    s.last_attempt_at = Some(now);
                });
            }
            Err(ProviderError::NeedsAuth) => {
                update(&app, id, |s| {
                    s.state = UsageState::NeedsAuth;
                    s.message = Some(format!("Sign in again: {}", provider.sign_in_hint()));
                    s.last_attempt_at = Some(now);
                });
            }
            Err(ProviderError::RateLimited { retry_after }) => {
                backoff = retry_after.unwrap_or_else(|| (backoff * 2).max(MIN_POLL));
                backoff = backoff.min(MAX_BACKOFF);
                next = next.max(backoff);
                log::info!("{id} usage rate limited, retrying in {}s", next.as_secs());
                update(&app, id, |s| {
                    s.state = UsageState::RateLimited;
                    s.message = Some(format!("Rate limited. Retrying in {} min.", next.as_secs().div_ceil(60)));
                    s.last_attempt_at = Some(now);
                });
            }
            Err(e) => {
                log::warn!("{id} usage fetch failed: {e}");
                update(&app, id, |s| {
                    s.state = UsageState::Error;
                    s.message = Some(crate::redact::redact(&e.to_string()));
                    s.last_attempt_at = Some(now);
                });
            }
        }

        wait(&app, next).await;
    }
}

/// Sleep for `d`, or until someone asks for a refresh.
async fn wait(app: &AppHandle, d: Duration) {
    let Some(store) = app.try_state::<UsageStore>() else {
        tokio::time::sleep(d).await;
        return;
    };
    tokio::select! {
        () = tokio::time::sleep(d) => {}
        () = store.refresh.notified() => {}
    }
}

/// 0 = fine, 1 = warning, 2 = critical, 3 = limit reached.
fn level(pct: f64, code: &settings::Code) -> u8 {
    if pct >= 100.0 {
        3
    } else if pct >= code.critical_pct {
        2
    } else if pct >= code.warn_pct {
        1
    } else {
        0
    }
}

fn check_thresholds(
    app: &AppHandle,
    provider: &dyn UsageProvider,
    snapshot: &UsageSnapshot,
    levels: &mut HashMap<String, u8>,
    first: bool,
    code: &settings::Code,
) {
    let name = provider.display_name();
    for w in &snapshot.windows {
        let now = level(w.used_percent, code);
        let before = levels.insert(w.key.clone(), now).unwrap_or(0);
        // Don't alert for whatever state we find at launch; only for crossings.
        if first || now == before {
            continue;
        }
        let resets = w
            .resets_at
            .map(|t| format!("Resets in {}", human_until(t)))
            .unwrap_or_else(|| "Reset time unknown".into());
        let label = format!("{name} {}", w.label);
        if now > before {
            let (tone, title) = match now {
                3 => (Tone::Critical, format!("{label} limit reached")),
                2 => (Tone::Critical, format!("{label} at {:.0} %", w.used_percent)),
                _ => (Tone::Warn, format!("{label} at {:.0} %", w.used_percent)),
            };
            peek::show(
                app,
                Peek::new(PeekKind::Usage, tone, title.clone())
                    .subtitle(resets.clone())
                    .value(w.used_percent / 100.0)
                    .with_sound(),
            );
            peek::notify(app, PeekKind::Usage, &title, &resets);
        } else if now == 0 && before >= 2 {
            let title = format!("{label} quota available again");
            peek::show(
                app,
                Peek::new(PeekKind::QuotaBack, Tone::Good, title.clone())
                    .subtitle(format!("{:.0} % used", w.used_percent))
                    .value(w.used_percent / 100.0),
            );
            peek::notify(app, PeekKind::QuotaBack, &title, &format!("{name} is ready to go."));
        }
    }
}

pub fn human_until(t: DateTime<Utc>) -> String {
    let secs = (t - Utc::now()).num_seconds().max(0);
    let h = secs / 3600;
    let m = (secs % 3600) / 60;
    if h >= 24 {
        format!("{}d {}h", h / 24, h % 24)
    } else if h > 0 {
        format!("{h}h {m}m")
    } else {
        format!("{}m", m.max(1))
    }
}

/// Parse an RFC 3339 timestamp, a plain date, or Unix seconds.
pub fn parse_time(value: &serde_json::Value) -> Option<DateTime<Utc>> {
    if let Some(n) = value.as_i64() {
        return DateTime::from_timestamp(n, 0);
    }
    let s = value.as_str()?;
    if let Ok(t) = DateTime::parse_from_rfc3339(s) {
        return Some(t.with_timezone(&Utc));
    }
    chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d")
        .ok()
        .and_then(|d| d.and_hms_opt(0, 0, 0))
        .map(|dt| dt.and_utc())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Nothing the island receives over IPC may carry a token, even when an
    /// error message from a provider happens to contain one.
    #[test]
    fn ipc_payloads_hold_no_tokens() {
        let leaked = ProviderError::Network("Bearer sk-ant-oat01-AAAAAAAAAAAAAAAAAAAA rejected".into());
        let status = ProviderStatus {
            provider_id: "claude".into(),
            display_name: "Claude Code".into(),
            state: UsageState::Error,
            snapshot: None,
            message: Some(crate::redact::redact(&leaked.to_string())),
            last_attempt_at: None,
        };
        let json = serde_json::to_string(&status).unwrap_or_default();
        for word in json.split(|c: char| c == '"' || c.is_whitespace()) {
            assert!(!crate::redact::looks_secret(word), "token-like string in IPC payload: {json}");
        }
        assert!(!json.contains("AAAAAAAAAAAA"));
    }

    #[test]
    fn errors_are_short_and_secret_free() {
        assert_eq!(ProviderError::NeedsAuth.to_string(), "auth failed: sign in again");
    }
}
