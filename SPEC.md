# Overlid: Product & Technical Spec

> A Dynamic-Island-style notch for Windows 10/11 with three superpowers in one place:
> **live system info**, **AI coding-agent status (CodeNotch)**, and a **notch teleprompter**.
> Open source (MIT). Built with Tauri 2 (Rust) + React + TypeScript.

---

## 1. What we're merging

| Source (inspiration only, no code copied) | What we take |
|---|---|
| dynamic-island-for-windows (rajsriv, MIT), Nusa | Top-centre pill that expands on hover, media player, system stats, Caps Lock/battery pop-ups, steps aside for full-screen apps, tray menu, start with Windows |
| CodeNotch (vinzdg, MIT), codenotch-windows (MakFly, MIT) | Usage rings per AI provider (5-hour / 7-day windows + reset times), busy/waiting session status, alerts when an agent finishes or needs input, graded thresholds (80 / 95 / 100 %) |
| TopCue (MIT), NotchPrompter, Moody | Script scrolling out of the notch under the webcam, hover-to-pause, speed/size shortcuts, voice-activated scrolling + level beam, 3-2-1 countdown, sections you can jump to, hidden from screen share, mirror mode |

Credit all of these in `README.md` → "Inspired by" and in `THIRD_PARTY_NOTICES.md`.

---

## 2. v1 scope

**In:** island shell · media controls · system stats + overlays · Pomodoro · CodeNotch (Claude Code) · teleprompter · settings window · tray · autostart · installer.

**Out (later):** more AI providers (Codex, Copilot, Gemini; the provider trait must make these easy to add), lyrics, file shelf, clipboard history, phone remote, notifications mirror.

---

## 3. Stack

- **Tauri 2** (Rust backend, WebView2 frontend)
- **Frontend:** React 18 + TypeScript + Vite, **Framer Motion** (island morph animations), **Zustand** (state), plain CSS modules (no Tailwind needed, but fine if preferred)
- **Rust crates:**
  - `windows` (official crate). Features needed: `Media_Control`, `Storage_Streams`, `Foundation`, `Win32_System_Power`, `Win32_UI_Input_KeyboardAndMouse`, `Win32_UI_Shell`, `Win32_UI_WindowsAndMessaging`, `Win32_Foundation`, `Win32_Graphics_Gdi`
  - `sysinfo` (CPU / RAM)
  - `cpal` (microphone level for voice-activated teleprompter; done in Rust to avoid WebView2 mic-permission issues)
  - `reqwest` (rustls) + `serde` / `serde_json` + `chrono` (usage API)
  - `tiny_http` or `axum` (local hook receiver)
  - `tokio`, `base64`, `dirs`, `anyhow`, `log` + `tauri-plugin-log`
- **Tauri plugins:** `store`, `global-shortcut`, `autostart`, `single-instance`, `notification`, `log`, `dialog` (script import/export)

---

## 4. Architecture

```
overlid/
├─ src/                        # React frontend
│  ├─ island/                  # the notch window
│  │  ├─ Island.tsx            # state machine: collapsed / peek / expanded / prompter
│  │  ├─ compact/              # tiny indicators shown in collapsed pill
│  │  └─ panels/               # Home, Media, Code, Prompter, Focus, Stats
│  ├─ settings/                # separate normal window
│  ├─ stores/                  # zustand stores per module
│  └─ lib/ipc.ts               # typed wrappers around invoke/listen
├─ src-tauri/src/
│  ├─ main.rs / lib.rs
│  ├─ window.rs                # positioning, click-through, DPI, content protection
│  ├─ fullscreen.rs            # SHQueryUserNotificationState watcher
│  ├─ media.rs                 # SMTC session manager + events
│  ├─ system.rs                # cpu/ram/battery/lock keys
│  ├─ pomodoro.rs              # timer state lives in Rust (survives UI reloads)
│  ├─ codenotch/
│  │  ├─ mod.rs                # UsageProvider trait + UsageStore (poll, cache last good)
│  │  ├─ claude.rs             # Claude Code provider
│  │  ├─ sessions.rs           # session state machine
│  │  ├─ hook_server.rs        # 127.0.0.1 HTTP receiver for Claude Code hooks
│  │  └─ hook_installer.rs     # safe merge into ~/.claude/settings.json
│  ├─ teleprompter/
│  │  ├─ scripts.rs            # CRUD, JSON files in app data dir
│  │  └─ voice.rs              # cpal RMS -> events
│  └─ settings.rs
```

