//! Live Claude Code session status, driven by hook events.
//!
//! SessionStart → idle · UserPromptSubmit/PreToolUse/PostToolUse → busy ·
//! Notification/PermissionRequest → waiting · Stop → done (10 s, then idle) ·
//! SessionEnd → removed. Idle sessions are dropped after 30 min of silence.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::peek::{self, Peek, PeekKind, Tone};

pub const SESSION_EVENT: &str = "code://session";

const DONE_FOR: Duration = Duration::from_secs(10);
const IDLE_EXPIRY: Duration = Duration::from_secs(30 * 60);
/// A busy session that goes silent this long probably crashed.
const BUSY_STALE: Duration = Duration::from_secs(15 * 60);
/// Tracked sessions; the least recently updated one is dropped beyond this.
const MAX_SESSIONS: usize = 50;
const MAX_SESSION_ID: usize = 128;
const MAX_CWD: usize = 1024;
const MAX_MESSAGE: usize = 300;
const MAX_TOOL: usize = 64;

/// The hook events Overlid installs. Anything else is rejected.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub enum EventName {
    SessionStart,
    UserPromptSubmit,
    PreToolUse,
    PostToolUse,
    Notification,
    PermissionRequest,
    Stop,
    SessionEnd,
}

/// The only fields read from a hook. Everything else (tool_input,
/// tool_response, prompts, transcript paths) is skipped unread.
#[derive(Deserialize)]
struct RawHook {
    hook_event_name: EventName,
    session_id: String,
    #[serde(default)]
    cwd: Option<String>,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    tool_name: Option<String>,
}

