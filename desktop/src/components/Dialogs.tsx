// Dialogs: a confirm whose safe choice is the default, a form, a filterable pick list, the field manual and the
// command palette. Titles and bodies are plain text: player names and server text never become markup.
import { useEffect, useMemo, useRef, useState } from "react";
import { AMBER, CYAN, DIM, WHITE } from "../art/palette";
import { emblem } from "../art/archive";
import { oni, useV, type Dialog } from "../engine";
import { CREDIT } from "../lib/forge";
import { plain, type Dict, type Line } from "../lib/util";
import { L, Pixel } from "./ui";

const Keys = ({ hints }: { hints: string[] }) => <div className="keys">{hints.join("   ·   ")}</div>;

function Confirm({ d }: { d: Dialog }) {
  const { title, body, verb, danger } = d.props;
  const no = useRef<HTMLButtonElement>(null);
  useEffect(() => no.current?.focus(), []);
  return (
    <div className={`dialog ${danger ? "danger" : ""}`} onKeyDown={(e) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const bs = [...(e.currentTarget.querySelectorAll(".btns button") as NodeListOf<HTMLButtonElement>)];
        bs[(bs.indexOf(document.activeElement as HTMLButtonElement) + 1) % bs.length]?.focus();
      }
    }}>
      <div className="dt">{title}</div>
      <div className="db">{body}</div>
      <div className="btns">
        <button ref={no} className="btn" onClick={() => d.resolve(false)}>ABORT</button>
        <button className={`btn ${danger ? "error" : "primary"}`} onClick={() => d.resolve(true)}>{verb}</button>
      </div>
      <Keys hints={["Esc cancel", "← → choose", "Enter confirm"]} />
    </div>
  );
}

function Form({ d }: { d: Dialog }) {
  const { title, fields, verb = "OK", danger, note, required = [], secret = [] } = d.props as Dict;
  const [vals, setVals] = useState<Dict>(() => Object.fromEntries(fields.map(([k, , def]: [string, string, unknown]) => [k, Array.isArray(def) ? def[0][1] : String(def)])));
  const [missing, setMissing] = useState("");
  const first = useRef<HTMLInputElement | HTMLSelectElement>(null);
  useEffect(() => first.current?.focus(), []);
  const submit = () => {
    const out: Dict = {};
    for (const [k] of fields) out[k] = secret.includes(k) ? vals[k] : String(vals[k]).trim();
    const gap = required.find((k: string) => !out[k]);
    if (gap) {
      setMissing(gap);
      document.getElementById(`field-${gap}`)?.focus();
      setTimeout(() => setMissing(""), 600);
      return;
    }
    d.resolve(out);
  };
  return (
    <div className={`dialog ${danger ? "danger" : ""}`}>
      <div className="dt">{title}</div>
      {note ? <div className="db">{note}</div> : null}
      {fields.map(([k, label, def]: [string, string, unknown], i: number) => (
        <div key={k}>
          <label htmlFor={`field-${k}`}>{label}{required.includes(k) ? "  (required)" : ""}</label>
          {Array.isArray(def) ? (
            <select id={`field-${k}`} ref={i === 0 ? (first as any) : undefined} className={`input ${missing === k ? "missing" : ""}`} value={vals[k]}
              onChange={(e) => setVals({ ...vals, [k]: e.target.value })} onKeyDown={(e) => e.key === "Enter" && submit()}>
              {def.map(([l, v]: [string, string]) => <option key={v} value={v}>{l}</option>)}
            </select>
          ) : (
            <input id={`field-${k}`} ref={i === 0 ? (first as any) : undefined} className={`input ${missing === k ? "missing" : ""}`} value={vals[k]}
              type={secret.includes(k) ? "password" : "text"} spellCheck={false} autoComplete="off"
              onChange={(e) => setVals({ ...vals, [k]: e.target.value })} onKeyDown={(e) => e.key === "Enter" && submit()} />
          )}
        </div>
      ))}
      <div className="btns">
        <button className="btn" onClick={() => d.resolve(null)}>ABORT</button>
        <button className={`btn ${danger ? "error" : "primary"}`} onClick={submit}>{verb}</button>
      </div>
      <Keys hints={["Esc cancel", "Tab next field", `Enter ${String(verb).toLowerCase()}`]} />
    </div>
  );
}

