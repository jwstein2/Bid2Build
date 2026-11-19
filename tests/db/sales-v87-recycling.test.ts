import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createUser, dbAvailable, freshDb } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
const q1 = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0];
const val = async (sql: string, params: unknown[] = []) => Object.values(await q1(sql, params))[0];

let seq = 0;
const row = (over: Record<string, unknown> = {}) => {
  seq++;
  return { company_name: `Recycle Co ${seq}`, email: `o${seq}@rc${seq}.com`, phone: `763555${String(1000 + seq).slice(-4)}`,
    website: `rc${seq}.com`, city: `Town${seq}`, state: "MN", zip: "55901", trades: ["roofing"], ...over };
};
const importRows = async (rows: unknown[]) => (await q1("select public.sales_import_batch($1, 'test', $2::jsonb, 0) r", [`b-${++seq}`, JSON.stringify(rows)])).r as { added_ids: string[] };
const run = async (days: number) => (await q1("select public.sales_recycle_run(null, now() + $1::float8 * interval '1 day') r", [days])).r;
const ownerOf = (lead: string) => val("select assigned_rep from public.sales_leads where id = $1", [lead]);
const act = (lead: string, kind: string, disposition: string | null, at = "now()") =>
  pool.query(`insert into public.sales_activities (lead_id, kind, body, disposition, occurred_at) values ($1, $2, 'x', $3, ${at})`, [lead, kind, disposition]);

