//! Focus timer (optionally a full Pomodoro cycle). The state lives here so it
//! survives the panel closing and UI reloads. Every view (pill, Focus panel,
//! Home) renders the same snapshot: it carries `ends_at_ms`, so they all count
//! down from one clock.

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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    Focus,
    ShortBreak,
    LongBreak,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DayStats {
    pub sessions: u32,
    pub minutes: u32,
}

/// Timer lengths and cycle rules, from settings.
#[derive(Debug, Clone, Copy)]
pub struct Config {
    pub focus: Duration,
    pub short: Duration,
    pub long: Duration,
    pub long_every: u32,
    /// Off = a plain focus timer: no breaks, no rounds.
    pub breaks: bool,
    pub auto_start_breaks: bool,
}

impl Config {
    fn from_settings(f: &settings::Focus) -> Self {
        let mins = |m: u32| Duration::from_secs(u64::from(m) * 60);
        Self {
            focus: mins(f.focus_min),
            short: mins(f.short_min),
            long: mins(f.long_min),
            long_every: f.long_every.max(1),
            breaks: f.breaks,
            auto_start_breaks: f.auto_start_breaks,
        }
    }

    fn length(&self, phase: Phase) -> Duration {
        match phase {
            Phase::Focus => self.focus,
            Phase::ShortBreak => self.short,
            Phase::LongBreak => self.long,
        }
    }
}

/// What finished, for history and notifications.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Finished {
    Focus { minutes: u32, next: Phase },
    Break { round: u32 },
}

/// The pure timer state machine. Time is passed in so it can be tested.
#[derive(Debug, Clone)]
pub struct Timer {
    pub phase: Phase,
    /// Set while running.
    ends_at: Option<Instant>,
    /// Authoritative while paused.
    remaining: Duration,
    /// 1-based focus round within the current cycle.
    pub round: u32,
}

impl Timer {
    pub fn new(cfg: &Config) -> Self {
        Self {
            phase: Phase::Focus,
            ends_at: None,
            remaining: cfg.focus,
            round: 1,
        }
    }

    pub fn running(&self) -> bool {
        self.ends_at.is_some()
    }

    pub fn remaining(&self, now: Instant) -> Duration {
        match self.ends_at {
            Some(end) => end.saturating_duration_since(now),
            None => self.remaining,
        }
    }

    fn enter(&mut self, cfg: &Config, phase: Phase, run: bool, now: Instant) {
        self.phase = phase;
        self.remaining = cfg.length(phase);
        self.ends_at = run.then(|| now + self.remaining);
    }

    pub fn start(&mut self, cfg: &Config, now: Instant) {
        if self.ends_at.is_none() {
            if self.remaining.is_zero() {
                self.remaining = cfg.length(self.phase);
            }
            self.ends_at = Some(now + self.remaining);
        }
    }

    pub fn pause(&mut self, now: Instant) {
        self.remaining = self.remaining(now);
        self.ends_at = None;
    }

    fn next_after_focus(&self, cfg: &Config) -> Phase {
        if !cfg.breaks {
            Phase::Focus
        } else if self.round >= cfg.long_every {
            Phase::LongBreak
        } else {
            Phase::ShortBreak
        }
    }

    fn after_break(&mut self, cfg: &Config) {
        self.round = if self.phase == Phase::LongBreak {
            1
        } else {
            (self.round + 1).min(cfg.long_every)
        };
    }

    /// Move on to the next phase without counting the current one.
    pub fn skip(&mut self, cfg: &Config, now: Instant) {
        match self.phase {
            Phase::Focus => {
                let next = self.next_after_focus(cfg);
                self.enter(cfg, next, false, now);
            }
            Phase::ShortBreak | Phase::LongBreak => {
                self.after_break(cfg);
                self.enter(cfg, Phase::Focus, false, now);
            }
        }
    }

    pub fn reset(&mut self, cfg: &Config, now: Instant) {
        self.round = 1;
        self.enter(cfg, Phase::Focus, false, now);
    }

