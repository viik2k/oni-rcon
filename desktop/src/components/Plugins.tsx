// F10: plug-ins, separate programs that describe their own panel in JSON (docs/PLUGINS.md). The backend finds, runs
// and shapes them; this draws what they sent. Every string here is the plug-in's data, drawn as plain text (never
// markup) and redacted like the rest of the console. The one exception is an html block: the plug-in's own page, in a
// sandboxed frame with no network and no way into the app but the messages below.
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { AMBER, CYAN, DIM, GREEN, GREY, INK, RED, WHITE } from "../art/palette";
import { badgeOf, oni, useV, type Plugin } from "../engine";
import { redactData, redactText, type Dict, type Line } from "../lib/util";
import { Btn, Panel, Table, type Row } from "./ui";

const BADGE: Record<string, string> = { ok: GREEN, warn: AMBER, alert: RED, off: DIM };

/** Its entry in the list: a light, its name, and its badge or what's wrong. */
function entry(p: Plugin): Row {
  const why = p.m.state, b = badgeOf(p), down = p.m.mode === "session" && p.session?.state !== "running";
  const light: [string, string] = p.busy ? ["◌", AMBER] : why && why !== "needs approval" ? ["⊘", RED] : why ? ["?", AMBER]
    : down ? ["○", p.session ? RED : DIM] : p.error ? ["○", RED] : !p.view ? ["○", DIM] : ["●", b ? BADGE[b.level] : GREEN];
  const tail: Line = why ? [[why === "needs approval" ? "NEEDS APPROVAL" : "DISABLED", why === "needs approval" ? AMBER : RED]]
    : down ? [[p.session ? "RESTARTING" : "STARTING", AMBER]] : p.error ? [["NO ANSWER", RED]] : b?.text ? [[b.text, BADGE[b.level]]] : [];
  return { id: p.m.id, cells: [[light], [[p.m.name || p.m.id, why ? DIM : WHITE]], tail] };
}

function Howto() {
  return (
    <div style={{ whiteSpace: "pre-wrap" }}>
      <div style={{ color: AMBER }}>NO PLUG-INS</div><br />
      <div>A plug-in is a program that draws its own panel here, such as Gryphon's moderation log. Put its folder in plugins/ next to the config file and turn it on at the top of the config, above the first [table]:</div><br />
      <div><span style={{ color: CYAN }}>  plugins = </span>["gryphon"]</div><br />
      <div style={{ color: DIM }}>It asks for your approval before it ever runs. docs/PLUGINS.md says how to write one.</div>
    </div>
  );
}

/** A plug-in that won't run: why it can't, or what approving it would allow. */
function Gate({ p }: { p: Plugin }) {
  if (p.m.state !== "needs approval") {
    return (
      <div style={{ whiteSpace: "pre-wrap" }}>
        <div style={{ color: RED }}>DISABLED</div><br />
        <div>{redactText(p.m.state, oni.redact)}</div>
        {p.m.description ? <><br /><div style={{ color: DIM }}>{p.m.description}</div></> : null}
      </div>
    );
  }
  return (
    <div style={{ whiteSpace: "pre-wrap" }}>
      <div style={{ color: AMBER }}>NEEDS YOUR APPROVAL</div><br />
      <div>{oni.pluginTerms(p.m)}</div><br />
      <Btn label="APPROVE…" variant="warning" onClick={() => oni.pluginApprove(p)} id="plugin-approve" />
    </div>
  );
}

const THEME = ["ink", "surface", "panel", "panel-2", "line", "amber", "cyan", "red", "green", "warn", "white", "grey", "dim"];

/** An html block: the page from oniplugin:, sent its `data` (redacted) and the theme; it may ask back for one of the
 * view's own actions ({oni:"action", id, row?, params?}), a fresh view ({oni:"refresh"}), a height ({oni:"height", px}),
 * RCON within its permissions ({oni:"rcon", id, server?, command, args}) or its own program ({oni:"call", ref, data}).
 * It also hears the events its manifest asks for ({oni:"event"}) and what servers answered its actions' RCON. */