/// A validated hook event.
#[derive(Debug, Clone)]
pub struct HookEvent {
    pub event: EventName,
    pub session_id: String,
    /// A local folder path, or empty.
    pub cwd: String,
    pub message: Option<String>,
    pub tool: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum HookError {
    Json,
    SessionId,
    Cwd,
}

/// Strip control characters, collapse whitespace, cap the length.
fn clean_text(s: &str, max: usize) -> Option<String> {
    let cleaned: String = s
        .split(|c: char| c.is_whitespace() || c.is_control())
        .filter(|w| !w.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(max)
        .collect();
    (!cleaned.is_empty()).then_some(cleaned)
}

/// A plain local folder like `C:\code\app`. Network (`\\host\share`) and
/// device paths are refused: even checking them could reach out to a server.
pub fn is_local_path(path: &str) -> bool {
    let b = path.as_bytes();
    b.len() >= 3
        && b[0].is_ascii_alphabetic()
        && b[1] == b':'
        && matches!(b[2], b'\\' | b'/')
        && !path.chars().any(char::is_control)
}

/// Parse and validate one hook body.
pub fn parse_hook(body: &[u8]) -> Result<HookEvent, HookError> {
    let raw: RawHook = serde_json::from_slice(body).map_err(|_| HookError::Json)?;
    let id_ok = !raw.session_id.is_empty()
        && raw.session_id.len() <= MAX_SESSION_ID
        && raw.session_id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    if !id_ok {
        return Err(HookError::SessionId);
    }
    let cwd = raw.cwd.unwrap_or_default();
    if cwd.chars().count() > MAX_CWD {
        return Err(HookError::Cwd);
    }
    Ok(HookEvent {
        event: raw.hook_event_name,
        session_id: raw.session_id,
        cwd: if is_local_path(&cwd) { cwd } else { String::new() },
        message: raw.message.as_deref().and_then(|m| clean_text(m, MAX_MESSAGE)),
        tool: raw.tool_name.as_deref().and_then(|t| clean_text(t, MAX_TOOL)),
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    Idle,
    Busy,
    Waiting,
    Done,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub label: String,
    pub cwd: String,
    pub status: Status,
    pub message: Option<String>,
    pub tool: Option<String>,
    /// When the current turn started (busy since).
    pub turn_started_at: Option<DateTime<Utc>>,
    pub updated_at: DateTime<Utc>,
    /// The user clicked the "needs you" alert for the current wait.
    pub acknowledged: bool,
}

#[derive(Default)]
pub struct Sessions(Mutex<HashMap<String, Session>>);

pub fn start(app: &AppHandle) {
    app.manage(Sessions::default());
    let app = app.clone();
    let spawned = thread::Builder::new().name("sessions".into()).spawn(move || {
        loop {
            thread::sleep(Duration::from_secs(5));
            sweep(&app);
        }
    });
    if let Err(e) = spawned {
        log::error!("could not spawn session sweeper: {e}");
    }
}

pub fn any_busy(app: &AppHandle) -> bool {
    app.try_state::<Sessions>()
        .and_then(|s| s.0.lock().ok().map(|m| m.values().any(|s| s.status == Status::Busy)))
        .unwrap_or(false)
}

pub fn list(app: &AppHandle) -> Vec<Session> {
    let mut list: Vec<Session> = app
        .try_state::<Sessions>()
        .and_then(|s| s.0.lock().ok().map(|m| m.values().cloned().collect()))
        .unwrap_or_default();
    list.sort_by_key(|s| std::cmp::Reverse(s.updated_at));
    list
}

fn emit(app: &AppHandle) {
    if let Err(e) = app.emit(SESSION_EVENT, list(app)) {
        log::warn!("emit {SESSION_EVENT} failed: {e}");
    }
    crate::window::refresh_attention_dot(app);
}

fn label_for(cwd: &str) -> String {
    Path::new(cwd)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| "Claude Code".into())
}

fn ran_for(since: Option<DateTime<Utc>>) -> Option<String> {
    let secs = (Utc::now() - since?).num_seconds().max(0);
    Some(if secs >= 3600 {
        format!("{}h {}m", secs / 3600, (secs % 3600) / 60)
    } else if secs >= 60 {
        format!("{}m {}s", secs / 60, secs % 60)
    } else {
        format!("{secs}s")
    })
}

enum Alert {
    Waiting(String, String),
    Done(String, Option<String>),
}

/// Apply one validated hook event.
pub fn handle_hook(app: &AppHandle, hook: &HookEvent) {
    use EventName as E;
    let event = hook.event;
    let id = hook.session_id.as_str();
    let cwd = hook.cwd.clone();
    let Some(state) = app.try_state::<Sessions>() else { return };

    let alert = {
        let Ok(mut map) = state.0.lock() else { return };
        if event == E::SessionEnd {
            map.remove(id);
            None
        } else {
            let now = Utc::now();
            if !map.contains_key(id) && map.len() >= MAX_SESSIONS {
                evict_oldest(&mut map);
            }
            let session = map.entry(id.to_owned()).or_insert_with(|| Session {
                id: id.to_owned(),
                label: label_for(&cwd),
                cwd: cwd.clone(),
                status: Status::Idle,
                message: None,
                tool: None,
                turn_started_at: None,
                updated_at: now,
                acknowledged: false,
            });
            if !cwd.is_empty() && session.cwd != cwd {
                session.label = label_for(&cwd);
                session.cwd = cwd;
            }
            session.updated_at = now;
            let previous = session.status;
            match event {
                E::SessionStart => {
                    session.status = Status::Idle;
                    session.message = None;
                    session.tool = None;
                    None
                }
                E::UserPromptSubmit => {
                    session.status = Status::Busy;
                    session.message = None;
                    session.tool = None;
                    session.turn_started_at = Some(now);
                    None
                }
                E::PreToolUse | E::PostToolUse => {
                    session.status = Status::Busy;
                    session.message = None;
                    session.tool = if event == E::PreToolUse { hook.tool.clone() } else { None };
                    session.turn_started_at.get_or_insert(now);
                    None
                }
                E::Notification | E::PermissionRequest => {
                    let message = if event == E::PermissionRequest {
                        match hook.tool.as_deref() {
                            Some(tool) => format!("Needs permission to use {tool}"),
                            None => "Needs your permission".to_owned(),
                        }
                    } else {
                        hook.message.clone().unwrap_or_else(|| "Waiting for your input".to_owned())
                    };
                    let changed = previous != Status::Waiting || session.message.as_deref() != Some(&message);
                    if changed {
                        session.acknowledged = false;
                    }
                    session.status = Status::Waiting;
                    session.message = Some(message.clone());
                    changed.then(|| Alert::Waiting(session.label.clone(), message))
                }
                E::Stop => {
                    session.status = Status::Done;
                    session.message = None;
                    session.tool = None;
                    let ran = ran_for(session.turn_started_at.take());
                    matches!(previous, Status::Busy | Status::Waiting)
                        .then(|| Alert::Done(session.label.clone(), ran))
                }
                E::SessionEnd => None,
            }
        }
    };

    match alert {
        Some(Alert::Waiting(label, message)) => {
            let title = format!("{label} needs you");
            peek::show(
                app,
                Peek::new(PeekKind::AgentWaiting, Tone::Warn, title.clone())
                    .subtitle(message.clone())
                    .with_sound(),
            );
            peek::notify(app, PeekKind::AgentWaiting, &title, &message);
        }
        Some(Alert::Done(label, ran)) => {
            let title = format!("{label} finished");
            let subtitle = match ran {
                Some(ran) => format!("Claude Code · ran {ran}"),
                None => "Claude Code".to_owned(),
            };
            peek::show(
                app,
                Peek::new(PeekKind::AgentDone, Tone::Good, title.clone())
                    .subtitle(subtitle.clone())
                    .with_sound(),
            );
            peek::notify(app, PeekKind::AgentDone, &title, &subtitle);
        }
        None => {}
    }
    emit(app);
}

fn evict_oldest(map: &mut HashMap<String, Session>) {
    if let Some(oldest) = map.values().min_by_key(|s| s.updated_at).map(|s| s.id.clone()) {
        map.remove(&oldest);
    }
}

fn sweep(app: &AppHandle) {
    let Some(state) = app.try_state::<Sessions>() else { return };
    let changed = {
        let Ok(mut map) = state.0.lock() else { return };
        let now = Utc::now();
        let age = |s: &Session| (now - s.updated_at).to_std().unwrap_or_default();
        let before = map.len();
        map.retain(|_, s| !(s.status == Status::Idle && age(s) >= IDLE_EXPIRY));
        let mut changed = map.len() != before;
        for s in map.values_mut() {
            let quiet = age(s);
            let expired = (s.status == Status::Done && quiet >= DONE_FOR)
                || (s.status == Status::Busy && quiet >= BUSY_STALE);
            if expired {
                s.status = Status::Idle;
                s.tool = None;
                changed = true;
            }
        }
        changed
    };
    if changed {
        emit(app);
    }
}

#[tauri::command]
pub fn code_sessions(app: AppHandle) -> Vec<Session> {
    list(&app)
}

/// The first waiting session the user hasn't acknowledged yet.
pub fn needs_attention(app: &AppHandle) -> Option<Session> {
    list(app)
        .into_iter()
        .find(|s| s.status == Status::Waiting && !s.acknowledged)
}

/// Clear the "needs you" alert for a session until it waits again.
#[tauri::command]
pub fn code_dismiss(app: AppHandle, session_id: String) {
    if let Some(state) = app.try_state::<Sessions>()
        && let Ok(mut map) = state.0.lock()
        && let Some(s) = map.get_mut(&session_id)
    {
        s.acknowledged = true;
    }
    emit(&app);
}

/// Open a session's working folder in Explorer.
#[tauri::command]
pub fn code_open_folder(app: AppHandle, session_id: String) -> Result<(), String> {
    let cwd = list(&app)
        .into_iter()
        .find(|s| s.id == session_id)
        .map(|s| s.cwd)
        .ok_or_else(|| "session not found".to_owned())?;
    if !is_local_path(&cwd) || !Path::new(&cwd).is_dir() {
        return Err("folder no longer exists".into());
    }
    // Open the folder itself in Explorer: no file, no arguments, nothing run.
    // SAFETY: plain call with valid, NUL-terminated strings.
    let result = unsafe {
        windows::Win32::UI::Shell::ShellExecuteW(
            None,
            windows::core::w!("explore"),
            &windows::core::HSTRING::from(cwd.as_str()),
            None,
            None,
            windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL,
        )
    };
    // ShellExecute returns a value above 32 on success.
    if result.0 as usize > 32 {
        Ok(())
    } else {
        log::warn!("opening folder failed ({})", result.0 as usize);
        Err("couldn't open the folder".to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_only_safe_fields() {
        let body = br#"{"hook_event_name":"Notification","session_id":"s-1","cwd":"C:\\code\\app",
            "message":"Need\u0007 you\n\n  now","tool_input":{"command":"rm -rf /"},"prompt":"secret"}"#;
        let e = parse_hook(body).unwrap();
        assert_eq!(e.event, EventName::Notification);
        assert_eq!(e.cwd, r"C:\code\app");
        assert_eq!(e.message.as_deref(), Some("Need you now"));
    }

    #[test]
    fn rejects_bad_payloads() {
        assert_eq!(parse_hook(br#"{"hook_event_name":"Exec","session_id":"a"}"#).unwrap_err(), HookError::Json);
        assert_eq!(parse_hook(br#"{"hook_event_name":"Stop"}"#).unwrap_err(), HookError::Json);
        let long_id = format!(r#"{{"hook_event_name":"Stop","session_id":"{}"}}"#, "a".repeat(129));
        assert_eq!(parse_hook(long_id.as_bytes()).unwrap_err(), HookError::SessionId);
        assert_eq!(parse_hook(br#"{"hook_event_name":"Stop","session_id":"a/../b"}"#).unwrap_err(), HookError::SessionId);
        let long_cwd = format!(r#"{{"hook_event_name":"Stop","session_id":"a","cwd":"C:/{}"}}"#, "a".repeat(1100));
        assert_eq!(parse_hook(long_cwd.as_bytes()).unwrap_err(), HookError::Cwd);
    }

    #[test]
    fn message_is_capped() {
        let body = format!(r#"{{"hook_event_name":"Notification","session_id":"a","message":"{}"}}"#, "x".repeat(1000));
        let message = parse_hook(body.as_bytes()).unwrap().message;
        assert_eq!(message.map(|m| m.chars().count()), Some(MAX_MESSAGE));
    }

    #[test]
    fn network_paths_are_dropped() {
        for cwd in [r"\\evil\share", r"\\?\C:\x", "//evil/share", r"relative\dir"] {
            let body = serde_json::json!({ "hook_event_name": "Stop", "session_id": "a", "cwd": cwd }).to_string();
            assert_eq!(parse_hook(body.as_bytes()).unwrap().cwd, "", "{cwd}");
        }
        assert!(is_local_path("D:/work"));
    }

    #[test]
    fn evicts_the_oldest_session() {
        let mut map = HashMap::new();
        for i in 0..3 {
            let id = format!("s{i}");
            let session = Session {
                id: id.clone(),
                label: String::new(),
                cwd: String::new(),
                status: Status::Idle,
                message: None,
                tool: None,
                turn_started_at: None,
                updated_at: Utc::now() + chrono::Duration::seconds(i),
                acknowledged: false,
            };
            map.insert(id, session);
        }
        evict_oldest(&mut map);
        assert!(!map.contains_key("s0") && map.len() == 2);
    }
}
