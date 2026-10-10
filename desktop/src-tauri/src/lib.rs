//! ONI RCON: an Office of Naval Intelligence styled admin console for Project Reclaimer Halo 3 dedicated servers.
//! The backend (this crate) holds every connection, command, credential and file; the window draws what it's told.
mod config;
mod demo;
mod fakeforge;
mod forge;
mod fstate;
mod health;
mod hub;
mod install;
mod rcon;
mod stats;
mod util;

use config::Server;
use hub::{ForgeSetup, HealthSetup, Hub};
use parking_lot::Mutex;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};
use util::Secret;

const DEMO_HINT: &str = "Three pretend servers to look around, and a pretend ReclaimerForge on F6. Click a player, try the buttons, and press ? for a guide. When you're ready, + ADD SERVER (left) connects your own.";
const NEW_HINT: &str = "You're in. Click a player for what you can do, or press ? for a guide.";

/// oni-rcon [targets...] [-c CONFIG] [--ssh DEST] [--by NAME] [--demo] [--setup] [--intro full|quick|off] [--no-intro]
#[derive(Default, Clone, Debug)]
struct Args {
    targets: Vec<String>,
    config: Option<PathBuf>,
    ssh: String,
    by: Option<String>,
    demo: bool,
    setup: bool,
    intro: Option<String>,
    no_intro: bool,
}

fn parse_args() -> Result<Args, String> {
    let mut a = Args::default();
    let mut it = std::env::args().skip(1);
    while let Some(x) = it.next() {
        let mut val = |name: &str| it.next().ok_or_else(|| format!("{name} needs a value"));
        match x.as_str() {
            "-c" | "--config" => a.config = Some(val("--config")?.into()),
            "--ssh" => a.ssh = val("--ssh")?,
            "--by" => a.by = Some(val("--by")?),
            "--demo" => a.demo = true,
            "--setup" => a.setup = true,
            "--no-intro" => a.no_intro = true,
            "--intro" => {
                let v = val("--intro")?;
                if !["full", "quick", "off"].contains(&v.as_str()) {
                    return Err("--intro is full, quick or off".into());
                }
                a.intro = Some(v);
            }
            "-V" | "--version" => {
                println!("oni-rcon {}", env!("CARGO_PKG_VERSION"));
                std::process::exit(0);
            }
            "-h" | "--help" => {
                println!("oni-rcon [targets...] [-c CONFIG] [--ssh DEST] [--by NAME] [--demo] [--setup] [--intro full|quick|off] [--no-intro]");
                std::process::exit(0);
            }
            s if s.starts_with('-') && !s.starts_with("--psn") => return Err(format!("unknown option {s}")),
            s => a.targets.push(s.into()),
        }
    }
    Ok(a)
}

fn login() -> String {
    let u = whoami::username();
    if u.is_empty() {
        "operator".into()
    } else {
        u
    }
}

#[derive(Default)]
struct Prefs {
    intro_seen: bool,
    full_intro: bool,
}

fn prefs_path() -> PathBuf {
    config::user_config().with_file_name("prefs.json")
}

fn prefs_load() -> Prefs {
    let v: Value = std::fs::read_to_string(prefs_path()).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
    Prefs { intro_seen: v["intro_seen"] == true, full_intro: v["full_intro"] == true }
}

fn prefs_save(p: &Prefs) {
    let _ = util::write_atomic(&prefs_path(), &format!("{}\n", json!({"intro_seen": p.intro_seen, "full_intro": p.full_intro})), false);
}

struct App {
    args: Args,
    arg_error: String,
    hub: Mutex<Option<Arc<Hub>>>,
    typed: Mutex<HashMap<String, String>>, // passwords given to the setup screen but not saved: good for this session
    by: Mutex<String>,
    forced_setup: Mutex<bool>,
    demo: Mutex<bool>,
    hint: Mutex<String>,
}

