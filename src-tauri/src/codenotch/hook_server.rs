//! Localhost receiver for Claude Code `"type": "http"` hooks.
//!
//! A small std-only HTTP/1.1 listener on 127.0.0.1. Each request must be
//! `POST /hook`, `application/json`, carry no `Origin`, have a `Host` of
//! `127.0.0.1:<port>` or `localhost:<port>` (stops browser CSRF and DNS
//! rebinding) and the per-install `X-Overlid-Token`. Bodies are capped at
//! 64 KB, reads time out after 2 s, and requests are rate limited. Accepted
//! payloads go through the strict schema in `sessions::parse_hook`.

use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicU16, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};

use super::sessions::{self, HookEvent};
use super::{hook_installer, hook_token};
use crate::secret::Secret;
use crate::settings;

/// Ports tried after the configured one is taken.
const PORT_ATTEMPTS: u16 = 10;
const MAX_HEAD: usize = 8 * 1024;
const MAX_BODY: usize = 64 * 1024;
const READ_TIMEOUT: Duration = Duration::from_secs(2);
/// Requests handled at once; more are dropped.
const MAX_CONNECTIONS: usize = 8;
const RATE_PER_SEC: f64 = 50.0;
const RATE_BURST: f64 = 100.0;
pub const TOKEN_HEADER: &str = "x-overlid-token";

#[derive(Default)]
pub struct HookServer {
    port: AtomicU16,
    /// Bumped on every restart; an accept loop exits when it's stale.
    generation: AtomicU64,
    token: Mutex<Option<Arc<Secret>>>,
}

pub fn bound_port(app: &AppHandle) -> Option<u16> {
    let port = app.try_state::<HookServer>()?.port.load(Ordering::Relaxed);
    (port != 0).then_some(port)
}

/// The per-install token, loaded (or created) at start.
pub fn token(app: &AppHandle) -> Option<Arc<Secret>> {
    app.try_state::<HookServer>()?.token.lock().ok()?.clone()
}

pub fn start(app: &AppHandle) {
    app.manage(HookServer::default());
    restart(app);
}

/// (Re)bind on the configured port. If hooks are installed for a different
/// port or an old token, rewrite them to match.
pub fn restart(app: &AppHandle) {
    let Some(state) = app.try_state::<HookServer>() else { return };
    let generation = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    let old_port = state.port.swap(0, Ordering::SeqCst);
    if old_port != 0 {
        // Wake the old accept loop so it sees it's stale and exits.
        let _ = TcpStream::connect_timeout(&SocketAddr::from((Ipv4Addr::LOCALHOST, old_port)), Duration::from_millis(200));
    }

    let token = match current_token(&state) {
        Ok(t) => t,
        Err(e) => {
            log::error!("hook server off: no hook token ({e:#})");
            return;
        }
    };

    let wanted = settings::current(app).code.port;
    let Some((listener, port)) = bind(wanted) else {
        log::warn!("hook server: no free port in {wanted}..{}", wanted.saturating_add(PORT_ATTEMPTS));
        return;
    };
    state.port.store(port, Ordering::SeqCst);
    log::info!("hook server listening on 127.0.0.1:{port}");

    if hook_installer::needs_update(port, token.expose()) {
        match hook_installer::install(port, &token) {
            Ok(_) => log::info!("updated Claude Code hooks for port {port}"),
            Err(e) => log::warn!("couldn't update the installed hooks: {e:#}"),
        }
    }

    let guard = Arc::new(Guard::new(port, token));
    let app = app.clone();
    let alive = {
        let app = app.clone();
        move || app.try_state::<HookServer>().is_some_and(|s| s.generation.load(Ordering::SeqCst) == generation)
    };
    let on_hook = move |event: HookEvent| sessions::handle_hook(&app, &event);
    let spawned = thread::Builder::new()
        .name("hook-server".into())
        .spawn(move || accept_loop(&listener, &guard, alive, Arc::new(on_hook)));
    if let Err(e) = spawned {
        log::error!("could not spawn hook server: {e}");
    }
}

