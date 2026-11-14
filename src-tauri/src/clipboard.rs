//! Clipboard history for the Home panel: text and images you copy, newest
//! first, click to copy again.
//!
//! Privacy: history lives in memory only (never written to disk) and clears
//! when Overlid quits. Content that password managers and Windows mark as
//! private ("ExcludeClipboardContentFromMonitorProcessing",
//! "CanIncludeInClipboardHistory" = 0) is never recorded. Change detection
//! polls the clipboard's sequence number; there is no hook.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::Duration;

use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use windows::Win32::Foundation::{HANDLE, HGLOBAL, HWND};
use windows::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, GetClipboardData, GetClipboardSequenceNumber, IsClipboardFormatAvailable,
    OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
};
use windows::Win32::System::Memory::{GMEM_MOVEABLE, GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock};
use windows::Win32::System::Ole::{CF_DIB, CF_UNICODETEXT};
use windows::core::w;

use crate::settings;

pub const CHANGED_EVENT: &str = "clipboard://changed";

const MAX_ITEMS: usize = 30;
/// Longest text kept per item (characters).
const MAX_TEXT: usize = 20_000;
/// Text shown in the list (characters).
const PREVIEW: usize = 400;
/// Images larger than this aren't kept (bytes of DIB data).
const MAX_IMAGE_BYTES: usize = 64 * 1024 * 1024;
const THUMB: u32 = 160;

enum Content {
    Text(String),
    /// The original CF_DIB bytes (to copy back) plus a small thumbnail.
    Image { dib: Vec<u8>, width: u32, height: u32, thumb: Thumb },
}

#[derive(Clone)]
struct Thumb {
    width: u32,
    height: u32,
    rgba: Vec<u8>,
}

struct Entry {
    id: u64,
    hash: u64,
    content: Content,
    copied_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipItem {
    pub id: u64,
    /// "text" or "image".
    pub kind: &'static str,
    pub text: Option<String>,
    /// Full image size.
    pub width: Option<u32>,
    pub height: Option<u32>,
    /// Thumbnail as base64 RGBA (top-down), with its size.
    pub thumb: Option<String>,
    pub thumb_width: Option<u32>,
    pub thumb_height: Option<u32>,
    pub copied_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Default)]
pub struct Clipboard {
    items: Mutex<Vec<Entry>>,
}

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

fn to_item(e: &Entry) -> ClipItem {
    match &e.content {
        Content::Text(t) => ClipItem {
            id: e.id,
            kind: "text",
            text: Some(t.chars().take(PREVIEW).collect()),
            width: None,
            height: None,
            thumb: None,
            thumb_width: None,
            thumb_height: None,
            copied_at: e.copied_at,
        },
        Content::Image { width, height, thumb, .. } => ClipItem {
            id: e.id,
            kind: "image",
            text: None,
            width: Some(*width),
            height: Some(*height),
            thumb: Some(base64::engine::general_purpose::STANDARD.encode(&thumb.rgba)),
            thumb_width: Some(thumb.width),
            thumb_height: Some(thumb.height),
            copied_at: e.copied_at,
        },
    }
}

fn list(app: &AppHandle) -> Vec<ClipItem> {
    app.try_state::<Clipboard>()
        .and_then(|c| c.items.lock().ok().map(|items| items.iter().map(to_item).collect()))
        .unwrap_or_default()
}

fn emit(app: &AppHandle) {
    if let Err(e) = app.emit(CHANGED_EVENT, list(app)) {
        log::warn!("emit {CHANGED_EVENT} failed: {e}");
    }
}

pub fn start(app: &AppHandle) {
    app.manage(Clipboard::default());
    let app = app.clone();
    let spawned = thread::Builder::new().name("clipboard".into()).spawn(move || {
        // SAFETY: no preconditions.
        let mut last = unsafe { GetClipboardSequenceNumber() };
        loop {
            thread::sleep(Duration::from_millis(500));
            // SAFETY: no preconditions.
            let seq = unsafe { GetClipboardSequenceNumber() };
            if seq == last {
                continue;
            }
            last = seq;
            if !settings::current(&app).general.clipboard_history {
                continue;
            }
            if let Some(content) = read_clipboard() {
                record(&app, content);
            }
        }
    });
    if let Err(e) = spawned {
        log::error!("could not spawn clipboard watcher: {e}");
    }
}

