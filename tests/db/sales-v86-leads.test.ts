import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
  return { company_name: `Test Builders ${seq}`, contact_name: "Pat Owner", email: `owner${seq}@builders${seq}.com`, phone: `612555${String(1000 + seq).slice(-4)}`,
    website: `builders${seq}.com`, city: `Town${seq}`, state: "MN", zip: "55901", trades: ["roofing"], ...over };
};
const importRows = (rows: unknown[], id = `batch-${++seq}`) => q1("select public.sales_import_batch($1, 'test', $2::jsonb, 0) r", [id, JSON.stringify(rows)]).then((x) => x.r);
const owners = async (ids: string[]) => (await pool.query("select r.full_name n, count(*)::int c from public.sales_leads l join public.sales_reps r on r.id = l.assigned_rep where l.id = any ($1) group by 1 order by 1", [ids])).rows as { n: string; c: number }[];

d("sales hub V8.6 allocation, master CRM, invitations and offboarding (database)", () => {
  let owner: string, anaU: string, benU: string, calU: string, deeU: string;
  let ana: string, ben: string, cal: string, dee: string, eve: string;

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_sales_v86"));
    // Supabase's session table, so sign-out can be checked.
    await pool.query("create table if not exists auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid not null)");
    owner = await createUser(pool, "owner@built2bid.org");
    await pool.query("insert into public.admin_roles (user_id, role) values ($1, 'admin')", [owner]);
    const member = async (email: string, name: string, role = "rep") =>
      (await q1("select public.admin_sales_member_save($1, null, $2, $3, null, $4, 'active', null, true) r", [owner, email, name, role])).r.id as string;
    ana = await member("ana@sales.com", "Ana Able");
    ben = await member("ben@sales.com", "Ben Best");
    cal = await member("cal@sales.com", "Cal Cole");
    dee = await member("dee@sales.com", "Dee Admin", "admin");
    eve = await member("eve@sales.com", "Eve Invited");
    anaU = await createUser(pool, "ana@sales.com");
    benU = await createUser(pool, "ben@sales.com");
    calU = await createUser(pool, "cal@sales.com");
    deeU = await createUser(pool, "dee@sales.com");
    for (const u of [anaU, benU, calU, deeU]) await asUser(pool, u, (q) => q("select public.sales_me()"));
  });
  afterAll(async () => { await drop?.(); });

  it("shares new company leads evenly and skips admins, dual-role admins and reps who haven't joined", async () => {
    const r = await importRows([row(), row(), row(), row(), row(), row()]);
    expect(r).toMatchObject({ added: 6, allocated: 6 });
    expect(await owners(r.added_ids)).toEqual([{ n: "Ana Able", c: 2 }, { n: "Ben Best", c: 2 }, { n: "Cal Cole", c: 2 }]);
    const h = await q1("select count(*)::int n, min(algorithm) a, count(distinct batch_id)::int b from public.sales_lead_assignments where lead_id = any ($1)", [r.added_ids]);
    expect(h).toMatchObject({ n: 6, a: "rr-lra-1", b: 1 });
    expect(await val("select count(*)::int from public.sales_rep_notices where kind = 'leads_assigned'")).toBe(3);
    // The next lead goes to whoever has waited longest, not back to the first name on the list.
    const next = await importRows([row()]);
    const first = (await owners(next.added_ids))[0].n;
    expect(first).toBe("Ana Able");
  });

  it("excludes paused, suspended and on-leave reps, holds leads when nobody is eligible, then shares the queue", async () => {
    await pool.query("select public.admin_sales_rep_allocation_save($1, $2, true, 'Training week', 'default', '{}', '{}')", [owner, ben]);
    await pool.query("select public.admin_sales_rep_access($1, $2, 'suspend', 'Missing paperwork', false)", [owner, cal]);
    const r = await importRows([row(), row()]);
    expect(await owners(r.added_ids)).toEqual([{ n: "Ana Able", c: 2 }]);
    await pool.query("insert into public.sales_time_off (rep_id, starts_at, ends_at, customer_message) values ($1, now() - interval '1 hour', now() + interval '2 days', 'Away')", [ana]);
    const held = await importRows([row()]);
    expect(held).toMatchObject({ added: 1, allocated: 0, held: 1 });
    expect(await val("select hold_reason from public.sales_leads where id = $1", [held.added_ids[0]])).toBe("no_eligible_rep");
    // A dual-role admin can opt in.
    await pool.query("select public.admin_sales_rep_allocation_save($1, $2, false, null, 'on', '{}', '{}')", [owner, dee]);
    const q = await q1("select public.admin_sales_allocate_queue($1) r", [owner]);
    expect(q.r).toMatchObject({ allocated: 1, still_waiting: 0 });
    expect(await val("select r.full_name from public.sales_leads l join public.sales_reps r on r.id = l.assigned_rep where l.id = $1", [held.added_ids[0]])).toBe("Dee Admin");
    // Territory: a rep limited to WI never gets an MN lead.
    await pool.query("delete from public.sales_time_off");
    await pool.query("select public.admin_sales_rep_allocation_save($1, $2, false, null, 'default', '{wi}', '{}')", [owner, ben]);
    await pool.query("select public.admin_sales_rep_access($1, $2, 'restore', 'Paperwork in', false)", [owner, cal]);
    await pool.query("select public.admin_sales_rep_allocation_save($1, $2, false, null, 'off', '{}', '{}')", [owner, dee]);
    const mn = await importRows([row(), row(), row(), row()]);
    expect((await owners(mn.added_ids)).map((x) => x.n)).toEqual(["Ana Able", "Cal Cole"]);
    const wi = await importRows([row({ state: "WI" })]);
    expect((await owners(wi.added_ids))[0].n).toBe("Ben Best");
    await pool.query("select public.admin_sales_rep_allocation_save($1, $2, false, null, 'default', '{}', '{}')", [owner, ben]);
  });

  it("keeps the rotation fair when two imports run at once", async () => {
    await pool.query("update public.sales_reps set last_allocated_at = null");
    const before = await pool.query("select assigned_rep, count(*)::int c from public.sales_leads where assigned_rep is not null group by 1");
    const base = new Map(before.rows.map((x) => [x.assigned_rep, x.c]));
    const a = Array.from({ length: 10 }, () => row()), b = Array.from({ length: 11 }, () => row());
    const [ra, rb] = await Promise.all([importRows(a, "par-a"), importRows(b, "par-b")]);
    const ids = [...ra.added_ids, ...rb.added_ids];
    expect(ids).toHaveLength(21);
    const got = (await owners(ids)).map((x) => x.c);
    expect(got.reduce((s, c) => s + c, 0)).toBe(21);
    expect(Math.max(...got) - Math.min(...got)).toBeLessThanOrEqual(1);
    expect(base.size).toBeGreaterThan(0);
  });

  it("detects duplicates by website, email and phone, flags name matches for review, and never starts outreach", async () => {
    const r = await importRows([row({ company_name: "Original Roofing", website: "https://www.origroof.com/about", email: "jo@origroof.com", phone: "(507) 555-0101", city: "Rochester" })]);
    const orig = r.added_ids[0];
    const ownerBefore = await val("select assigned_rep from public.sales_leads where id = $1", [orig]);
    await pool.query("insert into public.sales_activities (lead_id, rep_id, kind, body) values ($1, $2, 'email', 'Intro sent')", [orig, ownerBefore]);
    const dup = await importRows([
      row({ company_name: "Totally Different Name", website: "origroof.com", email: null, phone: null }),
      row({ company_name: "Other", website: null, email: "JO@origroof.com", phone: null }),
      row({ company_name: "Other 2", website: null, email: null, phone: "507-555-0101" }),
      row({ company_name: "Original Roofing LLC", website: null, email: "info@new-domain.com", phone: null, city: "Rochester" }),
      row({ company_name: "FB Only One", website: "https://facebook.com/fbone", email: null, phone: "6125559001" }),
      row({ company_name: "FB Only Two", website: "https://facebook.com/fbtwo", email: null, phone: "6125559002" }),
    ]);
    expect(dup).toMatchObject({ duplicates: 3, possible: 1, added: 2 });
    expect(await val("select assigned_rep from public.sales_leads where id = $1", [orig])).toBe(ownerBefore);
    expect(await val("select count(*)::int from public.sales_activities where lead_id = $1 and kind = 'email'", [orig])).toBe(1);
    expect(await val("select count(*)::int from public.sales_activities where lead_id = $1 and kind = 'system' and body like 'Seen again%'", [orig])).toBe(3);
    // Reviewing the possible duplicate: create it as a separate business; it goes through normal allocation.
    const pending = await q1("select public.admin_sales_possible_dups($1) r", [owner]);
    expect(pending.r).toHaveLength(1);
    expect(pending.r[0].candidates[0].id).toBe(orig);
    const made = await q1("select public.admin_sales_possible_dup_decide($1, $2, 'create', null) r", [owner, pending.r[0].id]);
    expect(await val("select assigned_rep is not null from public.sales_leads where id = $1", [made.r.lead_id])).toBe(true);
    await expect(pool.query("select public.admin_sales_possible_dup_decide($1, $2, 'skip', null)", [owner, pending.r[0].id])).rejects.toThrow(/already_decided/);
    // Re-importing the same batch id is answered from the first run.
    const again = await importRows([row()], "par-a");
    expect(again.replayed).toBe(true);
  });

  it("holds existing customers and suppressed contacts instead of treating them as new leads", async () => {
    await createUser(pool, "boss@paying-co.com");
    await pool.query("insert into public.sales_suppressions (key, reason) values ('e:stop@nope.com', 'opted_out')");
    const r = await importRows([row({ email: "boss@paying-co.com" }), row({ email: "stop@nope.com" })]);
    expect(r).toMatchObject({ existing_customers: 1, suppressed: 1, added: 0 });
    expect(await q1("select hold_reason, lead_origin, assigned_rep from public.sales_leads where email = 'boss@paying-co.com'")).toMatchObject({ hold_reason: "existing_customer", lead_origin: "customer", assigned_rep: null });
  });

  it("warns before reassigning a worked lead, records every change, and moves open follow-ups with the lead", async () => {
    const lead = (await importRows([row()])).added_ids[0];
    const from = await val("select assigned_rep from public.sales_leads where id = $1", [lead]) as string;
    const target = from === ben ? cal : ben;
    await pool.query("insert into public.sales_activities (lead_id, rep_id, kind, body) values ($1, $2, 'email', 'Sent pricing')", [lead, from]);
    await pool.query("insert into public.sales_tasks (lead_id, rep_id, title, due_at) values ($1, $2, 'Call back', now() + interval '1 day')", [lead, from]);
    const w = await q1("select public.admin_sales_leads_assign($1, $2, 'rep', $3, 'Better fit', false) r", [owner, [lead], target]);
    expect(w.r.needs_confirm).toBe(true);
    expect(w.r.warnings[0].warnings).toEqual(expect.arrayContaining(["active_conversation", "open_follow_up"]));
    expect(await val("select assigned_rep from public.sales_leads where id = $1", [lead])).toBe(from);
    const ok = await q1("select public.admin_sales_leads_assign($1, $2, 'rep', $3, 'Better fit', true) r", [owner, [lead], target]);
    expect(ok.r.changed).toBe(1);
    expect(await val("select rep_id from public.sales_tasks where lead_id = $1", [lead])).toBe(target);
    const hist = (await pool.query("select method, rep_id, previous_rep_id, reason, actor_id from public.sales_lead_assignments where lead_id = $1 order by id", [lead])).rows;
    expect(hist.at(-1)).toMatchObject({ method: "manual", rep_id: target, previous_rep_id: from, reason: "Better fit", actor_id: owner });
    expect(hist[0].method).toBe("auto");
    expect(await val("select count(*)::int from public.sales_rep_notices where rep_id = $1 and kind = 'leads_moved'", [from])).toBe(1);
    // Back to the queue, and the owner (no rep profile) can't take it themselves.
    await pool.query("select public.admin_sales_leads_assign($1, $2, 'unassign', null, null, true)", [owner, [lead]]);
    expect(await q1("select assigned_rep, hold_reason from public.sales_leads where id = $1", [lead])).toMatchObject({ assigned_rep: null, hold_reason: "manual" });
    await expect(pool.query("select public.admin_sales_leads_assign($1, $2, 'self', null, null, true)", [owner, [lead]])).rejects.toThrow(/no_rep_profile/);
    await expect(asUser(pool, anaU, (q) => q("select public.admin_sales_leads_assign($1, $2, 'rep', $3, null, true)", [anaU, [lead], ana]))).rejects.toThrow(/permission denied/);
    await expect(pool.query("select public.admin_sales_leads_assign($1, $2, 'rep', $3, null, true)", [anaU, [lead], ana])).rejects.toThrow(/not_authorized/);
  });

  it("logs an admin's contact once, as the admin, on the owner's lead without moving ownership or attribution", async () => {
    const lead = (await importRows([row()])).added_ids[0];
    const ownerRep = await val("select assigned_rep from public.sales_leads where id = $1", [lead]) as string;
    const ownerUser = { [ana]: anaU, [ben]: benU, [cal]: calU }[ownerRep]!;
    const cust = await createUser(pool, "cust@attr.com");
    await pool.query("insert into public.sales_attributions (user_id, rep_id, source) values ($1, $2, 'link')", [cust, ana]).catch(async () => {
      await pool.query("insert into public.sales_attributions (user_id, rep_id) values ($1, $2)", [cust, ana]);
    });
    await pool.query("update public.sales_leads set customer_user_id = $2 where id = $1", [lead, cust]);
    await pool.query("select public.admin_sales_lead_activity_add($1, $2, 'email', 'Owner followed up', 'sent')", [owner, lead]);
    expect(await val("select count(*)::int from public.sales_activities where lead_id = $1 and kind = 'email'", [lead])).toBe(1);
    expect(await q1("select assigned_rep, stage from public.sales_leads where id = $1", [lead])).toMatchObject({ assigned_rep: ownerRep, stage: "contacted" });
    const seen = (await asUser(pool, ownerUser, (q) => q("select public.sales_crm_lead($1) r", [lead]))).rows[0].r;
    expect(seen.activities.some((a: { body: string }) => a.body === "Owner followed up")).toBe(true);
    const detail = await q1("select public.admin_sales_lead_detail($1, $2) r", [owner, lead]);
    expect(detail.r.activities.find((a: { kind: string }) => a.kind === "email")).toMatchObject({ actor: "Owner (admin)", evidence: "manual", disposition: "sent" });
    expect(detail.r.beneficiary.rep_name).toBe("Ana Able");
    expect(await val("select rep_id from public.sales_attributions where user_id = $1", [cust])).toBe(ana);
    // Reps log outcomes; a meaningless disposition is refused.
    await asUser(pool, ownerUser, (q) => q("select public.sales_crm_activity_log($1, 'email', 'Follow-up sent', 'sent')", [lead]));
    await expect(asUser(pool, ownerUser, (q) => q("select public.sales_crm_activity_log($1, 'email', 'x', 'connected')", [lead]))).rejects.toThrow(/invalid_disposition/);
    await asUser(pool, ownerUser, (q) => q("select public.sales_crm_activity_log($1, 'reply', 'They wrote back', null)", [lead]));
    expect(await val("select stage from public.sales_leads where id = $1", [lead])).toBe("engaged");
    // Another rep can't see it.
    const other = ownerRep === ben ? calU : benU;
    await expect(asUser(pool, other, (q) => q("select public.sales_crm_lead($1)", [lead]))).rejects.toThrow(/not_found/);
  });

  it("keeps a rep's own imported leads with them and never moves a company lead to them as a duplicate", async () => {
    const company = (await importRows([row({ website: "keepme.com" })])).added_ids[0];
    const companyOwner = await val("select assigned_rep from public.sales_leads where id = $1", [company]);
    const r = (await asUser(pool, benU, (q) => q("select public.sales_crm_import($1::jsonb, 'my list') r", [JSON.stringify([row({ company_name: "Ben's Friend Co" }), row({ website: "keepme.com" })])]))).rows[0].r;
    expect(r).toMatchObject({ added: 1, duplicates: 1 });
    expect(await q1("select assigned_rep, lead_origin from public.sales_leads where company_name = $1", ["Ben's Friend Co"])).toMatchObject({ assigned_rep: ben, lead_origin: "rep_sourced" });
    expect(await val("select assigned_rep from public.sales_leads where id = $1", [company])).toBe(companyOwner);
  });

  it("resends, guards against double sends, revokes and tracks provider delivery for invitations", async () => {
    const hash = (n: number) => n.toString(16).padStart(64, "0");
    const inv = await q1("select public.admin_sales_invite_create($1, $2, $3, 14) r", [owner, eve, hash(1)]);
    await pool.query("select public.admin_sales_invite_sent($1, $2, true, 'msg-1', null)", [owner, inv.r.id]);
    await expect(pool.query("select public.admin_sales_invite_resend($1, $2, $3)", [owner, eve, hash(2)])).rejects.toThrow(/sent_recently/);
    await pool.query("update public.sales_rep_invites set sent_at = now() - interval '11 minutes'");
    const second = await q1("select public.admin_sales_invite_resend($1, $2, $3) r", [owner, eve, hash(3)]);
    expect(await val("select public.sales_invite_lookup($1) ->> 'status'", [hash(1)])).toBe("revoked");
    expect(await val("select public.sales_invite_lookup($1) ->> 'status'", [hash(3)])).toBe("valid");
    expect(await val("select public.sales_invite_delivery('msg-1', 'delivered')")).toBe(true);
    expect(await val("select delivery_status from public.sales_rep_invites where provider_message_id = 'msg-1'")).toBe("delivered");
    await pool.query("update public.sales_rep_invites set expires_at = now() - interval '1 minute' where id = $1", [second.r.id]);
    expect(await val("select public.sales_invite_lookup($1) ->> 'status'", [hash(3)])).toBe("expired");
    await pool.query("select public.admin_sales_invite_revoke($1, $2)", [owner, eve]);
    const listed = await q1("select public.admin_sales_invites($1) r", [owner]);
    expect(listed.r[eve]).toMatchObject({ email: "eve@sales.com" });
  });

  it("offboards with reasons and reviews, keeps earned pay and history, shares out open leads, then reactivates", async () => {
    await pool.query("insert into auth.sessions (user_id) values ($1), ($1)", [calU]);
    const cust = await createUser(pool, "calcust@co.com");
    await pool.query("insert into public.sales_commissions (rep_id, user_id, year_no, kind, period_month, amount_cents, status) values ($1, $2, 1, 'commission', '2026-11-01', 1999, 'earned')", [cal, cust]);
    const open = (await pool.query("select id from public.sales_leads where assigned_rep = $1 and stage <> 'paying' and customer_user_id is null", [cal])).rows.map((x) => x.id);
    expect(open.length).toBeGreaterThan(0);
    const o = await q1("select public.admin_sales_offboarding_start($1, $2, $3::jsonb) r", [owner, cal, JSON.stringify({ effective_date: "2026-11-30", reason_category: "voluntary", admin_notes: "Moving to a new job. Thanked them.", access_end: "on_completion" })]);
    expect(o.r).toMatchObject({ status: "in_progress", reason_category: "voluntary", admin_notes: "Moving to a new job. Thanked them." });
    // No new leads while offboarding.
    const during = await importRows([row(), row(), row()]);
    expect((await owners(during.added_ids)).map((x) => x.n)).not.toContain("Cal Cole");
    await expect(pool.query("select public.admin_sales_offboarding_complete($1, $2, true)", [owner, o.r.id])).rejects.toThrow(/review_incomplete/);
    await pool.query("select public.admin_sales_offboarding_update($1, $2, $3::jsonb)", [owner, o.r.id, JSON.stringify({ commission_review: "reviewed", reward_review: "reviewed", agreement_status: "on_file", final_payout_review: "scheduled", tax_retention: "retained" })]);
    const done = await q1("select public.admin_sales_offboarding_complete($1, $2, true) r", [owner, o.r.id]);
    expect(done.r.status).toBe("completed");
    expect(await q1("select status, removed_at is not null gone, allocation_paused from public.sales_reps where id = $1", [cal])).toMatchObject({ status: "removed", gone: true, allocation_paused: true });
    expect(await val("select count(*)::int from public.sales_leads where id = any ($1) and assigned_rep = $2", [open, cal])).toBe(0);
    expect(await val("select count(*)::int from public.sales_lead_assignments where previous_rep_id = $1 and method = 'offboarding'", [cal])).toBeGreaterThan(0);
    expect(await q1("select amount_cents, status from public.sales_commissions where user_id = $1", [cust])).toMatchObject({ amount_cents: 1999, status: "earned" });
    expect(await val("select count(*)::int from auth.sessions where user_id = $1", [calU])).toBe(0);
    expect(await val("select public.sales_me() is null or public.sales_me() ->> 'status' = 'removed'")).toBe(true);
    const meCal = (await asUser(pool, calU, (q) => q("select public.sales_me() r"))).rows[0].r;
    expect(meCal).toMatchObject({ status: "removed" });
    // Reactivation: needs the agreement confirmed; same identity, allocation paused, leads not returned.
    await expect(pool.query("select public.admin_sales_rep_reactivate($1, $2, 'Coming back', false)", [owner, cal])).rejects.toThrow(/agreement_required/);
    const back = await q1("select public.admin_sales_rep_reactivate($1, $2, 'Coming back', true) r", [owner, cal]);
    expect(back.r).toMatchObject({ id: cal, status: "active", allocation_paused: true });
    expect(await val("select count(*)::int from public.sales_leads where id = any ($1) and assigned_rep = $2", [open, cal])).toBe(0);
    expect(await val("select count(*)::int from public.sales_commissions where rep_id = $1", [cal])).toBe(1);
    const m = await q1("select public.admin_sales_rep_manage($1, $2) r", [owner, cal]);
    expect(m.r.offboardings[0]).toMatchObject({ status: "completed", reason_category: "voluntary" });
    expect(m.r.history.map((h: { action: string }) => h.action)).toEqual(expect.arrayContaining(["sales.offboarding_completed", "sales.rep_reactivated"]));
    // A Sales Administrator can't offboard another administrator or themselves.
    await expect(pool.query("select public.admin_sales_offboarding_start($1, $2, $3::jsonb)", [deeU, dee, JSON.stringify({ effective_date: "2026-12-01", reason_category: "other" })])).rejects.toThrow(/owner_only|cannot_edit_self/);
  });

  it("filters the master CRM on the server and reports the unassigned queue", async () => {
    const all = await q1("select public.admin_sales_leads($1, '{}'::jsonb, 500, 0) r", [owner]);
    expect(all.r.total).toBeGreaterThan(30);
    const wi = await q1("select public.admin_sales_leads($1, '{\"state\":\"WI\"}'::jsonb) r", [owner]);
    expect(wi.r.leads.every((l: { state: string }) => l.state === "WI")).toBe(true);
    const seen = await q1("select public.admin_sales_leads($1, '{\"dup\":\"seen_again\"}'::jsonb) r", [owner]);
    expect(seen.r.leads.map((l: { company_name: string }) => l.company_name)).toContain("Original Roofing");
    const held = await q1("select public.admin_sales_leads($1, '{\"owner\":\"held\"}'::jsonb) r", [owner]);
    expect(held.r.leads.length).toBeGreaterThan(0);
    expect(Object.keys(all.r.queue)).toEqual(expect.arrayContaining(["existing_customer"]));
    await expect(pool.query("select public.admin_sales_leads($1, '{}'::jsonb)", [anaU])).rejects.toThrow(/not_authorized/);
  });

  it("a rep's typed-in lead is checked against the owner email too (QA F12)", async () => {
    const add = (u: string, lead: Record<string, unknown>) =>
      asUser(pool, u, (q) => q("select public.sales_crm_lead_create($1::jsonb) r", [JSON.stringify(lead)])).then((x) => x.rows[0].r as { ok: boolean; error?: string });
    expect(await add(anaU, { company_name: "Email Key Roofing", email: "boss@emailkey-roof.com", trades: [] })).toMatchObject({ ok: true });
    const dup = await add(benU, { company_name: "Email-Key Roofing Co", email: "Boss@EmailKey-Roof.com", trades: [] });
    expect(dup).toMatchObject({ ok: false, error: "duplicate" });
  });
});
