// F3 Operations (sitrep, controls, rotation, theatre) and F4 Blacklist (bans and VPN allowances).
import { useState } from "react";
import { AMBER, CYAN, DIM, GOLD, GREEN, RED, TEAM_COLOR, WHITE } from "../art/palette";
import { oni, SPREE, useV } from "../engine";
import { BAN_OPS, OPS, OP_GROUPS, TIPS, bl, op } from "../actions";
import { norm, refsOf } from "../lib/forge";
import { num, pick, redactAddr, redactText, sides, teamOf, until, voteText, type Dict, type Line } from "../lib/util";
import { Btn, L, Panel, Table, useSize, type Row } from "./ui";

const QUIET = new Set(["", "unknown", "none"]);
const yesNo = (v: unknown, on = "ON", off = "OFF"): Line => (v ? [[on, GREEN]] : v !== undefined && v !== null ? [[off, DIM]] : [["—", DIM]]);

/** What's playing that came from Forge: the installed listings matching the map or mode. */
export function playing(where: string, map: unknown, mode: unknown): Dict[] {
  const m = norm(map), g = norm(mode);
  return Object.values((oni.forgeState.servers?.[where] ?? {}) as Dict).filter((e: Dict) => {
    const refs = refsOf(e);
    return (m && refs.has(m) && e.kind !== "gametype") || (g && refs.has(g) && e.kind !== "map");
  });
}

export function pulled(lid: string, e: Dict) {
  const w = oni.forgeState.withdrawn?.[lid];
  return !!w && (!w.version_id || e.version_id === w.version_id);
}

function Theatre({ width }: { width: number }) {
  const st = oni.cur, players = st.players, teams = sides(players);
  if (!players.length) return <div style={{ color: DIM }}>{st.online ? "NO ASSETS IN THEATRE" : "STATION OFFLINE"}</div>;
  const barW = Math.max(60, width - 260);
  const bars: [string, string, string, string, number][] = [];
  if (teams.length) {
    const top = Math.max(...teams.map(([, , s]) => Math.max(s, 0))) || 1;
    for (const [t, n, s] of teams) bars.push([t.toUpperCase(), `${n} ON FIELD`, String(s), TEAM_COLOR[t] ?? WHITE, Math.max(s, 0) / top]);
  } else {
    const best = [...players].sort((a, b) => (num(pick(b, "score")) ?? 0) - (num(pick(a, "score")) ?? 0)).slice(0, 5);
    const top = Math.max(num(pick(best[0], "score")) ?? 0, 1);
    for (const p of best) bars.push([String(pick(p, "name") ?? "?"), "", String(num(pick(p, "score")) ?? 0), AMBER, Math.max(num(pick(p, "score")) ?? 0, 0) / top]);
  }
  const leaders = [...players].sort((a, b) => (num(pick(b, "score")) ?? 0) - (num(pick(a, "score")) ?? 0)).slice(0, 3);
  const sprees = [...st.medals.spree].filter(([, n]) => n >= SPREE).sort((a, b) => b[1] - a[1]).slice(0, 4);
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "max-content max-content max-content 1fr", columnGap: 18, alignItems: "center" }}>
        {bars.flatMap(([a, b, c, col, v], i) => [
          <span key={i + "a"} style={{ color: col === AMBER ? WHITE : col }}>{a}</span>, <span key={i + "b"} style={{ color: DIM }}>{b}</span>,
          <span key={i + "c"} style={{ color: col }}>{c}</span>,
          <div key={i + "d"} style={{ height: 14, width: Math.round(v * barW), background: col, transition: "width .4s cubic-bezier(.33,1,.68,1)" }} />,
        ])}
      </div>
      <div><span style={{ color: DIM }}>TOP GUNS  </span>
        {leaders.map((p, i) => <span key={i}>{i ? <span style={{ color: DIM }}> · </span> : null}<span style={{ color: TEAM_COLOR[teamOf(p)] ?? WHITE }}>{pick(p, "name") ?? "?"} {pick(p, "score") ?? 0}</span></span>)}
      </div>
      {sprees.length ? <div><span style={{ color: DIM }}>ON A SPREE  </span>
        {sprees.map(([name, n], i) => <span key={name}>{i ? <span style={{ color: DIM }}> · </span> : null}<span style={{ color: GOLD }}>{name} ★{n}</span></span>)}</div> : null}
    </>
  );
}

