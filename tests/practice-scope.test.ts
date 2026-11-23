/** Practice Mode applies only to the paid app (James 2026-11-23). */
import { describe, expect, it, vi } from "vitest";
import { inPracticeScope, isSwitchableRequest, PRACTICE_PAUSE_COOKIE } from "@/lib/demo/scope";
import { practiceSwap } from "@/lib/demo/swap";
import { DEMO_HINT_COOKIE, DEMO_RETURN_COOKIE } from "@/lib/demo/session";
import { decodeStash, encodeStash } from "@/lib/demo/stash";

const REAL = "11111111-1111-4111-8111-111111111111";
const PRACTICE = "22222222-2222-4222-8222-222222222222";
const WS = "33333333-3333-4333-8333-333333333333";
const practiceMeta = { b2b_demo: { kind: "practice", owner: REAL, workspace: WS } };

describe("practice scope", () => {
  it("covers /dashboard and the paid app menu pages", () => {
    for (const p of ["/dashboard", "/dashboard/customers", "/dashboard/items", "/dashboard/templates", "/home", "/projects", "/projects/workforce",
      "/financials", "/financials/cash", "/company", "/company/business-config", "/company/ai-automation", "/settings/company", "/settings/account",
      "/bids", "/bids/roofing", "/builder", "/start/roofing", "/estimates/abc", "/clock", "/search"]) expect(inPracticeScope(p), p).toBe(true);
  });
  it("leaves out the Academy, news, mentorship, public site, hubs, admin and legal", () => {
    for (const p of ["/", "/academy", "/academy/classroom", "/learn", "/industry", "/learning", "/mentorship", "/whats-new", "/pricing", "/legal", "/terms",
      "/sales", "/sales/hub", "/affiliate-hub", "/admin", "/admin/legal", "/staff", "/company/join/abc", "/login", "/dashboardx"]) expect(inPracticeScope(p), p).toBe(false);
  });
  it("switches only on page loads, client navigations and server actions, never on prefetch or assets", () => {
    const h = (o: Record<string, string>) => ({ get: (n: string) => o[n] ?? null });
    expect(isSwitchableRequest("GET", h({ "sec-fetch-dest": "document" }))).toBe(true);
    expect(isSwitchableRequest("GET", h({ rsc: "1" }))).toBe(true);
    expect(isSwitchableRequest("POST", h({ "next-action": "abc" }))).toBe(true);
    expect(isSwitchableRequest("GET", h({ rsc: "1", "next-router-prefetch": "1" }))).toBe(false);
    expect(isSwitchableRequest("GET", h({ "sec-fetch-dest": "image" }))).toBe(false);
    expect(isSwitchableRequest("POST", h({}))).toBe(false);
  });
});

function fakeSupabase(current: { id: string; rt: string }, sessions: Record<string, { id: string; app_metadata: unknown } | "error">) {
  let now = current;
  const setSession = vi.fn(async (s: { refresh_token: string }) => { now = { id: now.id, rt: s.refresh_token }; return { error: null }; });
  return {
    client: {
      auth: {
        getSession: async () => ({ data: { session: { access_token: "at", refresh_token: now.rt, user: { id: now.id } } } }),
        refreshSession: async ({ refresh_token }: { refresh_token: string }) => {
          const r = sessions[refresh_token];
          if (!r || r === "error") return { data: { user: null, session: null }, error: new Error("bad") };
          now = { id: r.id, rt: `${refresh_token}-next` };
          return { data: { user: r, session: {} }, error: null };
        },
        setSession,
      },
    } as never,
    setSession,
    now: () => now,
  };
}
const jar = (o: Record<string, string>) => (n: string) => o[n];
const op = (r: { cookies: { name: string; value: string; maxAge: number }[] }, n: string) => r.cookies.find((c) => c.name === n);

