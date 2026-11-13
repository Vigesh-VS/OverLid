//! The island window: placement, hit-rect click-through, visibility and
//! screen-capture protection.
//!
//! The native window never resizes; the pill animates inside it. The window
//! ignores the cursor by default, and a background loop turns that off only
//! while the cursor is inside the rect the frontend reports via `set_hit_rect`.

use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use anyhow::{Context, anyhow};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Monitor, PhysicalPosition, PhysicalSize, WebviewWindow};

use crate::settings::{self, CaptureMode};

pub const ISLAND_LABEL: &str = "island";
pub const HOVER_EVENT: &str = "island://hover";
pub const STATE_EVENT: &str = "island://state";

/// Logical size of the island window: room for the widest expanded panel or
/// the largest prompter, plus the corner ears.
const WINDOW_W: f64 = 820.0;
const WINDOW_H: f64 = 520.0;

const POLL_HOVERED: Duration = Duration::from_millis(16);
const POLL_IDLE: Duration = Duration::from_millis(66);

/// Rect in logical px, relative to the window's top-left.
#[derive(Debug, Clone, Copy, Default, Deserialize)]
pub struct HitRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IslandFlags {
    pub paused: bool,
    pub game_mode: bool,
    pub fullscreen: bool,
    pub prompter: bool,
}

#[derive(Default)]
pub struct HitState {
    rect: Mutex<HitRect>,
    flags: Mutex<IslandFlags>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    pub name: String,
    pub primary: bool,
    pub width: u32,
    pub height: u32,
}

#[tauri::command]
pub fn set_hit_rect(state: tauri::State<'_, HitState>, rect: HitRect) {
    match state.rect.lock() {
        Ok(mut current) => *current = rect,
        Err(e) => log::error!("hit rect lock poisoned: {e}"),
    }
}

#[tauri::command]
pub fn island_flags(state: tauri::State<'_, HitState>) -> IslandFlags {
    state.flags.lock().map(|f| *f).unwrap_or_default()
}

#[tauri::command]
pub fn list_monitors(app: AppHandle) -> Vec<MonitorInfo> {
    let Some(win) = app.get_webview_window(ISLAND_LABEL) else {
        return Vec::new();
    };
    let primary = win.primary_monitor().ok().flatten().and_then(|m| m.name().cloned());
    win.available_monitors()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|m| {
            let name = m.name()?.clone();
            Some(MonitorInfo {
                primary: primary.as_ref() == Some(&name),
                width: m.size().width,
                height: m.size().height,
                name,
            })
        })
        .collect()
}

pub fn setup(app: &AppHandle) -> anyhow::Result<()> {
    let win = island(app)?;
    reposition(app);
    win.set_ignore_cursor_events(true)?;
    apply_protection(app);
    win.show()?;
    spawn_hover_loop(app.clone(), win);
    Ok(())
}

fn island(app: &AppHandle) -> anyhow::Result<WebviewWindow> {
    app.get_webview_window(ISLAND_LABEL)
        .context("island window missing")
}

/// Anchor the window to the top centre of the chosen (or primary) monitor.
pub fn reposition(app: &AppHandle) {
    let result = island(app).and_then(|win| {
        let wanted = settings::current(app).general.monitor;
        let monitor = pick_monitor(&win, wanted.as_deref())?;
        place(&win, &monitor)
    });
    if let Err(e) = result {
        log::error!("positioning island failed: {e:#}");
    }
}

fn pick_monitor(win: &WebviewWindow, wanted: Option<&str>) -> anyhow::Result<Monitor> {
    if let Some(name) = wanted
        && let Some(m) = win
            .available_monitors()?
            .into_iter()
            .find(|m| m.name().map(String::as_str) == Some(name))
    {
        return Ok(m);
    }
    match win.primary_monitor()? {
        Some(m) => Ok(m),
        None => win.current_monitor()?.context("no monitor found"),
    }
}

fn place(win: &WebviewWindow, monitor: &Monitor) -> anyhow::Result<()> {
    let scale = monitor.scale_factor();
    let width = (WINDOW_W * scale).round() as u32;
    let height = (WINDOW_H * scale).round() as u32;
    let origin = monitor.position();
    let x = origin.x + (monitor.size().width as i32 - width as i32) / 2;
    // Move first so the window picks up the target monitor's DPI, then size.
    win.set_position(PhysicalPosition::new(x, origin.y))?;
    win.set_size(PhysicalSize::new(width, height))?;
    win.set_position(PhysicalPosition::new(x, origin.y))?;
    Ok(())
}

