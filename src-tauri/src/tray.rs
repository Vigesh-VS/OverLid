//! System tray icon and menu:
//! Settings · Game mode · Pause island · Start with Windows · Quit.

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, Wry};
use tauri_plugin_autostart::ManagerExt;

use crate::{app_windows, window};

const SETTINGS_ID: &str = "settings";
const GAME_ID: &str = "game-mode";
const PAUSE_ID: &str = "pause";
const AUTOSTART_ID: &str = "autostart";
const QUIT_ID: &str = "quit";

pub struct TrayItems {
    game: CheckMenuItem<Wry>,
    pause: CheckMenuItem<Wry>,
    autostart: CheckMenuItem<Wry>,
}

pub fn setup(app: &AppHandle) -> anyhow::Result<()> {
    let autostart_on = app.autolaunch().is_enabled().unwrap_or(false);
    let settings = MenuItem::with_id(app, SETTINGS_ID, "Settings…", true, None::<&str>)?;
    let game = CheckMenuItem::with_id(app, GAME_ID, "Game mode", true, false, None::<&str>)?;
    let pause = CheckMenuItem::with_id(app, PAUSE_ID, "Pause island", true, false, None::<&str>)?;
    let autostart =
        CheckMenuItem::with_id(app, AUTOSTART_ID, "Start with Windows", true, autostart_on, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT_ID, "Quit Overlid", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&settings, &sep1, &game, &pause, &autostart, &sep2, &quit])?;

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("Overlid")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            SETTINGS_ID => app_windows::open_settings(app),
            GAME_ID => window::set_game_mode(app, !window::flags(app).game_mode),
            PAUSE_ID => window::set_paused(app, !window::flags(app).paused),
            AUTOSTART_ID => {
                let on = app.autolaunch().is_enabled().unwrap_or(false);
                let _ = app_windows::set_autostart(app, !on);
            }
            QUIT_ID => app.exit(0),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    app.manage(TrayItems { game, pause, autostart });
    Ok(())
}

/// Keep check marks in sync when state changes from elsewhere.
pub fn sync(app: &AppHandle) {
    let Some(items) = app.try_state::<TrayItems>() else { return };
    let flags = window::flags(app);
    let _ = items.game.set_checked(flags.game_mode);
    let _ = items.pause.set_checked(flags.paused);
    let _ = items
        .autostart
        .set_checked(app.autolaunch().is_enabled().unwrap_or(false));
}
