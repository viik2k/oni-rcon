//! Automation rules' storage and Discord. The rules and roles live in automation.json beside the config; Discord
//! webhook URLs live in discord.json (owner-only) and never reach the window, which only sees them masked and posts
//! by name. From ibigs/oni-rcon's rules_store.py and rules_run.py, by RifleJock.
use crate::{config, util};
use serde_json::{json, Map, Value};
use std::path::PathBuf;
use std::sync::OnceLock;

const MAX_WEBHOOKS: usize = 25;
const MAX_FILE: usize = 2_000_000;

fn rules_path() -> PathBuf {
    config::user_config().with_file_name("automation.json")
}

fn hooks_path() -> PathBuf {
    config::user_config().with_file_name("discord.json")
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

/// The rules, the roles, and the webhook names with their URLs masked.
#[tauri::command]
pub fn automation_load() -> Value {
    let f = read(&rules_path());
    let hooks: Map<String, Value> = hooks().into_iter().map(|(k, v)| (k, json!(masked(v.as_str().unwrap_or_default())))).collect();
    json!({"rules": if f["rules"].is_array() { f["rules"].clone() } else { json!([]) }, "roles": if f["roles"].is_object() { f["roles"].clone() } else { json!({}) }, "webhooks": hooks})
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
    if name.is_empty() || name.len() > 32 || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("Name it with letters, numbers, - or _ (up to 32), like alerts.".into());
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
    let c = reqwest::Client::builder()
        .user_agent(format!("oni-rcon/{}", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.without_url().to_string())?;
    c.post(url).json(&body).send().await.map(|r| r.status().as_u16()).map_err(|e| e.without_url().to_string())
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
}
