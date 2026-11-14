//! The pill's quick action button, and app icon extraction for its picker.

use std::path::Path;

use anyhow::{Context, bail};
use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use windows::Win32::Graphics::Gdi::{
    BI_RGB, BITMAPINFO, BITMAPINFOHEADER, DIB_RGB_COLORS, DeleteObject, GetDC, GetDIBits, ReleaseDC,
};
use windows::Win32::UI::Shell::{ExtractIconExW, ShellExecuteW};
use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, HICON, ICONINFO, SW_SHOWNORMAL};
use windows::core::{HSTRING, w};

use crate::settings::{self, QuickKind};

pub const PROMPTER_START_EVENT: &str = "prompter://start";

/// Open a file, folder or URL with its default handler. No shell command
/// strings are built: the target goes straight to ShellExecuteW.
fn shell_open(target: &str) -> anyhow::Result<()> {
    let file = HSTRING::from(target);
    // SAFETY: all strings are valid, null-terminated HSTRINGs.
    let result = unsafe { ShellExecuteW(None, w!("open"), &file, None, None, SW_SHOWNORMAL) };
    // ShellExecute returns a value greater than 32 on success.
    if result.0 as isize <= 32 {
        bail!("Windows couldn't open {target}");
    }
    Ok(())
}

fn looks_like_url(s: &str) -> bool {
    let lower = s.to_ascii_lowercase();
    lower.starts_with("https://") || lower.starts_with("http://") || lower.starts_with("mailto:")
}