fn current_token(state: &HookServer) -> anyhow::Result<Arc<Secret>> {
    let mut slot = state.token.lock().map_err(|_| anyhow::anyhow!("token lock poisoned"))?;
    if let Some(token) = slot.as_ref() {
        return Ok(Arc::clone(token));
    }
    let token = Arc::new(hook_token::get_or_create()?);
    *slot = Some(Arc::clone(&token));
    Ok(token)
}

fn bind(start: u16) -> Option<(TcpListener, u16)> {
    (0..PORT_ATTEMPTS).find_map(|i| {
        let port = start.checked_add(i)?;
        TcpListener::bind((Ipv4Addr::LOCALHOST, port)).ok().map(|l| (l, port))
    })
}

/// Token bucket: `RATE_PER_SEC` sustained, `RATE_BURST` at once.
struct Bucket {
    tokens: f64,
    at: Instant,
}

impl Bucket {
    fn take(&mut self, now: Instant) -> bool {
        let refill = now.saturating_duration_since(self.at).as_secs_f64() * RATE_PER_SEC;
        self.tokens = (self.tokens + refill).min(RATE_BURST);
        self.at = now;
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            true
        } else {
            false
        }
    }
}

pub struct Guard {
    port: u16,
    token: Arc<Secret>,
    bucket: Mutex<Bucket>,
    active: AtomicUsize,
}

impl Guard {
    pub fn new(port: u16, token: Arc<Secret>) -> Self {
        Self {
            port,
            token,
            bucket: Mutex::new(Bucket { tokens: RATE_BURST, at: Instant::now() }),
            active: AtomicUsize::new(0),
        }
    }
}

type OnHook = Arc<dyn Fn(HookEvent) + Send + Sync>;

fn accept_loop(listener: &TcpListener, guard: &Arc<Guard>, alive: impl Fn() -> bool, on_hook: OnHook) {
    for stream in listener.incoming() {
        if !alive() {
            break;
        }
        let Ok(stream) = stream else { continue };
        if guard.active.fetch_add(1, Ordering::SeqCst) >= MAX_CONNECTIONS {
            guard.active.fetch_sub(1, Ordering::SeqCst);
            continue; // dropping the stream closes it
        }
        let guard = Arc::clone(guard);
        let on_hook = Arc::clone(&on_hook);
        let spawned = thread::Builder::new().name("hook-request".into()).spawn(move || {
            if let Some(event) = handle_connection(stream, &guard) {
                on_hook(event);
            }
            guard.active.fetch_sub(1, Ordering::SeqCst);
        });
        if let Err(e) = spawned {
            log::warn!("hook request thread failed: {e}");
        }
    }
}

struct Head {
    method: String,
    path: String,
    headers: Vec<(String, String)>,
}

impl Head {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(n, _)| n == name).map(|(_, v)| v.as_str())
    }

    fn count(&self, name: &str) -> usize {
        self.headers.iter().filter(|(n, _)| n == name).count()
    }
}

fn parse_head(raw: &[u8]) -> Option<Head> {
    let text = std::str::from_utf8(raw).ok()?;
    let mut lines = text.split("\r\n");
    let mut request = lines.next()?.split(' ');
    let method = request.next()?.to_owned();
    let target = request.next()?;
    if !request.next()?.starts_with("HTTP/1.") || request.next().is_some() {
        return None;
    }
    let path = target.split('?').next().unwrap_or_default().to_owned();
    let mut headers = Vec::new();
    for line in lines.filter(|l| !l.is_empty()) {
        let (name, value) = line.split_once(':')?;
        headers.push((name.trim().to_ascii_lowercase(), value.trim().to_owned()));
    }
    Some(Head { method, path, headers })
}

