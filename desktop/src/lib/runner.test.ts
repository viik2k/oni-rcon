import { describe, expect, it } from "vitest";
import { Runner } from "./runner";
import { TELEGRAM_GAP, validate } from "./rules";

const setup = (phase = "playing") => {
  const calls: string[] = [], posts: string[] = [], tele: string[] = [];
  const r = new Runner({
    call: async (_s, c, a) => { calls.push([c, ...a].join(" ")); return { ok: true, data: { phase } }; },
    discord: async (n, t) => { posts.push(`${n}:${t}`); return 204; },
    telegram: async (n, t) => { tele.push(`${n}:${t}`); return n === "revoked" ? 401 : 200; },
    changed() {},
  }, () => 0, async () => {});
  r.webhooks = { hook: "https://discord.com/api/webhooks/1/••••••" };
  r.chats = { alerts: "123456789:•••• → -1001", revoked: "123456789:•••• → -1002" };
  r.engine.connection("s", true, "One");
  return { r, calls, posts, tele };
};
const rule = (then: object[], when: object = { type: "join" }) => validate({ name: "t", when, then, cooldown: 0, per_hour: 600 });

describe("runner", () => {
  it("says at most 20 a minute per server, and shuffles only mid-match", async () => {
    const a = setup();
    a.r.load([rule([{ type: "say", to: "this", message: "hi" }])], {});
    for (let i = 0; i < 25; i++) a.r.event("s", { event: "join", name: "A", player_id: String(i) });
    await new Promise((r) => setTimeout(r, 10));
    expect(a.calls.filter((c) => c.startsWith("say")).length).toBe(20);

    for (const [phase, runs] of [["playing", 1], ["lobby", 0]] as const) {
      const b = setup(phase);
      b.r.load([rule([{ type: "shuffle" }])], {});
      b.r.event("s", { event: "join", name: "A", player_id: "1" });
      await new Promise((r) => setTimeout(r, 10));
      expect(b.calls.filter((c) => c === "shuffle").length).toBe(runs);
    }
  });

  it("posts to Discord by name, and notes an unknown webhook", async () => {
    const a = setup();
    a.r.load([rule([{ type: "discord", webhook: "hook", message: "hello" }]), rule([{ type: "discord", webhook: "nope", message: "x" }])], {});
    a.r.event("s", { event: "join", name: "A", player_id: "1" });
    await new Promise((r) => setTimeout(r, 10));
    expect(a.posts).toEqual(["hook:hello"]);
    expect(a.r.history.some((n) => /no webhook called nope/.test(n.result))).toBe(true);
  });

  it("posts to Telegram by name, and says why a post failed", async () => {
    const a = setup();
    a.r.load([rule([{ type: "telegram", chat: "alerts", message: "hello" }]), rule([{ type: "telegram", chat: "nope", message: "x" }]), rule([{ type: "telegram", chat: "revoked", message: "y" }])], {});
    a.r.event("s", { event: "join", name: "A", player_id: "1" });
    await new Promise((r) => setTimeout(r, 10));
    expect(a.tele).toEqual(["alerts:hello", "revoked:y"]);
    const said = a.r.history.map((n) => n.result).join("\n");
    expect(said).toMatch(/Post to Telegram \(alerts\): hello: done/);
    expect(said).toMatch(/no chat called nope/);
    expect(said).toMatch(/Telegram refused it \(401\): the bot token is wrong/);
    expect(a.posts).toEqual([]);
  });

  it("spaces posts to one service, and a failed post doesn't block the next", async () => {
    let now = 0;
    const slept: number[] = [], sent: number[] = [];
    const r = new Runner({
      call: async () => ({ ok: true }),
      discord: async () => 204,
      telegram: async () => { sent.push(now); if (sent.length === 1) throw new Error("offline"); return 200; },
      changed() {},
    }, () => now, async (s) => { slept.push(s); now += s; });
    r.chats = { alerts: "x" };
    const f = { rule: { id: "r", name: "t" } } as any;
    const post = { kind: "telegram" as const, chat: "alerts", text: "hi" };
    await Promise.all([r.steps(f, [post]), r.steps(f, [post]), r.steps(f, [post])]);
    expect(sent).toEqual([0, TELEGRAM_GAP, TELEGRAM_GAP * 2]);
    expect(slept).toEqual([TELEGRAM_GAP, TELEGRAM_GAP]);
    expect(r.history.map((n) => n.result)[0]).toMatch(/Telegram could not be reached/);
  });
});