fn config_path(a: &Args) -> Option<PathBuf> {
    a.config.clone().or_else(config::default_config)
}

/// Whether to open on the setup screen or the console, and what the setup screen starts with.
#[tauri::command]
fn launch_info(app: State<'_, App>) -> Value {
    let a = &app.args;
    let path = config_path(a);
    let setup = *app.forced_setup.lock() || a.setup || !(*app.demo.lock() || !a.targets.is_empty() || path.is_some());
    let (mut by, mut existing, mut error) = (String::new(), vec![], app.arg_error.clone());
    if let Some(p) = &path {
        match config::load_config(p) {
            Ok((b, s)) => {
                by = b;
                existing = s.iter().map(|s| json!({"where": s.where_(), "name": s.name})).collect();
            }
            Err(e) if setup => error = e,
            Err(_) => {}
        }
    }
    let by = a.by.clone().filter(|b| !b.is_empty()).or_else(|| (!by.is_empty()).then_some(by)).unwrap_or_else(login);
    json!({"mode": if setup { "setup" } else { "console" }, "version": env!("CARGO_PKG_VERSION"),
        "setup": {"path": path.clone().unwrap_or_else(config::user_config).display().to_string(), "existing": existing, "by": by,
            "ask_by": path.is_none() && a.by.is_none()}, "error": error})
}

#[derive(Deserialize)]
struct Spec {
    address: String,
    port: String,
    password: String,
    name: String,
    ssh: String,
}

/// What parse_target reads, from the setup screen's two boxes: an address may carry its own port, or be a URL.
fn spec_server(s: &Spec) -> Result<Server, String> {
    let (address, port) = (s.address.trim(), s.port.trim());
    let target = if address.contains("://") || port.is_empty() {
        address.to_string()
    } else if address.matches(':').count() > 1 && !address.starts_with('[') {
        format!("[{address}]:{port}")
    } else if address.rsplit(']').next().unwrap_or_default().contains(':') {
        address.to_string()
    } else {
        format!("{}:{port}", if address.is_empty() { "127.0.0.1" } else { address })
    };
    let mut srv = config::parse_target(&target, s.ssh.trim(), s.name.trim())
        .map_err(|_| "That address doesn't look right. Use an IP or host name, and the port number.".to_string())?;
    srv.password = s.password.clone();
    Ok(srv)
}

/// Sign in once and hang up: (worked, what to tell the operator).
#[tauri::command]
async fn setup_probe(spec: Spec) -> Value {
    let s = match spec_server(&spec) {
        Ok(s) => s,
        Err(e) => return json!({"ok": false, "text": e, "state": "invalid"}),
    };
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    let mut tasks = vec![];
    let (url, ready) = if !s.ssh.is_empty() && s.url.is_empty() {
        let t = Arc::new(rcon::Tunnel::new(&s.ssh, &[(s.host.clone(), s.port)]));
        let (ttx, mut trx) = tokio::sync::mpsc::unbounded_channel();
        tasks.push(tokio::spawn(t.clone().run(ttx)));
        let tx2 = tx.clone();
        tasks.push(tokio::spawn(async move {
            while let Some((_, state, detail)) = trx.recv().await {
                if state == "down" {
                    let _ = tx2.send(rcon::LinkNote::State { state: "tunnel", detail, retry_in: 0, info: Value::Null });
                }
            }
        }));
        (format!("ws://127.0.0.1:{}", t.local_port(&s.host, s.port)), Some(t.ready.subscribe()))
    } else {
        (s.direct_url(), None)
    };
    let rc = rcon::Rcon::new(&s.password, "setup");
    tasks.push(tokio::spawn(rc.run(url, ready, Arc::new(tokio::sync::Semaphore::new(1)), tx)));
    let wait = async {
        while let Some(n) = rx.recv().await {
            if let rcon::LinkNote::State { state, detail, info, .. } = n {
                match state {
                    "online" => {
                        let name = util::pick_str(&info, &["server"]);
                        return json!({"ok": true, "text": format!("Connected to {}.", if name.is_empty() { s.where_() } else { name })});
                    }
                    "denied" | "offline" | "tunnel" => return json!({"ok": false, "detail": detail, "state": if state == "tunnel" { "offline" } else { state }}),
                    _ => {}
                }
            }
        }
        json!({"ok": false, "text": "No answer."})
    };
    let out = tokio::time::timeout(std::time::Duration::from_secs(12), wait)
        .await
        .unwrap_or_else(|_| json!({"ok": false, "text": "No answer in time. Check the address and port, and any firewall in between."}));
    for t in tasks {
        t.abort();
    }
    out
}