fn hash_of(content: &Content) -> u64 {
    let mut h = DefaultHasher::new();
    match content {
        Content::Text(t) => t.hash(&mut h),
        Content::Image { dib, .. } => dib.hash(&mut h),
    }
    h.finish()
}

fn record(app: &AppHandle, content: Content) {
    let Some(state) = app.try_state::<Clipboard>() else { return };
    let hash = hash_of(&content);
    if let Ok(mut items) = state.items.lock() {
        // Copying something already in the list moves it to the top.
        let existing = items.iter().position(|e| e.hash == hash);
        let entry = match existing {
            Some(i) => {
                let mut e = items.remove(i);
                e.copied_at = chrono::Utc::now();
                e
            }
            None => Entry {
                id: NEXT_ID.fetch_add(1, Ordering::Relaxed),
                hash,
                content,
                copied_at: chrono::Utc::now(),
            },
        };
        items.insert(0, entry);
        items.truncate(MAX_ITEMS);
    }
    emit(app);
}

/// RAII: the clipboard is open until this is dropped.
struct Open;

impl Open {
    fn new(owner: Option<HWND>) -> Option<Self> {
        // Another app may hold the clipboard briefly; retry a few times.
        for _ in 0..5 {
            // SAFETY: paired with CloseClipboard in Drop.
            if unsafe { OpenClipboard(owner) }.is_ok() {
                return Some(Open);
            }
            thread::sleep(Duration::from_millis(30));
        }
        None
    }
}

impl Drop for Open {
    fn drop(&mut self) {
        // SAFETY: we opened it.
        let _ = unsafe { CloseClipboard() };
    }
}

/// Bytes of a clipboard format, if present.
fn data_of(format: u32) -> Option<Vec<u8>> {
    // SAFETY: clipboard is open (caller holds `Open`); the global memory is
    // only read between GlobalLock and GlobalUnlock.
    unsafe {
        IsClipboardFormatAvailable(format).ok()?;
        let handle = GetClipboardData(format).ok()?;
        let global = HGLOBAL(handle.0);
        let size = GlobalSize(global);
        let ptr = GlobalLock(global) as *const u8;
        if ptr.is_null() || size == 0 {
            return None;
        }
        let bytes = std::slice::from_raw_parts(ptr, size).to_vec();
        let _ = GlobalUnlock(global);
        Some(bytes)
    }
}

fn is_private() -> bool {
    // SAFETY: registering a format name has no preconditions.
    let exclude = unsafe { RegisterClipboardFormatW(w!("ExcludeClipboardContentFromMonitorProcessing")) };
    // SAFETY: as above.
    let history = unsafe { RegisterClipboardFormatW(w!("CanIncludeInClipboardHistory")) };
    // SAFETY: clipboard is open (caller holds `Open`).
    if exclude != 0 && unsafe { IsClipboardFormatAvailable(exclude) }.is_ok() {
        return true;
    }
    if history != 0
        && let Some(bytes) = data_of(history)
        && bytes.len() >= 4
    {
        return u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) == 0;
    }
    false
}

fn read_clipboard() -> Option<Content> {
    let _open = Open::new(None)?;
    if is_private() {
        return None;
    }
    if let Some(bytes) = data_of(u32::from(CF_UNICODETEXT.0)) {
        let (pairs, _) = bytes.as_chunks::<2>();
        let wide: Vec<u16> = pairs.iter().map(|c| u16::from_le_bytes(*c)).collect();
        let end = wide.iter().position(|&c| c == 0).unwrap_or(wide.len());
        let text: String = String::from_utf16_lossy(&wide[..end]).chars().take(MAX_TEXT).collect();
        return (!text.trim().is_empty()).then_some(Content::Text(text));
    }
    if let Some(dib) = data_of(u32::from(CF_DIB.0)) {
        if dib.len() > MAX_IMAGE_BYTES {
            return None;
        }
        let (width, height, thumb) = dib_thumbnail(&dib)?;
        return Some(Content::Image { dib, width, height, thumb });
    }
    None
}

