/**
 * End-to-end bid finalization through the real export route handler and the real Postgres
 * functions. Only the Supabase transport, storage, and session lookup are stubbed.
 */
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { est, item } from "../helpers";
import { createUser, dbAvailable, freshDb } from "./harness";
import type { Estimate } from "@/lib/estimate/types";

const available = await dbAvailable();
const d = available ? describe : describe.skip;

const ctx: { pool?: Pool; userId?: string; estimates: Map<string, Estimate>; failPdf: boolean } = { estimates: new Map(), failPdf: false };

type Res = { data: unknown; error: { message: string } | null };
async function callRpc(name: string, params: Record<string, unknown> = {}, asUserId?: string): Promise<Res> {
  const keys = Object.keys(params);
  const sql = `select * from public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")})`;
  const values = keys.map((k) => (typeof params[k] === "object" && params[k] !== null ? JSON.stringify(params[k]) : params[k]));
  const c = await ctx.pool!.connect();
  try {
    await c.query("begin");
    if (asUserId) {
      await c.query("set local role authenticated");
      await c.query("select set_config('request.jwt.claim.sub', $1, true)", [asUserId]);
    }
    const r = await c.query(sql, values);
    await c.query("commit");
    return { data: r.rows, error: null };
  } catch (e) {
    await c.query("rollback");
    return { data: null, error: { message: (e as Error).message } };
  } finally {
    c.release();
  }
}
const table = () => ({ insert: async () => ({ error: null }), upsert: async () => ({ error: null }) });
const storage = { from: () => ({ upload: async () => ({ error: null }), createSignedUrl: async () => ({ data: { signedUrl: "https://files.test/doc.pdf" } }), download: async () => ({ data: null }) }) };

vi.mock("@/lib/supabase/server", () => ({
  getUser: async () => (ctx.userId ? { id: ctx.userId, email: "flow@test.dev", emailVerified: true, phone: null, phoneVerified: false, verified: true } : null),
  createClient: async () => ({ rpc: (n: string, p?: Record<string, unknown>) => callRpc(n, p, ctx.userId) }),
  createAdminClient: () => ({ rpc: (n: string, p?: Record<string, unknown>) => callRpc(n, p), from: table, storage }),
}));
vi.mock("@/lib/data/server", async () => {
  const { defaultBusinessProfile } = await import("@/lib/proposal/types");
  const { proposalConfigFrom } = await import("@/lib/data/mappers");
  return {
    loadEstimate: async (_s: unknown, id: string) => {
      const e = ctx.estimates.get(id);
      return e ? { estimate: e, proposalConfig: proposalConfigFrom(null), customerId: null } : null;
    },
    loadBusiness: async () => ({ business: { ...defaultBusinessProfile(), companyName: "Flow Builders" }, exists: true }),
  };
});
vi.mock("@/lib/http/api", async (orig) => ({ ...(await orig<typeof import("@/lib/http/api")>()), sameOrigin: async () => true, rateLimit: async () => true }));
vi.mock("@/lib/pdf/render", async (orig) => {
  const real = await orig<typeof import("@/lib/pdf/render")>();
  return { ...real, renderProposalPdf: async (...a: Parameters<typeof real.renderProposalPdf>) => { if (ctx.failPdf) throw new Error("render crashed"); return real.renderProposalPdf(...a); } };
});

const { POST } = await import("@/app/api/estimates/[id]/export/route");
const { GET } = await import("@/app/api/credits/route");

async function newBid(title: string): Promise<string> {
  const r = await ctx.pool!.query("insert into public.estimates (user_id, title) values ($1, $2) returning id", [ctx.userId, title]);
  const id = r.rows[0].id as string;
  ctx.estimates.set(id, est({ id, title, items: [item("g1", "10", "25")] }));
  return id;
}
async function exportBid(id: string) {
  const res = await POST(new Request(`http://test/api/estimates/${id}/export`, { method: "POST" }), { params: Promise.resolve({ id }) } as never);
  return { status: res.status, body: await res.json() };
}
const credits = async () => (await GET()).json();

d("full bid flow through the export route (database)", () => {
  let drop: () => Promise<void>;
  beforeAll(async () => {
    const db = await freshDb("b2b_test_export_flow");
    ctx.pool = db.pool; drop = db.drop;
    ctx.userId = await createUser(ctx.pool, "flow@test.dev");
  });
  afterAll(async () => { await drop?.(); });

  it("walks a free account from first bid to the upgrade prompt", async () => {
    expect(await credits()).toMatchObject({ starter: 3, monthly: 0, monthlyEligible: false, unlimited: false });

    // Second month: monthly credit available.
    await ctx.pool!.query("update public.credit_accounts set cycle_anchor = now() - interval '1 month 2 days' where user_id = $1", [ctx.userId]);
    expect(await credits()).toMatchObject({ starter: 3, monthly: 1 });

    const a = await newBid("Deck A");
    const first = await exportBid(a);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ charged: true, creditSource: "monthly", versionNumber: 1, credits: { starter: 3, monthly: 0 }, url: "https://files.test/doc.pdf" });

    // Re-download: same content, same version, free.
    expect((await exportBid(a)).body).toMatchObject({ charged: false, creditSource: "existing_version", versionNumber: 1 });

    // Edit the finalized bid and export again: new version, still free.
    ctx.estimates.set(a, { ...ctx.estimates.get(a)!, title: "Deck A (revised)" });
    expect((await exportBid(a)).body).toMatchObject({ charged: false, creditSource: "already_counted", versionNumber: 2 });

    // A failed PDF render spends nothing.
    const b = await newBid("Deck B");
    ctx.failPdf = true;
    const failed = await exportBid(b);
    ctx.failPdf = false;
    expect(failed.status).toBe(500);
    expect(failed.body.error.message).toMatch(/No bid credit was used/);
    expect(await credits()).toMatchObject({ starter: 3, monthly: 0 });

    for (const [id, left] of [[b, 2], [await newBid("C"), 1], [await newBid("D"), 0]] as const) {
      expect((await exportBid(id)).body).toMatchObject({ charged: true, creditSource: "starter", credits: { starter: left } });
    }

    const e = await newBid("E");
    const refused = await exportBid(e);
    expect(refused.status).toBe(402);
    expect(refused.body.error.code).toBe("credits_exhausted");
    const st = await ctx.pool!.query("select status, (select count(*)::int from public.estimate_versions where estimate_id = $1) n from public.estimates where id = $1", [e]);
    expect(st.rows[0]).toEqual({ status: "draft", n: 0 });

    // Older bids still update for free with zero credits.
    ctx.estimates.set(a, { ...ctx.estimates.get(a)!, title: "Deck A (v3)" });
    expect((await exportBid(a)).body).toMatchObject({ charged: false, creditSource: "already_counted", versionNumber: 3 });
  });
});