function Frame({ p, b }: { p: Plugin; b: Dict }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [h, setH] = useState<number>(b.height || 420);
  const post = () => {
    const css = getComputedStyle(document.documentElement);
    ref.current?.contentWindow?.postMessage({ oni: "data", data: redactData(b.data, oni.redact), redact: oni.redact, server: oni.serverName(oni.cur),
      theme: Object.fromEntries(THEME.map((k) => [k, css.getPropertyValue(`--${k}`).trim()])) }, "*"); // its origin is opaque: "*" is the only target
  };
  useEffect(post, [b.data, oni.redact]);
  useEffect(() => {
    const f = (m: Dict) => ref.current?.contentWindow?.postMessage(m, "*");
    p.pages.add(f);
    return () => void p.pages.delete(f);
  }, [p]);
  useEffect(() => {
    const send = (m: Dict) => ref.current?.contentWindow?.postMessage(m, "*");
    const on = (e: MessageEvent) => {
      const m = e.data;
      if (e.source !== ref.current?.contentWindow || !m || typeof m !== "object") return;
      if (m.oni === "ready") post();
      else if (m.oni === "refresh") oni.pluginView(p);
      else if (m.oni === "height" && Number.isFinite(m.px)) setH(Math.max(40, Math.min(4000, m.px)));
      // ponytail: no rate limit on a page's RCON or calls; each is logged, and only its permitted commands go out
      else if (m.oni === "rcon" && typeof m.command === "string") oni.pluginPageRcon(p, m).then((r) => send({ oni: "rcon-reply", id: m.id ?? null, ...r }));
      else if (m.oni === "call") {
        const r = { oni: "reply", ref: m.ref ?? null };
        invoke("plugin_call", { id: p.m.id, data: m.data ?? null, server: oni.serverName(oni.cur) })
          .then((data) => send({ ...r, ok: true, data }), (err) => send({ ...r, ok: false, error: String(err) }));
      }
      else if (m.oni === "action" && !oni.dialogs.length) { // only the actions its view declared, with their confirms
        const a = (p.view?.actions ?? []).find((x: Dict) => x.id === String(m.id));
        if (!a) return oni.notify(`Its page asked for '${String(m.id).slice(0, 40)}', which its view doesn't offer.`, (p.m.name || p.m.id).toUpperCase(), "warning");
        oni.pluginAction(p, a, m.row == null ? null : String(m.row), m.params && typeof m.params === "object" ? m.params : undefined);
      }
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, [p]);
  const src = `${convertFileSrc(b.src, "oniplugin")}?redact=${oni.redact ? 1 : 0}&v=${b.v}`;
  return <iframe ref={ref} src={src} sandbox="allow-scripts" onLoad={post} title={`${p.m.name || p.m.id} page`}
    style={{ width: "100%", height: h, flex: "none", colorScheme: "normal", border: "1px solid var(--panel-2)", borderRadius: 4, background: "transparent" }} />;
}

function Block({ p, b, acts }: { p: Plugin; b: Dict; acts: Map<string, Dict> }) {
  const [sel, setSel] = useState<string | null>(null);
  const rt = (s: string) => redactText(s, oni.redact);
  const more = b.more ? <div style={{ color: DIM }}>+{b.more} more</div> : null;
  if (b.type === "kv") {
    return <><div className="facts">{b.rows.flatMap(([k, v]: string[], i: number) => [<span key={i} style={{ color: AMBER }}>{rt(k)}</span>, <span key={`${i}v`}>{rt(v)}</span>])}</div>{more}</>;
  }
  if (b.type === "text") return <div style={{ whiteSpace: "pre-wrap" }}>{rt(b.text)}</div>;
  if (b.type === "html") return <Frame p={p} b={b} />;
  if (b.type === "log") return <><div style={{ whiteSpace: "pre-wrap", color: DIM }}>{b.lines.length ? b.lines.map(rt).join("\n") : "—"}</div>{more}</>;
  if (b.type !== "table") return <div style={{ color: GREY }}>this version of Oni can't draw a '{b.name}' block</div>;
  const width = b.columns.length || Math.max(1, ...b.rows.map((r: Dict) => r.cells.length));
  // selected by the plug-in's row id, so a refresh that moves the rows can't point an action at a different one
  const key = (r: Dict, j: number) => r.id || `#${j}`;
  const rows: Row[] = b.rows.map((r: Dict, j: number) => ({ id: key(r, j), cells: Array.from({ length: width }, (_, k) => rt(r.cells[k] ?? "")) }));
  const row = sel === null ? b.rows[0]?.id ?? null : b.rows.find((r: Dict, j: number) => key(r, j) === sel)?.id ?? null;
  return (
    <>
      <div style={{ maxHeight: 360, display: "flex", flexDirection: "column" }}>
        <Table cols={b.columns.length ? b.columns : Array(width).fill("")} rows={rows} selected={sel} onSelect={setSel} />
      </div>
      {more}
      {b.row_actions.length && b.rows.length ? (
        <div className="btns" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {b.row_actions.map((a: string) => {
            const act = acts.get(a) ?? { id: a, label: a.toUpperCase(), danger: false, confirm: "", params: [] };
            return <Btn key={a} label={act.label} variant={act.danger ? "error" : ""} onClick={() => oni.pluginAction(p, act, row)} />;
          })}
        </div>
      ) : null}
    </>
  );
}

function View({ p }: { p: Plugin }) {
  const v: Dict = p.view ?? {}, b = v.badge;
  const acts = new Map<string, Dict>((v.actions ?? []).map((a: Dict) => [a.id, a]));
  // a view with its own page draws only that: the other blocks are its fallback for the terminal console
  const all: Dict[] = v.blocks ?? [], pages = all.filter((x) => x.type === "html"), blocks = pages.length ? pages : all;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div>
        <span style={{ color: AMBER }}>{v.title || p.m.name}</span><span style={{ color: DIM }}>  {p.m.version}</span>
        {b?.text ? <span style={{ marginLeft: 12, padding: "0 6px", color: INK, background: BADGE[b.level] }}>{b.text}</span> : null}
      </div>
      {p.m.mode === "session" && p.session?.state !== "running" ? (
        <div style={{ color: AMBER }}>{p.session ? redactText(`stopped: ${p.session.detail} · restarting in ${p.session.retry_in}s`, oni.redact) : "starting…"}</div>
      ) : null}
      {p.error ? <div style={{ color: RED }}>⚠ {redactText(p.error, oni.redact)}{p.view ? "   ·   showing its last answer" : ""}</div> : null}
      {p.note ? <div style={{ color: DIM }}>{redactText(p.note, oni.redact)}</div> : null}
      {!p.view && !p.error ? <div style={{ color: DIM }}>asking…</div> : null}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, opacity: p.error ? 0.5 : 1 }}>
        {blocks.map((blk: Dict, i: number) => <Block key={`${p.m.id}:${i}:${blk.type}`} p={p} b={blk} acts={acts} />)}
        {v.actions?.length ? (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {v.actions.map((a: Dict) => <Btn key={a.id} label={a.label} variant={a.danger ? "error" : "primary"} onClick={() => oni.pluginAction(p, a)} />)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Whether its page asked to keep running while it isn't on screen. */
const persists = (p: Plugin) => !p.m.state && (p.view?.blocks ?? []).some((b: Dict) => b.type === "html" && b.persist);

/** Always mounted (App hides it off F10). The selected plug-in's view is drawn; any other whose page has `persist`
 *  stays mounted out of sight, so its timers keep going. Each view keeps one place in one list: moving it would
 *  reload its frame. */
export function Plugins({ shown }: { shown: boolean }) {
  useV((s) => s.plugins);
  const p = oni.plugins[Math.min(oni.psel, oni.plugins.length - 1)];
  const select = (id: string) => {
    oni.psel = Math.max(0, oni.plugins.findIndex((x) => x.m.id === id));
    useV.setState((s) => ({ plugins: s.plugins + 1 }));
  };
  const live = oni.plugins.filter((x) => (shown && x === p && !x.m.state) || persists(x));
  return (
    <div className="hsplit grow">
      <Panel title="PLUG-INS" style={{ flex: 1, minWidth: 220 }}>
        <Table id="plugin-list" cols={["", "NAME", ""]} rows={oni.plugins.map(entry)} selected={p?.m.id ?? null} onSelect={select} />
      </Panel>
      <Panel title={p ? String(p.m.name || p.m.id).toUpperCase() : "PLUG-IN"} style={{ flex: 3 }}>
        {!p ? <Howto /> : p.m.state ? <Gate p={p} /> : null}
        {live.map((x) => <div key={x.m.id} style={{ display: x === p ? "contents" : "none" }}><View p={x} /></div>)}
      </Panel>
    </div>
  );
}
