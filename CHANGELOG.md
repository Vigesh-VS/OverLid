# Changelog

All notable changes to Overlid are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-11-14

The first public release.

### Added

- **Island.** A Dynamic-Island-style notch at the top of the screen:
  - a black pill that blends with the bezel, grows on hover and closes when you leave;
  - left, centre or right placement, adjustable width, height and scale;
  - notifications split the pill into the time on the left and the alert on the right;
  - hides in full-screen games and presentations, with a Game mode in the tray;
  - an optional "show only for these apps" mode.
- **Media.** Now playing from any app that uses Windows media controls (Spotify, browsers, …), with artwork, an accent colour taken from the album art, play/pause, next, previous and seeking. Click the art to switch players.
- **CodeNotch.**
  - Usage rings for Claude Code, Codex and GitHub Copilot, using each CLI's existing sign-in (read-only), with reset countdowns and 80 % / 95 % alerts.
  - Live Claude Code sessions through Claude Code's HTTP hooks: busy, done, and "needs you" alerts with a bell in the pill and an attention dot.
- **Teleprompter.**
  - Scripts scroll out of the notch right under your webcam. Hover pauses; you can resize from the edges and corners.
  - Voice mode scrolls while you speak.
  - Section jumps, mirror mode, colour presets and an optional ambient gradient.
  - Hidden from screen share and recordings while presenting.
  - Import .txt, .md, .docx and .pdf.
  - Global shortcuts.
- **Focus timer.** A Pomodoro timer whose state lives in the app, so it never resets when the UI reloads. Configurable lengths, round dots, today's total and history.
- **Home panel.** The clock, a focus summary and a clipboard history tile (memory only, skips passwords).
- **Stats.** CPU, RAM, battery and disk, plus peeks for the charger, low battery and Caps Lock / Num Lock.
- **Quick action.** A button in the pill that launches an app, opens a website or folder, starts the timer or the teleprompter, or plays/pauses media.
- **Settings.** A window with General, Display, AI tools, Focus, Teleprompter, Scripts, Quick action and About tabs; start with Windows; a welcome screen; a tray menu.

### Security

A full hardening pass. See [SECURITY.md](SECURITY.md) and [docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md).

- **Tokens.** Tokens are only read, kept in a wiped-on-drop wrapper and never logged or sent to the UI. Logs are redacted and rotated (4 × 1 MB). Crash messages are redacted too.
- **Network.** One HTTPS client with a host allowlist, no redirects and no proxy settings from the environment. No telemetry.
- **Hook receiver.**
  - Rewritten to listen only on `127.0.0.1`.
  - Every request needs a per-install token (stored in Windows Credential Manager).
  - Browser requests are refused (`Origin` / `Host` checks).
  - Size, time and rate limits, and a strict event schema that never reads prompts or tool data.
- **Window.** A strict Content Security Policy, per-window command permissions and no HTML injection, with argument checks on every command.
- **File import.** File types are checked by their content. Size and page limits, a zip-bomb check, Word parsing in a time-limited worker, and PDF reading with a timeout.
- **Quick action.** Only `http(s)` links, local `.exe` files and existing folders, re-checked every time the action runs.
- **Claude Code settings.** `~/.claude/settings.json` is edited atomically, never through links, and only Overlid's entries are touched. Uninstalling removes Overlid's hooks.
- **Privacy.** Settings › About lists everything stored locally, and **Clear all Overlid data** removes it.
- **Supply chain.**
  - Releases include `SHA256SUMS.txt`.
  - CI runs `cargo deny`, `cargo audit`, `npm audit` and gitleaks.
  - GitHub Actions are pinned to commit SHAs, and Dependabot is set up.

[Unreleased]: https://github.com/Vigesh-VS/OverLid/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Vigesh-VS/OverLid/releases/tag/v0.2.0
