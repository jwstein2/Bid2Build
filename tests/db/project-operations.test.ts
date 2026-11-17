/**
 * Project Operations V4.3 + Bid Style V4.4, against the real SQL:
 *   - Needs Review queue: manual Won and e-signature enqueue once; reviewing needs the permission
 *   - Task review notices: end date + 100% make ONE notice, moving the finish supersedes it, confirming
 *     completes the task (with permission) and nothing is ever auto-completed
 *   - Publishing a schedule moves the bid to Scheduled; drafts don't; In Progress is never moved back
 *   - Live company schedules need "Edit live schedules"; signed proposal versions are write-once
 *   - Change orders: separate numbered documents, frozen versions, manual approval needs a note,
 *     signatures are write-once, only approved/signed ones change the approved contract value
 *   - Scope workspace + shares; subcontractor quotes start on a line item, revisions are kept and
 *     applying a cost never double counts or touches prices
 *   - Photos are registered by the server only; proposal style policy permissions
 */
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createUser, dbAvailable, freshDb } from "./harness";
import { OWNER_ONLY_PERMISSIONS, PERMISSION_KEYS, ROLE_PERMISSIONS } from "@/lib/enterprise/permissions";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;

const h = (s: string) => createHash("sha256").update(s).digest("hex");
const CAL = (tz = "America/Chicago") => ({ workdays: [1, 2, 3, 4, 5], holidays: [], timezone: tz });
type Row = Record<string, unknown>;
const fails = (p: Promise<unknown>) => p.then(() => "ok", (e: Error) => e.message);