describe("practice swap", () => {
  it("pauses practice outside the paid app and goes back to the real account", async () => {
    const f = fakeSupabase({ id: PRACTICE, rt: "prt" }, { rrt: { id: REAL, app_metadata: {} } });
    const r = await practiceSwap(f.client, "/academy", { sub: PRACTICE, app_metadata: practiceMeta }, jar({ [DEMO_RETURN_COOKIE]: encodeStash({ rt: "rrt", uid: REAL }) }));
    expect(r.swapped).toBe("paused");
    expect(f.now().id).toBe(REAL);
    expect(decodeStash(op(r, PRACTICE_PAUSE_COOKIE)!.value)).toEqual({ rt: "prt", uid: PRACTICE });
    expect(op(r, DEMO_RETURN_COOKIE)!.maxAge).toBe(0);
    expect(op(r, DEMO_HINT_COOKIE)!.maxAge).toBe(0);
  });
  it("stays in practice on paid app pages", async () => {
    const f = fakeSupabase({ id: PRACTICE, rt: "prt" }, {});
    const r = await practiceSwap(f.client, "/dashboard", { sub: PRACTICE, app_metadata: practiceMeta }, jar({ [DEMO_RETURN_COOKIE]: encodeStash({ rt: "rrt", uid: REAL }) }));
    expect(r.swapped).toBeNull();
    expect(f.now().id).toBe(PRACTICE);
  });
  it("puts the practice session back if the real one can't be restored", async () => {
    const f = fakeSupabase({ id: PRACTICE, rt: "prt" }, { rrt: "error" });
    const r = await practiceSwap(f.client, "/academy", { sub: PRACTICE, app_metadata: practiceMeta }, jar({ [DEMO_RETURN_COOKIE]: encodeStash({ rt: "rrt", uid: REAL }) }));
    expect(r.swapped).toBeNull();
    expect(f.setSession).toHaveBeenCalledWith({ access_token: "at", refresh_token: "prt" });
  });
  it("resumes the paused practice back in the paid app", async () => {
    const f = fakeSupabase({ id: REAL, rt: "rrt2" }, { prt: { id: PRACTICE, app_metadata: practiceMeta } });
    const r = await practiceSwap(f.client, "/dashboard", { sub: REAL, app_metadata: {} }, jar({ [PRACTICE_PAUSE_COOKIE]: encodeStash({ rt: "prt", uid: PRACTICE }) }));
    expect(r.swapped).toBe("resumed");
    expect(f.now().id).toBe(PRACTICE);
    expect(decodeStash(op(r, DEMO_RETURN_COOKIE)!.value)).toEqual({ rt: "rrt2", uid: REAL });
    expect(op(r, DEMO_HINT_COOKIE)!.value).toBe("practice");
    expect(op(r, PRACTICE_PAUSE_COOKIE)!.maxAge).toBe(0);
  });
  it("never resumes someone else's practice and forgets it", async () => {
    const other = "44444444-4444-4444-8444-444444444444";
    const f = fakeSupabase({ id: other, rt: "ort" }, { prt: { id: PRACTICE, app_metadata: practiceMeta } });
    const r = await practiceSwap(f.client, "/dashboard", { sub: other, app_metadata: {} }, jar({ [PRACTICE_PAUSE_COOKIE]: encodeStash({ rt: "prt", uid: PRACTICE }) }));
    expect(r.swapped).toBeNull();
    expect(f.setSession).toHaveBeenCalledWith({ access_token: "at", refresh_token: "ort" });
    expect(op(r, PRACTICE_PAUSE_COOKIE)!.maxAge).toBe(0);
  });
  it("leaves the real account alone outside the paid app", async () => {
    const f = fakeSupabase({ id: REAL, rt: "rrt" }, {});
    const r = await practiceSwap(f.client, "/academy", { sub: REAL, app_metadata: {} }, jar({ [PRACTICE_PAUSE_COOKIE]: encodeStash({ rt: "prt", uid: PRACTICE }) }));
    expect(r).toEqual({ swapped: null, cookies: [] });
  });
});
