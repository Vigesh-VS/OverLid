# Security policy

## Supported versions

Overlid is a small open-source project. Only the latest release gets security fixes.

| Version | Supported |
|---|---|
| Latest release | ✅ |
| Older releases | ❌ Please update |

## Reporting a vulnerability

Please **don't** open a public issue for a security problem.

Report it privately on GitHub: open the repository's **Security** tab and click **Report a vulnerability**. Only the maintainer sees the report. There is no email address for reports.

Useful things to include:

- what an attacker can do, and what they need first (a website you visit, a file you import, a program already on your PC…),
- steps to reproduce, and the Overlid and Windows versions,
- anything you've found about a fix.

This is a best-effort project run by one person. You'll get an answer as soon as I can manage, usually within a week. Fixes for confirmed issues go out in the next release, and you'll be credited in the release notes unless you'd rather not be.

## Scope

**In scope.** Overlid defends against:

- **Malicious websites.** Browsers can send requests to `localhost`, so the local hook receiver must not trust them.
- **Malicious or broken files** imported into the teleprompter (.txt, .md, .docx, .pdf).
- **Other local programs** sending requests to the hook receiver or editing Overlid's config.
- **Credential leaks** through logs, the UI, crash output, the repository or the network.
- **Supply-chain attacks** on dependencies and the build and release pipeline.

**Out of scope.** Malware that's already running as your Windows user with full access to your files. No desktop app can fully protect itself from that: it can read the same sign-in files, settings and memory that Overlid can. Also out of scope: problems in Windows, WebView2, or the AI tools' own CLIs and services.

## How Overlid protects you

**Credentials**
- Overlid only reads the sign-ins that Claude Code, Codex and the GitHub CLI already saved. It never writes, refreshes or copies them, and reads them only at the moment of a request.
- In memory, tokens are wrapped so they can't be printed, and their bytes are wiped when dropped.
- Every log line and crash message is passed through a redaction filter that masks anything that looks like a token.
- Network requests go through one client with an allowlist (`api.anthropic.com`, `chatgpt.com`, `api.github.com`): HTTPS only, no redirects, no proxy settings from the environment, short timeouts. Each tool's token goes only to its own host. There is no telemetry.

**Local hook receiver** (`127.0.0.1:47823`)
- Bound to `127.0.0.1` only.
- Every request must carry a random per-install token (32 bytes from the system RNG, kept in Windows Credential Manager), compared in constant time.
- Requests with an `Origin` header, or a `Host` other than `127.0.0.1:<port>` / `localhost:<port>`, are refused. This blocks cross-site requests and DNS rebinding.
- Only `POST /hook` with `application/json` is accepted. Bodies are capped at 64 KB, reads time out after 2 s, and there's a rate limit and a cap of 50 tracked sessions.
- Events are parsed into a strict schema. Only the event name, session id, working folder and a short cleaned message are kept. Tool inputs, tool output, prompts and transcripts are never read.
- Nothing from a hook is ever run. Clicking a session opens its folder in Explorer, and only if it's an existing local folder.

**App window**
- Strict Content Security Policy: no remote scripts, no `eval`, no plugins, no frames.
- Each window (island, Settings, attention dot) may call only the commands it uses.
- No `innerHTML` or `dangerouslySetInnerHTML`. A build check fails on them. Every command re-checks its arguments in Rust.

**Imported files**
- The file's first bytes decide its type, so a renamed program is refused.
- Size caps: 20 MB per file, 2 MB of text, 500 PDF pages.
- A .docx's ZIP directory is checked for zip bombs before anything is unpacked. Word files are parsed in a Web Worker that's stopped after 10 s, and images are never decoded.
- PDF text is extracted with fonts and scripting off.

**Quick actions and config**
- "Launch app" runs only an existing local `.exe`, with no arguments.
- "Open URL" accepts only `http://` and `https://`; "Open folder" only an existing folder. The target is checked again every time the action runs.
- Settings are versioned and sanitised on load.

**Claude Code settings**
- Overlid edits only `%USERPROFILE%\.claude\settings.json` and refuses to follow symlinks or junctions.
- It makes a timestamped backup, writes to a temp file, flushes it, re-reads and checks it, and only then replaces the original. Only Overlid's own tagged hooks are ever added or removed.
- Uninstalling Overlid removes its hooks. The backups are kept.

**Privacy**
- The microphone is open only while voice scrolling is on, and measures loudness in memory only. Screen colour sampling keeps only an average colour, only while presenting. There's no keyboard hook.
- Settings › About lists everything Overlid stores and has **Clear all Overlid data**.

**Supply chain**
- Lockfiles are committed. CI runs `cargo audit`, `cargo deny` (advisories, licences, sources), `npm audit` and gitleaks secret scanning.
- GitHub Actions are pinned to commit SHAs with read-only permissions by default. Dependabot keeps dependencies and actions current.
- Each release ships a `SHA256SUMS.txt`. See the README for how to check your download.
