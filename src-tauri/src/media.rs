//! Now-playing via Windows' System Media Transport Controls (SMTC).
//!
//! One worker thread owns the WinRT session manager. SMTC events only post a
//! `Refresh` to the worker's channel; the worker re-reads the session and emits
//! `media://update`. Event-driven, never polled.

use std::sync::Mutex;
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;
use std::time::Duration;

use anyhow::Context;
use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use windows::Foundation::TypedEventHandler;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as Session,
    GlobalSystemMediaTransportControlsSessionManager as SessionManager,
    GlobalSystemMediaTransportControlsSessionMediaProperties as MediaProperties,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlaybackStatus,
};
use windows::Storage::Streams::{Buffer, DataReader, InputStreamOptions};
use windows::Win32::System::Com::{COINIT_MULTITHREADED, CoInitializeEx};

pub const UPDATE_EVENT: &str = "media://update";

/// Thumbnails larger than this are skipped (keeps IPC payloads sane).
const MAX_ART_BYTES: u32 = 4 * 1024 * 1024;
/// Windows epoch (1601) to Unix epoch, in 100 ns ticks.
const EPOCH_DIFF_TICKS: i64 = 116_444_736_000_000_000;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaState {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub source_app: String,
    pub source_id: String,
    pub playing: bool,
    pub position_ms: u64,
    pub duration_ms: u64,
    /// Unix ms when `position_ms` was sampled by the player.
    pub timeline_at_ms: i64,
    /// `data:` URL of the album art, if the player provides one.
    pub art: Option<String>,
    pub session_index: usize,
    pub session_count: usize,
}

enum Cmd {
    Refresh,
    Resubscribe,
    PlayPause,
    Next,
    Previous,
    Seek(u64),
    Cycle,
}

pub struct MediaHandle {
    tx: Mutex<Option<Sender<Cmd>>>,
    last: Mutex<Option<MediaState>>,
}

impl MediaHandle {
    fn send(&self, cmd: Cmd) {
        match self.tx.lock() {
            Ok(tx) => {
                if let Some(tx) = tx.as_ref() {
                    let _ = tx.send(cmd);
                }
            }
            Err(e) => log::error!("media sender lock poisoned: {e}"),
        }
    }
}

pub fn start(app: &AppHandle) {
    let (tx, rx) = mpsc::channel();
    app.manage(MediaHandle {
        tx: Mutex::new(Some(tx.clone())),
        last: Mutex::new(None),
    });
    let app = app.clone();
    let spawned = thread::Builder::new()
        .name("media".into())
        .spawn(move || {
            if let Err(e) = run(&app, tx, rx) {
                log::warn!("media module disabled: {e:#}");
                publish(&app, None);
            }
        });
    if let Err(e) = spawned {
        log::error!("could not spawn media thread: {e}");
    }
}

#[tauri::command]
pub fn media_get(handle: tauri::State<'_, MediaHandle>) -> Option<MediaState> {
    handle.last.lock().ok().and_then(|l| l.clone())
}

#[tauri::command]
pub fn media_play_pause(handle: tauri::State<'_, MediaHandle>) {
    handle.send(Cmd::PlayPause);
}

#[tauri::command]
pub fn media_next(handle: tauri::State<'_, MediaHandle>) {
    handle.send(Cmd::Next);
}

#[tauri::command]
pub fn media_previous(handle: tauri::State<'_, MediaHandle>) {
    handle.send(Cmd::Previous);
}

#[tauri::command]
pub fn media_seek(handle: tauri::State<'_, MediaHandle>, position_ms: u64) {
    handle.send(Cmd::Seek(position_ms));
}

#[tauri::command]
pub fn media_cycle_session(handle: tauri::State<'_, MediaHandle>) {
    handle.send(Cmd::Cycle);
}

fn publish(app: &AppHandle, state: Option<MediaState>) {
    if let Some(handle) = app.try_state::<MediaHandle>() {
        match handle.last.lock() {
            Ok(mut last) => {
                if *last == state {
                    return;
                }
                *last = state.clone();
            }
            Err(e) => log::error!("media state lock poisoned: {e}"),
        }
    }
    if let Err(e) = app.emit(UPDATE_EVENT, state) {
        log::warn!("emit {UPDATE_EVENT} failed: {e}");
    }
}

struct Subscription {
    session: Session,
    props_token: i64,
    playback_token: i64,
    timeline_token: i64,
}

impl Drop for Subscription {
    fn drop(&mut self) {
        let _ = self.session.RemoveMediaPropertiesChanged(self.props_token);
        let _ = self.session.RemovePlaybackInfoChanged(self.playback_token);
        let _ = self.session.RemoveTimelinePropertiesChanged(self.timeline_token);
    }
}

struct Worker {
    app: AppHandle,
    tx: Sender<Cmd>,
    manager: SessionManager,
    sub: Option<Subscription>,
    /// Session picked by clicking the art; `None` follows Windows' current session.
    pinned_id: Option<String>,
    art_key: String,
    art: Option<String>,
    art_retries: u8,
}