#[tauri::command]
fn setup_check(spec: Spec, app: State<'_, App>) -> Value {
    match spec_server(&spec) {
        Ok(s) => {
            let path = config_path(&app.args);
            let dup = path.and_then(|p| config::load_config(&p).ok()).is_some_and(|(_, ex)| ex.iter().any(|x| x.where_() == s.where_()));
            json!({"ok": !dup, "where": s.where_(), "text": if dup { format!("{} is already in your list.", s.where_()) } else { String::new() }})
        }
        Err(e) => json!({"ok": false, "text": e}),
    }
}

/// Add the servers to the config file; a password not kept there is held for this session.
#[tauri::command]
fn setup_save(specs: Vec<Spec>, by: String, remember: bool, app: State<'_, App>) -> Result<(), String> {
    let servers: Vec<Server> = specs.iter().map(spec_server).collect::<Result<_, _>>()?;
    let path = config_path(&app.args).unwrap_or_else(config::user_config);
    if !servers.is_empty() {
        config::add_servers(&path, &servers, by.trim(), remember).map_err(|e| format!("Couldn't save {}: {e}", path.display()))?;
    }
    let mut typed = app.typed.lock();
    for s in &servers {
        typed.insert(s.where_(), s.password.clone());
    }
    if !by.trim().is_empty() {
        *app.by.lock() = by.trim().into();
    }
    *app.forced_setup.lock() = false;
    *app.hint.lock() = NEW_HINT.into();
    *app.demo.lock() = false;
    Ok(())
}

#[tauri::command]
fn setup_open(app: State<'_, App>) {
    if let Some(h) = app.hub.lock().take() {
        h.stop();
    }
    *app.forced_setup.lock() = true;
}

