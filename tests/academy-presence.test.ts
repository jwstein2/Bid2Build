import { describe, expect, it } from "vitest";
import { createPresence, HEARTBEAT_MS, STATS_REFRESH_MS, type PresenceKind } from "@/lib/academy/presence";

/**
 * The browser side of Academy presence with a fake clock and a fake "server" that mirrors academy_touch /
 * academy_stats: last_seen_at per user id (server clock), throttled to one write a minute, online = seen within
 * the 5-minute window. Covers the scenarios in the bug report.
 */
const WINDOW = 5 * 60_000;
const MIN = 60_000;

function world() {
  let t = 1_000_000;
  const lastSeen = new Map<string, number>();
  const sent: { user: string; kind: PresenceKind; at: number }[] = [];
  const touch = (user: string) => { const s = lastSeen.get(user); if (s === undefined || s < t - 60_000) lastSeen.set(user, t); };
  const online = () => [...lastSeen.values()].filter((s) => s >= t - WINDOW).length;

  function tab(user: string, { member = true, panel = true } = {}) {
    let visible = true;
    let up = true;
    const c = createPresence({
      now: () => t,
      visible: () => visible,
      wantsStats: () => panel,
      send: async (kind) => {
        if (!up) throw new Error("offline");
        sent.push({ user, kind, at: t });
        if (kind === "beat") touch(user);
      },
    });
    c.start(member);
    return {
      c,
      hide() { visible = false; c.visibility(); },
      show() { visible = true; c.visibility(); },
      net(on: boolean) { up = on; if (on) c.online(); },
    };
  }

  /** Advance the clock in 15 s timer ticks; `active` users generate input on every tick. */
  async function advance(ms: number, tabs: ReturnType<typeof tab>[], active: ReturnType<typeof tab>[] = []) {
    const end = t + ms;
    while (t < end) {
      t = Math.min(end, t + 15_000);
      for (const x of active) x.c.activity();
      for (const x of tabs) x.c.tick();
      await Promise.resolve(); await Promise.resolve();
    }
  }
  const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
  return { tab, advance, flush, online, sent, beats: (u: string) => sent.filter((s) => s.user === u && s.kind === "beat").length, now: () => t };
}

describe("academy presence", () => {
  it("1. opening the Academy registers the member at once", async () => {
    const w = world();
    w.tab("admin");
    await w.flush();
    expect(w.online()).toBe(1);
    expect(w.sent[0]).toMatchObject({ kind: "beat" });
  });

  it("2-4. stays online while active, drops after 5 idle minutes, comes back on activity", async () => {
    const w = world();
    const a = w.tab("u1");
    await w.flush();
    await w.advance(10 * MIN, [a], [a]);
    expect(w.online()).toBe(1);
    // Steady state while active: roughly one beat a minute, not one per input event.
    expect(w.beats("u1")).toBeLessThanOrEqual(12);
    await w.advance(7 * MIN, [a]); // tab open, nobody touching it
    expect(w.online()).toBe(0);
    a.c.activity();
    await w.flush();
    expect(w.online()).toBe(1);
  });

  it("an open but idle tab stops beating instead of staying online forever", async () => {
    const w = world();
    const a = w.tab("u1");
    await w.flush();
    const before = w.beats("u1");
    await w.advance(60 * MIN, [a]);
    expect(w.beats("u1")).toBe(before);
    expect(w.online()).toBe(0);
  });

  it("5. two tabs for one member count once", async () => {
    const w = world();
    const t1 = w.tab("u1");
    const t2 = w.tab("u1");
    await w.flush();
    await w.advance(3 * MIN, [t1, t2], [t1, t2]);
    expect(w.online()).toBe(1);
  });

  it("6 + 9. a second member (an admin) joins: online becomes 2", async () => {
    const w = world();
    w.tab("member");
    await w.flush();
    expect(w.online()).toBe(1);
    w.tab("admin");
    await w.flush();
    expect(w.online()).toBe(2);
  });

  it("7. closing the browser: no more beats, presence expires after the window", async () => {
    const w = world();
    w.tab("u1");
    await w.flush();
    expect(w.online()).toBe(1);
    await w.advance(WINDOW + MIN, []); // tab gone: nothing ticks
    expect(w.online()).toBe(0);
  });

  it("8. network drop: stale presence expires; reconnect re-announces an active member", async () => {
    const w = world();
    const a = w.tab("u1");
    await w.flush();
    a.net(false);
    await w.advance(WINDOW + MIN, [a], [a]);
    expect(w.online()).toBe(0);
    a.net(true);
    await w.flush();
    expect(w.online()).toBe(1);
  });

  it("hidden tabs send nothing; returning to the tab beats immediately", async () => {
    const w = world();
    const a = w.tab("u1");
    await w.flush();
    a.hide();
    const n = w.sent.length;
    await w.advance(10 * MIN, [a], [a]);
    expect(w.sent.length).toBe(n);
    expect(w.online()).toBe(0);
    a.show();
    await w.flush();
    expect(w.online()).toBe(1);
  });

  it("10. a page refresh (new controller) recovers presence straight away", async () => {
    const w = world();
    w.tab("u1");
    await w.flush();
    await w.advance(6 * MIN, []);
    expect(w.online()).toBe(0);
    w.tab("u1"); // reloaded page
    await w.flush();
    expect(w.online()).toBe(1);
  });

  it("visitors who aren't members never beat; a visible stats panel refreshes about once a minute", async () => {
    const w = world();
    const v = w.tab("visitor", { member: false });
    await w.flush();
    await w.advance(5 * MIN, [v], [v]);
    expect(w.beats("visitor")).toBe(0);
    const reads = w.sent.filter((s) => s.kind === "stats").length;
    expect(reads).toBeGreaterThanOrEqual(5);
    expect(reads).toBeLessThanOrEqual(6);
    const quiet = w.tab("quiet", { member: false, panel: false });
    await w.advance(5 * MIN, [quiet]);
    expect(w.sent.filter((s) => s.user === "quiet").length).toBe(0);
  });

  it("stop() halts all traffic", async () => {
    const w = world();
    const a = w.tab("u1");
    await w.flush();
    a.c.stop();
    const n = w.sent.length;
    await w.advance(5 * MIN, [a], [a]);
    expect(w.sent.length).toBe(n);
    expect(HEARTBEAT_MS).toBe(STATS_REFRESH_MS);
  });
});