/// Every check except the body. Err is the HTTP status to answer with.
fn check(head: &Head, guard: &Guard) -> Result<usize, u16> {
    if head.path != "/hook" {
        return Err(404);
    }
    if head.method != "POST" {
        return Err(405);
    }
    // Browsers always send Origin on cross-site POSTs; Claude Code never does.
    if head.header("origin").is_some() {
        return Err(403);
    }
    let port = guard.port;
    let host_ok = head.count("host") == 1
        && head
            .header("host")
            .is_some_and(|h| h == format!("127.0.0.1:{port}") || h.eq_ignore_ascii_case(&format!("localhost:{port}")));
    if !host_ok {
        return Err(403);
    }
    let json = head
        .header("content-type")
        .and_then(|v| v.split(';').next())
        .is_some_and(|v| v.trim().eq_ignore_ascii_case("application/json"));
    if !json {
        return Err(415);
    }
    let token_ok = head.count(TOKEN_HEADER) == 1
        && head
            .header(TOKEN_HEADER)
            .is_some_and(|t| hook_token::constant_time_eq(t.as_bytes(), guard.token.expose().as_bytes()));
    if !token_ok {
        return Err(401);
    }
    if head.header("transfer-encoding").is_some() || head.count("content-length") != 1 {
        return Err(411);
    }
    let length: usize = head.header("content-length").and_then(|v| v.parse().ok()).ok_or(400u16)?;
    if length > MAX_BODY {
        return Err(413);
    }
    Ok(length)
}

fn reason(code: u16) -> &'static str {
    match code {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        408 => "Request Timeout",
        411 => "Length Required",
        413 => "Payload Too Large",
        415 => "Unsupported Media Type",
        422 => "Unprocessable Content",
        429 => "Too Many Requests",
        431 => "Request Header Fields Too Large",
        _ => "Error",
    }
}

fn respond(stream: &mut TcpStream, code: u16) {
    let body = if code == 200 { "{}" } else { "" };
    let mut text = format!(
        "HTTP/1.1 {code} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n",
        reason(code),
        body.len()
    );
    if code == 405 {
        text.push_str("Allow: POST\r\n");
    }
    text.push_str("\r\n");
    text.push_str(body);
    let _ = stream.write_all(text.as_bytes());
    let _ = stream.flush();
}

/// Read one request, answer it, and hand back the event if it was accepted.
fn handle_connection(mut stream: TcpStream, guard: &Guard) -> Option<HookEvent> {
    let started = Instant::now();
    let _ = stream.set_read_timeout(Some(READ_TIMEOUT));
    let _ = stream.set_write_timeout(Some(READ_TIMEOUT));

    let allowed = guard.bucket.lock().map(|mut b| b.take(Instant::now())).unwrap_or(false);
    if !allowed {
        respond(&mut stream, 429);
        return None;
    }

    match read_request(&mut stream, guard, started) {
        Ok(event) => {
            // Answer first so Claude Code is never kept waiting.
            respond(&mut stream, 200);
            Some(event)
        }
        Err(code) => {
            if code != 408 {
                respond(&mut stream, code);
            }
            log::debug!("hook request refused ({code})");
            None
        }
    }
}

