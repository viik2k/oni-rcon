//! Plug-ins: separate programs that describe their own panel in JSON. The contract is docs/PLUGINS.md.
//!
//! A plug-in is never code in this process. Its folder holds an `oni-plugin.toml`; the config's top-level
//! `plugins = [...]` names the folders that are on, and the operator approves each one against a hash of its manifest
//! before it ever runs. A service plug-in is run once per request, here or over ssh the way the Health tab runs
//! health_cmd, with one JSON request on stdin and one JSON reply on stdout.
//!
//! Everything a plug-in sends is untrusted data: it is cut to the caps below and shaped into a fixed vocabulary here,
//! so the window only ever draws plain strings from a known set of block types.
use crate::health::scrub;
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

pub const API: i64 = 1;
pub const VIEW_TIMEOUT: f64 = 10.0;
pub const ACTION_TIMEOUT: f64 = 30.0;
const MAX_OUT: usize = 1 << 20; // bytes of stdout read; more is an error, because a cut JSON object doesn't parse
const MAX_ROWS: usize = 500; // rows of a table (and of a kv or log block); the rest become one "+N more" line
const MAX_STR: usize = 10_000; // characters per string
const MAX_ACTIONS: usize = 20;
const MAX_PARAMS: usize = 10;
const MAX_HTML: usize = 512 * 1024; // characters of an html block's page
const BLOCKS: [&str; 5] = ["kv", "table", "text", "log", "html"];
const LEVELS: [&str; 4] = ["ok", "warn", "alert", "off"];
const PARAM_TYPES: [&str; 5] = ["text", "number", "bool", "choice", "duration"];
pub const MANIFEST: &str = "oni-plugin.toml";

#[derive(Clone, Debug, Default, Serialize)]
pub struct Manifest {
    pub id: String, // the folder name
    pub hash: String, // sha256 of the manifest's bytes: what an approval is recorded against
    pub name: String,
    pub version: String,
    pub author: String,
    pub description: String,
    pub mode: String,
    pub exec: String,
    pub host: String,
    pub events: Vec<String>,
    pub rcon: Vec<String>,
    pub addresses: bool,
    pub error: String, // why it can't run at all (a bad manifest, a newer api); it's still listed, with this
    #[serde(skip)]
    pub folder: Option<PathBuf>, // a local one runs here, so exec can name a file beside it
}

