Paste this into Claude Code (in VS Code, opened in the empty `overlid` folder that contains CLAUDE.md and SPEC.md):

---

We're building **Overlid**, an open-source Dynamic-Island-style notch for Windows with media controls, system stats, a Pomodoro timer, Claude Code usage/session status (CodeNotch) and a notch teleprompter.

1. Read `CLAUDE.md` and `SPEC.md` completely.
2. Check my machine has the prerequisites listed in CLAUDE.md (rustc, cargo, node, npm, MSVC build tools). Tell me what's missing and how to install it, then stop until I confirm.
3. Once prerequisites are fine, `git init`, set my local git identity as CLAUDE.md says, and start **Phase 0** from SPEC §12: scaffold Tauri 2 + React + TypeScript in this folder (keep CLAUDE.md and SPEC.md), then build the island shell: transparent top-centre always-on-top window, click-through using the hit-rect approach, collapsed ↔ expanded spring animation, clock in the pill, tray icon with Quit.
4. For all UI work use the `frontend-design` skill and match my Google Stitch designs in `design/stitch/` (see CLAUDE.md → UI & design workflow). Create the `design/stitch/` folder now if it doesn't exist.
5. Before writing code, give me a short plan for Phase 0 (files you'll create, crates/packages you'll add).
6. When Phase 0 runs, tell me exactly what to test, and wait for my ok before committing and moving to Phase 1.

Work phase by phase like this until Phase 8. Let's go.
