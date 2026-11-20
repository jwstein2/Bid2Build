import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createUser, dbAvailable, freshDb } from "./harness";

// Sales Compensation Model V3 against the real migration (isolated throwaway database, test users only).
const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
const q1 = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0];
const val = async (sql: string, params: unknown[] = []) => Object.values(await q1(sql, params))[0];
const FAR = "2030-01-01T00:00:00Z"; // evaluation time after every test payment
const day = (iso: string, days: number) => new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();
const pct = (mrr: number, rate: number) => Math.round((mrr * rate) / 100); // integer inputs: Math.round = half up

let seq = 0;
async function newRep(owner: string, name: string): Promise<{ id: string; code: string; user: string }> {
  const email = `${name.toLowerCase()}@sales.test`;
  const r = await q1("select public.admin_sales_rep_save($1, null, $2, $3, null, 'rep', 'active', null) as r", [owner, email, name]);
  const user = await createUser(pool, email);
  await asUser(pool, user, (q) => q("select public.sales_me()"));
  return { id: r.r.id, code: (await val("select code from public.sales_reps where id = $1", [r.r.id])) as string, user };
}

/**
 * One customer through the same functions the Stripe webhook calls: attribution, first paid invoice
 * (sales_sync_billing creates the standard commission), revenue with billing period, list MRR, and
 * optionally a second billing cycle a month later.
 */
async function customer(rep: { code: string }, o: { start: string; cents?: number; months?: number; second?: boolean; listMrr?: number; status?: string }) {
  const n = ++seq;
  const u = await createUser(pool, `cust${n}@co.com`);
  await val("select public.sales_record_attribution($1, $2, now())", [u, rep.code]);
  const cents = o.cents ?? 1999, months = o.months ?? 1;
  const basis = { cents, lines: [{ kind: "plan", months, month_cents: Math.round(cents / months) }] };
  await val("select public.sales_sync_billing($1, $2, $3, 'monthly', null, $4, $5::jsonb, $6, $7, $8::timestamptz)", [u, `sub_${n}`, o.status ?? "active", cents, JSON.stringify(basis), `in_${n}_1`, cents, o.start]);
  await val("select public.sales_record_revenue_v3($1, $2, $3, $3, $4::timestamptz, $5, 'subscription_create')", [u, `in_${n}_1`, cents, o.start, months]);
  await val("select public.sales_set_mrr($1, $2, '{}'::jsonb)", [u, o.listMrr ?? Math.round(cents / months)]);
  if (o.second) {
    const at = day(o.start, 31);
    await val("select public.sales_sync_billing($1, $2, $3, 'monthly', null, $4, $5::jsonb, $6, $7, $8::timestamptz)", [u, `sub_${n}`, o.status ?? "active", cents, JSON.stringify(basis), `in_${n}_2`, cents, at]);
    await val("select public.sales_record_revenue_v3($1, $2, $3, $3, $4::timestamptz, $5, 'subscription_cycle')", [u, `in_${n}_2`, cents, at, months]);
  }
  return u;
}

/** Many qualified monthly customers at once (direct inserts; same rows the webhook would write). */
async function bulk(repId: string, count: number, cents: number, start: string) {
  const from = seq + 1; seq += count;
  await pool.query(
    `with g as (select i, ($4::timestamptz + make_interval(mins => i)) as t from generate_series($2::int, $3::int) i),
      u as (insert into auth.users (email, email_confirmed_at) select 'bulk' || i || '@co.test', now() from g returning id, email),
      a as (insert into public.sales_attributions (user_id, rep_id, source, sub_status, plan, basis_cents, basis_detail, first_paid_at, first_paid_month, last_paid_at, mrr_list_cents)
            select u.id, $1, 'manual', 'active', 'monthly', $5, '{"lines":[{"kind":"plan","months":1}]}'::jsonb, g.t, public.sales_month_of(g.t), g.t + interval '31 days', $5
            from u join g on u.email = 'bulk' || g.i || '@co.test' returning user_id, first_paid_at)
     insert into public.sales_revenue (invoice_id, rep_id, user_id, gross_cents, revenue_cents, paid_at, period_months, billing_reason)
     select 'bulk_' || a.user_id || '_' || k, $1, a.user_id, $5, $5, a.first_paid_at + make_interval(days => 31 * (k - 1)), 1, case k when 1 then 'subscription_create' else 'subscription_cycle' end
     from a cross join generate_series(1, 2) k`,
    [repId, from, from + count - 1, start, cents],
  );
}

