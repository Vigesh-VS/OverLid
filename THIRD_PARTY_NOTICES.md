# Third-party notices

## Inspiration

Overlid's features were inspired by the projects below. No source code, artwork or other assets were copied from them; the ideas were reimplemented from scratch.

| Project | Author | Licence | What inspired Overlid |
|---|---|---|---|
| dynamic-island-for-windows | rajsriv | MIT | Top-centre pill that expands on hover, media player, system stats, lock-key and battery pop-ups, full-screen awareness, tray menu |
| Nusa | — | MIT | Dynamic-island layout on Windows |
| CodeNotch | vinzdg | MIT | Usage rings per AI provider, 5-hour / 7-day windows, session status, graded thresholds |
| codenotch-windows | MakFly | MIT | CodeNotch ideas on Windows |
| TopCue | — | MIT | Script scrolling out of the notch under the webcam, hover to pause, speed and size shortcuts |
| NotchPrompter | — | MIT | Notch teleprompter, hidden from screen share, mirror mode |
| Moody | — | MIT | Voice-activated scrolling and level beam |

## Libraries

Overlid is built on open-source libraries. Their licences are included in their packages and in the installer's source distribution. The main ones are:

**Rust:** tauri and its official plugins (log, store, global-shortcut, autostart, single-instance, notification, dialog), windows (Microsoft), sysinfo, cpal, reqwest, rustls, serde, serde_json, chrono, tiny_http, tokio, base64, dirs, anyhow, thiserror, log. All MIT and/or Apache-2.0.

**JavaScript:** react, react-dom, framer-motion, zustand, @tauri-apps/api, vite, typescript. All MIT, apart from TypeScript (Apache-2.0).

To list every dependency with its licence:

```powershell
cargo install cargo-license
cargo license --manifest-path src-tauri/Cargo.toml
npx license-checker --summary
```