export function Operations() {
  useV((s) => s.ops);
  useV((s) => s.forge);
  const [tref, { w: tw }] = useSize<HTMLDivElement>();
  const st = oni.cur, s: Dict = st.data.status ?? {}, vote: Dict = st.data.vote ?? {}, info = st.info ?? {};
  const credit = playing(st.where, s.map, s.mode);
  const rows: [string, Line | string][] = [
    ["STATION", [[String(s.name || info.server || st.label), AMBER]]],
    ["UPLINK", `${st.where}   v${info.version ?? "?"}`],
    ["PUBLIC ADDRESS", [[redactAddr(s.address, oni.redact), oni.redact ? RED : WHITE]]],
    ["PHASE", QUIET.has(String(s.phase ?? "").toLowerCase()) ? [["—", DIM]] : [[String(s.phase).replace(/_/g, " ").toUpperCase(), CYAN]]],
    ["MAP", String(s.map || "—")], ["MODE", String(s.mode || "—")],
    ...credit.map((e) => ["FORGE", [[String(e.title || e.listing_id), GOLD], [e.author ? `  by ${e.author}` : "", WHITE], [e.version ? `  v${e.version}` : "", DIM]]] as [string, Line]),
    ["NEXT", String(s.next || "playlist")],
    ["PLAYERS", `${s.players ?? "—"} / ${s.max_players ?? "—"}`],
    ["JOIN PASSWORD", yesNo(s.password_required, "SET", "OPEN")],
    ["PING LIMIT", s.max_ping ? `${s.max_ping} ms` : "off"],
    ["ANTI-CHEAT", `${s.anti_cheat ?? "—"}${s.anti_cheat_active ? "  (active)" : ""}`],
    ["VPN BLOCK", yesNo(s.block_vpn)], ["TEXT CHAT", yesNo(s.text_chat)], ["VOICE", yesNo(s.voice)], ["HIDDEN", yesNo(s.hidden, "YES", "NO")],
  ];
  const voting = "vote" in st.data ? !!vote.vote : null;
  const off = (o: string) => (o !== "reconnect" && !st.online) || (["passvote", "cancelvote"].includes(o) && voting === false) || (o === "startvote" && voting === true);
  const ops = Object.fromEntries(OPS.map(([o, l, v]) => [o, [l, v]]));
  const here = norm(s.map);
  const pulledRefs = new Set<string>();
  for (const [lid, e] of Object.entries((oni.forgeState.servers?.[st.where] ?? {}) as Dict)) if (pulled(lid, e)) refsOf(e).forEach((r) => pulledRefs.add(r));
  let marked = false;
  const rot: Row[] = (st.data.nextmap?.rotation ?? []).map((e: Dict, i: number) => {
    const mp = String(pick(e, "map", "base_map") ?? "?"), md = String(pick(e, "mode", "game") ?? "?");
    const now = !marked && norm(mp) === here;
    marked ||= now;
    const flag = (v: string): Line => [[v, now ? AMBER : undefined], ...(pulledRefs.has(norm(v)) ? [["  ⚠ WITHDRAWN", RED]] as Line : [])];
    return { id: String(i), cells: [[[now ? "▶" : String(i + 1), now ? AMBER : undefined]], flag(mp), flag(md)] };
  });
  return (
    <div className="vsplit grow">
      <div className="hsplit" style={{ flex: "none", flexWrap: "wrap" }}>
        <Panel title="SITREP" style={{ flex: "1 1 360px" }}>
          <div className="facts">
            {rows.flatMap(([a, b], i) => [<span key={i}>{a}</span>, <span key={i + "v"} className="sel-text">{typeof b === "string" ? b : <L line={b} />}</span>])}
            <span>VOTE</span><span>{voteText(vote.vote).map((l, i) => <div key={i}><L line={l} /></div>)}</span>
          </div>
        </Panel>
        <div style={{ flex: "2 1 480px", padding: "0 4px" }}>
          {OP_GROUPS.map(([g, names]) => (
            <div key={g}>
              <div className="head">{g}</div>
              <div className="grid3">
                {names.map((o) => <Btn key={o} id={`op-${o}`} label={ops[o][0]} variant={ops[o][1]} disabled={off(o)} title={TIPS[`op-${o}`]} onClick={() => op(o)} />)}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="hsplit grow" style={{ minHeight: 140 }}>
        <Panel title="ROTATION" className="grow"><Table cols={["#", "MAP", "MODE"]} rows={rot} cursor={false} /></Panel>
        <Panel title="THEATRE" className="grow"><div ref={tref}><Theatre width={tw} /></div></Panel>
      </div>
    </div>
  );
}

export const blUi = { ban: null as string | null, vpn: null as string | null, bans: new Map<string, string>(), vpns: new Map<string, string>() };

export function Blacklist() {
  useV((s) => s.bans);
  const [, force] = useState(0);
  const st = oni.cur, b: Dict = st.data.bans ?? {}, v: Dict = st.data.vpn ?? {};
  const rows: Row[] = [];
  blUi.bans = new Map();
  for (const [kind, color, list] of [["PLAYER", AMBER, b.players], ["IP", RED, b.ips], ["DEVICE", CYAN, b.devices]] as [string, string, Dict[]][]) {
    for (const e of list ?? []) {
      const target = String(pick(e, "id", "player_id", "ip", "range", "address", "device", "fingerprint") ?? "?");
      let key = `${kind}:${target}`;
      if (blUi.bans.has(key)) key = `${key}~${blUi.bans.size}`;
      blUi.bans.set(key, target);
      const left = until(pick(e, "expires", "until"));
      rows.push({ id: key, cells: [[[kind, color]], kind === "IP" ? redactAddr(target, oni.redact) : target, String(pick(e, "name") ?? ""),
        String(pick(e, "reason") ?? ""), [[left, left === "PERMANENT" ? RED : left === "expired" ? DIM : AMBER]], String(pick(e, "banned_by", "by") ?? "")] });
    }
  }
  const vrows: Row[] = [];
  blUi.vpns = new Map();
  for (const e of v.allowed ?? []) {
    const target = String(pick(e, "target", "id", "player_id", "ip", "range", "address") ?? JSON.stringify(e));
    const key = blUi.vpns.has(target) ? `${target}~${blUi.vpns.size}` : target;
    blUi.vpns.set(key, target);
    vrows.push({ id: key, cells: [redactText(target, oni.redact), String(pick(e, "note") ?? "")] });
  }
  const sel = (k: "ban" | "vpn") => (id: string) => { blUi[k] = id; force((x) => x + 1); };
  const disabled = (o: string) => !st.online || (o === "unban" && !blUi.bans.size) || (o === "vpnrevoke" && !blUi.vpns.size);
  return (
    <div className="vsplit grow">
      <Panel title={`BLACKLIST · ${rows.length}`} className="grow" style={{ flex: 2 }}>
        <Table id="bans" cols={["TYPE", "TARGET", "NAME", "REASON", "EXPIRES", "BY"]} rows={rows} selected={blUi.ban} onSelect={sel("ban")} />
      </Panel>
      <Panel title={`VPN ALLOWANCES · blocking ${v.block_vpn ? "ON" : "OFF"}${typeof v.ranges === "number" ? ` · ${v.ranges} ranges` : ""}`} className="grow">
        <Table id="vpn" cols={["ALLOWED THROUGH VPN", "NOTE"]} rows={vrows} selected={blUi.vpn} onSelect={sel("vpn")} />
      </Panel>
      <div className="bar">
        {BAN_OPS.map(([o, l, va]) => <Btn key={o} label={l} variant={va} disabled={disabled(o)} title={TIPS[`bl-${o}`]}
          onClick={() => bl(o, blUi.ban ? blUi.bans.get(blUi.ban) : null, blUi.vpn ? blUi.vpns.get(blUi.vpn) : null)} />)}
      </div>
    </div>
  );
}
