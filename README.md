# Overlid

A Dynamic-Island-style notch for Windows 10 and 11. It sits at the top centre of your screen, stays out of the way, and opens on hover.

- **Media**: what's playing in Spotify, a browser or any app that uses Windows media controls. Album art, play/pause, skip, seek, and an accent colour taken from the cover.
- **System**: CPU, memory, battery, uptime and free disk. Pops out briefly for Caps Lock, Num Lock, the charger and low battery. Hides itself during full-screen video, games and presentations.
- **Focus**: a Pomodoro timer that keeps running when you close the panel, with a countdown in the notch and a daily history.
- **CodeNotch**: your Claude Code 5-hour and 7-day usage, plus live status for every `claude` session: busy, waiting for you, done.
- **Teleprompter**: your script scrolls out of the notch, right under your webcam. Hover to pause, jump between sections, control it with global shortcuts, or let it follow your voice. It's hidden from screen share and recordings while you present.

<!-- Add GIFs here: docs/media/island.gif, docs/media/prompter.gif, docs/media/codenotch.gif -->

## Install

Download the latest `Overlid_x.y.z_x64-setup.exe` from [Releases](https://github.com/Vigesh-VS/OverLid/releases) and run it. It installs for your user only, no admin needed. Overlid starts in the tray; right-click the tray icon for Settings, Game mode, Pause island, Start with Windows and Quit.

Requires Windows 10 version 2004 or later (for screen-capture protection) and the WebView2 runtime, which Windows 11 already has.

## Using it

| Do this | To |
|---|---|
| Hover the notch | Open it. It closes 400 ms after you move away. |
| Click a tab | Switch between Home, Media, Code, Prompter, Focus and Stats. |
| Click the album art | Switch players when more than one is playing. |
| Hover a peek | Open the panel it's about. |
| ⚙ in the open island | Open Settings. |

### Teleprompter shortcuts

All of these can be changed in Settings › Teleprompter. Only the first is active when you're not presenting.

| Shortcut | Action |
|---|---|
| `Ctrl+Alt+P` | Start or stop the prompter |
| `Ctrl+Alt+Space` | Play / pause |
| `Ctrl+Alt+↑` / `↓` | Faster / slower |
| `Ctrl+Alt+=` / `-` | Bigger / smaller text |
| `Ctrl+Alt+←` / `→` | Previous / next section |
| `Esc` | Stop (when the island has focus) |

Lines that start with `## ` are sections you can jump to.

### Connecting Claude Code

Open Settings › CodeNotch and click **Connect Claude Code**. Overlid then:

1. backs up `~/.claude/settings.json` to `settings.json.overlid-backup-<timestamp>`,
2. adds one `"type": "http"` hook per event, pointing at `http://127.0.0.1:47823/hook`,
3. leaves your own hooks and every other setting untouched.

**Disconnect** removes only Overlid's entries. When Overlid isn't running, the hooks fail quietly and Claude Code carries on as normal. Usage needs no setup: if you've signed in to Claude Code on this PC, the rings appear on their own.

## Privacy

- No telemetry, no accounts.
- The only network request is to Anthropic's usage endpoint, using the sign-in Claude Code already saved in `~/.claude/.credentials.json`. Overlid only reads that file. It never writes, refreshes, logs or sends the token anywhere else. The endpoint is unofficial, so the UI marks the numbers as *derived*.
- The hook receiver listens on `127.0.0.1` only.
- Voice mode measures microphone loudness in memory. Audio is never recorded, stored or sent.
- Caps Lock and Num Lock are read with `GetKeyState`. There is no keyboard hook.

## Build from source

Prerequisites:

- [Rust](https://rustup.rs) stable with the MSVC toolchain
- Visual Studio Build Tools with **Desktop development with C++**
- Node.js 20 or later

```powershell
git clone https://github.com/Vigesh-VS/OverLid.git
cd OverLid
npm install
npm run tauri dev      # run with hot reload
npm run tauri build    # installer in src-tauri/target/release/bundle/nsis/
```

Checks before sending a PR:

```powershell
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets
cargo test --manifest-path src-tauri/Cargo.toml
npm run build
```

## How it's built

Tauri 2 (Rust) with a React 18 + TypeScript front end, Framer Motion for the island animations and Zustand for state.

Rust owns everything that touches Windows (SMTC media sessions, power status, lock keys, full-screen detection, the hook server, the microphone) and the state that must outlive the UI, like the Pomodoro timer. It emits typed events, and the front end renders them and sends commands back. Every event and command is typed in [`src/lib/ipc.ts`](src/lib/ipc.ts).

The island is a single transparent, always-on-top window that never resizes. The notch animates inside it, and a hit-rect loop in Rust turns click-through off only while the cursor is over the notch, so clicks pass straight through to apps everywhere else. All design tokens live in [`src/styles/tokens.css`](src/styles/tokens.css).

Adding another AI provider (Codex, Copilot, Gemini) means implementing the `UsageProvider` trait in [`src-tauri/src/codenotch/mod.rs`](src-tauri/src/codenotch/mod.rs).

## Inspired by

Overlid takes ideas, not code, from these MIT-licensed projects. Thank you to their authors.

- dynamic-island-for-windows by rajsriv, and Nusa
- CodeNotch by vinzdg, and codenotch-windows by MakFly
- TopCue, NotchPrompter and Moody

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

[MIT](LICENSE) © 2026 Vigesh
