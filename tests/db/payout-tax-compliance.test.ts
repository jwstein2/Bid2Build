import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createUser, dbAvailable, freshDb, type Row } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
const q1 = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0] as Row;
const val = async (sql: string, params: unknown[] = []) => Object.values(await q1(sql, params))[0];
const hash = (s: string) => createHash("sha256").update(`staff-${s}`).digest("hex");
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const as = <T,>(u: string, sql: string, params: unknown[] = []) => asUser(pool, u, async (q) => (await q(sql, params)).rows[0]?.r as T);

/** Synthetic personnel only: a fully onboarded 1099 rep with one approved statement, working in `state`. */
async function contractor(owner: string, email: string, cents: number, state: string) {
  const rep = (await q1("select (public.admin_sales_member_save($1, null, $2, $3, null, 'rep', 'invited', null, true)) ->> 'id' id", [owner, email, email.split("@")[0]])).id as string;
  const st = (await q1("insert into public.sales_statements (rep_id, period_month, status, total_cents, line_count, approved_at) values ($1, '2026-10-01', 'approved', $2, 1, now()) returning id", [rep, cents])).id as string;
  await pool.query("insert into public.sales_commissions (rep_id, year_no, period_month, amount_cents, status, statement_id, earned_at, approved_at) values ($1, 1, '2026-10-01', $2, 'approved', $3, now(), now())", [rep, cents, st]);
  const staff = await val("select id from public.staff_members where sales_rep_id = $1", [rep]) as string;
  await pool.query("select public.admin_staff_save($1, $2, $3)", [owner, staff, JSON.stringify({ classification: "contractor_1099", comp_types: ["commission"], work_state: state })]);
  await pool.query("select public.admin_staff_invite_create($1, $2, $3, 7)", [owner, staff, hash(email)]);
  const u = await createUser(pool, email);
  await as(u, "select public.staff_invite_accept($1) r", [hash(email)]);
  await as(u, "select public.staff_my_profile_save($1) r", [JSON.stringify({ legal_first_name: "Test", legal_last_name: email.split("@")[0], phone: "555-0100", address_line1: "1 Main St", city: "Town", state, postal_code: "55901" })]);
  await as(u, "select public.staff_my_role_confirm() r");
  const me = await as<Row>(u, "select public.staff_me() r");
  for (const a of me.required_agreements as Row[]) await as(u, "select public.staff_my_agreement_accept($1, $2, 'Test Person', '127.0.0.1', 'vitest') r", [a.id, sha(a.body)]);
  await pool.query("select public.staff_w9_store($1, $2, null, 'individual', null, 'ssn', '4321', 'v1.aaaaaaaaaaaaaaaa.bbbb.cccc', 'Test Person')", [u, `Test ${email.split("@")[0]}`]);
  await pool.query("select public.staff_destination_record($1, 'mock', 'test', $2, $3, 'STRIPE TEST BANK', 'checking', '6789', 'verified')", [u, `rcpt_${staff}`, `pm_${staff}`]);
  await pool.query("select public.staff_security_confirm($1)", [u]);
  await as(u, "select public.staff_my_finish() r");
  return { staff, st, user: u };
}

/** A live, settled payout written straight to the ledger (provider evidence is covered by staff-payouts tests). */
async function livePaid(staff: string, gross: number, settled: string, ref: string) {
  return (await q1(`insert into public.payouts (ref, staff_id, mode, provider, gross_cents, fee_cents, fee_bearer, net_cents, status, scheduled_for, idempotency_key, provider_ref, submitted_at, settled_at, tax_year)
    values ($1, $2, 'live', 'stripe_global_payouts', $3, 0, 'company', $3, 'paid', $4::timestamptz::date, $1 || '-idem', $1 || '-obp', $4::timestamptz, $4::timestamptz, extract(year from $4::timestamptz)::int) returning *`,
    [ref, staff, gross, `${settled}T17:00:00Z`]));
}

