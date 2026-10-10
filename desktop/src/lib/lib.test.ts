import { describe, expect, it } from "vitest";
import { describe as describeEvent, explain, idForms, parseCommand, plain, reactionWords, redactData, redactText, sides, splitTag } from "./util";
import { Medals } from "./medals";
import { compatible, latestOf, refsOf, votesOf } from "./forge";
import { Superintendent, classify } from "../art/superintendent";
import { BASE, face, faceClass } from "../art/archive";
import { smooth, tones } from "../art/pixels";
import { decrypt, noise } from "../art/palette";

describe("console lines", () => {
  it("keeps a message whole for say, tell, kick and rename", () => {
    expect(parseCommand("say it's a trap")).toEqual(["say", "it's a trap"]);
    expect(parseCommand('tell #3 "don\'t camp"')).toEqual(["tell", "#3", "don't camp"]);
    expect(parseCommand("kick Viper team killing again")).toEqual(["kick", "Viper", "team killing again"]);
    expect(parseCommand('ban "Echo 4" 2h spam')).toEqual(["ban", "Echo 4", "2h", "spam"]);
    expect(() => parseCommand('ban "Echo 4')).toThrow();
  });
});

describe("IDs", () => {
  it("reads one number in either base and either half of a long hex ID", () => {
    const f = idForms("00000000000000ff0000000000000010");
    expect(f.has("255")).toBe(true);
    expect(f.has("16")).toBe(true);
    expect(idForms(255).has("ff")).toBe(true);
    expect(idForms(-1).has("18446744073709551615")).toBe(true);
  });
});

describe("medals", () => {
  it("chains multi-kills, counts sprees and killjoys", () => {
    const m = new Medals();
    expect(m.kill("A", "B", 0)).toEqual([]);
    expect(m.kill("A", "C", 1)).toEqual(["DOUBLE KILL"]);
    expect(m.kill("A", "D", 2)).toEqual(["TRIPLE KILL"]);
    m.kill("A", "E", 10);
    expect(m.kill("A", "F", 20)).toEqual(["KILLING SPREE"]);
    expect(m.kill("B", "A", 30)).toEqual(["KILLJOY"]);
    expect(m.kill(null, "B", 31)).toEqual([]);
  });
});

describe("words", () => {
  it("explains connection failures from Rust's own messages", () => {
    expect(explain("IO error: Connection refused (os error 111); retry in 4s", "offline", true)).toBe("NOTHING ON THAT PORT");
    expect(explain("failed to lookup address information: Name or service not known", "offline", true)).toBe("UNKNOWN HOST");
    expect(explain("HTTP error: 404 Not Found", "offline", true)).toBe("NOT AN RCON PORT");
    expect(explain("Wrong password.", "denied", true)).toBe("PASSWORD REFUSED");
  });
  it("splits community tags", () => {
    expect(splitTag("ALPHA · Big Team")).toEqual(["ALPHA", "Big Team"]);
    expect(splitTag("Slayer")).toEqual(["", "Slayer"]);
  });
  it("blanks addresses and keys while redacted", () => {
    expect(redactText("from 203.0.113.9 rfk_abcdefghij", true)).toBe("from ███.███.███.███ rfk_…████");
    expect(redactData({ address: "1.2.3.4", n: 1 }, true)).toEqual({ address: "███.███.███.███", n: 1 });
  });
  it("describes a kill with its medals", () => {
    const l = describeEvent({ event: "kill", killer: "A", victim: "B", weapon: "shotgun", _medals: ["DOUBLE KILL"] });
    expect(plain(l)).toBe("A ✕ B  [shotgun]   DOUBLE KILL ");
    expect(reactionWords({ event: "join", name: "Kestrel" })).toBe("Kestrel joined");
  });
  it("leaves free-for-alls without teams", () => {
    expect(sides([{ team: "red", score: 1 }, { team: "blue", score: 2 }, { team: "green", score: 0 }])).toEqual([]);
    expect(sides([{ team: 0, score: 3 }, { team: 0, score: 1 }, { team: "blue", score: 2 }])).toEqual([["red", 2, 4], ["blue", 1, 2]]);
  });
});