/// Build the console: the demo, the command line's targets, or the config file's servers.
#[tauri::command]
async fn start_console(demo: bool, handle: AppHandle, app: State<'_, App>) -> Result<Value, String> {
    if let Some(h) = app.hub.lock().take() {
        h.stop();
    }
    let a = app.args.clone();
    let demo = demo || *app.demo.lock();
    *app.forced_setup.lock() = false;
    let mut hint = std::mem::take(&mut *app.hint.lock());
    let path = config_path(&a);
    let mut cfg_by = String::new();
    let mut extra = vec![];
    let (mut servers, hsetup, fsetup, state_dir) = if demo {
        *app.demo.lock() = true;
        let scratch = tempfile::Builder::new().prefix("oni-rcon-demo-").tempdir().map_err(|e| e.to_string())?.keep();
        let folders: Vec<PathBuf> = (1..=3).map(|i| scratch.join(format!("content-{i}"))).collect();
        let (ports, host) = demo::serve_fakes("demo", &folders, &mut extra).await;
        let servers: Vec<Server> = ports
            .iter()
            .zip(&folders)
            .map(|(p, d)| {
                let mut s = Server::new("127.0.0.1", *p);
                s.password = "demo".into();
                s.content_dir = d.display().to_string();
                s
            })
            .collect();
        let (url, key) = fakeforge::start(&mut extra).await;
        if hint.is_empty() {
            hint = DEMO_HINT.into();
        }
        (
            servers,
            HealthSetup { min_free: 1024, service: "blueflame-demo".into(), demo: Some(host) },
            ForgeSetup { key: Secret::new(&key), source: "the demo".into(), error: String::new(), url, poll: 30.0, cache_dir: Some(scratch.clone()), config: None },
            Some(scratch),
        )
    } else {
        let servers = if !a.targets.is_empty() {
            a.targets.iter().map(|t| config::parse_target(t, &a.ssh, "")).collect::<Result<Vec<_>, _>>()?
        } else {
            let p = path.clone().ok_or("No config file and no servers: open the setup screen to add one.")?;
            let (b, mut s) = config::load_config(&p)?;
            cfg_by = b;
            let typed = app.typed.lock();
            for srv in s.iter_mut() {
                if srv.password.is_empty() {
                    srv.password = typed.get(&srv.where_()).cloned().unwrap_or_default();
                }
            }
            s
        };
        let hs = config::top_level(path.as_deref(), "health_");
        let min_free = match hs.get("health_min_free_mb") {
            None => 1024,
            Some(toml::Value::Integer(n)) if *n > 0 => *n,
            Some(toml::Value::Float(f)) if *f > 0.0 => *f as i64,
            Some(_) => return Err(format!("{}: health_min_free_mb must be a number of megabytes above 0", path.as_ref().unwrap().display())),
        };
        let service = hs.get("health_service").and_then(|v| v.as_str()).unwrap_or_default().to_string();
        if !service.is_empty() && !health::UNIT.is_match(&service) {
            return Err(format!("{}: health_service must be a systemd unit name, such as halo-blueflame", path.as_ref().unwrap().display()));
        }
        let fs = config::top_level(path.as_deref(), "forge_");
        let (key, source, error) = hub::load_key(&fs).await;
        let poll = fs.get("forge_poll").and_then(|v| v.as_float().or(v.as_integer().map(|i| i as f64))).unwrap_or(600.0).max(60.0);
        (
            servers,
            HealthSetup { min_free, service, demo: None },
            ForgeSetup { key, source, error, url: forge::FORGE_URL.into(), poll, cache_dir: Some(config::cache_root()), config: path.clone() },
            Some(config::user_config().parent().unwrap().to_path_buf()),
        )
    };
    let waiting = config::resolve_passwords(&mut servers).await?;
    let by = {
        let typed_by = app.by.lock().clone();
        a.by.clone().filter(|b| !b.is_empty()).or((!typed_by.is_empty()).then_some(typed_by)).or((!cfg_by.is_empty()).then_some(cfg_by)).unwrap_or_else(login)
    };
    let prefs = prefs_load();
    let intro = if a.no_intro {
        "off".to_string()
    } else {
        a.intro.clone().unwrap_or_else(|| if prefs.full_intro || !prefs.intro_seen { "full".into() } else { "quick".into() })
    };
    let stations: Vec<Value> = servers
        .iter()
        .enumerate()
        .map(|(i, s)| json!({"index": i, "name": s.name, "where": s.where_(), "ssh": if s.url.is_empty() { s.ssh.clone() } else { String::new() },
            "url": s.url, "content_dir": s.content_dir, "host": s.host, "port": s.port}))
        .collect();
    let hub = Hub::start(handle, servers, by.clone(), hsetup, fsetup, state_dir, &waiting, extra);
    let info = json!({"by": by, "stations": stations, "tunnels": hub.tunnels.iter().map(|t| t.dest.clone()).collect::<Vec<_>>(),
        "intro": intro, "hint": hint, "waiting": waiting, "demo": demo, "full_intro": prefs.full_intro,
        "forge": hub.forge_status(), "forge_state": hub.forge_state_view(), "health": hub.health_view(),
        "version": env!("CARGO_PKG_VERSION")});
    *app.hub.lock() = Some(hub);
    Ok(info)
}

fn hub_of(app: &State<'_, App>) -> Result<Arc<Hub>, String> {
    app.hub.lock().clone().ok_or_else(|| "the console isn't running".to_string())
}

