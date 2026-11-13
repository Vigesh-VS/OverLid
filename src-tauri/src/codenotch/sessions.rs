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
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use crate::peek::{self, Peek, PeekKind, Tone};

pub const SESSION_EVENT: &str = "code://session";

const DONE_FOR: Duration = Duration::from_secs(10);
const IDLE_EXPIRY: Duration = Duration::from_secs(30 * 60);
/// A busy session that goes silent this long probably crashed.
const BUSY_STALE: Duration = Duration::from_secs(15 * 60);

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
}

fn label_for(cwd: &str) -> String {
    Path::new(cwd)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| "Claude Code".into())
}

fn str_field<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(Value::as_str).filter(|s| !s.is_empty())
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

/// Apply one hook payload. Unknown events are ignored.
pub fn handle_hook(app: &AppHandle, payload: &Value) {
    let Some(event) = str_field(payload, "hook_event_name") else { return };
    let Some(id) = str_field(payload, "session_id") else { return };
    let cwd = str_field(payload, "cwd").unwrap_or_default().to_owned();
    let Some(state) = app.try_state::<Sessions>() else { return };

    let alert = {
        let Ok(mut map) = state.0.lock() else { return };
        if event == "SessionEnd" {
            map.remove(id);
            None
        } else {
            let now = Utc::now();
            let session = map.entry(id.to_owned()).or_insert_with(|| Session {
                id: id.to_owned(),
                label: label_for(&cwd),
                cwd: cwd.clone(),
                status: Status::Idle,
                message: None,
                tool: None,
                turn_started_at: None,
                updated_at: now,
            });
            if !cwd.is_empty() && session.cwd != cwd {
                session.label = label_for(&cwd);
                session.cwd = cwd;
            }
            session.updated_at = now;
            let previous = session.status;
            match event {
                "SessionStart" => {
                    session.status = Status::Idle;
                    session.message = None;
                    session.tool = None;
                    None
                }
                "UserPromptSubmit" => {
                    session.status = Status::Busy;
                    session.message = None;
                    session.tool = None;
                    session.turn_started_at = Some(now);
                    None
                }
                "PreToolUse" | "PostToolUse" => {
                    session.status = Status::Busy;
                    session.message = None;
                    session.tool = if event == "PreToolUse" {
                        str_field(payload, "tool_name").map(str::to_owned)
                    } else {
                        None
                    };
                    session.turn_started_at.get_or_insert(now);
                    None
                }
                "Notification" | "PermissionRequest" => {
                    let message = if event == "PermissionRequest" {
                        match str_field(payload, "tool_name") {
                            Some(tool) => format!("Needs permission to use {tool}"),
                            None => "Needs your permission".to_owned(),
                        }
                    } else {
                        str_field(payload, "message")
                            .unwrap_or("Waiting for your input")
                            .to_owned()
                    };
                    let changed = previous != Status::Waiting || session.message.as_deref() != Some(&message);
                    session.status = Status::Waiting;
                    session.message = Some(message.clone());
                    changed.then(|| Alert::Waiting(session.label.clone(), message))
                }
                "Stop" => {
                    session.status = Status::Done;
                    session.message = None;
                    session.tool = None;
                    let ran = ran_for(session.turn_started_at.take());
                    matches!(previous, Status::Busy | Status::Waiting)
                        .then(|| Alert::Done(session.label.clone(), ran))
                }
                _ => None,
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

/// Open a session's working folder in Explorer.
#[tauri::command]
pub fn code_open_folder(app: AppHandle, session_id: String) -> Result<(), String> {
    let cwd = list(&app)
        .into_iter()
        .find(|s| s.id == session_id)
        .map(|s| s.cwd)
        .ok_or_else(|| "session not found".to_owned())?;
    let path = Path::new(&cwd);
    if !path.is_dir() {
        return Err("folder no longer exists".into());
    }
    std::process::Command::new("explorer")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|e| {
            log::warn!("opening folder failed: {e}");
            "couldn't open the folder".to_owned()
        })
}
