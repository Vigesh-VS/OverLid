//! Visibility modes: always on top, on top only over selected apps, or a
//! normal window. "Selected apps" follows the foreground window with
//! `SetWinEventHook(EVENT_SYSTEM_FOREGROUND)`: event-driven, no polling.

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::{Mutex, OnceLock};

use serde::Serialize;
use tauri::{AppHandle, Manager};
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM};
use windows::Win32::UI::Accessibility::{HWINEVENTHOOK, SetWinEventHook};
use windows::Win32::UI::WindowsAndMessaging::{
    EVENT_SYSTEM_FOREGROUND, EnumWindows, GetForegroundWindow, GetWindowTextLengthW, GetWindowThreadProcessId,
    IsWindowVisible, WINEVENT_OUTOFCONTEXT,
};
use windows::Win32::System::Threading::{
    OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
};
use windows::core::{BOOL, PWSTR};

use crate::settings::{self, Visibility};
use crate::window::ISLAND_LABEL;

static APP: OnceLock<AppHandle> = OnceLock::new();
/// Exe file name (lower case) of the last foreground window that wasn't ours.
static FOREGROUND: Mutex<String> = Mutex::new(String::new());

fn exe_path(hwnd: HWND) -> Option<String> {
    let mut pid = 0u32;
    // SAFETY: read-only queries; the process handle is closed below.
    unsafe {
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 {
            return None;
        }
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len);
        let _ = CloseHandle(process);
        ok.ok()?;
        Some(String::from_utf16_lossy(&buf[..len as usize]))
    }
}

fn exe_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default()
}

unsafe extern "system" fn on_foreground(
    _hook: HWINEVENTHOOK,
    _event: u32,
    hwnd: HWND,
    _id_object: i32,
    _id_child: i32,
    _thread: u32,
    _time: u32,
) {
    let Some(app) = APP.get() else { return };
    let Some(path) = exe_path(hwnd) else { return };
    let name = exe_name(&path);
    // Clicking our own island or settings shouldn't change anything.
    let own = std::env::current_exe().ok().map(|p| exe_name(&p.to_string_lossy()));
    if own.as_deref() == Some(name.as_str()) {
        return;
    }
    if let Ok(mut fg) = FOREGROUND.lock() {
        *fg = name;
    }
    apply(app);
}

/// Install the foreground hook (on the UI thread, which pumps messages) and
/// apply the current mode.
pub fn start(app: &AppHandle) {
    let _ = APP.set(app.clone());
    // SAFETY: GetForegroundWindow has no preconditions.
    if let Some(path) = exe_path(unsafe { GetForegroundWindow() })
        && let Ok(mut fg) = FOREGROUND.lock()
    {
        *fg = exe_name(&path);
    }
    let dispatched = app.run_on_main_thread(|| {
        // SAFETY: out-of-context hook with a static callback; lives for the process.
        let hook = unsafe {
            SetWinEventHook(
                EVENT_SYSTEM_FOREGROUND,
                EVENT_SYSTEM_FOREGROUND,
                None,
                Some(on_foreground),
                0,
                0,
                WINEVENT_OUTOFCONTEXT,
            )
        };
        if hook.is_invalid() {
            log::warn!("foreground hook unavailable; \"only over selected apps\" falls back to always on top");
        }
    });
    if let Err(e) = dispatched {
        log::warn!("couldn't install foreground hook: {e}");
    }
    apply(app);
}

/// Set the island's topmost state for the current mode and foreground app.
pub fn apply(app: &AppHandle) {
    let general = settings::current(app).general;
    let on_top = match general.visibility {
        Visibility::AlwaysOnTop => true,
        Visibility::Normal => false,
        Visibility::SelectedApps => FOREGROUND
            .lock()
            .map(|fg| general.selected_apps.contains(&*fg))
            .unwrap_or(true),
    };
    // The prompter always stays on top while presenting.
    let on_top = on_top || crate::window::flags(app).prompter;
    if let Some(win) = app.get_webview_window(ISLAND_LABEL)
        && let Err(e) = win.set_always_on_top(on_top)
    {
        log::warn!("set_always_on_top failed: {e}");
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunningApp {
    pub name: String,
    pub exe: String,
    pub path: String,
}

unsafe extern "system" fn collect(hwnd: HWND, lparam: LPARAM) -> BOOL {
    // SAFETY: lparam is the &mut BTreeMap passed by running_apps below.
    let found = unsafe { &mut *(lparam.0 as *mut BTreeMap<String, String>) };
    // SAFETY: read-only window queries.
    let visible = unsafe { IsWindowVisible(hwnd).as_bool() && GetWindowTextLengthW(hwnd) > 0 };
    if visible && let Some(path) = exe_path(hwnd) {
        found.entry(exe_name(&path)).or_insert(path);
    }
    BOOL(1)
}

/// Apps with a visible window right now, for the "selected apps" picker.
#[tauri::command]
pub fn list_running_apps() -> Vec<RunningApp> {
    let mut found: BTreeMap<String, String> = BTreeMap::new();
    // SAFETY: the callback only runs during this call and gets &mut found.
    let _ = unsafe { EnumWindows(Some(collect), LPARAM(&raw mut found as isize)) };
    let own = std::env::current_exe().ok().map(|p| exe_name(&p.to_string_lossy()));
    found
        .into_iter()
        .filter(|(exe, _)| Some(exe) != own.as_ref() && exe != "explorer.exe" && exe != "applicationframehost.exe")
        .map(|(exe, path)| RunningApp {
            name: Path::new(&path)
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| exe.clone()),
            exe,
            path,
        })
        .collect()
}
