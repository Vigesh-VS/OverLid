//! App settings, persisted with tauri-plugin-store. Rust is the owner; the
//! frontend reads them with `settings_get` and writes whole objects back.

use std::sync::RwLock;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_store::StoreExt;

pub const CHANGED_EVENT: &str = "settings://changed";
const STORE_FILE: &str = "settings.json";
const STORE_KEY: &str = "settings";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CaptureMode {
    Always,
    #[default]
    PrompterOnly,
    Never,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Position {
    #[default]
    Center,
    Left,
    Right,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Visibility {
    /// Topmost over everything.
    #[default]
    AlwaysOnTop,
    /// Topmost only while one of `selected_apps` is the foreground window.
    SelectedApps,
    /// A normal window that goes behind whatever you open.
    Normal,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Indicators {
    pub media: bool,
    pub focus: bool,
    pub usage: bool,
    pub quick_action: bool,
}

impl Default for Indicators {
    fn default() -> Self {
        Self {
            media: true,
            focus: true,
            usage: true,
            quick_action: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct General {
    /// Where on the main monitor's top edge the island sits.
    pub position: Position,
    /// Logical px nudge: from the centre, or in from the corner.
    pub offset_x: i32,
    pub hide_from_capture: CaptureMode,
    pub visibility: Visibility,
    /// Lower-case exe file names, e.g. "obs64.exe".
    pub selected_apps: Vec<String>,
    /// Scales everything in the island (0.75–1.5).
    pub ui_scale: f64,
    /// Width of the expanded island in logical px at 100 % scale.
    pub expanded_width: u32,
    /// Height of the collapsed pill in logical px at 100 % scale.
    pub pill_height: u32,
    /// How long the island stays open after the cursor leaves.
    pub close_delay_ms: u32,
    pub indicators: Indicators,
    /// The first-run welcome screen has been shown.
    pub welcome_seen: bool,
}

impl Default for General {
    fn default() -> Self {
        Self {
            position: Position::Center,
            offset_x: 0,
            hide_from_capture: CaptureMode::PrompterOnly,
            visibility: Visibility::AlwaysOnTop,
            selected_apps: Vec::new(),
            ui_scale: 1.0,
            expanded_width: 680,
            pill_height: 34,
            close_delay_ms: 400,
            indicators: Indicators::default(),
            welcome_seen: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Peeks {
    pub lock_keys: bool,
    pub battery: bool,
    pub agent: bool,
    pub usage: bool,
    pub focus: bool,
    pub sound: bool,
}

impl Default for Peeks {
    fn default() -> Self {
        Self {
            lock_keys: true,
            battery: true,
            agent: true,
            usage: true,
            focus: true,
            sound: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Focus {
    pub focus_min: u32,
    pub short_min: u32,
    pub long_min: u32,
    pub long_every: u32,
    pub auto_start_breaks: bool,
}

impl Default for Focus {
    fn default() -> Self {
        Self {
            focus_min: 25,
            short_min: 5,
            long_min: 15,
            long_every: 4,
            auto_start_breaks: false,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WaitingChime {
    Off,
    #[default]
    Once,
    Every2Min,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Code {
    pub enabled: bool,
    /// Providers the user explicitly connected, in order; the first is primary.
    pub connected: Vec<String>,
    pub waiting_chime: WaitingChime,
    pub poll_secs: u64,
    pub port: u16,
    pub warn_pct: f64,
    pub critical_pct: f64,
}

impl Default for Code {
    fn default() -> Self {
        Self {
            enabled: true,
            connected: Vec::new(),
            waiting_chime: WaitingChime::Once,
            poll_secs: 120,
            port: 47823,
            warn_pct: 80.0,
            critical_pct: 95.0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Shortcuts {
    pub toggle: String,
    pub play_pause: String,
    pub faster: String,
    pub slower: String,
    pub bigger: String,
    pub smaller: String,
    pub prev_section: String,
    pub next_section: String,
}

impl Default for Shortcuts {
    fn default() -> Self {
        Self {
            toggle: "Ctrl+Alt+P".into(),
            play_pause: "Ctrl+Alt+Space".into(),
            faster: "Ctrl+Alt+ArrowUp".into(),
            slower: "Ctrl+Alt+ArrowDown".into(),
            bigger: "Ctrl+Alt+Equal".into(),
            smaller: "Ctrl+Alt+Minus".into(),
            prev_section: "Ctrl+Alt+ArrowLeft".into(),
            next_section: "Ctrl+Alt+ArrowRight".into(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TimingMode {
    /// Fixed px per second.
    #[default]
    Speed,
    /// Lines per minute, converted using the current line height.
    Lines,
    /// Finish the whole script in `duration_min` minutes.
    Duration,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Prompter {
    pub font_family: String,
    pub font_size: u32,
    pub line_height: f64,
    pub color: String,
    /// px per second.
    pub speed: f64,
    pub mirror: bool,
    pub width: u32,
    pub height: u32,
    pub timing_mode: TimingMode,
    pub lines_per_minute: f64,
    pub duration_min: f64,
    /// Scale the text with the area instead of keeping a fixed size.
    pub auto_fit: bool,
    pub voice: bool,
    /// 0–1; higher = needs louder speech to scroll.
    pub voice_threshold: f64,
    pub mic_device: Option<String>,
    pub capture_hint_seen: bool,
    pub shortcuts: Shortcuts,
}

impl Default for Prompter {
    fn default() -> Self {
        Self {
            font_family: "Segoe UI Variable Display".into(),
            font_size: 28,
            line_height: 1.4,
            color: "#FFFFFF".into(),
            speed: 60.0,
            mirror: false,
            width: 560,
            height: 200,
            timing_mode: TimingMode::Speed,
            lines_per_minute: 30.0,
            duration_min: 5.0,
            auto_fit: false,
            voice: false,
            voice_threshold: 0.4,
            mic_device: None,
            capture_hint_seen: false,
            shortcuts: Shortcuts::default(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum QuickKind {
    None,
    /// Open an app; payload = .exe path.
    Launch,
    /// Open a URL or folder; payload = the URL or path.
    Url,
    #[default]
    Pomodoro,
    /// Start the teleprompter; payload = script id (empty = selected script).
    Prompter,
    Media,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct QuickAction {
    pub kind: QuickKind,
    pub payload: String,
    /// Built-in icon name, or "app" to use `icon_data`.
    pub icon: String,
    /// PNG data URL of an app's own icon.
    pub icon_data: Option<String>,
    pub tooltip: String,
}

impl Default for QuickAction {
    fn default() -> Self {
        Self {
            kind: QuickKind::Pomodoro,
            payload: String::new(),
            icon: "timer".into(),
            icon_data: None,
            tooltip: "Start focus timer".into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub general: General,
    pub peeks: Peeks,
    pub focus: Focus,
    pub code: Code,
    pub prompter: Prompter,
    pub quick_action: QuickAction,
}

impl Settings {
    /// Clamp everything into ranges the rest of the app can rely on.
    fn sanitized(mut self) -> Self {
        let g = &mut self.general;
        g.offset_x = g.offset_x.clamp(-600, 600);
        g.ui_scale = (g.ui_scale.clamp(0.75, 1.5) * 20.0).round() / 20.0;
        g.expanded_width = g.expanded_width.clamp(560, 760);
        g.pill_height = g.pill_height.clamp(28, 44);
        g.close_delay_ms = (g.close_delay_ms.clamp(200, 1000) / 100) * 100;
        for app in &mut g.selected_apps {
            *app = app.trim().to_ascii_lowercase();
        }
        g.selected_apps.retain(|a| !a.is_empty());
        g.selected_apps.dedup();

        let f = &mut self.focus;
        f.focus_min = f.focus_min.clamp(1, 180);
        f.short_min = f.short_min.clamp(1, 60);
        f.long_min = f.long_min.clamp(1, 120);
        f.long_every = f.long_every.clamp(1, 12);

        let c = &mut self.code;
        c.connected.dedup();
        c.poll_secs = c.poll_secs.clamp(60, 3600);
        if c.port < 1024 {
            c.port = Code::default().port;
        }
        c.warn_pct = c.warn_pct.clamp(1.0, 100.0);
        c.critical_pct = c.critical_pct.clamp(c.warn_pct, 100.0);

        let p = &mut self.prompter;
        p.font_size = p.font_size.clamp(14, 72);
        p.line_height = p.line_height.clamp(1.0, 2.2);
        p.speed = p.speed.clamp(5.0, 400.0);
        p.width = p.width.clamp(320, 760);
        p.height = p.height.clamp(120, 420);
        p.voice_threshold = p.voice_threshold.clamp(0.0, 1.0);
        p.lines_per_minute = p.lines_per_minute.clamp(2.0, 200.0);
        p.duration_min = p.duration_min.clamp(0.5, 180.0);
        if p.font_family.trim().is_empty() {
            p.font_family = Prompter::default().font_family;
        }
        self
    }
}

#[derive(Default)]
pub struct SettingsState(RwLock<Settings>);

pub fn init(app: &AppHandle) {
    let loaded = match app.store(STORE_FILE) {
        Ok(store) => store
            .get(STORE_KEY)
            .and_then(|v| serde_json::from_value::<Settings>(v).ok())
            .unwrap_or_default(),
        Err(e) => {
            log::warn!("settings store unavailable, using defaults: {e}");
            Settings::default()
        }
    };
    app.manage(SettingsState(RwLock::new(loaded.sanitized())));
}

pub fn current(app: &AppHandle) -> Settings {
    app.try_state::<SettingsState>()
        .and_then(|s| s.0.read().ok().map(|g| g.clone()))
        .unwrap_or_default()
}

fn persist(app: &AppHandle, settings: &Settings) -> anyhow::Result<()> {
    let store = app.store(STORE_FILE)?;
    store.set(STORE_KEY, serde_json::to_value(settings)?);
    store.save()?;
    Ok(())
}

/// Replace the settings, persist, notify windows and apply side effects.
pub fn replace(app: &AppHandle, next: Settings) -> Settings {
    let next = next.sanitized();
    let previous = current(app);
    if let Some(state) = app.try_state::<SettingsState>() {
        match state.0.write() {
            Ok(mut guard) => *guard = next.clone(),
            Err(e) => log::error!("settings lock poisoned: {e}"),
        }
    }
    if let Err(e) = persist(app, &next) {
        log::error!("saving settings failed: {e:#}");
    }
    if let Err(e) = app.emit(CHANGED_EVENT, &next) {
        log::warn!("emit {CHANGED_EVENT} failed: {e}");
    }
    crate::on_settings_changed(app, &previous, &next);
    next
}

#[tauri::command]
pub fn settings_get(app: AppHandle) -> Settings {
    current(&app)
}

#[tauri::command]
pub fn settings_set(app: AppHandle, settings: Settings) -> Settings {
    replace(&app, settings)
}
