//! CodeNotch: AI coding-agent usage and live session status.

pub mod claude;
pub mod hook_installer;
pub mod hook_server;
pub mod sessions;

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
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

/// One AI provider's usage source. Add Codex, Copilot, Gemini by implementing this.
pub trait UsageProvider: Send + Sync {
    fn id(&self) -> &'static str;
    fn display_name(&self) -> &'static str;
    fn fetch(&self) -> BoxFuture<'_, Result<UsageSnapshot, ProviderError>>;
    fn min_interval(&self) -> Duration;
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
}

#[derive(Debug, thiserror::Error)]
pub enum ProviderError {
    #[error("not signed in")]
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

pub struct UsageStore {
    statuses: Mutex<Vec<ProviderStatus>>,
    refresh: Notify,
}

pub fn start(app: &AppHandle) {
    let providers: Vec<Arc<dyn UsageProvider>> = vec![Arc::new(claude::ClaudeProvider::new())];
    let initial = providers
        .iter()
        .map(|p| ProviderStatus {
            provider_id: p.id().into(),
            display_name: p.display_name().into(),
            state: UsageState::Loading,
            snapshot: None,
            message: None,
            last_attempt_at: None,
        })
        .collect();
    app.manage(UsageStore {
        statuses: Mutex::new(initial),
        refresh: Notify::new(),
    });

    for (index, provider) in providers.into_iter().enumerate() {
        let app = app.clone();
        tauri::async_runtime::spawn(async move { poll_loop(app, index, provider).await });
    }
}

#[tauri::command]
pub fn code_usage(store: tauri::State<'_, UsageStore>) -> Vec<ProviderStatus> {
    store.statuses.lock().map(|s| s.clone()).unwrap_or_default()
}

#[tauri::command]
pub fn code_refresh_usage(store: tauri::State<'_, UsageStore>) {
    store.refresh.notify_waiters();
}

#[tauri::command]
pub fn code_hook_status(app: AppHandle) -> hook_installer::HookStatus {
    hook_installer::status(hook_server::bound_port(&app))
}

/// "Connect Claude Code": back up and merge our hooks into ~/.claude/settings.json.
#[tauri::command]
pub async fn code_connect(app: AppHandle) -> Result<hook_installer::ChangeReport, String> {
    let port = hook_server::bound_port(&app)
        .ok_or_else(|| "The hook receiver isn't running, so there's nothing to connect to.".to_owned())?;
    hook_installer::install(port).map_err(|e| {
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

fn update(app: &AppHandle, index: usize, f: impl FnOnce(&mut ProviderStatus)) {
    let Some(store) = app.try_state::<UsageStore>() else { return };
    let snapshot = {
        let Ok(mut statuses) = store.statuses.lock() else { return };
        let Some(status) = statuses.get_mut(index) else { return };
        f(status);
        statuses.clone()
    };
    if let Err(e) = app.emit(USAGE_EVENT, snapshot) {
        log::warn!("emit {USAGE_EVENT} failed: {e}");
    }
}

async fn poll_loop(app: AppHandle, index: usize, provider: Arc<dyn UsageProvider>) {
    let mut backoff = Duration::ZERO;
    let mut levels: HashMap<String, u8> = HashMap::new();
    let mut first = true;

    loop {
        let code = settings::current(&app).code;
        if !code.enabled {
            update(&app, index, |s| {
                s.state = UsageState::Disabled;
                s.message = None;
            });
            wait(&app, Duration::from_secs(30)).await;
            continue;
        }

        let result = provider.fetch().await;
        let now = Utc::now();
        let mut next = Duration::from_secs(code.poll_secs)
            .max(provider.min_interval())
            .max(MIN_POLL);
        if sessions::any_busy(&app) {
            next = next.min(BUSY_POLL);
        }

        match result {
            Ok(snapshot) => {
                backoff = Duration::ZERO;
                check_thresholds(&app, &snapshot, &mut levels, first, &code);
                first = false;
                update(&app, index, |s| {
                    s.state = UsageState::Ok;
                    s.snapshot = Some(snapshot);
                    s.message = None;
                    s.last_attempt_at = Some(now);
                });
            }
            Err(ProviderError::NeedsAuth) => {
                update(&app, index, |s| {
                    s.state = UsageState::NeedsAuth;
                    s.message = Some("Run `claude` once in a terminal to sign in.".into());
                    s.last_attempt_at = Some(now);
                });
            }
            Err(ProviderError::RateLimited { retry_after }) => {
                backoff = retry_after.unwrap_or_else(|| (backoff * 2).max(MIN_POLL));
                backoff = backoff.min(MAX_BACKOFF);
                next = next.max(backoff);
                log::info!("{} usage rate limited, retrying in {}s", provider.id(), next.as_secs());
                update(&app, index, |s| {
                    s.state = UsageState::RateLimited;
                    s.message = Some(format!("Rate limited. Retrying in {} min.", next.as_secs().div_ceil(60)));
                    s.last_attempt_at = Some(now);
                });
            }
            Err(e) => {
                log::warn!("{} usage fetch failed: {e}", provider.id());
                update(&app, index, |s| {
                    s.state = UsageState::Error;
                    s.message = Some(e.to_string());
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
    snapshot: &UsageSnapshot,
    levels: &mut HashMap<String, u8>,
    first: bool,
    code: &settings::Code,
) {
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
        if now > before {
            let (tone, title) = match now {
                3 => (Tone::Critical, format!("{} limit reached", w.label)),
                2 => (Tone::Critical, format!("{} limit at {:.0} %", w.label, w.used_percent)),
                _ => (Tone::Warn, format!("{} limit at {:.0} %", w.label, w.used_percent)),
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
            let title = format!("{} quota available again", w.label);
            peek::show(
                app,
                Peek::new(PeekKind::QuotaBack, Tone::Good, title.clone())
                    .subtitle(format!("{:.0} % used", w.used_percent))
                    .value(w.used_percent / 100.0),
            );
            peek::notify(app, PeekKind::QuotaBack, &title, "Claude Code is ready to go.");
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
