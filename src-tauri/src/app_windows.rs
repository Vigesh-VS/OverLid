//! The Settings window, plus small app-level commands (autostart, links).

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_dialog::DialogExt;

pub const SETTINGS_LABEL: &str = "settings";
/// Passed by the Start-with-Windows entry so login launches stay quiet.
pub const AUTOSTART_ARG: &str = "--autostart";
/// The one place the project URL lives. All support goes through GitHub.
pub const REPO_URL: &str = "https://github.com/Vigesh-VS/overlid";
const SPONSOR_URL: &str = "https://github.com/sponsors/Vigesh-VS";
const AUTHOR_URL: &str = "https://github.com/Vigesh-VS";

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
    // Let the page receive HTML5 file drops (script import).
    .disable_drag_drop_handler()
    .build();
    if let Err(e) = built {
        log::error!("couldn't open settings: {e}");
    }
}

/// A normal launch (Start menu, shortcut) opens the home/settings window so
/// it's obvious Overlid is running; a login launch just starts the island.
pub fn on_launch(app: &AppHandle) {
    let launcher = app.autolaunch();
    // Re-register so older entries pick up the --autostart argument.
    if launcher.is_enabled().unwrap_or(false)
        && let Err(e) = launcher.enable()
    {
        log::debug!("refreshing autostart entry failed: {e}");
    }
    if !std::env::args().any(|a| a == AUTOSTART_ARG) {
        open_settings(app);
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

/// Open one of the project's GitHub pages. Only these fixed links can be opened.
#[tauri::command]
pub fn open_link(kind: String) -> Result<(), String> {
    let url = match kind.as_str() {
        "repo" | "star" => REPO_URL.to_owned(),
        "bug" => format!("{REPO_URL}/issues/new?template=bug_report.yml"),
        "feature" => format!("{REPO_URL}/issues/new?template=feature_request.yml"),
        "discussions" => format!("{REPO_URL}/discussions"),
        "releases" => format!("{REPO_URL}/releases"),
        "sponsor" => SPONSOR_URL.to_owned(),
        "author" => AUTHOR_URL.to_owned(),
        other => return Err(format!("unknown link {other}")),
    };
    std::process::Command::new("explorer")
        .arg(&url)
        .spawn()
        .map(|_| ())
        .map_err(|e| {
            log::warn!("opening {url} failed: {e}");
            "couldn't open the browser".to_owned()
        })
}

#[tauri::command]
pub fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

/// Pick an .exe (for selected apps and the quick action). Returns its path.
#[tauri::command]
pub async fn pick_exe(app: AppHandle) -> Option<String> {
    app.dialog()
        .file()
        .set_title("Choose an app")
        .add_filter("Apps", &["exe"])
        .blocking_pick_file()
        .and_then(|f| f.into_path().ok())
        .map(|p| p.display().to_string())
}

/// Pick a folder (for the quick action). Returns its path.
#[tauri::command]
pub async fn pick_folder(app: AppHandle) -> Option<String> {
    app.dialog()
        .file()
        .set_title("Choose a folder")
        .blocking_pick_folder()
        .and_then(|f| f.into_path().ok())
        .map(|p| p.display().to_string())
}
