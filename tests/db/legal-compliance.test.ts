import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createUser, dbAvailable, freshDb } from "./harness";

/** Legal review 2026-11-19: e-sign audit events, rep removal ("earned sales only") and calling compliance. */
const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
const q1 = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0];
const val = async (sql: string, params: unknown[] = []) => Object.values(await q1(sql, params))[0];

d("legal compliance (database)", () => {
  let owner: string, repUser: string, repId: string, repCode: string;
  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_legal_compliance"));
    owner = await createUser(pool, "owner@built2bid.org");
    await pool.query("insert into public.admin_roles (user_id, role) values ($1, 'admin')", [owner]);
    const r = (await q1("select public.admin_sales_rep_save($1, null, 'rita@sales.com', 'Rita', null, 'rep', 'active', null) as r", [owner])).r;
    repId = r.id; repCode = r.code;
    repUser = await createUser(pool, "rita@sales.com");
    await asUser(pool, repUser, (q) => q("select public.sales_me()"));
  });
  afterAll(async () => { await drop?.(); });

  it("keeps signing events service-role only and append-only", async () => {
    expect(await val("select count(*)::int from information_schema.tables where table_name = 'signing_events'")).toBe(1);
    await expect(asUser(pool, repUser, (q) => q("select * from public.signing_events"))).rejects.toThrow(/permission denied/);
    // Append-only: the guard trigger refuses updates even for the service role.
    const fn = await val("select prosrc from pg_proc where proname = 'guard_signing_event'");
    expect(String(fn)).toMatch(/signing_event_immutable/);
  });

  it("pays a removed rep for payments before they left, not after", async () => {
    const early = await createUser(pool, "early@roofco.com");
    const late = await createUser(pool, "late@roofco.com");
    for (const u of [early, late]) expect(await val("select public.sales_record_attribution($1, $2, now())", [u, repCode])).toBe("recorded");
    await pool.query("update public.sales_reps set status = 'removed' where id = $1", [repId]);
    const removedAt = await val("select removed_at from public.sales_reps where id = $1", [repId]) as Date;
    expect(removedAt).toBeTruthy();
    const before = new Date(removedAt.getTime() - 60_000).toISOString();
    const after = new Date(removedAt.getTime() + 60_000).toISOString();
    await val("select public.sales_sync_billing($1, 'sub_e', 'active', 'monthly', null, 1999, '{}'::jsonb, 'in_e', 1999, $2::timestamptz)", [early, before]);
    await val("select public.sales_sync_billing($1, 'sub_l', 'active', 'monthly', null, 1999, '{}'::jsonb, 'in_l', 1999, $2::timestamptz)", [late, after]);
    expect(await q1("select status, reason from public.sales_commissions where user_id = $1", [early])).toMatchObject({ status: "pending", reason: null });
    expect(await q1("select status, reason from public.sales_commissions where user_id = $1", [late])).toMatchObject({ status: "ineligible", reason: "rep_removed" });
    // Reinstating clears removed_at.
    await pool.query("update public.sales_reps set status = 'active' where id = $1", [repId]);
    expect(await val("select removed_at from public.sales_reps where id = $1", [repId])).toBeNull();
  });

  it("blocks calls and texts until the Do Not Call check, consent and calling hours allow them", async () => {
    const lead = (await asUser(pool, repUser, (q) => q("select public.sales_crm_lead_create($1::jsonb) as r", [JSON.stringify({ company_name: "Summit Roofing", phone: "612-555-0100", state: "MN", zip: "55401" })]))).rows[0].r.lead.id as string;
    const log = (kind: string, at: string) => asUser(pool, repUser, (q) => q("select public.sales_crm_activity_add($1, $2, 'note', $3::timestamptz)", [lead, kind, at]));
    const noonCentral = "2026-11-18T18:00:00Z"; // 12:00 in Minneapolis
    const lateCentral = "2026-11-19T03:30:00Z"; // 21:30 the evening before
    await expect(log("call", noonCentral)).rejects.toThrow(/dnc_unchecked/);
    await log("email", noonCentral); // email isn't a phone contact
    await asUser(pool, repUser, (q) => q("select public.sales_crm_dnc_record($1, 'clear', 'mobile', false, null)", [lead]));
    await log("call", noonCentral);
    await expect(log("call", lateCentral)).rejects.toThrow(/outside_calling_hours/);
    await expect(log("text", noonCentral)).rejects.toThrow(/text_needs_consent/);
    await asUser(pool, repUser, (q) => q("select public.sales_crm_dnc_record($1, 'clear', 'mobile', true, 'Texted us first')", [lead]));
    await log("text", noonCentral);
    await asUser(pool, repUser, (q) => q("select public.sales_crm_dnc_record($1, 'listed', 'mobile', false, null)", [lead]));
    await expect(log("call", noonCentral)).rejects.toThrow(/dnc_listed/);
    expect(await val("select dnc_checked_by from public.sales_leads where id = $1", [lead])).toBe(repUser);
    expect(await val("select count(*)::int from public.sales_activities where lead_id = $1 and kind = 'system' and body like 'Do Not Call check%'", [lead])).toBe(3);
  });

  it("maps states to their primary time zone", async () => {
    expect(await val("select public.sales_state_tz('az')")).toBe("America/Phoenix");
    expect(await val("select public.sales_state_tz(null)")).toBe("America/Chicago");
  });
});
