//! Live Claude Code session status (filled in by the hook server).

use tauri::AppHandle;

/// True while any agent session is working; speeds up usage polling.
pub fn any_busy(_app: &AppHandle) -> bool {
    false
}
