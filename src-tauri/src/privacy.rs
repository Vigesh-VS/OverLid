//! Settings › Privacy › "Clear all Overlid data".
//!
//! Removes everything Overlid keeps on this PC: settings, scripts, focus
//! history, logs, the clipboard history in memory and the hook token in
//! Credential Manager. Optionally disconnects the Claude Code hooks too
//! (their settings.json backups are kept). Start with Windows is left as is.

use std::fs;

use tauri::{AppHandle, Manager};

use crate::{clipboard, codenotch, pomodoro, settings, teleprompter};

#[tauri::command]
pub fn privacy_clear_all(app: AppHandle, disconnect_hooks: bool) -> Result<(), String> {
    let mut failed = Vec::new();

    if disconnect_hooks
        && let Err(e) = codenotch::hook_installer::uninstall(codenotch::hook_server::bound_port(&app))
    {
        log::warn!("clear data: removing hooks failed: {e:#}");
        failed.push("Claude Code hooks");
    }
    clipboard::clear(&app);
    pomodoro::clear_history(&app);
    if let Err(e) = teleprompter::scripts::clear_all(&app) {
        log::warn!("clear data: removing scripts failed: {e:#}");
        failed.push("scripts");
    }
    // Back to defaults, but don't show the first-run screen again.
    let mut fresh = settings::Settings::default();
    fresh.general.welcome_seen = true;
    settings::replace(&app, fresh);

    // The running hook server keeps its token in memory until restart; a
    // new one is made then (and any installed hooks are updated to it).
    codenotch::hook_token::delete();

    if let Ok(dir) = app.path().app_log_dir()
        && let Ok(entries) = fs::read_dir(&dir)
    {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().is_some_and(|e| e == "log") {
                // The current log is open; emptying it works where deleting may not.
                if fs::remove_file(&path).is_err() {
                    let _ = fs::OpenOptions::new().write(true).truncate(true).open(&path);
                }
            }
        }
    }
    log::info!("cleared all Overlid data");

    if failed.is_empty() {
        Ok(())
    } else {
        Err(format!("Everything else was cleared, but these couldn't be: {}.", failed.join(", ")))
    }
}
