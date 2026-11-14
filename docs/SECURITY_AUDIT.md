# Overlid security audit

Audit of v0.2.0 against `SECURITY_HARDENING.md`. **Before** is the state found at the start of the hardening round; **After** is the state once that item's fix is committed.

✅ done · ⚠️ partly · ❌ missing · — not applicable

| # | Item | Before | After | Where |
|---|---|---|---|---|
| 1.1 | Tokens read-only, only at request time, dropped after; secret wrapper that zeroizes | ⚠️ read per request, plain `String` | ✅ | `src-tauri/src/secret.rs`, `codenotch/{claude,codex,copilot}.rs` |
| 1.2 | Tokens never leave Rust (no IPC carries tokens/headers/raw responses) + test | ⚠️ true, no test | ✅ | `src-tauri/src/redact.rs` tests |
| 1.3 | Central log redaction (Bearer, sk-, ghp_/gho_, ya29., JWT…); errors say "auth failed (401)" | ❌ | ✅ | `redact.rs`, `lib.rs` log format |
| 1.4 | Tokens only to allowlisted HTTPS host; no redirects; rustls; 5–10 s timeouts | ⚠️ rustls, 15 s, default redirects | ✅ | `src-tauri/src/net.rs` |
| 1.5 | Self-stored secrets in Windows Credential Manager | — none stored before | ✅ hook token | `src-tauri/src/credstore.rs` |
| 1.6 | Settings file has no secrets + test | ⚠️ true, no test | ✅ | `settings.rs` tests |
| 2.1 | Hook server bound to 127.0.0.1 only | ✅ | ✅ | `codenotch/hook_server.rs` |
| 2.2 | Per-install hook token (32 random bytes, Credential Manager, header, constant-time compare, 401) | ❌ | ✅ | `hook_server.rs`, `hook_installer.rs` |
| 2.3 | Reject `Origin`; strict `Host` (DNS rebinding) | ❌ | ✅ | `hook_server.rs` |
| 2.4 | Only `POST /hook` + `application/json`; 404/405 otherwise | ⚠️ path only | ✅ | `hook_server.rs` |
| 2.5 | Body ≤ 64 KB, 2 s read timeout, rate limit, ≤ 50 sessions | ⚠️ 1 MB body only | ✅ | `hook_server.rs`, `sessions.rs` |
| 2.6 | Strict schema (known events, id ≤ 128, cwd ≤ 1024) | ⚠️ lenient | ✅ | `hook_server.rs` |
| 2.7 | Store minimum; message ≤ 300 chars, control chars stripped; never `tool_input` | ⚠️ never tool_input; message unbounded | ✅ | `sessions.rs` |
| 2.8 | Never execute from hooks; open folder via ShellExecute "explore" on existing dir | ⚠️ `explorer` process with path | ✅ | `sessions.rs` |
| 3.1 | Strict CSP | ❌ `csp: null` | ✅ | `tauri.conf.json` |
| 3.2 | No remote content; links http/https only | ✅ fixed GitHub links | ✅ | `app_windows.rs` |
| 3.3 | Per-window minimal capabilities; no fs/shell/http; no global Tauri | ⚠️ one shared capability | ✅ | `src-tauri/capabilities/` |
| 3.4 | DevTools off in release; context menu off | ✅ | ✅ | Tauri default, `main.tsx` |
| 3.5 | Validate every command's arguments in Rust | ⚠️ settings sanitised; others partly | ✅ | `teleprompter/scripts.rs`, `quick_action.rs`, … |
| 3.6 | No `dangerouslySetInnerHTML`/`innerHTML`/`eval`; enforced by a check | ⚠️ one use for bundled SVG logo | ✅ | `src/components/Logo.tsx`, `scripts/check-unsafe-dom.mjs` |
| 4.1 | Extension **and** magic-byte check | ❌ extension only | ✅ | `src/lib/importGuard.ts` |
| 4.2 | ≤ 20 MB file, ≤ 2 MB text, ≤ 500 PDF pages, zip-bomb caps | ⚠️ 40 MB file only | ✅ | `importGuard.ts`, `importScript.ts` |
| 4.3 | Parse off the UI thread with a 10 s timeout | ⚠️ PDF in pdf.js worker; DOCX on UI thread | ✅ | `src/lib/import.worker.ts` |
| 4.4 | PDF: no eval, no remote fonts/CMaps, text only | ✅ `isEvalSupported:false` | ✅ + `disableFontFace` | `importScript.ts` |
| 4.5 | DOCX text only (no images/objects/links) | ⚠️ images embedded then dropped | ✅ images never decoded | `import.worker.ts` |
| 4.6 | Only extracted text stored | ✅ | ✅ | |
| 5.1 | Launch: existing `.exe`, ShellExecute, no args, full path shown | ⚠️ any existing file | ✅ | `quick_action.rs` |
| 5.2 | URL: http/https only | ⚠️ also `mailto:` and any path | ✅ | `quick_action.rs` |
| 5.3 | Folder: existing directory only | ❌ any existing path (incl. files) | ✅ | `quick_action.rs` |
| 5.4 | Config schema versioned; invalid → safe defaults; re-validated before running | ⚠️ not versioned | ✅ | `settings.rs` |
| 6.1 | Only `%USERPROFILE%\.claude\settings.json`; refuse symlinks/junctions | ⚠️ honours `CLAUDE_CONFIG_DIR`; no link check | ✅ | `hook_installer.rs` |
| 6.2 | Backup; atomic write with flush; re-parse before replace | ⚠️ no flush/re-parse | ✅ | `hook_installer.rs` |
| 6.3 | Only Overlid-tagged entries touched | ✅ | ✅ | `hook_installer.rs` |
| 6.4 | Uninstaller removes Overlid's hooks | ❌ | ✅ | NSIS hook + `--remove-hooks` |
| 7.1 | Mic only while voice mode; visible indicator; closed on stop | ✅ | ✅ | `voice.rs`, prompter footer |
| 7.2 | Screen sampling only while presenting; frame discarded | ✅ | ✅ | `ambient.rs` |
| 7.3 | Document what's stored locally | ⚠️ partial | ✅ | About › Privacy |
| 7.4 | "Clear all Overlid data" | ❌ | ✅ | Settings › General |
| 8.1 | Central client, outbound allowlist, HTTPS only, no untrusted proxies, no telemetry | ⚠️ central client, no allowlist, env proxies honoured | ✅ | `net.rs` |
| 9.1 | Signed updates | — no updater | — | |
| 9.2 | SHA-256 checksums per release + how to verify; SmartScreen note | ❌ | ✅ | `release.yml`, README |
| 10.1 | Lockfiles committed | ✅ | ✅ | |
| 10.2 | `cargo audit`, `cargo deny`, `npm audit` in CI | ❌ | ✅ | `ci.yml`, `deny.toml` |
| 10.3 | Actions pinned to SHAs; least-privilege permissions; no `pull_request_target` | ⚠️ tags, release job writes | ✅ | `.github/workflows/` |
| 10.4 | Dependabot | ❌ | ✅ | `.github/dependabot.yml` |
| 10.5 | gitleaks in CI; `.gitignore` for secrets | ❌ | ✅ | `ci.yml`, `.gitignore` |
| 11.1 | Logs local, rotated, ≤ ~5 MB; info by default, debug opt-in | ⚠️ local, default rotation | ✅ | `lib.rs`, Settings › General |
| 11.2 | Never log secrets / hook payloads / scripts / audio / screen | ✅ | ✅ + redaction | |
| 11.3 | Panic handler logs a redacted message only | ❌ default handler | ✅ | `lib.rs` |
| 12 | SECURITY.md (no email) | ❌ | ✅ | `SECURITY.md` |
| 13 | Security tests in CI | ❌ | ✅ | Rust + `tests/` |
