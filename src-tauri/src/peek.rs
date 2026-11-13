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
