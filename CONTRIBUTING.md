# Contributing to Overlid

Thanks for helping. Bug reports, ideas and pull requests are all welcome.

## Before you start

- For anything bigger than a small fix, open an issue first so we can agree on the approach.
- Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). It explains how Overlid is built and the rules each module follows.

## Setup

See **Build from source** in the [README](README.md#build-from-source). `npm run tauri dev` gives you hot reload for the front end; Rust changes rebuild automatically.

## Ground rules

- **Rust owns OS integration and state; the front end renders.** New events and commands go in [`src/lib/ipc.ts`](src/lib/ipc.ts) with types.
- **Fail soft.** If a feature can't work on someone's machine (no battery, no microphone, no media player), hide that part and log it. Never panic. No `unwrap()` or `expect()` outside tests.
- **Keep the UI thread free.** WinRT, HTTP and audio work happens on background threads or async tasks.
- **Privacy first.** No telemetry, no new network calls without discussion, no keyboard hooks, never record audio, never write to Claude Code's credentials.
- **Design tokens** live in [`src/styles/tokens.css`](src/styles/tokens.css). Use them instead of hard-coded colours and sizes.
- Use the official [`windows`](https://crates.io/crates/windows) crate for Win32 and WinRT.

## Checks

Run these before opening a pull request; CI runs them too.

```powershell
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets
cargo test --manifest-path src-tauri/Cargo.toml
npm test
npm run build
```

Please test at 100 % and 150 % display scaling if you touch the island window or hit-testing.

## Commits

Use conventional commit messages, for example `feat(media): show podcast chapters` or `fix(window): hit rect at 125 % scaling`.

## Adding an AI provider

Implement `UsageProvider` (in `src-tauri/src/codenotch/mod.rs`) for the new service and register it in `providers()`. `detect()` must only read the CLI's existing sign-in; never write or refresh tokens. Parse responses defensively, and return `NeedsAuth` instead of showing a fake 0 %.