fn read_request(stream: &mut TcpStream, guard: &Guard, started: Instant) -> Result<HookEvent, u16> {
    let mut buf = Vec::with_capacity(1024);
    let mut chunk = [0u8; 4096];
    let head_end = loop {
        if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break i;
        }
        if buf.len() > MAX_HEAD {
            return Err(431);
        }
        if started.elapsed() > READ_TIMEOUT {
            return Err(408);
        }
        match stream.read(&mut chunk) {
            Ok(0) | Err(_) => return Err(408),
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
        }
    };
    let head = parse_head(&buf[..head_end]).ok_or(400u16)?;
    let length = check(&head, guard)?;

    let mut body = buf.split_off(head_end + 4);
    while body.len() < length {
        if started.elapsed() > READ_TIMEOUT {
            return Err(408);
        }
        match stream.read(&mut chunk) {
            Ok(0) | Err(_) => return Err(408),
            Ok(n) => body.extend_from_slice(&chunk[..n]),
        }
        if body.len() > MAX_BODY {
            return Err(413);
        }
    }
    body.truncate(length);
    sessions::parse_hook(&body).map_err(|_| 422u16)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    const TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    struct Running {
        port: u16,
        events: mpsc::Receiver<HookEvent>,
    }

    fn serve() -> Running {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let guard = Arc::new(Guard::new(port, Arc::new(Secret::new(TOKEN.into()))));
        let (tx, events) = mpsc::channel();
        let tx = Mutex::new(tx);
        let on_hook: OnHook = Arc::new(move |e| {
            let _ = tx.lock().unwrap().send(e);
        });
        thread::spawn(move || accept_loop(&listener, &guard, || true, on_hook));
        Running { port, events }
    }

    fn body() -> String {
        r#"{"hook_event_name":"Stop","session_id":"abc-123","cwd":"C:\\code\\app","tool_input":{"x":1}}"#.into()
    }

    fn request(port: u16, head: &str, body: &str) -> u16 {
        let mut s = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).unwrap();
        s.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        s.write_all(format!("{head}Content-Length: {}\r\n\r\n{body}", body.len()).as_bytes()).unwrap();
        let mut out = String::new();
        let _ = s.read_to_string(&mut out);
        out.split(' ').nth(1).and_then(|c| c.parse().ok()).unwrap_or(0)
    }

    fn good_head(port: u16) -> String {
        format!("POST /hook?overlid=1 HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\nX-Overlid-Token: {TOKEN}\r\n")
    }

    #[test]
    fn accepts_a_real_hook() {
        let r = serve();
        assert_eq!(request(r.port, &good_head(r.port), &body()), 200);
        let event = r.events.recv_timeout(Duration::from_secs(2)).unwrap();
        assert_eq!(event.session_id, "abc-123");
    }

    #[test]
    fn rejects_missing_or_wrong_token() {
        let r = serve();
        let head = good_head(r.port).replace(&format!("X-Overlid-Token: {TOKEN}\r\n"), "");
        assert_eq!(request(r.port, &head, &body()), 401);
        let wrong = good_head(r.port).replace(TOKEN, &"f".repeat(64));
        assert_eq!(request(r.port, &wrong, &body()), 401);
        assert!(r.events.try_recv().is_err());
    }

    #[test]
    fn rejects_browser_requests() {
        let r = serve();
        let origin = format!("{}Origin: https://evil.example\r\n", good_head(r.port));
        assert_eq!(request(r.port, &origin, &body()), 403);
        let rebinding = good_head(r.port).replace("127.0.0.1:", "evil.example:");
        assert_eq!(request(r.port, &rebinding, &body()), 403);
        let form = good_head(r.port).replace("application/json", "text/plain");
        assert_eq!(request(r.port, &form, &body()), 415);
    }

    #[test]
    fn only_post_hook() {
        let r = serve();
        assert_eq!(request(r.port, &good_head(r.port).replace("POST", "GET"), ""), 405);
        assert_eq!(request(r.port, &good_head(r.port).replace("/hook", "/admin"), &body()), 404);
    }

    #[test]
    fn rejects_big_bodies_and_bad_schema() {
        let r = serve();
        let big = format!("{{\"pad\":\"{}\"}}", "a".repeat(MAX_BODY));
        assert_eq!(request(r.port, &good_head(r.port), &big), 413);
        let unknown = r#"{"hook_event_name":"RunThis","session_id":"a"}"#;
        assert_eq!(request(r.port, &good_head(r.port), unknown), 422);
        assert_eq!(request(r.port, &good_head(r.port), "not json"), 422);
    }

    #[test]
    fn slow_clients_time_out() {
        let r = serve();
        let mut s = TcpStream::connect((Ipv4Addr::LOCALHOST, r.port)).unwrap();
        s.write_all(b"POST /hook HTTP/1.1\r\n").unwrap();
        s.set_read_timeout(Some(Duration::from_secs(6))).unwrap();
        let t = Instant::now();
        let mut out = Vec::new();
        let _ = s.read_to_end(&mut out);
        assert!(t.elapsed() < Duration::from_secs(5), "server kept a stalled request open");
        assert!(out.is_empty());
    }

    #[test]
    fn rate_limit_allows_a_burst_then_refills() {
        let start = Instant::now();
        let mut bucket = Bucket { tokens: RATE_BURST, at: start };
        let allowed = (0..150).filter(|_| bucket.take(start)).count();
        assert_eq!(allowed, RATE_BURST as usize);
        assert!(!bucket.take(start));
        assert!(bucket.take(start + Duration::from_millis(40)), "refills at 50/s");
    }
}
