//! System tray icon. Phase 0 only has Quit; Settings, Game mode, Pause island
//! and Start with Windows arrive in later phases.

use tauri::AppHandle;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;

const QUIT_ID: &str = "quit";

pub fn setup(app: &AppHandle) -> anyhow::Result<()> {
    let quit = MenuItem::with_id(app, QUIT_ID, "Quit Overlid", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&quit])?;

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("Overlid")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| {
            if event.id() == QUIT_ID {
                app.exit(0);
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}
