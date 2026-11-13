//! The Settings window, plus small app-level commands (autostart, links).

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_autostart::ManagerExt;

pub const SETTINGS_LABEL: &str = "settings";
const REPO_URL: &str = "https://github.com/Vigesh-VS/OverLid";

/// Show the Settings window, creating it on first use.
pub fn open_settings(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(SETTINGS_LABEL) {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
        return;
    }
    let built = WebviewWindowBuilder::new(
        app,
        SETTINGS_LABEL,
        WebviewUrl::App("index.html?window=settings".into()),
    )
    .title("Overlid Settings")
    .inner_size(920.0, 640.0)
    .min_inner_size(760.0, 520.0)
    .center()
    .focused(true)
    .build();
    if let Err(e) = built {
        log::error!("couldn't open settings: {e}");
    }
}

// Window creation must not run on the main thread from a sync command on
// Windows (it can deadlock WebView2), so this one is async.
#[tauri::command]
pub async fn open_settings_window(app: AppHandle) {
    open_settings(&app);
}

#[tauri::command]
pub fn autostart_get(app: AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
pub fn autostart_set(app: AppHandle, enabled: bool) -> Result<bool, String> {
    set_autostart(&app, enabled)
}

pub fn set_autostart(app: &AppHandle, enabled: bool) -> Result<bool, String> {
    let launcher = app.autolaunch();
    let result = if enabled { launcher.enable() } else { launcher.disable() };
    if let Err(e) = result {
        log::warn!("autostart change failed: {e}");
        return Err(e.to_string());
    }
    crate::tray::sync(app);
    Ok(launcher.is_enabled().unwrap_or(enabled))
}

/// Open the project page in the default browser. The URL is fixed.
#[tauri::command]
pub fn open_repo() {
    if let Err(e) = std::process::Command::new("explorer").arg(REPO_URL).spawn() {
        log::warn!("opening the repo page failed: {e}");
    }
}

#[tauri::command]
pub fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}
