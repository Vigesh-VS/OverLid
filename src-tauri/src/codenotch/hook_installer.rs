//! Adds / removes Overlid's HTTP hooks in Claude Code's `settings.json`.
//!
//! Always backs the file up first, merges instead of overwriting, keeps every
//! other key and hook untouched, and tags our entries (via the URL) so
//! re-installing never duplicates and "Disconnect" removes only ours.

use std::fs;
use std::path::PathBuf;

use anyhow::{Context, bail};
use serde::Serialize;
use serde_json::{Map, Value, json};

use crate::secret::Secret;

const EVENTS: [&str; 8] = [
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "Notification",
    "PermissionRequest",
    "Stop",
    "SessionEnd",
];
/// Events whose matcher filters by tool name; "*" = every tool.
const TOOL_EVENTS: [&str; 3] = ["PreToolUse", "PostToolUse", "PermissionRequest"];
/// Marks a hook URL as ours.
const TAG: &str = "overlid=1";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookStatus {
    pub installed: bool,
    /// Some events have our hook but not all.
    pub partial: bool,
    pub port: Option<u16>,
    pub settings_path: Option<String>,
    pub listening_port: Option<u16>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeReport {
    pub backup: Option<String>,
    pub status: HookStatus,
}

fn settings_path() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("CLAUDE_CONFIG_DIR") {
        return Some(PathBuf::from(dir).join("settings.json"));
    }
    dirs::home_dir().map(|h| h.join(".claude").join("settings.json"))
}

fn hook_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}/hook?{TAG}")
}

/// One HTTP hook. The token header proves a request came from these hooks.
fn hook_entry(port: u16, token: &str) -> Value {
    json!({
        "type": "http",
        "url": hook_url(port),
        "timeout": 2,
        "headers": { "X-Overlid-Token": token }
    })
}

fn is_ours(hook: &Value) -> bool {
    hook.get("type").and_then(Value::as_str) == Some("http")
        && hook
            .get("url")
            .and_then(Value::as_str)
            .is_some_and(|u| u.starts_with("http://127.0.0.1:") && u.contains(TAG))
}

fn token_of(hook: &Value) -> Option<&str> {
    hook.get("headers")?.get("X-Overlid-Token")?.as_str()
}

fn port_of(hook: &Value) -> Option<u16> {
    let url = hook.get("url")?.as_str()?;
    let rest = url.strip_prefix("http://127.0.0.1:")?;
    rest.split(['/', '?']).next()?.parse().ok()
}

fn read_settings() -> anyhow::Result<(PathBuf, Option<Value>)> {
    let path = settings_path().context("can't find your home folder")?;
    match fs::read_to_string(&path) {
        Ok(raw) if raw.trim().is_empty() => Ok((path, Some(Value::Object(Map::new())))),
        Ok(raw) => {
            let value: Value = serde_json::from_str(&raw).with_context(|| {
                format!("{} isn't valid JSON, so it was left untouched", path.display())
            })?;
            if !value.is_object() {
                bail!("{} isn't a JSON object, so it was left untouched", path.display());
            }
            Ok((path, Some(value)))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok((path, None)),
        Err(e) => Err(e).with_context(|| format!("reading {}", path.display())),
    }
}

/// Our hook entries across all events: (count of events that have one, a port seen).
fn scan(root: &Value) -> (usize, Option<u16>) {
    let mut events = 0;
    let mut port = None;
    if let Some(hooks) = root.get("hooks").and_then(Value::as_object) {
        for event in EVENTS {
            let ours: Vec<&Value> = hooks
                .get(event)
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|g| g.get("hooks").and_then(Value::as_array))
                .flatten()
                .filter(|h| is_ours(h))
                .collect();
            if !ours.is_empty() {
                events += 1;
                port = port.or_else(|| ours.iter().find_map(|h| port_of(h)));
            }
        }
    }
    (events, port)
}

pub fn status(listening_port: Option<u16>) -> HookStatus {
    let (path, value) = match read_settings() {
        Ok(v) => v,
        Err(e) => {
            log::debug!("hook status: {e:#}");
            return HookStatus {
                installed: false,
                partial: false,
                port: None,
                settings_path: settings_path().map(|p| p.display().to_string()),
                listening_port,
            };
        }
    };
    let (events, port) = value.as_ref().map(scan).unwrap_or((0, None));
    HookStatus {
        installed: events == EVENTS.len(),
        partial: events > 0 && events < EVENTS.len(),
        port,
        settings_path: Some(path.display().to_string()),
        listening_port,
    }
}

/// Our hooks are installed but point at another port or carry an old token.
pub fn needs_update(port: u16, token: &str) -> bool {
    let Ok((_, Some(root))) = read_settings() else { return false };
    let Some(hooks) = root.get("hooks").and_then(Value::as_object) else { return false };
    let ours: Vec<&Value> = hooks
        .values()
        .filter_map(Value::as_array)
        .flatten()
        .filter_map(|g| g.get("hooks").and_then(Value::as_array))
        .flatten()
        .filter(|h| is_ours(h))
        .collect();
    !ours.is_empty()
        && ours.iter().any(|h| {
            port_of(h) != Some(port)
                || !token_of(h).is_some_and(|t| super::hook_token::constant_time_eq(t.as_bytes(), token.as_bytes()))
        })
}

