// F7: whether the servers are crashing and the box is coping. Crashes read from each server's log, the host's memory,
// and the workaround service. The backend runs and reads the reports; this draws them.
import { useState } from "react";
import { AMBER, CYAN, DIM, GREEN, RED, WHITE } from "../art/palette";
import { oni, useV } from "../engine";
import { age, redactText, when, type Dict, type Line } from "../lib/util";
import { L, Panel, Table, type Row } from "./ui";

const CRASH_COLOR: Record<string, string> = { SIGNATURE: RED, BARE: AMBER, "OOM-KILL": RED, "CONTAINER-RESTART": CYAN };
const LEVEL: Record<string, string> = { ok: GREEN, warn: AMBER, crit: RED, "": DIM };
const memLevel = (a: number | null | undefined, min: number) => (a === null || a === undefined ? "" : a < min ? "crit" : a < 2 * min ? "warn" : "ok");
const swapLevel = (u: number | null | undefined, t: number | null | undefined) => (u === null || u === undefined || !t ? "" : u * 2 >= t ? "crit" : u * 4 >= t ? "warn" : "ok");

function Facts({ rows }: { rows: [Line | string, Line | string][] }) {
  return (
    <div className="facts">
      {rows.flatMap(([a, b], i) => [
        <span key={i}>{typeof a === "string" ? a : <L line={a} />}</span>,
        <span key={i + "v"}>{typeof b === "string" ? b : <L line={b} />}</span>,
      ])}
    </div>
  );
}

function Howto() {
  return (
    <Panel className="grow">
      <div style={{ padding: "10px 16px", whiteSpace: "pre-wrap" }}>
        <div style={{ color: AMBER }}>HEALTH WATCH IS OFF</div><br />
        <div>Give oni-rcon a command that prints a small report, and this tab shows crashes read from each server's log, the host's memory and whether a container was killed for it. Add it to the config file, above the first [table]:</div><br />
        <div><span style={{ color: CYAN }}>  health_cmd = </span>"docker logs --timestamps --since {"{since}"} my-server-{"{port}"} 2&gt;&amp;1"</div><br />
        <div style={{ color: DIM }}>{"{port}"} is the server's RCON port, {"{since}"} how far back to read. It runs on the server's ssh host, or here without one, and only reads. Add a host line (memory) and a container line (docker inspect) for the HOST panel: oni-rcon.example.toml has a whole docker example, and the README says what each line means.</div><br />
        <div><span style={{ color: CYAN }}>health_min_free_mb</span><span style={{ color: DIM }}> (default 1024) is the free memory below which it alerts.  </span><span style={{ color: CYAN }}>health_service</span><span style={{ color: DIM }}> names a systemd service to watch.</span></div>
      </div>
    </Panel>
  );
}