function Pick({ d }: { d: Dialog }) {
  const { title, options } = d.props as { title: string; options: [Line | string, string][] };
  const [text, setText] = useState("");
  const [cur, setCur] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const filter = useRef<HTMLInputElement>(null);
  const shown = useMemo(() => {
    const t = text.toLowerCase();
    return options.filter(([l, v]) => (typeof l === "string" ? l : plain(l)).toLowerCase().includes(t) || v.toLowerCase().includes(t));
  }, [options, text]);
  useEffect(() => (options.length > 8 ? filter.current : list.current)?.focus(), [options.length]);
  useEffect(() => setCur(0), [text]);
  useEffect(() => { list.current?.children[cur]?.scrollIntoView({ block: "nearest" }); }, [cur]);
  const key = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setCur((c) => Math.min(shown.length - 1, c + 1)); list.current?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCur((c) => Math.max(0, c - 1)); }
    else if (e.key === "Enter" && shown[cur]) d.resolve(shown[cur][1]);
  };
  return (
    <div className="dialog" onKeyDown={key}>
      <div className="dt">{title}</div>
      {options.length > 8 ? <input ref={filter} className="input" placeholder="type to filter…" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} /> : null}
      <div className="picklist" ref={list} tabIndex={0}>
        {shown.map(([l, v], i) => (
          <div key={v + i} className={i === cur ? "cur" : undefined} onMouseEnter={() => setCur(i)} onClick={() => d.resolve(v)}>
            {typeof l === "string" ? l : <L line={l} />}
          </div>
        ))}
      </div>
      <Keys hints={["Esc cancel", "↑ ↓ move", "Enter or click to choose"]} />
    </div>
  );
}