impl Manifest {
    fn bad(id: &str, error: &str) -> Self {
        Manifest { id: id.into(), error: error.into(), ..Default::default() }
    }
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

fn strings(v: Option<&toml::Value>) -> Option<Vec<String>> {
    match v {
        None => Some(vec![]),
        Some(toml::Value::Array(a)) => a.iter().map(|x| x.as_str().map(str::to_string)).collect(),
        _ => None,
    }
}

/// One plug-in's manifest. Never fails: what's wrong with it goes in `error`, so it's listed with the reason and the
/// others are unaffected.
pub fn load(folder: &Path) -> Manifest {
    let id = folder.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let mut m = Manifest { id, mode: "service".into(), folder: Some(folder.to_path_buf()), ..Default::default() };
    let bytes = match std::fs::read(folder.join(MANIFEST)) {
        Ok(b) => b,
        Err(_) => {
            m.error = format!("no {MANIFEST} in {}", folder.display());
            return m;
        }
    };
    m.hash = hex::encode(Sha256::digest(&bytes));
    let data: toml::Table = match std::str::from_utf8(&bytes).map_err(|e| e.to_string()).and_then(|t| toml::from_str(t).map_err(|e| e.to_string())) {
        Ok(d) => d,
        Err(e) => {
            m.error = format!("{MANIFEST} isn't valid TOML: {}", e.trim());
            return m;
        }
    };
    let (run, perms) = (data.get("run"), data.get("permissions").cloned().unwrap_or(toml::Value::Table(Default::default())));
    let Some(api) = data.get("api").and_then(|v| v.as_integer()) else {
        m.error = "the manifest has no api number".into();
        return m;
    };
    let (Some(run), Some(perms)) = (run.and_then(|r| r.as_table()), perms.as_table()) else {
        m.error = "the manifest needs a [run] table, and [permissions] must be a table".into();
        return m;
    };
    let text = |k: &str| data.get(k).map(|v| v.as_str().map(str::to_string).unwrap_or_else(|| v.to_string())).unwrap_or_default().chars().take(200).collect::<String>();
    (m.name, m.version, m.author, m.description) = (text("name"), text("version"), text("author"), text("description"));
    m.mode = run.get("mode").and_then(|v| v.as_str()).unwrap_or(if run.contains_key("mode") { "?" } else { "service" }).into();
    let exec = run.get("exec").and_then(|v| v.as_str());
    let host = run.get("host").map(|v| v.as_str());
    let (events, rcon) = (strings(perms.get("events")), strings(perms.get("rcon")));
    let addresses = perms.get("addresses").map(|v| v.as_bool());
    m.error = if api > API {
        format!("needs plug-in api {api}; this version of Oni speaks api {API}")
    } else if m.name.is_empty() {
        "the manifest has no name".into()
    } else if m.mode != "service" && m.mode != "session" {
        "run.mode must be \"service\" or \"session\"".into()
    } else if m.mode == "session" {
        "session plug-ins aren't supported by this version of Oni yet".into()
    } else if exec.is_none_or(|e| e.trim().is_empty()) {
        "run.exec must be the command line to run".into()
    } else if host.is_some_and(|h| h.is_none()) {
        "run.host must be an ssh destination, or \"\" for this machine".into()
    } else if events.is_none() || rcon.is_none() {
        "permissions.events and permissions.rcon must be lists of names".into()
    } else if addresses.is_some_and(|a| a.is_none()) {
        "permissions.addresses must be true or false".into()
    } else {
        String::new()
    };
    m.exec = exec.unwrap_or_default().into();
    m.host = host.flatten().unwrap_or_default().into();
    m.events = events.unwrap_or_default();
    m.rcon = rcon.unwrap_or_default();
    m.addresses = addresses.flatten().unwrap_or(false);
    m
}

/// The config's `plugins = [...]`, or why it isn't a list of folder names.
pub fn enabled(settings: &toml::map::Map<String, toml::Value>) -> Result<Vec<String>, String> {
    strings(settings.get("plugins")).ok_or_else(|| "plugins must be a list of plug-in folder names, such as plugins = [\"gryphon\"]".into())
}

/// The plug-ins the config turns on, in its order. A folder it doesn't name is never read, and a name that isn't a
/// plain folder name (so can't climb out of plugins/) never becomes a path.
pub fn discover(folder: Option<&Path>, ids: &[String]) -> Vec<Manifest> {
    let mut seen = std::collections::HashSet::new();
    ids.iter()
        .filter(|id| seen.insert(id.to_string()))
        .map(|id| match folder {
            _ if !valid_id(id) => Manifest::bad(id, "a plug-in id must be lower-case letters, digits and dashes"),
            Some(f) => load(&f.join(id)),
            None => Manifest::bad(id, "no config file, so no plugins folder"),
        })
        .collect()
}

/// Why a plug-in won't run, or "" when it will: the manifest's own fault first, then a missing approval (also when
/// the manifest changed since it was given).
pub fn state(m: &Manifest, trusted: &Value) -> String {
    if !m.error.is_empty() {
        return m.error.clone();
    }
    if trusted.get(&m.id).and_then(Value::as_str) == Some(m.hash.as_str()) { String::new() } else { "needs approval".into() }
}

// --- running one ---------------------------------------------------------------------------------------------------
/// Run a service plug-in once: one JSON line in, one JSON object out. Valid JSON wins whatever the exit code;
/// otherwise the last stderr line, scrubbed of addresses.
pub async fn call(m: &Manifest, request: &Value, timeout: f64) -> Result<Value, String> {
    let mut c = if m.host.is_empty() {
        let mut c = crate::util::shell(&m.exec);
        if let Some(f) = &m.folder {
            c.current_dir(f);
        }
        c
    } else {
        let exe = crate::util::which("ssh").ok_or("no ssh client on PATH")?;
        let mut c = crate::util::command(&exe.to_string_lossy());
        c.args(crate::rcon::SSH_OPTS).arg(&m.host).arg(&m.exec);
        c
    };
    c.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = c.spawn().map_err(|e| scrub(&e.to_string()))?; // killed on drop: a timeout leaves nothing running
    let (mut stdin, mut stdout, mut stderr) = (child.stdin.take().unwrap(), child.stdout.take().unwrap(), child.stderr.take().unwrap());
    let line = format!("{request}\n");
    let exchange = async {
        let errs = tokio::spawn(async move { // read to the end so a chatty stderr never blocks it; keep the tail
            let (mut tail, mut buf) = (Vec::new(), [0u8; 65536]);
            while let Ok(n) = stderr.read(&mut buf).await {
                if n == 0 {
                    break;
                }
                tail.extend_from_slice(&buf[..n]);
                let cut = tail.len().saturating_sub(4096);
                tail.drain(..cut);
            }
            tail
        });
        let _ = stdin.write_all(line.as_bytes()).await; // one that doesn't read its request can still answer
        drop(stdin);
        let mut out = Vec::new();
        let _ = (&mut stdout).take(MAX_OUT as u64 + 1).read_to_end(&mut out).await;
        if out.len() > MAX_OUT {
            return Err(format!("its reply is over {} MiB", MAX_OUT >> 20));
        }
        let err = errs.await.unwrap_or_default();
        let code = child.wait().await.ok().and_then(|s| s.code()).unwrap_or(-1);
        Ok((out, err, code))
    };
    let (out, err, code) = tokio::time::timeout(Duration::from_secs_f64(timeout), exchange).await.map_err(|_| format!("no answer in {timeout}s"))??;
    let text = String::from_utf8_lossy(&out).trim().to_string();
    if let Ok(v @ Value::Object(_)) = serde_json::from_str::<Value>(&text) {
        return Ok(v);
    }
    let err = String::from_utf8_lossy(&err);
    Err(match err.trim().lines().last() {
        Some(last) => scrub(&cut(last, 300)),
        None if !text.is_empty() && code == 0 => "its reply isn't JSON".into(),
        None => format!("exited {code}"),
    })
}

// --- shaping what it sent ------------------------------------------------------------------------------------------
fn cut(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

/// Any value as a plain string within the cap: never markup, which React makes sure of when drawing.
fn s(v: Option<&Value>) -> String {
    match v {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(t)) => cut(t, MAX_STR),
        Some(x) => cut(&x.to_string(), MAX_STR),
    }
}

fn sn(v: Option<&Value>, n: usize) -> String {
    cut(&s(v), n)
}

/// Whether a value counts as given, the way the reference host reads it: not null, false, 0, "" or empty.
fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) | Some(Value::Bool(false)) => false,
        Some(Value::String(t)) => !t.is_empty(),
        Some(Value::Number(n)) => n.as_f64() != Some(0.0),
        Some(Value::Array(a)) => !a.is_empty(),
        Some(Value::Object(o)) => !o.is_empty(),
        _ => true,
    }
}

