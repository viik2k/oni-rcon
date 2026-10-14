// What the buttons and keys do: each one a small dialog flow, the same as the terminal console's, ending in a
// command on the selected station.
import { invoke } from "@tauri-apps/api/core";
import { DIM, TEAM_COLOR, TEAMS, WHITE, AMBER, CYAN } from "./art/palette";
import { oni, type Station } from "./engine";
import { num, pick, redactText, targetOf, type Dict, type Line } from "./lib/util";

export const BAN_TIMES: [string, string][] = [["Permanent", ""], ["30 minutes", "30m"], ["2 hours", "2h"], ["12 hours", "12h"], ["1 day", "1d"], ["7 days", "7d"], ["2 weeks", "2w"], ["30 days", "30d"]];
export const MUTE_TIMES: [string, string][] = [["Until restart", ""], ["10 minutes", "10m"], ["1 hour", "1h"], ["12 hours", "12h"], ["1 day", "1d"]];
export const COMMANDS = ["status", "players", "say", "tell", "kick", "ban", "banip", "unban", "bans", "vpn", "vpnallow", "vpnrevoke", "mute", "unmute",
  "endround", "endgame", "maps", "modes", "map", "mode", "load", "nextmap", "servername", "password", "maxping", "teamcount", "shuffle", "team",
  "vote", "startvote", "passvote", "cancelvote", "admin", "admins", "pardon", "help"];

export const OPS: [string, string, string][] = [["load", "LOAD MAP+MODE", "primary"], ["map", "CHANGE MAP", ""], ["mode", "CHANGE MODE", ""],
  ["nextmap", "QUEUE NEXT", ""], ["endround", "END ROUND", "warning"], ["endgame", "END GAME", "error"], ["shuffle", "SHUFFLE TEAMS", ""],
  ["teamcount", "TEAM COUNT", ""], ["startvote", "CALL VOTE", ""], ["passvote", "PASS VOTE", "success"], ["cancelvote", "CANCEL VOTE", ""],
  ["broadcast", "BROADCAST", "primary"], ["servername", "RENAME", ""], ["password", "JOIN PASSWORD", ""], ["maxping", "PING LIMIT", ""], ["capacity", "PLAYER CAPACITY", ""],
  ["playlist", "SWITCH PLAYLIST", ""], ["newplaylist", "NEW PLAYLIST", ""], ["newgametype", "NEW GAME TYPE", ""], ["reconnect", "RECONNECT", ""], ["restart", "RESTART SERVER", "error"]];
export const OP_GROUPS: [string, string[]][] = [["MATCH", ["load", "map", "mode", "nextmap", "endround", "endgame"]],
  ["TEAMS & VOTES", ["shuffle", "teamcount", "startvote", "passvote", "cancelvote"]], ["SERVER", ["broadcast", "servername", "password", "maxping", "capacity", "playlist", "newplaylist", "newgametype", "reconnect", "restart"]]];
export const BAN_OPS: [string, string, string][] = [["newban", "NEW BAN", "error"], ["unban", "UNBAN  u", "warning"], ["vpnallow", "VPN ALLOW  a", ""],
  ["vpnrevoke", "VPN REVOKE  r", ""], ["vpncheck", "CHECK IP", ""], ["adminadd", "ADD ADMIN  p", "primary"], ["adminremove", "REMOVE ADMIN  d", "warning"]];
export const PLAYER_OPS: [string, string, string][] = [["tell", "TELL", "t"], ["kick", "KICK", "k"], ["ban", "BAN", "b"], ["mute", "MUTE", "m"],
  ["team", "TEAM", "j"], ["vpnallow", "VPN OK", "v"], ["admin", "MAKE ADMIN", "p"], ["copy", "COPY ID", "y"]];

