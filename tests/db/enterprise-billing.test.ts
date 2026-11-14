import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createUser, dbAvailable, freshDb } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;

const apply = (u: string, company: string | null, seats: number | null, status = "active", at = "now()") =>
  pool.query(
    `select public.apply_subscription_update(p_user_id => $1::uuid, p_stripe_customer_id => 'cus_' || $1, p_stripe_subscription_id => 'sub_' || $1,
      p_status => $2, p_plan => 'enterprise', p_price_id => 'price_ent_base', p_current_period_end => '2099-01-01', p_cancel_at_period_end => false,
      p_canceled_at => null, p_ended_at => null, p_event_created => ${at}, p_company_id => $3::uuid, p_seat_quantity => $4) as applied`,
    [u, status, company, seats],
  );

d("Enterprise billing sync (database)", () => {
  let owner: string, est: string, solo: string, company: string;

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_ent_billing"));
    owner = await createUser(pool, "owner@acme.dev");
    est = await createUser(pool, "est@acme.dev");
    solo = await createUser(pool, "solo@test.dev");
    company = (await pool.query("select public.create_company($1, 'Acme') as id", [owner])).rows[0].id;
  });
  afterAll(async () => { await drop?.(); });

  it("the original 11-argument call still works for individual plans", async () => {
    await pool.query("select public.apply_subscription_update($1::uuid, 'cus_solo', 'sub_solo', 'active', 'monthly', 'price_m', '2099-01-01', false, null, null, now())", [solo]);
    const r = (await pool.query("select plan, company_id, seat_quantity from public.subscriptions where user_id = $1", [solo])).rows[0];
    expect(r).toEqual({ plan: "monthly", company_id: null, seat_quantity: null });
  });

  it("an Enterprise subscription must name its company", async () => {
    await expect(apply(owner, null, 3)).rejects.toThrow(/enterprise_subscription_without_company/);
  });

  it("records seats and activates the company", async () => {
    await apply(owner, company, 5, "active", "now() - interval '1 minute'");
    const e = (await pool.query("select * from public.company_entitlement($1)", [company])).rows[0];
    expect(e).toMatchObject({ active: true, source: "stripe", seat_limit: 5 });
  });

  it("older events never overwrite newer seat counts", async () => {
    const r = await apply(owner, company, 3, "active", "now() - interval '1 hour'");
    expect(r.rows[0].applied).toBe(false);
    expect((await pool.query("select seat_limit from public.company_entitlement($1)", [company])).rows[0].seat_limit).toBe(5);
    await apply(owner, company, 8);
    expect((await pool.query("select seat_limit from public.company_entitlement($1)", [company])).rows[0].seat_limit).toBe(8);
  });

  it("billing summary is for billing managers only", async () => {
    const s = (await asUser(pool, owner, (q) => q("select public.company_billing_summary() as s"))).rows[0].s;
    expect(s).toMatchObject({ status: "active", seatQuantity: 8, seatsUsed: 1, activeMembers: 1, pastDue: false });
    const { token } = (await asUser(pool, owner, (q) => q("select * from public.create_company_invitation('est@acme.dev', 'estimator')"))).rows[0];
    await asUser(pool, est, (q) => q("select public.accept_company_invitation($1)", [token]));
    await expect(asUser(pool, est, (q) => q("select public.company_billing_summary()"))).rejects.toThrow(/forbidden/);
  });

  it("past_due keeps seats during Stripe retries; cancellation ends them but keeps the company", async () => {
    await apply(owner, company, 8, "past_due");
    expect((await pool.query("select tier from public.user_entitlement($1)", [est])).rows[0].tier).toBe("enterprise");
    await apply(owner, company, 8, "canceled");
    expect((await pool.query("select tier from public.user_entitlement($1)", [est])).rows[0].tier).toBe("free");
    expect((await pool.query("select count(*)::int as n from public.company_members where company_id = $1", [company])).rows[0].n).toBe(2);
  });
});