fn list(v: Option<&Value>) -> &[Value] {
    v.and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[])
}

fn rows(v: Option<&Value>) -> (&[Value], usize) {
    let r = list(v);
    (&r[..r.len().min(MAX_ROWS)], r.len().saturating_sub(MAX_ROWS))
}

fn block(b: &Value) -> Option<Value> {
    let b = b.as_object()?;
    let t = b.get("type").and_then(Value::as_str).filter(|t| BLOCKS.contains(t));
    let Some(t) = t else {
        return Some(json!({"type": "unknown", "name": sn(b.get("type"), 40)}));
    };
    if t == "text" {
        return Some(json!({"type": "text", "text": s(b.get("text"))}));
    }
    if t == "html" { // its own page, drawn in a sandboxed frame: see `stash` and the oniplugin: scheme in lib.rs
        let html = b.get("html").and_then(Value::as_str).map(|h| cut(h, MAX_HTML)).unwrap_or_default();
        let height = b.get("height").and_then(Value::as_f64).unwrap_or(0.0).clamp(0.0, 4000.0) as u64;
        return Some(json!({"type": "html", "html": html, "height": height, "data": b.get("data").cloned().unwrap_or(Value::Null)}));
    }
    let (rs, more) = rows(b.get(if t == "log" { "lines" } else { "rows" }));
    Some(match t {
        "log" => json!({"type": "log", "lines": rs.iter().map(|x| s(Some(x))).collect::<Vec<_>>(), "more": more}),
        "kv" => json!({"type": "kv", "more": more, "rows": rs.iter().filter_map(|r| {
            let r = r.as_array().filter(|r| !r.is_empty())?;
            Some([s(r.first()), s(r.get(1))])
        }).collect::<Vec<_>>()}),
        _ => {
            let cols: Vec<String> = list(b.get("columns")).iter().take(50).map(|c| s(Some(c))).collect();
            let out: Vec<Value> = rs.iter().filter_map(|r| {
                let cells = if r.is_object() { r.get("cells") } else { Some(r) };
                let cells = cells?.as_array()?;
                Some(json!({"id": if r.is_object() { s(r.get("id")) } else { String::new() },
                    "cells": cells.iter().take(50).map(|c| s(Some(c))).collect::<Vec<_>>()}))
            }).collect();
            let acts: Vec<String> = list(b.get("row_actions")).iter().take(MAX_ACTIONS).map(|a| s(Some(a))).collect();
            json!({"type": "table", "id": s(b.get("id")), "columns": cols, "rows": out, "more": more, "row_actions": acts})
        }
    })
}

