// F6: the ReclaimerForge catalog, read with the operator's own key (which stays in the backend), the file of the
// listing picked with its versions, and installing, loading and acknowledging.
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { AMBER, CYAN, DIM, GOLD, GREEN, RED, WHITE } from "../art/palette";
import { bump, oni, useV } from "../engine";
import { TIPS, entries } from "../actions";
import {
  CREDIT, SITE, VIEWS, WINDOWED, WINDOWS, WITHDRAWN, authorCount, authorOf, blurbOf, compatOf, compatWords, compatible, day, historySince,
  isWithdrawn, kindOf, latestOf, listingId, norm, notesOf, ownerOf, recentOf, refsOf, shorten, titleOf, usable, versionId, versionLabel,
  versionsOf, viewsOf, votesOf,
} from "../lib/forge";
import { num, pick, redactData, type Dict, type Line } from "../lib/util";
import { Btn, Json, L, Panel, Table, type Row } from "./ui";

const KIND_COLOR: Record<string, string> = { map: CYAN, gametype: AMBER, playlist: GOLD };
const VIEW_NAMES: Record<string, string> = { installed: "INSTALLED HERE" };

export const fg = {
  opened: false, listings: [] as Dict[], rows: new Map<string, Dict>(), details: new Map<string, Dict>(), next: null as Dict | null,
  note: "", stale: 0, featured: {} as Record<string, string>, sort: "trending", window: "7d", q: "", sel: null as string | null,
  version: null as string | null, versionsFor: "", want: null as string | null, loading: 0,
};

const installed = (where: string): Record<string, Dict> => oni.forgeState.servers?.[where] ?? {};
const blocks = (lid: string) => { const w = oni.forgeState.withdrawn?.[lid]; return !!w && !w.version_id; };
const isPulled = (lid: string, e: Dict | undefined) => { const w = oni.forgeState.withdrawn?.[lid]; return !!w && (!w.version_id || (!!e && e.version_id === w.version_id)); };
const serverVersion = () => oni.cur.info?.version;

export async function forgeLoad(more = false, fresh = false) {
  if (!oni.forgeStatus.key || (more && !fg.next)) return;
  const ticket = ++fg.loading;
  if (fg.sort === "installed") {
    Object.assign(fg, { next: null, note: "", stale: 0 });
    return bump("forge");
  }
  if (fg.sort === "favourites") {
    Object.assign(fg, { next: null, note: "Fetching the favourites…" });
    bump("forge");
    const r: Dict = await invoke("forge_favourites", { fresh });
    if (ticket !== fg.loading) return;
    if (r.error) Object.assign(fg, { note: r.error.text, listings: [], featured: {} });
    else Object.assign(fg, { listings: r.items, featured: r.notes, note: r.items.length ? "" : "ReclaimerForge isn't featuring anything right now.", stale: r.stale ?? 0 });
    if (r.status) oni.forgeStatus = r.status;
    return bump("forge");
  }
  fg.featured = {};
  fg.note = more ? "Fetching more of the catalog…" : "Fetching the catalog…";
  bump("forge");
  const r: Dict = await invoke("forge_listings", { sort: fg.sort, window: fg.window, q: fg.q, more: more ? fg.next : null, fresh });
  if (ticket !== fg.loading) return;
  if (r.error) {
    fg.note = r.error.text;
    if (!more) fg.listings = [];
  } else {
    const had = new Set(more ? fg.listings.map(listingId) : []);
    fg.listings = [...(more ? fg.listings : []), ...r.items.filter((x: Dict) => !had.has(listingId(x)))];
    Object.assign(fg, { next: r.next ?? null, note: "", stale: r.stale ?? 0 });
    oni.forgeStatus = r.status;
  }
  bump("forge");
}

async function detail(lid: string) {
  const r: Dict = await invoke("forge_listing", { lid });
  fg.details.set(lid, r.error ? { ...fg.rows.get(lid), _error: r.error.text } : { ...fg.rows.get(lid), ...r.listing });
  bump("forge");
}