export function Health() {
  useV((s) => s.health);
  useV((s) => s.mast); // the ages move
  const [sel, setSel] = useState<string | null>(null);
  const h: Dict = oni.health, now = Date.now() / 1000;
  if (!h.on) return <Howto />;
  const label = (key: string) => (key ? oni.stations[Number(key)]?.label ?? key : "HOST");
  const rows: Row[] = (h.crashes ?? []).map((e: Dict) => ({ id: `${e.key}:${e.cls}:${Math.floor(e.ts)}`, cells: [
    `${when(e.ts)}  ${age(now - e.ts)} ago`, [[label(e.key), WHITE]], [[e.cls, CRASH_COLOR[e.cls] ?? WHITE]],
    [[e.players !== null && e.players !== undefined ? String(e.players) : "—", e.players ? AMBER : DIM]], [[e.detail, DIM]],
    e.rcon ? [["DROPPED", CYAN]] : [["—", DIM]]] }));
  const watchedHosts = [...new Set(oni.stations.filter((s, i) => h.watched?.[i] && s).map((s) => s.ssh))].sort();
  const hosts: [Line | string, Line | string][] = [];
  for (const host of watchedHosts) {
    const snap: Dict | undefined = h.hosts?.[host];
    if (watchedHosts.length > 1) hosts.push([[["HOST", AMBER]], [[redactText(host || "this machine", oni.redact), AMBER]]]);
    if (!snap) {
      const bad = oni.stations.map((s, i) => (s.ssh === host ? h.errors?.[i] : "")).find(Boolean) ?? "";
      hosts.push(["", [[bad ? `no report yet: ${bad}` : "waiting for the first report", bad ? RED : DIM]]]);
      continue;
    }
    const ml = memLevel(snap.avail, h.min_free);
    hosts.push(["MEMORY FREE", [[snap.avail !== null ? `${snap.avail} MB` : "—", LEVEL[ml]], [ml === "crit" ? `   under ${h.min_free} MB` : "", RED]]]);
    hosts.push(["SWAP USED", [[snap.swap_used !== null ? `${snap.swap_used} / ${snap.swap_total} MB` : "—", LEVEL[swapLevel(snap.swap_used, snap.swap_total)]]]]);
    const since = (snap.oom ?? 0) - (snap.oom_first ?? 0);
    hosts.push(["OOM KILLS", [[snap.oom !== null ? String(snap.oom) : "—", since ? RED : snap.oom ? AMBER : GREEN], [since ? `   +${since} since you opened this` : "", RED]]]);
    hosts.push(["REPORT", [[`${age(now - snap.at)} ago`, DIM]]]);
  }
  oni.stations.forEach((s, i) => { if (h.errors?.[i] && h.watched?.[i]) hosts.push([[["FAILED", RED]], [[`${s.label}: ${h.errors[i]}`, AMBER]]]); });
  const boxes: Row[] = oni.stations.flatMap((s, i) => {
    const b: Dict | undefined = h.boxes?.[String(i)];
    if (!b) return [];
    return [{ id: String(i), cells: [[[s.label, WHITE]], b.started ? when(b.started) : "—", [[b.started ? age(now - b.started) : "—", DIM]],
      b.oom_killed ? [["YES", RED]] : [["no", GREEN]], [[b.exit_code !== null && b.exit_code !== undefined ? String(b.exit_code) : "—", b.exit_code === 137 ? RED : DIM]],
      [[b.restarts !== null && b.restarts !== undefined ? String(b.restarts) : "—", DIM]]] as Row["cells"] }];
  });
  const svcHosts = [...new Set(oni.stations.filter((s) => oni.demo || !s.url).map((s) => s.ssh))].sort();
  const work: [Line | string, Line | string][] = [];
  if (!svcHosts.length) work.push(["", [["No server here has an ssh destination or a box of its own to check.", DIM]]]);
  for (const host of svcHosts) {
    const svc: Dict | undefined = h.services?.[host], err = h.service_err?.[host];
    if (svcHosts.length > 1) work.push([[["HOST", AMBER]], [[redactText(host || "this machine", oni.redact), AMBER]]]);
    if (err) work.push([[["FAILED", RED]], [[err, AMBER]]]);
    if (!svc) { work.push(["", [["waiting for the first check", DIM]]]); continue; }
    const up = svc.active === "active";
    work.push(["SERVICE", [[`${up ? "●" : "○"} ${String(svc.active).toUpperCase()}`, up ? GREEN : RED]]]);
    work.push(["MOVED TAG", svc.moved ? [[`${when(svc.moved)}  ${age(now - svc.moved)} ago`, WHITE]] : [["none in the last 24 h", DIM]]]);
    work.push(["BUILD", svc.warn ? [[`⚠ NOT THE PINNED BUILD  ${svc.warn_at ? when(svc.warn_at) : ""}\n${svc.warn}`, RED]] : [["no warning in the last 24 h", GREEN]]]);
  }
  const oneHost = watchedHosts.length === 1 ? ` · ${redactText(watchedHosts[0] || "this machine", oni.redact)}` : "";
  return (
    <div className="vsplit grow">
      <Panel title={`CRASHES · LAST 24 H · ${rows.length}`} sub={!rows.length && h.seen ? <span style={{ color: GREEN }}>NONE IN THE LAST 24 H</span> : null} className="grow">
        <Table id="crashes" cols={["WHEN", "SERVER", "CLASS", "PLAYERS", "DETAIL", "RCON"]} rows={rows} selected={sel} onSelect={setSel} />
      </Panel>
      <div className="hsplit grow" style={{ minHeight: 220 }}>
        <Panel title={`HOST${oneHost}`} style={{ flex: 3 }}>
          <Facts rows={hosts} />
          <div style={{ marginTop: 10 }}>
            <Table cols={["SERVER", "STARTED", "UP", "OOMKILLED", "EXIT", "RESTARTS"]} rows={boxes} cursor={false} />
          </div>
        </Panel>
        {h.service ? <Panel title={`WORKAROUND · ${h.service}`} style={{ flex: 2 }}><div style={{ whiteSpace: "pre-wrap" }}><Facts rows={work} /></div></Panel> : null}
      </div>
    </div>
  );
}