describe("forge", () => {
  it("reads compatibility specs", () => {
    expect(compatible(">=0.9.5", "0.9.7-demo")).toBe(true);
    expect(compatible("0.9.6", "0.9.7")).toBe(false);
    expect(compatible("<=0.9", "0.9.7")).toBe(true);
    expect(compatible({ min: "0.9.0", max: "0.9" }, "0.9.7")).toBe(true);
    expect(compatible(["0.8.x", "0.9.x"], "0.9.7")).toBe(true);
    expect(compatible(undefined, "0.9.7")).toBe(null);
  });
  it("never picks a withdrawn version", () => {
    const x = { latest_version: { id: "v2" }, versions: [{ id: "v2", status: "withdrawn", created_at: "2026-02-01" }, { id: "v1", created_at: "2026-01-01" }] };
    expect(latestOf(x)?.id).toBe("v1");
    expect(votesOf({ upvote_count: 3, downvote_count: 1 })).toEqual([3, 1, 4]);
    expect([...refsOf({ title: "Guardian Rebuilt", files: [{ path: "maps/guardian_rebuilt.map" }] })]).toEqual(["guardian_rebuilt"]);
  });
});

describe("the Superintendent", () => {
  it("reacts as an admin would, and a lesser event doesn't cut a greater one short", () => {
    let t = 100;
    const s = new Superintendent(true, () => t);
    expect(classify({ event: "chat", channel: "all", text: "admin pls" })).toBe("call");
    expect(classify({ event: "chat", channel: "all", text: "gg" })).toBe(null);
    expect(s.react({ event: "chat", text: "is there a mod on" }, "x")?.mood).toBe("ALARMED");
    t += 1;
    expect(s.react({ event: "join" })).toBe(null);
    t += 10;
    expect(s.lookAt(t)[0].mood).toBe("WATCHING");
  });
  it("blinks on a schedule of the clock alone", () => {
    const s = new Superintendent(true, () => 0);
    const closed = Array.from({ length: 1100 }, (_, i) => s.blinking(i / 100)).filter((b) => b > 0.9).length;
    expect(closed).toBeGreaterThan(0);
    expect(new Superintendent(false).blinking(1)).toBe(0);
  });
  it("draws a disc with two eyes at any size, crisp at the edge", () => {
    expect(faceClass(BASE, 24 - 8.6 + 2.5, 24)).toBe("w");
    expect(faceClass(BASE, 0, 0)).toBe(null);
    for (const n of [24, 64, 128]) {
      const p = face(BASE, n);
      expect(p.w).toBe(n);
      expect(p.alpha(0, 0)).toBe(0);
      expect(p.alpha(n >> 1, n - 3)).toBeGreaterThan(200);
    }
  });
});

describe("art", () => {
  it("smooths a traced grid without inventing colours", () => {
    const pic = smooth(["0330", "3333", "3333", "0330"], tones({ "3": "#D9A441" }), 40);
    expect(pic.w).toBe(40);
    for (let i = 0; i < pic.data.length; i += 4) if (pic.data[i + 3] === 255) expect([pic.data[i], pic.data[i + 1], pic.data[i + 2]]).toEqual([0xd9, 0xa4, 0x41]);
  });
  it("matches the terminal's noise and decrypt", () => {
    expect(noise(3, 7)).toBe(0.06072395155206323); // the Python console's own values: the same pixels dissolve the same way
    expect(noise(-5, 2)).toBe(0.12622592388652265);
    expect(noise(123456, 99)).toBe(0.6629038583487272);
    expect(decrypt("SECTION THREE", 1)).toBe("SECTION THREE");
    expect(decrypt("SECTION THREE", 0).length).toBe(13);
  });
});
