// The setup screen: add servers in a form instead of a config file, each one tested before it's saved.
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { AMBER, CYAN, DIM, GREEN, RED, WHITE } from "../art/palette";
import { emblem } from "../art/archive";
import { explain, type Dict } from "../lib/util";
import { Check, Pixel, useSize } from "./ui";

interface Spec { address: string; port: string; password: string; name: string; ssh: string }
const SPIN = "◐◓◑◒";

export function Setup({ info, onDone }: { info: Dict; onDone: (demo: boolean) => void }) {
  const s = info.setup;
  const [f, setF] = useState<Spec>({ address: "127.0.0.1", port: "11774", password: "", name: "", ssh: "" });
  const [by, setBy] = useState(s.by);
  const [remember, setRemember] = useState(true);
  const [status, setStatus] = useState<[boolean | null, string]>([info.error ? false : null, info.error ?? ""]);
  const [added, setAdded] = useState<Spec[]>([]);
  const [testing, setTesting] = useState(false);
  const [failed, setFailed] = useState(false);
  const [frame, setFrame] = useState(0);
  const [showSsh, setShowSsh] = useState(false);
  const pw = useRef<HTMLInputElement>(null);
  const [ref, { h }] = useSize<HTMLDivElement>();
  useEffect(() => pw.current?.focus(), []);
  useEffect(() => {
    if (!testing) return;
    const t = setInterval(() => setFrame((n) => n + 1), 100);
    return () => clearInterval(t);
  }, [testing]);
  const set = (k: keyof Spec) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const home = s.path.replace(/^\/home\/[^/]+|^\/root|^C:\\Users\\[^\\]+/, "~");

  const check = async (): Promise<string | null> => {
    if (!f.password) {
      pw.current?.focus();
      setStatus([false, "Enter the RCON password."]);
      return null;
    }
    const r: Dict = await invoke("setup_check", { spec: f });
    if (!r.ok) {
      setStatus([false, r.text]);
      return null;
    }
    if (added.some((a) => a.address === f.address && a.port === f.port && a.ssh === f.ssh)) {
      setStatus([false, `${r.where} is already in your list.`]);
      return null;
    }
    return r.where;
  };
  const add = (text: string) => {
    setAdded([...added, f]);
    setStatus([true, `${text} Add another (next port filled in), or press START.`]);
    setFailed(false);
    setF({ ...f, port: /^\d+$/.test(f.port) ? String(Number(f.port) + 1) : f.port, name: "" });
  };
  const test = async () => {
    const where = await check();
    if (!where) return;
    setFailed(false);
    setTesting(true);
    setStatus([null, `Connecting to ${where}…`]);
    const r: Dict = await invoke("setup_probe", { spec: f });
    setTesting(false);
    if (r.ok) add(r.text);
    else {
      setStatus([false, r.text ?? explain(r.detail ?? "", r.state ?? "offline")]);
      setFailed(true);
    }
  };
  const start = async () => {
    try {
      await invoke("setup_save", { specs: added, by, remember });
      onDone(false);
    } catch (e) {
      setStatus([false, String(e)]);
    }
  };
  const size = Math.max(0, Math.min(320, Math.floor((h - 560) / 4) * 4));
  const statusColor = status[0] === true ? GREEN : status[0] === false ? RED : AMBER;
  return (
    <div className="setup" ref={ref}>
      {size >= 96 ? <Pixel pic={emblem(size / 2)} width={size} /> : null}
      <div style={{ textAlign: "center" }}>
        <div className="pre" style={{ color: AMBER }}>O N I   R C O N</div>
        <div style={{ color: DIM }}>Let's connect to your Halo 3 server. You need its address and RCON password (dedicated.toml, under [rcon]).</div>
      </div>
      <div className="panel form" style={{ padding: "16px 22px" }}>
        <div className="ptitle">ADD A SERVER</div>
        <div className="dialog" style={{ all: "unset", display: "block" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 140px", gap: 16 }}>
            <div><label className="lbl">Address</label><input className="input" value={f.address} onChange={set("address")} placeholder="IP, host name or wss:// link" onKeyDown={(e) => e.key === "Enter" && test()} /></div>
            <div><label className="lbl">Port</label><input className="input" value={f.port} onChange={set("port")} placeholder="game port" onKeyDown={(e) => e.key === "Enter" && test()} /></div>
          </div>
          <div className="hint">Where the server runs: 127.0.0.1 is this computer. RCON shares the game port.</div>
          <div style={{ display: "grid", gridTemplateColumns: s.ask_by ? "1fr 1fr 1fr" : "1fr 1fr", gap: 16 }}>
            <div><label className="lbl">RCON password</label><input ref={pw} type="password" className="input" value={f.password} onChange={set("password")} placeholder="from dedicated.toml" onKeyDown={(e) => e.key === "Enter" && test()} /></div>
            <div><label className="lbl">Name (optional)</label><input className="input" value={f.name} onChange={set("name")} placeholder="else the server's own" onKeyDown={(e) => e.key === "Enter" && test()} /></div>
            {s.ask_by ? <div><label className="lbl">Your name</label><input className="input" value={by} onChange={(e) => setBy(e.target.value)} title="Kicks and bans you make are logged under it." /></div> : null}
          </div>
          <div style={{ marginTop: 12 }}>
            <span style={{ color: CYAN, cursor: "pointer" }} onClick={() => setShowSsh(!showSsh)}>{showSsh ? "▼" : "▶"} Advanced: reach it through SSH</span>
            {showSsh ? (
              <div style={{ paddingLeft: 18, marginTop: 6 }}>
                <input className="input" value={f.ssh} onChange={set("ssh")} placeholder="user@game-box   (leave empty to connect directly)" onKeyDown={(e) => e.key === "Enter" && test()} />
                <div className="hint">Best when the server is on another machine: RCON isn't encrypted, so keep it on 127.0.0.1 there and tunnel in. Needs an SSH key, not a password.</div>
              </div>
            ) : null}
          </div>
          <div style={{ display: "flex", gap: 16, marginTop: 12 }}>
            <Check label="Remember the password" on={remember} onChange={setRemember} />
            <span className="hint">{remember ? `saved in ${home}` : "you'll be asked for it each start"}</span>
          </div>
          <div style={{ marginTop: 10, color: statusColor, minHeight: 20 }}>
            {testing ? `${SPIN[frame % 4]} ` : status[0] === true ? "✓ " : status[0] === false && status[1] ? "✗ " : ""}{status[1]}
          </div>
          {s.existing.length || added.length ? (
            <div><span style={{ color: CYAN }}>YOUR SERVERS   </span>
              {s.existing.map((x: Dict) => <span key={x.where}><span style={{ color: DIM }}>◉ </span><span style={{ color: WHITE }}>{x.name || x.where}   </span></span>)}
              {added.map((x, i) => <span key={i}><span style={{ color: GREEN }}>◉ </span><span style={{ color: WHITE }}>{x.name || `${x.address}:${x.port}`}   </span></span>)}
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <button className="btn" onClick={() => onDone(true)}>TRY THE DEMO</button>
            <span style={{ flex: 1 }} />
            {failed ? <button className="btn" onClick={async () => { if (await check()) add("Added without a test. It'll keep trying to connect once you start."); }}>ADD ANYWAY</button> : null}
            <button className="btn primary" disabled={testing} onClick={test}>TEST & ADD</button>
            <button className="btn success" disabled={!(s.existing.length || added.length)} onClick={start}>START  ▸</button>
          </div>
        </div>
      </div>
      <div className="hint">Ctrl+Q quits.   {info.version ? `oni-rcon ${info.version}` : ""}</div>
    </div>
  );
}
