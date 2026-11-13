//! Microphone loudness for voice-activated scrolling.
//!
//! Audio is processed in memory only: each callback reduces its buffer to one
//! RMS number and the samples are dropped. Nothing is recorded, stored or sent.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use anyhow::Context;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, Stream};
use tauri::{AppHandle, Emitter, Manager};

pub const LEVEL_EVENT: &str = "voice://level";
pub const ERROR_EVENT: &str = "voice://error";

const EMIT_EVERY: Duration = Duration::from_millis(30);

#[derive(Default)]
pub struct Voice(Mutex<Option<Sender<()>>>);

pub fn init(app: &AppHandle) {
    app.manage(Voice::default());
}

/// RMS → 0–1 on a -60 dBFS..0 dBFS scale.
fn to_level(rms: f32) -> f32 {
    if rms <= 0.0 {
        return 0.0;
    }
    ((20.0 * rms.log10() + 60.0) / 60.0).clamp(0.0, 1.0)
}

fn rms<T: Copy>(data: &[T], to_f32: impl Fn(T) -> f32) -> f32 {
    if data.is_empty() {
        return 0.0;
    }
    let sum: f32 = data.iter().map(|&s| {
        let v = to_f32(s);
        v * v
    }).sum();
    (sum / data.len() as f32).sqrt()
}

fn open_stream(device_name: Option<&str>, peak: Arc<AtomicU32>) -> anyhow::Result<Stream> {
    let host = cpal::default_host();
    let device = match device_name {
        Some(name) => host
            .input_devices()?
            .find(|d| d.name().ok().as_deref() == Some(name))
            .or_else(|| host.default_input_device()),
        None => host.default_input_device(),
    }
    .context("no microphone found")?;
    let config = device.default_input_config().context("microphone has no usable format")?;
    let format = config.sample_format();
    let config = config.config();
    let on_error = |e| log::warn!("microphone stream error: {e}");

    // Keep the loudest reading since the last emit. Positive f32 bit patterns
    // order the same as their values, so fetch_max works on the raw bits.
    let stream = match format {
        SampleFormat::F32 => device.build_input_stream(
            &config,
            move |data: &[f32], _| {
                peak.fetch_max(rms(data, |s| s).to_bits(), Ordering::Relaxed);
            },
            on_error,
            None,
        )?,
        SampleFormat::I16 => device.build_input_stream(
            &config,
            move |data: &[i16], _| {
                peak.fetch_max(rms(data, |s| f32::from(s) / 32768.0).to_bits(), Ordering::Relaxed);
            },
            on_error,
            None,
        )?,
        SampleFormat::U16 => device.build_input_stream(
            &config,
            move |data: &[u16], _| {
                peak.fetch_max(
                    rms(data, |s| (f32::from(s) - 32768.0) / 32768.0).to_bits(),
                    Ordering::Relaxed,
                );
            },
            on_error,
            None,
        )?,
        other => anyhow::bail!("unsupported microphone sample format {other:?}"),
    };
    stream.play().context("couldn't start the microphone")?;
    Ok(stream)
}

#[tauri::command]
pub fn voice_start(app: AppHandle, state: tauri::State<'_, Voice>, device: Option<String>) {
    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    if let Ok(mut current) = state.0.lock()
        && let Some(old) = current.replace(stop_tx)
    {
        let _ = old.send(());
    }
    let spawned = thread::Builder::new().name("voice".into()).spawn(move || {
        let peak = Arc::new(AtomicU32::new(0));
        // The stream lives on this thread only (cpal streams aren't Send).
        let _stream = match open_stream(device.as_deref(), Arc::clone(&peak)) {
            Ok(s) => s,
            Err(e) => {
                log::warn!("voice mode unavailable: {e:#}");
                let _ = app.emit(ERROR_EVENT, format!("{e:#}"));
                return;
            }
        };
        // Stop on a message or when the sender is dropped.
        while let Err(RecvTimeoutError::Timeout) = stop_rx.recv_timeout(EMIT_EVERY) {
            let level = to_level(f32::from_bits(peak.swap(0, Ordering::Relaxed)));
            let _ = app.emit(LEVEL_EVENT, level);
        }
        let _ = app.emit(LEVEL_EVENT, 0.0_f32);
    });
    if let Err(e) = spawned {
        log::error!("could not spawn voice thread: {e}");
    }
}

#[tauri::command]
pub fn voice_stop(state: tauri::State<'_, Voice>) {
    if let Ok(mut current) = state.0.lock()
        && let Some(stop) = current.take()
    {
        let _ = stop.send(());
    }
}

#[tauri::command]
pub fn voice_devices() -> Vec<String> {
    let host = cpal::default_host();
    match host.input_devices() {
        Ok(devices) => devices.filter_map(|d| d.name().ok()).collect(),
        Err(e) => {
            log::debug!("listing microphones failed: {e}");
            Vec::new()
        }
    }
}
