import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { applyMigration, asUser, createUser, dbAvailable, freshDb } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;

const MIGRATION = "20261115003000_referrals.sql";
const q1 = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0];
const codeFor = async (u: string) => (await q1("select public.referral_code_for($1) as c", [u])).c as string;
const record = async (u: string, code: string) => (await q1("select public.record_referral($1, $2) as r", [u, code])).r as string;
const claim = async (u: string, inv = `in_${u}`) => (await q1("select public.referral_claim_reward($1, $2) as c", [u, inv])).c;
const subscribe = (u: string, opts: { status?: string; cancel?: boolean } = {}) =>
  pool.query(
    "select public.apply_subscription_update($1::uuid, $2, $3, $4, 'monthly', 'price_m', '2099-01-01'::timestamptz, $5, null, null, now())",
    [u, `cus_${u}`, `sub_${u}`, opts.status ?? "active", opts.cancel ?? false],
  );
const unlimited = async (u: string) => (await q1("select public.has_unlimited($1) as v", [u])).v as boolean;

d("referrals (database)", () => {
  let referrer: string, payingReferrer: string, admin: string;

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_referrals"));
    referrer = await createUser(pool, "pat@roofco.com");
    payingReferrer = await createUser(pool, "sam@deckpros.com");
    admin = await createUser(pool, "owner@built2bid.org");
    await pool.query("insert into public.admin_roles (user_id, role) values ($1, 'admin')", [admin]);
    await subscribe(payingReferrer);
    await applyMigration(pool, MIGRATION); // idempotent re-run
  });
  afterAll(async () => { await drop?.(); });

  it("gives each member one stable, readable code; members read only their own counts", async () => {
    const c = await codeFor(referrer);
    expect(c).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{8}$/);
    expect(await codeFor(referrer)).toBe(c);
    const mine = await asUser(pool, referrer, (q) => q("select public.my_referral() as m"));
    expect(mine.rows[0].m).toMatchObject({ code: c, eligible: true, signed_up: 0, paying: 0, months_earned: 0 });
    await expect(asUser(pool, referrer, (q) => q("select * from public.referrals"))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, referrer, (q) => q("select public.record_referral($1, 'ABCDEFGH')", [referrer]))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, referrer, (q) => q("select public.admin_referrals($1)", [referrer]))).rejects.toThrow(/permission denied/);
  });

  it("blocks self-referral, unknown codes, old accounts, past customers and test accounts", async () => {
    const c = await codeFor(referrer);
    expect(await record(referrer, c)).toBe("ineligible:self_referral");
    expect((await q1("select count(*)::int as n from public.referrals")).n).toBe(0); // own link: not recorded
    // brand new alias of the same person (gmail dots/+tag rules apply to gmail; +tag everywhere)
    const alias = await createUser(pool, "pat+second@roofco.com");
    expect(await record(alias, c)).toBe("ineligible:self_referral");
    const stranger = await createUser(pool, "lee@painters.com");
    expect(await record(stranger, "ZZZZZZZZ")).toBe("unknown_code");
    const old = await createUser(pool, "old@siding.com");
    await pool.query("update auth.users set created_at = now() - interval '30 days' where id = $1", [old]);
    expect(await record(old, c)).toBe("existing_account");
    const pastCustomer = await createUser(pool, "past@fence.com");
    await subscribe(pastCustomer, { status: "canceled" });
    expect(await record(pastCustomer, c)).toBe("existing_account");
    const tester = await createUser(pool, "someone@example.com");
    expect(await record(tester, c)).toBe("ineligible:referee_excluded_test");
    const fromAdmin = await createUser(pool, "friend@hvac.com");
    expect(await record(fromAdmin, await codeFor(admin))).toBe("ineligible:referrer_excluded_internal");
  });

  it("records a genuine new account once and rewards a non-paying referrer with 30 days of Unlimited, once", async () => {
    const c = await codeFor(referrer);
    const newbie = await createUser(pool, "jo@concrete.com");
    expect(await record(newbie, c.toLowerCase())).toBe("recorded");
    expect(await record(newbie, c)).toBe("already_recorded");
    expect(await unlimited(referrer)).toBe(false);

    const first = await claim(newbie, "in_1");
    expect(first).toMatchObject({ action: "comp_days" });
    expect(await claim(newbie, "in_2")).toEqual({ action: "none" }); // retries / later invoices never double reward
    const g = await q1("select public.referral_grant_comp_days($1, 30) as g", [first.id]);
    expect(g.g.ok).toBe(true);
    expect(await unlimited(referrer)).toBe(true);
    const again = await q1("select public.referral_grant_comp_days($1, 30) as g", [first.id]);
    expect(again.g).toMatchObject({ ok: false, error: "not_rewarding" });
    const grant = await q1("select round(extract(epoch from expires_at - starts_at) / 86400) as days, plan from public.complimentary_grants where user_id = $1", [referrer]);
    expect(grant).toMatchObject({ plan: "unlimited" });
    expect(Number(grant.days)).toBe(30);

    // A second reward stacks onto the open grant instead of creating another one.
    const second = await createUser(pool, "max@tile.com");
    expect(await record(second, c)).toBe("recorded");
    const cl = await claim(second);
    await pool.query("select public.referral_grant_comp_days($1, 30)", [cl.id]);
    const grants = await pool.query("select round(extract(epoch from expires_at - now()) / 86400) as left from public.complimentary_grants where user_id = $1", [referrer]);
    expect(grants.rowCount).toBe(1);
    expect(Number(grants.rows[0].left)).toBeGreaterThanOrEqual(59);

    const mine = await asUser(pool, referrer, (q) => q("select public.my_referral() as m"));
    expect(mine.rows[0].m).toMatchObject({ signed_up: 2, paying: 2, months_earned: 2 });
  });

  it("paying, renewing referrer gets a Stripe credit instruction; outcome is recorded once", async () => {
    const newbie = await createUser(pool, "kim@gutters.com");
    expect(await record(newbie, await codeFor(payingReferrer))).toBe("recorded");
    const c = await claim(newbie);
    expect(c).toMatchObject({ action: "stripe_credit", customer: `cus_${payingReferrer}`, subscription: `sub_${payingReferrer}` });
    await pool.query("select public.referral_finish_reward($1, true, 'cbtxn_1', 1999)", [c.id]);
    await pool.query("select public.referral_finish_reward($1, false, null, null, 'late retry')", [c.id]); // no-op once rewarded
    const r = await q1("select status, reward_kind, reward_cents, reward_ref, error from public.referrals where id = $1", [c.id]);
    expect(r).toEqual({ status: "rewarded", reward_kind: "stripe_credit", reward_cents: 1999, reward_ref: "cbtxn_1", error: null });
  });

  it("re-checks labels at reward time and enforces the yearly cap", async () => {
    const c = await codeFor(payingReferrer);
    const relabeled = await createUser(pool, "ann@windows.com");
    expect(await record(relabeled, c)).toBe("recorded");
    await pool.query("insert into public.admin_account_labels (user_id, label) values ($1, 'test')", [relabeled]);
    expect(await claim(relabeled)).toMatchObject({ action: "none", reason: "referee_excluded_test" });

    await pool.query(`insert into public.referrals (referrer_id, code, status, rewarded_at)
      select $1, 'CAPTEST1', 'rewarded', now() - interval '1 day' from generate_series(1, 11)`, [payingReferrer]);
    const over = await createUser(pool, "zed@masonry.com");
    expect(await record(over, c)).toBe("recorded");
    expect(await claim(over)).toMatchObject({ action: "none", reason: "yearly_cap_reached" });
  });

  it("owner report needs an admin and returns totals", async () => {
    await expect(pool.query("select public.admin_referrals($1)", [referrer])).rejects.toThrow(/forbidden/);
    const r = (await q1("select public.admin_referrals($1) as r", [admin])).r;
    expect(r.totals.rewarded).toBeGreaterThanOrEqual(3);
    expect(r.totals.ineligible).toBeGreaterThanOrEqual(4);
    expect(r.rows[0]).toHaveProperty("referrer_email");
  });
});
