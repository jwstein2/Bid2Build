import type { Pool, QueryResult } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigration, asUser, createUser, dbAvailable, freshDb, type Row } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
const MIGRATION = "20261112000500_two_balance_credits.sql";

let pool: Pool;
let drop: () => Promise<void>;
let seq = 0;
const hash = () => (++seq).toString(16).padStart(64, "0");

async function newEstimate(userId: string): Promise<string> {
  const r = await pool.query("insert into public.estimates (user_id, title) values ($1, 'Bid') returning id", [userId]);
  return r.rows[0].id;
}
function finalize(userId: string, estimateId: string, h = hash()): Promise<QueryResult<Row>> {
  return pool.query(
    "select * from public.finalize_bid($1, $2, $3, '{}'::jsonb, '{}'::jsonb, 100, 125, 0, 125)",
    [userId, estimateId, h],
  );
}
const status = (u: string) => asUser(pool, u, (q) => q("select * from public.credit_status()")).then((r) => r.rows[0]);
/** Move the account's signup anchor so "now" falls `months` cycles (plus a few days) after signup. */
const ageAccount = (u: string, months: number) =>
  pool.query("update public.credit_accounts set cycle_anchor = now() - make_interval(months => $2, days => 3) where user_id = $1", [u, months]);

d("two-balance credits (database)", () => {
  beforeAll(async () => { ({ pool, drop } = await freshDb("b2b_test_credits")); });
  afterAll(async () => { await drop?.(); });

  describe("starter credits", () => {
    it("grants 3 starter credits to a verified account, and no monthly credit in the first month", async () => {
      const u = await createUser(pool, "starter@test.dev");
      const s = await status(u);
      expect(s).toMatchObject({ starter_balance: 3, starter_total: 3, monthly_balance: 0, monthly_eligible: false, cycle_index: 0, unlimited: false, email_verified: true });
    });

    it("waits for email verification before granting, then grants once", async () => {
      const u = await createUser(pool, "later@test.dev", false);
      expect(await status(u)).toMatchObject({ starter_balance: 0, email_verified: false, starter_granted: false });
      await pool.query("update auth.users set email_confirmed_at = now() where id = $1", [u]);
      expect((await status(u)).starter_balance).toBe(3);
      expect((await status(u)).starter_balance).toBe(3);
      const g = await pool.query("select count(*)::int n, sum(amount)::int total from public.credit_ledger where user_id = $1 and kind = 'starter_grant'", [u]);
      expect(g.rows[0]).toEqual({ n: 1, total: 3 });
    });

    it("concurrent first visits grant the bonus exactly once", async () => {
      const u = await createUser(pool, "burst@test.dev");
      await Promise.all(Array.from({ length: 10 }, () => pool.query("select public.ensure_credit_account($1)", [u])));
      const a = await pool.query("select starter_balance from public.credit_accounts where user_id = $1", [u]);
      expect(a.rows[0].starter_balance).toBe(3);
      const g = await pool.query("select count(*)::int n from public.credit_ledger where user_id = $1 and kind = 'starter_grant'", [u]);
      expect(g.rows[0].n).toBe(1);
    });

    it("does not grant a second bonus when the same email deletes and re-creates its account", async () => {
      const u = await createUser(pool, "Repeat@Test.dev");
      expect((await status(u)).starter_balance).toBe(3);
      await pool.query("delete from auth.users where id = $1", [u]);
      const again = await createUser(pool, "  repeat@test.dev ");
      expect(await status(again)).toMatchObject({ starter_balance: 0, starter_granted: true });
    });

    it("starter credits never replenish: after 3 bids in month one, the 4th is refused", async () => {
      const u = await createUser(pool, "spend@test.dev");
      for (let i = 0; i < 3; i++) {
        const r = await finalize(u, await newEstimate(u));
        expect(r.rows[0]).toMatchObject({ charged: true, credit_source: "starter", starter_balance: 2 - i });
      }
      const e = await newEstimate(u);
      await expect(finalize(u, e)).rejects.toThrow(/credits_exhausted/);
      const v = await pool.query("select count(*)::int n from public.estimate_versions where estimate_id = $1", [e]);
      expect(v.rows[0].n).toBe(0);
      const st = await pool.query("select status from public.estimates where id = $1", [e]);
      expect(st.rows[0].status).toBe("draft");
    });
  });

  describe("monthly credits", () => {
    it("starts in the second cycle and is spent before starter credits", async () => {
      const u = await createUser(pool, "priority@test.dev");
      await status(u);
      await ageAccount(u, 1);
      expect(await status(u)).toMatchObject({ starter_balance: 3, monthly_balance: 1, monthly_eligible: true, cycle_index: 1 });
      const first = await finalize(u, await newEstimate(u));
      expect(first.rows[0]).toMatchObject({ credit_source: "monthly", charged: true, starter_balance: 3, monthly_balance: 0 });
      const second = await finalize(u, await newEstimate(u));
      expect(second.rows[0]).toMatchObject({ credit_source: "starter", starter_balance: 2, monthly_balance: 0 });
    });

    it("never accumulates: months of inactivity still leave a balance of 1", async () => {
      const u = await createUser(pool, "idle@test.dev");
      await status(u);
      await ageAccount(u, 7);
      expect(await status(u)).toMatchObject({ monthly_balance: 1, cycle_index: 7 });
    });

    it("an unused monthly credit expires at cycle end and resets to 1 (not 2) next cycle", async () => {
      const u = await createUser(pool, "expire@test.dev");
      await status(u);
      await ageAccount(u, 2); // cycle 2, cycle 1's credit was never used
      expect((await status(u)).monthly_balance).toBe(1);
      await finalize(u, await newEstimate(u)); // spend cycle 2's credit
      expect((await status(u)).monthly_balance).toBe(0);
      await ageAccount(u, 3); // next cycle
      expect((await status(u)).monthly_balance).toBe(1);
      const used = await pool.query("select cycle_index from public.credit_ledger where user_id = $1 and kind = 'monthly_spend'", [u]);
      expect(used.rows.map((r) => r.cycle_index)).toEqual([2]);
    });

    it("reports when the current credit expires / the next one arrives", async () => {
      const u = await createUser(pool, "next@test.dev");
      await status(u);
      await pool.query("update public.credit_accounts set cycle_anchor = now() - interval '10 days' where user_id = $1", [u]);
      const s = await status(u);
      const expected = await pool.query("select public.credit_cycle_start(cycle_anchor, 1) t from public.credit_accounts where user_id = $1", [u]);
      expect(new Date(s.next_cycle_at).getTime()).toBe(new Date(expected.rows[0].t).getTime());
    });
  });

  describe("cycle boundaries", () => {
    const idx = (anchor: string, at: string) => pool.query("select public.credit_cycle_index($1::timestamptz, $2::timestamptz) n", [anchor, at]).then((r) => r.rows[0].n);
    const start = (anchor: string, n: number) => pool.query("select to_char(public.credit_cycle_start($1::timestamptz, $2) at time zone 'utc', 'YYYY-MM-DD HH24:MI') s", [anchor, n]).then((r) => r.rows[0].s);

    it("uses the signup anniversary, to the minute", async () => {
      expect(await idx("2026-03-15T14:00:00Z", "2026-04-15T13:59:59Z")).toBe(0);
      expect(await idx("2026-03-15T14:00:00Z", "2026-04-15T14:00:00Z")).toBe(1);
      expect(await idx("2026-03-15T14:00:00Z", "2027-03-15T14:00:00Z")).toBe(12);
      expect(await idx("2026-03-15T14:00:00Z", "2026-03-01T00:00:00Z")).toBe(0);
    });

    it("clamps month-end anniversaries to the last day of shorter months without drifting", async () => {
      const a = "2027-01-31T10:00:00Z";
      expect(await start(a, 1)).toBe("2027-02-28 10:00");
      expect(await start(a, 2)).toBe("2027-03-31 10:00"); // back to the 31st, no drift
      expect(await start(a, 3)).toBe("2027-04-30 10:00");
      expect(await idx(a, "2027-02-28T09:59:00Z")).toBe(0);
      expect(await idx(a, "2027-02-28T10:00:00Z")).toBe(1);
      expect(await idx(a, "2027-03-30T23:00:00Z")).toBe(1);
      expect(await idx(a, "2027-03-31T10:00:00Z")).toBe(2);
      // leap years
      expect(await start("2028-01-31T00:00:00Z", 1)).toBe("2028-02-29 00:00");
      expect(await start("2028-02-29T08:00:00Z", 12)).toBe("2029-02-28 08:00");
      expect(await start("2028-02-29T08:00:00Z", 13)).toBe("2029-03-29 08:00");
    });

    it("computes boundaries in UTC regardless of the session time zone", async () => {
      const c = await pool.connect();
      try {
        await c.query("set time zone 'America/Los_Angeles'");
        const r = await c.query("select public.credit_cycle_index('2027-01-31T10:00:00Z', '2027-02-28T10:00:00Z') n");
        expect(r.rows[0].n).toBe(1);
      } finally {
        await c.query("reset time zone");
        c.release();
      }
    });
  });

  describe("what counts as a bid", () => {
    it("editing, re-finalizing, reopening and re-downloading an existing bid are free", async () => {
      const u = await createUser(pool, "edit@test.dev");
      const e = await newEstimate(u);
      const h = hash();
      const first = await finalize(u, e, h);
      expect(first.rows[0]).toMatchObject({ charged: true, new_version: true, version_number: 1, starter_balance: 2 });
      const redownload = await finalize(u, e, h);
      expect(redownload.rows[0]).toMatchObject({ charged: false, new_version: false, credit_source: "existing_version", version_id: first.rows[0].version_id });
      const edited = await finalize(u, e);
      expect(edited.rows[0]).toMatchObject({ charged: false, new_version: true, credit_source: "already_counted", version_number: 2, starter_balance: 2 });
    });

    it("previously finalized bids stay free even with zero credits left", async () => {
      const u = await createUser(pool, "zero@test.dev");
      const bids = [await newEstimate(u), await newEstimate(u), await newEstimate(u)];
      for (const b of bids) await finalize(u, b);
      expect((await status(u)).starter_balance).toBe(0);
      const r = await finalize(u, bids[0]);
      expect(r.rows[0]).toMatchObject({ charged: false, credit_source: "already_counted" });
    });

    it("a failed finalization spends nothing", async () => {
      const u = await createUser(pool, "fail@test.dev");
      const e = await newEstimate(u);
      await expect(finalize(u, e, "not-a-valid-hash")).rejects.toThrow(/content_hash/);
      expect((await status(u)).starter_balance).toBe(3);
      const l = await pool.query("select count(*)::int n from public.credit_ledger where user_id = $1 and kind <> 'starter_grant'", [u]);
      expect(l.rows[0].n).toBe(0);
      const ok = await finalize(u, e);
      expect(ok.rows[0]).toMatchObject({ charged: true, version_number: 1 });
    });

    it("requires a verified email and the bid owner", async () => {
      const unverified = await createUser(pool, "unv@test.dev", false);
      await expect(finalize(unverified, await newEstimate(unverified))).rejects.toThrow(/email_not_verified/);
      const a = await createUser(pool, "owner2@test.dev");
      const b = await createUser(pool, "thief2@test.dev");
      await expect(finalize(b, await newEstimate(a))).rejects.toThrow(/estimate_not_found/);
    });
  });

  describe("concurrency", () => {
    it("parallel finalizations of different bids cannot overspend (3 starter + 1 monthly = 4)", async () => {
      const u = await createUser(pool, "race-many@test.dev");
      await status(u);
      await ageAccount(u, 1);
      const ests = await Promise.all(Array.from({ length: 10 }, () => newEstimate(u)));
      const results = await Promise.allSettled(ests.map((e) => finalize(u, e)));
      const ok = results.filter((r): r is PromiseFulfilledResult<QueryResult<Row>> => r.status === "fulfilled");
      expect(ok).toHaveLength(4);
      expect(results.filter((r) => r.status === "rejected").every((r) => /credits_exhausted/.test(String((r as PromiseRejectedResult).reason)))).toBe(true);
      expect(ok.map((r) => r.value.rows[0].credit_source).sort()).toEqual(["monthly", "starter", "starter", "starter"]);
      expect(await status(u)).toMatchObject({ starter_balance: 0, monthly_balance: 0 });
    });

    it("parallel finalizations of the same bid charge once", async () => {
      const u = await createUser(pool, "race-one@test.dev");
      const e = await newEstimate(u);
      const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => finalize(u, e, i < 4 ? "f".repeat(64) : hash())));
      const ok = results.filter((r): r is PromiseFulfilledResult<QueryResult<Row>> => r.status === "fulfilled");
      expect(ok).toHaveLength(8);
      expect(ok.filter((r) => r.value.rows[0].charged)).toHaveLength(1);
      expect((await status(u)).starter_balance).toBe(2);
    });
  });

  describe("Unlimited subscribers", () => {
    const subscribe = (u: string, status: string, at: string, end = "2099-01-01T00:00:00Z") =>
      pool.query("select public.apply_subscription_update($1::uuid, 'cus_' || $1::text, 'sub_' || $1::text, $2, 'monthly', 'price_m', $4::timestamptz, false, null, null, $3::timestamptz)", [u, status, at, end]);

    it("spend no credits, and bids made while subscribed stay free after cancelling", async () => {
      const u = await createUser(pool, "paid2@test.dev");
      await subscribe(u, "active", "2026-11-01T00:00:00Z");
      const e = await newEstimate(u);
      for (let i = 0; i < 5; i++) {
        const r = await finalize(u, i === 0 ? e : await newEstimate(u));
        expect(r.rows[0]).toMatchObject({ charged: false, credit_source: "unlimited", unlimited: true });
      }
      expect((await status(u)).starter_balance).toBe(3);
      await subscribe(u, "canceled", "2026-11-02T00:00:00Z", "2026-11-02T00:00:00Z");
      expect((await finalize(u, e)).rows[0]).toMatchObject({ charged: false, credit_source: "already_counted" });
      expect((await finalize(u, await newEstimate(u))).rows[0]).toMatchObject({ charged: true, credit_source: "starter" });
    });
  });

  describe("permissions", () => {
    it("end users can read only their own balances and cannot spend or edit credits directly", async () => {
      const u = await createUser(pool, "perm@test.dev");
      const other = await createUser(pool, "perm-other@test.dev");
      await status(u); await status(other);
      const e = await newEstimate(u);
      await expect(asUser(pool, u, (q) => q("select * from public.finalize_bid($1, $2, $3, '{}', '{}', 0, 0, 0, 0)", [u, e, hash()]))).rejects.toThrow(/permission denied/);
      await expect(asUser(pool, u, (q) => q("select public.ensure_credit_account($1)", [u]))).rejects.toThrow(/permission denied/);
      await expect(asUser(pool, u, (q) => q("update public.credit_accounts set starter_balance = 3 where user_id = $1", [u]))).rejects.toThrow(/permission denied/);
      await expect(asUser(pool, u, (q) => q("insert into public.credit_ledger (user_id, kind, amount) values ($1, 'starter_grant', 3)", [u]))).rejects.toThrow(/permission denied/);
      await expect(asUser(pool, u, (q) => q("select * from public.starter_credit_claims"))).rejects.toThrow(/permission denied/);
      const rows = await asUser(pool, u, (q) => q("select user_id from public.credit_accounts"));
      expect(rows.rows.map((r) => r.user_id)).toEqual([u]);
      const anon = await pool.connect();
      try {
        await anon.query("begin; set local role anon");
        await expect(anon.query("select * from public.credit_status()")).rejects.toThrow(/permission denied/);
      } finally { await anon.query("rollback"); anon.release(); }
    });
  });
});

