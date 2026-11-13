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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct General {
    /// Monitor name to anchor the island to; `None` = primary.
    pub monitor: Option<String>,
    pub hide_from_capture: CaptureMode,
}

impl Default for General {
    fn default() -> Self {
        Self {
            monitor: None,
            hide_from_capture: CaptureMode::PrompterOnly,
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Code {
    pub enabled: bool,
    pub poll_secs: u64,
    pub port: u16,
    pub warn_pct: f64,
    pub critical_pct: f64,
}

impl Default for Code {
    fn default() -> Self {
        Self {
            enabled: true,
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
            voice: false,
            voice_threshold: 0.35,
            mic_device: None,
            capture_hint_seen: false,
            shortcuts: Shortcuts::default(),
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
}

impl Settings {
    /// Clamp everything into ranges the rest of the app can rely on.
    fn sanitized(mut self) -> Self {
        let f = &mut self.focus;
        f.focus_min = f.focus_min.clamp(1, 180);
        f.short_min = f.short_min.clamp(1, 60);
        f.long_min = f.long_min.clamp(1, 120);
        f.long_every = f.long_every.clamp(1, 12);

        let c = &mut self.code;
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