d("V8.4 payout taxes, withholding and state rules (database)", () => {
  let owner: string;

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_payout_tax"));
    owner = await createUser(pool, "owner@built2bid.org");
    await pool.query("insert into public.admin_roles (user_id, role) values ($1, 'admin')", [owner]);
    await pool.query("select public.admin_payout_settings_save($1, '{\"mode\":\"test\", \"review_above_cents\": 10000000}')", [owner]);
  });
  afterAll(async () => { await drop?.(); });

  it("starts safe: withholding off, rate unverified, every state unverified", async () => {
    expect(await q1("select backup_withholding_enabled, backup_withholding_bps, backup_rate_verified, filing_method from public.payout_tax_settings"))
      .toMatchObject({ backup_withholding_enabled: false, backup_withholding_bps: 2400, backup_rate_verified: false, filing_method: "not_chosen" });
    expect(await val("select count(*)::int from public.payout_state_tax_rules")).toBe(51);
    expect(await val("select count(*)::int from public.payout_state_tax_rules where verified")).toBe(0);
    expect(await q1("select contractor_reporting, contractor_report_days, state_backup_withholding_bps from public.payout_state_tax_rules where state = 'CA'"))
      .toMatchObject({ contractor_reporting: "required", contractor_report_days: 20, state_backup_withholding_bps: 700 });
    expect(await val("select public.us_state_code(' minnesota ')")).toBe("MN");
    expect(await val("select public.us_state_code('mn')")).toBe("MN");
    expect(await val("select public.us_state_code('Atlantis')")).toBeNull();
  });

  it("an IRS-noticed payee is held (never paid in full) until withholding is on, then 24% is withheld", async () => {
    const { staff } = await contractor(owner, "noticed@reps.test", 100000, "MN");
    await expect(pool.query("select public.admin_payee_tax_status_save($1, 'staff', $2, '{\"backup_withholding\": true}')", [owner, staff])).rejects.toThrow(/reason_required/);
    await pool.query("select public.admin_payee_tax_status_save($1, 'staff', $2, '{\"backup_withholding\": true, \"backup_withholding_reason\": \"irs_b_notice\"}')", [owner, staff]);
    await pool.query("select public.payout_plan()");
    const held = await q1("select * from public.payouts where staff_id = $1", [staff]);
    expect(held).toMatchObject({ status: "held", withholding_cents: 0, net_cents: 100000, tax_state: "MN" });
    expect(held.hold_reasons).toContain("backup_withholding_setup");

    // Turning withholding on needs a verified rate.
    await expect(pool.query("select public.admin_payout_tax_settings_save($1, '{\"backup_withholding_enabled\": true}')", [owner])).rejects.toThrow(/rate_not_verified/);
    await pool.query("select public.admin_payout_tax_settings_save($1, '{\"backup_withholding_enabled\": true, \"backup_rate_verified\": true}')", [owner]);
    // The held payout picked up the withholding at once; the next run releases it.
    expect(await q1("select withholding_cents, state_withholding_cents, net_cents from public.payouts where id = $1", [held.id])).toMatchObject({ withholding_cents: 24000, state_withholding_cents: 0, net_cents: 76000 });
    await pool.query("select public.payout_plan()");
    expect(await q1("select status, withholding_reason from public.payouts where id = $1", [held.id])).toMatchObject({ status: "scheduled", withholding_reason: "backup_withholding" });

    // Once claimed for sending, the amounts are frozen even if the rate changes.
    const claim = await val("select public.payout_claim_due(25, $1::timestamptz)", [new Date(Date.now() + 3 * 864e5).toISOString()]) as Row;
    expect((claim.payouts as Row[]).find((x) => x.id === held.id)).toMatchObject({ net_cents: 76000 });
    await pool.query("select public.admin_payout_tax_settings_save($1, '{\"backup_withholding_bps\": 2800}')", [owner]);
    expect(await q1("select status, withholding_cents, net_cents from public.payouts where id = $1", [held.id])).toMatchObject({ status: "submitting", withholding_cents: 24000, net_cents: 76000 });
    await pool.query("select public.admin_payout_tax_settings_save($1, '{\"backup_withholding_bps\": 2400}')", [owner]);
  });

  it("state backup withholding applies only once that state is verified", async () => {
    const { staff } = await contractor(owner, "cali@reps.test", 50000, "CA");
    await pool.query("select public.admin_payee_tax_status_save($1, 'staff', $2, '{\"backup_withholding\": true, \"backup_withholding_reason\": \"irs_cp2100\"}')", [owner, staff]);
    await pool.query("select public.payout_plan()");
    const p = await q1("select * from public.payouts where staff_id = $1", [staff]);
    expect(p).toMatchObject({ withholding_cents: 12000, state_withholding_cents: 0, net_cents: 38000, tax_state: "CA" });
    await expect(pool.query("select public.admin_state_tax_rule_save($1, 'CA', '{\"verified\": true, \"source_note\": \"x\"}')", [owner])).rejects.toThrow(/state_rule_verified/);
    await pool.query("select public.admin_state_tax_rule_save($1, 'CA', '{\"verified\": true, \"source_note\": \"CPA confirmed 2026-12-01\"}')", [owner]);
    expect(await q1("select withholding_cents, state_withholding_cents, net_cents from public.payouts where id = $1", [p.id])).toMatchObject({ withholding_cents: 12000, state_withholding_cents: 3500, net_cents: 34500 });
    // Removing the flag removes the withholding before anything is sent.
    await pool.query("select public.admin_payee_tax_status_save($1, 'staff', $2, '{\"backup_withholding\": false, \"tin_match_status\": \"matched\"}')", [owner, staff]);
    expect(await q1("select withholding_cents, state_withholding_cents, net_cents from public.payouts where id = $1", [p.id])).toMatchObject({ withholding_cents: 0, state_withholding_cents: 0, net_cents: 50000 });
    expect(await q1("select backup_withholding, backup_withholding_reason, tin_match_status from public.staff_tax_profiles where staff_id = $1", [staff]))
      .toMatchObject({ backup_withholding: false, backup_withholding_reason: null, tin_match_status: "matched" });
  });

  it("live payouts need the payee's state known and verified (state-by-state gate)", async () => {
    const { staff } = await contractor(owner, "gate@reps.test", 1000, "MN");
    await pool.query("select public.staff_destination_record(user_id, 'stripe_global_payouts', 'live', 'acct_live', 'pm_live', 'BANK', 'checking', '1111', 'verified') from public.staff_members where id = $1", [staff]);
    await pool.query("update public.staff_payout_destinations set eligible_from = null where staff_id = $1", [staff]);
    expect(await val("select public.payout_blockers($1, 'test')::text", [staff])).toBe("{}");
    expect(await val("select public.payout_blockers($1, 'live')::text", [staff])).toBe("{state_tax_rule_unverified}");
    await pool.query("update public.staff_members set work_state = null, state = 'Nowhere' where id = $1", [staff]);
    expect(await val("select public.payout_blockers($1, 'live')::text", [staff])).toBe("{tax_state_missing}");
    await pool.query("update public.staff_members set work_state = 'MN' where id = $1", [staff]);
    await pool.query("select public.admin_state_tax_rule_save($1, 'MN', '{\"verified\": true, \"source_note\": \"CPA confirmed MN rules\", \"state_1099_filing\": \"direct\"}')", [owner]);
    expect(await val("select public.payout_blockers($1, 'live')::text", [staff])).toBe("{}");
    const pre = await val("select public.admin_tax_preflight($1)", [owner]) as Row;
    expect(pre.verified_states).toBe(2);
  });

  it("tax season report: 1099 needs, withholding by month, CA contractor reporting deadline", async () => {
    const { staff: mn } = await contractor(owner, "season@reps.test", 1000, "MN");
    const { staff: ca } = await contractor(owner, "season-ca@reps.test", 1000, "CA");
    await livePaid(mn, 150000, "2026-03-10", "B2B-PO-T1");
    await livePaid(mn, 100000, "2026-05-10", "B2B-PO-T2");
    await livePaid(ca, 40000, "2026-02-01", "B2B-PO-T3");
    await livePaid(ca, 30000, "2026-04-15", "B2B-PO-T4");
    // Withholding on a live paid payout (written before submission would be computed; here set directly via a flag).
    await pool.query("select public.admin_payee_tax_status_save($1, 'staff', $2, '{\"backup_withholding\": true, \"backup_withholding_reason\": \"irs_b_notice\"}')", [owner, ca]);
    await livePaid(ca, 10000, "2026-06-20", "B2B-PO-T5");
    await pool.query("select public.admin_withholding_deposit_record($1, $2)", [owner, JSON.stringify({ jurisdiction: "federal", period_month: "2026-06-01", amount_cents: 2400, deposited_on: "2026-07-14", confirmation: "EFTPS-1" })]);
    await pool.query("select public.admin_state_filing_record($1, $2)", [owner, JSON.stringify({ payee_kind: "staff", payee_id: ca, state: "CA", kind: "contractor_report", tax_year: 2026, filed_on: "2026-04-20" })]);

    const t = await val("select public.admin_tax_season($1, 2026)", [owner]) as Row;
    const pm = (t.payees as Row[]).find((p) => p.id === mn)!;
    const pc = (t.payees as Row[]).find((p) => p.id === ca)!;
    expect(pm).toMatchObject({ gross_cents: 250000, federal_withheld_cents: 0, needs_1099: true, tax_state: "MN", tin_last4: "4321", missing: [] });
    expect(pm.tin).toBeUndefined();
    // Under the (unverified) $2,000 threshold, but withholding means a 1099 anyway.
    expect(pc).toMatchObject({ gross_cents: 80000, federal_withheld_cents: 2400, state_withheld_cents: 700, needs_1099: true, tax_state: "CA" });
    expect(t.withholding_by_month).toEqual([{ month: "2026-06-01", federal_cents: 2400, state: { CA: 700 } }]);
    expect((t.deposits as Row[])[0]).toMatchObject({ jurisdiction: "federal", amount_cents: 2400, confirmation: "EFTPS-1" });
    const report = (t.contractor_reports as Row[]).find((r) => r.payee_id === ca)!;
    // $600 crossed on the second payout (Apr 15): due 20 days later.
    expect(report).toMatchObject({ state: "CA", crossed_on: "2026-04-15", due_on: "2026-05-05", filed_on: "2026-04-20", rule_verified: true });
    const caState = (t.states as Row[]).find((s) => s.state === "CA")!;
    expect(caState).toMatchObject({ verified: true, filings: 1, state_withheld_cents: 700 });
    expect((t.ledger as Row[]).length).toBe(5);
  });

  it("only the owner changes tax settings; an external accountant can read the report", async () => {
    const rando = await createUser(pool, "rando@reps.test");
    await expect(pool.query("select public.admin_payout_tax_settings_save($1, '{}')", [rando])).rejects.toThrow(/owner_only/);
    await expect(pool.query("select public.admin_state_tax_rule_save($1, 'MN', '{}')", [rando])).rejects.toThrow(/owner_only/);
    await expect(pool.query("select public.admin_tax_season($1, 2026)", [rando])).rejects.toThrow(/forbidden/);
    const acct = (await q1("insert into public.staff_members (email, display_name, status, classification) values ('cpa@firm.test', 'CPA', 'active', 'vendor') returning id")).id;
    const u = await createUser(pool, "cpa@firm.test");
    await pool.query("update public.staff_members set user_id = $1 where id = $2", [u, acct]);
    await pool.query("insert into public.staff_roles (staff_id, role) values ($1, 'external_accountant')", [acct]);
    expect(((await val("select public.admin_tax_season($1, 2026)", [u])) as Row).year).toBe(2026);
    await expect(pool.query("select public.admin_withholding_deposit_record($1, '{}')", [u])).rejects.toThrow(/owner_only/);
    // Anonymous / signed-in users can't call any of it directly.
    await expect(as(u, "select public.admin_tax_season($1, 2026) r", [u])).rejects.toThrow(/permission denied/);
  });
});
