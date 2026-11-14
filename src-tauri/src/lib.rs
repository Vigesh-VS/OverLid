mod ambient;
mod app_windows;
mod clipboard;
mod codenotch;
mod foreground;
mod fullscreen;
mod media;
mod net;
mod peek;
mod pomodoro;
mod quick_action;
mod redact;
mod secret;
mod settings;
mod system;
mod teleprompter;
mod tray;
mod window;
mod winreg;

use tauri::AppHandle;

/// Side effects of a settings change, applied after the new values are saved.
pub(crate) fn on_settings_changed(app: &AppHandle, old: &settings::Settings, new: &settings::Settings) {
    let (o, n) = (&old.general, &new.general);
    if o.position != n.position || o.offset_x != n.offset_x || o.ui_scale != n.ui_scale {
        window::reposition(app);
        window::refresh_attention_dot(app);
    }
    if o.clipboard_history && !n.clipboard_history {
        clipboard::clear(app);
    }
    if o.visibility != n.visibility || o.selected_apps != n.selected_apps {
        foreground::apply(app);
    }
    if old.general.hide_from_capture != new.general.hide_from_capture {
        window::apply_protection(app);
    }
    if old.focus != new.focus {
        pomodoro::on_config_changed(app);
    }
    if old.code != new.code {
        codenotch::refresh_now(app);
    }
    if old.code.port != new.code.port {
        codenotch::hook_server::restart(app);
    }
    if old.general.debug_logging != new.general.debug_logging {
        apply_log_level(new.general.debug_logging);
    }
    if old.prompter.shortcuts != new.prompter.shortcuts {
        teleprompter::rebind(app);
    }
}

/// Info by default; debug only when the user turns it on in Settings.
fn apply_log_level(debug: bool) {
    log::set_max_level(if debug { log::LevelFilter::Debug } else { log::LevelFilter::Info });
}

/// Crash messages go to the log, redacted, instead of a raw dump.
fn install_panic_hook() {
    std::panic::set_hook(Box::new(|info| {
        let place = info.location().map(|l| format!("{}:{}", l.file(), l.line())).unwrap_or_default();
        let message = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| (*s).to_owned())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_default();
        log::error!("panic at {place}: {}", redact::redact(&message));
    }));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_panic_hook();
    // The uninstaller runs `overlid.exe --remove-hooks` to take Overlid's
    // hooks out of Claude Code's settings. Nothing else starts.
    if std::env::args().any(|a| a == codenotch::hook_installer::REMOVE_HOOKS_ARG) {
        std::process::exit(codenotch::hook_installer::remove_for_uninstall());
    }
    let result = tauri::Builder::default()
        // Must be first: a second launch just opens Settings in the running app.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            app_windows::open_settings(app);
        }))
        .plugin(
            tauri_plugin_log::Builder::new()
                // Debug records are kept so the Settings toggle can turn them on;
                // the effective level is set by `apply_log_level`.
                .level(log::LevelFilter::Debug)
                .level_for("reqwest", log::LevelFilter::Warn)
                .level_for("hyper_util", log::LevelFilter::Warn)
                .max_file_size(1_000_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(4))
                // Every line is redacted before it's written anywhere.
                .format(|out, message, record| {
                    out.finish(format_args!(
                        "[{}][{}][{}] {}",
                        chrono::Local::now().format("%Y-%m-%d %H:%M:%S"),
                        record.level(),
                        record.target(),
                        redact::redact(&message.to_string())
                    ))
                })
                .build(),
        )
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![app_windows::AUTOSTART_ARG]),
        ))
        .plugin(teleprompter::plugin())
        .manage(window::HitState::default())
        .invoke_handler(tauri::generate_handler![
            window::set_hit_rect,
            peek::peek_test,
            clipboard::clipboard_list,
            clipboard::clipboard_copy,
            clipboard::clipboard_remove,
            clipboard::clipboard_clear,
            window::island_set_extent,
            window::island_flags,
            app_windows::open_settings_window,
            foreground::list_running_apps,
            app_windows::autostart_get,
            app_windows::autostart_set,
            app_windows::open_link,
            app_windows::pick_exe,
            app_windows::pick_folder,
            app_windows::app_version,
            settings::settings_get,
            settings::settings_set,
            media::media_get,
            media::media_play_pause,
            media::media_next,
            media::media_previous,
            media::media_seek,
            media::media_cycle_session,
            system::system_get,
            system::system_keys,
            system::system_set_stats_active,
            pomodoro::pomo_get,
            pomodoro::pomo_start,
            pomodoro::pomo_pause,
            pomodoro::pomo_skip,
            pomodoro::pomo_reset,
            pomodoro::pomo_history,
            pomodoro::pomo_set_length,
            codenotch::code_usage,
            codenotch::code_refresh_usage,
            codenotch::code_hook_status,
            codenotch::code_providers,
            codenotch::code_detect,
            codenotch::code_connect_provider,
            codenotch::code_disconnect_provider,
            codenotch::code_set_primary,
            codenotch::code_connect,
            codenotch::code_disconnect,
            codenotch::sessions::code_sessions,
            codenotch::sessions::code_open_folder,
            codenotch::sessions::code_dismiss,
            quick_action::quick_action_run,
            quick_action::app_icon,
            quick_action::list_installed_apps,
            ambient::ambient_wallpaper,
            teleprompter::prompter_set_active,
            teleprompter::prompter_start,
            teleprompter::scripts::scripts_list,
            teleprompter::scripts::script_create,
            teleprompter::scripts::script_save,
            teleprompter::scripts::script_delete,
            teleprompter::scripts::script_duplicate,
            teleprompter::scripts::script_export,
            teleprompter::voice::voice_start,
            teleprompter::voice::voice_stop,
            teleprompter::voice::voice_devices,
            teleprompter::voice::voice_privacy,
        ])
        .setup(|app| {
            let handle = app.handle();
            settings::init(handle);
            apply_log_level(settings::current(handle).general.debug_logging);
            // Start every module (and register its state) before the island
            // is shown, so the page never asks for state that isn't there yet.
            media::start(handle);
            system::start(handle);
            fullscreen::start(handle);
            foreground::start(handle);
            ambient::start(handle);
            pomodoro::start(handle);
            clipboard::start(handle);
            codenotch::sessions::start(handle);
            codenotch::hook_server::start(handle);
            codenotch::start(handle);
            teleprompter::init(handle);
            if let Err(e) = tray::setup(handle) {
                log::error!("tray setup failed: {e:#}");
            }
            if let Err(e) = window::setup(handle) {
                log::error!("island window setup failed: {e:#}");
            }
            app_windows::on_launch(handle);
            Ok(())
        })
        .run(tauri::generate_context!());

    if let Err(e) = result {
        log::error!("overlid exited with error: {e}");
        eprintln!("overlid exited with error: {e}");
    }
}