**Rule:** Rust owns OS integration and state; it emits events (`media://update`, `system://tick`, `code://usage`, `code://session`, `pomo://tick`, `voice://level`, `fullscreen://changed`). The frontend only renders and sends commands. All events and commands are typed in `src/lib/ipc.ts`.

---

## 5. The island window (core of everything)

- One **transparent, frameless, always-on-top, skip-taskbar, no-shadow** window, sized to the *largest* expanded state (about 680×420 logical px, larger in prompter mode), anchored **top-centre of the primary monitor** (configurable monitor later). Never resize the native window for animations; animate the pill inside it with Framer Motion. This avoids flicker.
- **Click-through:** the window is `set_ignore_cursor_events(true)` by default. The frontend reports the pill's current hit-rect (`set_hit_rect` command) whenever it changes. A Rust loop (~60 Hz while hovered, ~15 Hz idle) reads `GetCursorPos`, converts DPI, and turns click-through off only while the cursor is inside the hit-rect. Clicks through to apps underneath must work everywhere else.
- **States:**
  1. **Collapsed** (about 200×34, black pill, radius 17, sits flush with the top edge). It shows at most two compact indicators by priority: active Pomodoro countdown › Claude session busy/waiting dot › playing-media mini art + bars › clock.
  2. **Peek** (auto, 2–4 s): a brief expansion for events such as an agent finished, an agent needing input, the charger plugged in, Caps Lock, a limit reaching 80 %, or Pomodoro done. Then it shrinks back.
  3. **Expanded** (hover for 120 ms): a tab row (Home · Media · Code · Prompter · Focus · Stats) plus the active panel. It collapses 400 ms after the cursor leaves.
  4. **Prompter**: the pill grows downward into a teleprompter (see §10).