fn run(app: &AppHandle, tx: Sender<Cmd>, rx: Receiver<Cmd>) -> anyhow::Result<()> {
    // SAFETY: initialises COM for this worker thread only; WinRT needs it.
    unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }
        .ok()
        .context("CoInitializeEx")?;

    let manager = SessionManager::RequestAsync()?
        .join()
        .context("SMTC session manager unavailable")?;

    manager.CurrentSessionChanged(&notify(&tx, || Cmd::Resubscribe))?;
    manager.SessionsChanged(&notify(&tx, || Cmd::Resubscribe))?;

    let mut worker = Worker {
        app: app.clone(),
        tx,
        manager,
        sub: None,
        pinned_id: None,
        art_key: String::new(),
        art: None,
        art_retries: 0,
    };
    worker.resubscribe();

    while let Ok(cmd) = rx.recv() {
        // Collapse bursts of change events into one refresh.
        let mut pending = vec![cmd];
        while let Ok(more) = rx.try_recv() {
            pending.push(more);
        }
        let mut refresh = false;
        let mut resubscribe = false;
        for cmd in pending {
            match cmd {
                Cmd::Refresh => refresh = true,
                Cmd::Resubscribe => resubscribe = true,
                Cmd::Cycle => {
                    worker.cycle();
                    resubscribe = true;
                }
                other => worker.control(other),
            }
        }
        if resubscribe {
            worker.resubscribe();
        } else if refresh {
            worker.refresh();
        }
    }
    Ok(())
}

impl Worker {
    fn sessions(&self) -> Vec<Session> {
        match self.manager.GetSessions() {
            Ok(list) => list.into_iter().collect(),
            Err(e) => {
                log::debug!("GetSessions failed: {e}");
                Vec::new()
            }
        }
    }

    fn pick_session(&self, sessions: &[Session]) -> Option<Session> {
        if let Some(pinned) = &self.pinned_id
            && let Some(s) = sessions.iter().find(|s| same_app(s, pinned))
        {
            return Some(s.clone());
        }
        self.manager
            .GetCurrentSession()
            .ok()
            .or_else(|| sessions.first().cloned())
    }

    fn resubscribe(&mut self) {
        self.sub = None;
        let sessions = self.sessions();
        if let Some(session) = self.pick_session(&sessions) {
            match self.subscribe(session) {
                Ok(sub) => self.sub = Some(sub),
                Err(e) => log::debug!("media subscribe failed: {e}"),
            }
        }
        self.refresh();
    }

    fn subscribe(&self, session: Session) -> windows::core::Result<Subscription> {
        let props_token = session.MediaPropertiesChanged(&notify(&self.tx, || Cmd::Refresh))?;
        let playback_token = session.PlaybackInfoChanged(&notify(&self.tx, || Cmd::Refresh))?;
        let timeline_token =
            session.TimelinePropertiesChanged(&notify(&self.tx, || Cmd::Refresh))?;
        Ok(Subscription {
            session,
            props_token,
            playback_token,
            timeline_token,
        })
    }

    fn cycle(&mut self) {
        let sessions = self.sessions();
        if sessions.len() < 2 {
            return;
        }
        let ids: Vec<String> = sessions
            .iter()
            .filter_map(|s| s.SourceAppUserModelId().ok().map(|id| id.to_string()))
            .collect();
        let current = self
            .sub
            .as_ref()
            .and_then(|s| s.session.SourceAppUserModelId().ok())
            .map(|id| id.to_string());
        let index = current
            .and_then(|c| ids.iter().position(|id| *id == c))
            .map_or(0, |i| (i + 1) % ids.len());
        self.pinned_id = ids.get(index).cloned();
    }

    fn control(&self, cmd: Cmd) {
        let Some(sub) = &self.sub else { return };
        let s = &sub.session;
        let result = match cmd {
            Cmd::PlayPause => s.TryTogglePlayPauseAsync().and_then(|op| op.join()),
            Cmd::Next => s.TrySkipNextAsync().and_then(|op| op.join()),
            Cmd::Previous => s.TrySkipPreviousAsync().and_then(|op| op.join()),
            Cmd::Seek(ms) => {
                let ticks = i64::try_from(ms).unwrap_or(i64::MAX / 10_000) * 10_000;
                s.TryChangePlaybackPositionAsync(ticks).and_then(|op| op.join())
            }
            Cmd::Refresh | Cmd::Resubscribe | Cmd::Cycle => return,
        };
        if let Err(e) = result {
            log::debug!("media control failed: {e}");
        }
    }

    fn refresh(&mut self) {
        let state = match &self.sub {
            Some(sub) => {
                let session = sub.session.clone();
                match self.read(&session) {
                    Ok(state) => Some(state),
                    Err(e) => {
                        log::debug!("media read failed: {e:#}");
                        None
                    }
                }
            }
            None => None,
        };
        publish(&self.app, state);
    }