oni.onForgeRefresh = (lid) => {
  fg.details.delete(lid);
  if (fg.want === lid) fg.want = null;
  bump("forge");
};

/** The stations that load content from the same folder: an install there is theirs too. */
oni.onInstalled = async (m: Dict) => {
  const st = oni.stations[m.index], entry = m.entry;
  await Promise.all(m.sharing.map((i: number) => oni.stations[i]).filter((s: any) => s.online).map((s: any) => oni.fetchNow(s, ["maps", "modes"])));
  const after = kindOf(entry) === "playlist" ? "Point the server's playlist setting at it to use it: oni-rcon doesn't edit dedicated.toml."
    : listed(m.index, entry) ? "The server lists it now: l loads it." : "The server doesn't list it yet: it may need a restart to pick new content up.";
  oni.notify(`${entry.title} v${entry.version} is on ${st.label}. ${after}`, "FORGE · INSTALLED", "information", 15);
};

/** Where the server lists an installed listing: ["maps" or "modes", the reference to load it by]. */
function listed(i: number, entry: Dict): [string, string] | null {
  const names = refsOf(entry), st = oni.stations[i];
  for (const what of ["maps", "modes"]) {
    for (const e of st.data[what]?.entries ?? []) {
      if ([pick(e, "reference"), pick(e, "name")].some((v) => v && names.has(norm(v)))) return [what, String(pick(e, "reference", "name"))];
    }
  }
  return null;
}

function installedListings(): Dict[] {
  return Object.entries(installed(oni.cur.where)).map(([lid, e]) => ({ id: lid, title: e.title, kind: e.kind, author: e.author, owner_id: e.owner_id,
    status: blocks(lid) ? "withdrawn" : "", latest_version: oni.forgeState.latest?.[lid] ?? { id: e.version_id, version: e.version } }))
    .sort((a, b) => titleOf(a).toLowerCase().localeCompare(titleOf(b).toLowerCase()));
}

function mark(x: Dict): Line {
  const lid = listingId(x), have = installed(oni.cur.where)[lid];
  if (!have) return [];
  if (isPulled(lid, have)) return [["⚠", RED]];
  const latest = versionId(latestOf(x) ?? {}) || versionId(oni.forgeState.latest?.[lid] ?? {});
  return latest && latest !== have.version_id ? [["▲", AMBER]] : [["◉", GREEN]];
}

function rating(x: Dict): Line {
  const [up, down, total] = votesOf(x);
  if (up === undefined && down === undefined) return [["—", DIM]];
  if (!total) return [["no votes", DIM]];
  return [[`▲${(up ?? 0).toLocaleString()}`, GREEN], [` ▼${(down ?? 0).toLocaleString()}`, DIM]];
}

function fit(x: Dict): Line {
  const ok = compatible(compatOf(x), serverVersion());
  return ok ? [["✓", GREEN]] : ok === false ? [["✕", RED]] : [["?", DIM]];
}

export function curListing(): Dict | null {
  return fg.sel ? fg.details.get(fg.sel) ?? fg.rows.get(fg.sel) ?? null : null;
}

function canInstallHere(): string {
  const s = oni.cur;
  if (!s.contentDir) return "This server has no content_dir: add content_dir = \"...\" to its [[server]] block in the config file, naming the folder the dedicated server loads content from (on the game box, with ssh).";
  if (s.url) return "This server is reached by a ws:// or wss:// link, so oni-rcon can't put files on it. Reach it with ssh instead.";
  if (!s.ssh && !["127.0.0.1", "localhost", "::1"].includes(s.host)) return "This server is on another machine with no ssh set, so oni-rcon can't put files on it. Set ssh for it.";
  return "";
}

function selectedVersion(x: Dict): Dict | null {
  return versionsOf(x).find((v) => versionId(v) === fg.version) ?? latestOf(x);
}

