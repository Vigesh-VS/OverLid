//! Pomodoro timer. State lives here so it survives the panel closing and UI
//! reloads; the frontend renders `pomo://tick`.

use std::collections::BTreeMap;
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_store::StoreExt;

use crate::peek::{self, Peek, PeekKind, Tone};
use crate::settings;

pub const TICK_EVENT: &str = "pomo://tick";
const STORE_FILE: &str = "pomodoro.json";
const HISTORY_KEY: &str = "history";
/// Keep a year of daily history.
const HISTORY_DAYS: usize = 366;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    Focus,
    ShortBreak,
    LongBreak,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DayStats {
    pub sessions: u32,
    pub minutes: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PomoState {
    pub phase: Phase,
    pub running: bool,
    pub remaining_ms: u64,
    pub total_ms: u64,
    /// 1-based focus round within the current cycle.
    pub round: u32,
    pub rounds_per_cycle: u32,
    pub today: DayStats,
}

struct Inner {
    phase: Phase,
    /// Set while running.
    ends_at: Option<Instant>,
    /// Authoritative while paused.
    remaining: Duration,
    round: u32,
    history: BTreeMap<String, DayStats>,
}

pub struct Pomodoro(Mutex<Inner>);

fn today_key() -> String {
    chrono::Local::now().date_naive().to_string()
}

fn phase_length(app: &AppHandle, phase: Phase) -> Duration {
    let f = settings::current(app).focus;
    let minutes = match phase {
        Phase::Focus => f.focus_min,
        Phase::ShortBreak => f.short_min,
        Phase::LongBreak => f.long_min,
    };
    Duration::from_secs(u64::from(minutes) * 60)
}

impl Inner {
    fn remaining(&self) -> Duration {
        match self.ends_at {
            Some(end) => end.saturating_duration_since(Instant::now()),
            None => self.remaining,
        }
    }

    fn snapshot(&self, app: &AppHandle) -> PomoState {
        PomoState {
            phase: self.phase,
            running: self.ends_at.is_some(),
            remaining_ms: u64::try_from(self.remaining().as_millis()).unwrap_or(u64::MAX),
            total_ms: u64::try_from(phase_length(app, self.phase).as_millis()).unwrap_or(u64::MAX),
            round: self.round,
            rounds_per_cycle: settings::current(app).focus.long_every,
            today: self.history.get(&today_key()).copied().unwrap_or_default(),
        }
    }

    fn enter(&mut self, app: &AppHandle, phase: Phase, run: bool) {
        self.phase = phase;
        let length = phase_length(app, phase);
        self.remaining = length;
        self.ends_at = run.then(|| Instant::now() + length);
    }
}

pub fn start(app: &AppHandle) {
    let history = app
        .store(STORE_FILE)
        .ok()
        .and_then(|s| s.get(HISTORY_KEY))
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();
    app.manage(Pomodoro(Mutex::new(Inner {
        phase: Phase::Focus,
        ends_at: None,
        remaining: phase_length(app, Phase::Focus),
        round: 1,
        history,
    })));

    let app = app.clone();
    let spawned = thread::Builder::new().name("pomodoro".into()).spawn(move || {
        let mut last_second = u64::MAX;
        loop {
            thread::sleep(Duration::from_millis(250));
            let Some(pomo) = app.try_state::<Pomodoro>() else { continue };
            let Ok(mut inner) = pomo.0.lock() else { continue };
            if inner.ends_at.is_none() {
                last_second = u64::MAX;
                continue;
            }
            let remaining = inner.remaining();
            if remaining.is_zero() {
                complete(&app, &mut inner);
                last_second = u64::MAX;
                emit(&app, &inner);
                continue;
            }
            let second = remaining.as_secs();
            if second != last_second {
                last_second = second;
                emit(&app, &inner);
            }
        }
    });
    if let Err(e) = spawned {
        log::error!("could not spawn pomodoro thread: {e}");
    }
}

fn emit(app: &AppHandle, inner: &Inner) {
    if let Err(e) = app.emit(TICK_EVENT, inner.snapshot(app)) {
        log::warn!("emit {TICK_EVENT} failed: {e}");
    }
}

fn save_history(app: &AppHandle, history: &BTreeMap<String, DayStats>) {
    let result = app.store(STORE_FILE).map_err(anyhow::Error::from).and_then(|store| {
        store.set(HISTORY_KEY, serde_json::to_value(history)?);
        store.save()?;
        Ok(())
    });
    if let Err(e) = result {
        log::warn!("saving pomodoro history failed: {e:#}");
    }
}

/// The current phase ran out: record it, move on, tell the user.
fn complete(app: &AppHandle, inner: &mut Inner) {
    let focus = settings::current(app).focus;
    match inner.phase {
        Phase::Focus => {
            let minutes = u32::try_from(phase_length(app, Phase::Focus).as_secs() / 60).unwrap_or(0);
            let day = inner.history.entry(today_key()).or_default();
            day.sessions += 1;
            day.minutes += minutes;
            while inner.history.len() > HISTORY_DAYS {
                inner.history.pop_first();
            }
            save_history(app, &inner.history);

            let next = if inner.round >= focus.long_every {
                Phase::LongBreak
            } else {
                Phase::ShortBreak
            };
            inner.enter(app, next, focus.auto_start_breaks);
            let (label, mins) = match next {
                Phase::LongBreak => ("Long break", focus.long_min),
                _ => ("Short break", focus.short_min),
            };
            let subtitle = format!("{label}, {mins} min · round {} of {}", inner.round, focus.long_every);
            peek::show(
                app,
                Peek::new(PeekKind::FocusDone, Tone::Good, "Focus complete")
                    .subtitle(subtitle.clone())
                    .value(1.0)
                    .with_sound(),
            );
            peek::notify(app, PeekKind::FocusDone, "Focus complete", &subtitle);
        }
        Phase::ShortBreak | Phase::LongBreak => {
            inner.round = if inner.phase == Phase::LongBreak {
                1
            } else {
                inner.round + 1
            };
            inner.enter(app, Phase::Focus, false);
            let subtitle = format!("Ready for round {} of {}", inner.round, focus.long_every);
            peek::show(
                app,
                Peek::new(PeekKind::FocusDone, Tone::Neutral, "Break over")
                    .subtitle(subtitle.clone())
                    .value(0.0)
                    .with_sound(),
            );
            peek::notify(app, PeekKind::FocusDone, "Break over", &subtitle);
        }
    }
}

fn with<R>(app: &AppHandle, f: impl FnOnce(&mut Inner) -> R) -> Option<R> {
    let pomo = app.try_state::<Pomodoro>()?;
    let mut inner = pomo.0.lock().ok()?;
    let r = f(&mut inner);
    emit(app, &inner);
    Some(r)
}

/// Settings changed: a paused timer adopts the new length.
pub fn on_config_changed(app: &AppHandle) {
    with(app, |inner| {
        if inner.ends_at.is_none() {
            inner.remaining = phase_length(app, inner.phase);
        }
        let every = settings::current(app).focus.long_every;
        inner.round = inner.round.min(every);
    });
}

#[tauri::command]
pub fn pomo_get(app: AppHandle) -> Option<PomoState> {
    let pomo = app.try_state::<Pomodoro>()?;
    let inner = pomo.0.lock().ok()?;
    Some(inner.snapshot(&app))
}

#[tauri::command]
pub fn pomo_start(app: AppHandle) {
    with(&app, |inner| {
        if inner.ends_at.is_none() {
            if inner.remaining.is_zero() {
                inner.remaining = phase_length(&app, inner.phase);
            }
            inner.ends_at = Some(Instant::now() + inner.remaining);
        }
    });
}

#[tauri::command]
pub fn pomo_pause(app: AppHandle) {
    with(&app, |inner| {
        inner.remaining = inner.remaining();
        inner.ends_at = None;
    });
}

#[tauri::command]
pub fn pomo_skip(app: AppHandle) {
    let every = settings::current(&app).focus.long_every;
    with(&app, |inner| match inner.phase {
        Phase::Focus => {
            let next = if inner.round >= every {
                Phase::LongBreak
            } else {
                Phase::ShortBreak
            };
            inner.enter(&app, next, false);
        }
        Phase::ShortBreak | Phase::LongBreak => {
            inner.round = if inner.phase == Phase::LongBreak {
                1
            } else {
                (inner.round + 1).min(every)
            };
            inner.enter(&app, Phase::Focus, false);
        }
    });
}

#[tauri::command]
pub fn pomo_reset(app: AppHandle) {
    with(&app, |inner| {
        inner.round = 1;
        inner.enter(&app, Phase::Focus, false);
    });
}

#[tauri::command]
pub fn pomo_history(app: AppHandle) -> BTreeMap<String, DayStats> {
    app.try_state::<Pomodoro>()
        .and_then(|p| p.0.lock().ok().map(|i| i.history.clone()))
        .unwrap_or_default()
}
