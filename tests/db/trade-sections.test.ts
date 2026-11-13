/**
 * Trade sections survive a real save → reload: the save route handler runs against the real
 * save_estimate function, and the real loadEstimate reads the rows back (RLS on, as the user).
 * Proves section trades persist with the existing schema (no migration).
 */
import pg, { type Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createUser, dbAvailable, freshDb, type Row } from "./harness";
import { createEstimate } from "@/lib/estimate/factory";
import { addTrade, removeTrade, tradeBlocks } from "@/lib/estimate/trades";
import { computeEstimate } from "@/lib/estimate/engine";
import { defaultProposalConfig } from "@/lib/proposal/types";
import type { Estimate } from "@/lib/estimate/types";

// PostgREST returns dates and numerics as strings; make node-postgres do the same.
pg.types.setTypeParser(1082, (v: string) => v);
pg.types.setTypeParser(1700, (v: string) => v);

const available = await dbAvailable();
const d = available ? describe : describe.skip;
const ctx: { pool?: Pool; userId?: string } = {};

async function asUserQuery(sql: string, values: unknown[]): Promise<Row[]> {
  const c = await ctx.pool!.connect();
  try {
    await c.query("begin");
    await c.query("set local role authenticated");
    await c.query("select set_config('request.jwt.claim.sub', $1, true)", [ctx.userId]);
    const r = await c.query(sql, values);
    await c.query("commit");
    return r.rows;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}

/** Just enough of the Supabase client for the save route and loadEstimate. */
function fakeSupabase() {
  return {
    rpc: async (name: string, p: Record<string, unknown>) => {
      try {
        await asUserQuery(`select public.${name}(p => $1)`, [JSON.stringify(p.p)]);
        return { data: null, error: null };
      } catch (e) {
        return { data: null, error: { message: (e as Error).message, code: "" } };
      }
    },
    from: (table: string) => {
      const where: [string, unknown][] = [];
      let order = "";
      const run = async () => {
        const sql = `select * from public.${table}${where.length ? ` where ${where.map(([c], i) => `${c} = $${i + 1}`).join(" and ")}` : ""}${order ? ` order by ${order}` : ""}`;
        try { return { data: await asUserQuery(sql, where.map(([, v]) => v)), error: null }; }
        catch (e) { return { data: null, error: { message: (e as Error).message } }; }
      };
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => { where.push([c, v]); return q; },
        order: (c: string) => { order = c; return q; },
        maybeSingle: async () => { const r = await run(); return { data: r.data?.[0] ?? null, error: r.error }; },
        then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => run().then(ok, bad),
      };
      return q;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  getUser: async () => ({ id: ctx.userId, email: "trades@test.dev", emailVerified: true }),
  createClient: async () => fakeSupabase(),
}));
vi.mock("@/lib/http/api", async (orig) => ({ ...(await orig<typeof import("@/lib/http/api")>()), sameOrigin: async () => true }));
vi.mock("@/lib/market/server", () => ({ saveProjectProfile: async () => {} }));

async function save(estimate: Estimate) {
  const { POST } = await import("@/app/api/estimates/save/route");
  const res = await POST(new Request("http://localhost/api/estimates/save", { method: "POST", body: JSON.stringify({ estimate, proposalConfig: defaultProposalConfig() }) }));
  if (res.status !== 200) throw new Error(`save failed: ${res.status} ${await res.text()}`);
}
async function load(id: string) {
  const { loadEstimate } = await import("@/lib/data/server");
  const r = await loadEstimate(fakeSupabase() as never, id);
  return r!.estimate;
}

function priced(e: Estimate, slug: string, cost: string): Estimate {
  const g = tradeBlocks(e).find((b) => b.trade === slug)!.groups[0];
  return { ...e, items: [...e.items, { id: crypto.randomUUID(), groupId: g.id, name: `${slug} line`, costType: "material", treatment: "marked_up", quantity: "1", unit: "each", unitCost: cost, taxable: true, showOnProposal: true, sortOrder: 0 }] };
}

d("trade sections persist with the existing schema", () => {
  beforeAll(async () => {
    const db = await freshDb("b2b_trade_sections");
    ctx.pool = db.pool;
    ctx.userId = await createUser(db.pool, "trades@test.dev");
    afterAll(db.drop);
  });

  it("a multi-trade estimate reloads with every section under its trade, in order, with the same totals", async () => {
    let e = { ...createEstimate("decks"), title: "Whole Home Renovation", customer: { name: "Pat" } };
    for (const t of ["concrete", "roofing", "siding"]) e = addTrade(e, t);
    e = priced(priced(e, "roofing", "900"), "decks", "1200");
    await save(e);
    const back = await load(e.id);
    expect(back.trades).toEqual(["decks", "concrete", "roofing", "siding"]);
    expect(tradeBlocks(back).map((b) => [b.trade, b.groups.map((g) => g.id)])).toEqual(tradeBlocks(e).map((b) => [b.trade, b.groups.map((g) => g.id)]));
    expect(computeEstimate(back).total.toFixed(2)).toBe(computeEstimate(e).total.toFixed(2));
    expect(back.worksheet).toBeNull();

    // Saving again (autosave after a reload) doesn't duplicate anything.
    await save(back);
    const again = await load(e.id);
    expect(again.groups).toHaveLength(e.groups.length);
    expect(again.items).toHaveLength(2);
  });

  it("removing a trade removes only its rows", async () => {
    let e = { ...createEstimate("decks"), customer: { name: "Pat" } };
    e = priced(priced(addTrade(e, "roofing"), "roofing", "500"), "decks", "100");
    await save(e);
    const removed = removeTrade(await load(e.id), "roofing")!.estimate;
    await save(removed);
    const back = await load(e.id);
    expect(back.trades).toEqual(["decks"]);
    expect(back.items.map((i) => i.name)).toEqual(["decks line"]);
    expect(back.groups.every((g) => g.trade === "decks")).toBe(true);
  });
});
