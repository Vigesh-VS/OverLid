# Overlid: rules for Claude Code

Read `SPEC.md` fully before writing any code. It is the source of truth for features, architecture and build phases.

## Who I am / how I work
- I'm Vigesh. The ideas and design decisions are mine; you write most of the code.
- Build **one phase at a time** (SPEC §12). At the end of each phase:
  1. Run `npm run tauri dev` and make sure it compiles with no errors or warnings you can fix.
  2. Tell me exactly what to test by hand (what to hover/click, what I should see).
  3. Wait for my "ok" before committing and starting the next phase.
- If something in the spec turns out to be impossible or a bad idea on Windows, stop and tell me with a proposed alternative. Don't silently change scope.
- Ask before adding a dependency that isn't listed in SPEC §3.

## UI & design workflow
- **Google Stitch** (stitch.withgoogle.com) is where I design the screens: collapsed pill, each expanded panel, prompter view and settings window. I'll drop the exports (screenshots and/or HTML/CSS) into `design/stitch/` with a name per screen (e.g. `media-panel.png`, `media-panel.html`).
- Before building any UI in a phase, look in `design/stitch/` for that screen and match its layout, spacing, colours and type as closely as possible. Treat Stitch HTML as a **visual reference only**: rebuild it as clean React + CSS modules, don't paste the generated markup.
- If a screen has no Stitch design yet, tell me so I can make one, or ask if I want you to go ahead with your own design.
- **Use the `frontend-design` skill** (Anthropic's Claude Code design skill/plugin) for every UI task: island animations, panels, settings window. If it isn't installed, tell me and give me the install command before starting UI work.
- Keep design tokens (colours, radii, spacing, font sizes, spring settings) in one file, `src/styles/tokens.css`, so the whole look can be re-themed from there.

## Git rules (strict)
- Every commit is authored **only** by me: `Vigesh <154797502+Vigesh-VS@users.noreply.github.com>`.
- **Never** add `Co-Authored-By: Claude`, `Claude-Session:`, "Generated with Claude Code", or any AI attribution to commits, PR descriptions or code comments.
- Before the first commit, set the repo-local identity:
  `git config user.name "Vigesh"` and `git config user.email "154797502+Vigesh-VS@users.noreply.github.com"`
- One commit per phase (or a few small ones), conventional style: `feat(media): …`, `fix(window): …`.
- Don't push unless I ask.

## Tech conventions
- Tauri 2, React 18 + TypeScript (strict) + Vite, Framer Motion, Zustand.
- Rust owns OS integration and state; frontend renders and sends commands. Keep every event and command typed in `src/lib/ipc.ts`.
- No `unwrap()`/`expect()` in non-test Rust; use `anyhow`/`thiserror` and log errors. Modules fail soft (hide the feature, never crash).
- Run WinRT / HTTP / audio work on async tasks or threads, never on the main thread.
- Run `cargo clippy` and `npm run build` (tsc) clean before saying a phase is done.
- Use the official `windows` crate for Win32/WinRT, not unmaintained wrappers.

## Security & privacy
- The Claude token in `~/.claude/.credentials.json` is **read-only**: never write, refresh, log, print or send it anywhere except the usage endpoint.
- Never install a global keyboard hook; poll lock keys with `GetKeyState`.
- Mic audio is processed in memory for loudness only. Never record, store or transmit it.
- Before editing `~/.claude/settings.json` always make a timestamped backup and merge, never overwrite.
- No telemetry.

## Commands
- Dev: `npm run tauri dev`
- Build installer: `npm run tauri build`
- Lint: `cargo clippy --manifest-path src-tauri/Cargo.toml` · `npm run build`

## Prerequisites (check these first, tell me what's missing)
- Rust stable (`rustup`, MSVC toolchain) + Visual Studio Build Tools with "Desktop development with C++"
- Node 20+
- WebView2 runtime (built into Windows 11)