fn le_i32(b: &[u8], at: usize) -> Option<i32> {
    Some(i32::from_le_bytes(b.get(at..at + 4)?.try_into().ok()?))
}

fn le_u32(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(b.get(at..at + 4)?.try_into().ok()?))
}

fn le_u16(b: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_le_bytes(b.get(at..at + 2)?.try_into().ok()?))
}

/// Parse a 24/32-bit CF_DIB and make an RGBA thumbnail (max 160 px).
/// Returns None for formats we don't handle; every read is bounds-checked.
fn dib_thumbnail(dib: &[u8]) -> Option<(u32, u32, Thumb)> {
    let header = le_u32(dib, 0)? as usize;
    let width = le_i32(dib, 4)?;
    let raw_height = le_i32(dib, 8)?;
    let bits = le_u16(dib, 14)?;
    let compression = le_u32(dib, 16)?;
    let colors_used = le_u32(dib, 32)? as usize;
    if width <= 0 || raw_height == 0 || !(bits == 24 || bits == 32) || !(compression == 0 || compression == 3) {
        return None;
    }
    let top_down = raw_height < 0;
    let height = raw_height.unsigned_abs();
    let width = width.unsigned_abs();
    let masks = if compression == 3 && header == 40 { 12 } else { 0 };
    let offset = header + masks + colors_used * 4;
    let bpp = usize::from(bits / 8);
    let stride = (width as usize * bpp).div_ceil(4) * 4;
    let pixels = dib.get(offset..offset + stride * height as usize)?;

    let scale = (f64::from(width.max(height)) / f64::from(THUMB)).max(1.0);
    let tw = ((f64::from(width) / scale).round() as u32).max(1);
    let th = ((f64::from(height) / scale).round() as u32).max(1);
    let mut rgba = Vec::with_capacity((tw * th * 4) as usize);
    let mut any_alpha = false;
    for ty in 0..th {
        let sy = ((f64::from(ty) * scale) as u32).min(height - 1);
        let row = if top_down { sy } else { height - 1 - sy } as usize;
        for tx in 0..tw {
            let sx = ((f64::from(tx) * scale) as u32).min(width - 1) as usize;
            let i = row * stride + sx * bpp;
            let p = pixels.get(i..i + bpp)?;
            let a = if bpp == 4 { p[3] } else { 255 };
            any_alpha |= bpp == 4 && a != 0;
            rgba.extend_from_slice(&[p[2], p[1], p[0], a]);
        }
    }
    // Many apps leave the alpha byte at 0 in 32-bit DIBs: treat as opaque.
    if bpp == 4 && !any_alpha {
        let (px, _) = rgba.as_chunks_mut::<4>();
        for p in px {
            p[3] = 255;
        }
    }
    Some((width, height, Thumb { width: tw, height: th, rgba }))
}

/// Put bytes on the clipboard in one format. Needs a window as owner, or
/// SetClipboardData fails.
fn write_clipboard(owner: HWND, format: u32, bytes: &[u8]) -> anyhow::Result<()> {
    let _open = Open::new(Some(owner)).ok_or_else(|| anyhow::anyhow!("the clipboard is busy"))?;
    // SAFETY: the clipboard is open; the global block is filled then handed
    // to the system, which owns it after SetClipboardData succeeds.
    unsafe {
        EmptyClipboard()?;
        let global = GlobalAlloc(GMEM_MOVEABLE, bytes.len())?;
        let ptr = GlobalLock(global) as *mut u8;
        if ptr.is_null() {
            anyhow::bail!("couldn't lock clipboard memory");
        }
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr, bytes.len());
        let _ = GlobalUnlock(global);
        SetClipboardData(format, Some(HANDLE(global.0)))?;
    }
    Ok(())
}