export async function forgeAction(what: string) {
  const x = curListing();
  if (what === "key") return forgeKey();
  if (what === "more") return forgeLoad(true);
  if (what === "sort") { fg.sort = VIEWS[(VIEWS.indexOf(fg.sort) + 1) % VIEWS.length]; if (fg.opened) forgeLoad(); return bump("forge"); }
  if (what === "window") { if (!WINDOWED.has(fg.sort)) return; fg.window = WINDOWS[(WINDOWS.indexOf(fg.window) + 1) % WINDOWS.length]; if (fg.opened) forgeLoad(); return bump("forge"); }
  if (what === "copy") return x && oni.copy(listingId(x), "LISTING ID COPIED");
  if (what === "ack") {
    const lid = x ? listingId(x) : "";
    if (!oni.forgeState.alarms?.includes(lid)) return oni.notify("Nothing here to acknowledge.", "", "warning");
    if (await oni.confirm(`ACKNOWLEDGE  ${titleOf(x!)}`, "It stays installed, and stays flagged as withdrawn in the rotation. CONDITION goes back to green once nothing else needs you.", "ACKNOWLEDGE", false))
      await invoke("forge_ack", { lid });
    return;
  }
  if (what === "install") {
    if (!oni.forgeStatus.key || !x) return oni.notify(oni.forgeStatus.key ? "Pick a listing first." : "Load your Forge key first (k).", "", "warning");
    const v = selectedVersion(x);
    const plan: Dict = await invoke("forge_plan", { index: oni.sel, listing: x, version: v ?? {} });
    if (plan.error) return oni.notify(plan.error.text, plan.error.short, "error", 15);
    if (await oni.confirm(plan.title, plan.body, plan.replacing ? "REPLACE" : "INSTALL", plan.replacing)) await invoke("forge_put", { plan: plan.plan });
    return;
  }
  if (what === "load") {
    const st = oni.cur, entry = x ? installed(st.where)[listingId(x)] : undefined;
    if (!entry) return oni.notify("Install it on this server first (i).", "", "warning");
    if (kindOf(entry) === "playlist") return oni.notify("A playlist isn't loaded from here: point the server's playlist setting at it.", "", "warning");
    if (!st.online) return oni.notify(`${st.label} is not connected.`, "", "warning");
    await oni.fetchNow(st, ["maps", "modes"]);
    const found = listed(oni.sel, entry);
    if (!found) return oni.notify("The server doesn't list it yet. It may need a restart to pick new content up, which oni-rcon can't do for you.", `LOAD NOW · ${entry.title ?? ""}`, "warning", 15);
    const [kind, ref] = found, title = entry.title || ref;
    const other = await oni.pick(`${title} · SELECT ${kind === "maps" ? "MODE" : "MAP"}`, entries(st, kind === "maps" ? "modes" : "maps"));
    if (!other) return;
    const args = kind === "maps" ? [ref, other] : [other, ref];
    if (await oni.confirm(`LOAD  ${args.join(" / ")}`, "Ends the current game for everyone on this station; the new one starts in the next lobby.")) oni.send(st, "load", args, ["status", "nextmap"]);
  }
}

async function forgeKey() {
  const s = oni.forgeStatus;
  const fields: [string, string, string | [string, string][]][] = [["key", "Your ReclaimerForge API key", ""]];
  if (s.can_remember) fields.push(["remember", "Remember it", [["No: for this session only", "no"], [`Yes: save it in ${s.config_name}, readable only by you`, "yes"]]]);
  const f = await oni.form("FORGE API KEY", fields, { verb: "LOAD", required: ["key"], secret: ["key"],
    note: "Make one in Developer tools on reclaimerforge.net, for oni-rcon alone, with the catalog:read and assets:download scopes and nothing more. oni-rcon only ever sends it to reclaimerforge.net, and never shows it." });
  if (!f) return;
  const r: Dict = await invoke("forge_set_key", { key: f.key, remember: f.remember === "yes" });
  f.key = "";
  oni.forgeStatus = r.status;
  if (r.warn) oni.notify(r.warn, "FORGE KEY", "warning");
  Object.assign(fg, { listings: [], details: new Map(), next: null, note: "", want: null, opened: true });
  forgeLoad();
  oni.notify("Loaded. It goes to reclaimerforge.net only.", "FORGE KEY");
}

