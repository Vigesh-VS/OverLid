//! Teleprompter: scripts, presenting state, global shortcuts and voice level.
//!
//! The scroll engine lives in the frontend; Rust tracks whether the prompter
//! is presenting (for content protection, full-screen handling and shortcut
//! registration) and forwards shortcut presses as `prompter://command`.

pub mod scripts;
pub mod voice;

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutEvent, ShortcutState};

use crate::settings::{self, Shortcuts};
use crate::window;

pub const COMMAND_EVENT: &str = "prompter://command";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Action {
    Toggle,
    /// Always stops, whatever state the prompter is in.
    Stop,
    PlayPause,
    Faster,
    Slower,
    Bigger,
    Smaller,
    PrevSection,
    NextSection,
}

/// Shortcuts currently registered, mapped to what they do.
#[derive(Default)]
pub struct Bindings(Mutex<Vec<(Shortcut, Action)>>);

pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| on_shortcut(app, shortcut, &event))
        .build()
}

pub fn init(app: &AppHandle) {
    app.manage(Bindings::default());
    voice::init(app);
    scripts::seed(app);
    rebind(app);
}

fn on_shortcut(app: &AppHandle, shortcut: &Shortcut, event: &ShortcutEvent) {
    if event.state != ShortcutState::Pressed {
        return;
    }
    let action = app.try_state::<Bindings>().and_then(|b| {
        b.0.lock()
            .ok()
            .and_then(|list| list.iter().find(|(s, _)| s == shortcut).map(|(_, a)| *a))
    });
    if let Some(action) = action
        && let Err(e) = app.emit(COMMAND_EVENT, action)
    {
        log::warn!("emit {COMMAND_EVENT} failed: {e}");
    }
}

fn wanted(keys: &Shortcuts, presenting: bool) -> Vec<(&str, Action)> {
    let mut list = vec![(keys.toggle.as_str(), Action::Toggle)];
    if presenting {
        list.extend([
            (keys.play_pause.as_str(), Action::PlayPause),
            (keys.faster.as_str(), Action::Faster),
            (keys.slower.as_str(), Action::Slower),
            (keys.bigger.as_str(), Action::Bigger),
            (keys.smaller.as_str(), Action::Smaller),
            (keys.prev_section.as_str(), Action::PrevSection),
            (keys.next_section.as_str(), Action::NextSection),
        ]);
    }
    list
}

/// Register Ctrl+Alt+P (or its replacement) always, and the presenting
/// shortcuts only while the prompter runs, so they never shadow other apps.
pub fn rebind(app: &AppHandle) {
    let Some(bindings) = app.try_state::<Bindings>() else { return };
    let gs = app.global_shortcut();
    let Ok(mut current) = bindings.0.lock() else { return };
    for (shortcut, _) in current.drain(..) {
        if let Err(e) = gs.unregister(shortcut) {
            log::debug!("unregister shortcut failed: {e}");
        }
    }
    let keys = settings::current(app).prompter.shortcuts;
    for (text, action) in wanted(&keys, window::flags(app).prompter) {
        if text.trim().is_empty() {
            continue;
        }
        let shortcut: Shortcut = match text.parse() {
            Ok(s) => s,
            Err(e) => {
                log::warn!("ignoring shortcut {text:?}: {e}");
                continue;
            }
        };
        match gs.register(shortcut) {
            Ok(()) => current.push((shortcut, action)),
            Err(e) => log::warn!("couldn't register {text:?} (in use by another app?): {e}"),
        }
    }
}

#[tauri::command]
pub fn prompter_set_active(app: AppHandle, active: bool) {
    window::set_prompter(&app, active);
    rebind(&app);
}

/// Emergency stop (tray): tell the frontend to stop, and drop the presenting
/// state in Rust too, so protection and shortcuts are released even if the
/// island UI is unresponsive.
pub fn force_stop(app: &AppHandle) {
    if let Err(e) = app.emit(COMMAND_EVENT, Action::Stop) {
        log::warn!("emit {COMMAND_EVENT} failed: {e}");
    }
    window::set_prompter(app, false);
    rebind(app);
}

/// Start presenting a script from any window (e.g. after importing in Settings).
#[tauri::command]
pub fn prompter_start(app: AppHandle, script_id: String) {
    if script_id.len() > 64 || !script_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        log::warn!("prompter_start: invalid script id refused");
        return;
    }
    if let Err(e) = app.emit(crate::quick_action::PROMPTER_START_EVENT, script_id) {
        log::warn!("couldn't start the prompter: {e}");
    }
}