const awards = async (repId: string) => (await pool.query("select * from public.sales_milestone_awards where rep_id = $1 order by milestone", [repId])).rows;
const repMrr = async (repId: string) => Number(((await val("select public.sales_rep_mrr($1, $2)", [repId, FAR])) as { mrr_cents: number }).mrr_cents);
const qualifying = async (repId: string, at = FAR) => Number(await val("select count(*) from public.sales_milestone_customers($1, $2)", [repId, at]));

d("sales compensation V3 (database)", () => {
  let owner: string;
  let rita: { id: string; code: string; user: string };

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_sales_comp_v3"));
    owner = await createUser(pool, "owner@built2bid.org");
    await pool.query("insert into public.admin_roles (user_id, role) values ($1, 'admin')", [owner]);
    rita = await newRep(owner, "Rita");
  });
  afterAll(async () => { await drop?.(); });

  it("switches to the V3 policy as one new policy version", async () => {
    const s = await q1("select milestone_model, milestone_qualification, milestone_every, milestone_min_cents, milestone_rates, milestone_flat from public.sales_settings where id");
    expect(s).toMatchObject({ milestone_model: "v3_active_mrr", milestone_qualification: "second_cycle", milestone_every: 25, milestone_min_cents: 0 });
    expect(s.milestone_rates).toEqual([{ from: 50, pct: 3 }, { from: 100, pct: 4 }, { from: 250, pct: 5 }]);
    // The newest version is the ten-year term (20270209001000); V3 is the one before it.
    const v = await q1("select policy, note from public.sales_policy_versions where note like '%Compensation Model V3%' order by version desc limit 1");
    expect(v.policy).toMatchObject({ milestone_model: "v3_active_mrr", milestone_every: 25 });
    expect(v.note).toMatch(/Compensation Model V3/);
  });

  it("counts a monthly customer only after the second billing cycle, and keeps standard commissions as before", async () => {
    const u = await customer(rita, { start: "2026-01-05T15:00:00Z" });
    expect(await val("select public.sales_customer_qualified_at($1, $2)", [u, FAR])).toBeNull();
    // Legacy behavior preserved: the first payment still creates the one-month standard commission.
    expect(await q1("select kind, year_no, amount_cents, status from public.sales_commissions where user_id = $1", [u])).toMatchObject({ kind: "commission", year_no: 1, amount_cents: 1999, status: "pending" });
    await val("select public.sales_record_revenue_v3($1, 'in_late_cycle', 1999, 1999, '2026-02-05T15:00:00Z', 1, 'subscription_cycle')", [u]);
    expect(new Date((await val("select public.sales_customer_qualified_at($1, $2)", [u, FAR])) as string).toISOString()).toBe("2026-02-05T15:00:00.000Z");
  });

  it("qualifies an annual customer one month after payment, without a second payment", async () => {
    const u = await customer(rita, { start: "2026-01-10T15:00:00Z", cents: 19900, months: 12 });
    expect(await val("select public.sales_customer_qualified_at($1, '2026-02-01T00:00:00Z')", [u])).toBeNull();
    expect(new Date((await val("select public.sales_customer_qualified_at($1, '2026-02-11T00:00:00Z')", [u])) as string).toISOString()).toBe("2026-02-10T15:00:00.000Z");
    expect(await val("select public.sales_customer_mrr($1)", [u])).toBe(1658); // $199 / 12, half-up
  });

  it("awards $25 at 10 qualifying customers, once, with a hashed snapshot", async () => {
    for (let i = 0; i < 7; i++) await customer(rita, { start: day("2026-01-12T15:00:00Z", i), second: true });
    expect(await qualifying(rita.id)).toBe(9);
    await val("select public.sales_milestones_evaluate($1, $2)", [rita.id, FAR]);
    expect(await awards(rita.id)).toHaveLength(0);
    await customer(rita, { start: "2026-01-25T15:00:00Z", second: true });
    await val("select public.sales_milestones_evaluate($1, $2)", [rita.id, FAR]);
    await val("select public.sales_milestones_evaluate($1, $2)", [rita.id, FAR]); // re-run: no duplicate
    const a = await awards(rita.id);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ milestone: 10, status: "ready", rule_set: "v3_active_mrr", flat_cents: 2500, amount_cents: 2500, qualifying_customers: 10 });
    expect(a[0].snapshot_hash).toBe(await val("select public.sales_snapshot_hash($1::jsonb)", [JSON.stringify(a[0].snapshot)]));
    expect(await val("select count(*)::int from public.audit_logs where action = 'sales.milestone_earned'")).toBe(1);
  });

  it("excludes first-month cancels, refunds, chargebacks, trials, past-due and complimentary-style accounts", async () => {
    const before = await qualifying(rita.id);
    // Canceled in the first month: never counts, even after a second payment.
    const c1 = await customer(rita, { start: "2026-03-01T15:00:00Z", second: true });
    await pool.query("update public.sales_attributions set cancel_requested_at = '2026-03-10' where user_id = $1", [c1]);
    // First payment fully refunded.
    const c2 = await customer(rita, { start: "2026-03-02T15:00:00Z" });
    await val("select public.sales_revenue_refunded($1, 1999)", [`in_${seq}_1`]);
    // Second cycle charged back: doesn't count until the dispute is won.
    const c3 = await customer(rita, { start: "2026-03-03T15:00:00Z", second: true });
    const c3Second = `in_${seq}_2`;
    await val("select public.sales_revenue_disputed($1, true)", [c3Second]);
    // A free / complimentary account has an attribution but no paid invoice.
    const free = await createUser(pool, "free@co.com");
    await val("select public.sales_record_attribution($1, $2, now())", [free, rita.code]);
    expect(await val("select public.sales_customer_qualified_at($1, $2)", [c1, FAR])).toBeNull();
    expect(await val("select public.sales_customer_qualified_at($1, $2)", [c2, FAR])).toBeNull();
    expect(await val("select public.sales_customer_qualified_at($1, $2)", [c3, FAR])).toBeNull();
    expect(await val("select public.sales_customer_mrr($1)", [c3])).toBe(0);
    expect(await val("select public.sales_customer_mrr($1)", [free])).toBe(0);
    expect(await qualifying(rita.id)).toBe(before);
    await val("select public.sales_revenue_disputed($1, false)", [c3Second]); // dispute won
    expect(await qualifying(rita.id)).toBe(before + 1);
    expect(await val("select public.sales_customer_mrr($1)", [c3])).toBe(1999);
    // Past due and trialing customers are not paying: no MRR (but a past-qualified customer still counts).
    await pool.query("update public.sales_attributions set sub_status = 'past_due' where user_id = $1", [c3]);
    expect(await val("select public.sales_customer_mrr($1)", [c3])).toBe(0);
    await pool.query("update public.sales_attributions set sub_status = 'active' where user_id = $1", [c3]);
  });

  it("caps MRR at what was actually collected: discounts, upgrades, downgrades, Enterprise seats", async () => {
    // Discounted: list $19.99, collected $9.99 -> $9.99.
    const disc = await customer(rita, { start: "2026-04-01T15:00:00Z", cents: 999, listMrr: 1999, second: true });
    expect(await val("select public.sales_customer_mrr($1)", [disc])).toBe(999);
    // Mid-period upgrade: list jumps to $49.99 and a proration is paid; MRR stays at the last full cycle,
    // and the proration is not a "second billing cycle".
    const up = await customer(rita, { start: "2026-04-02T15:00:00Z" });
    await val("select public.sales_set_mrr($1, 4999, '{}'::jsonb)", [up]);
    await val("select public.sales_record_revenue_v3($1, 'in_proration', 1500, 1500, '2026-04-15T15:00:00Z', 1, 'subscription_update')", [up]);
    expect(await val("select public.sales_customer_qualified_at($1, $2)", [up, FAR])).toBeNull();
    expect(await val("select public.sales_customer_mrr($1)", [up])).toBe(1999);
    await val("select public.sales_record_revenue_v3($1, 'in_up_cycle', 4999, 4999, '2026-05-02T15:00:00Z', 1, 'subscription_cycle')", [up]);
    expect(await val("select public.sales_customer_mrr($1)", [up])).toBe(4999);
    // Downgrade: list drops below the last collected amount -> counts at once.
    await val("select public.sales_set_mrr($1, 999, '{}'::jsonb)", [up]);
    expect(await val("select public.sales_customer_mrr($1)", [up])).toBe(999);
    // Enterprise: base + paid seats on one invoice.
    const ent = await customer(rita, { start: "2026-04-03T15:00:00Z", cents: 8997, second: true });
    expect(await val("select public.sales_customer_mrr($1)", [ent])).toBe(8997);
  });

  it("records each paid invoice once even when the webhook is retried", async () => {
    const n = Number(await val("select count(*) from public.sales_revenue"));
    const u = (await val("select user_id from public.sales_attributions where rep_id = $1 limit 1", [rita.id])) as string;
    for (let i = 0; i < 3; i++) await val("select public.sales_record_revenue_v3($1, 'in_retry', 1999, 1999, '2026-06-01T00:00:00Z', 1, 'subscription_cycle')", [u]);
    expect(Number(await val("select count(*) from public.sales_revenue"))).toBe(n + 1);
    await Promise.all(Array.from({ length: 4 }, () => pool.query("select public.sales_milestones_evaluate($1, $2)", [rita.id, FAR])));
    expect(Number(await val("select count(*) from public.sales_milestone_awards where rep_id = $1", [rita.id]))).toBe((await awards(rita.id)).length);
  });

  it("awards $75 at 25 and 3% of qualifying active MRR at 50 and 75", async () => {
    const q = await qualifying(rita.id);
    await bulk(rita.id, 25 - q, 1999, "2026-05-01T00:00:00Z");
    await val("select public.sales_milestones_evaluate($1, $2)", [rita.id, FAR]);
    expect((await awards(rita.id)).find((a) => a.milestone === 25)).toMatchObject({ amount_cents: 7500, flat_cents: 7500, status: "ready" });
    for (const t of [50, 75]) {
      await bulk(rita.id, 25, 1999, `2026-0${t === 50 ? 6 : 7}-01T00:00:00Z`);
      const mrr = await repMrr(rita.id);
      await val("select public.sales_milestones_evaluate($1, $2)", [rita.id, FAR]);
      const a = (await awards(rita.id)).find((x) => x.milestone === t)!;
      expect(Number(a.pct)).toBe(3);
      expect(a.mrr_cents).toBe(mrr);
      expect(a.amount_cents).toBe(pct(mrr, 3));
      expect(a.snapshot).toMatchObject({ threshold: t, mrr_cents: mrr, amount_cents: pct(mrr, 3), qualification: "second_cycle" });
    }
  });

  it("awards 4% at every 25 from 100 through 225 and 5% at 250", async () => {
    for (let t = 100; t <= 250; t += 25) {
      await bulk(rita.id, 25, 1999, day("2026-08-01T00:00:00Z", t));
      const mrr = await repMrr(rita.id);
      await val("select public.sales_milestones_evaluate($1, $2)", [rita.id, FAR]);
      const a = (await awards(rita.id)).find((x) => x.milestone === t)!;
      const rate = t === 250 ? 5 : 4;
      expect([t, Number(a.pct), a.amount_cents]).toEqual([t, rate, pct(mrr, rate)]);
    }
  });

  it("awards 5% at 275, 300 and 325, and every milestone exactly once", async () => {
    await bulk(rita.id, 80, 1999, "2027-01-01T00:00:00Z"); // jumps from 250 past 325 in one go
    const mrr = await repMrr(rita.id);
    await val("select public.sales_milestones_evaluate($1, $2)", [rita.id, FAR]);
    await val("select public.sales_milestones_evaluate($1, $2)", [rita.id, FAR]);
    const a = await awards(rita.id);
    expect(a.map((x) => x.milestone)).toEqual([10, 25, 50, 75, 100, 125, 150, 175, 200, 225, 250, 275, 300, 325]);
    for (const t of [275, 300, 325]) expect(a.find((x) => x.milestone === t)).toMatchObject({ pct: "5.00", amount_cents: pct(mrr, 5), mrr_cents: mrr });
    // 250 wasn't paid again when 275+ was reached.
    expect(a.filter((x) => x.milestone === 250)).toHaveLength(1);
  });

  it("never recalculates an earned award when MRR changes later, and awards can't be edited or deleted", async () => {
    const a100 = (await awards(rita.id)).find((x) => x.milestone === 100)!;
    await pool.query("update public.sales_attributions set sub_status = 'canceled' where rep_id = $1 and user_id in (select user_id from public.sales_attributions where rep_id = $1 limit 40)", [rita.id]);
    await val("select public.sales_milestones_evaluate($1, $2)", [rita.id, FAR]);
    expect((await awards(rita.id)).find((x) => x.milestone === 100)).toMatchObject({ amount_cents: a100.amount_cents, mrr_cents: a100.mrr_cents, status: "ready" });
    await expect(pool.query("update public.sales_milestone_awards set amount_cents = 1 where id = $1", [a100.id])).rejects.toThrow(/award_calculation_locked/);
    await expect(pool.query("update public.sales_milestone_awards set snapshot = '{}' where id = $1", [a100.id])).rejects.toThrow(/award_calculation_locked/);
    await expect(pool.query("delete from public.sales_milestone_awards where id = $1", [a100.id])).rejects.toThrow(/awards_are_permanent/);
  });

  it("shows the rep their compensation dashboard with the next milestone as a clearly marked estimate", async () => {
    const r = await asUser(pool, rita.user, (q) => q("select public.sales_my_compensation() as c"));
    const c = r.rows[0].c;
    // The dashboard uses today's date, so test customers dated in the future don't count yet.
    const q = await qualifying(rita.id, new Date().toISOString());
    expect(c).toMatchObject({ model: "v3_active_mrr", qualifying: q, remaining: c.next.at - q });
    expect(c.next.at).toBeGreaterThan(q);
    expect(c.current.at).toBeLessThanOrEqual(q);
    expect(c.qualifying_mrr_cents).toBe(Number(((await val("select public.sales_rep_mrr($1, now())", [rita.id])) as { mrr_cents: number }).mrr_cents));
    if (c.next.pct) { expect(c.next_is_estimate).toBe(true); expect(c.next_estimate_cents).toBe(pct(c.qualifying_mrr_cents, c.next.pct)); }
    expect(c.attributed).toBeGreaterThanOrEqual(c.qualifying);
    expect(c.bonus_earned_cents).toBeGreaterThan(0);
    expect(c.programs.randomized_activity_bonus).toMatchObject({ available: false });
    expect(c.programs.randomized_activity_bonus.message).toMatch(/isn't offered/);
  });

  it("puts an approved bonus on the statement, separately labeled, and reconciles payroll", async () => {
    const a10 = (await awards(rita.id)).find((x) => x.milestone === 10)!;
    await asUser(pool, rita.user, (q) => q("select public.sales_my_milestone_open($1)", [a10.id]));
    const res = (await val("select public.admin_sales_milestone_approve($1, $2)", [owner, a10.id])) as { commission_id: string };
    expect(await q1("select kind, amount_cents, basis_detail->>'snapshot_hash' as h from public.sales_commissions where id = $1", [res.commission_id]))
      .toEqual({ kind: "bonus", amount_cents: 2500, h: a10.snapshot_hash });
    await pool.query("update public.sales_settings set policy_confirmed_at = now() where id");
    const nextMonth = new Date(); nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1, 2);
    await val("select public.sales_close_month($1)", [nextMonth.toISOString()]);
    const st = await q1("select s.id, s.period_month, s.total_cents from public.sales_statements s join public.sales_commissions c on c.statement_id = s.id where c.id = $1", [res.commission_id]);
    const exp = (await val("select public.admin_sales_payroll_export($1, $2)", [owner, st.period_month])) as { lines: { category: string; amount_cents: number }[]; statements: { reconciled: boolean; lines_total_cents: number }[] };
    expect(exp.lines.find((l) => l.category === "one_time_bonus")).toMatchObject({ amount_cents: 2500 });
    expect(exp.statements[0]).toMatchObject({ reconciled: true, lines_total_cents: st.total_cents });
    await val("select public.admin_sales_statement_approve($1, $2)", [owner, st.id]);
    await val("select public.admin_sales_payout_record($1, $2, 'payroll', 'PR-1', current_date)", [owner, st.id]);
    const after = (await val("select public.admin_sales_payroll_export($1, $2)", [owner, st.period_month])) as { statements: { reconciled: boolean; payout_cents: number }[] };
    expect(after.statements[0]).toMatchObject({ reconciled: true, payout_cents: st.total_cents });
    const comp = (await val("select public.admin_sales_compensation($1)", [owner])) as { reps: { rep_id: string; bonus_paid_cents: number }[] };
    expect(comp.reps.find((x) => x.rep_id === rita.id)?.bonus_paid_cents).toBe(2500);
    // Payroll data is owner-only.
    const salesAdmin = await createUser(pool, "admin2@sales.test");
    await val("select public.admin_sales_rep_save($1, null, 'admin2@sales.test', 'Sam Admin', null, 'admin', 'active', null)", [owner]);
    await asUser(pool, salesAdmin, (q) => q("select public.sales_me()"));
    await expect(pool.query("select public.admin_sales_payroll_export($1, $2)", [salesAdmin, st.period_month])).rejects.toThrow(/not_authorized/);
  });

  it("lets a rep dispute an award; the owner resolves it with a separate adjustment line", async () => {
    const a25 = (await awards(rita.id)).find((x) => x.milestone === 25)!;
    const id = (await asUser(pool, rita.user, (q) => q("select public.sales_my_milestone_dispute($1, 'Customer count looks low') as id", [a25.id]))).rows[0].id;
    await expect(asUser(pool, rita.user, (q) => q("select public.sales_my_milestone_dispute($1, 'again')", [a25.id]))).rejects.toThrow(/already_disputed/);
    await expect(pool.query("select public.admin_sales_milestone_approve($1, $2)", [owner, a25.id])).rejects.toThrow(/disputed/);
    const r = (await val("select public.admin_sales_milestone_dispute_resolve($1, $2, 'upheld', 'Two customers missed', 500)", [owner, id])) as { commission_id: string };
    expect(await q1("select kind, amount_cents, reason from public.sales_commissions where id = $1", [r.commission_id])).toEqual({ kind: "bonus", amount_cents: 500, reason: "milestone_adjustment_25" });
    expect((await awards(rita.id)).find((x) => x.milestone === 25)?.amount_cents).toBe(7500); // the award itself never changes
  });

  it("keeps randomized bonuses disabled by default and behind documented jurisdiction approval", async () => {
    const p = await q1("select enabled, requires_jurisdiction_approval from public.sales_incentive_programs where key = 'randomized_activity_bonus'");
    expect(p).toEqual({ enabled: false, requires_jurisdiction_approval: true });
    await expect(pool.query("select public.admin_sales_program_set($1, 'randomized_activity_bonus', true, 'try')", [owner])).rejects.toThrow(/approval_required/);
    await expect(pool.query("select public.admin_sales_program_set($1, 'standard_commission', false, 'try')", [owner])).rejects.toThrow(/standard_not_toggleable/);
    await expect(pool.query("select public.admin_sales_jurisdiction_save($1, 'randomized_activity_bonus', 'MN', null, 'approved', null, null, current_date, null, null)", [owner])).rejects.toThrow(/approval_documentation_required/);
    // Approval for Minnesota only, expiring in 30 days.
    await val("select public.admin_sales_jurisdiction_save($1, 'randomized_activity_bonus', 'MN', null, 'approved', 'Memo 2026-14', 'Counsel A', current_date - 1, current_date + 30, null)", [owner]);
    await val("select public.admin_sales_program_set($1, 'randomized_activity_bonus', true, 'Approved for MN')", [owner]);
    const tom = await newRep(owner, "Tom");
    await val("select public.admin_sales_rep_work_location($1, $2, 'MN', 'Rochester')", [owner, rita.id]);
    await val("select public.admin_sales_rep_work_location($1, $2, 'TX', null)", [owner, tom.id]);
    const st = async (rep: string, on = "current_date") => (await val(`select public.sales_program_status('randomized_activity_bonus', $1, ${on})`, [rep])) as { available: boolean; reason: string };
    expect(await st(rita.id)).toMatchObject({ available: true });
    expect(await st(tom.id)).toMatchObject({ available: false, reason: "not_approved" }); // HQ approval doesn't apply nationwide
    // Expiry deactivates automatically; the sweep logs it.
    expect(await st(rita.id, "current_date + 31")).toMatchObject({ available: false, reason: "approval_expired" });
    expect(await val("select public.sales_programs_sweep(now() + interval '40 days')")).toBe(1);
    // A local prohibition overrides the statewide approval.
    await val("select public.admin_sales_jurisdiction_save($1, 'randomized_activity_bonus', 'MN', 'Rochester', 'prohibited', null, null, current_date - 1, null, 'City ordinance')", [owner]);
    expect(await st(rita.id)).toMatchObject({ available: false, reason: "jurisdiction_prohibited" });
    // Emergency stop by a Sales Administrator; only the owner can clear it.
    const adminU = (await val("select user_id from public.sales_reps where email = 'admin2@sales.test'")) as string;
    await val("select public.admin_sales_program_emergency($1, 'randomized_activity_bonus', true, 'Complaint received')", [adminU]);
    expect(await val("select (public.sales_program_status('randomized_activity_bonus', $1)->>'reason')", [tom.id])).toBe("emergency_disabled");
    await expect(pool.query("select public.admin_sales_program_emergency($1, 'randomized_activity_bonus', false, 'clear')", [adminU])).rejects.toThrow(/not_authorized/);
    // Everything is in the append-only history.
    const actions = (await pool.query("select action from public.sales_program_events order by id")).rows.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["jurisdiction_approved", "enabled", "rep_work_location", "approval_expired", "jurisdiction_prohibited", "emergency_stop"]));
    await expect(pool.query("delete from public.sales_program_events")).rejects.toThrow(/append_only/);
    await val("select public.admin_sales_program_set($1, 'randomized_activity_bonus', false, 'Back off after test')", [owner]);
  });

  it("stops future milestone eligibility where restricted without removing earned awards", async () => {
    const earned = (await awards(rita.id)).filter((a) => a.status !== "ineligible").length;
    await val("select public.admin_sales_jurisdiction_save($1, 'milestone_bonus', 'MN', null, 'prohibited', null, null, '2020-01-01', null, 'test')", [owner]);
    await bulk(rita.id, 30, 1999, "2027-03-01T00:00:00Z"); // crosses 350 while restricted
    await val("select public.sales_milestones_evaluate($1, $2)", [rita.id, FAR]);
    const a = await awards(rita.id);
    expect(a.filter((x) => x.status !== "ineligible")).toHaveLength(earned);
    expect(a.find((x) => x.milestone === 350)).toMatchObject({ status: "ineligible", amount_cents: null });
    const j = (await val("select id from public.sales_program_jurisdictions where program_key = 'milestone_bonus'")) as string;
    await val("select public.admin_sales_jurisdiction_revoke($1, $2, 'test over')", [owner, j]);
  });

  it("keeps awards and attribution when a rep leaves; customers after the last day don't create awards", async () => {
    const leo = await newRep(owner, "Leo");
    await bulk(leo.id, 10, 1999, "2026-01-01T00:00:00Z");
    await pool.query("update public.sales_reps set status = 'removed', removed_at = '2026-06-01' where id = $1", [leo.id]);
    await bulk(leo.id, 20, 1999, "2026-07-01T00:00:00Z"); // would reach 25 after the last day
    await val("select public.sales_milestones_evaluate($1, $2)", [leo.id, FAR]);
    expect((await awards(leo.id)).map((x) => x.milestone)).toEqual([10]);
    // Reinstated: the earned award is still there and is never duplicated.
    await pool.query("update public.sales_reps set status = 'active' where id = $1", [leo.id]);
    await val("select public.sales_milestones_evaluate($1, $2)", [leo.id, FAR]);
    expect((await awards(leo.id)).filter((x) => x.milestone === 10)).toHaveLength(1);
    expect(Number(await val("select count(*) from public.sales_attributions where rep_id = $1", [leo.id]))).toBe(30);
  });

  it("keeps V2 awards on V2 math after the switch, and a returning customer counts once", async () => {
    const vic = await newRep(owner, "Vic");
    await pool.query("update public.sales_settings set milestone_model = 'v2_window', milestone_qualification = 'first_payment' where id");
    await bulk(vic.id, 10, 1999, "2026-01-01T00:00:00Z");
    await val("select public.sales_milestones_evaluate($1, '2026-01-02T00:00:00Z')", [vic.id]);
    await pool.query("update public.sales_settings set milestone_model = 'v3_active_mrr', milestone_qualification = 'second_cycle' where id");
    await val("select public.sales_milestones_evaluate($1, $2)", [vic.id, FAR]);
    expect((await awards(vic.id))[0]).toMatchObject({ milestone: 10, rule_set: "v2_window", status: "ready", amount_cents: 2500 });
    // Returning customer: cancels after qualifying, comes back and pays again. Same person, one count.
    const u = (await val("select user_id from public.sales_attributions where rep_id = $1 limit 1", [vic.id])) as string;
    const n = await qualifying(vic.id);
    await pool.query("update public.sales_attributions set sub_status = 'canceled', cancel_requested_at = '2026-05-01' where user_id = $1", [u]);
    await val("select public.sales_record_revenue_v3($1, 'in_return', 1999, 1999, '2026-09-01T00:00:00Z', 1, 'subscription_create')", [u]);
    await pool.query("update public.sales_attributions set sub_status = 'active' where user_id = $1", [u]);
    expect(await qualifying(vic.id)).toBe(n);
    expect(await val("select count(*)::int from public.sales_attributions where user_id = $1", [u])).toBe(1);
  });

  it("keeps the new tables and owner functions private", async () => {
    for (const t of ["sales_incentive_programs", "sales_program_jurisdictions", "sales_program_events", "sales_milestone_disputes"]) {
      await expect(asUser(pool, rita.user, (q) => q(`select * from public.${t}`))).rejects.toThrow(/permission denied/);
    }
    await expect(asUser(pool, rita.user, (q) => q("select public.admin_sales_compensation($1)", [rita.user]))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, rita.user, (q) => q("select public.sales_milestones_evaluate(null, now())"))).rejects.toThrow(/permission denied/);
  });
});
