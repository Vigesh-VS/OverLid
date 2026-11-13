//! Hides the island while a full-screen app, game or presentation is up.
//!
//! Polls `SHQueryUserNotificationState` every 2 s. In Game mode it also treats
//! any foreground window that covers its whole monitor (borderless games) as
//! full-screen.

use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Emitter};
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MONITOR_DEFAULTTONEAREST, MONITORINFO, MonitorFromWindow};
use windows::Win32::UI::Shell::{
    QUNS_BUSY, QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN, SHQueryUserNotificationState,
};
use windows::Win32::UI::WindowsAndMessaging::{GetClassNameW, GetForegroundWindow, GetShellWindow, GetWindowRect};

use crate::window;

pub const CHANGED_EVENT: &str = "fullscreen://changed";

pub fn start(app: &AppHandle) {
    let app = app.clone();
    let spawned = thread::Builder::new()
        .name("fullscreen".into())
        .spawn(move || {
            let mut last = false;
            loop {
                thread::sleep(Duration::from_secs(2));
                let now = system_says_busy() || (window::game_mode(&app) && foreground_covers_monitor());
                if now != last {
                    last = now;
                    window::set_fullscreen(&app, now);
                    if let Err(e) = app.emit(CHANGED_EVENT, now) {
                        log::warn!("emit {CHANGED_EVENT} failed: {e}");
                    }
                }
            }
        });
    if let Err(e) = spawned {
        log::error!("could not spawn fullscreen watcher: {e}");
    }
}

fn system_says_busy() -> bool {
    // SAFETY: no preconditions.
    match unsafe { SHQueryUserNotificationState() } {
        Ok(state) => {
            state == QUNS_BUSY || state == QUNS_RUNNING_D3D_FULL_SCREEN || state == QUNS_PRESENTATION_MODE
        }
        Err(e) => {
            log::debug!("SHQueryUserNotificationState failed: {e}");
            false
        }
    }
}

fn foreground_covers_monitor() -> bool {
    // SAFETY: read-only Win32 queries on the current foreground window.
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_invalid() || hwnd == GetShellWindow() || is_desktop(hwnd) {
            return false;
        }
        let mut rect = RECT::default();
        if GetWindowRect(hwnd, &mut rect).is_err() {
            return false;
        }
        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO {
            cbSize: size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !GetMonitorInfoW(monitor, &mut info).as_bool() {
            return false;
        }
        let m = info.rcMonitor;
        rect.left <= m.left && rect.top <= m.top && rect.right >= m.right && rect.bottom >= m.bottom
    }
}

/// The desktop background windows also "cover" the monitor; ignore them.
unsafe fn is_desktop(hwnd: HWND) -> bool {
    let mut buf = [0u16; 64];
    // SAFETY: buffer is valid for its length.
    let len = unsafe { GetClassNameW(hwnd, &mut buf) };
    let class = String::from_utf16_lossy(&buf[..usize::try_from(len).unwrap_or(0)]);
    matches!(class.as_str(), "WorkerW" | "Progman")
}
