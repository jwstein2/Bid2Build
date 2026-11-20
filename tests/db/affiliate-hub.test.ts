import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createUser, dbAvailable, freshDb, type Row } from "./harness";

/**
 * Affiliate Hub engine (database). Synthetic people and invoices only; no real creators, tax records or transfers.
 * Customer emails use .com: referral_excluded() excludes .test / example addresses.
 */
const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
const q1 = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0] as Row;
const val = async (sql: string, params: unknown[] = []) => Object.values(await q1(sql, params))[0];
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const as = <T,>(u: string, sql: string, params: unknown[] = []) => asUser(pool, u, async (q) => (await q(sql, params)).rows[0]?.r as T);
const DAY = 864e5;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const addMonths = (t: Date, m: number) => { const x = new Date(t); x.setUTCMonth(x.getUTCMonth() + m); return x; };
const LESSONS = ["how_it_works", "annual_not_monthly", "ten_year_term", "eligibility", "ftc_disclosure", "honest_claims", "no_spam", "brand_use", "payouts_taxes", "getting_started"];
let seq = 0;

let owner: string;

/** Invite → accept → seven onboarding steps → owner approval. Returns the affiliate's login, record id and code. */
async function activeAffiliate(email: string, opts: { w9?: boolean; bank?: boolean } = {}) {
  const tok = sha(`invite-${email}`);
  const inv = await val("select public.admin_affiliate_invite_create($1, $2, 'Test Creator', null, $3, 'Hi', 14)", [owner, email, tok]) as Row;
  const u = await createUser(pool, email);
  await as(u, "select public.affiliate_invite_accept($1) r", [tok]);
  await as(u, "select public.affiliate_my_step('welcome') r");
  await as(u, "select public.affiliate_my_step('profile', $1) r", [JSON.stringify({ legal_name: "Test Creator", phone: "555-0100", address_line1: "1 Main St", city: "Rochester", state: "MN", postal_code: "55901", country: "US", tax_residency: "US" })]);
  await as(u, "select public.affiliate_my_channel_self($1) r", [JSON.stringify({ platform: "blog", url: `https://example.org/${email}`, title: "My blog" })]);
  await as(u, "select public.affiliate_my_step('channel_done') r");
  for (const l of LESSONS) await as(u, "select public.affiliate_my_lesson($1) r", [l]);
  await as(u, "select public.affiliate_my_step('learn_done') r");
  const me = await as<Row>(u, "select public.affiliate_me() r");
  await as(u, "select public.affiliate_my_agreement_accept($1, $2, 'Test Creator', '127.0.0.1', 'vitest') r", [me.agreement.id, sha(me.agreement.body)]);
  if (opts.w9 !== false) await pool.query("select public.affiliate_w9_store($1, 'Test Creator', null, 'individual', null, 'ssn', '6789', 'v1.aaaaaaaaaaaaaaaa.bbbb.cccc', 'Test Creator')", [u]);
  if (opts.bank !== false) await pool.query("select public.affiliate_destination_record($1, 'mock', 'test', $2, $3, 'STRIPE TEST BANK', 'checking', '6789', 'verified')", [u, `rcpt_${inv.affiliate_id}`, `pm_${inv.affiliate_id}`]);
  await as(u, "select public.affiliate_my_step('submit') r");
  await pool.query("select public.admin_affiliate_decide($1, $2, 'approve', 'Looks good')", [owner, inv.affiliate_id]);
  const code = await val("select code from public.affiliates where id = $1", [inv.affiliate_id]) as string;
  return { u, id: inv.affiliate_id as string, code };
}

/** A customer who clicked the affiliate link a minute ago and then signed up. */
async function referred(code: string, email = `cust${++seq}@shop${seq}.com`) {
  const click = await val("select public.affiliate_log_click($1, 'spring', 'youtube', '/a/x', $2, null)", [code, sha(email).slice(0, 32)]) as string;
  const c = await createUser(pool, email);
  expect(await val("select public.affiliate_record_attribution($1, $2, now() - interval '1 minute', $3)", [c, code, click])).toBe("recorded");
  return c;
}