const GUIDE: [string, [string, string][]][] = [
  ["GETTING AROUND", [
    ["Servers", "Your servers are on the left. Click one, or press 1 to 9. A green ◉ is connected; a red ○ says why it isn't, and retries by itself."],
    ["Go to", "g lists every server, the busiest first: type part of a name and press Enter."],
    ["Tabs", "F1 to F7, or click the names along the top."],
    ["Anything", "Ctrl+P opens a searchable list of every action. Rest the mouse on a button to see what it does."],
    ["Superintendent", "The green face on the left, on every tab, watches every server's feed. It welcomes a join, startles at a call for an admin, scowls at a cheat flag, approves a kick or ban, is impressed by a medal and unimpressed by a mute; the word beside it says how it feels."],
  ]],
  ["F1  ASSETS  ·  the players", [
    ["Pick a player", "Click a row, or move with ↑ ↓. Their file opens on the right, with buttons to tell, kick, ban, mute, move, allow them through a VPN or make them an admin."],
    ["Ping", "PING is what a player joined with, read from the server's log (needs ping_log in the config; RCON has no live ping). Over 200 is red."],
    ["Keys", "t tell  ·  k kick  ·  b ban  ·  m mute  ·  j team  ·  v VPN allow  ·  p make admin (or remove)  ·  y copy their ID"],
    ["Flags", "ADM an admin  ·  MUT muted  ·  KIA dead right now  ·  NEW just joined  ·  ★5 on a killing spree"],
    ["Their file", "The glyph is drawn from their player ID: the same player always gets the same one. Medals and their streak count what this console has seen since it connected."],
  ]],
  ["F2  INTERCEPTS  ·  what's happening", [
    ["The feed", "Chat, kills, joins, kicks and bans from every server, newest at the bottom. Scroll up to read back; it holds still until you press End."],
    ["Talk back", "Type in the box at the bottom to chat as [Server]. Start with @all to reach every server: they go out a few at a time, and the command log tallies how it went."],
    ["Medals", "Kills carry their Halo 3 medals as they happen: double kill and up, sprees, killjoys."],
    ["Alerts", "Chat asking for an admin, or naming a cheat, pops up, plays the Superintendent chime and turns the CONDITION at the top red. Servers you aren't looking at show a ⚑ count until you open them or this feed."],
  ]],
  ["F3  OPERATIONS  ·  running the match", [
    ["Buttons", "Change map or mode, queue what plays next, end the round, shuffle teams, run votes, broadcast, and server settings. Anything that ends a game asks first."],
    ["Credit", "When the map or gametype playing came from ReclaimerForge, the sitrep's FORGE line names it and whoever made it."],
    ["Capacity", "PLAYER CAPACITY saves how many players the server takes in its dedicated.toml (the one beside content_dir), then offers to restart it so it applies."],
    ["Playlist", "SWITCH PLAYLIST sets which playlist the server plays (one in the server folder's playlists/, or one installed from F6) in its dedicated.toml, in place of a fixed map and game, then offers to restart it."],
    ["New playlist", "NEW PLAYLIST names a playlist and the seconds players get to vote, then takes its games a map and a mode at a time from the server's own lists (three at least, each once; Esc on the map asks before throwing them away), saves it in the server's playlists/ and offers to switch to it."],
    ["New game type", "NEW GAME TYPE builds one on a base mode (Slayer, Capture the Flag, Oddball, King of the Hill, VIP, Juggernaut, Territories, Assault, Infection, Escalation Slayer) with its score, teams, time limit, rounds, lives, respawn delay and shields; blank fields keep the mode's own. It's saved in the server's content folder, Game Modes, and played with CHANGE MODE once the server lists it."],
    ["Restart", "RESTART SERVER runs the server's restart_cmd from the config (setup writes it): everyone is dropped and the console reconnects once it's back."],
  ]],
  ["F4  BLACKLIST  ·  bans", [["Lists", "Every ban by player, address and device, who may join through a VPN, and the admins. Pick a row, then UNBAN, REVOKE or REMOVE ADMIN."],
    ["Admins", "ADD ADMIN (p) makes a player an admin and REMOVE ADMIN (d) takes it away, at once, on every server sharing the ban list: no restart. ADD ADMIN can instead make them an admin of this server only, written to its dedicated.toml from the next restart; REMOVE ADMIN takes one out of there the same way. Admins can kick, ban and move players in game and can't be vote-kicked. Reclaimer has one kind of admin: no roles. Needs server 0.9.16 or later."]]],
  ["F5  CONSOLE  ·  typing commands", [["Commands", "For anything without a button. Type help for the server's list; ↑ ↓ bring back earlier ones."]]],
  ["F6  FORGE  ·  community content", [
    ["The catalog", "Maps, gametypes and playlists from ReclaimerForge. s changes the order, w the time window trending and rising count over, and / searches. Pick one for its file and its versions; n fetches more. RATING is thumbs up and down. FAVOURITES is what ReclaimerForge is featuring now."],
    ["Install", "i puts the selected version on this server. Every file is checked against Forge's manifest before it's copied into the server's content_dir and again once it's there, and replacing anything asks first. ◉ marks what's installed here; ▲ means a newer version is out."],
    ["Load now", "l loads an installed map or gametype, once the server lists it. Installing never loads anything by itself."],
    ["Updates", "Every few minutes oni-rcon asks Forge what changed among what you've installed. A new version gets a toast and ▲. A withdrawn listing, or the very version you installed, is flagged ⚠ in the F3 rotation and on F6, and turns the CONDITION amber until you acknowledge it: s to INSTALLED HERE, pick it, then a."],
    ["Publish", "p puts your own files on Forge: pick them, fill in one form, and they're uploaded and published, or nothing is left behind. MINE (s) lists what's yours: u publishes a new version, e edits the listing, x withdraws the selected version, and DELETE LISTING takes it all down. It needs the write scopes on your key and a verified email."],
    ["Your key", "Forge takes your own API key: k loads one. It's only ever sent to reclaimerforge.net, and it never reaches the window."],
    ["Thanks", CREDIT],
  ]],
  ["F7  HEALTH  ·  crashes and memory", [
    ["Crashes", "Each server's last crashes, read from its log: SIGNATURE is the known crash (an exception with its code and RVA), BARE is the engine probe failing with no exception, OOM-KILL is a container killed for memory, and CONTAINER-RESTART is one that started again. PLAYERS is how many were on. DROPPED means the RCON connection fell at the same moment."],
    ["Host", "Free memory (amber under twice health_min_free_mb, red under it), swap, the kernel's oom_kill counter, and each container's start time and OOMKilled flag."],
    ["Workaround", "Whether the named systemd service is running, when it last moved a tag, and any warning that the build isn't the pinned one. Hidden without health_service."],
    ["Frame rate", "The server logs each minute it spent under 54 frames a second; a minute without that line counts as 60. FRAME RATE gives each server's rate now (FPS), over 5 minutes, its worst, its longest frame and how many players were on; pick one for FRAME TIME, the last 30 minutes with WHAT'S HAPPENING and WHAT TO DO in plain words. A lagging server's card shows its rate and the feed says once when it drops under 40. Needs health_cmd to print the server's log. docs/SERVER-PERFORMANCE.md has the long version."],
    ["Alerts", "A new crash, or memory falling under the limit, flashes a banner over every tab (click it away), goes in the F2 feed and plays the Superintendent chime."],
    ["Turning it on", "Set health_cmd in the config: this tab says how when it's off. Ctrl+R reads everything now."],
  ]],
  ["SAFETY", [
    ["Addresses", "Player IPs are hidden. Press x to show them, and again to hide them before you stream."],
    ["Confirming", "Risky actions ask first, and the safe choice (ABORT) is already selected."],
    ["Passwords", "A refused password is never retried by itself: five wrong tries lock you out. RECONNECT on F3 asks for it again."],
  ]],
];

