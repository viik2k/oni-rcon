//! Automation rules' storage, Discord and Telegram. The rules and roles live in automation.json beside the config;
//! Discord webhook URLs live in discord.json and Telegram bot tokens in telegram.json (both owner-only) and never reach
//! the window, which only sees them masked and posts by name. From ibigs/oni-rcon's rules_store.py and rules_run.py, by
//! RifleJock; the Telegram half is new.
use crate::{config, util};
use serde_json::{json, Map, Value};
use std::path::PathBuf;
use std::sync::OnceLock;

const MAX_WEBHOOKS: usize = 25;
const MAX_CHATS: usize = 25;
const TELEGRAM_API: &str = "https://api.telegram.org";
const NAME_HELP: &str = "Name it with letters, numbers, - or _ (up to 32), like alerts.";
const MAX_FILE: usize = 2_000_000;

fn rules_path() -> PathBuf {
    config::user_config().with_file_name("automation.json")
}

fn hooks_path() -> PathBuf {
    config::user_config().with_file_name("discord.json")
}

fn chats_path() -> PathBuf {
    config::user_config().with_file_name("telegram.json")
}

fn name_ok(name: &str) -> bool {
    !name.is_empty() && name.len() <= 32 && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn read(path: &PathBuf) -> Value {
    std::fs::read_to_string(path).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_else(|| json!({}))
}

/// The shape Discord hands out: https://discord.com/api/webhooks/<id>/<token>.
fn webhook_ok(url: &str) -> bool {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    RE.get_or_init(|| regex::Regex::new(r"^https://(?:(?:ptb|canary)\.)?discord(?:app)?\.com/api/webhooks/\d{5,30}/[A-Za-z0-9_-]{20,100}$").unwrap()).is_match(url)
}

/// The URL with its secret part hidden, for the screen.
fn masked(url: &str) -> String {
    format!("{}/••••••", url.rsplit_once('/').map_or(url, |(head, _)| head))
}

fn hooks() -> Map<String, Value> {
    read(&hooks_path()).as_object().cloned().unwrap_or_default()
}

fn save_hooks(h: &Map<String, Value>) -> Result<(), String> {
    util::write_atomic(&hooks_path(), &format!("{}\n", serde_json::to_string_pretty(&Value::Object(h.clone())).unwrap()), true).map_err(|e| format!("couldn't save the Discord webhooks: {e}"))
}

/// The shape @BotFather hands out: the bot's number, a colon, and the secret.
fn token_ok(t: &str) -> bool {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    RE.get_or_init(|| regex::Regex::new(r"^\d{5,16}:[A-Za-z0-9_-]{30,64}$").unwrap()).is_match(t)
}

/// A chat Telegram takes: its number (negative for a group or channel) or a public channel's @name.
fn chat_ok(c: &str) -> bool {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    RE.get_or_init(|| regex::Regex::new(r"^(?:-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$").unwrap()).is_match(c)
}

/// The bot's number (not secret) and the chat, with the token's secret part hidden, for the screen.
fn chat_masked(token: &str, chat: &str) -> String {
    format!("{}:•••••• → {chat}", token.split(':').next().unwrap_or_default())
}

fn chats() -> Map<String, Value> {
    read(&chats_path()).as_object().cloned().unwrap_or_default()
}

fn save_chats(c: &Map<String, Value>) -> Result<(), String> {
    util::write_atomic(&chats_path(), &format!("{}\n", serde_json::to_string_pretty(&Value::Object(c.clone())).unwrap()), true).map_err(|e| format!("couldn't save the Telegram chats: {e}"))
}

/// The rules, the roles, and the webhook and Telegram chat names with their secrets masked.
#[tauri::command]
pub fn automation_load() -> Value {
    let f = read(&rules_path());
    let hooks: Map<String, Value> = hooks().into_iter().map(|(k, v)| (k, json!(masked(v.as_str().unwrap_or_default())))).collect();
    let chats: Map<String, Value> = chats().into_iter().map(|(k, v)| (k, json!(chat_masked(v["token"].as_str().unwrap_or_default(), v["chat"].as_str().unwrap_or_default())))).collect();
    json!({"rules": if f["rules"].is_array() { f["rules"].clone() } else { json!([]) }, "roles": if f["roles"].is_object() { f["roles"].clone() } else { json!({}) }, "webhooks": hooks, "telegram": chats})
}

/// The window has already checked each rule against the catalog; this only keeps the file the right shape and size.
#[tauri::command]
pub fn automation_save(rules: Value, roles: Value) -> Result<(), String> {
    if !rules.is_array() || !roles.is_object() {
        return Err("Rules are a list and roles a table.".into());
    }
    let text = serde_json::to_string_pretty(&json!({"schema": 1, "rules": rules, "roles": roles})).unwrap();
    if text.len() > MAX_FILE {
        return Err("The rules file would be too large.".into());
    }
    util::write_atomic(&rules_path(), &format!("{text}\n"), false).map_err(|e| format!("couldn't save the rules: {e}"))
}

#[tauri::command]
pub fn discord_add(name: String, url: String) -> Result<(), String> {
    let (name, url) = (name.trim().to_lowercase(), url.trim().to_string());
    if !name_ok(&name) {
        return Err(NAME_HELP.into());
    }
    if !webhook_ok(&url) {
        return Err("That doesn't look like a Discord webhook URL (https://discord.com/api/webhooks/…).".into());
    }
    let mut h = hooks();
    if !h.contains_key(&name) && h.len() >= MAX_WEBHOOKS {
        return Err(format!("{MAX_WEBHOOKS} webhooks is the limit."));
    }
    h.insert(name, json!(url));
    save_hooks(&h)
}

#[tauri::command]
pub fn discord_remove(name: String) -> Result<(), String> {
    let mut h = hooks();
    h.remove(&name);
    save_hooks(&h)
}

/// One message to a webhook, by name; the HTTP status comes back. Nothing in an error carries the URL.
#[tauri::command]
pub async fn discord_post(name: String, text: String, app: tauri::State<'_, crate::App>) -> Result<u16, String> {
    let url = hooks().get(&name).and_then(|v| v.as_str().map(String::from)).ok_or_else(|| format!("no webhook called {name}"))?;
    if *app.demo.lock() {
        return Ok(204); // the pretend servers never post to a real channel
    }
    let body = json!({"content": text.chars().take(2000).collect::<String>(), "username": "ONI RCON", "allowed_mentions": {"parse": []}});
    client()?.post(url).json(&body).send().await.map(|r| r.status().as_u16()).map_err(|e| e.without_url().to_string())
}

/// For posting out: no redirects (a secret in a URL goes nowhere else) and a short timeout.
fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(format!("oni-rcon/{}", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.without_url().to_string())
}

#[tauri::command]
pub fn telegram_add(name: String, token: String, chat: String) -> Result<(), String> {
    let (name, token, chat) = (name.trim().to_lowercase(), token.trim().to_string(), chat.trim().to_string());
    if !name_ok(&name) {
        return Err(NAME_HELP.into());
    }
    if !token_ok(&token) {
        return Err("That doesn't look like a bot token (123456789:ABC…). @BotFather hands it out.".into());
    }
    if !chat_ok(&chat) {
        return Err("A chat is its number (like -1001234567890) or a public channel's @name.".into());
    }
    let mut c = chats();
    if !c.contains_key(&name) && c.len() >= MAX_CHATS {
        return Err(format!("{MAX_CHATS} chats is the limit."));
    }
    c.insert(name, json!({"token": token, "chat": chat}));
    save_chats(&c)
}

#[tauri::command]
pub fn telegram_remove(name: String) -> Result<(), String> {
    let mut c = chats();
    c.remove(&name);
    save_chats(&c)
}

/// One message to a saved chat, by name; the HTTP status comes back. Nothing in an error carries the token.
#[tauri::command]
pub async fn telegram_post(name: String, text: String, app: tauri::State<'_, crate::App>) -> Result<u16, String> {
    let c = chats();
    let (token, chat) = c.get(&name).and_then(|v| Some((v["token"].as_str()?.to_string(), v["chat"].as_str()?.to_string()))).ok_or_else(|| format!("no chat called {name}"))?;
    if *app.demo.lock() {
        return Ok(200); // the pretend servers never post to a real chat
    }
    send_message(TELEGRAM_API, &token, &chat, &text).await
}

/// The bot behind a token and the chats it has lately heard from, so a chat's number needn't be dug out by hand.
/// Reading them confirms nothing with Telegram, so they stay there for the next look.
#[tauri::command]
pub async fn telegram_find_chats(token: String) -> Result<Value, String> {
    find_chats(TELEGRAM_API, token.trim()).await
}

/// One Bot API call. The token is part of the URL, so no error leaves here with a URL in it.
async fn bot_call(base: &str, token: &str, method: &str, body: &Value) -> Result<(u16, Value), String> {
    let r = client()?.post(format!("{base}/bot{token}/{method}")).json(body).send().await.map_err(|e| e.without_url().to_string())?;
    let status = r.status().as_u16();
    Ok((status, r.json::<Value>().await.unwrap_or(Value::Null)))
}

/// What a lookup call came to: its result, or a sentence saying what to do about it.
fn answer(status: u16, v: &Value) -> Result<Value, String> {
    match status {
        200..=299 if v["ok"] == true => Ok(v["result"].clone()),
        401 | 404 => Err("Telegram refused that token. It should be the whole line @BotFather gave you, like 123456789:ABC…".into()),
        409 => Err("That bot has a webhook set, so its messages can't be read here. Type the chat ID instead.".into()),
        _ => Err(format!("Telegram answered {status}{}", v["description"].as_str().map(|d| format!(": {d}")).unwrap_or_default())),
    }
}

/// Plain text only (no formatting to break on a player's name), no link previews, at most the 4096 characters Telegram takes.
async fn send_message(base: &str, token: &str, chat: &str, text: &str) -> Result<u16, String> {
    let chat_id = chat.parse::<i64>().map_or_else(|_| json!(chat), |n| json!(n));
    let body = json!({"chat_id": chat_id, "text": text.chars().take(4096).collect::<String>(), "link_preview_options": {"is_disabled": true}});
    bot_call(base, token, "sendMessage", &body).await.map(|(status, _)| status)
}

async fn find_chats(base: &str, token: &str) -> Result<Value, String> {
    if !token_ok(token) {
        return Err("That doesn't look like a bot token (123456789:ABC…). @BotFather hands it out.".into());
    }
    let (status, v) = bot_call(base, token, "getMe", &json!({})).await?;
    let bot = answer(status, &v)?["username"].as_str().map_or_else(|| "your bot".to_string(), |u| format!("@{u}"));
    let (status, v) = bot_call(base, token, "getUpdates", &json!({"limit": 100, "timeout": 0, "allowed_updates": ["message", "edited_message", "channel_post", "edited_channel_post", "my_chat_member"]})).await?;
    Ok(json!({"bot": bot, "chats": chats_from(&answer(status, &v)?)}))
}

/// Each distinct chat in a batch of updates, the newest first: its number and a label for the picker.
fn chats_from(updates: &Value) -> Vec<Value> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for u in updates.as_array().into_iter().flatten().rev() {
        for key in ["message", "edited_message", "channel_post", "edited_channel_post", "my_chat_member"] {
            let c = &u[key]["chat"];
            let Some(id) = c["id"].as_i64() else { continue };
            if !seen.insert(id) || out.len() >= 20 {
                continue;
            }
            let who = c["title"].as_str().map(String::from).unwrap_or_else(|| [c["first_name"].as_str(), c["last_name"].as_str()].into_iter().flatten().collect::<Vec<_>>().join(" "));
            let who = if who.is_empty() { c["username"].as_str().map_or_else(|| "(unnamed)".to_string(), |n| format!("@{n}")) } else { who };
            let label: String = format!("{who} ({})", c["type"].as_str().unwrap_or("chat")).chars().filter(|ch| !ch.is_control()).take(60).collect();
            out.push(json!({"id": id.to_string(), "label": label}));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn webhooks_are_checked_and_masked() {
        let ok = "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_-ABCDEF";
        assert!(webhook_ok(ok) && webhook_ok(&ok.replace("discord.com", "ptb.discord.com")));
        for bad in ["http://discord.com/api/webhooks/123456/abcdefghijklmnopqrstuvwxyz", "https://evil.com/api/webhooks/123456/abcdefghijklmnopqrstuvwxyz", "https://discord.com/api/webhooks/12/short", "https://discord.com.evil.com/api/webhooks/123456/abcdefghijklmnopqrstuvwxyz"] {
            assert!(!webhook_ok(bad), "{bad}");
        }
        assert_eq!(masked(ok), "https://discord.com/api/webhooks/123456789012345678/••••••");
    }

    const TOKEN: &str = "123456789:AAH-secretSECRETsecret_SECRETsecret12";

    #[test]
    fn tokens_and_chats_are_checked_and_masked() {
        assert!(token_ok(TOKEN));
        for bad in ["", "123456789", "123456789:short", "abc:AAH-secretSECRETsecret_SECRETsecret12", "123456789:AAH-secretSECRETsecret_SECRETsecret12/../x", "https://api.telegram.org/bot123456789:AAH-secretSECRETsecret_SECRETsecret12"] {
            assert!(!token_ok(bad), "{bad}");
        }
        for ok in ["-1001234567890", "123456789", "@oni_alerts"] {
            assert!(chat_ok(ok), "{ok}");
        }
        for bad in ["", "-", "12a", "@a", "@1abcdef", "oni_alerts", "@oni alerts", "-100 1", "@oni_alerts/../x"] {
            assert!(!chat_ok(bad), "{bad}");
        }
        let m = chat_masked(TOKEN, "-1001234567890");
        assert_eq!(m, "123456789:•••••• → -1001234567890");
        assert!(!m.contains("secret"));
        assert!(name_ok("alerts-2_x") && !name_ok("") && !name_ok("a b") && !name_ok(&"a".repeat(33)));
    }

    #[test]
    fn chats_come_from_updates_newest_first_without_repeats() {
        let updates = json!([
            {"update_id": 1, "message": {"chat": {"id": 42, "type": "private", "first_name": "Ann", "last_name": "Lee", "username": "ann"}}},
            {"update_id": 2, "my_chat_member": {"chat": {"id": -1001, "type": "supergroup", "title": "Ops\u{7}room"}}},
            {"update_id": 3, "message": {"chat": {"id": 42, "type": "private", "first_name": "Ann"}}},
            {"update_id": 4, "channel_post": {"chat": {"id": -1002, "type": "channel", "username": "oni_news"}}},
            {"update_id": 5, "callback_query": {"id": "x"}},
        ]);
        let got: Vec<(String, String)> = chats_from(&updates).iter().map(|c| (c["id"].as_str().unwrap().into(), c["label"].as_str().unwrap().into())).collect();
        assert_eq!(got, [("-1002".into(), "@oni_news (channel)".into()), ("42".into(), "Ann (private)".into()), ("-1001".into(), "Opsroom (supergroup)".into())]);
        assert!(chats_from(&Value::Null).is_empty() && chats_from(&json!([])).is_empty());
    }

    use axum::{extract::Path, routing::post, Json, Router};
    use std::sync::Arc;

    /// A stand-in for the Bot API on a local port: it answers each method with the given status and body, and keeps what it was asked.
    async fn fake(replies: Vec<(&'static str, u16, Value)>) -> (String, Arc<parking_lot::Mutex<Vec<(String, Value)>>>) {
        let (log, replies) = (Arc::new(parking_lot::Mutex::new(Vec::new())), Arc::new(replies));
        let app = Router::new().route("/{*rest}", post({
            let log = log.clone();
            move |Path(rest): Path<String>, Json(body): Json<Value>| {
                let (log, replies) = (log.clone(), replies.clone());
                async move {
                    log.lock().push((rest.clone(), body));
                    let (code, v) = replies.iter().find(|(m, _, _)| rest.ends_with(m)).map_or((404, json!({})), |(_, c, v)| (*c, v.clone()));
                    (axum::http::StatusCode::from_u16(code).unwrap(), Json(v))
                }
            }
        }));
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", l.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(l, app).await.unwrap() });
        (base, log)
    }

    #[tokio::test]
    async fn a_message_goes_out_as_plain_text_to_the_chat() {
        let (base, log) = fake(vec![("sendMessage", 200, json!({"ok": true, "result": {}}))]).await;
        assert_eq!(send_message(&base, TOKEN, "-1001234567890", &"x".repeat(5000)).await, Ok(200));
        assert_eq!(send_message(&base, TOKEN, "@oni_alerts", "hi").await, Ok(200));
        let log = log.lock();
        assert_eq!(log[0].0, format!("bot{TOKEN}/sendMessage"));
        assert_eq!(log[0].1["chat_id"], json!(-1001234567890_i64));
        assert_eq!(log[0].1["text"].as_str().unwrap().len(), 4096);
        assert_eq!(log[0].1["link_preview_options"], json!({"is_disabled": true}));
        assert!(log[0].1.get("parse_mode").is_none());
        assert_eq!(log[1].1["chat_id"], json!("@oni_alerts"));
    }

    #[tokio::test]
    async fn a_refusal_comes_back_as_its_status() {
        let (base, _) = fake(vec![("sendMessage", 403, json!({"ok": false, "description": "Forbidden: bot was kicked from the group chat"}))]).await;
        assert_eq!(send_message(&base, TOKEN, "-100", "hi").await, Ok(403));
    }

    #[tokio::test]
    async fn an_error_never_carries_the_token() {
        let port = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port(); // free, and nothing listens on it
        let base = format!("http://127.0.0.1:{port}");
        for e in [send_message(&base, TOKEN, "-100", "hi").await.unwrap_err(), find_chats(&base, TOKEN).await.unwrap_err()] {
            assert!(!e.contains("secret") && !e.contains(TOKEN) && !e.contains("/bot"), "{e}");
        }
    }

    #[tokio::test]
    async fn chats_are_found_from_what_the_bot_has_heard() {
        let updates = json!([{"update_id": 1, "message": {"chat": {"id": -1001, "type": "group", "title": "Ops"}}}]);
        let (base, log) = fake(vec![("getMe", 200, json!({"ok": true, "result": {"username": "oni_bot"}})), ("getUpdates", 200, json!({"ok": true, "result": updates}))]).await;
        let got = find_chats(&base, TOKEN).await.unwrap();
        assert_eq!(got, json!({"bot": "@oni_bot", "chats": [{"id": "-1001", "label": "Ops (group)"}]}));
        let log = log.lock();
        assert!(log[1].1.get("offset").is_none(), "reading must not confirm the updates away");
    }

    #[tokio::test]
    async fn a_bad_token_or_a_webhook_says_what_to_do() {
        assert!(find_chats("http://unused", "nope").await.unwrap_err().contains("doesn't look like a bot token"));
        let (base, _) = fake(vec![("getMe", 401, json!({"ok": false, "description": "Unauthorized"}))]).await;
        assert!(find_chats(&base, TOKEN).await.unwrap_err().contains("refused that token"));
        let (base, _) = fake(vec![("getMe", 200, json!({"ok": true, "result": {}})), ("getUpdates", 409, json!({"ok": false, "description": "Conflict: can't use getUpdates method while webhook is active"}))]).await;
        assert!(find_chats(&base, TOKEN).await.unwrap_err().contains("webhook"));
        let (base, _) = fake(vec![("getMe", 502, json!({"ok": false, "description": "Bad Gateway"}))]).await;
        assert_eq!(find_chats(&base, TOKEN).await.unwrap_err(), "Telegram answered 502: Bad Gateway");
    }
}