- **Look:** pure black (#000) pill so it blends with a real notch or bezel, soft spring animations (stiffness ~400, damping ~30), white text, accent colour from album art when media is playing. Optional "glass" style later.
- **Design source:** screens are designed by Vigesh in **Google Stitch** and exported to `design/stitch/` (images + HTML/CSS for reference). Claude Code matches them using the **`frontend-design` skill** and keeps all tokens in `src/styles/tokens.css` (see CLAUDE.md → UI & design workflow).
- **Full-screen awareness:** poll `SHQueryUserNotificationState` every 2 s. On `QUNS_BUSY`, `QUNS_RUNNING_D3D_FULL_SCREEN` or `QUNS_PRESENTATION_MODE`, hide the island, unless the teleprompter is running. There's a manual "Game mode" toggle in the tray.
- **Screen-share privacy:** `set_content_protected(true)` (uses `SetWindowDisplayAffinity`, Win10 2004+). This is always on while the prompter is active, with a setting "Hide island from screen share/recording: always / prompter only / never".

---

## 6. Media module

- `GlobalSystemMediaTransportControlsSessionManager::RequestAsync()`; follow `CurrentSessionChanged`, `SessionsChanged`, and on the current session `MediaPropertiesChanged`, `PlaybackInfoChanged`, `TimelinePropertiesChanged`.
- Emit: title, artist, album, source app id (Spotify / Chrome / etc.), playing/paused, position, duration, and thumbnail as base64 (read via `Thumbnail().OpenReadAsync()`, cache by track).
- Commands: play/pause, next, previous, seek. Clicking the mini art cycles between sessions when several players are open.
- Frontend: extract dominant colour from the album art (canvas average or `fast-average-color`) and use it as the panel's accent glow. Show a progress bar that interpolates locally between timeline events.
- Event-driven, not polled.

## 7. System module

- CPU % and RAM used/total via `sysinfo`: every 2 s while the Stats panel is open, every 10 s otherwise.
- Battery: `GetSystemPowerStatus` every 5 s → percent, charging, on AC. Peek on plug/unplug and at a low battery threshold (20 %).
- Caps Lock / Num Lock: poll `GetKeyState(VK_CAPITAL / VK_NUMLOCK)` every 150 ms and peek on change. Do **not** install a global keyboard hook (privacy; never record keys).
- Stats panel: CPU, RAM and battery rings + uptime. Optional: disk free.

## 8. Pomodoro module

- Timer state in Rust: focus 25 / short 5 / long 15, long break every 4 rounds (all configurable).
- Collapsed pill shows a progress ring + `mm:ss` while running. Focus panel: start/pause/skip/reset, round dots, today's total focus time.
- On phase end: peek + Windows notification + soft chime (`src/assets/sounds/`).
- History in the store: date, completed sessions, minutes.

---

## 9. CodeNotch module (Claude Code first)

### 9.1 Usage rings
- **Provider trait** in Rust:
  ```rust
  trait UsageProvider {
      fn id(&self) -> &'static str;          // "claude"
      fn display_name(&self) -> &'static str;
      async fn fetch(&self) -> Result<UsageSnapshot, ProviderError>;
      fn min_interval(&self) -> Duration;
  }
  struct UsageSnapshot { windows: Vec<UsageWindow>, fetched_at: DateTime<Utc>, fidelity: Fidelity }
  struct UsageWindow { label: String, used_percent: f64, resets_at: Option<DateTime<Utc>> }
  enum ProviderError { NeedsAuth, RateLimited { retry_after: Option<Duration> }, Network, Parse }
  ```
- **Claude provider:**
  - Read the token from `%USERPROFILE%\.claude\.credentials.json` → `claudeAiOauth.accessToken` (also check `expiresAt`). **Read-only: never write, refresh or log the token.** If the file is missing or expired, return `NeedsAuth` ("Run `claude` once to sign in").
  - `GET https://api.anthropic.com/api/oauth/usage` with headers `Authorization: Bearer <token>`, `anthropic-beta: oauth-2025-04-20`, `Accept: application/json`.
  - Response fields: `five_hour`, `seven_day`, `seven_day_opus`, `seven_day_sonnet` (each `{ utilization: 0–100, resets_at: ISO-8601 | null }`, any may be null), and optionally `extra_usage`. Parse defensively: unknown or null fields must not crash.
  - This is an **unofficial internal endpoint**. Label the data "derived" in the UI tooltip, and on failure show stale/needs-auth/error states, **never a fake 0 %**.
- **UsageStore:** polls every 120 s (60 s while a session is busy, never under 60 s), exponential back-off on 429 respecting `Retry-After`, and keeps the last good snapshot with an age label.
- **UI:** a compact ring in the collapsed pill when any window ≥ 80 % (otherwise hidden to save space). The Code panel shows one ring per window, reset countdown ("resets in 2h 14m"), and the time of the last update.
- **Thresholds:** 80 % warning (amber), 95 % critical (red), 100 % limit reached. Peek + Windows notification once per window per threshold crossing, plus a "quota available again" notice after a reset.

### 9.2 Live session status (via Claude Code hooks)
- `hook_server.rs` listens on `127.0.0.1:47823` (configurable; if busy, try the next port and update installed hooks). Endpoint `POST /hook` accepts Claude Code's hook JSON and always replies `200 {}` fast (<50 ms).
- Claude Code supports **`"type": "http"` hooks** that POST the hook JSON (`session_id`, `cwd`, `hook_event_name`, `transcript_path`, plus event fields such as `message` on `Notification`). No scripts or curl are needed.
- **Session state machine** (keyed by `session_id`, label = last folder of `cwd`):
  - `SessionStart` → idle
  - `UserPromptSubmit`, `PreToolUse`, `PostToolUse` → **busy** (spinning arc)
  - `Notification`, `PermissionRequest` → **waiting for you** (pulsing amber); store the message
  - `Stop` → **done** (green tick for 10 s, then idle); peek + sound
  - `SessionEnd` → remove; remove idle sessions after 30 min of silence
- **Hook installer** (Settings → CodeNotch → "Connect Claude Code"):
  1. Back up `~/.claude/settings.json` to `settings.json.overlid-backup-<timestamp>`.
  2. Merge (never overwrite) an Overlid entry into each event above:
     ```json
     { "hooks": [ { "type": "http", "url": "http://127.0.0.1:47823/hook", "timeout": 2 } ] }
     ```
  3. Tag entries so they're idempotent (re-install doesn't duplicate) and removable ("Disconnect" removes only ours).
  4. Keep the user's existing hooks and all other keys untouched; preserve formatting as far as is practical.
  5. When Overlid isn't running the hook just fails non-blocking. Verify this in testing and note it in the README.
- Clicking a session in the Code panel opens its folder in Explorer (v1). Bringing the terminal or VS Code window forward can come later.

---

## 10. Teleprompter module

### 10.1 Scripts
- Stored as JSON files in the app data dir: `{ id, title, body (markdown-ish), favorite, updated_at }`.
- Settings window → **Scripts** tab: list (search, favourite, new, duplicate, delete, import/export `.txt`/`.md`) + a clean editor with autosave.
- Lines starting with `## ` are **sections** (cue points) and can be jumped to while presenting.