// What each control does, in plain words: shown when the mouse rests on it.
export const TIPS: Record<string, string> = {
  "op-load": "Pick a map and a mode and switch to them now. Ends the current game.",
  "op-map": "Switch to another map, keeping the current mode. Ends the current game.",
  "op-mode": "Switch to another mode, keeping the current map. Ends the current game.",
  "op-nextmap": "Choose what plays after this game, without interrupting it.",
  "op-endround": "End this round as if its time ran out.",
  "op-endgame": "End the whole game now, with the scores as they stand.",
  "op-shuffle": "Mix the players up across the teams.",
  "op-teamcount": "Spread the players over 2 to 8 teams.",
  "op-startvote": "Ask the players to vote: end the round, shuffle, kick someone, and more.",
  "op-passvote": "Pass the vote that's under way, whatever the count.",
  "op-cancelvote": "Call off the vote that's under way.",
  "op-broadcast": "Send a [Server] message to everyone in this or every server.  Ctrl+B",
  "op-servername": "Change the name in the server browser, until the server restarts.",
  "op-password": "Make players type a password to join (or remove it).",
  "op-maxping": "Stop players with a high ping from joining.",
  "op-capacity": "How many players the server takes at once. Saved in its dedicated.toml, so it holds after a restart and needs one.",
  "op-reconnect": "Drop this connection and sign in again.",
  "op-playlist": "Pick the playlist the server plays, from its playlists folder or installed from F6. Saved in its dedicated.toml, so it needs a restart.",
  "op-newplaylist": "Make a playlist from the server's own maps and modes: three games at least, that players vote between. Saved in its playlists folder.",
  "op-newgametype": "Make a game type: a base mode with its score, teams, time, rounds, lives, respawn and shields. Saved in the server's content folder, Game Modes.",
  "op-restart": "Restart the server itself: everyone is dropped and it comes back in a minute or so. Needs restart_cmd in the config (setup adds it).",
  "bl-newban": "Ban a player ID, an IP address or a whole range.",
  "bl-unban": "Lift the selected ban.  Key: u",
  "bl-vpnallow": "Let a player or address join through a VPN.  Key: a",
  "bl-vpnrevoke": "Take back the selected VPN allowance.  Key: r",
  "bl-vpncheck": "Check whether an address looks like a VPN.",
  "bl-adminadd": "Make a player an admin on every server sharing this ban list, at once.  Key: p",
  "bl-adminremove": "Take admin away from the selected one. Admins written in dedicated.toml are changed there.  Key: d",
  "pl-tell": "Send a private message only they can see.  Key: t",
  "pl-kick": "Remove them from the game. They can rejoin after a short wait.  Key: k",
  "pl-ban": "Keep them out, for a while or for good.  Key: b",
  "pl-mute": "Silence their text and voice chat (or lift it).  Key: m",
  "pl-team": "Move them to another team.  Key: j",
  "pl-vpnallow": "Let them join through a VPN.  Key: v",
  "pl-admin": "Make them an admin (or take it away) on every server sharing the ban list, at once.  Key: p",
  "pl-copy": "Copy their player ID, for a ban list or a report.  Key: y",
  "add-server": "Add another server with the setup screen.",
  "super": "The Superintendent watches every server's feed and reacts: it welcomes a join, startles at a call for an admin, scowls at a cheat flag, approves a kick or ban, is impressed by a medal and unimpressed by a mute.",
  "fg-install": "Put the selected version on this server, every file checked against Forge's manifest.  Key: i",
  "fg-load": "Load the installed map or gametype now, once the server lists it. Ends the current game.  Key: l",
  "fg-ack": "Say you've seen that it was withdrawn: CONDITION goes back to GREEN. It stays flagged.  Key: a",
  "fg-key": "Load your own ReclaimerForge API key.  Key: k",
  "fg-more": "Fetch the next page of the catalog.  Key: n",
};
export const TAB_TIPS: Record<string, string> = {
  assets: "Players on the selected server: click one for their file and actions.",
  intercepts: "Live chat, kills, joins and moderation from every server, and a box to talk back.",
  operations: "Change the map or mode, end rounds, run votes, and server settings.",
  blacklist: "Bans, players allowed to join through a VPN, and admins.",
  console: "Type server commands directly. For when a button doesn't cover it.",
  forge: "The ReclaimerForge catalog: community maps, gametypes and playlists for your servers.",
  health: "Crashes read from each server's log, the host's memory, and whether the workaround service runs.",
};

const opt = (v: string) => (v ? [v] : []);

export function entries(st: Station, what: string): [Line, string][] {
  return (st.data[what]?.entries ?? []).map((e: Dict) => [
    [[String(pick(e, "name") ?? "?"), WHITE], [`  ${e.kind ?? ""}`, DIM], [`  ${e.reference ?? ""}`, DIM]] as Line,
    String(pick(e, "reference", "name")),
  ]);
}

