//! CPU / RAM / disk / battery stats and Caps Lock / Num Lock state.
//!
//! Stats tick every 2 s while the Stats panel is open, every 10 s otherwise.
//! Battery is read every 5 s. Lock keys are polled with `GetKeyState` every
//! 150 ms; there is deliberately no keyboard hook.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use sysinfo::{Disks, System};
use tauri::{AppHandle, Emitter, Manager};
use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, VK_CAPITAL, VK_NUMLOCK};

use crate::peek::{self, Peek, PeekKind, Tone};

pub const TICK_EVENT: &str = "system://tick";
pub const KEYS_EVENT: &str = "system://keys";

const LOW_BATTERY_PCT: u8 = 20;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Battery {
    pub percent: u8,
    pub charging: bool,
    pub on_ac: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemTick {
    pub cpu_percent: f32,
    pub cpu_cores: usize,
    pub mem_used: u64,
    pub mem_total: u64,
    pub battery: Option<Battery>,
    pub uptime_secs: u64,
    pub disk_free: Option<u64>,
    pub disk_total: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LockKeys {
    pub caps: bool,
    pub num: bool,
}

#[derive(Default)]
pub struct SystemState {
    stats_active: AtomicBool,
    last: Mutex<SystemTick>,
    keys: Mutex<Option<LockKeys>>,
}

pub fn start(app: &AppHandle) {
    app.manage(SystemState::default());
    spawn("system-stats", {
        let app = app.clone();
        move || stats_loop(&app)
    });
    spawn("lock-keys", {
        let app = app.clone();
        move || keys_loop(&app)
    });
}

fn spawn(name: &str, f: impl FnOnce() + Send + 'static) {
    if let Err(e) = thread::Builder::new().name(name.into()).spawn(f) {
        log::error!("could not spawn {name}: {e}");
    }
}

#[tauri::command]
pub fn system_get(state: tauri::State<'_, SystemState>) -> SystemTick {
    state.last.lock().map(|t| t.clone()).unwrap_or_default()
}

#[tauri::command]
pub fn system_keys(state: tauri::State<'_, SystemState>) -> LockKeys {
    state.keys.lock().ok().and_then(|k| *k).unwrap_or_default()
}

/// The Stats panel tells us when it's open so we can tick faster.
#[tauri::command]
pub fn system_set_stats_active(app: AppHandle, state: tauri::State<'_, SystemState>, active: bool) {
    let was = state.stats_active.swap(active, Ordering::Relaxed);
    if active && !was {
        // Push a fresh reading straight away rather than waiting for the slow tick.
        let last = state.last.lock().map(|t| t.clone()).unwrap_or_default();
        let _ = app.emit(TICK_EVENT, last);
    }
}

fn stats_loop(app: &AppHandle) {
    let mut sys = System::new();
    let mut disks = Disks::new_with_refreshed_list();
    let cores = thread::available_parallelism().map(|n| n.get()).unwrap_or(1);
    let mut last_stats: Option<Instant> = None;
    let mut last_disk: Option<Instant> = None;
    let mut last_battery: Option<Battery> = None;
    let mut battery_at: Option<Instant> = None;
    let mut tick = SystemTick {
        cpu_cores: cores,
        ..SystemTick::default()
    };

    // Prime CPU usage; the first sample is always 0.
    sys.refresh_cpu_usage();

    loop {
        thread::sleep(Duration::from_secs(1));
        let Some(state) = app.try_state::<SystemState>() else { continue };
        let fast = state.stats_active.load(Ordering::Relaxed);
        let interval = Duration::from_secs(if fast { 2 } else { 10 });
        let mut changed = false;

        if battery_at.is_none_or(|t| t.elapsed() >= Duration::from_secs(5)) {
            battery_at = Some(Instant::now());
            let battery = read_battery();
            if battery != last_battery {
                if let (Some(prev), Some(now)) = (last_battery, battery) {
                    battery_peeks(app, prev, now);
                }
                last_battery = battery;
                tick.battery = battery;
                changed = true;
            }
        }

        if last_stats.is_none_or(|t| t.elapsed() >= interval) {
            last_stats = Some(Instant::now());
            sys.refresh_cpu_usage();
            sys.refresh_memory();
            tick.cpu_percent = sys.global_cpu_usage();
            tick.mem_used = sys.used_memory();
            tick.mem_total = sys.total_memory();
            tick.uptime_secs = System::uptime();

            if last_disk.is_none_or(|t| t.elapsed() >= Duration::from_secs(60)) {
                last_disk = Some(Instant::now());
                disks.refresh(true);
                let system_drive = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into());
                let disk = disks.list().iter().find(|d| {
                    d.mount_point()
                        .to_string_lossy()
                        .to_ascii_uppercase()
                        .starts_with(&system_drive.to_ascii_uppercase())
                });
                tick.disk_free = disk.map(|d| d.available_space());
                tick.disk_total = disk.map(|d| d.total_space());
            }
            changed = true;
        }

        if changed {
            if let Ok(mut last) = state.last.lock() {
                *last = tick.clone();
            }
            if let Err(e) = app.emit(TICK_EVENT, &tick) {
                log::warn!("emit {TICK_EVENT} failed: {e}");
            }
        }
    }
}

fn read_battery() -> Option<Battery> {
    let mut status = SYSTEM_POWER_STATUS::default();
    // SAFETY: plain out-parameter call.
    if let Err(e) = unsafe { GetSystemPowerStatus(&mut status) } {
        log::debug!("GetSystemPowerStatus failed: {e}");
        return None;
    }
    // 128 = no system battery, 255 = unknown.
    if status.BatteryFlag & 128 != 0 || status.BatteryFlag == 255 || status.BatteryLifePercent > 100 {
        return None;
    }
    Some(Battery {
        percent: status.BatteryLifePercent,
        charging: status.BatteryFlag & 8 != 0,
        on_ac: status.ACLineStatus == 1,
    })
}

fn battery_peeks(app: &AppHandle, prev: Battery, now: Battery) {
    let pct = f64::from(now.percent) / 100.0;
    if now.on_ac && !prev.on_ac {
        peek::show(
            app,
            Peek::new(PeekKind::Charging, Tone::Good, "Charging")
                .badge(format!("{}%", now.percent))
                .value(pct),
        );
    } else if !now.on_ac && prev.on_ac {
        peek::show(
            app,
            Peek::new(PeekKind::OnBattery, Tone::Neutral, "On battery")
                .badge(format!("{}%", now.percent))
                .value(pct),
        );
    }
    if !now.on_ac && now.percent <= LOW_BATTERY_PCT && prev.percent > LOW_BATTERY_PCT {
        peek::show(
            app,
            Peek::new(PeekKind::LowBattery, Tone::Critical, "Battery low")
                .subtitle("Plug in soon")
                .badge(format!("{}%", now.percent))
                .value(pct)
                .with_sound(),
        );
        peek::notify(
            app,
            PeekKind::LowBattery,
            "Battery low",
            &format!("{}% left. Plug in soon.", now.percent),
        );
    }
}

fn keys_loop(app: &AppHandle) {
    let previous: Arc<Mutex<Option<LockKeys>>> = Arc::new(Mutex::new(None));
    loop {
        thread::sleep(Duration::from_millis(150));
        // GetKeyState reflects the calling thread's input state, so read it on
        // the UI thread, which is attached to the system input queue.
        let app2 = app.clone();
        let previous = Arc::clone(&previous);
        let dispatched = app.run_on_main_thread(move || {
            // SAFETY: GetKeyState has no preconditions.
            let keys = unsafe {
                LockKeys {
                    caps: GetKeyState(i32::from(VK_CAPITAL.0)) & 1 != 0,
                    num: GetKeyState(i32::from(VK_NUMLOCK.0)) & 1 != 0,
                }
            };
            let Ok(mut prev) = previous.lock() else { return };
            if *prev == Some(keys) {
                return;
            }
            if let Some(old) = *prev {
                lock_key_peeks(&app2, old, keys);
            }
            *prev = Some(keys);
            if let Some(state) = app2.try_state::<SystemState>()
                && let Ok(mut k) = state.keys.lock()
            {
                *k = Some(keys);
            }
            let _ = app2.emit(KEYS_EVENT, keys);
        });
        if let Err(e) = dispatched {
            log::debug!("lock key poll dispatch failed: {e}");
        }
    }
}

fn lock_key_peeks(app: &AppHandle, old: LockKeys, now: LockKeys) {
    let on_off = |on: bool| if on { "On" } else { "Off" };
    if old.caps != now.caps {
        peek::show(
            app,
            Peek::new(PeekKind::CapsLock, Tone::Neutral, "Caps Lock").badge(on_off(now.caps)),
        );
    }
    if old.num != now.num {
        peek::show(
            app,
            Peek::new(PeekKind::NumLock, Tone::Neutral, "Num Lock").badge(on_off(now.num)),
        );
    }
}
