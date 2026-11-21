/**
 * AI cost guard (20270219002000), against the real SQL (Will meeting 2026-11-21, items B/C2/J):
 *   - same input returns the saved result (no new pending row = no paid call); different style is separate
 *   - a pending generation locks double clicks; failures release the lock and use no allowance
 *   - free allowance (enforced): one successful AI result per action+style per bid; duplicate bids are
 *     capped per month; paying accounts are never limited and may ask for a fresh result
 *   - RLS: a person reads only their own rows and can't write any; the functions are service-role only
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createUser, dbAvailable, freshDb } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
const H = (c: string) => c.repeat(64).slice(0, 64);
const B1 = "11111111-1111-4111-8111-111111111111", B2 = "22222222-2222-4222-8222-222222222222", B3 = "33333333-3333-4333-8333-333333333333";

d("AI cost guard (database)", () => {
  let free: string, paid: string, other: string;
  const begin = async (u: string, action: string, est: string | null, style: string, hash: string, enforce = false, bids = 4, fresh = false) =>
    (await pool.query("select public.ai_guard_begin($1, $2, $3, $4, $5, $6, $7, $8) r", [u, action, est, style, hash, enforce, bids, fresh])).rows[0].r;
  const finish = (id: string, status: string, result: unknown = null, cost = 0.001) =>
    pool.query("select public.ai_guard_finish($1, $2, $3, $4, $5)", [id, status, status === "ok" ? "ai" : null, result === null ? null : JSON.stringify(result), cost]);

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_ai_guard"));
    free = await createUser(pool, "free@test.local");
    paid = await createUser(pool, "paid@test.local");
    other = await createUser(pool, "other@test.local");
    await pool.query("select public.apply_subscription_update($1, 'cus_p', 'sub_p', 'active', 'monthly', 'price_m', '2099-01-01', false, null, null, now())", [paid]);
  }, 120_000);
  afterAll(async () => { if (drop) await drop(); });

  it("reuses the same input's saved result, keeps styles separate, and locks double clicks", async () => {
    const g = await begin(free, "scope", B1, "simple", H("a"));
    expect(g.decision).toBe("go");
    expect((await begin(free, "scope", B1, "simple", H("a"))).decision).toBe("busy"); // double click while generating
    expect((await begin(free, "scope", B1, "detailed", H("a"))).decision).toBe("go"); // another style is its own slot
    await finish(g.id, "ok", { scope: "Install deck." });
    const again = await begin(free, "scope", B1, "simple", H("a"));
    expect(again).toMatchObject({ decision: "cached", result: { scope: "Install deck." } });
  });

  it("a failed call releases the lock and uses no allowance, even when enforced", async () => {
    const g = await begin(free, "exclusions", B1, "simple", H("b"), true);
    expect(g.decision).toBe("go");
    await finish(g.id, "failed");
    const row = (await pool.query("select status, result, engine from public.ai_generation_results where id = $1", [g.id])).rows[0];
    expect(row).toMatchObject({ status: "failed", result: null, engine: null });
    const retry = await begin(free, "exclusions", B1, "simple", H("b"), true);
    expect(retry.decision).toBe("go"); // retry after a provider error is not a new use
    await finish(retry.id, "ok", { items: [] });
  });

  it("free allowance: one AI result per action+style per bid; changed input gets the existing result back", async () => {
    const g = await begin(free, "bid_draft", B2, "decks", H("c"), true);
    await finish(g.id, "ok", { lines: [1] });
    expect((await begin(free, "bid_draft", B2, "decks", H("c"), true)).decision).toBe("cached"); // same input: free, no quota
    const q = await begin(free, "bid_draft", B2, "decks", H("d"), true); // changed prompt
    expect(q).toMatchObject({ decision: "quota", latest: { result: { lines: [1] } } });
    expect((await begin(free, "bid_draft", B2, "decks", H("d"), false)).decision).toBe("go"); // flag off: unchanged behaviour
  });

  it("duplicating a bid doesn't create unlimited allowances: AI bids per month are capped", async () => {
    // free already used AI on B1 and B2 this month; cap 2 refuses a third bid, but B1 itself still works.
    expect((await begin(free, "scope", B3, "simple", H("e"), true, 2)).decision).toBe("quota_bids");
    expect((await begin(free, "scope", B1, "professional", H("e"), true, 2)).decision).toBe("go");
  });

  it("paying accounts are never limited and may regenerate (fresh)", async () => {
    const g = await begin(paid, "scope", B1, "simple", H("f"), true);
    expect(g).toMatchObject({ decision: "go", paid: true });
    await finish(g.id, "ok", { scope: "A" });
    expect((await begin(paid, "scope", B1, "simple", H("f"), true)).decision).toBe("cached");
    const fresh = await begin(paid, "scope", B1, "simple", H("f"), true, 4, true);
    expect(fresh.decision).toBe("go");
    await finish(fresh.id, "ok", { scope: "B" });
    expect((await begin(paid, "scope", B1, "simple", H("9"), true)).decision).toBe("go"); // changed input: no quota
    // fresh is ignored for a free account: it still gets its saved result
    expect((await begin(free, "scope", B1, "detailed", H("a"), true, 4, true)).decision).not.toBe("go");
  });

  it("each person reads only their own results and nobody can write or call the functions directly", async () => {
    const mine = await asUser(pool, other, (q) => q("select count(*)::int n from public.ai_generation_results"));
    expect(mine.rows[0].n).toBe(0);
    const theirs = await asUser(pool, free, (q) => q("select count(*)::int n from public.ai_generation_results"));
    expect(theirs.rows[0].n).toBeGreaterThan(0);
    await expect(asUser(pool, other, (q) => q("insert into public.ai_generation_results (user_id, action, input_hash) values ($1, 'scope', $2)", [other, H("8")]))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, free, (q) => q("update public.ai_generation_results set result = '{}'::jsonb"))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, other, (q) => q("select public.ai_guard_begin($1, 'scope', null, '', $2)", [other, H("8")]))).rejects.toThrow(/permission denied/);
  });
});
