//! The island window: top-centre placement and hit-rect click-through.
//!
//! The native window never resizes; the pill animates inside it. The window
//! ignores the cursor by default, and a background loop turns that off only
//! while the cursor is inside the rect the frontend reports via `set_hit_rect`.

use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use anyhow::{Context, anyhow};
use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

pub const ISLAND_LABEL: &str = "island";
pub const HOVER_EVENT: &str = "island://hover";

/// Logical size of the island window. Large enough for the expanded island
/// plus its corner ears; the prompter will grow this in Phase 6.
const WINDOW_W: f64 = 720.0;
const WINDOW_H: f64 = 440.0;

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

#[derive(Default)]
pub struct HitState {
    rect: Mutex<HitRect>,
}

#[tauri::command]
pub fn set_hit_rect(state: tauri::State<'_, HitState>, rect: HitRect) {
    match state.rect.lock() {
        Ok(mut current) => *current = rect,
        Err(e) => log::error!("hit rect lock poisoned: {e}"),
    }
}

pub fn setup(app: &AppHandle) -> anyhow::Result<()> {
    let win = app
        .get_webview_window(ISLAND_LABEL)
        .context("island window missing")?;
    position_top_centre(&win)?;
    win.set_ignore_cursor_events(true)?;
    win.show()?;
    spawn_hover_loop(app.clone(), win);
    Ok(())
}

fn position_top_centre(win: &WebviewWindow) -> anyhow::Result<()> {
    let monitor = match win.primary_monitor()? {
        Some(m) => m,
        None => win.current_monitor()?.context("no monitor found")?,
    };
    let scale = monitor.scale_factor();
    let width = (WINDOW_W * scale).round() as u32;
    let height = (WINDOW_H * scale).round() as u32;
    win.set_size(PhysicalSize::new(width, height))?;

    let origin = monitor.position();
    let x = origin.x + (monitor.size().width as i32 - width as i32) / 2;
    win.set_position(PhysicalPosition::new(x, origin.y))?;
    Ok(())
}

fn spawn_hover_loop(app: AppHandle, win: WebviewWindow) {
    thread::spawn(move || {
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
