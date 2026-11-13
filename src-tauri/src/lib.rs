mod media;
mod tray;
mod window;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let result = tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .manage(window::HitState::default())
        .invoke_handler(tauri::generate_handler![
            window::set_hit_rect,
            media::media_get,
            media::media_play_pause,
            media::media_next,
            media::media_previous,
            media::media_seek,
            media::media_cycle_session,
        ])
        .setup(|app| {
            let handle = app.handle();
            if let Err(e) = window::setup(handle) {
                log::error!("island window setup failed: {e:#}");
            }
            if let Err(e) = tray::setup(handle) {
                log::error!("tray setup failed: {e:#}");
            }
            media::start(handle);
            Ok(())
        })
        .run(tauri::generate_context!());

    if let Err(e) = result {
        log::error!("overlid exited with error: {e}");
        eprintln!("overlid exited with error: {e}");
    }
}
