//! Localhost receiver for Claude Code `"type": "http"` hooks.
//!
//! Listens on 127.0.0.1 only. `POST /hook` always answers `200 {}` straight
//! away, then hands the payload to the session state machine.

use std::io::Read;
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

use serde_json::Value;
use tauri::{AppHandle, Manager};
use tiny_http::{Header, Method, Response, Server};

use super::{hook_installer, sessions};
use crate::settings;

/// Ports tried after the configured one is taken.
const PORT_ATTEMPTS: u16 = 10;
const MAX_BODY: u64 = 1024 * 1024;

#[derive(Default)]
pub struct HookServer {
    port: AtomicU16,
    server: Mutex<Option<Arc<Server>>>,
}

pub fn bound_port(app: &AppHandle) -> Option<u16> {
    let port = app.try_state::<HookServer>()?.port.load(Ordering::Relaxed);
    (port != 0).then_some(port)
}

pub fn start(app: &AppHandle) {
    app.manage(HookServer::default());
    restart(app);
}

/// (Re)bind on the configured port. If hooks are installed for a different
/// port, rewrite them to the one we actually got.
pub fn restart(app: &AppHandle) {
    let Some(state) = app.try_state::<HookServer>() else { return };
    if let Ok(mut current) = state.server.lock()
        && let Some(old) = current.take()
    {
        old.unblock();
    }
    state.port.store(0, Ordering::Relaxed);

    let wanted = settings::current(app).code.port;
    let Some((server, port)) = bind(wanted) else {
        log::warn!("hook server: no free port in {wanted}..{}", wanted.saturating_add(PORT_ATTEMPTS));
        return;
    };
    let server = Arc::new(server);
    state.port.store(port, Ordering::Relaxed);
    if let Ok(mut current) = state.server.lock() {
        *current = Some(Arc::clone(&server));
    }
    log::info!("hook server listening on 127.0.0.1:{port}");

    if let Some(installed_port) = hook_installer::installed_port()
        && installed_port != port
    {
        match hook_installer::install(port) {
            Ok(_) => log::info!("updated Claude Code hooks to port {port}"),
            Err(e) => log::warn!("couldn't update hook port: {e:#}"),
        }
    }

    let app = app.clone();
    let spawned = thread::Builder::new()
        .name("hook-server".into())
        .spawn(move || serve(&app, &server));
    if let Err(e) = spawned {
        log::error!("could not spawn hook server: {e}");
    }
}

fn bind(start: u16) -> Option<(Server, u16)> {
    (0..PORT_ATTEMPTS).find_map(|i| {
        let port = start.checked_add(i)?;
        Server::http(("127.0.0.1", port)).ok().map(|s| (s, port))
    })
}

fn serve(app: &AppHandle, server: &Server) {
    let json = Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).ok();
    for mut request in server.incoming_requests() {
        let is_hook = *request.method() == Method::Post
            && request.url().split('?').next() == Some("/hook");
        if !is_hook {
            let _ = request.respond(Response::empty(404));
            continue;
        }

        let mut body = Vec::new();
        let read = request.as_reader().take(MAX_BODY).read_to_end(&mut body);

        // Answer first so Claude Code is never kept waiting.
        let mut response = Response::from_string("{}");
        if let Some(h) = json.clone() {
            response.add_header(h);
        }
        let _ = request.respond(response);

        if let Err(e) = read {
            log::debug!("hook body read failed: {e}");
            continue;
        }
        match serde_json::from_slice::<Value>(&body) {
            Ok(payload) => sessions::handle_hook(app, &payload),
            Err(e) => log::debug!("hook body was not JSON: {e}"),
        }
    }
}
