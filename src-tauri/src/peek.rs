//! Peeks: brief island expansions for events, plus Windows notifications.

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;

use crate::settings;

pub const PEEK_EVENT: &str = "island://peek";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PeekKind {
    CapsLock,
    NumLock,
    Charging,
    OnBattery,
    LowBattery,
    AgentDone,
    AgentWaiting,
    Usage,
    QuotaBack,
    FocusDone,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Tone {
    Neutral,
    Good,
    Warn,
    Critical,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Peek {
    pub kind: PeekKind,
    pub tone: Tone,
    pub title: String,
    pub subtitle: Option<String>,
    /// 0–1 for ring/battery visuals.
    pub value: Option<f64>,
    /// Badge shown on the right (e.g. "On").
    pub badge: Option<String>,
    pub sound: bool,
}

impl Peek {
    pub fn new(kind: PeekKind, tone: Tone, title: impl Into<String>) -> Self {
        Self {
            kind,
            tone,
            title: title.into(),
            subtitle: None,
            value: None,
            badge: None,
            sound: false,
        }
    }

    pub fn subtitle(mut self, subtitle: impl Into<String>) -> Self {
        self.subtitle = Some(subtitle.into());
        self
    }

    pub fn value(mut self, value: f64) -> Self {
        self.value = Some(value.clamp(0.0, 1.0));
        self
    }

    pub fn badge(mut self, badge: impl Into<String>) -> Self {
        self.badge = Some(badge.into());
        self
    }

    pub fn with_sound(mut self) -> Self {
        self.sound = true;
        self
    }
}

fn enabled(peeks: &settings::Peeks, kind: PeekKind) -> bool {
    match kind {
        PeekKind::CapsLock | PeekKind::NumLock => peeks.lock_keys,
        PeekKind::Charging | PeekKind::OnBattery | PeekKind::LowBattery => peeks.battery,
        PeekKind::AgentDone | PeekKind::AgentWaiting => peeks.agent,
        PeekKind::Usage | PeekKind::QuotaBack => peeks.usage,
        PeekKind::FocusDone => peeks.focus,
    }
}

pub fn show(app: &AppHandle, mut peek: Peek) {
    let peeks = settings::current(app).peeks;
    if !enabled(&peeks, peek.kind) {
        return;
    }
    peek.sound &= peeks.sound;
    if let Err(e) = app.emit(PEEK_EVENT, peek) {
        log::warn!("emit {PEEK_EVENT} failed: {e}");
    }
}

/// A Windows toast. Gated by the same per-type peek switch.
pub fn notify(app: &AppHandle, kind: PeekKind, title: &str, body: &str) {
    if !enabled(&settings::current(app).peeks, kind) {
        return;
    }
    if let Err(e) = app.notification().builder().title(title).body(body).show() {
        log::warn!("notification failed: {e}");
    }
}

/// Settings › General › "Try it": show a sample notification so you can see
/// how each kind looks. Always shown, whatever the per-type switches say.
#[tauri::command]
pub fn peek_test(app: AppHandle, kind: String) -> Result<(), String> {
    let peek = match kind.as_str() {
        "agentDone" => Peek::new(PeekKind::AgentDone, Tone::Good, "overlid finished")
            .subtitle("Claude Code · ran 1m 12s")
            .with_sound(),
        "agentWaiting" => Peek::new(PeekKind::AgentWaiting, Tone::Warn, "overlid needs you")
            .subtitle("Claude is asking: what day is it?")
            .with_sound(),
        "charging" => Peek::new(PeekKind::Charging, Tone::Good, "Charging").badge("64%").value(0.64),
        "usage" => Peek::new(PeekKind::Usage, Tone::Warn, "Claude Code 5-hour at 80 %")
            .subtitle("Resets in 1h 12m")
            .value(0.8),
        "capsLock" => Peek::new(PeekKind::CapsLock, Tone::Neutral, "Caps Lock").badge("On"),
        other => return Err(format!("unknown sample {other}")),
    };
    app.emit(PEEK_EVENT, peek).map_err(|e| e.to_string())
}