fn param(p: &Value) -> Option<Value> {
    if !truthy(p.get("name")) {
        return None;
    }
    let opts: Vec<String> = list(p.get("options")).iter().take(100).map(|o| s(Some(o))).collect();
    let mut t = p.get("type").and_then(Value::as_str).filter(|t| PARAM_TYPES.contains(t)).unwrap_or("text");
    if t == "choice" && opts.is_empty() {
        t = "text";
    }
    let label = if truthy(p.get("label")) { p.get("label") } else { p.get("name") };
    Some(json!({"name": sn(p.get("name"), 100), "label": sn(label, 200), "type": t, "options": opts}))
}

fn action(a: &Value) -> Option<Value> {
    if !a.is_object() || !truthy(a.get("id")) {
        return None;
    }
    let label = if truthy(a.get("label")) { a.get("label") } else { a.get("id") };
    Some(json!({"id": sn(a.get("id"), 100), "label": sn(label, 200), "danger": a.get("danger") == Some(&Value::Bool(true)),
        "confirm": s(a.get("confirm")), "params": list(a.get("params")).iter().take(MAX_PARAMS).filter_map(param).collect::<Vec<_>>()}))
}

/// A view reply in the one shape the window draws: unknown keys gone, strings cut, rows capped. A reply that is
/// `{"error": ...}`, or isn't an object, comes back with `error` set and nothing else.
pub fn normalise_view(raw: &Value) -> Value {
    let Some(r) = raw.as_object() else {
        return json!({"error": "its reply isn't a JSON object"});
    };
    if truthy(r.get("error")) {
        return json!({"error": sn(r.get("error"), 500)});
    }
    let badge = r.get("badge").and_then(Value::as_object).map(|b| {
        let level = b.get("level").and_then(Value::as_str).filter(|l| LEVELS.contains(l)).unwrap_or("off");
        json!({"level": level, "text": sn(b.get("text"), 40)})
    });
    json!({"title": sn(r.get("title"), 200), "badge": badge,
        "blocks": list(r.get("blocks")).iter().filter_map(block).collect::<Vec<_>>(),
        "actions": list(r.get("actions")).iter().take(MAX_ACTIONS).filter_map(action).collect::<Vec<_>>()})
}

/// An action reply: whether it worked, what to toast, a view to replace the panel with, and the RCON commands it
/// asked for split into those Oni will send (named in the manifest's permissions, on a server in the config) and
/// `dropped`, the reasons for the rest.
pub fn normalise_action(raw: &Value, allowed: &[String], servers: &[String]) -> Value {
    let Some(r) = raw.as_object() else {
        return json!({"ok": false, "toast": "", "error": "its reply isn't a JSON object", "view": null, "rcon": [], "dropped": []});
    };
    let (mut rcon, mut dropped) = (vec![], vec![]);
    for x in list(r.get("rcon")).iter().take(50).filter(|x| x.is_object()) {
        let (cmd, server) = (sn(x.get("command"), 40), sn(x.get("server"), 200));
        let args: Vec<String> = list(x.get("args")).iter().take(20).map(|a| sn(Some(a), 500)).collect();
        if !allowed.contains(&cmd) {
            dropped.push(format!("{}: not in its permissions", if cmd.is_empty() { "a command" } else { &cmd }));
        } else if !servers.contains(&server) {
            dropped.push(format!("{cmd} on {}: no such server in the config", if server.is_empty() { "no server" } else { &server }));
        } else {
            rcon.push(json!({"server": server, "command": cmd, "args": args}));
        }
    }
    json!({"ok": r.get("ok") != Some(&Value::Bool(false)) && !truthy(r.get("error")), "toast": sn(r.get("toast"), 500),
        "error": sn(r.get("error"), 500), "view": r.get("view").filter(|v| v.is_object()).map(normalise_view),
        "rcon": rcon, "dropped": dropped})
}

