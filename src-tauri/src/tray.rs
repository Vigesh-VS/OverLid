//! System tray icon and menu.

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, Wry};

use crate::window;

const QUIT_ID: &str = "quit";
const GAME_ID: &str = "game-mode";
const PAUSE_ID: &str = "pause";

pub struct TrayItems {
    game: CheckMenuItem<Wry>,
    pause: CheckMenuItem<Wry>,
}

pub fn setup(app: &AppHandle) -> anyhow::Result<()> {
    let game = CheckMenuItem::with_id(app, GAME_ID, "Game mode", true, false, None::<&str>)?;
    let pause = CheckMenuItem::with_id(app, PAUSE_ID, "Pause island", true, false, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT_ID, "Quit Overlid", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&game, &pause, &separator, &quit])?;

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("Overlid")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            QUIT_ID => app.exit(0),
            GAME_ID => window::set_game_mode(app, !window::flags(app).game_mode),
            PAUSE_ID => window::set_paused(app, !window::flags(app).paused),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    app.manage(TrayItems { game, pause });
    Ok(())
}

/// Keep check marks in sync when flags change from elsewhere.
pub fn sync(app: &AppHandle) {
    let Some(items) = app.try_state::<TrayItems>() else { return };
    let flags = window::flags(app);
    let _ = items.game.set_checked(flags.game_mode);
    let _ = items.pause.set_checked(flags.paused);
}