export async function broadcast() {
  const f = await oni.form("BROADCAST", [["text", "Message ([Server] line in chat)", ""],
    ["scope", "Transmit to", [["Every station", "all"], [`${oni.cur.label} only`, "one"]]]], { verb: "TRANSMIT", required: ["text"] });
  if (!f) return;
  const targets = (f.scope === "all" ? oni.stations : [oni.cur]).filter((s) => s.online);
  if (targets.length) oni.fanout(targets, "say", [f.text]);
  if (targets.length < 2)
    oni.notify(targets.length ? `Transmitted to ${targets[0].label}.` : "Not connected: nothing was sent.", "BROADCAST", targets.length ? "information" : "warning");
}

export async function player(what: string, p: Dict | undefined) {
  const st = oni.cur;
  if (!p) return oni.notify("No asset selected.", "", "warning");
  const t = targetOf(p), name = String(pick(p, "name") ?? "?");
  if (what === "copy") return oni.copy(t, "PLAYER ID COPIED");
  if (what === "tell") {
    const f = await oni.form(`TELL · ${name}`, [["text", "Message (only they see it)", ""]], { verb: "SEND", required: ["text"] });
    if (f) oni.send(st, "tell", [t, f.text]);
  } else if (what === "kick") {
    const f = await oni.form(`KICK · ${name}`, [["reason", "Reason (they read it)", ""]], { verb: "KICK", danger: true, note: "Repeat kicks block rejoining for 10, 30, 60, then 120 minutes." });
    if (f) oni.send(st, "kick", [t, ...opt(f.reason)], ["players", "status"]);
  } else if (what === "ban") {
    const f = await oni.form(`BAN · ${name}`, [["time", "Duration", BAN_TIMES], ["reason", "Reason", ""]], { verb: "BAN", danger: true,
      note: "Bans their player ID, address and device together, on every server sharing this ban list." });
    if (f) oni.send(st, "ban", [t, ...opt(f.time), ...opt(f.reason)], ["players", "status", "bans"]);
  } else if (what === "mute") {
    if (p.muted) return oni.send(st, "unmute", [t], ["players"]);
    const f = await oni.form(`MUTE · ${name}`, [["time", "Duration", MUTE_TIMES], ["reason", "Reason", ""]], { verb: "MUTE", note: "Silences their text and voice chat. Rejoining keeps it." });
    if (f) oni.send(st, "mute", [t, ...opt(f.time), ...opt(f.reason)], ["players"]);
  } else if (what === "team") {
    const team = await oni.pick(`MOVE ${name} TO`, TEAMS.map((c) => [[[c.toUpperCase(), TEAM_COLOR[c]]], c]));
    if (team) oni.send(st, "team", [t, team], ["players"]);
  } else if (what === "admin") {
    const sub = p.admin ? "remove" : "add";
    if (await oni.confirm(`${p.admin ? "REMOVE ADMIN" : "MAKE ADMIN"} · ${name}`, ADMIN_NOTE[sub], p.admin ? "REMOVE" : "MAKE ADMIN", !!p.admin))
      oni.send(st, "admin", [sub, t], ["players", "admins"]);
  } else if (what === "vpnallow") {
    const f = await oni.form(`VPN ALLOW · ${name}`, [["note", "Note (why)", ""]], { verb: "ALLOW", note: "Lets them join through a VPN on every server sharing the ban list." });
    if (f) oni.send(st, "vpnallow", [t, ...opt(f.note)], ["vpn"]);
  }
}

/** A dedicated.toml setting saved, then the restart it needs offered. */
async function saveSetting(st: Station, key: string, value: unknown, what: string, saved: string): Promise<void> {
  try {
    await invoke("server_setting", { index: st.index, key, value });
  } catch (e) {
    return oni.notify(String(e), `${what} NOT SAVED · ${st.label}`, "error", 15);
  }
  if (st.canRestart) return op("restart");
  return oni.notify(`Saved: ${saved} once the server restarts.`, `${what} · ${st.label}`);
}

const BASE_MODES: [string, string][] = [["Slayer", "Slayer"], ["Capture the Flag", "CaptureTheFlag"], ["Oddball", "Oddball"], ["King of the Hill", "KingOfTheHill"],
  ["VIP", "Vip"], ["Juggernaut", "Juggernaut"], ["Territories", "Territories"], ["Assault", "Assault"], ["Infection", "Infection"], ["Escalation Slayer", "EscalationSlayer"]];