function Help({ d }: { d: Dialog }) {
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => body.current?.focus(), []);
  return (
    <div className="dialog wide" onKeyDown={(e) => (e.key === "?" || e.key === "q") && d.resolve(null)}>
      <div className="dt">FIELD MANUAL</div>
      <div ref={body} tabIndex={0} style={{ overflowY: "auto", flex: 1, outline: "none" }}>
        <div style={{ display: "flex", gap: 24, alignItems: "center", marginBottom: 14 }}>
          <Pixel pic={emblem(48)} width={96} />
          <div><div style={{ color: AMBER }}>OFFICE OF NAVAL INTELLIGENCE</div><div style={{ color: DIM }}>SECTION THREE  ·  REMOTE CONSOLE TERMINAL</div><br /><div>Every key, button and readout, in plain words.</div></div>
        </div>
        {GUIDE.map(([section, rows]) => (
          <div key={section} style={{ marginBottom: 14 }}>
            <div style={{ color: AMBER }}>{section}</div>
            <div style={{ display: "grid", gridTemplateColumns: "16ch 1fr", columnGap: 16 }}>
              {rows.flatMap(([k, v]) => [<span key={k} style={{ color: CYAN }}>{k}</span>, <span key={k + "v"} style={{ color: WHITE }}>{v}</span>])}
            </div>
          </div>
        ))}
      </div>
      <Keys hints={["Esc or ? close", "↑ ↓ scroll", "Ctrl+P every action"]} />
    </div>
  );
}

function Palette({ d }: { d: Dialog }) {
  const items = d.props.items as [string, string, () => void][];
  const options: [Line, string][] = items.map(([t, h], i) => [[[t, WHITE], [`   ${h}`, DIM]], String(i)]);
  return <Pick d={{ ...d, props: { title: "COMMAND PALETTE", options }, resolve: (v: string | null) => { d.resolve(null); if (v !== null) items[Number(v)][2](); } }} />;
}

const KINDS: Record<string, (p: { d: Dialog }) => React.ReactElement> = { confirm: Confirm, form: Form, pick: Pick, help: Help, palette: Palette };

export function Dialogs() {
  useV((s) => s.dialog);
  const d = oni.dialogs[oni.dialogs.length - 1];
  if (!d) return null;
  const C = KINDS[d.kind];
  const cancel = d.kind === "confirm" ? false : null;
  return (
    <div className="scrim" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); d.resolve(cancel); } }}
      onMouseDown={(e) => e.target === e.currentTarget && d.resolve(cancel)}>
      <C key={d.id} d={d} />
    </div>
  );
}