/// Run the configured quick action.
#[tauri::command]
pub fn quick_action_run(app: AppHandle) -> Result<(), String> {
    let action = settings::current(&app).quick_action;
    let result: anyhow::Result<()> = match action.kind {
        QuickKind::None => Ok(()),
        QuickKind::Launch => {
            let path = action.payload.trim();
            if !Path::new(path).is_file() {
                Err(anyhow::anyhow!("The app at {path} wasn't found."))
            } else {
                shell_open(path)
            }
        }
        QuickKind::Url => {
            let target = action.payload.trim();
            if looks_like_url(target) || Path::new(target).exists() {
                shell_open(target)
            } else {
                Err(anyhow::anyhow!("{target} isn't a web address or an existing folder."))
            }
        }
        QuickKind::Pomodoro => {
            crate::pomodoro::pomo_start(app.clone());
            Ok(())
        }
        QuickKind::Media => {
            if let Some(media) = app.try_state::<crate::media::MediaHandle>() {
                crate::media::media_play_pause(media);
            }
            Ok(())
        }
        QuickKind::Prompter => app
            .emit(PROMPTER_START_EVENT, action.payload.trim().to_owned())
            .context("couldn't start the prompter"),
    };
    result.map_err(|e| {
        log::warn!("quick action failed: {e:#}");
        format!("{e:#}")
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppIcon {
    pub width: u32,
    pub height: u32,
    /// Base64 of top-down RGBA pixels.
    pub rgba: String,
}

/// The large (32 px) icon embedded in an .exe, as RGBA pixels.
#[tauri::command]
pub async fn app_icon(path: String) -> Result<AppIcon, String> {
    // Icons come only from a local .exe that exists. Network paths are
    // refused: reading one could send this PC's sign-in to a remote server.
    let local = crate::codenotch::sessions::is_local_path(&path)
        && path.to_ascii_lowercase().ends_with(".exe")
        && std::path::Path::new(&path).is_file();
    if !local {
        return Err("not a local program".into());
    }
    extract_icon(&path).map_err(|e| {
        log::debug!("icon extraction failed for {path}: {e:#}");
        format!("{e:#}")
    })
}

fn extract_icon(path: &str) -> anyhow::Result<AppIcon> {
    let file = HSTRING::from(path);
    let mut large = HICON::default();
    // SAFETY: valid out-pointer for one icon; destroyed below.
    let count = unsafe { ExtractIconExW(&file, 0, Some(&mut large), None, 1) };
    if count == 0 || large.is_invalid() {
        bail!("no icon in {path}");
    }
    let pixels = icon_to_rgba(large);
    // SAFETY: we own the extracted icon.
    unsafe {
        let _ = DestroyIcon(large);
    }
    pixels
}

fn icon_to_rgba(icon: HICON) -> anyhow::Result<AppIcon> {
    let mut info = ICONINFO::default();
    // SAFETY: icon is valid; bitmaps returned in `info` are deleted below.
    unsafe { GetIconInfo(icon, &mut info) }.context("GetIconInfo")?;
    let color = info.hbmColor;
    let result = (|| {
        if color.is_invalid() {
            bail!("monochrome icons aren't supported");
        }
        let size = 32i32;
        let mut bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: size,
                biHeight: -size, // top-down
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut bgra = vec![0u8; (size * size * 4) as usize];
        // SAFETY: buffer matches the 32x32x32bpp format described in bmi.
        let lines = unsafe {
            let dc = GetDC(None);
            let n = GetDIBits(dc, color, 0, size as u32, Some(bgra.as_mut_ptr().cast()), &mut bmi, DIB_RGB_COLORS);
            ReleaseDC(None, dc);
            n
        };
        if lines == 0 {
            bail!("GetDIBits failed");
        }
        // Icons without an alpha channel report alpha 0 everywhere: make them opaque.
        let (pixels, _) = bgra.as_chunks::<4>();
        let has_alpha = pixels.iter().any(|p| p[3] != 0);
        let mut rgba = Vec::with_capacity(bgra.len());
        for p in pixels {
            rgba.extend_from_slice(&[p[2], p[1], p[0], if has_alpha { p[3] } else { 255 }]);
        }
        Ok(AppIcon {
            width: size as u32,
            height: size as u32,
            rgba: base64::engine::general_purpose::STANDARD.encode(rgba),
        })
    })();
    // SAFETY: GetIconInfo handed us ownership of these bitmaps.
    unsafe {
        let _ = DeleteObject(info.hbmColor.into());
        let _ = DeleteObject(info.hbmMask.into());
    }
    result
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledApp {
    pub name: String,
    /// The shortcut's resolved .exe target.
    pub path: String,
}

/// Apps from the Start menu (all users and current user), resolved from
/// their shortcuts to the real .exe so launching never passes arguments.
#[tauri::command]
pub async fn list_installed_apps() -> Vec<InstalledApp> {
    tauri::async_runtime::spawn_blocking(scan_start_menu)
        .await
        .unwrap_or_default()
}

fn scan_start_menu() -> Vec<InstalledApp> {
    use std::collections::BTreeMap;
    use windows::Win32::System::Com::{CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, CoCreateInstance, CoInitializeEx, IPersistFile, STGM_READ};
    use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};
    use windows::core::Interface;

    let mut roots = Vec::new();
    if let Some(p) = std::env::var_os("ProgramData") {
        roots.push(std::path::PathBuf::from(p).join(r"Microsoft\Windows\Start Menu\Programs"));
    }
    if let Some(p) = std::env::var_os("APPDATA") {
        roots.push(std::path::PathBuf::from(p).join(r"Microsoft\Windows\Start Menu\Programs"));
    }

    // SAFETY: COM for this worker thread only.
    let _ = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
    // SAFETY: standard in-process ShellLink object.
    let Ok(link) = (unsafe { CoCreateInstance::<_, IShellLinkW>(&ShellLink, None, CLSCTX_INPROC_SERVER) }) else {
        return Vec::new();
    };
    let Ok(file) = link.cast::<IPersistFile>() else { return Vec::new() };

    let mut found: BTreeMap<String, InstalledApp> = BTreeMap::new();
    let mut stack = roots;
    let mut visited = 0usize;
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            visited += 1;
            if visited > 5000 {
                break;
            }
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            if !path.extension().is_some_and(|e| e.eq_ignore_ascii_case("lnk")) {
                continue;
            }
            let name = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
            let lower = name.to_ascii_lowercase();
            if lower.contains("uninstall") || lower.contains("readme") || lower.contains("help") {
                continue;
            }
            let target = HSTRING::from(path.as_os_str());
            let mut buf = [0u16; 1024];
            // SAFETY: read-only shortcut parsing into a fixed buffer.
            let resolved = unsafe {
                file.Load(&target, STGM_READ).is_ok()
                    && link.GetPath(&mut buf, std::ptr::null_mut(), 0).is_ok()
            };
            if !resolved {
                continue;
            }
            let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
            let exe = String::from_utf16_lossy(&buf[..len]);
            if exe.to_ascii_lowercase().ends_with(".exe") && Path::new(&exe).is_file() {
                found.entry(exe.to_ascii_lowercase()).or_insert(InstalledApp { name, path: exe });
            }
        }
    }
    let mut apps: Vec<InstalledApp> = found.into_values().collect();
    apps.sort_by_key(|a| a.name.to_lowercase());
    apps
}