d("sales hub V8.7 lead recycling (database)", () => {
  let owner: string, anaU: string;
  let ana: string, ben: string, cal: string;

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_sales_v87"));
    owner = await createUser(pool, "owner@built2bid.org");
    await pool.query("insert into public.admin_roles (user_id, role) values ($1, 'admin')", [owner]);
    const member = async (email: string, name: string) =>
      (await q1("select public.admin_sales_member_save($1, null, $2, $3, null, 'rep', 'active', null, true) r", [owner, email, name])).r.id as string;
    ana = await member("ana@sales.com", "Ana Able");
    ben = await member("ben@sales.com", "Ben Best");
    cal = await member("cal@sales.com", "Cal Cole");
    anaU = await createUser(pool, "ana@sales.com");
    for (const e of ["ben@sales.com", "cal@sales.com"]) {
      const u = await createUser(pool, e);
      await asUser(pool, u, (q) => q("select public.sales_me()"));
    }
    await asUser(pool, anaU, (q) => q("select public.sales_me()"));
  });
  afterAll(async () => { await drop?.(); });
  beforeEach(async () => {
    await pool.query("delete from public.sales_leads");
    await pool.query("delete from public.sales_rep_notices");
    await pool.query("delete from public.sales_time_off");
    await pool.query("update public.sales_reps set status = 'active', allocation_paused = false, last_allocated_at = null");
    await pool.query("update public.sales_settings set recycle_enabled = true, recycle_max_cycles = 3, recycle_started_at = now() - interval '30 days'");
  });

  it("counts only real work: calls with an outcome, sent emails, replies and meetings, never notes or failed emails", async () => {
    expect(await val("select public.sales_activity_qualifies('note', null, 'manual')")).toBe(false);
    expect(await val("select public.sales_activity_qualifies('email', 'failed', 'manual')")).toBe(false);
    expect(await val("select public.sales_activity_qualifies('email', 'bounced', 'provider')")).toBe(false);
    expect(await val("select public.sales_activity_qualifies('email', 'sent', 'manual')")).toBe(true);
    expect(await val("select public.sales_activity_qualifies('call', 'voicemail', 'manual')")).toBe(true);
    expect(await val("select public.sales_activity_qualifies('call', null, 'manual')")).toBe(false);
    expect(await val("select public.sales_activity_qualifies('meeting', 'scheduled', 'manual')")).toBe(true);
    expect(await val("select public.sales_activity_qualifies('reply', null, 'manual')")).toBe(true);
    expect(await val("select public.sales_activity_qualifies('call', 'connected', 'system')")).toBe(false);

    const { added_ids: ids } = await importRows([row(), row(), row(), row(), row()]);
    await act(ids[0], "note", null);
    await act(ids[1], "email", "failed");
    await act(ids[2], "call", "voicemail");
    await act(ids[3], "email", "sent");
    await act(ids[4], "reply", null);
    const rules = (await pool.query("select lead_id, rule from public.sales_recycle_eval(now()) where lead_id = any ($1)", [ids])).rows;
    const by = Object.fromEntries(rules.map((r) => [r.lead_id, r.rule]));
    expect([by[ids[0]], by[ids[1]], by[ids[2]], by[ids[3]], by[ids[4]]]).toEqual(["first_contact", "first_contact", null, null, null]);
    expect(await val("select public.sales_lead_contact_level($1)", [ids[2]])).toBe("attempted");
    expect(await val("select public.sales_lead_contact_level($1)", [ids[4]])).toBe("two_way");
  });

  it("warns 24 hours ahead, waits out the warning, then recycles to another rep with history kept", async () => {
    const { added_ids: [lead] } = await importRows([row()]);
    const first = await ownerOf(lead);
    expect(await run(5)).toMatchObject({ warned: 0, recycled: 0 });
    expect(await run(6.5)).toMatchObject({ warned: 1, recycled: 0 });
    const n = await q1("select body, lead_ids from public.sales_rep_notices where kind = 'recycle_warning'");
    expect(n.body).toContain("Recycle Co");
    expect(n.lead_ids).toEqual([lead]);
    // Re-running doesn't warn twice; past the deadline but inside the warning window it still waits.
    expect(await run(7.1)).toMatchObject({ warned: 0, recycled: 0 });
    expect(await run(7.6)).toMatchObject({ recycled: 1 });
    const now = await ownerOf(lead);
    expect(now).not.toBe(first);
    expect(now).not.toBeNull();
    const h = await q1("select reason, outcome, cycle, from_rep, to_rep from public.sales_lead_recycles where lead_id = $1", [lead]);
    expect(h).toMatchObject({ reason: "first_contact", outcome: "reassigned", cycle: 1, from_rep: first, to_rep: now });
    expect(await val("select count(*)::int from public.sales_leads where id = $1", [lead])).toBe(1);
    expect(await val("select end_reason from public.sales_lead_assignments where lead_id = $1 and rep_id = $2", [lead, first])).toBe("recycle");
    expect(await val("select count(*)::int from public.sales_rep_notices where kind = 'leads_recycled' and rep_id = $1", [first])).toBe(1);
    expect(await val("select count(*)::int from public.sales_rep_notices where kind = 'leads_assigned' and rep_id = $1 and body like '%team pool%'", [now])).toBe(1);
    // The new owner gets a fresh window.
    expect(await val("select rule from public.sales_recycle_eval(now()) where lead_id = $1", [lead])).toBe("first_contact");
  });

  it("never recycles customers, trials, restricted contacts, held leads, leads with appointments, disputed leads or reps on time off", async () => {
    const { added_ids: ids } = await importRows([row(), row(), row(), row(), row(), row(), row()]);
    const cust = await createUser(pool, "customer@biz.com");
    await pool.query("update public.sales_leads set customer_user_id = $2 where id = $1", [ids[0], cust]);
    await pool.query("update public.sales_leads set stage = 'trial' where id = $1", [ids[1]]);
    await pool.query("update public.sales_leads set dnc_status = 'listed' where id = $1", [ids[2]]);
    await q1("select public.admin_sales_recycle_hold($1, $2, now() + interval '30 days', 'Big account') r", [owner, [ids[3]]]);
    const rep4 = await ownerOf(ids[4]);
    await pool.query("insert into public.sales_calendar_events (rep_id, kind, title, starts_at, ends_at, lead_id) values ($1, 'meeting', 'Demo', now() + interval '10 days', now() + interval '10 days 1 hour', $2)", [rep4, ids[4]]);
    // Dispute from the owner of ids[5].
    const rep5 = await ownerOf(ids[5]);
    const u5 = await val("select user_id from public.sales_reps where id = $1", [rep5]) as string;
    await asUser(pool, u5, (q) => q("select public.sales_recycle_dispute($1, 'Spoke on the phone at a trade show')", [ids[5]]));
    await expect(asUser(pool, u5, (q) => q("select public.sales_recycle_dispute($1, 'Again please')", [ids[5]]))).rejects.toThrow(/already_disputed/);
    // Owner of ids[6] is on time off through the deadline.
    const rep6 = await ownerOf(ids[6]);
    await pool.query("insert into public.sales_time_off (rep_id, starts_at, ends_at, customer_message) values ($1, now(), now() + interval '9 days', 'Away')", [rep6]);

    const prot = (await pool.query("select lead_id, protected from public.sales_recycle_eval(now() + interval '8 days') where lead_id = any ($1)", [ids])).rows;
    expect(Object.fromEntries(prot.map((r) => [r.lead_id, r.protected]))).toEqual({
      [ids[0]]: "customer_or_closed", [ids[1]]: "customer_or_closed", [ids[2]]: "contact_restricted", [ids[3]]: "admin_hold",
      [ids[4]]: "appointment", [ids[5]]: "disputed", [ids[6]]: "time_off",
    });
    expect(await run(6.5)).toMatchObject({ warned: 0 });
    expect(await run(8)).toMatchObject({ recycled: 0 });
  });

  it("recycles a worked lead only when its follow-up is overdue past the grace period", async () => {
    const { added_ids: [lead] } = await importRows([row()]);
    const rep = await ownerOf(lead);
    await act(lead, "email", "sent");
    await pool.query("insert into public.sales_tasks (lead_id, rep_id, title, due_at) values ($1, $2, 'Call back', now() + interval '1 day')", [lead, rep]);
    expect(await val("select rule from public.sales_recycle_eval(now() + interval '20 hours') where lead_id = $1", [lead])).toBeNull();
    expect(await run(2.5)).toMatchObject({ warned: 0 });
    // Due day 1, grace 3 days: warned on day 3, recycled after day 4 once the warning has run 24 hours.
    expect(await run(3.1)).toMatchObject({ warned: 1 });
    expect(await q1("select rule from public.sales_recycle_eval(now() + interval '3 days') where lead_id = $1", [lead])).toMatchObject({ rule: "overdue_followup" });
    expect(await run(4.2)).toMatchObject({ recycled: 1 });
    expect(await val("select reason from public.sales_lead_recycles where lead_id = $1", [lead])).toBe("overdue_followup");
    // The open follow-up travels to the new owner.
    expect(await val("select rep_id from public.sales_tasks where lead_id = $1", [lead])).toBe(await ownerOf(lead));
  });

  it("holds the lead when no other rep is free, then shares it out later, never to the previous owner", async () => {
    await pool.query("update public.sales_reps set allocation_paused = true where id in ($1, $2)", [ben, cal]);
    const { added_ids: [lead] } = await importRows([row()]);
    expect(await ownerOf(lead)).toBe(ana);
    await run(6.5);
    expect(await run(7.6)).toMatchObject({ recycled: 1, no_alternative: 1 });
    expect(await q1("select assigned_rep, hold_reason from public.sales_leads where id = $1", [lead])).toMatchObject({ assigned_rep: null, hold_reason: "recycle_no_alternative" });
    // The normal queue doesn't hand it back to Ana either.
    await pool.query("select public.sales_allocate_queue(null)");
    expect(await ownerOf(lead)).toBeNull();
    await pool.query("update public.sales_reps set allocation_paused = false where id = $1", [cal]);
    expect(await run(7.7)).toMatchObject({ requeued: 1 });
    expect(await ownerOf(lead)).toBe(cal);
  });

  it("sends a lead to admin review after the cycle limit instead of rotating it forever", async () => {
    await pool.query("update public.sales_settings set recycle_max_cycles = 2");
    const { added_ids: [lead] } = await importRows([row()]);
    await run(6.5); await run(7.6);
    expect(await val("select recycle_count from public.sales_leads where id = $1", [lead])).toBe(1);
    // Second owner's window runs from their (real) assignment time.
    await run(6.5); await run(7.6);
    expect(await q1("select assigned_rep, hold_reason, recycle_count from public.sales_leads where id = $1", [lead])).toMatchObject({ assigned_rep: null, hold_reason: "recycle_review", recycle_count: 2 });
    const o = await q1("select public.admin_sales_recycle_overview($1, '{}'::jsonb) r", [owner]);
    expect(o.r.review.map((x: { lead_id: string }) => x.lead_id)).toContain(lead);
    expect(o.r.metrics.recycled).toBe(2);
    await q1("select public.admin_sales_recycle_review($1, $2, 'dormant', null) r", [owner, lead]);
    expect(await val("select hold_reason from public.sales_leads where id = $1", [lead])).toBe("dormant");
    await pool.query("select public.sales_allocate_queue(null)");
    expect(await ownerOf(lead)).toBeNull();
    await q1("select public.admin_sales_recycle_review($1, $2, 'reassign', $3) r", [owner, lead, ben]);
    expect(await q1("select assigned_rep, recycle_count, hold_reason from public.sales_leads where id = $1", [lead])).toMatchObject({ assigned_rep: ben, recycle_count: 0, hold_reason: null });
  });

  it("is safe when two runs overlap", async () => {
    const { added_ids: ids } = await importRows([row(), row(), row()]);
    await run(6.5);
    const [a, b] = await Promise.all([run(7.6), run(7.6)]);
    expect(a.recycled + b.recycled).toBe(3);
    expect(await val("select count(*)::int from public.sales_lead_recycles where lead_id = any ($1)", [ids])).toBe(3);
    expect(await val("select count(*)::int from public.sales_lead_assignments where lead_id = any ($1) and ended_at is null", [ids])).toBe(3);
  });

  it("recycles a suspended rep's leads without waiting, and does nothing while recycling is paused", async () => {
    const { added_ids: [lead] } = await importRows([row()]);
    const rep = await ownerOf(lead) as string;
    await pool.query("update public.sales_settings set recycle_enabled = false");
    await pool.query("update public.sales_reps set status = 'suspended' where id = $1", [rep]);
    expect(await run(0)).toMatchObject({ skipped: "paused" });
    await pool.query("update public.sales_settings set recycle_enabled = true");
    expect(await run(0)).toMatchObject({ recycled: 1, warned: 0 });
    expect(await val("select reason from public.sales_lead_recycles where lead_id = $1", [lead])).toBe("owner_inactive");
    expect(await ownerOf(lead)).not.toBe(rep);
  });

  it("lets admins extend, recycle now and change settings; reps can't", async () => {
    const { added_ids: [lead, other] } = await importRows([row(), row()]);
    await run(6.5);
    expect(await val("select warned_for is not null from public.sales_lead_assignments where lead_id = $1 and ended_at is null", [lead])).toBe(true);
    expect(await val("select public.admin_sales_recycle_extend($1, $2, 10, 'Owner on a long job')", [owner, [lead]])).toBe(1);
    expect(await q1("select warned_for from public.sales_lead_assignments where lead_id = $1 and ended_at is null", [lead])).toMatchObject({ warned_for: null });
    expect(await run(7.6)).toMatchObject({ recycled: 1 }); // only `other`
    expect(await val("select count(*)::int from public.sales_lead_recycles where lead_id = $1", [lead])).toBe(0);
    const before = await ownerOf(other);
    const r = await q1("select public.admin_sales_recycle_now($1, $2, 'Customer asked for someone else') r", [owner, [other]]);
    expect(r.r).toMatchObject({ recycled: 1, reassigned: 1 });
    expect(await ownerOf(other)).not.toBe(before);
    const s = await q1("select public.admin_sales_recycle_settings($1, '{\"days\": 10, \"enabled\": true}'::jsonb) r", [owner]);
    expect(s.r).toMatchObject({ days: 10, grace: 3 });
    await expect(pool.query("select public.admin_sales_recycle_settings($1, '{\"days\": 5}'::jsonb)", [anaU])).rejects.toThrow();
    await expect(pool.query("select public.admin_sales_recycle_settings($1, '{\"days\": 50}'::jsonb)", [owner])).rejects.toThrow();
    await pool.query("update public.sales_settings set recycle_first_contact_days = 7");
    const hist = await q1("select public.admin_sales_recycle_history($1, 30) r", [owner]);
    expect(hist.r.length).toBe(2);
    await expect(asUser(pool, anaU, (q) => q("select public.admin_sales_recycle_now($1, $2, null)", [anaU, [lead]]))).rejects.toThrow();
  });

  it("shows a rep what needs attention and lets them hand a lead back", async () => {
    await pool.query("update public.sales_reps set allocation_paused = true where id in ($1, $2)", [ben, cal]);
    const { added_ids: [a, b] } = await importRows([row(), row()]);
    await pool.query("update public.sales_reps set allocation_paused = false where id in ($1, $2)", [ben, cal]);
    await pool.query("insert into public.sales_tasks (lead_id, rep_id, title, due_at) values ($1, $2, 'Old follow-up', now() - interval '3 days')", [b, ana]);
    await act(b, "reply", null);
    const att = (await asUser(pool, anaU, (q) => q("select public.sales_my_attention() r"))).rows[0].r;
    // b had a reply, which counts as working it.
    expect(att.new.map((x: { id: string }) => x.id)).toEqual([a]);
    expect(att.overdue.map((x: { lead_id: string }) => x.lead_id)).toEqual([b]);
    expect(att.replies.map((x: { id: string }) => x.id)).toEqual([b]);
    expect(att.settings).toMatchObject({ days: 7, grace: 3, warning_hours: 24 });
    const res = (await asUser(pool, anaU, (q) => q("select public.sales_crm_return_lead($1, 'Not a fit for me') r", [a]))).rows[0].r;
    expect(res).toMatchObject({ outcome: "reassigned" });
    expect(await ownerOf(a)).not.toBe(ana);
    expect(await val("select reason from public.sales_lead_recycles where lead_id = $1", [a])).toBe("returned");
    await expect(asUser(pool, anaU, (q) => q("select public.sales_crm_return_lead($1, null)", [a]))).rejects.toThrow(/not_found/);
  });
});