fn update_flags(app: &AppHandle, f: impl FnOnce(&mut IslandFlags)) {
    let Some(state) = app.try_state::<HitState>() else { return };
    let flags = match state.flags.lock() {
        Ok(mut flags) => {
            let before = *flags;
            f(&mut flags);
            if *flags == before {
                return;
            }
            *flags
        }
        Err(e) => {
            log::error!("island flags lock poisoned: {e}");
            return;
        }
    };
    apply_visibility(app, flags);
    apply_protection(app);
    crate::tray::sync(app);
    let _ = app.emit(STATE_EVENT, flags);
}

pub fn flags(app: &AppHandle) -> IslandFlags {
    app.try_state::<HitState>()
        .and_then(|s| s.flags.lock().ok().map(|f| *f))
        .unwrap_or_default()
}

pub fn set_fullscreen(app: &AppHandle, on: bool) {
    update_flags(app, |f| f.fullscreen = on);
}

pub fn set_paused(app: &AppHandle, on: bool) {
    update_flags(app, |f| f.paused = on);
}

pub fn set_game_mode(app: &AppHandle, on: bool) {
    update_flags(app, |f| f.game_mode = on);
}

pub fn set_prompter(app: &AppHandle, on: bool) {
    update_flags(app, |f| f.prompter = on);
}

pub fn game_mode(app: &AppHandle) -> bool {
    flags(app).game_mode
}

fn apply_visibility(app: &AppHandle, flags: IslandFlags) {
    let hidden = flags.paused || (flags.fullscreen && !flags.prompter);
    let Ok(win) = island(app) else { return };
    let result = if hidden { win.hide() } else { win.show() };
    if let Err(e) = result {
        log::warn!("island show/hide failed: {e}");
    }
}

/// Exclude the island from screen capture according to the setting. While
/// the prompter runs it is protected unless the user chose "never".
pub fn apply_protection(app: &AppHandle) {
    let mode = settings::current(app).general.hide_from_capture;
    let prompter = flags(app).prompter;
    let protect = match mode {
        CaptureMode::Always => true,
        CaptureMode::PrompterOnly => prompter,
        CaptureMode::Never => false,
    };
    if let Ok(win) = island(app)
        && let Err(e) = win.set_content_protected(protect)
    {
        log::warn!("set_content_protected failed: {e}");
    }
}

fn spawn_hover_loop(app: AppHandle, win: WebviewWindow) {
    let spawned = thread::Builder::new().name("hover".into()).spawn(move || {
        let mut inside = false;
        loop {
            thread::sleep(if inside { POLL_HOVERED } else { POLL_IDLE });
            let now = match cursor_in_hit_rect(&app, &win) {
                Ok(now) => now,
                Err(e) => {
                    log::debug!("hit test skipped: {e:#}");
                    continue;
                }
            };
            if now == inside {
                continue;
            }
            inside = now;
            if let Err(e) = win.set_ignore_cursor_events(!inside) {
                log::warn!("set_ignore_cursor_events failed: {e}");
            }
            if let Err(e) = app.emit(HOVER_EVENT, inside) {
                log::warn!("emit {HOVER_EVENT} failed: {e}");
            }
        }
    });
    if let Err(e) = spawned {
        log::error!("could not spawn hover loop: {e}");
    }
}

fn cursor_in_hit_rect(app: &AppHandle, win: &WebviewWindow) -> anyhow::Result<bool> {
    let rect = *app
        .state::<HitState>()
        .rect
        .lock()
        .map_err(|e| anyhow!("hit rect lock poisoned: {e}"))?;
    if rect.width <= 0.0 || rect.height <= 0.0 {
        return Ok(false);
    }

    // Cursor and window origin are both physical px; the rect is logical.
    let cursor = app.cursor_position()?;
    let origin = win.inner_position()?;
    let scale = win.scale_factor()?;

    let left = f64::from(origin.x) + rect.x * scale;
    let top = f64::from(origin.y) + rect.y * scale;
    let right = left + rect.width * scale;
    let bottom = top + rect.height * scale;

    Ok(cursor.x >= left && cursor.x < right && cursor.y >= top && cursor.y < bottom)
}