/// Remove our entries. Groups/events/the hooks object are removed only when
/// removing ours left them empty.
fn strip(root: &mut Value) {
    let Some(obj) = root.as_object_mut() else { return };
    let Some(hooks) = obj.get_mut("hooks").and_then(Value::as_object_mut) else { return };
    let mut emptied_events = Vec::new();
    for (event, groups) in hooks.iter_mut() {
        let Some(groups) = groups.as_array_mut() else { continue };
        let before = groups.len();
        let mut touched = false;
        groups.retain_mut(|group| {
            let Some(list) = group.get_mut("hooks").and_then(Value::as_array_mut) else { return true };
            let n = list.len();
            list.retain(|h| !is_ours(h));
            if list.len() != n {
                touched = true;
                return !list.is_empty();
            }
            true
        });
        if touched && groups.is_empty() && before > 0 {
            emptied_events.push(event.clone());
        }
    }
    for event in emptied_events {
        hooks.remove(&event);
    }
    if hooks.is_empty() {
        obj.remove("hooks");
    }
}

fn backup(path: &PathBuf) -> anyhow::Result<Option<String>> {
    if !path.exists() {
        return Ok(None);
    }
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let target = path.with_file_name(format!("settings.json.overlid-backup-{stamp}"));
    fs::copy(path, &target).with_context(|| format!("backing up to {}", target.display()))?;
    Ok(Some(target.display().to_string()))
}

fn write(path: &PathBuf, value: &Value) -> anyhow::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let mut text = serde_json::to_string_pretty(value)?;
    text.push('\n');
    let tmp = path.with_extension("json.overlid-tmp");
    fs::write(&tmp, text).with_context(|| format!("writing {}", tmp.display()))?;
    fs::rename(&tmp, path).with_context(|| format!("replacing {}", path.display()))?;
    Ok(())
}

pub fn install(port: u16, token: &Secret) -> anyhow::Result<ChangeReport> {
    let (path, existing) = read_settings()?;
    let backup = backup(&path)?;
    let mut root = existing.unwrap_or_else(|| Value::Object(Map::new()));
    strip(&mut root);

    let obj = root.as_object_mut().context("settings root is not an object")?;
    let hooks = obj
        .entry("hooks")
        .or_insert_with(|| Value::Object(Map::new()));
    if !hooks.is_object() {
        bail!("\"hooks\" in {} isn't an object, so it was left untouched", path.display());
    }
    if let Some(hooks) = hooks.as_object_mut() {
        for event in EVENTS {
            let groups = hooks.entry(event).or_insert_with(|| Value::Array(Vec::new()));
            let Some(groups) = groups.as_array_mut() else {
                bail!("hooks.{event} in {} isn't a list, so it was left untouched", path.display());
            };
            let mut group = json!({ "hooks": [hook_entry(port, token.expose())] });
            if TOOL_EVENTS.contains(&event)
                && let Some(g) = group.as_object_mut()
            {
                g.insert("matcher".into(), Value::String("*".into()));
            }
            groups.push(group);
        }
    }

    write(&path, &root)?;
    Ok(ChangeReport {
        backup,
        status: status(Some(port)),
    })
}

pub fn uninstall(listening_port: Option<u16>) -> anyhow::Result<ChangeReport> {
    let (path, existing) = read_settings()?;
    let Some(mut root) = existing else {
        return Ok(ChangeReport {
            backup: None,
            status: status(listening_port),
        });
    };
    if scan(&root).0 == 0 {
        return Ok(ChangeReport {
            backup: None,
            status: status(listening_port),
        });
    }
    let backup = backup(&path)?;
    strip(&mut root);
    write(&path, &root)?;
    Ok(ChangeReport {
        backup,
        status: status(listening_port),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn user_settings() -> Value {
        json!({
            "model": "opus",
            "hooks": {
                "Stop": [
                    { "hooks": [{ "type": "command", "command": "say done" }] }
                ],
                "PreToolUse": [
                    { "matcher": "Bash", "hooks": [{ "type": "command", "command": "lint.sh" }] }
                ]
            }
        })
    }

    fn add_ours(root: &mut Value, port: u16) {
        let hooks = root["hooks"].as_object_mut().unwrap();
        for event in EVENTS {
            let groups = hooks.entry(event).or_insert_with(|| json!([]));
            groups
                .as_array_mut()
                .unwrap()
                .push(json!({ "hooks": [hook_entry(port, "t0k3n")] }));
        }
    }

    #[test]
    fn strip_removes_only_ours() {
        let mut root = user_settings();
        add_ours(&mut root, 47823);
        assert_eq!(scan(&root), (EVENTS.len(), Some(47823)));
        strip(&mut root);
        assert_eq!(root, user_settings());
    }

    #[test]
    fn strip_on_clean_settings_is_a_no_op() {
        let mut root = user_settings();
        strip(&mut root);
        assert_eq!(root, user_settings());
    }

    #[test]
    fn strip_drops_hooks_key_we_created() {
        let mut root = json!({ "model": "opus", "hooks": {} });
        add_ours(&mut root, 1);
        strip(&mut root);
        assert_eq!(root, json!({ "model": "opus" }));
    }

    #[test]
    fn entries_carry_the_token_header() {
        let hook = hook_entry(47823, "abc");
        assert!(is_ours(&hook));
        assert_eq!(token_of(&hook), Some("abc"));
    }

    #[test]
    fn port_is_parsed_from_url() {
        let hook = json!({ "type": "http", "url": "http://127.0.0.1:47830/hook?overlid=1" });
        assert!(is_ours(&hook));
        assert_eq!(port_of(&hook), Some(47830));
        assert!(!is_ours(&json!({ "type": "http", "url": "http://example.com/hook" })));
    }
}