d("credit migration for existing accounts (database)", () => {
  let mpool: Pool;
  let mdrop: () => Promise<void>;
  beforeAll(async () => { ({ pool: mpool, drop: mdrop } = await freshDb("b2b_test_credit_migration", { stopBefore: MIGRATION })); });
  afterAll(async () => { await mdrop?.(); });

  it("grants each existing verified account 3 starter credits once and keeps bids, versions and subscriptions", async () => {
    const mk = (email: string, verified: boolean, createdAt: string) =>
      mpool.query("insert into auth.users (email, email_confirmed_at, created_at) values ($1, $2, $3) returning id", [email, verified ? createdAt : null, createdAt]).then((r) => r.rows[0].id as string);
    const heavy = await mk("heavy@old.dev", true, "2026-08-31T12:00:00Z");
    const unverified = await mk("pending@old.dev", false, "2026-10-01T00:00:00Z");
    const subscriber = await mk("sub@old.dev", true, "2026-09-10T00:00:00Z");

    // Legacy data under the old monthly model.
    const e = (await mpool.query("insert into public.estimates (user_id, title) values ($1, 'Old bid') returning id", [heavy])).rows[0].id;
    const draft = (await mpool.query("insert into public.estimates (user_id, title) values ($1, 'Draft') returning id", [heavy])).rows[0].id;
    await mpool.query("select * from public.record_export($1, $2, $3, '{}', '{}', 1, 1, 0, 1)", [heavy, e, "a".repeat(64)]);
    await mpool.query("select public.apply_subscription_update($1, 'cus_s', 'sub_s', 'active', 'annual', 'price_a', '2099-01-01', false, null, null, now())", [subscriber]);

    await applyMigration(mpool, MIGRATION);
    // Re-running the backfill is harmless.
    await mpool.query("select public.ensure_credit_account(u.id) from auth.users u");

    const accts = await mpool.query("select user_id, starter_balance, cycle_anchor from public.credit_accounts order by user_id");
    const byUser = Object.fromEntries(accts.rows.map((r) => [r.user_id, r]));
    expect(byUser[heavy].starter_balance).toBe(3);
    expect(new Date(byUser[heavy].cycle_anchor).toISOString()).toBe("2026-08-31T12:00:00.000Z");
    expect(byUser[unverified].starter_balance).toBe(0);
    expect(byUser[subscriber].starter_balance).toBe(3);
    const grants = await mpool.query("select user_id, count(*)::int n from public.credit_ledger where kind = 'starter_grant' group by 1");
    expect(grants.rows.every((r) => r.n === 1)).toBe(true);
    expect(grants.rows).toHaveLength(2);

    // Bids and entitlements preserved.
    expect((await mpool.query("select count(*)::int n from public.estimate_versions")).rows[0].n).toBe(1);
    expect((await mpool.query("select status from public.estimates where id = $1", [draft])).rows[0].status).toBe("draft");
    expect((await mpool.query("select public.has_unlimited($1) v", [subscriber])).rows[0].v).toBe(true);

    // The legacy finalized bid can be edited and re-exported without spending a credit.
    const again = await mpool.query("select * from public.finalize_bid($1, $2, $3, '{}', '{}', 1, 1, 0, 1)", [heavy, e, "b".repeat(64)]);
    expect(again.rows[0]).toMatchObject({ charged: false, credit_source: "already_counted", version_number: 2 });
  });
});
