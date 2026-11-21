/**
 * AI cost guard at the routes (Will meeting 2026-11-21, items B/C2/J). The guard's SQL is tested in
 * tests/db/ai-guard.test.ts; here the decisions it returns are wired to the right responses:
 *   - Practice / Demo sessions get a prebuilt sample: zero provider calls, labelled "Simulation"
 *   - a saved result comes back without a provider call; a busy lock and an exhausted free allowance
 *     answer 429 with a clear message and never call the provider
 *   - a provider error is finished as "failed" (no allowance used) and the contractor still gets a draft
 *   - Regenerate (fresh) is passed through; the kill switch and the daily company budget stop paid calls
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const EST = "22222222-2222-4222-8222-222222222222";
const S = {
  user: { id: "u1" } as { id: string; demo?: unknown },
  decision: { decision: "go", id: "g1", paid: false } as Record<string, unknown>,
  calls: [] as { fn: string; args: Record<string, unknown> }[],
  aiCalls: 0,
  aiFails: false,
  daySpend: 0,
};
const chain = () => {
  const c: Record<string, unknown> = {};
  for (const k of ["select", "eq", "gte", "order", "limit", "not", "in"]) c[k] = () => c;
  c.insert = async () => ({ error: null });
  c.then = (r: (v: unknown) => void) => r({ count: 0, data: [], error: null });
  return c;
};
const admin = {
  from: () => chain(),
  rpc: async (fn: string, args: Record<string, unknown>) => {
    S.calls.push({ fn, args });
    if (fn === "ai_guard_begin") return { data: S.decision, error: null };
    // $6 is under the $25 monthly ceiling and over the $5 daily one, whichever window is asked about.
    if (fn === "ai_generation_spend_since") return { data: S.daySpend, error: null };
    return { data: null, error: null };
  },
};
vi.mock("@/lib/supabase/server", () => ({ getUser: async () => S.user, createAdminClient: () => admin, createClient: async () => admin }));
vi.mock("@/lib/http/api", async (orig) => ({ ...(await orig<typeof import("@/lib/http/api")>()), rateLimit: async () => true, sameOrigin: async () => true, logError: () => {} }));
vi.mock("@/lib/ai/provider", async (orig) => {
  const real = await orig<typeof import("@/lib/ai/provider")>();
  return {
    ...real,
    generateStructured: async () => {
      S.aiCalls++;
      if (S.aiFails) throw new real.AiUnavailableError("down", "api_error");
      return { data: { scope: "Install composite decking on the new frame." }, model: "claude-haiku-5-5", inputTokens: 100, outputTokens: 50, costUsd: 0.0001 };
    },
  };
});
process.env.ANTHROPIC_API_KEY = "test-key";

const { POST: textPOST } = await import("@/app/api/ai/proposal-text/route");
const { POST: draftPOST } = await import("@/app/api/ai/bid-draft/route");
const input = { kind: "scope", style: "simple", trades: ["Decks"], tradeSlugs: ["decks"], projectTitle: "Deck", groups: [{ name: "Decking", items: [{ name: "Composite decking", quantity: "400", unit: "square foot", kind: "material" }] }] };
const req = (body: unknown) => new Request("https://built2bid.org/api/x", { method: "POST", body: JSON.stringify(body) });
const text = (extra: Record<string, unknown> = {}) => textPOST(req({ estimateId: EST, input, ...extra }));
const finishes = () => S.calls.filter((c) => c.fn === "ai_guard_finish").map((c) => c.args);

beforeEach(() => {
  S.user = { id: "u1" }; S.decision = { decision: "go", id: "g1", paid: false }; S.calls = []; S.aiCalls = 0; S.aiFails = false; S.daySpend = 0;
  delete process.env.AI_TEXT_GENERATION;
});

describe("AI cost guard routes", () => {
  it("Practice Mode: scope and Draft with AI answer with a labelled sample and never call the provider or the guard", async () => {
    S.user = { id: "u1", demo: { kind: "practice", owner: "u0", workspace: "w0" } };
    const r = await (await text()).json();
    expect(r).toMatchObject({ sample: true, status: "sample", engine: "rules" });
    expect(r.notice).toMatch(/Simulation — no real transaction/);
    const d = await (await draftPOST(req({ estimateId: EST, trade: "decks", description: "12x16 composite deck, ground level" }))).json();
    expect(d.sample).toBe(true);
    expect(d.lines.length).toBeGreaterThan(0);
    expect(d.lines.every((l: { ballparkUnitCost: unknown }) => l.ballparkUnitCost === null)).toBe(true);
    expect(S.aiCalls).toBe(0);
    expect(S.calls.some((c) => c.fn === "ai_guard_begin")).toBe(false);
  });

  it("a successful AI result is stored once, with its cost", async () => {
    const r = await (await text()).json();
    expect(r).toMatchObject({ engine: "ai", status: "ok" });
    expect(S.aiCalls).toBe(1);
    expect(finishes()).toEqual([expect.objectContaining({ p_id: "g1", p_status: "ok", p_engine: "ai", p_cost: 0.0001 })]);
    const begin = S.calls.find((c) => c.fn === "ai_guard_begin")!.args;
    expect(begin).toMatchObject({ p_user: "u1", p_action: "scope", p_estimate: EST, p_style: "simple", p_fresh: false });
    expect(String(begin.p_input_hash)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns the saved result without a provider call; busy and quota answer 429 without one", async () => {
    S.decision = { decision: "cached", id: "g0", result: { generator: "ai:x", scope: "Saved scope." } };
    expect(await (await text()).json()).toMatchObject({ cached: true, scope: "Saved scope." });
    S.decision = { decision: "busy" };
    const busy = await text();
    expect(busy.status).toBe(429);
    expect((await busy.json()).error.code).toBe("ai_busy");
    S.decision = { decision: "quota", latest: { scope: "Saved scope." } };
    const q = await text();
    expect(q.status).toBe(429);
    expect((await q.json()).error.message).toBe("You've used the free AI generation for this section. You can edit your existing result, or upgrade for additional generations.");
    S.decision = { decision: "quota_bids" };
    expect((await (await draftPOST(req({ estimateId: EST, trade: "decks", description: "12x16 composite deck, ground level" }))).json()).error.code).toBe("ai_quota_bids");
    expect(S.aiCalls).toBe(0);
  });

  it("a provider error is finished as failed (no allowance used) and the contractor still gets a rules draft", async () => {
    S.aiFails = true;
    const r = await (await text()).json();
    expect(r.engine).toBe("rules");
    expect(r.scope).toBeTruthy();
    expect(finishes()).toEqual([expect.objectContaining({ p_id: "g1", p_status: "failed", p_result: null })]);
    const d = await draftPOST(req({ estimateId: EST, trade: "decks", description: "12x16 composite deck, ground level" }));
    expect(d.status).toBe(502);
    expect(finishes().at(-1)).toMatchObject({ p_status: "failed" });
  });

  it("passes Regenerate through, and the kill switch / daily budget stop paid calls", async () => {
    await text({ fresh: true });
    expect(S.calls.find((c) => c.fn === "ai_guard_begin")!.args.p_fresh).toBe(true);
    S.calls = []; S.aiCalls = 0;
    process.env.AI_TEXT_GENERATION = "off";
    expect((await (await text()).json()).engine).toBe("rules");
    delete process.env.AI_TEXT_GENERATION;
    S.daySpend = 6;
    expect((await (await text()).json()).engine).toBe("rules");
    expect(S.aiCalls).toBe(0);
    expect(S.calls.some((c) => c.fn === "ai_guard_begin")).toBe(false);
  });
});