const GAME_OPTIONS: [string, string][] = [["rounds.minutes", "minutes"], ["rounds.limit", "rounds"], ["respawn.lives", "lives"], ["respawn.seconds", "respawn"]];

/** NEW GAME TYPE: a base mode and the options most changed; any left blank stay the mode's own. */
async function newGameType(st: Station): Promise<void> {
  const f = await oni.form("NEW GAME TYPE", [["name", "Name (up to 48 characters)", ""], ["mode", "Built on", BASE_MODES],
    ["teams", "Teams", [["The mode's own", ""], ["Teams", "1"], ["Free for all", "0"]]], ["score", "Score to win (0 = no limit)", ""],
    ["minutes", "Time limit in minutes, 0 to 60 (0 = none)", ""], ["rounds", "Rounds, 1 to 10", ""], ["lives", "Lives per round, 0 to 50 (0 = unlimited)", ""],
    ["respawn", "Respawn delay in seconds, 0 to 240", ""], ["shields", "Shields", [["The mode's own", ""], ["None", "1"]]]],
    { verb: "SAVE", required: ["name"], note: "Blank fields keep the mode's own. It's saved in the server's content folder, Game Modes." });
  if (!f) return;
  const options: Dict = {};
  for (const [k, field] of [["rounds.teams", "teams"], ["player.shields", "shields"], ...GAME_OPTIONS]) if (f[field] !== "") options[k] = Number(f[field]);
  const args = { index: st.index, name: f.name, mode: f.mode, scoreToWin: f.score === "" ? null : Number(f.score), options };
  let path: string;
  try {
    let r = await invoke<Dict>("save_game_type", { ...args, replace: false });
    if (r.exists) {
      if (!(await oni.confirm("REPLACE GAME TYPE", `${r.path} is there already.`, "REPLACE"))) return;
      r = await invoke<Dict>("save_game_type", { ...args, replace: true });
    }
    path = r.path;
  } catch (e) {
    return oni.notify(String(e), `GAME TYPE NOT SAVED · ${st.label}`, "error", 15);
  }
  if (st.online) await oni.fetchNow(st, ["modes"]);
  const listed = (st.data.modes?.entries ?? []).some((e: Dict) => String(e.reference ?? "").endsWith(path.split("/").pop()!) || e.name === f.name);
  const how = listed ? "CHANGE MODE plays it, and NEW PLAYLIST can use it." : "The server picks it up when it restarts; then CHANGE MODE plays it.";
  oni.notify(`Saved as ${path}. ${how}`, `GAME TYPE · ${st.label}`, "information", 12);
}

/** NEW PLAYLIST: a name, then a map and a mode a game at a time from the server's own lists. */
async function newPlaylist(st: Station): Promise<void> {
  const maps = entries(st, "maps"), modes = entries(st, "modes");
  if (!maps.length || !modes.length) return oni.notify("Map and mode lists not loaded yet.", "", "warning");
  const f = await oni.form("NEW PLAYLIST", [["name", "Name (shown in the lobby)", ""], ["vote", "Seconds players get to vote (5 to 120)", "20"]],
    { verb: "PICK GAMES", required: ["name", "vote"], note: "Then its games, a map and a mode each: three at least, each once." });
  if (!f) return;
  const games: [string, string][] = [];
  for (;;) {
    const n = games.length + 1, done: [Line, string][] = games.length >= 3 ? [[[[`✓ DONE: save these ${games.length} games`, AMBER]], ""]] : [];
    // ponytail: the server's own map and mode references, taken as what its playlists name them by
    const mp = await oni.pick(`GAME ${n} · SELECT MAP`, [...done, ...maps]);
    if (mp === "") break;
    if (mp === null) {
      if (!games.length || (await oni.confirm("DISCARD PLAYLIST", `Its ${games.length} game${games.length > 1 ? "s" : ""} so far are thrown away.`, "DISCARD"))) return;
      continue;
    }
    const md = await oni.pick(`GAME ${n} · ${mp} · SELECT MODE`, modes);
    if (!md) continue;
    if (games.some(([a, b]) => a === mp && b === md)) oni.notify(`${mp} / ${md} is in it already.`, "", "warning");
    else games.push([mp, md]);
  }
  const args = { index: st.index, name: f.name, voteSeconds: Number(f.vote), games };
  let path: string;
  try {
    let r = await invoke<Dict>("save_playlist", { ...args, replace: false });
    if (r.exists) {
      if (!(await oni.confirm("REPLACE PLAYLIST", `${r.path} is there already.`, "REPLACE"))) return;
      r = await invoke<Dict>("save_playlist", { ...args, replace: true });
    }
    path = r.path;
  } catch (e) {
    return oni.notify(String(e), `PLAYLIST NOT SAVED · ${st.label}`, "error", 15);
  }
  if (await oni.confirm(`SWITCH TO  ${f.name}`, `Saved as ${path}. Put the server on it now?`, "SWITCH", false)) return saveSetting(st, "playlist", path, "PLAYLIST", path);
  oni.notify(`Saved as ${path}: SWITCH PLAYLIST puts the server on it.`, `PLAYLIST · ${st.label}`);
}