// --- html blocks: pages served to their frames ------------------------------------------------------------------------
/// The page of every html block shown, by "<plug-in id>.<block index>" (a dot: the window percent-encodes a slash): the window loads it from oniplugin:, never inline.
static FRAMES: Lazy<Mutex<std::collections::HashMap<String, String>>> = Lazy::new(Default::default);

/// Move each html block's page out of a shaped view into FRAMES, leaving `src` (its path) and `v` (a hash of the page,
/// so the frame reloads only when the page changed). `data` stays in the view: the window posts it to the frame.
pub fn stash(id: &str, view: &mut Value) {
    let Some(blocks) = view.get_mut("blocks").and_then(Value::as_array_mut) else { return };
    let mut frames = FRAMES.lock();
    for (i, b) in blocks.iter_mut().enumerate().filter(|(_, b)| b["type"] == "html") {
        let html = b["html"].take().as_str().unwrap_or_default().to_string();
        b["v"] = json!(&format!("{:x}", Sha256::digest(html.as_bytes()))[..12]);
        b["src"] = json!(format!("{id}.{i}"));
        frames.insert(format!("{id}.{i}"), html);
    }
}

/// The page at a stashed path, if any.
pub fn frame(path: &str) -> Option<String> {
    FRAMES.lock().get(path).cloned()
}

// --- the demo's pretend plug-in ------------------------------------------------------------------------------------
/// A pretend Gryphon for --demo's F10, answered in this process: the same requests and replies a real plug-in sends
/// over stdin and stdout, so the tab works with nothing installed.
pub fn demo_manifest() -> Manifest {
    Manifest { id: "gryphon-demo".into(), name: "Gryphon (demo)".into(), version: "0.1.0".into(), author: "Arche Labs".into(),
        description: "Automated moderation, pretend.".into(), mode: "service".into(), exec: "(answered inside oni-rcon for the demo)".into(),
        rcon: vec!["unmute".into(), "unban".into(), "pardon".into()], ..Default::default() }
}