### 10.2 Presenting
- From the Prompter panel pick a script → **3-2-1 countdown** in the notch → the pill grows downward into a prompter area (default about 560×200 logical px directly under the camera; width/height adjustable) with a soft fade mask at top and bottom so text appears to scroll *out of the notch*.
- Smooth scrolling with `requestAnimationFrame` and translateY (GPU), speed in px/s.
- **Hover pauses**, leaving resumes; click the pause icon for a hard pause.
- Mouse wheel scrolls manually while paused.
- **Global shortcuts** (configurable; avoid plain Space globally):
  - `Ctrl+Alt+Space` play/pause · `Ctrl+Alt+↑/↓` speed · `Ctrl+Alt+=/-` text size · `Ctrl+Alt+←/→` previous/next section · `Ctrl+Alt+P` start/stop prompter · `Esc` (when focused) stop
- Settings: font family, size, line height, text colour presets (white, matrix green, cyan, amber + custom), default speed, mirror mode (flip horizontally for physical teleprompter glass), floating mode (detach anywhere and resize, a separate window later if needed).
- **Voice-activated scrolling:** `voice.rs` opens the default mic with `cpal`, computes RMS every ~30 ms and emits `voice://level`. Frontend: scroll when level > sensitivity threshold, keep scrolling for a hangover of ~600 ms after speech stops, then ease to a stop. Show a **voice level beam** (thin glowing line under the notch that reacts to level). A sensitivity slider and mic device picker go in settings. Audio is never stored or sent anywhere; say so in the UI.
- **Hidden from screen share** while presenting (content protection, §5). Show a small "🔒 hidden from capture" hint the first time.
- While presenting, full-screen auto-hide is suspended and the other peeks are queued (except "agent needs input", shown as a tiny dot only).

---

## 11. Settings window, tray, startup

- **Settings window** (normal decorated window, opened from the tray or the ⚙ in the expanded island). Tabs: General (monitor, island style, hide from capture, peek on/off per type, start with Windows), Scripts, Teleprompter, CodeNotch (connect/disconnect hooks, poll interval, thresholds, port), Focus, About (version, GitHub link, credits).
- **Tray icon:** Settings · Game mode · Pause island · Start with Windows ✓ · Quit.
- `tauri-plugin-single-instance` (second launch focuses settings) · `tauri-plugin-autostart` · `tauri-plugin-store` for settings.
- **Privacy:** no telemetry. The only network call is the Claude usage endpoint (and the GitHub releases check later).

---

## 12. Build phases (do them in order; each ends with a working app + commit)

| # | Phase | Done when |
|---|---|---|
| 0 | **Scaffold + island shell**: Tauri 2 + React + TS project, transparent top-centre window, click-through with hit-rect, collapsed ↔ expanded animation, clock in pill, tray with Quit | Pill sits at top centre, clicks pass through everywhere else, hover expands smoothly, works at 100 % and 150 % display scaling |
| 1 | **Media** | Spotify and YouTube-in-browser show art/title, controls work, accent colour follows art |
| 2 | **System + overlays + full-screen hide** | Caps Lock and charger peeks work; island hides in a full-screen YouTube video / game |
| 3 | **Pomodoro** | Timer runs from the pill, survives closing the panel, notifies at end |
| 4 | **CodeNotch usage** | Real 5h/7d % and reset times match Claude Code's `/usage`; needs-auth state when signed out |
| 5 | **CodeNotch sessions + hook installer + alerts** | Running `claude` in a terminal shows busy → waiting → done in the island; installer is idempotent and reversible; existing hooks untouched |
| 6 | **Teleprompter** (scripts, editor, countdown, scroll, shortcuts, sections, hover pause, content protection, voice mode) | Script is invisible in an OBS/Teams/Meet screen share, voice mode scrolls only while talking |
| 7 | **Settings window, autostart, polish** | All settings persist across restarts; app starts with Windows |
| 8 | **Open-source release**: README with GIFs, LICENSE (MIT, © 2026 Vigesh), THIRD_PARTY_NOTICES, CONTRIBUTING, issue templates, GitHub Actions workflow building the NSIS installer on tag push | `npm run tauri build` produces an installer; a fresh clone builds following the README |

---

## 13. Quality bar

- Idle: < 1 % CPU and < 80 MB RAM. No busy loops: use events where possible and slow polling when collapsed.
- Never block the UI thread; all WinRT/HTTP work happens in async tasks.
- Every module fails soft: if media/battery/mic/usage is unavailable, hide that bit and log it. The app must never crash.
- Multi-DPI correct (test 100 %, 125 %, 150 %).
- TypeScript strict, `cargo clippy` clean, no `unwrap()` in non-test Rust code.
