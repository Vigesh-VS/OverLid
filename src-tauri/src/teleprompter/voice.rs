//! Microphone loudness for voice-activated scrolling.
//!
//! Audio is processed in memory only: each callback adds its samples' squared
//! sum to a running total and the samples are dropped. Every 30 ms the total
//! becomes one RMS level. Nothing is recorded, stored or sent.
//!
//! Each consumer ("prompter", "settings") gets its own stream, so a mic test in
//! Settings can never stop the prompter's microphone.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use anyhow::Context;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, Stream};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::winreg::{self, Root};

pub const LEVEL_EVENT: &str = "voice://level";
pub const STATUS_EVENT: &str = "voice://status";

const EMIT_EVERY: Duration = Duration::from_millis(30);
/// Streams often deliver empty buffers while starting up.
const WARMUP: Duration = Duration::from_millis(1500);
/// This long of perfect digital silence means the mic is blocked or muted.
const SILENCE_LIMIT: Duration = Duration::from_secs(2);

const CONSENT_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum VoiceState {
    Starting,
    Listening,
    /// Windows privacy settings deny microphone access to desktop apps.
    Blocked,
    /// The stream runs but delivers pure silence (muted, or blocked by privacy).
    Silent,
    Error,
    Stopped,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceStatus {
    pub owner: String,
    pub state: VoiceState,
    pub device: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceLevel {
    pub owner: String,
    /// 0–1 on a -60 dBFS..0 dBFS scale.
    pub level: f32,
    pub dbfs: f32,
}

#[derive(Default)]
pub struct Voice(Mutex<HashMap<String, Sender<()>>>);

pub fn init(app: &AppHandle) {
    app.manage(Voice::default());
}

/// Windows "Let apps / desktop apps access your microphone" switches.
pub fn privacy_blocked() -> Option<&'static str> {
    let denied = |sub: &str, root| {
        winreg::read_string(root, sub, "Value").is_some_and(|v| v.eq_ignore_ascii_case("Deny"))
    };
    if denied(CONSENT_KEY, Root::LocalMachine) {
        return Some("Microphone access is turned off for this device in Windows privacy settings.");
    }
    if denied(CONSENT_KEY, Root::CurrentUser) {
        return Some("Microphone access is turned off in Settings › Privacy & security › Microphone.");
    }
    if denied(&format!(r"{CONSENT_KEY}\NonPackaged"), Root::CurrentUser) {
        return Some(
            "Desktop apps can't use the microphone. Turn on \"Let desktop apps access your microphone\" in Settings › Privacy & security › Microphone.",
        );
    }
    None
}

fn to_level(dbfs: f32) -> f32 {
    ((dbfs + 60.0) / 60.0).clamp(0.0, 1.0)
}

/// Running RMS inputs shared with the audio callback, lock-free: the squared
/// sum (scaled to an integer) and the sample count.
#[derive(Default)]
struct Accumulator {
    /// Σ sample² × 1e9, saturating.
    sum: AtomicU64,
    count: AtomicU64,
}

impl Accumulator {
    fn add<T: Copy>(&self, data: &[T], to_f32: impl Fn(T) -> f32) {
        let sum: f64 = data.iter().map(|&s| f64::from(to_f32(s)).powi(2)).sum();
        self.sum.fetch_add((sum * 1e9) as u64, Ordering::Relaxed);
        self.count.fetch_add(data.len() as u64, Ordering::Relaxed);
    }

    /// RMS since the last take, or None if no samples arrived.
    fn take(&self) -> Option<f32> {
        let count = self.count.swap(0, Ordering::Relaxed);
        let sum = self.sum.swap(0, Ordering::Relaxed) as f64 / 1e9;
        (count > 0).then(|| (sum / count as f64).sqrt() as f32)
    }
}

fn open_stream(device_name: Option<&str>, acc: Arc<Accumulator>) -> anyhow::Result<(Stream, String)> {
    let host = cpal::default_host();
    let device = match device_name {
        Some(name) => host
            .input_devices()?
            .find(|d| d.name().ok().as_deref() == Some(name))
            .or_else(|| host.default_input_device()),
        None => host.default_input_device(),
    }
    .context("No microphone found. Plug one in or pick another in Settings › Teleprompter.")?;
    let name = device.name().unwrap_or_else(|_| "Microphone".into());
    let config = device
        .default_input_config()
        .context("The microphone didn't report a usable format.")?;
    let format = config.sample_format();
    let config = config.config();
    let on_error = |e| log::warn!("microphone stream error: {e}");

    let stream = match format {
        SampleFormat::F32 => {
            device.build_input_stream(&config, move |d: &[f32], _| acc.add(d, |s| s), on_error, None)?
        }
        SampleFormat::I16 => device.build_input_stream(
            &config,
            move |d: &[i16], _| acc.add(d, |s| f32::from(s) / 32768.0),
            on_error,
            None,
        )?,
        SampleFormat::U16 => device.build_input_stream(
            &config,
            move |d: &[u16], _| acc.add(d, |s| (f32::from(s) - 32768.0) / 32768.0),
            on_error,
            None,
        )?,
        other => anyhow::bail!("Unsupported microphone sample format {other:?}."),
    };
    stream.play().context("Couldn't start the microphone.")?;
    Ok((stream, name))
}

fn status(app: &AppHandle, owner: &str, state: VoiceState, device: Option<&str>, message: Option<String>) {
    let payload = VoiceStatus {
        owner: owner.to_owned(),
        state,
        device: device.map(str::to_owned),
        message,
    };
    if let Err(e) = app.emit(STATUS_EVENT, payload) {
        log::warn!("emit {STATUS_EVENT} failed: {e}");
    }
}

fn run(app: &AppHandle, owner: &str, device: Option<&str>, stop: &mpsc::Receiver<()>) {
    status(app, owner, VoiceState::Starting, device, None);
    if let Some(reason) = privacy_blocked() {
        log::info!("voice mode blocked by privacy settings");
        status(app, owner, VoiceState::Blocked, device, Some(reason.into()));
        return;
    }
    let acc = Arc::new(Accumulator::default());
    // The stream lives on this thread only (cpal streams aren't Send).
    let (_stream, name) = match open_stream(device, Arc::clone(&acc)) {
        Ok(s) => s,
        Err(e) => {
            log::warn!("voice mode unavailable: {e:#}");
            status(app, owner, VoiceState::Error, device, Some(format!("{e:#}")));
            return;
        }
    };
    log::info!("voice mode listening on {name}");

    let started = Instant::now();
    let mut last_sound = Instant::now();
    let mut state = VoiceState::Starting;
    while let Err(RecvTimeoutError::Timeout) = stop.recv_timeout(EMIT_EVERY) {
        let rms = acc.take().unwrap_or(0.0);
        let dbfs = if rms > 0.0 { 20.0 * rms.log10() } else { -120.0 };
        if rms > 0.0 {
            last_sound = Instant::now();
        }
        let next = if started.elapsed() < WARMUP {
            VoiceState::Starting
        } else if last_sound.elapsed() >= SILENCE_LIMIT {
            VoiceState::Silent
        } else {
            VoiceState::Listening
        };
        if next != state {
            state = next;
            let message = (state == VoiceState::Silent).then(|| {
                "The microphone is sending pure silence. It may be muted, or blocked in Settings › Privacy & security › Microphone.".to_owned()
            });
            status(app, owner, state, Some(&name), message);
        }
        let _ = app.emit(
            LEVEL_EVENT,
            VoiceLevel {
                owner: owner.to_owned(),
                level: to_level(dbfs),
                dbfs,
            },
        );
    }
    status(app, owner, VoiceState::Stopped, Some(&name), None);
}

#[tauri::command]
pub fn voice_start(app: AppHandle, state: tauri::State<'_, Voice>, owner: String, device: Option<String>) {
    // Only the two known listeners, and a sane device name.
    if !matches!(owner.as_str(), "prompter" | "settings") {
        log::warn!("voice_start: unknown owner refused");
        return;
    }
    let device = device.filter(|d| d.chars().count() <= 256 && !d.chars().any(char::is_control));
    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    if let Ok(mut streams) = state.0.lock()
        && let Some(old) = streams.insert(owner.clone(), stop_tx)
    {
        let _ = old.send(());
    }
    let spawned = thread::Builder::new()
        .name(format!("voice-{owner}"))
        .spawn(move || run(&app, &owner, device.as_deref(), &stop_rx));
    if let Err(e) = spawned {
        log::error!("could not spawn voice thread: {e}");
    }
}

#[tauri::command]
pub fn voice_stop(state: tauri::State<'_, Voice>, owner: String) {
    if let Ok(mut streams) = state.0.lock()
        && let Some(stop) = streams.remove(&owner)
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

/// Reason the mic is blocked by Windows privacy settings, if it is.
#[tauri::command]
pub fn voice_privacy() -> Option<String> {
    privacy_blocked().map(str::to_owned)
}
