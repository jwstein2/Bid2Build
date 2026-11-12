import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createUser, dbAvailable, freshDb } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;

let pool: Pool;
let drop: () => Promise<void>;
const hash = (n: number) => n.toString(16).padStart(64, "0");

async function newEstimate(userId: string): Promise<string> {
  const r = await pool.query("insert into public.estimates (user_id, title) values ($1, 'Test') returning id", [userId]);
  return r.rows[0].id;
}
function exportVersion(userId: string, estimateId: string, h: string) {
  return pool.query(
    "select * from public.record_export($1, $2, $3, '{}'::jsonb, '{}'::jsonb, 100, 125, 0, 125)",
    [userId, estimateId, h],
  );
}

d("free quota and exports (database)", () => {
  beforeAll(async () => { ({ pool, drop } = await freshDb("byb_test_quota")); });
  afterAll(async () => { await drop?.(); });

  it("10. allows exactly three finalized exports per month for free users", async () => {
    const u = await createUser(pool, "free@test.dev");
    const e = await newEstimate(u);
    for (let i = 1; i <= 3; i++) {
      const r = await exportVersion(u, e, hash(i));
      expect(r.rows[0].charged).toBe(true);
      expect(r.rows[0].exports_used).toBe(i);
      expect(r.rows[0].version_number).toBe(i);
    }
    await expect(exportVersion(u, e, hash(4))).rejects.toThrow(/quota_exceeded/);
    const v = await pool.query("select count(*)::int as n from public.estimate_versions where estimate_id = $1", [e]);
    expect(v.rows[0].n).toBe(3);
    // The estimate itself is untouched by a refused export.
    const est = await pool.query("select title from public.estimates where id = $1", [e]);
    expect(est.rows[0].title).toBe("Test");
  });

  it("13. re-downloading the same finalized version does not consume a credit (even at the limit)", async () => {
    const u = await createUser(pool, "idem@test.dev");
    const e = await newEstimate(u);
    const first = await exportVersion(u, e, hash(10));
    const again = await exportVersion(u, e, hash(10));
    expect(again.rows[0].charged).toBe(false);
    expect(again.rows[0].version_id).toBe(first.rows[0].version_id);
    await exportVersion(u, e, hash(11));
    await exportVersion(u, e, hash(12));
    const atLimit = await exportVersion(u, e, hash(10));
    expect(atLimit.rows[0].charged).toBe(false);
    expect(atLimit.rows[0].exports_used).toBe(3);
  });

  it("12. concurrent export requests cannot exceed the free allowance", async () => {
    const u = await createUser(pool, "race@test.dev");
    const e = await newEstimate(u);
    const results = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => exportVersion(u, e, hash(100 + i))));
    const ok = results.filter((r) => r.status === "fulfilled");
    const refused = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(3);
    expect(refused).toHaveLength(9);
    const c = await pool.query("select exports_used from public.usage_counters where user_id = $1", [u]);
    expect(c.rows[0].exports_used).toBe(3);
  });

  it("12b. concurrent identical requests create one version and charge once", async () => {
    const u = await createUser(pool, "race2@test.dev");
    const e = await newEstimate(u);
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => exportVersion(u, e, hash(500))));
    const ok = results.filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled");
    expect(ok.length).toBe(6);
    expect(ok.filter((r) => r.value.rows[0].charged).length).toBe(1);
    const c = await pool.query("select exports_used from public.usage_counters where user_id = $1", [u]);
    expect(c.rows[0].exports_used).toBe(1);
  });

  it("11. quota resets on the 1st of the month at 00:00 UTC", async () => {
    const p = (ts: string) => pool.query("select public.quota_period_start($1::timestamptz)::text as d", [ts]).then((r) => r.rows[0].d);
    expect(await p("2026-11-30T23:59:59Z")).toBe("2026-11-01");
    expect(await p("2026-12-01T00:00:00Z")).toBe("2026-12-01");
    // 7pm Nov 30 in New York is already December in UTC.
    expect(await p("2026-11-30T19:00:00-05:00")).toBe("2026-12-01");

    const u = await createUser(pool, "reset@test.dev");
    const e = await newEstimate(u);
    // Simulate a fully used previous month.
    await pool.query("insert into public.usage_counters (user_id, period_start, exports_used) values ($1, (public.quota_period_start() - interval '1 month')::date, 3)", [u]);
    const r = await exportVersion(u, e, hash(900));
    expect(r.rows[0].charged).toBe(true);
    expect(r.rows[0].exports_used).toBe(1);
  });

  it("requires a verified email on the account", async () => {
    const u = await createUser(pool, "unverified@test.dev", false);
    const e = await newEstimate(u);
    await expect(exportVersion(u, e, hash(1))).rejects.toThrow(/email_not_verified/);
  });

  it("cannot export another user's estimate", async () => {
    const a = await createUser(pool, "a-owner@test.dev");
    const b = await createUser(pool, "b-thief@test.dev");
    const e = await newEstimate(a);
    await expect(exportVersion(b, e, hash(1))).rejects.toThrow(/estimate_not_found/);
  });

  it("end users cannot call record_export or write usage counters directly", async () => {
    const u = await createUser(pool, "direct@test.dev");
    const e = await newEstimate(u);
    await expect(asUser(pool, u, (q) => q("select * from public.record_export($1, $2, $3, '{}', '{}', 0, 0, 0, 0)", [u, e, hash(1)]))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, u, (q) => q("update public.usage_counters set exports_used = 0 where user_id = $1", [u]))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, u, (q) => q("insert into public.subscriptions (stripe_subscription_id, user_id, stripe_customer_id, status, source_event_created) values ('sub_x', $1, 'cus_x', 'active', now())", [u]))).rejects.toThrow(/permission denied/);
  });

  it("quota_status reports usage for the signed-in user only", async () => {
    const u = await createUser(pool, "status@test.dev");
    const e = await newEstimate(u);
    await exportVersion(u, e, hash(77));
    const s = await asUser(pool, u, (q) => q("select * from public.quota_status()"));
    expect(s.rows[0].exports_used).toBe(1);
    expect(s.rows[0].export_limit).toBe(3);
    expect(s.rows[0].unlimited).toBe(false);
    expect(new Date(s.rows[0].resets_at).getUTCDate()).toBe(1);
    expect(new Date(s.rows[0].resets_at).getUTCHours()).toBe(0);
  });
});