struct Demo {
    live: bool,
    log: Vec<String>,
    rows: Vec<(String, f64, usize, &'static str, &'static str, &'static str)>, // id, at, server, what, who, why
}

static DEMO: Lazy<Mutex<Demo>> = Lazy::new(|| {
    let now = crate::util::now();
    let rows = [(12.0, 0, "mute 10m", "Rook", "chat [hate] 'n***'"), (47.0, 1, "kick", "Static", "name [slur]"), (95.0, 0, "ban 1d", "Cinder", "chat [hate], third strike")]
        .into_iter()
        .map(|(m, s, w, n, y)| (uuid::Uuid::new_v4().simple().to_string(), now - m * 60.0, s, w, n, y))
        .collect();
    Mutex::new(Demo { live: false, log: vec!["daemon started".into(), "word list loaded: 412 words".into()], rows })
});

/// The demo's own page: an html block drawing its `data`, asking for the view's actions back.
const DEMO_PAGE: &str = r#"<!doctype html><meta charset="utf-8">
<style>
  body { margin: 0; padding: 8px 10px; font: 12.5px Consolas, ui-monospace, monospace; color: var(--white, #d6dce4); }
  h4 { margin: 0 0 6px; font-weight: normal; color: var(--amber, #d9a441); letter-spacing: .12em; }
  .row { display: grid; grid-template-columns: 70px 1fr 24px; align-items: center; gap: 8px; margin: 3px 0; }
  .bar { height: 10px; background: linear-gradient(90deg, var(--amber), var(--red)); transform-origin: left; transition: transform .5s; }
  .ask { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  input { flex: 1 1 200px; font: inherit; color: inherit; background: var(--panel, #111821); border: 1px solid var(--grey); padding: 2px 6px; }
  button { font: inherit; background: none; color: var(--cyan); border: 1px solid currentColor; padding: 2px 10px; cursor: pointer; }
  button.hot { color: var(--red); }
</style>
<h4>ACTIONS BY SERVER · THIS PAGE IS THE PLUG-IN'S OWN HTML</h4>
<div id="chart"></div>
<div class="ask"><input id="t" placeholder="check a message against the word list"><button id="c">CHECK</button><button id="mode"></button><button id="r">REFRESH</button></div>
<script>
  const send = (m) => parent.postMessage(m, "*");
  addEventListener("message", (e) => {
    const m = e.data;
    if (!m || m.oni !== "data") return;
    for (const [k, v] of Object.entries(m.theme)) document.body.style.setProperty("--" + k, v);
    const d = m.data, max = Math.max(1, ...d.per_server);
    chart.innerHTML = "";
    d.per_server.forEach((n, i) => {
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML = `<span>STATION ${i + 1}</span><div class="bar" style="transform: scaleX(${n / max})"></div><span>${n}</span>`;
      chart.append(row);
    });
    mode.textContent = d.live ? "GO DRY-RUN" : "GO LIVE";
    mode.className = d.live ? "" : "hot";
    mode.onclick = () => send({ oni: "action", id: d.live ? "go-dry" : "go-live" });
  });
  c.onclick = () => send({ oni: "action", id: "check", params: { text: t.value } }); // no <form>: the sandbox blocks submitting
  t.onkeydown = (e) => e.key === "Enter" && c.click();
  r.onclick = () => send({ oni: "refresh" });
  new ResizeObserver(() => send({ oni: "height", px: Math.ceil(document.body.getBoundingClientRect().height) + 2 })).observe(document.body);
  send({ oni: "ready" });
</script>"#;

fn demo_view(d: &Demo) -> Value {
    let hm = |t: f64| chrono::DateTime::from_timestamp(t as i64, 0).map(|x| x.with_timezone(&chrono::Local).format("%H:%M").to_string()).unwrap_or_default();
    let last = d.rows.first().map(|r| format!("{} min ago", ((crate::util::now() - r.1) / 60.0) as i64)).unwrap_or("none".into());
    json!({"title": "Gryphon", "badge": {"level": if d.live { "warn" } else { "ok" }, "text": if d.live { "LIVE" } else { "DRY-RUN" }},
        "blocks": [
            {"type": "kv", "rows": [["Mode", if d.live { "live" } else { "dry-run" }], ["Servers online", "3 / 3"], ["Last action", last]]},
            {"type": "table", "id": "actions", "columns": ["Time", "Server", "Action", "Player", "Why"], "row_actions": ["undo"],
             "rows": d.rows.iter().map(|r| json!({"id": r.0, "cells": [hm(r.1), (r.2 + 1).to_string(), r.3, r.4, r.5]})).collect::<Vec<_>>()},
            {"type": "log", "lines": d.log[d.log.len().saturating_sub(8)..]},
            {"type": "html", "html": DEMO_PAGE, "data": {"live": d.live, "per_server": (0..3).map(|s| d.rows.iter().filter(|r| r.2 == s).count()).collect::<Vec<_>>()}},
            {"type": "text", "text": "A pretend plug-in: nothing here runs as a program. See docs/PLUGINS.md for how a real one is written."}],
        "actions": [
            {"id": "check", "label": "Check a message", "params": [{"name": "text", "label": "Message", "type": "text"}]},
            if d.live { json!({"id": "go-dry", "label": "Go dry-run"}) }
            else { json!({"id": "go-live", "label": "Go live", "danger": true, "confirm": "Gryphon will really kick, mute and ban."}) }]})
}

pub async fn demo_call(request: &Value) -> Value {
    tokio::time::sleep(Duration::from_millis(200)).await; // a real one takes a moment
    let mut d = DEMO.lock();
    if request["type"] == "view" {
        return demo_view(&d);
    }
    let act = request["id"].as_str().unwrap_or_default();
    match act {
        "check" => {
            let text = request["params"]["text"].as_str().unwrap_or_default().to_lowercase();
            let hit = ["nazi", "slur"].into_iter().find(|w| text.contains(w));
            json!({"ok": true, "toast": hit.map(|w| format!("Would act: hate [{w}]")).unwrap_or("Nothing in the list matches that.".into())})
        }
        "go-live" | "go-dry" => {
            d.live = act == "go-live";
            let line = format!("mode set to {}", if d.live { "live" } else { "dry-run" });
            d.log.push(line);
            json!({"ok": true, "toast": if d.live { "Gryphon is live." } else { "Gryphon is in dry-run." }, "view": demo_view(&d)})
        }
        "undo" => match d.rows.iter().position(|r| Some(r.0.as_str()) == request["row"].as_str()) {
            Some(i) => {
                let r = d.rows.remove(i);
                d.log.push(format!("undid {} on {}", r.3, r.4));
                let cmd = if r.3.starts_with("mute") { "unmute" } else if r.3.starts_with("ban") { "unban" } else { "pardon" };
                let ask = if request["server"].is_string() { json!([{"server": request["server"], "command": cmd, "args": [r.4]}]) } else { json!([]) };
                json!({"ok": true, "toast": format!("Undid {}'s {}.", r.4, r.3.split(' ').next().unwrap_or_default()), "rcon": ask})
            }
            None => json!({"ok": false, "error": "pick a row first"}),
        },
        _ => json!({"ok": false, "error": format!("no action '{act}'")}),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plugin(dir: &Path, id: &str, manifest: &str) -> PathBuf {
        let f = dir.join(id);
        std::fs::create_dir_all(&f).unwrap();
        std::fs::write(f.join(MANIFEST), manifest).unwrap();
        f
    }

    const GOOD: &str = "api = 1\nname = \"Echo\"\n[run]\nexec = \"python echo.py\"\n[permissions]\nrcon = [\"say\"]\n";

    #[test]
    fn discovery_reads_only_named_folders_and_lists_bad_ones_with_why() { // golden 2, 5, 6
        let d = tempfile::tempdir().unwrap();
        plugin(d.path(), "echo", GOOD);
        plugin(d.path(), "other", GOOD);
        plugin(d.path(), "newer", "api = 2\nname = \"N\"\n[run]\nexec = \"x\"\n");
        plugin(d.path(), "broken", "api = = 1");
        plugin(d.path(), "session", "api = 1\nname = \"S\"\n[run]\nmode = \"session\"\nexec = \"x\"\n");
        let ids: Vec<String> = ["echo", "newer", "broken", "session", "../up", "missing", "echo"].map(String::from).into();
        let got = discover(Some(d.path()), &ids);
        assert_eq!(got.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), ["echo", "newer", "broken", "session", "../up", "missing"]);
        assert_eq!(got[0].error, "");
        assert_eq!((got[0].name.as_str(), got[0].rcon.clone()), ("Echo", vec!["say".to_string()]));
        assert!(got[1].error.contains("needs plug-in api 2"));
        assert!(got[2].error.contains("isn't valid TOML"));
        assert!(got[3].error.contains("session plug-ins"));
        assert!(got[4].error.contains("lower-case"));
        assert!(got[5].error.contains("no oni-plugin.toml"));
    }

    #[test]
    fn trust_is_the_manifest_hash_and_a_change_asks_again() { // golden 3, 4
        let d = tempfile::tempdir().unwrap();
        let f = plugin(d.path(), "echo", GOOD);
        let m = load(&f);
        assert_eq!(state(&m, &json!({})), "needs approval");
        assert_eq!(state(&m, &json!({"echo": m.hash})), "");
        std::fs::write(f.join(MANIFEST), format!("{GOOD}\n")).unwrap();
        assert_eq!(state(&load(&f), &json!({"echo": m.hash})), "needs approval");
    }

    #[test]
    fn a_view_is_shaped_unknown_blocks_named_and_caps_kept() { // golden 7, 8, 13
        let v = normalise_view(&json!({"title": "T", "extra": 1, "badge": {"level": "boom", "text": "x"}, "blocks": [
            {"type": "chart"}, 5, {"type": "text", "text": "[b]plain[/b]"},
            {"type": "table", "columns": ["A"], "rows": (0..600).map(|i| json!({"id": i, "cells": [i]})).collect::<Vec<_>>(), "row_actions": ["go"]},
            {"type": "kv", "rows": [["k", 1], [], "x"]}, {"type": "log", "lines": ["a".repeat(20_000)]}],
            "actions": [{"id": "a", "params": [{"name": "c", "type": "choice"}, {"type": "text"}]}, {"label": "no id"}]}));
        assert_eq!(v["badge"], json!({"level": "off", "text": "x"}));
        assert!(v.get("extra").is_none());
        assert_eq!(v["blocks"][0], json!({"type": "unknown", "name": "chart"}));
        assert_eq!(v["blocks"][1]["text"], "[b]plain[/b]");
        assert_eq!((v["blocks"][2]["rows"].as_array().unwrap().len(), &v["blocks"][2]["more"]), (500, &json!(100)));
        assert_eq!(v["blocks"][2]["rows"][1], json!({"id": "1", "cells": ["1"]}));
        assert_eq!(v["blocks"][3]["rows"], json!([["k", "1"]]));
        assert_eq!(v["blocks"][4]["lines"][0].as_str().unwrap().len(), MAX_STR);
        assert_eq!(v["actions"], json!([{"id": "a", "label": "a", "danger": false, "confirm": "", "params": [{"name": "c", "label": "c", "type": "text", "options": []}]}]));
        assert_eq!(normalise_view(&json!({"error": "down"})), json!({"error": "down"}));
        let mut h = normalise_view(&json!({"blocks": [{"type": "text"}, {"type": "html", "html": "<b>hi</b>".repeat(100_000), "height": 9e9, "data": {"n": 1}}]}));
        assert_eq!((h["blocks"][1]["html"].as_str().unwrap().len(), &h["blocks"][1]["height"], &h["blocks"][1]["data"]), (MAX_HTML, &json!(4000), &json!({"n": 1})));
        stash("echo", &mut h);
        assert_eq!((&h["blocks"][1]["html"], &h["blocks"][1]["src"], h["blocks"][1]["v"].as_str().unwrap().len()), (&Value::Null, &json!("echo.1"), 12));
        assert_eq!(frame("echo.1").unwrap().len(), MAX_HTML);
        assert_eq!(normalise_view(&json!([1])), json!({"error": "its reply isn't a JSON object"}));
    }

    #[test]
    fn rcon_outside_its_permissions_or_the_config_is_dropped() { // golden 15, 16, 18
        let r = normalise_action(&json!({"ok": true, "rcon": [{"server": "A", "command": "say", "args": ["hi", 2]},
            {"server": "A", "command": "ban"}, {"server": "Z", "command": "say"}]}), &["say".into()], &["A".into()]);
        assert_eq!(r["rcon"], json!([{"server": "A", "command": "say", "args": ["hi", "2"]}]));
        assert_eq!(r["dropped"], json!(["ban: not in its permissions", "say on Z: no such server in the config"]));
        let r = normalise_action(&json!({"error": "nope"}), &[], &[]);
        assert_eq!((r["ok"].clone(), r["error"].clone()), (json!(false), json!("nope")));
    }

    #[tokio::test]
    async fn a_real_one_runs_in_its_folder_and_failures_are_words() { // golden 1, 9, 10, 11, 12
        let d = tempfile::tempdir().unwrap();
        let py = if crate::util::which("python").is_some() { "python" } else { "python3" };
        let f = plugin(d.path(), "echo", GOOD);
        std::fs::write(f.join("echo.py"), "import sys,json\nr=json.loads(sys.stdin.readline())\nprint(json.dumps({'title': r['type'], 'here': __import__('os').path.exists('echo.py')}))\n").unwrap();
        let mut m = load(&f);
        m.exec = format!("{py} echo.py");
        assert_eq!(call(&m, &json!({"type": "view"}), 10.0).await.unwrap(), json!({"title": "view", "here": true}));
        m.exec = format!("{py} -c \"import sys; print('boom at 10.0.0.1', file=sys.stderr); sys.exit(3)\"");
        assert_eq!(call(&m, &json!({}), 10.0).await.unwrap_err(), "boom at [ip]");
        m.exec = format!("{py} -c \"print('hello')\"");
        assert_eq!(call(&m, &json!({}), 10.0).await.unwrap_err(), "its reply isn't JSON");
        m.exec = format!("{py} -c \"import sys; sys.exit(4)\"");
        assert_eq!(call(&m, &json!({}), 10.0).await.unwrap_err(), "exited 4");
        m.exec = format!("{py} -c \"import time; time.sleep(5)\"");
        assert_eq!(call(&m, &json!({}), 0.5).await.unwrap_err(), "no answer in 0.5s");
    }

    #[tokio::test]
    async fn the_demo_undoes_a_row_and_asks_for_permitted_rcon() {
        let v = demo_call(&json!({"type": "view"})).await;
        let row = v["blocks"][1]["rows"][0]["id"].clone();
        let r = demo_call(&json!({"type": "action", "id": "undo", "row": row, "server": "127.0.0.1:1"})).await;
        let n = normalise_action(&r, &demo_manifest().rcon, &["127.0.0.1:1".into()]);
        assert_eq!((n["rcon"][0]["command"].clone(), n["dropped"].clone()), (json!("unmute"), json!([])));
        assert_eq!(n["rcon"][0]["args"], json!(["Rook"])); // the player, not the row's id
    }
}
