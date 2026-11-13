//! Colour sources for the teleprompter's optional ambient background.
//!
//! "Live screen colour" samples the main display about once a second while
//! the prompter is presenting with that source selected: a tiny downscaled
//! copy (16×9) is averaged in memory and immediately discarded. Nothing is
//! saved or sent. Our own island is content-protected while presenting, so
//! it's excluded from the capture.

use std::thread;
use std::time::Duration;

use base64::Engine;
use tauri::{AppHandle, Emitter};
use windows::Win32::Graphics::Gdi::{
    BI_RGB, BITMAPINFO, BITMAPINFOHEADER, COLOR_DESKTOP, CreateCompatibleBitmap, CreateCompatibleDC, DIB_RGB_COLORS,
    DeleteDC, DeleteObject, GetDC, GetDIBits, GetSysColor, HALFTONE, ReleaseDC, SRCCOPY, SelectObject,
    SetStretchBltMode, StretchBlt,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetSystemMetrics, SM_CXSCREEN, SM_CYSCREEN, SPI_GETDESKWALLPAPER, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS,
    SystemParametersInfoW,
};

use crate::settings::{self, AmbientSource};

pub const COLOR_EVENT: &str = "ambient://color";

const SAMPLE_W: i32 = 16;
const SAMPLE_H: i32 = 9;
const MAX_WALLPAPER_BYTES: u64 = 15 * 1024 * 1024;

pub fn start(app: &AppHandle) {
    let app = app.clone();
    let spawned = thread::Builder::new().name("ambient".into()).spawn(move || {
        let mut last = String::new();
        loop {
            thread::sleep(Duration::from_secs(1));
            let prompter = settings::current(&app).prompter;
            let active = crate::window::flags(&app).prompter
                && prompter.ambient.enabled
                && prompter.ambient.source == AmbientSource::Screen;
            if !active {
                last.clear();
                continue;
            }
            if let Some(hex) = sample_screen()
                && hex != last
            {
                let _ = app.emit(COLOR_EVENT, &hex);
                last = hex;
            }
        }
    });
    if let Err(e) = spawned {
        log::error!("could not spawn ambient sampler: {e}");
    }
}

/// Average colour of the main display, weighted towards saturated pixels.
fn sample_screen() -> Option<String> {
    // SAFETY: GDI objects created here are all released before returning.
    unsafe {
        let screen = GetDC(None);
        if screen.is_invalid() {
            return None;
        }
        let mem = CreateCompatibleDC(Some(screen));
        let bitmap = CreateCompatibleBitmap(screen, SAMPLE_W, SAMPLE_H);
        let old = SelectObject(mem, bitmap.into());
        SetStretchBltMode(mem, HALFTONE);
        let (w, h) = (GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN));
        let ok = StretchBlt(mem, 0, 0, SAMPLE_W, SAMPLE_H, Some(screen), 0, 0, w, h, SRCCOPY).as_bool();

        let mut bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: SAMPLE_W,
                biHeight: -SAMPLE_H,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut pixels = vec![0u8; (SAMPLE_W * SAMPLE_H * 4) as usize];
        SelectObject(mem, old);
        let lines = if ok {
            GetDIBits(mem, bitmap, 0, SAMPLE_H as u32, Some(pixels.as_mut_ptr().cast()), &mut bmi, DIB_RGB_COLORS)
        } else {
            0
        };
        let _ = DeleteObject(bitmap.into());
        let _ = DeleteDC(mem);
        ReleaseDC(None, screen);
        if lines == 0 {
            return None;
        }
        Some(average(&pixels))
    }
}

fn average(bgra: &[u8]) -> String {
    let (mut r, mut g, mut b, mut total) = (0.0f64, 0.0f64, 0.0f64, 0.0f64);
    let (pixels, _) = bgra.as_chunks::<4>();
    for p in pixels {
        let (pb, pg, pr) = (f64::from(p[0]), f64::from(p[1]), f64::from(p[2]));
        let max = pr.max(pg).max(pb);
        let min = pr.min(pg).min(pb);
        let weight = 1.0 + (max - min) / 255.0 * 4.0;
        r += pr * weight;
        g += pg * weight;
        b += pb * weight;
        total += weight;
    }
    if total == 0.0 {
        return "#000000".into();
    }
    format!(
        "#{:02x}{:02x}{:02x}",
        (r / total).round() as u8,
        (g / total).round() as u8,
        (b / total).round() as u8
    )
}

/// The desktop wallpaper as a data URL, or the solid desktop colour as hex.
#[tauri::command]
pub async fn ambient_wallpaper() -> Option<String> {
    let mut buf = [0u16; 260];
    // SAFETY: buffer length is passed in uiparam.
    let ok = unsafe {
        SystemParametersInfoW(
            SPI_GETDESKWALLPAPER,
            buf.len() as u32,
            Some(buf.as_mut_ptr().cast()),
            SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
        )
    }
    .is_ok();
    let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    let path = String::from_utf16_lossy(&buf[..len]);
    if ok && !path.is_empty() {
        let meta = std::fs::metadata(&path).ok()?;
        if meta.len() <= MAX_WALLPAPER_BYTES
            && let Ok(bytes) = std::fs::read(&path)
        {
            let mime = match path.rsplit('.').next().map(str::to_ascii_lowercase).as_deref() {
                Some("png") => "image/png",
                Some("bmp") => "image/bmp",
                Some("webp") => "image/webp",
                _ => "image/jpeg",
            };
            let data = base64::engine::general_purpose::STANDARD.encode(bytes);
            return Some(format!("data:{mime};base64,{data}"));
        }
    }
    // Solid-colour desktop: COLORREF is 0x00BBGGRR.
    // SAFETY: no preconditions.
    let c = unsafe { GetSysColor(COLOR_DESKTOP) };
    Some(format!("#{:02x}{:02x}{:02x}", c & 0xff, (c >> 8) & 0xff, (c >> 16) & 0xff))
}