d("subscriptions and entitlement (database)", () => {
  beforeAll(async () => { ({ pool, drop } = await freshDb("byb_test_subs")); });
  afterAll(async () => { await drop?.(); });

  const apply = (u: string, status: string, eventAt: string, periodEnd = "2099-01-01T00:00:00Z", subId = "sub_1") =>
    pool.query(
      "select public.apply_subscription_update($1, 'cus_' || $5, $5, $2, 'monthly', 'price_m', $4::timestamptz, false, null, null, $3::timestamptz) as applied",
      [u, status, eventAt, periodEnd, subId],
    );
  const unlimited = (u: string) => pool.query("select public.has_unlimited($1) as v", [u]).then((r) => r.rows[0].v);

  it("14. activating a subscription grants unlimited exports beyond the free limit", async () => {
    const u = await createUser(pool, "paid@test.dev");
    const e = (await pool.query("insert into public.estimates (user_id) values ($1) returning id", [u])).rows[0].id;
    for (let i = 1; i <= 3; i++) await exportVersion(u, e, hash(i));
    await expect(exportVersion(u, e, hash(4))).rejects.toThrow(/quota_exceeded/);
    await apply(u, "active", "2026-11-01T00:00:00Z");
    expect(await unlimited(u)).toBe(true);
    for (let i = 4; i <= 8; i++) {
      const r = await exportVersion(u, e, hash(i));
      expect(r.rows[0].charged).toBe(true);
      expect(r.rows[0].unlimited).toBe(true);
    }
  });

  it("15. cancellation and expiration remove unlimited access", async () => {
    const u = await createUser(pool, "cancel@test.dev");
    await apply(u, "active", "2026-11-01T00:00:00Z", "2099-01-01T00:00:00Z", "sub_c");
    expect(await unlimited(u)).toBe(true);
    // canceled at period end -> still active until then
    await pool.query("update public.subscriptions set cancel_at_period_end = true where stripe_subscription_id = 'sub_c'");
    expect(await unlimited(u)).toBe(true);
    await apply(u, "canceled", "2026-11-02T00:00:00Z", "2026-11-02T00:00:00Z", "sub_c");
    expect(await unlimited(u)).toBe(false);

    const v = await createUser(pool, "expired@test.dev");
    await apply(v, "active", "2026-11-01T00:00:00Z", "2020-01-01T00:00:00Z", "sub_exp");
    expect(await unlimited(v)).toBe(false); // period ended

    const w = await createUser(pool, "unpaid@test.dev");
    await apply(w, "unpaid", "2026-11-01T00:00:00Z", "2099-01-01T00:00:00Z", "sub_unpaid");
    expect(await unlimited(w)).toBe(false);
  });

  it("ignores out-of-order (older) Stripe events", async () => {
    const u = await createUser(pool, "order@test.dev");
    await apply(u, "canceled", "2026-11-05T00:00:00Z", "2026-11-05T00:00:00Z", "sub_o");
    const r = await apply(u, "active", "2026-11-01T00:00:00Z", "2099-01-01T00:00:00Z", "sub_o");
    expect(r.rows[0].applied).toBe(false);
    expect(await unlimited(u)).toBe(false);
  });
});