export async function op(name: string) {
  const st = oni.cur, s = st.data.status ?? {};
  if (name === "broadcast") return broadcast();
  if (name === "reconnect") {
    let pw: string | undefined;
    if (st.state === "denied" || oni.waiting.includes(st.index)) {
      const f = await oni.form("RETRY SIGN-IN", [["pw", "RCON password", ""]], { verb: "RETRY", required: ["pw"], secret: ["pw"],
        note: "This station refused the password. Five wrong passwords in ten minutes lock your address out for up to ten minutes." });
      if (!f) return;
      pw = f.pw;
      oni.waiting = oni.waiting.filter((i) => i !== st.index);
    }
    return oni.reconnect(st, pw);
  }
  if (name === "restart") {
    if (!(await oni.confirm(`RESTART  ${st.label}`, "Everyone on it is dropped and the game starts over; it's back in a minute or so. Servers sharing its container or window restart with it, and what was changed from here (name, join password, ping limit) goes back to dedicated.toml's.", "RESTART", true))) return;
    oni.notify("Restarting… the console reconnects by itself.", `RESTART · ${st.label}`, "warning");
    return invoke("restart_server", { index: st.index }).then(() => oni.notify("Restarted.", `RESTART · ${st.label}`),
      (e) => oni.notify(String(e), `RESTART FAILED · ${st.label}`, "error", 15));
  }
  if (name === "capacity") {
    const f = await oni.form("PLAYER CAPACITY", [["n", "Most players at once (1 to 63)", String(s.max_players ?? "")]], { verb: "SAVE", required: ["n"],
      note: "Saved in the server's dedicated.toml: it takes effect when the server restarts." });
    if (f) return saveSetting(st, "max_players", Number(f.n), "CAPACITY", `${f.n} players`);
    return;
  }
  if (name === "newgametype") return newGameType(st);
  if (name === "playlist") {
    let files: string[];
    try {
      files = await invoke<string[]>("playlists", { index: st.index });
    } catch (e) {
      return oni.notify(String(e), `PLAYLISTS · ${st.label}`, "error", 15);
    }
    // ponytail: Forge installs into the content folder, taken as dedicated.toml's default "content"
    for (const e of Object.values<Dict>(oni.forgeState.servers?.[st.where] ?? {}))
      if (e.kind === "playlist" && e.files?.[0]?.path) files.push(`content/${e.files[0].path}`);
    if (!files.length) return oni.notify("No playlists in the server's playlists folder yet: NEW PLAYLIST makes one, or install one from F6.", `PLAYLISTS · ${st.label}`, "warning");
    const got = await oni.pick("SWITCH PLAYLIST", files.map((f) => [f, f]));
    if (got) return saveSetting(st, "playlist", got, "PLAYLIST", got);
    return;
  }
  if (!st.online) return oni.notify(`${st.label} is not connected.`, "", "warning");
  if (name === "newplaylist") return newPlaylist(st);
  if (["load", "map", "mode", "nextmap"].includes(name)) {
    let mp = "", md = "";
    if (name !== "mode") {
      const maps = entries(st, "maps");
      if (!maps.length) return oni.notify("Map list not loaded yet.", "", "warning");
      const got = await oni.pick("SELECT MAP", maps);
      if (!got) return;
      mp = got;
    }
    if (name !== "map") {
      let modes = entries(st, "modes");
      if (name === "nextmap") modes = [[[["(keep the current rules)", DIM]], ""], ...modes];
      const got = await oni.pick("SELECT MODE", modes);
      if (got === null || (name !== "nextmap" && !got)) return;
      md = got;
    }
    const args = [mp, md].filter(Boolean);
    if (name !== "nextmap" && !(await oni.confirm(`${name.toUpperCase()}  ${args.join(" / ")}`, "Ends the current game for everyone on this station; the new one starts in the next lobby."))) return;
    oni.send(st, name, args, ["status", "nextmap"]);
  } else if (["endround", "endgame", "shuffle"].includes(name)) {
    const body = ({ endround: "Ends the round as if its time ran out.", endgame: "Ends the game with the scores as they stand.",
      shuffle: "Shuffles players across the teams that have players." } as Dict)[name];
    if (await oni.confirm(name.toUpperCase(), body, "EXECUTE", name !== "shuffle")) oni.send(st, name, [], ["status", "players"]);
  } else if (name === "teamcount") {
    const n = await oni.pick("SPREAD PLAYERS OVER", [2, 3, 4, 5, 6, 7, 8].map((i) => [`${i} teams`, String(i)]));
    if (n) oni.send(st, "teamcount", [n], ["players"]);
  } else if (name === "startvote") {
    const subjects: string[] = st.data.vote?.subjects ?? ["endround", "endgame", "shuffle", "kick", "playlist"];
    const subj = await oni.pick("CALL A VOTE", subjects.map((x) => [x.toUpperCase(), x]));
    if (!subj) return;
    const args = [subj];
    if (subj === "kick") {
      const w = await oni.pick("VOTE TO KICK", st.players.map((p) => [String(pick(p, "name")), targetOf(p)]));
      if (!w) return;
      args.push(w);
    }
    oni.send(st, "startvote", args, ["vote"]);
  } else if (name === "passvote" || name === "cancelvote") {
    oni.send(st, name, [], ["vote"]);
  } else if (name === "servername") {
    const f = await oni.form("RENAME STATION", [["name", "Server name (until restart)", String(s.name ?? "")]], { verb: "RENAME", required: ["name"] });
    if (f) oni.send(st, "servername", [f.name], ["status"]);
  } else if (name === "password") {
    const f = await oni.form("JOIN PASSWORD", [["pw", "Password players need (empty = open server)", ""]], { verb: "SET", note: "Lasts until restart. Doesn't touch the RCON password." });
    if (f) oni.send(st, "password", [f.pw], ["status"]);
  } else if (name === "maxping") {
    const f = await oni.form("PING LIMIT", [["ms", "Highest join ping in ms, up to 1000 (off = none)", String(s.max_ping || "off")]], { verb: "SET", required: ["ms"] });
    if (f) oni.send(st, "maxping", [f.ms], ["status"]);
  }
}

