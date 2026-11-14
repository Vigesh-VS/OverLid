# Architecture

How Overlid is built, for people who want to change it. For setup and build commands see the [README](../README.md#build-from-source); for the security model see [SECURITY.md](../SECURITY.md).

## The big picture

Overlid is a [Tauri 2](https://tauri.app) app: a Rust backend plus a React 18 + TypeScript frontend rendered by WebView2.

**Rust owns the OS and the state; the frontend only renders and sends commands.** Every OS integration (media sessions, battery, microphone, hooks, files, network) lives in Rust. The frontend asks for things with Tauri commands and listens to events. Every command and event is typed in one place, [`src/lib/ipc.ts`](../src/lib/ipc.ts), which mirrors the Rust side.

```
            ┌──────────────────────── Rust (src-tauri/src) ────────────────────────┐
 Windows ──▶│ media · system · fullscreen · foreground · clipboard · voice · ambient │
 APIs       │ pomodoro (timer state) · settings · scripts · codenotch (usage, hooks)│
            └───────────┬──────────────────────────────────────────▲────────────────┘
                 events │  media://update, pomo://tick, code://session …│ commands
                        ▼                                          │ (invoke)
            ┌──────────────── React (src) ────────────────────────────┴───┐
            │ stores/ (Zustand, one per module) ──▶ island/ · settings/   │
            └──────────────────────────────────────────────────────────────┘
```

## Windows (webviews)

There are three webviews, all served from the same bundle. `src/main.tsx` picks the UI from the `?window=` query:

| Label | What it is | Capability file |
|---|---|---|
| `island` | The notch itself: a transparent, frameless, always-on-top window | `src-tauri/capabilities/island.json` |
| `settings` | A normal window with the Settings tabs | `src-tauri/capabilities/settings.json` |
| `dot` | A tiny "needs you" dot shown while the island is hidden | `src-tauri/capabilities/dot.json` |

Each capability file lists exactly the commands that window uses. `src-tauri/build.rs` declares every app command so Tauri generates an `allow-<command>` permission for each one. **When you add a command:** register it in `lib.rs`, add it to `build.rs`, grant it in the right capability file(s), and add a typed wrapper in `ipc.ts`.

### The island window

- One transparent window sized for the biggest state. Animations happen *inside* it (Framer Motion), so the native window never resizes mid-animation. That avoids flicker. `island_set_extent` grows it for the teleprompter.
- **Click-through.** The window ignores the mouse by default. The frontend reports the pill's current hit-rect (`set_hit_rect`), and a Rust loop in `window.rs` reads the cursor position and turns click-through off only while the cursor is over the pill.
- **States.** The island is collapsed (the pill), peeking (a short pop-out for an event), expanded (hover: tabs and panels) or presenting (the teleprompter). They're driven by `src/island/Island.tsx` and `stores/island.ts`.
- **Pill layout.** [`src/island/compact/pillLayout.ts`](../src/island/compact/pillLayout.ts) is a pure function that turns what's going on (clock, media, timer, lock keys, notifications) into widths and slots. It's tested in `tests/pillLayout.test.ts`.
- **Full screen.** `fullscreen.rs` polls `SHQueryUserNotificationState` and hides the island in games and presentations, unless the teleprompter is running.
- **Screen-share privacy.** Content protection (`SetWindowDisplayAffinity`) hides the island from capture, always or only while presenting.

## Rust modules (`src-tauri/src`)

| Module | Job |
|---|---|
| `lib.rs` | App setup: plugins, logging (redacted, rotated), the panic hook, module start-up, the command list |
| `window.rs` | Island placement, DPI, click-through loop, extent, attention dot |
| `media.rs` | Windows media sessions (SMTC): now playing, artwork, play/pause/seek; event-driven |
| `system.rs` | CPU, RAM, battery; Caps Lock / Num Lock via `GetKeyState` polling (no keyboard hook) |
| `fullscreen.rs`, `foreground.rs` | Full-screen detection and "only show for these apps" |
| `pomodoro.rs` | The focus timer as a pure `Timer` state machine (tested), plus history |
| `clipboard.rs` | In-memory clipboard history (skips content marked private) |
| `peek.rs` | Pop-out notifications in the notch, plus Windows toasts |
| `quick_action.rs` | The pill's quick-action button: launch app, open URL/folder, timer, prompter, media |
| `settings.rs` | The settings schema (versioned, sanitised on load), stored with `tauri-plugin-store` |
| `teleprompter/` | `scripts.rs` (JSON files in app data), `voice.rs` (mic loudness via `cpal`), global shortcuts |
| `ambient.rs` | Average screen colour for the prompter's ambient glow |
| `codenotch/` | AI usage providers and live Claude Code sessions (below) |
| `tray.rs`, `app_windows.rs` | Tray menu, Settings window, autostart, fixed GitHub links |
| `privacy.rs` | "Clear all Overlid data" |
| `net.rs`, `secret.rs`, `redact.rs` | Security plumbing: allowlisted HTTPS client, wiped-on-drop secrets, log redaction |

Rules for Rust code: no `unwrap()`/`expect()` outside tests (use `anyhow`/`thiserror` and log); modules fail soft (hide the feature, never crash); WinRT, HTTP and audio work runs off the main thread; use the official `windows` crate.

## CodeNotch

### Usage

`codenotch/mod.rs` defines a `UsageProvider` trait (`id`, `display_name`, `detect`, `fetch`, `min_interval`). There are three providers:

| Provider | Sign-in it reads (read-only) | Endpoint |
|---|---|---|
| `claude.rs` | `~/.claude/.credentials.json` | `api.anthropic.com/api/oauth/usage` |
| `codex.rs` | `~/.codex/auth.json` | `chatgpt.com/backend-api/wham/usage` |
| `copilot.rs` | `gh auth token` | `api.github.com/copilot_internal/user` |

These are unofficial endpoints, so results are labelled *derived*. On failure the UI shows a stale, needs-sign-in or error state, never a made-up number. A poller keeps the last good snapshot, backs off on 429 and never polls faster than once a minute. Tokens go through `net::get` (HTTPS, allowlisted host, no redirects) and live in a `Secret`.

### Live sessions (Claude Code hooks)

```
Claude Code ──POST /hook──▶ hook_server.rs ──▶ sessions::parse_hook ──▶ sessions state ──▶ code://session
   (http hook + X-Overlid-Token)  (127.0.0.1, token, Origin/Host checks,   (strict schema)
                                   64 KB, 2 s, rate limit)
```

- `hook_installer.rs` merges tagged `"type": "http"` hooks into `~/.claude/settings.json`. It backs up first, writes atomically, refuses links and only touches its own entries. Installed hooks carry the per-install token from `hook_token.rs` (Credential Manager).
- `sessions.rs` is the state machine: `SessionStart` → idle; prompts and tool use → busy; `Notification` / `PermissionRequest` → waiting ("needs you"); `Stop` → done; `SessionEnd` → removed. Idle sessions expire after 30 min.

## Frontend (`src`)

| Folder | Contents |
|---|---|
| `island/` | `Island.tsx` (state machine), `compact/` (the pill), `panels/` (Home, Media, Code, Prompter, Focus, Stats), `prompter/` (presenting view) |
| `settings/` | The Settings window and its tabs |
| `stores/` | One Zustand store per module. `bridge.ts` subscribes to Rust events once and feeds the stores |
| `lib/` | `ipc.ts` (typed commands/events), file import (`importGuard.ts`, `importScript.ts`, `docxWorker.ts`), helpers |
| `components/` | Shared UI (logo, icons, rings, import preview…) |
| `styles/tokens.css` | Every design token (colours, radii, spacing, type, springs). Re-theme from here |

Rendering rules: text is always rendered as text. There's no `innerHTML`, `dangerouslySetInnerHTML` or `eval`; `scripts/check-unsafe-dom.mjs` fails the build if one appears. The CSP in `tauri.conf.json` allows no remote content.

## Events

All event names are typed in `ipc.ts`:

`media://update` · `system://tick` · `system://keys` · `pomo://tick` · `code://usage` · `code://session` · `voice://level` · `voice://status` · `fullscreen://changed` · `island://state` · `island://hover` · `island://peek` · `clipboard://changed` · `settings://changed` · `prompter://start` · `prompter://command` · `prompter://scripts` · `ambient://color`

## Data on disk

Everything lives in `%APPDATA%\com.vigesh.overlid\`:

- `settings.json`
- `pomodoro.json` (focus history)
- `scripts\*.json`
- `logs\`

The hook token is in Windows Credential Manager (`Overlid/hook-token`). Settings › About › **Clear all Overlid data** removes all of it.

## Tests and checks

| Command | What it runs |
|---|---|
| `cargo test --manifest-path src-tauri/Cargo.toml` | Rust unit tests: timer, providers' parsers, hook server over real sockets, schema, redaction, URL/path checks, settings.json editing |
| `npm test` | Node tests for pure TS: pill layout, import guard |
| `npm run build` | Unsafe-DOM check + `tsc` + Vite build |
| `cargo clippy … -- -D warnings` | Lints |

CI (`.github/workflows/ci.yml`) also runs `cargo deny`, `cargo audit`, `npm audit` and gitleaks.