#[tauri::command]
async fn call(index: usize, command: String, args: Vec<String>, timeout: Option<f64>, app: State<'_, App>) -> Result<Value, String> {
    let h = hub_of(&app)?;
    Ok(h.call(index, &command, args, timeout.unwrap_or(10.0)).await)
}

#[tauri::command]
async fn reconnect(index: usize, password: Option<String>, app: State<'_, App>) -> Result<(), String> {
    let h = hub_of(&app)?;
    if let Some(pw) = password {
        *h.stations[index].rcon.password.lock() = pw;
    }
    h.connect(index);
    Ok(())
}

/// The one password typed for every server that had none of its own, as the terminal console prompted for.
#[tauri::command]
async fn set_password(password: String, indices: Vec<usize>, app: State<'_, App>) -> Result<(), String> {
    let h = hub_of(&app)?;
    for i in indices {
        *h.stations[i].rcon.password.lock() = password.clone();
        h.connect(i);
    }
    Ok(())
}

#[tauri::command]
fn set_labels(labels: Vec<String>, app: State<'_, App>) -> Result<(), String> {
    *hub_of(&app)?.labels.lock() = labels;
    Ok(())
}

#[tauri::command]
fn health_now(app: State<'_, App>) -> Result<(), String> {
    hub_of(&app)?.health_now();
    Ok(())
}

#[tauri::command]
fn health_view(app: State<'_, App>) -> Result<Value, String> {
    Ok(hub_of(&app)?.health_view())
}

fn forge_err(e: forge::ForgeError) -> Value {
    json!({"error": {"status": e.status, "short": e.short, "text": e.text}})
}

#[tauri::command]
async fn forge_listings(sort: String, window: String, q: String, more: Option<Value>, fresh: bool, app: State<'_, App>) -> Result<Value, String> {
    let h = hub_of(&app)?;
    let f = match h.client() {
        Ok(f) => f,
        Err(e) => return Ok(forge_err(e)),
    };
    Ok(match f.listings(&sort, &window, &q, more.as_ref(), fresh).await {
        Ok((items, next, reply)) => json!({"items": items, "next": next, "stale": reply["_stale"], "status": h.forge_status()}),
        Err(e) => forge_err(e),
    })
}

#[tauri::command]
async fn forge_favourites(fresh: bool, app: State<'_, App>) -> Result<Value, String> {
    let h = hub_of(&app)?;
    let f = match h.client() {
        Ok(f) => f,
        Err(e) => return Ok(forge_err(e)),
    };
    Ok(match f.favourites(fresh).await {
        Ok((cols, reply)) => {
            let (items, notes) = forge::favourite_listings(&cols);
            json!({"items": items, "notes": notes, "stale": reply["_stale"], "status": h.forge_status()})
        }
        Err(e) => forge_err(e),
    })
}

#[tauri::command]
async fn forge_listing(lid: String, app: State<'_, App>) -> Result<Value, String> {
    let h = hub_of(&app)?;
    let f = match h.client() {
        Ok(f) => f,
        Err(e) => return Ok(forge_err(e)),
    };
    Ok(match f.listing(&lid, false).await {
        Ok(d) => json!({"listing": d}),
        Err(e) => forge_err(e),
    })
}

#[tauri::command]
fn forge_set_key(key: String, remember: bool, app: State<'_, App>) -> Result<Value, String> {
    let h = hub_of(&app)?;
    let secret = Secret::new(&key);
    drop(key); // out of the arguments at once: only the Secret is kept
    let mut warn = String::new();
    {
        let mut s = h.fsetup.lock();
        s.key = secret.clone();
        s.source = "typed this session".into();
        s.error.clear();
        if remember {
            if let Some(cfg) = s.config.clone() {
                match config::remember_forge_key(&cfg, secret.value()) {
                    Ok(()) => s.source = cfg.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
                    Err(_) => warn = "Couldn't save it. It's loaded for this session.".into(),
                }
            }
        }
    }
    h.forge_connect();
    Ok(json!({"status": h.forge_status(), "warn": warn}))
}