const ADMIN_NOTE = {
  add: "They can kick, ban and move players in game, and can't be vote-kicked. It applies at once on every server sharing this ban list.",
  remove: "Applies at once on every server sharing this ban list. An admin written in dedicated.toml can't be removed from here.",
};

export async function bl(name: string, ban?: string | null, vpn?: string | null, admin?: string | null) {
  const st = oni.cur;
  if (!st.online) return oni.notify(`${st.label} is not connected.`, "", "warning");
  if (name === "newban") {
    const f = await oni.form("BAN BY ID OR ADDRESS", [["target", "Player ID, IP address or range (CIDR)", ""], ["time", "Duration", BAN_TIMES], ["reason", "Reason", ""]],
      { verb: "BAN", danger: true, required: ["target"] });
    if (f) oni.send(st, "ban", [f.target, ...opt(f.time), ...opt(f.reason)], ["bans"]);
  } else if (name === "unban" || name === "vpnrevoke") {
    const target = name === "unban" ? ban : vpn;
    if (!target) return oni.notify("Select an entry first.", "", "warning");
    if (await oni.confirm(`${name.toUpperCase()}  ${redactText(target, oni.redact)}`, "Lifts it together with its linked entries, on every server sharing the ban list.", name.toUpperCase(), false))
      oni.send(st, name, [target], ["bans", "vpn"]);
  } else if (name === "vpnallow") {
    const f = await oni.form("VPN ALLOW", [["target", "Player ID, IP address or range", ""], ["note", "Note", ""]], { verb: "ALLOW", required: ["target"] });
    if (f) oni.send(st, "vpnallow", [f.target, ...opt(f.note)], ["vpn"]);
  } else if (name === "adminadd") {
    const choices: [Line | string, string][] = st.players.filter((p) => !p.admin).map((p) => [String(pick(p, "name") ?? "?"), targetOf(p)]);
    const who = await oni.pick("MAKE ADMIN", [...choices, [[["Someone not on: type their player ID…", DIM]], "?"]]);
    if (!who) return;
    let target = who;
    if (who === "?") {
      const f = await oni.form("MAKE ADMIN", [["id", "Player ID", ""]], { verb: "MAKE ADMIN", required: ["id"], note: ADMIN_NOTE.add });
      if (!f) return;
      target = f.id.trim();
    } else if (!(await oni.confirm("MAKE ADMIN", ADMIN_NOTE.add, "MAKE ADMIN", false))) return;
    oni.send(st, "admin", ["add", target], ["admins", "players"]);
  } else if (name === "adminremove") {
    if (!admin) return oni.notify("Select an admin first.", "", "warning");
    if (await oni.confirm(`REMOVE ADMIN  ${admin}`, ADMIN_NOTE.remove, "REMOVE"))
      oni.send(st, "admin", ["remove", admin], ["admins", "players"]);
  } else if (name === "vpncheck") {
    const f = await oni.form("CHECK AN ADDRESS", [["ip", "IP address", ""]], { verb: "CHECK", required: ["ip"] });
    if (f) oni.send(st, "vpn", [f.ip]);
  }
}

