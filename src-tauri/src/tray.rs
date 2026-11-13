//! System tray icon and menu:
//! Settings · Game mode · Pause island · Start with Windows · Quit.

use std::thread;
use std::time::Duration;

use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, Wry};
use tauri_plugin_autostart::ManagerExt;

use crate::winreg::{self, Root};
use crate::{app_windows, window};

const TRAY_ID: &str = "main";
const PERSONALIZE: &str = r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";

// The tray uses the micro glyph, never the full logo: it's 16–32 px.
const WHITE_16: &[u8] = include_bytes!("../../assets/logo/app/overlid-icon-white-16.png");
const WHITE_24: &[u8] = include_bytes!("../../assets/logo/app/overlid-icon-white-24.png");
const WHITE_32: &[u8] = include_bytes!("../../assets/logo/app/overlid-icon-white-32.png");
const BLACK_16: &[u8] = include_bytes!("../../assets/logo/app/overlid-icon-black-16.png");
const BLACK_24: &[u8] = include_bytes!("../../assets/logo/app/overlid-icon-black-24.png");
const BLACK_32: &[u8] = include_bytes!("../../assets/logo/app/overlid-icon-black-32.png");

/// White glyph on a dark taskbar, black on a light one, sized for the DPI.
fn themed_icon(app: &AppHandle) -> Option<Image<'static>> {
    let light = winreg::read_dword(Root::CurrentUser, PERSONALIZE, "SystemUsesLightTheme") == Some(1);
    let scale = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|m| m.scale_factor())
        .unwrap_or(1.0);
    let bytes = match (light, scale) {
        (false, s) if s < 1.25 => WHITE_16,
        (false, s) if s < 1.75 => WHITE_24,
        (false, _) => WHITE_32,
        (true, s) if s < 1.25 => BLACK_16,
        (true, s) if s < 1.75 => BLACK_24,
        (true, _) => BLACK_32,
    };
    Image::from_bytes(bytes)
        .map_err(|e| log::warn!("tray icon decode failed: {e}"))
        .ok()
}

fn apply_theme(app: &AppHandle) {
    if let (Some(tray), Some(icon)) = (app.tray_by_id(TRAY_ID), themed_icon(app))
        && let Err(e) = tray.set_icon(Some(icon))
    {
        log::warn!("updating tray icon failed: {e}");
    }
}

/// Switch the tray icon live when Windows' taskbar theme changes.
fn watch_theme(app: &AppHandle) {
    let app = app.clone();
    let spawned = thread::Builder::new().name("tray-theme".into()).spawn(move || {
        loop {
            // Blocks until the Personalize key changes; poll slowly if it can't be watched.
            if !winreg::wait_for_change(Root::CurrentUser, PERSONALIZE) {
                thread::sleep(Duration::from_secs(10));
            }
            apply_theme(&app);
        }
    });
    if let Err(e) = spawned {
        log::warn!("could not watch the taskbar theme: {e}");
    }
}

const SETTINGS_ID: &str = "settings";
const STOP_PROMPTER_ID: &str = "stop-prompter";
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
    let stop_prompter = MenuItem::with_id(app, STOP_PROMPTER_ID, "Stop teleprompter", true, None::<&str>)?;
    let game = CheckMenuItem::with_id(app, GAME_ID, "Game mode", true, false, None::<&str>)?;
    let pause = CheckMenuItem::with_id(app, PAUSE_ID, "Pause island", true, false, None::<&str>)?;
    let autostart =
        CheckMenuItem::with_id(app, AUTOSTART_ID, "Start with Windows", true, autostart_on, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT_ID, "Quit Overlid", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[&settings, &stop_prompter, &sep1, &game, &pause, &autostart, &sep2, &quit],
    )?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Overlid")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            SETTINGS_ID => app_windows::open_settings(app),
            STOP_PROMPTER_ID => crate::teleprompter::force_stop(app),
            GAME_ID => window::set_game_mode(app, !window::flags(app).game_mode),
            PAUSE_ID => window::set_paused(app, !window::flags(app).paused),
            AUTOSTART_ID => {
                let on = app.autolaunch().is_enabled().unwrap_or(false);
                let _ = app_windows::set_autostart(app, !on);
            }
            QUIT_ID => app.exit(0),
            _ => {}
        });
    if let Some(icon) = themed_icon(app) {
        builder = builder.icon(icon);
    } else if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    app.manage(TrayItems { game, pause, autostart });
    watch_theme(app);
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