#[tauri::command]
fn forge_status(app: State<'_, App>) -> Result<Value, String> {
    Ok(hub_of(&app)?.forge_status())
}

#[tauri::command]
fn forge_state(app: State<'_, App>) -> Result<Value, String> {
    Ok(hub_of(&app)?.forge_state_view())
}

#[tauri::command]
async fn forge_plan(index: usize, listing: Value, version: Value, app: State<'_, App>) -> Result<Value, String> {
    let h = hub_of(&app)?;
    Ok(match h.forge_plan(index, listing, version).await {
        Ok(p) => p,
        Err((title, text)) => json!({"error": {"short": title, "text": text}}),
    })
}

#[tauri::command]
async fn forge_put(plan: String, app: State<'_, App>) -> Result<(), String> {
    hub_of(&app)?.forge_put(plan);
    Ok(())
}

#[tauri::command]
fn forge_ack(lid: String, app: State<'_, App>) -> Result<(), String> {
    hub_of(&app)?.forge_ack(&lid);
    Ok(())
}

#[tauri::command]
fn prefs_intro(full: Option<bool>, seen: Option<bool>) -> Value {
    let mut p = prefs_load();
    if let Some(f) = full {
        p.full_intro = f;
    }
    if let Some(s) = seen {
        p.intro_seen = s;
    }
    prefs_save(&p);
    json!({"full_intro": p.full_intro, "intro_seen": p.intro_seen})
}

/// A newer release on GitHub, in one line; empty when up to date, offline or turned off (ONI_RCON_NO_UPDATE=1).
#[tauri::command]
async fn update_check() -> String {
    if std::env::var_os("ONI_RCON_NO_UPDATE").is_some() {
        return String::new();
    }
    let parse = |v: &str| v.trim_start_matches('v').split('.').map(|x| x.parse::<u64>().unwrap_or(0)).collect::<Vec<_>>();
    let Ok(c) = reqwest::Client::builder().user_agent(format!("oni-rcon/{}", env!("CARGO_PKG_VERSION"))).timeout(std::time::Duration::from_secs(10)).build() else { return String::new() };
    let Ok(r) = c.get("https://api.github.com/repos/viik2k/oni-rcon/releases/latest").send().await else { return String::new() };
    let Ok(v) = r.json::<Value>().await else { return String::new() };
    let tag = v["tag_name"].as_str().unwrap_or_default();
    if !tag.is_empty() && parse(tag) > parse(env!("CARGO_PKG_VERSION")) {
        format!("oni-rcon {tag} is out: download it from https://github.com/viik2k/oni-rcon/releases/latest")
    } else {
        String::new()
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let (args, arg_error) = match parse_args() {
        Ok(a) => (a, String::new()),
        Err(e) => (Args::default(), e),
    };
    let demo = args.demo; // until the setup screen saves servers of the operator's own
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(App {
            args,
            arg_error,
            hub: Mutex::new(None),
            typed: Mutex::new(HashMap::new()),
            by: Mutex::new(String::new()),
            forced_setup: Mutex::new(false),
            demo: Mutex::new(demo),
            hint: Mutex::new(String::new()),
        })
        .invoke_handler(tauri::generate_handler![
            launch_info, setup_probe, setup_check, setup_save, setup_open, start_console, call, reconnect, set_password,
            set_labels, health_now, health_view, forge_listings, forge_favourites, forge_listing, forge_set_key,
            forge_status, forge_state, forge_plan, forge_put, forge_ack, prefs_intro, update_check
        ])
        .on_window_event(|w, e| {
            if let tauri::WindowEvent::Destroyed = e {
                if let Some(h) = w.app_handle().state::<App>().hub.lock().take() {
                    h.stop();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running the console");
}