function NoKey() {
  const s = oni.forgeStatus;
  return (
    <div style={{ whiteSpace: "pre-wrap" }}>
      <span style={{ color: AMBER }}>FORGE UPLINK  //  </span><span style={{ color: RED }}>NO KEY</span><br /><br />
      ReclaimerForge is the community catalog of forged maps, gametypes and playlists. Browsing and installing from it takes your own API key.<br /><br />
      <span style={{ color: AMBER }}>1  </span>Your ReclaimerForge account needs the Developer role (an Owner gives it) and a verified email.<br />
      <span style={{ color: AMBER }}>2  </span>In Developer tools on reclaimerforge.net, make a key for oni-rcon alone, with the catalog:read and assets:download scopes and nothing more. It's shown when you make it, so save it then.<br />
      <span style={{ color: AMBER }}>3  </span>Press k, or KEY below, to load it for this session. Or set $ONI_RCON_FORGE_KEY, or forge_api_key_env in the config file, and start oni-rcon again.<br />
      {s.error ? <><br /><span style={{ color: RED }}>{s.error}</span></> : null}
    </div>
  );
}

function ListingFile({ x }: { x: Dict }) {
  const st = oni.cur, lid = listingId(x);
  if (!fg.details.has(lid) && fg.rows.has(lid) && fg.want !== lid) {
    fg.want = lid; // its versions come with the listing itself: asked for once per look
    detail(lid);
  }
  const kind = kindOf(x), owner = ownerOf(x), total = num(pick(x, "downloads", "download_count", "total_downloads"));
  const recent = recentOf(x, fg.window), version = serverVersion(), spec = compatOf(x), ok = compatible(spec, version);
  const base = pick(x, "base_map", "map", "base_mode", "base_gametype");
  const status = String(pick(x, "status", "state") ?? "").toLowerCase();
  const views = viewsOf(x), began = historySince(x, fg.window);
  const have = installed(st.where)[lid];
  const statusWords: Line = blocks(lid) && !status ? [["WITHDRAWN", RED]] : [[status.toUpperCase() || "—", WITHDRAWN.has(status) ? RED : status ? GREEN : DIM],
    ...(oni.forgeState.withdrawn?.[lid] && !blocks(lid) ? [["  ·  installed version withdrawn", AMBER]] as Line : [])];
  const can = canInstallHere();
  const rows: [string, Line | string][] = [
    ["TITLE", [[titleOf(x), AMBER]]],
    ["TYPE", [[kind.toUpperCase() || "—", KIND_COLOR[kind] ?? DIM], [base ? `  ${kind === "gametype" ? "from" : "on"} ${String(base).replace(/_/g, " ")}` : "", DIM]]],
    [authorCount(x) < 2 ? "AUTHOR" : "AUTHORS", [[authorOf(x) || "—", WHITE], [owner ? `  ${owner}` : "", DIM]]],
    ["RATING", rating(x)],
    ["DOWNLOADS", [[total !== undefined ? total.toLocaleString() : "—", WHITE], [recent !== undefined ? `  ·  ${recent} in ${WINDOWS.includes(fg.window) ? fg.window : "recent days"}` : "", DIM],
      [recent !== undefined && began ? `  (counted from ${day(began.toISOString())}, when Forge began keeping history)` : "", DIM]]],
    ...(views !== undefined ? [["VIEWS", [[views.toLocaleString(), WHITE]]] as [string, Line]] : []),
    ...(fg.featured[lid] ? [["FEATURED", [[fg.featured[lid], GOLD]]] as [string, Line]] : []),
    ["RUNS ON", [[compatWords(spec), WHITE], ...(version ? [[`   ${ok ? "✓" : ok === false ? "✕" : "?"} v${version} on ${st.label}`, ok ? GREEN : ok === false ? RED : DIM]] as Line : [])]],
    ["STATUS", statusWords],
    ["UPDATED", day(pick(x, "updated_at", "updated"))],
    ["LATEST", latestOf(x) ? versionLabel(latestOf(x)) : "—"],
    ["ON THIS SERVER", have ? [[`v${have.version ?? "?"}`, GREEN], [`  installed ${day(have.installed_at)}`, DIM]] : can ? [["can't install here: i says why", AMBER]] : [["not installed", DIM]]],
  ];
  const vs = versionsOf(x);
  if (vs.length && fg.versionsFor !== lid) { // a listing newly shown: its cursor starts on the newest to install
    fg.versionsFor = lid;
    fg.version = versionId(latestOf(x) ?? {}) || versionId(vs[0]);
  }
  const vmark = (v: Dict): Line => {
    const here = !!have && have.version_id === versionId(v);
    if (!usable(v)) return [[here ? "⚠" : "✕", RED]];
    return here ? [["◉", GREEN]] : [];
  };
  const vrows: Row[] = vs.map((v) => ({ id: versionId(v), cells: [vmark(v), [[versionLabel(v), usable(v) ? WHITE : DIM]], day(pick(v, "created_at", "published_at", "released_at")), [[shorten(notesOf(v), 90), DIM]]] }));
  const blurb = blurbOf(x);
  const [, force] = useState(0);
  return (
    <>
      <div><span style={{ color: AMBER }}>CATALOG ENTRY</span><span style={{ color: DIM }}>  //  {lid}</span></div><br />
      <div className="facts">{rows.flatMap(([a, b], i) => [<span key={i}>{a}</span>, <span key={i + "v"} className="sel-text">{typeof b === "string" ? b : <L line={b} />}</span>])}</div>
      {blurb ? <><br /><div className="sel-text" style={{ whiteSpace: "pre-wrap" }}>{shorten(blurb, 700)}</div></> : null}
      {x._error ? <><br /><div style={{ color: RED }}>{x._error}</div></> : null}
      {vs.length ? <div style={{ marginTop: 12, maxHeight: 230, display: "flex" }}><Table cols={["", "VERSION", "PUBLISHED", "NOTES"]} rows={vrows} selected={fg.version} onSelect={(id) => { fg.version = id; force((n) => n + 1); }} /></div> : null}
      <div className="grid3" style={{ margin: "14px 0" }}>
        <Btn label="INSTALL  i" variant="primary" disabled={isWithdrawn(x) || blocks(lid)} title={TIPS["fg-install"]} onClick={() => forgeAction("install")} />
        <Btn label="LOAD NOW  l" disabled={!have || kindOf(have) === "playlist"} title={TIPS["fg-load"]} onClick={() => forgeAction("load")} />
        {oni.forgeState.alarms?.includes(lid) ? <Btn label="ACKNOWLEDGE  a" variant="warning" title={TIPS["fg-ack"]} onClick={() => forgeAction("ack")} /> : null}
        <Btn label="KEY  k" title={TIPS["fg-key"]} onClick={() => forgeAction("key")} />
        <Btn label="MORE  n" disabled={!fg.next} title={TIPS["fg-more"]} onClick={() => forgeAction("more")} />
      </div>
      <details style={{ borderTop: "1px solid var(--line)", paddingTop: 6 }}>
        <summary style={{ color: DIM, cursor: "pointer" }}>RAW DATA</summary>
        <Json value={redactData(x, false)} />
      </details>
    </>
  );
}