    /// Settings changed: a paused timer adopts its phase's new length.
    pub fn reconfigure(&mut self, cfg: &Config, now: Instant) {
        if !cfg.breaks && self.phase != Phase::Focus {
            self.round = 1;
            self.enter(cfg, Phase::Focus, false, now);
            return;
        }
        if self.ends_at.is_none() {
            self.remaining = cfg.length(self.phase);
        }
        self.round = self.round.min(cfg.long_every);
    }

    /// Change one phase's length. If it's the current phase it restarts with
    /// the new length, keeping its run/pause state.
    pub fn set_length(&mut self, cfg: &Config, phase: Phase, now: Instant) {
        if self.phase == phase {
            self.remaining = cfg.length(phase);
            if self.ends_at.is_some() {
                self.ends_at = Some(now + self.remaining);
            }
        }
    }

    /// Advance the clock. Returns what finished, if the phase ran out.
    pub fn tick(&mut self, cfg: &Config, now: Instant) -> Option<Finished> {
        if self.ends_at.is_none() || !self.remaining(now).is_zero() {
            return None;
        }
        match self.phase {
            Phase::Focus => {
                let minutes = u32::try_from(cfg.focus.as_secs() / 60).unwrap_or(0);
                let next = self.next_after_focus(cfg);
                let run = next != Phase::Focus && cfg.auto_start_breaks;
                self.enter(cfg, next, run, now);
                Some(Finished::Focus { minutes, next })
            }
            Phase::ShortBreak | Phase::LongBreak => {
                self.after_break(cfg);
                self.enter(cfg, Phase::Focus, false, now);
                Some(Finished::Break { round: self.round })
            }
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PomoState {
    pub phase: Phase,
    pub running: bool,
    pub remaining_ms: u64,
    /// Unix ms when the current phase ends, while running. Views count down
    /// from this so they always agree.
    pub ends_at_ms: Option<i64>,
    pub total_ms: u64,
    pub round: u32,
    pub rounds_per_cycle: u32,
    pub breaks: bool,
    pub today: DayStats,
}

struct Inner {
    timer: Timer,
    history: BTreeMap<String, DayStats>,
}

pub struct Pomodoro(Mutex<Inner>);

fn today_key() -> String {
    chrono::Local::now().date_naive().to_string()
}

fn config(app: &AppHandle) -> Config {
    Config::from_settings(&settings::current(app).focus)
}

fn ms(d: Duration) -> u64 {
    u64::try_from(d.as_millis()).unwrap_or(u64::MAX)
}

impl Inner {
    fn snapshot(&self, cfg: &Config) -> PomoState {
        let now = Instant::now();
        let remaining = self.timer.remaining(now);
        PomoState {
            phase: self.timer.phase,
            running: self.timer.running(),
            remaining_ms: ms(remaining),
            ends_at_ms: self
                .timer
                .running()
                .then(|| chrono::Utc::now().timestamp_millis() + i64::try_from(remaining.as_millis()).unwrap_or(0)),
            total_ms: ms(cfg.length(self.timer.phase)),
            round: self.timer.round,
            rounds_per_cycle: cfg.long_every,
            breaks: cfg.breaks,
            today: self.history.get(&today_key()).copied().unwrap_or_default(),
        }
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
        timer: Timer::new(&config(app)),
        history,
    })));

    let app = app.clone();
    let spawned = thread::Builder::new().name("pomodoro".into()).spawn(move || {
        let mut last_second = u64::MAX;
        loop {
            thread::sleep(Duration::from_millis(200));
            let Some(pomo) = app.try_state::<Pomodoro>() else { continue };
            let cfg = config(&app);
            let Ok(mut inner) = pomo.0.lock() else { continue };
            if !inner.timer.running() {
                last_second = u64::MAX;
                continue;
            }
            if let Some(done) = inner.timer.tick(&cfg, Instant::now()) {
                record(&app, &mut inner, &cfg, done);
                last_second = u64::MAX;
                emit(&app, &inner, &cfg);
                continue;
            }
            // Push a snapshot every second so every view stays in step.
            let second = inner.timer.remaining(Instant::now()).as_secs();
            if second != last_second {
                last_second = second;
                emit(&app, &inner, &cfg);
            }
        }
    });
    if let Err(e) = spawned {
        log::error!("could not spawn pomodoro thread: {e}");
    }
}