/** One paid invoice. Monthly $19.99 by default; annual = 12 months at $199 (list basis 199/12 = 1658). */
async function invoice(c: string, id: string, paidAt: Date, o: { months?: number; gross?: number; pretax?: number; listDivide?: number; listMonthly?: number; reason?: string } = {}) {
  const months = o.months ?? 1;
  const gross = o.gross ?? (months === 12 ? 19900 : 1999);
  const listDivide = o.listDivide ?? (months === 12 ? 1658 : gross);
  return await val("select public.affiliate_record_invoice($1, $2, 'sub_1', $3, $4, $4, $5, $6, $7, $8, $9, $10)", [
    c, id, o.reason ?? "subscription_cycle", paidAt.toISOString(), addMonths(paidAt, months).toISOString(), months, gross, o.pretax ?? gross, listDivide, o.listMonthly ?? 1999,
  ]) as Row;
}
const lines = async (c: string) => (await pool.query("select year_no, amount_cents, status, reason from public.affiliate_commissions where user_id = $1 order by year_no", [c])).rows;

d("Affiliate Hub (database)", () => {
  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_affiliate_hub"));
    owner = await createUser(pool, "owner@built2bid.org");
    await pool.query("insert into public.admin_roles (user_id, role) values ($1, 'admin')", [owner]);
  }, 180_000);
  afterAll(async () => { await drop?.(); });

  it("defaults: 10-year term, 30-day hold, payouts off, annual basis pending approval, draft agreement", async () => {
    expect(await q1("select commission_years, hold_days, payouts_enabled, annual_basis, annual_basis_approved_at, recruitment_emails from public.affiliate_settings"))
      .toMatchObject({ commission_years: 10, hold_days: 30, payouts_enabled: false, annual_basis: "divide_12", annual_basis_approved_at: null, recruitment_emails: false });
    expect(await val("select legal_status from public.affiliate_agreement_templates where active")).toBe("draft_pending_counsel");
    // Payouts can't be switched on before the owner confirms the policy.
    await expect(pool.query("select public.admin_affiliate_settings_save($1, '{\"payouts_enabled\": true}', 'try')", [owner])).rejects.toThrow(/confirm_policy_first/);
  });

  it("public application, approval to onboarding, and owner-only admin functions", async () => {
    const r = await val("select public.affiliate_apply($1)", [JSON.stringify({ email: "Applicant@Creators.com", legal_name: "App Licant", platform: "youtube", channel_url: "https://youtube.com/@app", audience_size: "1200" })]) as Row;
    expect(r.status).toBe("received");
    expect((await val("select public.affiliate_apply($1)", [JSON.stringify({ email: "applicant@creators.com", legal_name: "Again" })]) as Row).status).toBe("exists");
    const stranger = await createUser(pool, "nobody@creators.com");
    await expect(pool.query("select public.admin_affiliate_decide($1, $2, 'approve', null)", [stranger, r.id])).rejects.toThrow(/not_authorized/);
    expect((await val("select public.admin_affiliate_decide($1, $2, 'approve', null)", [owner, r.id]) as Row).status).toBe("onboarding");
    // The applicant signs in with the application email and is linked automatically.
    const u = await createUser(pool, "applicant@creators.com");
    expect((await as<Row>(u, "select public.affiliate_me() r")).status).toBe("onboarding");
    // Lessons can't be skipped by the client.
    await expect(as(u, "select public.affiliate_my_step('learn_done', '{\"required\": 0}') r")).rejects.toThrow(/lessons_incomplete/);
  });

  it("invitation: only the invited, verified email can accept; expired/revoked links fail", async () => {
    const tok = sha("inv-a");
    await pool.query("select public.admin_affiliate_invite_create($1, 'invitee@creators.com', 'Invitee', null, $2, null, 14)", [owner, tok]);
    expect((await val("select public.affiliate_invite_lookup($1)", [tok]) as Row).valid).toBe(true);
    const wrong = await createUser(pool, "someoneelse@creators.com");
    await expect(as(wrong, "select public.affiliate_invite_accept($1) r", [tok])).rejects.toThrow(/wrong_email/);
    const unverified = await createUser(pool, "invitee@creators.com", false);
    await expect(as(unverified, "select public.affiliate_invite_accept($1) r", [tok])).rejects.toThrow(/sign_in_required/);
    // Re-inviting revokes the old link.
    await pool.query("select public.admin_affiliate_invite_create($1, 'invitee@creators.com', 'Invitee', null, $2, null, 14)", [owner, sha("inv-b")]);
    expect((await val("select public.affiliate_invite_lookup($1)", [tok]) as Row).valid).toBe(false);
  });

  it("onboarding: all seven steps gate submission; activation requires owner approval", async () => {
    const a = await activeAffiliate("onboard@creators.com");
    const me = await as<Row>(a.u, "select public.affiliate_me() r");
    expect(me.status).toBe("active");
    expect((me.onboarding.steps as Row[]).every((s) => s.done)).toBe(true);
    // Agreement acceptance is immutable and bound to the exact text.
    await expect(pool.query("update public.affiliate_agreement_acceptances set typed_name = 'x' where affiliate_id = $1", [a.id])).rejects.toThrow();
    await expect(as(a.u, "select public.affiliate_my_agreement_accept($1, 'deadbeef', 'Test') r", [me.agreement.id])).rejects.toThrow(/agreement_changed/);
    // W-9 is stored sealed; only last 4 are readable.
    expect(await q1("select w9_status, tin_last4 from public.affiliate_tax_profiles where affiliate_id = $1", [a.id])).toMatchObject({ w9_status: "submitted", tin_last4: "6789" });
  });

  it("YouTube import: ownership code verifies; imported metrics change only through an approved correction", async () => {
    const a = await activeAffiliate("yt@creators.com");
    const ch = "UC" + "a".repeat(22);
    const first = await val("select public.affiliate_channel_import($1, $2)", [a.u, JSON.stringify({ channel_id: ch, title: "Roof Talk", description: "Roofing videos", subscriber_count: "5000" })]) as Row;
    expect(first.verified_at).toBeNull();
    const code = first.verify_code as string;
    expect(code).toMatch(/^B2B-[A-Z0-9]{6}$/);
    const second = await val("select public.affiliate_channel_import($1, $2)", [a.u, JSON.stringify({ channel_id: ch, title: "Roof Talk", description: `Roofing videos ${code}`, subscriber_count: "5100" })]) as Row;
    expect(second.verified_method).toBe("description_code");
    // The same channel can't be claimed by someone else.
    const b = await activeAffiliate("yt2@creators.com");
    await expect(pool.query("select public.affiliate_channel_import($1, $2)", [b.u, JSON.stringify({ channel_id: ch, title: "x" })])).rejects.toThrow(/channel_claimed/);
    // No direct edits of imported YouTube data.
    await expect(as(a.u, "select public.affiliate_my_channel_self($1) r", [JSON.stringify({ platform: "youtube", url: "https://youtube.com/@fake", audience: "999999" })])).rejects.toThrow(/use_correction/);
    const x = await as<Row>(a.u, "select public.affiliate_my_correction('subscriber_count', '5200', 'Grew this week') r");
    expect(await val("select subscriber_count from public.affiliate_channels where affiliate_id = $1", [a.id])).toBe("5100");
    await pool.query("select public.admin_affiliate_correction_review($1, $2, true, 'ok')", [owner, x.id]);
    expect(await q1("select subscriber_count, data_source from public.affiliate_channels where affiliate_id = $1", [a.id])).toMatchObject({ subscriber_count: "5200", data_source: "admin_corrected" });
  });

  it("attribution: click + signup, self-referral, cookie stuffing, unknown code, one owner across Sales and Affiliates", async () => {
    const a = await activeAffiliate("attr@creators.com");
    const c = await referred(a.code);
    expect(await q1("select affiliate_id, code, campaign, source from public.affiliate_referrals where user_id = $1", [c])).toMatchObject({ affiliate_id: a.id, code: a.code, campaign: "spring", source: "youtube" });
    // A second link never moves the customer.
    const b = await activeAffiliate("attr2@creators.com");
    expect(await val("select public.affiliate_record_attribution($1, $2, now(), null)", [c, b.code])).toBe("already_attributed");
    // Self-referral: the affiliate's own login.
    expect(await val("select public.affiliate_record_attribution($1, $2, now(), null)", [a.u, a.code])).toBe("ineligible:self_referral");
    // Cookie stuffing: an account that existed long before the click.
    const old = await createUser(pool, "oldcustomer@shop.com");
    await pool.query("update auth.users set created_at = now() - interval '3 days' where id = $1", [old]);
    expect(await val("select public.affiliate_record_attribution($1, $2, now(), null)", [old, a.code])).toBe("existing_account");
    expect(await val("select public.affiliate_record_attribution($1, 'NOPE1234', now(), null)", [old])).toBe("unknown_code");

    // Sales vs affiliate: whoever is recorded first at account creation wins, in either order.
    const rep = (await q1("select (public.admin_sales_member_save($1, null, 'rep1@reps.com', 'Rep One', null, 'rep', 'active', null, true)) ->> 'id' id", [owner])).id as string;
    const repCode = await val("select code from public.sales_reps where id = $1", [rep]) as string;
    await pool.query("update public.sales_reps set status = 'active' where id = $1", [rep]);
    const s1 = await createUser(pool, "salesfirst@shop.com");
    expect(await val("select public.sales_record_attribution($1, $2, now())", [s1, repCode])).toBe("recorded");
    expect(await val("select public.affiliate_record_attribution($1, $2, now() - interval '1 minute', null)", [s1, a.code])).toBe("owned_by_sales");
    expect(await val("select public.sales_record_attribution($1, $2, now())", [c, repCode])).toBe("owned_by_affiliate");
    // Missing click record is flagged for review, not silently trusted.
    const c2 = await createUser(pool, "noclick@shop.com");
    expect(await val("select public.affiliate_record_attribution($1, $2, now() - interval '1 minute', null)", [c2, a.code])).toBe("recorded");
    expect(await val("select flags from public.affiliate_referrals where user_id = $1", [c2])).toContain("click_not_found");
  });

  it("year 1 from the first paid invoice, delayed upgrade pays the new value at the next anniversary, duplicates ignored", async () => {
    const a = await activeAffiliate("engine@creators.com");
    const c = await referred(a.code);
    const t0 = ago(380);
    expect((await invoice(c, `in_${c}_1`, t0)).action).toBe("recorded");
    expect((await invoice(c, `in_${c}_1`, t0)).action).toBe("duplicate");   // replayed webhook
    expect(await lines(c)).toEqual([{ year_no: 1, amount_cents: 1999, status: "pending", reason: null }]);
    // Monthly invoices, then an upgrade to $29.99 well before the anniversary.
    for (let m = 1; m < 13; m++) await invoice(c, `in_${c}_m${m}`, addMonths(t0, m), m >= 6 ? { gross: 2999, listMonthly: 2999 } : {});
    // A proration invoice never counts.
    await invoice(c, `in_${c}_prorate`, addMonths(t0, 6), { gross: 500, reason: "subscription_update" });
    await pool.query("select public.affiliate_daily(now())");
    const l = await lines(c);
    expect(l.map((x) => [x.year_no, x.amount_cents])).toEqual([[1, 1999], [2, 2999]]);
    // Never 12 monthly payments: only one line per year.
    expect(await val("select count(*)::int from public.affiliate_commissions where user_id = $1", [c])).toBe(2);
    // Year 1's hold has passed (payable); year 2's anniversary was 15 days ago, so it is still in the 30-day hold.
    expect(l.map((x) => x.status)).toEqual(["payable", "pending"]);
    // Term starts at first payment and the eligibility end is 9 years later.
    const r = await q1("select term_years, anniversary_date::text a, eligibility_end_date::text e from public.affiliate_referrals where user_id = $1", [c]);
    expect(r.term_years).toBe(10);
    expect(Number(r.e.slice(0, 4)) - Number(r.a.slice(0, 4))).toBe(9);
  });

  it("annual conversion pays annual/12 (configurable) and tax is excluded", async () => {
    const a = await activeAffiliate("annual@creators.com");
    const c = await referred(a.code);
    const t0 = ago(380);
    await invoice(c, `in_${c}_1`, t0, { gross: 2149, pretax: 1999 });        // $1.50 tax excluded
    await invoice(c, `in_${c}_y`, addMonths(t0, 11), { months: 12 });         // switched to annual before the anniversary
    await pool.query("select public.affiliate_daily(now())");
    expect((await lines(c)).map((x) => [x.year_no, x.amount_cents])).toEqual([[1, 1999], [2, 1658]]);
    // Discounted annual (e.g. 50% coupon) pays proportionally less, rounded to the cent.
    const c3 = await referred(a.code);
    await invoice(c3, `in_${c3}_y`, ago(10), { months: 12, gross: 9950 });
    expect((await lines(c3))[0].amount_cents).toBe(829);
  });

  it("refunds and chargebacks before payout reverse or reduce the line; refunds after payout only flag for review", async () => {
    const a = await activeAffiliate("refund@creators.com");
    const c = await referred(a.code);
    await invoice(c, `in_${c}_1`, ago(5));                 // still inside the 30-day hold
    await pool.query("select public.affiliate_invoice_refunded($1, 1000)", [`in_${c}_1`]);
    expect((await lines(c))[0]).toMatchObject({ amount_cents: 999, status: "pending", reason: "partial_refund" });
    await pool.query("select public.affiliate_invoice_refunded($1, 1999)", [`in_${c}_1`]);
    expect((await lines(c))[0]).toMatchObject({ amount_cents: 0, status: "reversed", reason: "refunded" });

    const c2 = await referred(a.code);
    await invoice(c2, `in_${c2}_1`, ago(5));
    await pool.query("select public.affiliate_invoice_disputed($1, 'open')", [`in_${c2}_1`]);
    await pool.query("select public.affiliate_mature(now() + interval '40 days')");
    expect((await lines(c2))[0].status).toBe("pending");                       // waits for the outcome
    await pool.query("select public.affiliate_invoice_disputed($1, 'lost')", [`in_${c2}_1`]);
    expect((await lines(c2))[0]).toMatchObject({ status: "reversed", reason: "chargeback" });
  });

  it("cancel then reactivate: the missed year is ineligible, the term never restarts, the later year still pays", async () => {
    const a = await activeAffiliate("react@creators.com");
    const c = await referred(a.code);
    const t0 = ago(365 * 2 + 60);
    await invoice(c, `in_${c}_1`, t0);
    await pool.query("select public.affiliate_sync_subscription($1, 'sub_1', 'canceled', 'Individual Unlimited', 1999, $2)", [c, addMonths(t0, 1).toISOString()]);
    const anniv = await val("select anniversary_date::text from public.affiliate_referrals where user_id = $1", [c]);
    // Reactivated 20 months later on an annual plan that covers the year-3 anniversary.
    await pool.query("select public.affiliate_sync_subscription($1, 'sub_2', 'active', 'Individual Unlimited annual', 1658, null)", [c]);
    await invoice(c, `in_${c}_re`, addMonths(t0, 20), { months: 12 });
    await pool.query("select public.affiliate_daily(now())");
    expect((await lines(c)).map((x) => [x.year_no, x.status, x.reason])).toEqual([
      // Year 3 was first marked missed (its invoice is recorded after the fact here), then recovered with a fresh hold.
      [1, "payable", null], [2, "ineligible", "not_paid_on_anniversary"], [3, "pending", "late_invoice"],
    ]);
    expect(await val("select anniversary_date::text from public.affiliate_referrals where user_id = $1", [c])).toBe(anniv);
  });

  it("year 10 is the last eligible year; year 11 never pays", async () => {
    const a = await activeAffiliate("ten@creators.com");
    const c = await referred(a.code);
    const t0 = ago(365 * 10 + 40);
    await invoice(c, `in_${c}_1`, t0);
    for (let y = 1; y <= 10; y++) await invoice(c, `in_${c}_y${y}`, addMonths(t0, 12 * y - 1), { months: 12 });
    await pool.query("select public.affiliate_daily(now())");
    const l = await lines(c);
    expect(l.length).toBe(10);
    expect(l.at(-1)).toMatchObject({ year_no: 10, amount_cents: 1658 });
    await expect(pool.query("insert into public.affiliate_commissions (affiliate_id, user_id, year_no, anniversary_date, amount_cents, status) values ($1, $2, 11, current_date, 1, 'pending')", [a.id, c])).rejects.toThrow();
  });

  it("payouts: one payout per affiliate, never duplicated; failed ACH is paid again; live return re-opens the line", async () => {
    await pool.query("select public.admin_payout_settings_save($1, '{\"mode\":\"test\"}')", [owner]);
    await pool.query("select public.admin_affiliate_settings_save($1, '{\"payouts_enabled\": true, \"confirm\": true}', 'Enable affiliate test payouts')", [owner]);
    const a = await activeAffiliate("payout@creators.com");
    const c = await referred(a.code);
    await invoice(c, `in_${c}_1`, ago(400), { gross: 2999, listMonthly: 2999 });
    await pool.query("select public.affiliate_daily(now())");
    await pool.query("select public.affiliate_payout_plan(now())");
    await pool.query("select public.affiliate_payout_plan(now())");                 // re-run: no duplicate
    const ps = (await pool.query("select * from public.payouts where affiliate_id = $1", [a.id])).rows;
    expect(ps.length).toBe(1);
    expect(ps[0]).toMatchObject({ gross_cents: 2999, net_cents: 2999, fee_bearer: "company", status: "scheduled", staff_id: null });
    expect(ps[0].ref).toMatch(/^B2B-AF-\d{6}-\d{6}-T$/);

    const claim = await val("select public.payout_claim_due(25, now() + interval '5 days')") as Row;
    const mine = (claim.payouts as Row[]).find((x) => x.id === ps[0].id)!;
    expect(mine.recipient_ref).toBe(`rcpt_${a.id}`);
    await pool.query("select public.payout_mark_submitted($1, 'mockaf_1')", [ps[0].id]);
    await pool.query("select public.payout_apply_event('evt_af_1', 'mockaf_1', 'failed', now(), 'insufficient_funds', true)");
    expect(await val("select status from public.affiliate_commissions where user_id = $1", [c])).toBe("payable");   // ledger preserved
    await pool.query("select public.affiliate_payout_plan(now())");
    expect(await val("select count(*)::int from public.payouts where affiliate_id = $1 and status = 'scheduled'", [a.id])).toBe(1);

    // Live settlement marks the line paid exactly once; a returned ACH puts it back as payable.
    const line = await val("select id from public.affiliate_commissions where user_id = $1", [c]) as string;
    await pool.query("update public.payout_items set active = false where source_id = $1", [line]);
    const p = await q1(`insert into public.payouts (ref, affiliate_id, mode, provider, gross_cents, fee_cents, fee_bearer, net_cents, status, scheduled_for, idempotency_key, provider_ref, submitted_at)
      values ('B2B-AF-LIVE-1', $1, 'live', 'stripe_global_payouts', 2999, 0, 'company', 2999, 'submitted', current_date, 'idem-af-live-1', 'obp_af_1', now()) returning id`, [a.id]);
    await pool.query("insert into public.payout_items (payout_id, mode, source_kind, source_id, amount_cents) values ($1, 'live', 'affiliate_commission', $2, 2999)", [p.id, line]);
    await pool.query("select public.payout_apply_event('evt_af_l1', 'obp_af_1', 'posted', now(), null, true)");
    expect(await q1("select status, payout_id from public.affiliate_commissions where id = $1", [line])).toMatchObject({ status: "paid", payout_id: p.id });
    expect(await val("select public.payout_apply_event('evt_af_l1', 'obp_af_1', 'posted', now(), null, true) ->> 'status'")).toBe("duplicate");
    // A refund AFTER payout never claws back automatically: it is flagged for owner review.
    await pool.query("select public.affiliate_invoice_refunded($1, 2999)", [`in_${c}_1`]);
    expect(await q1("select status, review_flag from public.affiliate_commissions where id = $1", [line])).toMatchObject({ status: "paid" });
    expect(await val("select review_flag from public.affiliate_commissions where id = $1", [line])).toMatch(/refund after payout/);
    await pool.query("select public.payout_apply_event('evt_af_l2', 'obp_af_1', 'returned', now(), 'account_closed', true)");
    expect(await q1("select status, payout_id from public.affiliate_commissions where id = $1", [line])).toMatchObject({ status: "payable", payout_id: null });
  });

  it("payout blockers: no W-9 or bank holds the payout", async () => {
    const a = await activeAffiliate("blocked@creators.com", { w9: false, bank: false });
    const b = await val("select public.affiliate_payout_blockers($1, 'test')", [a.id]) as string[];
    expect(b).toEqual(expect.arrayContaining(["w9_missing", "no_bank"]));
  });

  it("termination: without cause keeps future years; material misconduct holds unpaid lines for review", async () => {
    const a = await activeAffiliate("term1@creators.com");
    const c = await referred(a.code);
    await invoice(c, `in_${c}_1`, ago(5));
    await pool.query("select public.admin_affiliate_set_status($1, $2, 'terminated', 'without_cause', 'Program change')", [owner, a.id]);
    await pool.query("select public.affiliate_mature(now() + interval '40 days')");
    expect((await lines(c))[0].status).toBe("payable");

    const b = await activeAffiliate("term2@creators.com");
    const c2 = await referred(b.code);
    await invoice(c2, `in_${c2}_1`, ago(5));
    await pool.query("select public.admin_affiliate_set_status($1, $2, 'terminated', 'material_misconduct', 'Fake reviews')", [owner, b.id]);
    expect((await lines(c2))[0]).toMatchObject({ status: "held", reason: "affiliate_terminated_misconduct_review" });
  });

  it("attribution dispute moved to Sales: unpaid affiliate lines are canceled with an audit trail", async () => {
    const a = await activeAffiliate("dispute@creators.com");
    const c = await referred(a.code);
    await invoice(c, `in_${c}_1`, ago(5));
    const rep = (await q1("select (public.admin_sales_member_save($1, null, 'rep2@reps.com', 'Rep Two', null, 'rep', 'active', null, true)) ->> 'id' id", [owner])).id as string;
    const id = await val("select public.admin_affiliate_dispute_open($1, $2, 'attribution', 'Rep says they met this customer first', 'sales')", [owner, c]) as string;
    await pool.query("select public.admin_affiliate_dispute_resolve($1, $2, 'moved_to_sales', 'Rep showed the earlier meeting notes', null, $3)", [owner, id, rep]);
    expect((await lines(c))[0]).toMatchObject({ status: "canceled", reason: "attribution_moved" });
    expect(await val("select rep_id from public.sales_attributions where user_id = $1", [c])).toBe(rep);
    expect(await val("select count(*)::int from public.audit_logs where action = 'affiliate.dispute_resolved' and details ->> 'dispute' = $1", [id])).toBe(1);
  });

  it("isolation: affiliates see only their own customers, with privacy-safe labels; tables are closed to clients", async () => {
    const a = await activeAffiliate("iso1@creators.com");
    const b = await activeAffiliate("iso2@creators.com");
    const c = await referred(a.code, "private.person@shop.com");
    await invoice(c, `in_${c}_1`, ago(5));
    const da = await as<Row>(a.u, "select public.affiliate_my_dashboard() r");
    const db = await as<Row>(b.u, "select public.affiliate_my_dashboard() r");
    expect(da.referrals.length).toBe(1);
    expect(db.referrals.length).toBe(0);
    expect(JSON.stringify(da)).not.toContain("private.person");
    expect(da.referrals[0].label).toMatch(/^Customer [A-F0-9]{6}$/);
    await expect(as(a.u, "select count(*) r from public.affiliate_commissions")).rejects.toThrow(/permission denied/);
    await expect(as(a.u, "select public.affiliate_record_attribution($1, $2, now(), null) r", [a.u, a.code])).rejects.toThrow(/permission denied/);
    await expect(as(a.u, "select public.admin_affiliates_overview($1) r", [a.u])).rejects.toThrow(/permission denied/);
  });

  it("owner reports and overview return liabilities and the portfolio for projections", async () => {
    const r = await val("select public.admin_affiliate_reports($1, extract(year from now())::int)", [owner]) as Row;
    expect(r.referred).toBeGreaterThan(0);
    expect(Array.isArray(r.portfolio)).toBe(true);
    expect(typeof r.pending_cents === "number" || typeof r.pending_cents === "string").toBe(true);
    const o = await val("select public.admin_affiliates_overview($1)", [owner]) as Row;
    expect(o).toBeTruthy();
  });
  it("rollback removes the Affiliate Hub, restores the payout + attribution functions, and the migration re-applies", async () => {
    await pool.query(readFileSync("docs/affiliates/rollback_20270210001000.sql", "utf8"));
    expect(await val("select count(*)::int from pg_class where relname like 'affiliate\\_%' and relnamespace = 'public'::regnamespace")).toBe(0);
    expect(await val("select count(*)::int from pg_proc where (proname like 'affiliate\\_%' or proname like 'admin\\_affiliate%') and pronamespace = 'public'::regnamespace")).toBe(0);
    expect(await val("select count(*)::int from information_schema.columns where table_name = 'payouts' and column_name like 'affiliate%'")).toBe(0);
    expect(await val("select prosrc from pg_proc where proname = 'sales_record_attribution'")).not.toContain("affiliate");
    expect(await val("select prosrc from pg_proc where proname = 'payout_apply_event'")).not.toContain("affiliate");
    // Staff payouts still plan and claim after rollback.
    expect(await val("select public.payout_claim_due(25, now()) ->> 'mode'")).toBe("test");
    await pool.query(readFileSync("supabase/migrations/20270210001000_affiliate_hub.sql", "utf8"));
    expect(await val("select commission_years from public.affiliate_settings")).toBe(10);
  });
});