    fn read(&mut self, session: &Session) -> anyhow::Result<MediaState> {
        let props = session.TryGetMediaPropertiesAsync()?.join()?;
        let title = props.Title()?.to_string();
        let artist = props.Artist()?.to_string();
        let album = props.AlbumTitle()?.to_string();
        let source_id = session.SourceAppUserModelId()?.to_string();

        let playing = session
            .GetPlaybackInfo()
            .and_then(|i| i.PlaybackStatus())
            .map(|s| s == PlaybackStatus::Playing)
            .unwrap_or(false);

        let (position_ms, duration_ms, timeline_at_ms) = match session.GetTimelineProperties() {
            Ok(tl) => {
                let start = tl.StartTime().map(|t| t.Duration).unwrap_or(0);
                let end = tl.EndTime().map(|t| t.Duration).unwrap_or(0);
                let pos = tl.Position().map(|t| t.Duration).unwrap_or(0);
                let at = tl
                    .LastUpdatedTime()
                    .map(|t| (t.UniversalTime - EPOCH_DIFF_TICKS) / 10_000)
                    .unwrap_or(0);
                (ticks_to_ms(pos - start), ticks_to_ms(end - start), at)
            }
            Err(_) => (0, 0, 0),
        };

        let key = format!("{source_id}\u{1f}{title}\u{1f}{artist}\u{1f}{album}");
        if key != self.art_key {
            self.art_key = key;
            self.art = None;
            self.art_retries = 0;
        }
        if self.art.is_none() {
            match read_thumbnail(&props) {
                Ok(art) => self.art = Some(art),
                Err(e) => {
                    // Players (Spotify especially) often publish the art a moment after the title.
                    log::debug!("thumbnail not ready: {e:#}");
                    if self.art_retries < 3 {
                        self.art_retries += 1;
                        let tx = self.tx.clone();
                        thread::spawn(move || {
                            thread::sleep(Duration::from_millis(700));
                            let _ = tx.send(Cmd::Refresh);
                        });
                    }
                }
            }
        }

        let sessions = self.sessions();
        let session_index = sessions
            .iter()
            .position(|s| same_app(s, &source_id))
            .unwrap_or(0);

        Ok(MediaState {
            title,
            artist,
            album,
            source_app: friendly_app_name(&source_id),
            source_id,
            playing,
            position_ms,
            duration_ms,
            timeline_at_ms,
            art: self.art.clone(),
            session_index,
            session_count: sessions.len(),
        })
    }
}

/// An SMTC event handler that just posts `make()` to the worker.
fn notify<S, A>(tx: &Sender<Cmd>, make: fn() -> Cmd) -> TypedEventHandler<S, A>
where
    S: windows::core::RuntimeType + 'static,
    A: windows::core::RuntimeType + 'static,
{
    let tx = tx.clone();
    TypedEventHandler::new(move |_, _| {
        let _ = tx.send(make());
        Ok(())
    })
}

fn same_app(session: &Session, id: &str) -> bool {
    session
        .SourceAppUserModelId()
        .map(|s| s == id)
        .unwrap_or(false)
}

fn ticks_to_ms(ticks: i64) -> u64 {
    u64::try_from(ticks / 10_000).unwrap_or(0)
}

fn read_thumbnail(props: &MediaProperties) -> anyhow::Result<String> {
    let reference = props.Thumbnail().context("no thumbnail")?;
    let stream = reference.OpenReadAsync()?.join()?;
    let size = u32::try_from(stream.Size()?).unwrap_or(u32::MAX);
    if size == 0 || size > MAX_ART_BYTES {
        anyhow::bail!("thumbnail size {size} out of range");
    }
    let content_type = stream
        .ContentType()
        .map(|c| c.to_string())
        .ok()
        .filter(|c| c.starts_with("image/"))
        .unwrap_or_else(|| "image/png".into());

    let buffer = Buffer::Create(size)?;
    let filled = stream
        .ReadAsync(&buffer, size, InputStreamOptions::None)?
        .join()?;
    let len = filled.Length()? as usize;
    let reader = DataReader::FromBuffer(&filled)?;
    let mut bytes = vec![0u8; len];
    reader.ReadBytes(&mut bytes)?;

    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{content_type};base64,{encoded}"))
}

/// Turns an AppUserModelID like `Spotify.exe` or `MSEdge` into a readable name.
fn friendly_app_name(id: &str) -> String {
    let lower = id.to_ascii_lowercase();
    let known = [
        ("spotify", "Spotify"),
        ("chrome", "Chrome"),
        ("msedge", "Edge"),
        ("firefox", "Firefox"),
        ("308046b0af4a39cb", "Firefox"),
        ("brave", "Brave"),
        ("opera", "Opera"),
        ("vlc", "VLC"),
        ("zunemusic", "Media Player"),
        ("zunevideo", "Films & TV"),
        ("applemusic", "Apple Music"),
        ("tidal", "TIDAL"),
        ("deezer", "Deezer"),
        ("youtube", "YouTube"),
    ];
    if let Some((_, name)) = known.iter().find(|(needle, _)| lower.contains(needle)) {
        return (*name).to_string();
    }
    let base = id.rsplit(['\\', '!']).next().unwrap_or(id);
    base.trim_end_matches(".exe").trim_end_matches(".EXE").to_string()
}
