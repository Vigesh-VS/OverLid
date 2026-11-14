//! Teleprompter scripts: one JSON file per script in the app data dir.

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};

use anyhow::{Context, bail};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

pub const CHANGED_EVENT: &str = "prompter://scripts";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Script {
    pub id: String,
    pub title: String,
    /// Markdown-ish. Lines starting with `## ` are sections (cue points).
    pub body: String,
    #[serde(default)]
    pub favorite: bool,
    pub updated_at: DateTime<Utc>,
}

const WELCOME: &str = "## Welcome
This is your first script. Overlid scrolls it out of the notch, right under your camera, so your eyes stay near the lens.

Hover over the text to pause. Move the cursor away and it carries on.

## Shortcuts
Ctrl+Alt+Space plays and pauses. Ctrl+Alt+Up and Down change the speed. Ctrl+Alt+Plus and Minus change the text size.

Ctrl+Alt+Left and Right jump between sections like this one. Ctrl+Alt+P starts and stops the prompter. Esc stops it too.

## Voice mode
Turn on voice mode and the script only moves while you're talking. The microphone level is measured in memory and never recorded, stored or sent anywhere.

## Your turn
Open Settings, then Scripts, to write your own. Start a line with two hashes and a space to make a section you can jump to.
";

fn dir(app: &AppHandle) -> anyhow::Result<PathBuf> {
    let dir = app.path().app_data_dir()?.join("scripts");
    fs::create_dir_all(&dir).with_context(|| format!("creating {}", dir.display()))?;
    Ok(dir)
}

/// Longest title and body a script may have.
pub const MAX_TITLE: usize = 200;
pub const MAX_BODY: usize = 2 * 1024 * 1024;

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn path_for(app: &AppHandle, id: &str) -> anyhow::Result<PathBuf> {
    if !valid_id(id) {
        bail!("invalid script id");
    }
    Ok(dir(app)?.join(format!("{id}.json")))
}

fn new_id() -> String {
    static COUNTER: AtomicU32 = AtomicU32::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{:x}-{:x}", Utc::now().timestamp_millis(), n)
}

fn notify(app: &AppHandle) {
    let _ = app.emit(CHANGED_EVENT, ());
}

fn write(app: &AppHandle, script: &Script) -> anyhow::Result<()> {
    let path = path_for(app, &script.id)?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_vec_pretty(script)?)?;
    fs::rename(&tmp, &path)?;
    Ok(())
}

pub fn list(app: &AppHandle) -> anyhow::Result<Vec<Script>> {
    let mut scripts: Vec<Script> = fs::read_dir(dir(app)?)?
        .filter_map(Result::ok)
        .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
        .filter_map(|e| {
            let raw = fs::read(e.path()).ok()?;
            serde_json::from_slice::<Script>(&raw)
                .map_err(|err| log::warn!("skipping unreadable script {}: {err}", e.path().display()))
                .ok()
        })
        .collect();
    scripts.sort_by(|a, b| b.favorite.cmp(&a.favorite).then(b.updated_at.cmp(&a.updated_at)));
    Ok(scripts)
}

/// Create the welcome script the first time the scripts folder is empty.
/// Delete every script (Settings › Privacy › Clear all data). The sample
/// script isn't re-added.
pub fn clear_all(app: &AppHandle) -> anyhow::Result<()> {
    for entry in fs::read_dir(dir(app)?)?.flatten() {
        let path = entry.path();
        if path.extension().is_some_and(|x| x == "json" || x == "tmp") {
            fs::remove_file(&path)?;
        }
    }
    notify(app);
    Ok(())
}

pub fn seed(app: &AppHandle) {
    let result = (|| -> anyhow::Result<()> {
        let marker = dir(app)?.join(".seeded");
        if marker.exists() {
            return Ok(());
        }
        if list(app)?.is_empty() {
            create(app, "Welcome to the prompter".into(), WELCOME.into())?;
        }
        fs::write(marker, b"")?;
        Ok(())
    })();
    if let Err(e) = result {
        log::warn!("seeding scripts failed: {e:#}");
    }
}

fn create(app: &AppHandle, title: String, body: String) -> anyhow::Result<Script> {
    let script = Script {
        id: new_id(),
        title,
        body,
        favorite: false,
        updated_at: Utc::now(),
    };
    write(app, &script)?;
    Ok(script)
}

fn err(e: anyhow::Error) -> String {
    log::warn!("script operation failed: {e:#}");
    format!("{e:#}")
}

#[tauri::command]
pub fn scripts_list(app: AppHandle) -> Result<Vec<Script>, String> {
    list(&app).map_err(err)
}

#[tauri::command]
pub fn script_create(app: AppHandle, title: Option<String>) -> Result<Script, String> {
    let title = title.map(|t| t.chars().take(MAX_TITLE).collect()).unwrap_or_else(|| "Untitled script".into());
    let script = create(&app, title, String::new()).map_err(err)?;
    notify(&app);
    Ok(script)
}

#[tauri::command]
pub fn script_save(app: AppHandle, mut script: Script) -> Result<Script, String> {
    if !valid_id(&script.id) {
        return Err("invalid script id".into());
    }
    if script.body.len() > MAX_BODY {
        return Err("This script is too long (over 2 MB of text).".into());
    }
    script.title = script.title.chars().filter(|c| !c.is_control()).take(MAX_TITLE).collect();
    script.updated_at = Utc::now();
    if script.title.trim().is_empty() {
        script.title = "Untitled script".into();
    }
    write(&app, &script).map_err(err)?;
    notify(&app);
    Ok(script)
}

#[tauri::command]
pub fn script_delete(app: AppHandle, id: String) -> Result<(), String> {
    let path = path_for(&app, &id).map_err(err)?;
    if path.exists() {
        fs::remove_file(path).map_err(|e| err(e.into()))?;
    }
    notify(&app);
    Ok(())
}

#[tauri::command]
pub fn script_duplicate(app: AppHandle, id: String) -> Result<Script, String> {
    let raw = fs::read(path_for(&app, &id).map_err(err)?).map_err(|e| err(e.into()))?;
    let original: Script = serde_json::from_slice(&raw).map_err(|e| err(e.into()))?;
    let copy = create(&app, format!("{} (copy)", original.title), original.body).map_err(err)?;
    notify(&app);
    Ok(copy)
}

/// Save a script's text to a .md / .txt file the user picks.
#[tauri::command]
pub async fn script_export(app: AppHandle, id: String) -> Result<bool, String> {
    let raw = fs::read(path_for(&app, &id).map_err(err)?).map_err(|e| err(e.into()))?;
    let script: Script = serde_json::from_slice(&raw).map_err(|e| err(e.into()))?;
    let safe: String = script
        .title
        .chars()
        .map(|c| if r#"<>:"/\|?*"#.contains(c) { '-' } else { c })
        .collect();
    let Some(target) = app
        .dialog()
        .file()
        .set_title("Export script")
        .set_file_name(format!("{safe}.md"))
        .add_filter("Markdown", &["md"])
        .add_filter("Text", &["txt"])
        .blocking_save_file()
    else {
        return Ok(false);
    };
    let path = target.into_path().map_err(|e| err(e.into()))?;
    fs::write(path, script.body).map_err(|e| err(e.into()))?;
    Ok(true)
}
