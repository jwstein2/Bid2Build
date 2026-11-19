import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { applyMigration, asUser, createUser, dbAvailable, freshDb } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
const q1 = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0];
const val = async (sql: string, params: unknown[] = []) => Object.values(await q1(sql, params))[0];
const rpc = async (user: string, sql: string, params: unknown[] = []) => Object.values((await asUser(pool, user, (q) => q(sql, params))).rows[0])[0];

d("sales CRM (database)", () => {
  let owner: string, ritaU: string, samU: string, maxU: string, rita: string, sam: string;
  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_sales_crm"));
    owner = await createUser(pool, "owner@built2bid.org");
    await pool.query("insert into public.admin_roles (user_id, role) values ($1, 'admin')", [owner]);
    await applyMigration(pool, "20270107002000_sales_crm.sql");
    rita = (await q1("select (public.admin_sales_rep_save($1, null, 'rita@sales.com', 'Rita', null, 'rep', 'active', null))->>'id' as id", [owner])).id;
    sam = (await q1("select (public.admin_sales_rep_save($1, null, 'sam@sales.com', 'Sam', null, 'rep', 'active', null))->>'id' as id", [owner])).id;
    await q1("select public.admin_sales_rep_save($1, null, 'max@sales.com', 'Max', null, 'manager', 'active', null)", [owner]);
    ritaU = await createUser(pool, "rita@sales.com"); samU = await createUser(pool, "sam@sales.com"); maxU = await createUser(pool, "max@sales.com");
    for (const u of [ritaU, samU, maxU]) await asUser(pool, u, (q) => q("select public.sales_me()"));
  });
  afterAll(async () => { await drop?.(); });

  it("normalizes identity keys", async () => {
    expect(await val("select public.sales_lead_keys('Summit Roofing LLC', 'https://www.SummitRoof.com/contact', '+1 (612) 555-0100', '55401')"))
      .toEqual(["d:summitroof.com", "p:6125550100", "n:summitroofing|55401"]);
    expect(await val("select public.sales_lead_keys('AB', null, '555', null)")).toEqual([]);
  });

  it("a rep adds a lead; another rep can't add or see the same business; managers see all", async () => {
    const r = await rpc(ritaU, "select public.sales_crm_lead_create($1::jsonb)", [JSON.stringify({ company_name: "Summit Roofing", phone: "612-555-0100", zip: "55401", trades: ["roofing"], email: "dana@summit.com" })]) as { ok: boolean; lead: { id: string; assigned_rep: string } };
    expect(r.ok).toBe(true);
    expect(r.lead.assigned_rep).toBe(rita);
    const dup = await rpc(samU, "select public.sales_crm_lead_create($1::jsonb)", [JSON.stringify({ company_name: "Summit Roofing LLC", phone: "(612) 555 0100" })]) as { ok: boolean; error: string };
    expect(dup).toMatchObject({ ok: false, error: "duplicate" });
    const forced = await rpc(samU, "select public.sales_crm_lead_create($1::jsonb)", [JSON.stringify({ company_name: "Summit Roofing LLC", phone: "(612) 555 0100", allow_duplicate: true })]) as { ok: boolean; error: string };
    expect(forced).toMatchObject({ ok: false, error: "owned_by_other" });
    expect(((await rpc(samU, "select public.sales_crm_leads()")) as { leads: unknown[] }).leads).toHaveLength(0);
    expect(((await rpc(maxU, "select public.sales_crm_leads()")) as { leads: unknown[] }).leads).toHaveLength(1);
    await expect(asUser(pool, samU, (q) => q("select public.sales_crm_lead($1)", [r.lead.id]))).rejects.toThrow(/not_found/);
    await expect(asUser(pool, samU, (q) => q("select public.sales_crm_activity_add($1, 'call', 'hi')", [r.lead.id]))).rejects.toThrow(/not_found/);
    await expect(asUser(pool, samU, (q) => q("select * from public.sales_leads"))).rejects.toThrow(/permission denied/);
    const outsider = await createUser(pool, "contractor@deck.com");
    await expect(asUser(pool, outsider, (q) => q("select public.sales_crm_leads()"))).rejects.toThrow(/not_sales_staff/);
    await expect(asUser(pool, ritaU, (q) => q("select public.admin_sales_crm($1)", [owner]))).rejects.toThrow(/permission denied/);
  });

  it("logs activity, moves new → contacted, tracks stage changes and tasks", async () => {
    const id = (await q1("select id from public.sales_leads where company_name = 'Summit Roofing'")).id;
    await rpc(ritaU, "select public.sales_crm_activity_add($1, 'call', 'Left voicemail')", [id]);
    expect(await val("select stage from public.sales_leads where id = $1", [id])).toBe("contacted");
    await rpc(ritaU, "select public.sales_crm_lead_update($1, $2::jsonb)", [id, JSON.stringify({ stage: "demo" })]);
    const t = await rpc(ritaU, "select public.sales_crm_task_save($1, null, 'Send demo recap', '2027-01-05T15:00:00Z', false)", [id]) as { id: string };
    expect((await val("select next_action_at from public.sales_leads where id = $1", [id]) as Date).toISOString()).toBe("2027-01-05T15:00:00.000Z");
    await rpc(ritaU, "select public.sales_crm_task_save($1, $2, null, null, true)", [id, t.id]);
    expect(await val("select next_action_at from public.sales_leads where id = $1", [id])).toBeNull();
    const detail = await rpc(ritaU, "select public.sales_crm_lead($1)", [id]) as { activities: { kind: string }[]; tasks: unknown[] };
    expect(detail.activities.map((a) => a.kind)).toEqual(expect.arrayContaining(["call", "stage", "system"]));
    expect(detail.tasks).toHaveLength(1);
  });

  it("links the lead when the business signs up through the rep's link, and marks it paying on first payment", async () => {
    const code = await val("select code from public.sales_reps where id = $1", [rita]);
    const u = await createUser(pool, "dana@summit.com");
    expect(await val("select public.sales_record_attribution($1, $2, now())", [u, code])).toBe("recorded");
    expect(await q1("select stage, customer_user_id from public.sales_leads where company_name = 'Summit Roofing'")).toEqual({ stage: "trial", customer_user_id: u });
    await val("select public.sales_sync_billing($1, 's', 'active', 'monthly', null, 1999, '{}'::jsonb, 'in_x', 1999, now())", [u]);
    expect(await val("select stage from public.sales_leads where company_name = 'Summit Roofing'")).toBe("paying");
  });

  it("owner imports (skipping duplicates) and assigns in bulk with history", async () => {
    const r = await val("select public.admin_sales_crm_import($1, $2::jsonb, null)", [owner, JSON.stringify([
      { company_name: "Bright Deck", zip: "55102", trades: ["decks"] }, { company_name: "Summit Roofing", phone: "6125550100" }, { company_name: "" },
    ])]);
    expect(r).toEqual({ added: 1, skipped: 1 });
    const id = (await q1("select id from public.sales_leads where company_name = 'Bright Deck'")).id;
    expect(await val("select public.admin_sales_crm_assign($1, $2::uuid[], $3)", [owner, [id], sam])).toBe(1);
    expect(((await rpc(samU, "select public.sales_crm_leads()")) as { leads: unknown[] }).leads).toHaveLength(1);
    expect(await val("select count(*)::int from public.sales_activities where lead_id = $1 and kind = 'assignment'", [id])).toBe(1);
    expect(await val("select count(*)::int from public.audit_logs where action in ('sales.leads_imported', 'sales.leads_assigned')")).toBe(2);
  });
});
