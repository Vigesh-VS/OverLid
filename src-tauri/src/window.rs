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
use tauri::{
    AppHandle, Emitter, Manager, Monitor, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

use crate::settings::{self, CaptureMode, Position};

pub const ISLAND_LABEL: &str = "island";
pub const DOT_LABEL: &str = "dot";
/// Logical size of the "agent needs you" dot window shown while the island is hidden.
const DOT_W: f64 = 36.0;
const DOT_H: f64 = 14.0;
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

pub fn setup(app: &AppHandle) -> anyhow::Result<()> {
    let win = island(app)?;
    reposition(app);
    win.set_ignore_cursor_events(true)?;
    apply_protection(app);
    win.show()?;
    spawn_hover_loop(app.clone(), win);
    create_dot(app);
    Ok(())
}

/// The tiny amber dot that stays at the top edge when the island is hidden
/// but an agent needs you. Created hidden up front: building windows later
/// from a sync command can deadlock WebView2.
fn create_dot(app: &AppHandle) {
    let built = WebviewWindowBuilder::new(app, DOT_LABEL, WebviewUrl::App("index.html?window=dot".into()))
        .title("Overlid")
        .inner_size(DOT_W, DOT_H)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .visible(false)
        .build();
    if let Err(e) = built {
        log::warn!("couldn't create the attention dot: {e}");
    }
}

/// Show the dot only while the island is hidden and an agent is waiting.
pub fn refresh_attention_dot(app: &AppHandle) {
    let Some(dot) = app.get_webview_window(DOT_LABEL) else { return };
    let f = flags(app);
    let hidden = f.paused || (f.fullscreen && !f.prompter);
    let show = hidden && crate::codenotch::sessions::needs_attention(app).is_some();
    let result = if show {
        place_dot(app, &dot).and_then(|()| {
            dot.show()?;
            Ok(())
        })
    } else {
        dot.hide().map_err(Into::into)
    };
    if let Err(e) = result {
        log::debug!("attention dot update failed: {e:#}");
    }
}

fn place_dot(app: &AppHandle, dot: &WebviewWindow) -> anyhow::Result<()> {
    let island = island(app)?;
    let monitor = match island.primary_monitor()? {
        Some(m) => m,
        None => island.current_monitor()?.context("no monitor found")?,
    };
    let general = settings::current(app).general;
    let scale = monitor.scale_factor();
    let w = (DOT_W * scale).round() as i32;
    let origin = monitor.position();
    let monitor_w = monitor.size().width as i32;
    let offset = (f64::from(general.offset_x) * scale).round() as i32;
    let edge = (60.0 * scale).round() as i32;
    let x = match general.position {
        Position::Center => origin.x + (monitor_w - w) / 2 + offset,
        Position::Left => origin.x + offset.max(0) + edge,
        Position::Right => origin.x + monitor_w - w - offset.max(0) - edge,
    };
    dot.set_size(PhysicalSize::new(w.max(1) as u32, (DOT_H * scale).round() as u32))?;
    dot.set_position(PhysicalPosition::new(x, origin.y))?;
    Ok(())
}

fn island(app: &AppHandle) -> anyhow::Result<WebviewWindow> {
    app.get_webview_window(ISLAND_LABEL)
        .context("island window missing")
}

/// Anchor the window to the main monitor's top edge: centre, left or right
/// corner, nudged by the horizontal offset. The frontend aligns the island
/// inside the window to match.
pub fn reposition(app: &AppHandle) {
    let result = island(app).and_then(|win| {
        let monitor = match win.primary_monitor()? {
            Some(m) => m,
            None => win.current_monitor()?.context("no monitor found")?,
        };
        place(&win, &monitor, &settings::current(app).general)
    });
    if let Err(e) = result {
        log::error!("positioning island failed: {e:#}");
    }
}

fn place(win: &WebviewWindow, monitor: &Monitor, general: &settings::General) -> anyhow::Result<()> {
    // Window grows with the island's own UI scale so nothing gets clipped.
    let scale = monitor.scale_factor() * general.ui_scale;
    let width = (WINDOW_W * scale).round() as i32;
    let height = (WINDOW_H * scale).round() as u32;
    let origin = monitor.position();
    let monitor_w = monitor.size().width as i32;
    let offset = (f64::from(general.offset_x) * monitor.scale_factor()).round() as i32;
    let x = match general.position {
        Position::Center => origin.x + (monitor_w - width) / 2 + offset,
        Position::Left => origin.x + offset.max(0),
        Position::Right => origin.x + monitor_w - width - offset.max(0),
    };
    // Move first so the window picks up the target monitor's DPI, then size.
    win.set_position(PhysicalPosition::new(x, origin.y))?;
    win.set_size(PhysicalSize::new(width.max(1) as u32, height))?;
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
    crate::foreground::apply(app);
    refresh_attention_dot(app);
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