export function Forge() {
  useV((s) => s.forge);
  useEffect(() => {
    if (!fg.opened) { // fetched when first wanted, not at every start
      fg.opened = true;
      forgeLoad();
    }
  }, []);
  const [, force] = useState(0);
  const query = fg.q.trim().toLowerCase();
  if (fg.sort === "installed") fg.listings = installedListings();
  const rows: Row[] = [];
  fg.rows = new Map();
  for (const x of fg.listings) {
    const lid = listingId(x), kind = kindOf(x), author = authorOf(x), recent = recentOf(x, fg.window);
    if (!lid || fg.rows.has(lid) || (query && ![titleOf(x), author, kind].some((t) => t.toLowerCase().includes(query)))) continue;
    fg.rows.set(lid, x);
    rows.push({ id: lid, cells: [mark(x), [[kind.toUpperCase() || "—", KIND_COLOR[kind] ?? DIM]], [[titleOf(x), WHITE]], [[author || "—", author ? WHITE : DIM]],
      rating(x), recent !== undefined ? String(recent) : "—", fit(x)] });
  }
  if (fg.sel && !fg.rows.has(fg.sel)) fg.sel = rows[0]?.id ?? null;
  const title = fg.sort === "installed" ? `INSTALLED ON ${oni.cur.label.toUpperCase()} · ${rows.length}`
    : `FORGE CATALOG · ${rows.length}${fg.next ? "+" : ""} · ${fg.sort.toUpperCase()}${WINDOWED.has(fg.sort) ? ` ${fg.window}` : ""}`;
  const sub = [SITE, ...(oni.forgeStatus.key && fg.stale ? [`OFFLINE COPY, ${Math.floor(fg.stale / 60)}m OLD`] : []), ...(oni.forgeStatus.quota ? [oni.forgeStatus.quota] : [])].join("  ·  ");
  const x = curListing();
  return (
    <div className="vsplit grow">
      <div className="bar" style={{ flexWrap: "nowrap" }}>
        <input id="forge-q" className="input" style={{ flex: 1 }} value={fg.q} placeholder="search the catalog   ·   Enter to search" spellCheck={false}
          onChange={(e) => { fg.q = e.target.value; force((n) => n + 1); }}
          onKeyDown={(e) => { if (e.key === "Enter") { fg.opened = true; forgeLoad(); document.getElementById("listings")?.focus(); } }} />
        <select className="input" style={{ width: 200 }} value={fg.sort} title="How the catalog is ordered, what ReclaimerForge is featuring, or what's installed here.  Key: s"
          onChange={(e) => { fg.sort = e.target.value; if (fg.opened) forgeLoad(); bump("forge"); }}>
          {VIEWS.map((v) => <option key={v} value={v}>{VIEW_NAMES[v] ?? v.toUpperCase()}</option>)}
        </select>
        <select className="input" style={{ width: 100 }} value={fg.window} disabled={!WINDOWED.has(fg.sort)} title="The stretch of time trending and rising count over.  Key: w"
          onChange={(e) => { fg.window = e.target.value; if (fg.opened) forgeLoad(); bump("forge"); }}>
          {WINDOWS.map((w) => <option key={w} value={w}>{w.toUpperCase()}</option>)}
        </select>
      </div>
      <div className="hsplit grow">
        <Panel title={title} sub={<span style={{ color: DIM }}>{sub}</span>} style={{ flex: 3 }}>
          <Table id="listings" cols={["", "TYPE", "TITLE", "AUTHOR", "RATING", "RECENT", "FIT"]} rows={rows} selected={fg.sel}
            onSelect={(id) => { fg.sel = id; force((n) => n + 1); }} />
        </Panel>
        <Panel title="FORGE FILE" sub={oni.forgeStatus.key && oni.forgeStatus.source ? <span style={{ color: DIM }}>KEY FROM {String(oni.forgeStatus.source).toUpperCase()}</span> : null} style={{ flex: 2, minWidth: 380 }}>
          {!oni.forgeStatus.key ? <><NoKey /><div className="bar" style={{ marginTop: 14 }}><Btn label="KEY  k" onClick={() => forgeAction("key")} /></div></>
            : x ? <ListingFile key={listingId(x)} x={x} />
              : <div style={{ color: fg.note ? WHITE : DIM, marginTop: 12 }}>{fg.note || (fg.listings.length ? "NO LISTINGS MATCH" : "Nothing in the catalog yet.")}</div>}
          <div style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 10 }}><span style={{ color: DIM }}>INTELLIGENCE SOURCE  </span><span style={{ color: AMBER }}>{SITE}</span><br /><span style={{ color: DIM }}>{CREDIT}</span></div>
        </Panel>
      </div>
    </div>
  );
}