d("Project operations V4.3 + proposal style V4.4 (database)", () => {
  let solo: string, owner: string, mgr: string, est: string, viewer: string, company: string, other: string, otherCompany: string;
  const as = <T = Row>(u: string, sql: string, args: unknown[] = []) => asUser(pool, u, (q) => q(sql, args)).then((r) => r.rows[0] as T);
  const sub = (u: string, plan: string, companyId: string | null, seats: number | null) =>
    pool.query(
      `select public.apply_subscription_update(p_user_id => $1::uuid, p_stripe_customer_id => 'cus_' || $1, p_stripe_subscription_id => 'sub_' || $1,
        p_status => 'active', p_plan => $2, p_price_id => 'price_x', p_current_period_end => '2099-01-01'::timestamptz, p_cancel_at_period_end => false,
        p_canceled_at => null, p_ended_at => null, p_event_created => now() - interval '1 minute', p_company_id => $3::uuid, p_seat_quantity => $4)`,
      [u, plan, companyId, seats],
    );
  const setStage = async (id: string, stage: string) => {
    const c = await pool.connect();
    try {
      await c.query("begin"); await c.query("select set_config('app.stage_change', 'on', true)");
      await c.query("update public.estimates set pipeline_stage = $2 where id = $1", [id, stage]); await c.query("commit");
    } finally { c.release(); }
  };

  async function bid(u: string, companyId: string | null, title = "Kitchen") {
    const id = (await pool.query("insert into public.estimates (user_id, company_id, title, customer_name, trades) values ($1, $2, $3, 'Pat', '{framing}') returning id", [u, companyId, title])).rows[0].id as string;
    const g = (await pool.query("insert into public.estimate_groups (estimate_id, user_id, name, description, sort_order) values ($1, $2, 'Framing', 'Frame walls', 0) returning id", [id, u])).rows[0].id as string;
    const i1 = (await pool.query("insert into public.estimate_items (estimate_id, group_id, user_id, name, cost_type, quantity, unit, unit_cost, sort_order) values ($1, $2, $3, 'Framing labor', 'subcontractor', 100, 'sf', 18, 0) returning id", [id, g, u])).rows[0].id as string;
    const v1 = (await pool.query(
      `insert into public.estimate_versions (estimate_id, user_id, version_number, content_hash, snapshot, proposal, total_cost, subtotal, tax, total)
       values ($1, $2, 1, $3, $4, '{}', 1800, 2400, 0, 2400) returning id`, [id, u, h(id + "1"), { estimate: { groups: [{ id: g, name: "Framing" }] } }])).rows[0].id as string;
    return { id, g, i1, v1 };
  }
  async function schedule(u: string, b: { id: string; g: string; i1: string }, start = "2026-11-02", end = "2026-11-05") {
    const p = { name: "Job", calendar: CAL(), startDate: start, deps: [], tasks: [
      { key: "s", kind: "section", sourceGroupId: b.g, name: "Framing", plannedStart: start, plannedEnd: end, durationDays: 4, sortOrder: 0 },
    ] };
    return as<{ id: string }>(u, "select public.schedule_create($1, false, $2) as id", [b.id, p]).then((r) => r.id);
  }
  const rev = async (sid: string) => (await pool.query("select revision from public.project_schedules where id = $1", [sid])).rows[0].revision as number;
  const task = async (sid: string) => (await pool.query("select * from public.schedule_tasks where schedule_id = $1", [sid])).rows[0] as Row;
  const inbox = (u: string) => as<{ n: Row[] }>(u, "select public.my_notifications() as n").then((r) => r.n);
  const save = (u: string, sid: string, t: Row, extra: Row = {}) => as(u, "select public.schedule_save($1, $2, $3) as r", [sid, t.__rev, {
    summary: "edit", tasks: [{ id: t.id, name: t.name, sortOrder: t.sort_order, plannedStart: t.planned_start, plannedEnd: t.planned_end, durationDays: t.duration_days,
      actualStart: t.actual_start, actualFinish: t.actual_finish, percentComplete: t.percent_complete, status: t.status, weight: null, assignee: null, notes: null, ...extra }] }]);
  const ymd = (d: Date | string) => (typeof d === "string" ? d : d.toISOString().slice(0, 10));

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_project_ops"));
    solo = await createUser(pool, "solo@test.dev");
    owner = await createUser(pool, "owner@acme.dev");
    mgr = await createUser(pool, "mgr@acme.dev");
    est = await createUser(pool, "est@acme.dev");
    viewer = await createUser(pool, "viewer@acme.dev");
    other = await createUser(pool, "boss@other.dev");
    company = (await pool.query("select public.create_company($1, 'Acme') as id", [owner])).rows[0].id;
    otherCompany = (await pool.query("select public.create_company($1, 'Other') as id", [other])).rows[0].id;
    await pool.query("insert into public.company_members (company_id, user_id, role, display_name) values ($1, $2, 'manager', 'Mo'), ($1, $3, 'estimator', 'Erin'), ($1, $4, 'viewer', 'Val')", [company, mgr, est, viewer]);
    await sub(solo, "monthly", null, null);
    await pool.query("select public.apply_pm_update('sub_' || $1, true, 0, now())", [solo]);
    await sub(owner, "enterprise", company, 6);
    await sub(other, "enterprise", otherCompany, 3);
    await pool.query("select public.apply_pm_update('sub_' || $1, false, 3, now())", [owner]);
    for (const u of [owner, mgr, est]) await as(owner, "select public.company_pm_assign($1, true)", [u]);
    // One crew team: the manager and viewer see the estimator's bids through it.
    const team = (await as<{ id: string }>(owner, "select public.create_company_team('Crew A') as id")).id;
    for (const [u, m] of [[est, false], [mgr, true], [viewer, false]] as const) await as(owner, "select public.set_company_team_member($1, $2, $3)", [team, u, m]);
  });
  afterAll(async () => { await drop?.(); });

  it("permission keys and role defaults match the TypeScript mirror", async () => {
    const keys = (await pool.query("select public.company_permission_keys() as k")).rows[0].k;
    expect(keys).toEqual([...PERMISSION_KEYS]);
    for (const role of Object.keys(ROLE_PERMISSIONS) as (keyof typeof ROLE_PERMISSIONS)[]) {
      expect((await pool.query("select public.company_role_permissions($1) as p", [role])).rows[0].p, role).toEqual([...ROLE_PERMISSIONS[role]]);
    }
    expect((await pool.query("select public.company_owner_only_permissions() as p")).rows[0].p).toEqual([...OWNER_ONLY_PERMISSIONS]);
    // A manager can't grant themselves the owner-only proposal policy permission.
    expect(await fails(as(mgr, "select public.update_company_member($1, 'manager', $2)", [mgr, ["change_proposal_policy"]]))).not.toBe("ok");
  });

  it("approved and signed bids enter Needs Review once; reviewing needs the permission", async () => {
    const b = await bid(est, company);
    await as(est, "select public.set_estimate_stage($1, 'won')", [b.id]);
    let q = await as<{ q: Row[] }>(mgr, "select public.project_review_queue() as q");
    const row = q.q.find((x) => x.estimateId === b.id)!;
    expect(row).toMatchObject({ status: "needs_review", approvalSource: "manual", canReview: true });
    expect(await fails(as(viewer, "select public.project_mark_reviewed($1)", [b.id]))).toMatch(/forbidden/);
    const r = await as<{ r: Row }>(mgr, "select public.project_mark_reviewed($1, 'Checked scope') as r", [b.id]);
    expect(r.r.status).toBe("reviewed");
    const db = (await pool.query("select * from public.project_reviews where estimate_id = $1", [b.id])).rows[0];
    expect(db.reviewed_by).toBe(mgr);
    expect(db.reviewed_at).not.toBeNull();
    // Still listed (Ready to Schedule) until a live schedule exists; never auto-scheduled.
    q = await as<{ q: Row[] }>(mgr, "select public.project_review_queue() as q");
    expect(q.q.find((x) => x.estimateId === b.id)?.status).toBe("reviewed");
    expect((await pool.query("select count(*)::int n from public.project_schedules where estimate_id = $1", [b.id])).rows[0].n).toBe(0);

    // A signature enqueues too (and upgrades the source), without a duplicate row.
    const s = await bid(solo, null);
    const exp = new Date(Date.now() + 86400000 * 5).toISOString();
    await pool.query("select * from public.create_signing_request($1, $2, $3, $4, $5, $6)", [solo, s.id, s.v1, h("tok"), h("d"), exp]);
    await pool.query(`select * from public.accept_signing_request($1, 'Pat Lee', 'pat@x.dev', 'typed', 'Pat Lee', null, 'v1', 'c', 'a', now(), null, null)`, [h("tok")]);
    const rows = (await pool.query("select * from public.project_reviews where estimate_id = $1", [s.id])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].approval_source).toBe("signature");
    // Another company never sees the queue entry.
    const oq = await as<{ q: Row[] }>(other, "select public.project_review_queue() as q");
    expect(oq.q.some((x) => x.estimateId === b.id)).toBe(false);
  });

  it("publishing a schedule moves the bid to In Progress, effective on its start date; a draft doesn't", async () => {
    const b = await bid(solo, null);
    await as(solo, "select public.set_estimate_stage($1, 'won')", [b.id]);
    const sid = await schedule(solo, b);
    expect((await pool.query("select pipeline_stage from public.estimates where id = $1", [b.id])).rows[0].pipeline_stage).toBe("won");
    await as(solo, "select public.schedule_save($1, $2, $3)", [sid, await rev(sid), { summary: "Publish", schedule: { status: "active" } }]);
    expect((await pool.query("select pipeline_stage from public.estimates where id = $1", [b.id])).rows[0].pipeline_stage).toBe("in_progress");
    const hist = (await pool.query("select h.to_stage, h.note, h.effective_at::date = s.start_date as on_start from public.estimate_stage_history h join public.project_schedules s on s.id = $2 where h.estimate_id = $1 order by h.created_at desc limit 1", [b.id, sid])).rows[0];
    expect(hist).toMatchObject({ to_stage: "in_progress", note: "Schedule published", on_start: true });
    // The queue no longer lists it.
    const q = await as<{ q: Row[] }>(solo, "select public.project_review_queue() as q");
    expect(q.q.some((x) => x.estimateId === b.id)).toBe(false);

    // In Progress is never moved back by publishing.
    const b2 = await bid(solo, null, "Bath");
    await setStage(b2.id, "in_progress");
    const s2 = await schedule(solo, b2);
    await as(solo, "select public.schedule_save($1, $2, $3)", [s2, await rev(s2), { summary: "Publish", schedule: { status: "active" } }]);
    expect((await pool.query("select pipeline_stage from public.estimates where id = $1", [b2.id])).rows[0].pipeline_stage).toBe("in_progress");
  });

  it("task review notices: one per task and finish date, superseded when moved, never auto-complete", async () => {
    const b = await bid(solo, null, "Deck");
    await as(solo, "select public.set_estimate_stage($1, 'won')", [b.id]);
    const sid = await schedule(solo, b, "2026-11-02", "2026-11-05"); // finish already passed
    // Draft schedules raise nothing.
    expect((await inbox(solo)).filter((n) => n.scheduleId === sid)).toHaveLength(0);
    await as(solo, "select public.schedule_save($1, $2, $3)", [sid, await rev(sid), { summary: "Publish", schedule: { status: "active" } }]);
    let mine = (await inbox(solo)).filter((n) => n.scheduleId === sid);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ reason: "end_date", canConfirm: true });
    expect((mine[0].data as Row).projectName).toBe("Job");
    // Reaching 100% now does not make a second notice and does not complete the task.
    let t = { ...(await task(sid)), __rev: await rev(sid) };
    await save(solo, sid, t, { percentComplete: 100, status: "in_progress", actualStart: "2026-11-02" });
    mine = (await inbox(solo)).filter((n) => n.scheduleId === sid);
    expect(mine).toHaveLength(1);
    expect(mine[0].reason).toBe("both");
    expect((await task(sid)).status).toBe("in_progress");
    expect((await pool.query("select count(*)::int n from public.user_notifications where task_id = $1", [(t as Row).id])).rows[0].n).toBe(1);
    // Syncing again changes nothing.
    expect((await pool.query("select public.pm_sync_task_reviews(array[$1]::uuid[]) as n", [sid])).rows[0].n).toBe(0);

    // Moving the finish supersedes the old notice; the new finish (still past) gets its own.
    t = { ...(await task(sid)), __rev: await rev(sid) };
    await save(solo, sid, t, { plannedEnd: "2026-11-06", durationDays: 5 });
    const all = (await pool.query("select status, resolution, dedupe_key from public.user_notifications where task_id = $1 order by created_at", [(t as Row).id])).rows;
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({ status: "superseded", resolution: "moved" });
    expect(all[1].status).toBe("open");

    // Review later snoozes it out of the inbox.
    const open = (await inbox(solo)).find((n) => n.scheduleId === sid)!;
    await as(solo, "select public.notification_act($1, 'later')", [open.id]);
    expect((await inbox(solo)).some((n) => n.id === open.id)).toBe(false);
    // Confirm complete records completion and resolves it.
    await as(solo, "select public.notification_act($1, 'confirm')", [open.id]);
    const done = await task(sid);
    expect(done).toMatchObject({ status: "complete", percent_complete: 100 });
    expect(done.actual_finish).not.toBeNull();
    expect((await pool.query("select status, resolution from public.user_notifications where id = $1", [open.id])).rows[0]).toMatchObject({ status: "resolved", resolution: "confirmed" });
    // Nobody else can act on someone's notice.
    expect(await fails(as(owner, "select public.notification_act($1, 'read')", [open.id]))).toMatch(/not_found/);
  });

  it("a future finish raises nothing; the PM gets the notice; confirming needs the permission", async () => {
    const b = await bid(est, company, "Roof");
    await as(est, "select public.set_estimate_stage($1, 'won')", [b.id]);
    const today = new Date();
    const later = new Date(today.getTime() + 20 * 86400000);
    const sid = await schedule(est, b, ymd(today), ymd(later));
    await as(est, "select public.schedule_set_people($1, $2, $3)", [sid, est, mgr]);
    await as(est, "select public.schedule_save($1, $2, $3)", [sid, await rev(sid), { summary: "Publish", schedule: { status: "active" } }]);
    expect((await inbox(mgr)).filter((n) => n.scheduleId === sid)).toHaveLength(0);
    // 100% before the finish: review notice for the PM, not the estimator.
    const t = { ...(await task(sid)), __rev: await rev(sid) };
    await save(est, sid, t, { percentComplete: 100, status: "in_progress", actualStart: ymd(today) });
    const n = (await inbox(mgr)).filter((x) => x.scheduleId === sid);
    expect(n).toHaveLength(1);
    expect(n[0].reason).toBe("progress_100");
    expect((await inbox(est)).filter((x) => x.scheduleId === sid)).toHaveLength(0);
    // Without "Confirm task completion" the PM can't confirm (and can't set Complete through a save).
    await pool.query("update public.company_members set permissions_revoked = '{confirm_task_completion}' where user_id = $1", [mgr]);
    expect(await fails(as(mgr, "select public.notification_act($1, 'confirm')", [n[0].id]))).toMatch(/forbidden_confirm/);
    const t2 = { ...(await task(sid)), __rev: await rev(sid) };
    expect(await fails(save(mgr, sid, t2, { status: "complete", percentComplete: 100, actualStart: ymd(today), actualFinish: ymd(today) }))).toMatch(/forbidden_confirm/);
    await pool.query("update public.company_members set permissions_revoked = '{}' where user_id = $1", [mgr]);
  });

  it("live company schedules need Edit live schedules to change dates", async () => {
    const b = await bid(est, company, "Siding");
    await as(est, "select public.set_estimate_stage($1, 'won')", [b.id]);
    const sid = await schedule(est, b, "2027-01-04", "2027-01-07");
    let t = { ...(await task(sid)), __rev: await rev(sid) };
    await pool.query("update public.company_members set permissions_revoked = '{edit_live_schedules}' where user_id = $1", [est]);
    // Draft: fine.
    await save(est, sid, t, { plannedEnd: "2027-01-08", durationDays: 5 });
    await as(est, "select public.schedule_save($1, $2, $3)", [sid, await rev(sid), { summary: "Publish", schedule: { status: "active" } }]);
    t = { ...(await task(sid)), __rev: await rev(sid) };
    expect(await fails(save(est, sid, t, { plannedEnd: "2027-01-11", durationDays: 6 }))).toMatch(/forbidden_live_edit/);
    expect((await task(sid)).planned_end).toEqual(new Date("2027-01-08T00:00:00"));
    await pool.query("update public.company_members set permissions_revoked = '{}' where user_id = $1", [est]);
    await save(est, sid, t, { plannedEnd: "2027-01-11", durationDays: 6 });
  });

  it("proposal versions are write-once", async () => {
    const b = await bid(solo, null, "Patio");
    expect(await fails(pool.query("update public.estimate_versions set total = 1 where id = $1", [b.v1]))).toMatch(/version_immutable/);
    // The owner id may still move (account deletion hand-off).
    await pool.query("update public.estimate_versions set user_id = user_id where id = $1", [b.v1]);
  });

  it("change orders are separate documents; only approved/signed ones change the contract value", async () => {
    const b = await bid(solo, null, "Addition");
    expect(await fails(as(solo, "select public.change_order_save($1, $2)", [b.id, { title: "Early", lines: [{ kind: "add", description: "x", amount: 1 }] }]))).toMatch(/not_accepted/);
    await as(solo, "select public.set_estimate_stage($1, 'won')", [b.id]);
    const co1 = (await as<{ id: string }>(solo, "select public.change_order_save($1, $2) as id", [b.id, { title: "Add outlet", lines: [{ kind: "add", description: "2 outlets", amount: 300 }], internalNotes: "Cost 120" }])).id;
    const co2 = (await as<{ id: string }>(solo, "select public.change_order_save($1, $2) as id", [b.id, { title: "Skip trim", lines: [{ kind: "remove", description: "Trim", amount: -150.5 }] }])).id;
    const co3 = (await as<{ id: string }>(solo, "select public.change_order_save($1, $2) as id", [b.id, { title: "Pending", lines: [{ kind: "modify", description: "Upgrade tile", amount: 900 }] }])).id;
    const nums = (await pool.query("select number, amount from public.change_orders where estimate_id = $1 order by number", [b.id])).rows;
    expect(nums.map((r) => [r.number, Number(r.amount)])).toEqual([[1, 300], [2, -150.5], [3, 900]]);
    // Send freezes v1 (no internal notes); edits are refused once sent.
    const sent = await as<{ r: Row }>(solo, "select public.change_order_send($1, $2) as r", [co1, h("co1")]);
    expect((sent.r.content as Row).internalNotes).toBeUndefined();
    // The hash is computed by the database from the frozen content (a caller-supplied hash is ignored).
    const v1 = (await pool.query("select content::text c, content_hash from public.change_order_versions where change_order_id = $1", [co1])).rows[0];
    expect(v1.content_hash).toBe(h(v1.c));
    expect(v1.content_hash).not.toBe(h("co1"));
    // Internal notes are never readable straight from the table, even by the bid's author.
    expect(await fails(asUser(pool, solo, (q) => q("select internal_notes from public.change_orders where id = $1", [co1])))).toMatch(/permission denied/);
    expect((await asUser(pool, solo, (q) => q("select id, title from public.change_orders where id = $1", [co1]))).rows).toHaveLength(1);
    expect(await fails(as(solo, "select public.change_order_save($1, $2)", [b.id, { id: co1, title: "x", lines: [{ kind: "add", description: "y", amount: 1 }] }]))).toMatch(/not_draft/);
    expect(await fails(as(solo, "select public.change_order_decide($1, 'approve')", [co1]))).toMatch(/note_required/);
    await as(solo, "select public.change_order_decide($1, 'approve', 'Approved by phone 11/16')", [co1]);
    // Signature path on co2.
    await as(solo, "select public.change_order_send($1, $2)", [co2, h("co2")]);
    const exp = new Date(Date.now() + 86400000).toISOString();
    await pool.query("select public.change_order_create_signing($1, $2, $3, $4)", [co2, solo, h("cotok"), exp]);
    await pool.query("select public.change_order_accept_signing($1, 'Pat Lee', 'pat@x.dev', 'Pat Lee', 'v1', 'c', 'a', null, null)", [h("cotok")]);
    expect(await fails(pool.query("select public.change_order_accept_signing($1, 'Pat Lee', 'pat@x.dev', 'Pat Lee', 'v1', 'c', 'a', null, null)", [h("cotok")]))).toMatch(/link_invalid/);
    expect(await fails(pool.query("update public.change_order_signatures set signer_name = 'X' where change_order_id = $1", [co2]))).toMatch(/record_immutable/);
    expect(await fails(pool.query("update public.change_order_versions set content = '{}' where change_order_id = $1", [co1]))).toMatch(/record_immutable/);
    await as(solo, "select public.change_order_send($1, $2)", [co3, h("co3")]);

    const hist = await as<{ h: Row }>(solo, "select public.project_proposal_history($1) as h", [b.id]);
    const cos = hist.h.changeOrders as Row[];
    expect(cos.map((c) => c.status)).toEqual(["approved", "signed", "sent"]);
    expect((hist.h.approval as Row).source).toBe("manual");
    expect(Number((hist.h.approval as Row).total)).toBe(2400);
    // Original contract unchanged in the versions; approved changes = +300 − 150.50; pending 900 kept apart.
    const approved = cos.filter((c) => c.status === "approved" || c.status === "signed").reduce((s, c) => s + Number(c.amount), 0);
    expect(approved).toBeCloseTo(149.5);
    expect((await pool.query("select total from public.estimate_versions where id = $1", [b.v1])).rows[0].total).toBe("2400.00");
    // Revising a sent order reopens it as a draft and revokes nothing signed.
    await as(solo, "select public.change_order_decide($1, 'revise')", [co3]);
    expect((await pool.query("select status, version from public.change_orders where id = $1", [co3])).rows[0]).toMatchObject({ status: "draft", version: 1 });
    // A viewer in another company can't read them.
    expect((await asUser(pool, other, (q) => q("select id, title from public.change_orders where estimate_id = $1", [b.id]))).rows).toHaveLength(0);
  });

  it("scope workspace: created from the approved scope, revisioned, shared with chosen fields only", async () => {
    const b = await bid(est, company, "Electrical");
    await as(est, "select public.set_estimate_stage($1, 'won')", [b.id]);
    const n = await as<{ n: number }>(est, "select public.project_scope_init($1, $2, $3) as n", [b.id, b.v1, JSON.stringify([{ sourceGroupId: b.g, trade: "electrical", title: "Framing", sortOrder: 0, approvedScope: "Frame walls" }])]);
    expect(n.n).toBe(1);
    expect((await as<{ n: number }>(est, "select public.project_scope_init($1, $2, $3) as n", [b.id, b.v1, JSON.stringify([{ sourceGroupId: b.g, title: "Again" }])])).n).toBe(0);
    expect(await fails(as(est, "select public.project_scope_init($1, null, $2)", [b.id, JSON.stringify([{ sourceGroupId: "00000000-0000-0000-0000-000000000001", title: "x" }])]))).toMatch(/unknown_source/);
    const sec = (await pool.query("select * from public.project_scope_sections where estimate_id = $1", [b.id])).rows[0];
    const res = (await as<{ id: string }>(est, "select public.pm_resource_save($1) as id", [{ kind: "subcontractor", name: "Sparks LLC" }])).id;
    const r2 = await as<{ r: number }>(est, "select public.project_scope_save($1, 1, $2) as r", [sec.id, { title: "Electrical rough-in", technicalInstructions: "Panel on north wall", internalNotes: "Margin is thin", resourceId: res }]);
    expect(r2.r).toBe(2);
    expect(await fails(as(est, "select public.project_scope_save($1, 1, $2)", [sec.id, { title: "stale" }]))).toMatch(/stale_revision/);
    expect((await pool.query("select count(*)::int n from public.project_scope_revisions where section_id = $1", [sec.id])).rows[0].n).toBe(2);
    // The estimate itself is untouched.
    expect((await pool.query("select name, description from public.estimate_groups where id = $1", [b.g])).rows[0]).toMatchObject({ name: "Framing", description: "Frame walls" });
    // Viewers read but can't edit; another company's directory entry is refused.
    expect((await asUser(pool, viewer, (q) => q("select id from public.project_scope_sections where id = $1", [sec.id]))).rows).toHaveLength(1);
    expect(await fails(as(viewer, "select public.project_scope_save($1, 2, $2)", [sec.id, { title: "x" }]))).toMatch(/forbidden/);
    const foreign = (await as<{ id: string }>(other, "select public.pm_resource_save($1) as id", [{ kind: "subcontractor", name: "Foreign" }])).id;
    expect(await fails(as(est, "select public.project_scope_save($1, 2, $2)", [sec.id, { title: "x", resourceId: foreign }]))).toMatch(/bad_resource/);
    // Sharing needs the permission (estimators don't have it by default); managers do.
    const content = { title: "Electrical rough-in", fields: { technicalInstructions: "Panel on north wall" } };
    expect(await fails(as(est, "select public.scope_share_publish($1, null, $2, $3, $4, '{}')", [sec.id, res, h("share1"), content]))).toMatch(/forbidden/);
    const sh = await as<{ s: Row }>(mgr, "select public.scope_share_publish($1, null, $2, $3, $4, '{}') as s", [sec.id, res, h("share1"), content]);
    const read = (await pool.query("select public.scope_share_read($1) as r", [h("share1")])).rows[0].r;
    expect(read.content.fields).toEqual({ technicalInstructions: "Panel on north wall" });
    expect(JSON.stringify(read)).not.toContain("Margin is thin");
    await as(mgr, "select public.scope_share_publish($1, $2, null, null, $3, '{}')", [sec.id, (sh.s as Row).shareId, { ...content, fields: { technicalInstructions: "Panel moved" } }]);
    expect((await pool.query("select public.scope_share_read($1) as r", [h("share1")])).rows[0].r.version).toBe(2);
    await as(mgr, "select public.scope_share_revoke($1)", [(sh.s as Row).shareId]);
    expect((await pool.query("select public.scope_share_read($1) as r", [h("share1")])).rows[0].r).toBeNull();
    // anon / authenticated can't read the token table.
    expect(await fails(as(est, "select * from public.scope_shares"))).toMatch(/permission denied/);
  });

  it("subcontractor quotes start on a line item; revisions are kept; applying never double counts", async () => {
    const b = await bid(est, company, "Framing job");
    const q1 = await as<{ r: Row }>(est, "select public.sub_quote_record($1, $2) as r", [b.id, { itemId: b.i1, vendorName: "Frame Bros", amount: 1700, quoteDate: "2026-11-10", internalNotes: "Best price" }]);
    const quoteId = q1.r.quoteId as string;
    const q2 = await as<{ r: Row }>(est, "select public.sub_quote_record($1, $2) as r", [b.id, { quoteId, amount: 2100, note: "Lumber up" }]);
    expect(q2.r.revision).toBe(2);
    const data = await as<{ d: Row }>(est, "select public.sub_quotes_for_estimate($1) as d", [b.id]);
    const quote = (data.d.quotes as Row[])[0];
    expect(Number(quote.estimatedCost)).toBe(1800);
    expect((quote.revisions as Row[]).map((r) => Number(r.amount))).toEqual([1700, 2100]);
    expect(quote.appliedRevisionId).toBeNull();
    expect(data.d.adjustments).toEqual([]);
    // Recording never changes the estimate or any price.
    expect((await pool.query("select unit_cost from public.estimate_items where id = $1", [b.i1])).rows[0].unit_cost).toBe("18.0000");
    // Estimators can record on their own bid but can't apply to the internal forecast.
    expect(await fails(as(est, "select public.sub_quote_apply_cost($1, $2)", [quoteId, q2.r.revisionId]))).toMatch(/forbidden/);
    const a1 = await as<{ r: Row }>(mgr, "select public.sub_quote_apply_cost($1, $2) as r", [quoteId, q2.r.revisionId]);
    expect(Number(a1.r.delta)).toBe(300);
    const again = await as<{ r: Row }>(mgr, "select public.sub_quote_apply_cost($1, $2) as r", [quoteId, q2.r.revisionId]);
    expect(again.r.unchanged).toBe(true);
    // Going back to revision 1 is a −400 adjustment (forecast 1700), never cumulative.
    const a2 = await as<{ r: Row }>(mgr, "select public.sub_quote_apply_cost($1, $2) as r", [quoteId, q1.r.revisionId]);
    expect(Number(a2.r.delta)).toBe(-400);
    const adj = (await pool.query("select amount, forecast_cost from public.project_cost_adjustments where quote_id = $1 order by created_at, id", [quoteId])).rows;
    expect(adj.map((r) => Number(r.forecast_cost))).toEqual([2100, 1700]);
    expect(await fails(pool.query("update public.subcontractor_quote_revisions set amount = 1 where quote_id = $1", [quoteId]))).toMatch(/record_immutable/);
    // Viewers and other companies can't see sub costs.
    expect((await asUser(pool, viewer, (q) => q("select * from public.subcontractor_quotes where estimate_id = $1", [b.id]))).rows).toHaveLength(0);
    expect((await asUser(pool, other, (q) => q("select * from public.subcontractor_quotes where estimate_id = $1", [b.id]))).rows).toHaveLength(0);
    const rep = await as<{ r: Row[] }>(mgr, "select public.sub_quote_report() as r");
    expect(rep.r.find((x) => x.estimateId === b.id)).toMatchObject({ vendorName: "Frame Bros" });
    expect(Number(rep.r.find((x) => x.estimateId === b.id)!.applied)).toBe(1700);
    // Documents must live in the bid's company folder.
    expect(await fails(as(est, "select public.sub_quote_record($1, $2)", [b.id, { quoteId, amount: 5, documentPath: `${otherCompany}/x.pdf` }]))).toMatch(/bad_document/);
  });

  it("photos: registered by the server only, readable by the bid's team, edits need Upload photos", async () => {
    const b = await bid(est, company, "Photo job");
    expect(await fails(as(est, "select public.photo_register($1, $2)", [est, { estimateId: b.id, storagePath: `${company}/p.jpg`, contentType: "image/jpeg", bytes: 10 }]))).toMatch(/permission denied/);
    expect(await fails(pool.query("select public.photo_register($1, $2)", [est, { estimateId: b.id, storagePath: `${otherCompany}/p.jpg`, contentType: "image/jpeg", bytes: 10 }]))).toMatch(/bad_path/);
    const id = (await pool.query("select public.photo_register($1, $2) as id", [est, { estimateId: b.id, storagePath: `${company}/p1.jpg`, contentType: "image/jpeg", bytes: 10, caption: "Panel" }])).rows[0].id;
    await pool.query("select public.photo_set_suggestions($1, '{electrical,before}', 'claude-haiku-5-5')", [id]);
    let ph = (await asUser(pool, viewer, (q) => q("select * from public.project_photos where id = $1", [id]))).rows[0];
    expect(ph).toMatchObject({ ai_status: "suggested", labels: [] });
    expect(await fails(as(viewer, "select public.photo_update($1, $2)", [id, { labels: ["electrical"] }]))).toMatch(/forbidden/);
    await as(est, "select public.photo_update($1, $2)", [id, { labels: ["electrical", "Before"] }]);
    ph = (await pool.query("select * from public.project_photos where id = $1", [id])).rows[0];
    expect(ph).toMatchObject({ ai_status: "reviewed" });
    expect([...ph.labels].sort()).toEqual(["before", "electrical"]);
    expect((await asUser(pool, other, (q) => q("select * from public.project_photos where id = $1", [id]))).rows).toHaveLength(0);
  });

  it("proposal style: owner controls policy, delegated template managers can't change it, history is kept", async () => {
    // Companies created after the migration start with the toggle off.
    expect((await pool.query("select allow_member_customization from public.company_proposal_styles where company_id = $1", [company])).rows[0].allow_member_customization).toBe(false);
    const style = { template: "modern", primaryColor: "#112233" };
    const r1 = await as<{ r: number }>(owner, "select public.company_proposal_style_save(1, $1, '{template}', false) as r", [style]);
    expect(r1.r).toBe(2);
    // A manager without the template permission can't change the style.
    expect(await fails(as(mgr, "select public.company_proposal_style_save(2, $1, '{template}', false)", [{ template: "classic" }]))).toMatch(/forbidden_template/);
    await pool.query("update public.company_members set permissions_granted = '{manage_proposal_templates}' where user_id = $1", [mgr]);
    await as(mgr, "select public.company_proposal_style_save(2, $1, '{template}', false)", [{ template: "classic", primaryColor: "#112233" }]);
    // ...but can't flip the toggle or unlock elements.
    expect(await fails(as(mgr, "select public.company_proposal_style_save(3, $1, '{}', true)", [{ template: "classic", primaryColor: "#112233" }]))).toMatch(/forbidden_policy/);
    expect(await fails(as(owner, "select public.company_proposal_style_save(3, $1, '{nonsense}', false)", [style]))).toMatch(/bad_key/);
    const b = await bid(est, company, "Styled");
    const pol = await as<{ p: Row }>(est, "select public.proposal_style_policy($1) as p", [b.id]);
    expect(pol.p).toMatchObject({ managed: true, allowCustomization: false, canCustomize: false, canOverride: false });
    expect((pol.p.style as Row).template).toBe("classic");
    await as(owner, "select public.company_proposal_style_save(3, $1, '{template}', true)", [{ template: "classic", primaryColor: "#112233" }]);
    expect((await as<{ p: Row }>(est, "select public.proposal_style_policy($1) as p", [b.id])).p.canCustomize).toBe(true);
    expect((await pool.query("select count(*)::int n from public.company_proposal_style_history where company_id = $1", [company])).rows[0].n).toBe(3);
    expect((await pool.query("select count(*)::int n from public.company_audit_log where company_id = $1 and action = 'proposal_style.saved'", [company])).rows[0].n).toBe(3);
    // Reset clears only presentation keys on the bid.
    await pool.query("update public.estimates set proposal_config = $2 where id = $1", [b.id, { template: "premium", show: { quantities: false }, introduction: "Hi" }]);
    await as(owner, "select public.proposal_style_reset($1)", [b.id]);
    const cfg = (await pool.query("select proposal_config from public.estimates where id = $1", [b.id])).rows[0].proposal_config;
    expect(cfg.template).toBeUndefined();
    expect(cfg.show).toBeUndefined();
    expect(cfg.introduction).toBe("Hi");
    // Another company's policy never applies (and isn't readable).
    expect((await as<{ p: Row | null }>(other, "select public.proposal_style_policy($1) as p", [b.id])).p).toBeNull();
    expect(await fails(as(other, "select public.proposal_style_reset($1)", [b.id]))).toMatch(/forbidden/);
  });

  it("rollbacks remove everything and the migrations re-apply", async () => {
    const { readFileSync } = await import("node:fs");
    // The Financial Command Center points at change orders / quotes / the directory: roll it back first (newest first).
    await pool.query(readFileSync("docs/project-operations/rollback_20261129001000.sql", "utf8")); // newest first
    for (const f of ["20261128001000", "20261126001000", "20261125001000", "20261124004000", "20261124003000", "20261124002000", "20261124001000"]) await pool.query(readFileSync(`docs/financials/rollback_${f}.sql`, "utf8"));
    for (const f of ["20261119004000", "20261119003000", "20261119002000", "20261119001000"]) await pool.query(readFileSync(`docs/project-operations/rollback_${f}.sql`, "utf8"));
    for (const t of ["project_reviews", "user_notifications", "change_orders", "project_scope_sections", "subcontractor_quotes", "project_photos", "company_proposal_styles"])
      expect((await pool.query("select to_regclass($1) as t", [`public.${t}`])).rows[0].t, t).toBeNull();
    for (const f of ["20261119001000_project_operations", "20261119002000_project_documents", "20261119003000_project_photos", "20261119004000_proposal_style_policy"])
      await pool.query(readFileSync(`supabase/migrations/${f}.sql`, "utf8"));
    expect((await pool.query("select to_regclass('public.company_proposal_styles') as t")).rows[0].t).not.toBeNull();
  });
});