fn owner_hwnd(app: &AppHandle) -> Option<HWND> {
    let win = app.get_webview_window(crate::window::ISLAND_LABEL)?;
    let raw = win.hwnd().ok()?;
    Some(HWND(raw.0 as _))
}

#[tauri::command]
pub fn clipboard_list(app: AppHandle) -> Vec<ClipItem> {
    list(&app)
}

/// Copy a history item back onto the clipboard.
#[tauri::command]
pub fn clipboard_copy(app: AppHandle, id: u64) -> Result<(), String> {
    let owner = owner_hwnd(&app).ok_or_else(|| "island window not ready".to_owned())?;
    let (format, bytes) = {
        let state = app.try_state::<Clipboard>().ok_or_else(|| "not ready".to_owned())?;
        let items = state.items.lock().map_err(|_| "busy".to_owned())?;
        let entry = items.iter().find(|e| e.id == id).ok_or_else(|| "that item is gone".to_owned())?;
        match &entry.content {
            Content::Text(t) => {
                let mut wide: Vec<u16> = t.encode_utf16().collect();
                wide.push(0);
                let bytes: Vec<u8> = wide.iter().flat_map(|c| c.to_le_bytes()).collect();
                (u32::from(CF_UNICODETEXT.0), bytes)
            }
            Content::Image { dib, .. } => (u32::from(CF_DIB.0), dib.clone()),
        }
    };
    write_clipboard(owner, format, &bytes).map_err(|e| {
        log::warn!("copy to clipboard failed: {e:#}");
        format!("{e:#}")
    })
}

#[tauri::command]
pub fn clipboard_remove(app: AppHandle, id: u64) {
    if let Some(state) = app.try_state::<Clipboard>()
        && let Ok(mut items) = state.items.lock()
    {
        items.retain(|e| e.id != id);
    }
    emit(&app);
}

#[tauri::command]
pub fn clipboard_clear(app: AppHandle) {
    clear(&app);
}

pub fn clear(app: &AppHandle) {
    if let Some(state) = app.try_state::<Clipboard>()
        && let Ok(mut items) = state.items.lock()
    {
        items.clear();
    }
    emit(app);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 2x2 bottom-up 32-bit DIB: red, green / blue, white (alpha all 0).
    fn sample_dib() -> Vec<u8> {
        let mut d = vec![0u8; 40];
        d[0..4].copy_from_slice(&40u32.to_le_bytes());
        d[4..8].copy_from_slice(&2i32.to_le_bytes());
        d[8..12].copy_from_slice(&2i32.to_le_bytes());
        d[12..14].copy_from_slice(&1u16.to_le_bytes());
        d[14..16].copy_from_slice(&32u16.to_le_bytes());
        // Bottom row first (bottom-up): blue, white. Then top: red, green. BGRA.
        d.extend_from_slice(&[255, 0, 0, 0, 255, 255, 255, 0]);
        d.extend_from_slice(&[0, 0, 255, 0, 0, 255, 0, 0]);
        d
    }

    #[test]
    fn decodes_bottom_up_dib_and_fixes_alpha() {
        let (w, h, t) = dib_thumbnail(&sample_dib()).unwrap();
        assert_eq!((w, h, t.width, t.height), (2, 2, 2, 2));
        // Top-left is red, opaque.
        assert_eq!(&t.rgba[0..4], &[255, 0, 0, 255]);
        // Bottom-right is white.
        assert_eq!(&t.rgba[12..16], &[255, 255, 255, 255]);
    }

    #[test]
    fn rejects_truncated_or_unsupported_dibs() {
        let mut short = sample_dib();
        short.truncate(44);
        assert!(dib_thumbnail(&short).is_none());
        let mut eight_bit = sample_dib();
        eight_bit[14..16].copy_from_slice(&8u16.to_le_bytes());
        assert!(dib_thumbnail(&eight_bit).is_none());
        assert!(dib_thumbnail(&[0u8; 10]).is_none());
    }
}
