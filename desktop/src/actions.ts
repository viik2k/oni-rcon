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
  "vote", "startvote", "passvote", "cancelvote", "help"];

export const OPS: [string, string, string][] = [["load", "LOAD MAP+MODE", "primary"], ["map", "CHANGE MAP", ""], ["mode", "CHANGE MODE", ""],
  ["nextmap", "QUEUE NEXT", ""], ["endround", "END ROUND", "warning"], ["endgame", "END GAME", "error"], ["shuffle", "SHUFFLE TEAMS", ""],
  ["teamcount", "TEAM COUNT", ""], ["startvote", "CALL VOTE", ""], ["passvote", "PASS VOTE", "success"], ["cancelvote", "CANCEL VOTE", ""],
  ["broadcast", "BROADCAST", "primary"], ["servername", "RENAME", ""], ["password", "JOIN PASSWORD", ""], ["maxping", "PING LIMIT", ""],
  ["reconnect", "RECONNECT", ""]];
export const OP_GROUPS: [string, string[]][] = [["MATCH", ["load", "map", "mode", "nextmap", "endround", "endgame"]],
  ["TEAMS & VOTES", ["shuffle", "teamcount", "startvote", "passvote", "cancelvote"]], ["SERVER", ["broadcast", "servername", "password", "maxping", "reconnect"]]];
export const BAN_OPS: [string, string, string][] = [["newban", "NEW BAN", "error"], ["unban", "UNBAN  u", "warning"], ["vpnallow", "VPN ALLOW  a", ""],
  ["vpnrevoke", "VPN REVOKE  r", ""], ["vpncheck", "CHECK IP", ""]];
export const PLAYER_OPS: [string, string, string][] = [["tell", "TELL", "t"], ["kick", "KICK", "k"], ["ban", "BAN", "b"], ["mute", "MUTE", "m"],
  ["team", "TEAM", "j"], ["vpnallow", "VPN OK", "v"], ["copy", "COPY ID", "y"]];

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
  "op-reconnect": "Drop this connection and sign in again.",
  "bl-newban": "Ban a player ID, an IP address or a whole range.",
  "bl-unban": "Lift the selected ban.  Key: u",
  "bl-vpnallow": "Let a player or address join through a VPN.  Key: a",
  "bl-vpnrevoke": "Take back the selected VPN allowance.  Key: r",
  "bl-vpncheck": "Check whether an address looks like a VPN.",
  "pl-tell": "Send a private message only they can see.  Key: t",
  "pl-kick": "Remove them from the game. They can rejoin after a short wait.  Key: k",
  "pl-ban": "Keep them out, for a while or for good.  Key: b",
  "pl-mute": "Silence their text and voice chat (or lift it).  Key: m",
  "pl-team": "Move them to another team.  Key: j",
  "pl-vpnallow": "Let them join through a VPN.  Key: v",
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
  blacklist: "Bans, and players allowed to join through a VPN.",
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
  } else if (what === "vpnallow") {
    const f = await oni.form(`VPN ALLOW · ${name}`, [["note", "Note (why)", ""]], { verb: "ALLOW", note: "Lets them join through a VPN on every server sharing the ban list." });
    if (f) oni.send(st, "vpnallow", [t, ...opt(f.note)], ["vpn"]);
  }
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
  if (!st.online) return oni.notify(`${st.label} is not connected.`, "", "warning");
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

export async function bl(name: string, ban?: string | null, vpn?: string | null) {
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
