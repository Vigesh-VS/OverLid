mod codenotch;
mod fullscreen;
mod media;
mod peek;
mod pomodoro;
mod settings;
mod system;
mod tray;
mod window;

use tauri::AppHandle;

/// Side effects of a settings change, applied after the new values are saved.
pub(crate) fn on_settings_changed(app: &AppHandle, old: &settings::Settings, new: &settings::Settings) {
    if old.general.monitor != new.general.monitor {
        window::reposition(app);
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
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let result = tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .manage(window::HitState::default())
        .invoke_handler(tauri::generate_handler![
            window::set_hit_rect,
            window::island_flags,
            window::list_monitors,
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
            codenotch::code_usage,
            codenotch::code_refresh_usage,
        ])
        .setup(|app| {
            let handle = app.handle();
            settings::init(handle);
            if let Err(e) = window::setup(handle) {
                log::error!("island window setup failed: {e:#}");
            }
            if let Err(e) = tray::setup(handle) {
                log::error!("tray setup failed: {e:#}");
            }
            media::start(handle);
            system::start(handle);
            fullscreen::start(handle);
            pomodoro::start(handle);
            codenotch::start(handle);
            Ok(())
        })
        .run(tauri::generate_context!());

    if let Err(e) = result {
        log::error!("overlid exited with error: {e}");
        eprintln!("overlid exited with error: {e}");
    }
}