fn emit(app: &AppHandle, inner: &Inner, cfg: &Config) {
    if let Err(e) = app.emit(TICK_EVENT, inner.snapshot(cfg)) {
        log::warn!("emit {TICK_EVENT} failed: {e}");
    }
}

/// Forget all focus history (Settings › Privacy › Clear all data).
pub fn clear_history(app: &AppHandle) {
    if let Some(pomo) = app.try_state::<Pomodoro>()
        && let Ok(mut inner) = pomo.0.lock()
    {
        inner.history.clear();
        save_history(app, &inner.history);
        emit(app, &inner, &config(app));
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

/// A phase ran out: record a finished focus session and tell the user.
fn record(app: &AppHandle, inner: &mut Inner, cfg: &Config, done: Finished) {
    let f = settings::current(app).focus;
    match done {
        Finished::Focus { minutes, next } => {
            let day = inner.history.entry(today_key()).or_default();
            day.sessions += 1;
            day.minutes += minutes;
            while inner.history.len() > HISTORY_DAYS {
                inner.history.pop_first();
            }
            save_history(app, &inner.history);

            let subtitle = match next {
                Phase::Focus => format!("{} focused today", day_label(inner)),
                Phase::LongBreak => format!("Long break, {} min", f.long_min),
                Phase::ShortBreak => format!("Short break, {} min · round {} of {}", f.short_min, inner.timer.round, cfg.long_every),
            };
            peek::show(
                app,
                Peek::new(PeekKind::FocusDone, Tone::Good, "Focus complete")
                    .subtitle(subtitle.clone())
                    .value(1.0)
                    .with_sound(),
            );
            peek::notify(app, PeekKind::FocusDone, "Focus complete", &subtitle);
        }
        Finished::Break { round } => {
            let subtitle = format!("Ready for round {round} of {}", cfg.long_every);
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

fn day_label(inner: &Inner) -> String {
    let m = inner.history.get(&today_key()).map_or(0, |d| d.minutes);
    if m >= 60 {
        format!("{}h {}m", m / 60, m % 60)
    } else {
        format!("{m}m")
    }
}

fn with<R>(app: &AppHandle, f: impl FnOnce(&mut Timer, &Config, Instant) -> R) -> Option<R> {
    let cfg = config(app);
    let pomo = app.try_state::<Pomodoro>()?;
    let mut inner = pomo.0.lock().ok()?;
    let r = f(&mut inner.timer, &cfg, Instant::now());
    emit(app, &inner, &cfg);
    Some(r)
}

/// Settings changed.
pub fn on_config_changed(app: &AppHandle) {
    with(app, |t, cfg, now| t.reconfigure(cfg, now));
}

#[tauri::command]
pub fn pomo_get(app: AppHandle) -> Option<PomoState> {
    let cfg = config(&app);
    let pomo = app.try_state::<Pomodoro>()?;
    let inner = pomo.0.lock().ok()?;
    Some(inner.snapshot(&cfg))
}

#[tauri::command]
pub fn pomo_start(app: AppHandle) {
    with(&app, |t, cfg, now| t.start(cfg, now));
}

#[tauri::command]
pub fn pomo_pause(app: AppHandle) {
    with(&app, |t, _, now| t.pause(now));
}

#[tauri::command]
pub fn pomo_skip(app: AppHandle) {
    with(&app, |t, cfg, now| t.skip(cfg, now));
}

#[tauri::command]
pub fn pomo_reset(app: AppHandle) {
    with(&app, |t, cfg, now| t.reset(cfg, now));
}

/// Set a phase's length (minutes, 1–180) and persist it.
#[tauri::command]
pub fn pomo_set_length(app: AppHandle, phase: Phase, minutes: u32) {
    let minutes = minutes.clamp(1, 180);
    let mut next = settings::current(&app);
    match phase {
        Phase::Focus => next.focus.focus_min = minutes,
        Phase::ShortBreak => next.focus.short_min = minutes,
        Phase::LongBreak => next.focus.long_min = minutes,
    }
    // Saving triggers on_config_changed (paused timer adopts the length).
    settings::replace(&app, next);
    with(&app, |t, cfg, now| t.set_length(cfg, phase, now));
}

#[tauri::command]
pub fn pomo_history(app: AppHandle) -> BTreeMap<String, DayStats> {
    app.try_state::<Pomodoro>()
        .and_then(|p| p.0.lock().ok().map(|i| i.history.clone()))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(breaks: bool) -> Config {
        Config {
            focus: Duration::from_secs(25 * 60),
            short: Duration::from_secs(5 * 60),
            long: Duration::from_secs(15 * 60),
            long_every: 2,
            breaks,
            auto_start_breaks: false,
        }
    }

    const MIN: Duration = Duration::from_secs(60);

    #[test]
    fn start_pause_resume_keeps_remaining_time() {
        let c = cfg(false);
        let t0 = Instant::now();
        let mut t = Timer::new(&c);
        t.start(&c, t0);
        assert!(t.running());
        t.pause(t0 + 10 * MIN);
        assert!(!t.running());
        assert_eq!(t.remaining(t0 + 99 * MIN), 15 * MIN, "paused time doesn't move");
        t.start(&c, t0 + 20 * MIN);
        assert_eq!(t.remaining(t0 + 25 * MIN), 10 * MIN);
    }

    #[test]
    fn completion_counts_once_and_plain_timer_has_no_breaks() {
        let c = cfg(false);
        let t0 = Instant::now();
        let mut t = Timer::new(&c);
        t.start(&c, t0);
        assert_eq!(t.tick(&c, t0 + 24 * MIN), None);
        assert_eq!(t.tick(&c, t0 + 25 * MIN), Some(Finished::Focus { minutes: 25, next: Phase::Focus }));
        assert_eq!(t.phase, Phase::Focus);
        assert!(!t.running(), "waits for the next start");
        assert_eq!(t.remaining(t0 + 26 * MIN), 25 * MIN);
        assert_eq!(t.tick(&c, t0 + 60 * MIN), None, "never counts twice");
    }

    #[test]
    fn full_cycle_with_breaks() {
        let c = cfg(true);
        let t0 = Instant::now();
        let mut t = Timer::new(&c);
        t.start(&c, t0);
        assert_eq!(t.tick(&c, t0 + 25 * MIN), Some(Finished::Focus { minutes: 25, next: Phase::ShortBreak }));
        t.start(&c, t0 + 25 * MIN);
        assert_eq!(t.tick(&c, t0 + 30 * MIN), Some(Finished::Break { round: 2 }));
        assert_eq!((t.phase, t.round), (Phase::Focus, 2));
        t.start(&c, t0 + 30 * MIN);
        assert_eq!(t.tick(&c, t0 + 55 * MIN), Some(Finished::Focus { minutes: 25, next: Phase::LongBreak }));
        t.start(&c, t0 + 55 * MIN);
        assert_eq!(t.tick(&c, t0 + 70 * MIN), Some(Finished::Break { round: 1 }));
    }

    #[test]
    fn skip_and_reset() {
        let c = cfg(true);
        let t0 = Instant::now();
        let mut t = Timer::new(&c);
        t.start(&c, t0);
        t.skip(&c, t0 + MIN);
        assert_eq!((t.phase, t.running()), (Phase::ShortBreak, false));
        t.skip(&c, t0 + 2 * MIN);
        assert_eq!((t.phase, t.round), (Phase::Focus, 2));
        t.reset(&c, t0 + 3 * MIN);
        assert_eq!((t.phase, t.round, t.running()), (Phase::Focus, 1, false));
        assert_eq!(t.remaining(t0), 25 * MIN);

        // Without breaks, skip just restarts focus.
        let plain = cfg(false);
        let mut p = Timer::new(&plain);
        p.start(&plain, t0);
        p.skip(&plain, t0 + MIN);
        assert_eq!((p.phase, p.running(), p.remaining(t0)), (Phase::Focus, false, 25 * MIN));
    }

    #[test]
    fn changing_length_while_running_restarts_that_phase() {
        let mut c = cfg(false);
        let t0 = Instant::now();
        let mut t = Timer::new(&c);
        t.start(&c, t0);
        c.focus = 10 * MIN;
        t.set_length(&c, Phase::Focus, t0 + MIN);
        assert!(t.running());
        assert_eq!(t.remaining(t0 + 2 * MIN), 9 * MIN);
    }
}