/** Every station in a list to type into, the ones with players first: 1 to 9 only reach so far. */
export async function goto() {
  const order = (s: Station) => [s.online ? 0 : 1, -(num(s.data.status?.players) ?? 0), s.index];
  const sorted = [...oni.stations].sort((a, b) => {
    const x = order(a), y = order(b);
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  });
  const row = (s: Station): Line => {
    const st = s.data.status ?? {}, n = num(st.players), mx = num(st.max_players);
    const [g, c] = STATE[s.state] ?? STATE.connecting;
    return [[`${g} `, c], [`${String(s.index + 1).padStart(3)}  `, DIM], [s.online && n !== undefined ? `${n}/${mx}  ` : "", n ? AMBER : DIM],
      [s.label, WHITE], [s.tag ? `  ${s.tag}` : "", CYAN], [s.online ? `  ${String(st.map ?? "").replace(/_/g, " ")}` : `  ${oni.why(s)}`, DIM]];
  };
  const i = await oni.pick("GO TO STATION", sorted.map((s) => [row(s), String(s.index)]));
  if (i !== null) oni.select(Number(i));
}

export const STATE: Record<string, [string, string]> = { online: ["◉", "#5FB98A"], connecting: ["◌", "#D9A441"], offline: ["○", "#E5484D"], denied: ["⊘", "#E5484D"] };

export async function addServer(onSetup: () => void) {
  if (await oni.confirm("ADD A SERVER", "Opens the setup screen. Connections close while you're there and reopen when you come back.", "OPEN SETUP", false)) {
    await invoke("setup_open");
    oni.stop();
    onSetup();
  }
}

export async function askPassword() {
  if (!oni.waiting.length) return;
  const f = await oni.form("RCON PASSWORD", [["pw", "Used for every server without its own", ""]], { verb: "CONNECT", required: ["pw"], secret: ["pw"],
    note: `${oni.waiting.length} server${oni.waiting.length === 1 ? " has" : "s have"} no password in the config, $ONI_RCON_PASSWORD or a password_command.` });
  if (!f) return;
  await invoke("set_password", { password: f.pw, indices: oni.waiting });
  oni.waiting = [];
}

export function sayText(text: string) {
  text = text.trim();
  const all = text.startsWith("@all ");
  const targets = (all ? oni.stations : [oni.cur]).filter((s) => s.online);
  text = text.replace(/^@all /, "").trim();
  if (text && targets.length) oni.fanout(targets, "say", [text]);
  if (text && !targets.length) oni.notify("Not connected: nothing was sent.", "", "warning");
}
