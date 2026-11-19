/**
 * V4 Phase 9: Enterprise PM permissions and seat reassignment, against the real SQL.
 *   - the permission keys, role defaults and owner-only list match src/lib/enterprise/permissions.ts
 *   - a company admin without a seat can't edit; a seat without the permission can't either
 *   - progress, dependencies and publishing are separate permissions
 *   - revoking "View schedules" hides company schedules
 *   - reassigning a seat keeps the seat count, its rank and the subscription untouched
 *   - non-owners can't hand out the seat / add-on permissions
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createUser, dbAvailable, freshDb } from "./harness";
import { OWNER_ONLY_PERMISSIONS, PERMISSION_KEYS, ROLE_PERMISSIONS } from "@/lib/enterprise/permissions";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;

const CAL = { workdays: [1, 2, 3, 4, 5], holidays: [], timezone: "America/Chicago" };
const fails = (p: Promise<unknown>) => p.then(() => "ok", (e: Error) => e.message);

type Row = Record<string, unknown>;
/** schedule_get task row -> the camelCase task schedule_save takes. */
const taskOf = (t: Row) => ({
  id: t.id, kind: t.kind, sourceGroupId: t.source_group_id, sourceItemId: t.source_item_id, parentId: t.parent_id, splitFrom: t.split_from,
  name: t.name, sortOrder: t.sort_order, plannedStart: t.planned_start, plannedEnd: t.planned_end, durationDays: t.duration_days,
  actualStart: t.actual_start, actualFinish: t.actual_finish, percentComplete: t.percent_complete, status: t.status, weight: t.weight, assignee: t.assignee, notes: t.notes,
});

d("Enterprise PM permissions and seats (database)", () => {
  let owner: string, mgr: string, est: string, est2: string, field: string, viewer: string, company: string;

  const sub = (u: string, companyId: string, seats: number) =>
    pool.query(
      `select public.apply_subscription_update(p_user_id => $1::uuid, p_stripe_customer_id => 'cus_' || $1, p_stripe_subscription_id => 'sub_' || $1,
        p_status => 'active', p_plan => 'enterprise', p_price_id => 'price_x', p_current_period_end => '2099-01-01'::timestamptz, p_cancel_at_period_end => false,
        p_canceled_at => null, p_ended_at => null, p_event_created => now() - interval '1 minute', p_company_id => $2::uuid, p_seat_quantity => $3)`,
      [u, companyId, seats],
    );
  const as = <T = Row>(u: string, sql: string, args: unknown[] = []) => asUser(pool, u, (q) => q(sql, args)).then((r) => r.rows[0] as T);
  const assign = (actor: string, u: string, on = true) => as(actor, "select public.company_pm_assign($1, $2) as r", [u, on]);
  const perms = (u: string, sid: string) => as<{ p: Record<string, boolean> }>(u, "select public.schedule_permissions($1) as p", [sid]).then((r) => r.p);
  const get = (u: string, sid: string) => as<{ s: { schedule: Row; tasks: Row[]; deps: Row[]; permissions: Record<string, boolean> } | null }>(u, "select public.schedule_get($1) as s", [sid]).then((r) => r.s);
  const save = (u: string, sid: string, rev: number, p: object) => as<{ r: number }>(u, "select public.schedule_save($1, $2, $3) as r", [sid, rev, p]).then((r) => r.r);
  const setAccess = (u: string, granted: string[] = [], revoked: string[] = []) =>
    pool.query("update public.company_members set permissions_granted = $2, permissions_revoked = $3 where user_id = $1", [u, granted, revoked]);

  async function schedule(u: string) {
    const id = (await pool.query("insert into public.estimates (user_id, company_id, title, customer_name, trades) values ($1, $2, 'Kitchen', 'Pat', '{framing}') returning id", [u, company])).rows[0].id as string;
    const c = await pool.connect();
    try {
      await c.query("begin"); await c.query("select set_config('app.stage_change', 'on', true)");
      await c.query("update public.estimates set pipeline_stage = 'won' where id = $1", [id]); await c.query("commit");
    } finally { c.release(); }
    const g1 = (await pool.query("insert into public.estimate_groups (estimate_id, user_id, name, sort_order) values ($1, $2, 'Framing', 0) returning id", [id, u])).rows[0].id as string;
    const g2 = (await pool.query("insert into public.estimate_groups (estimate_id, user_id, name, sort_order) values ($1, $2, 'Flooring', 1) returning id", [id, u])).rows[0].id as string;
    const p = { name: "Kitchen", calendar: CAL, startDate: "2026-11-16", deps: [], tasks: [
      { key: "a", kind: "section", sourceGroupId: g1, name: "Framing", plannedStart: "2026-11-16", plannedEnd: "2026-11-19", durationDays: 4, sortOrder: 0 },
      { key: "b", kind: "section", sourceGroupId: g2, name: "Flooring", plannedStart: "2026-11-20", plannedEnd: "2026-11-24", durationDays: 3, sortOrder: 1 },
    ] };
    return as<{ id: string }>(u, "select public.schedule_create($1, false, $2) as id", [id, p]).then((r) => r.id);
  }

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_pm_perms"));
    owner = await createUser(pool, "owner@acme.dev");
    mgr = await createUser(pool, "mgr@acme.dev");
    est = await createUser(pool, "est@acme.dev");
    est2 = await createUser(pool, "est2@acme.dev");
    field = await createUser(pool, "field@acme.dev");
    viewer = await createUser(pool, "viewer@acme.dev");
    company = (await pool.query("select public.create_company($1, 'Acme') as id", [owner])).rows[0].id;
    for (const [u, role] of [[mgr, "manager"], [est, "estimator"], [est2, "estimator"], [field, "viewer"], [viewer, "viewer"]])
      await pool.query("insert into public.company_members (company_id, user_id, role) values ($1, $2, $3)", [company, u, role]);
    await setAccess(mgr, ["manage_users"]);
    await setAccess(viewer, ["view_company_bids"]);
    await setAccess(field, ["view_company_bids", "update_progress"]);
    await sub(owner, company, 8);
    await pool.query("select public.apply_pm_update('sub_' || $1, false, 2, now())", [owner]); // 1 included + 2 paid = 3 seats
  });
  afterAll(async () => { await drop?.(); });

  it("SQL permission keys, role defaults and owner-only list match the app", async () => {
    const keys = (await pool.query("select public.company_permission_keys() k")).rows[0].k as string[];
    expect([...keys].sort()).toEqual([...PERMISSION_KEYS].sort());
    for (const role of ["owner", "manager", "estimator", "viewer"] as const) {
      const r = (await pool.query("select public.company_role_permissions($1) k", [role])).rows[0].k as string[];
      expect([...r].sort(), role).toEqual([...ROLE_PERMISSIONS[role]].sort());
    }
    const only = (await pool.query("select public.company_owner_only_permissions() k")).rows[0].k as string[];
    expect([...only].sort()).toEqual([...OWNER_ONLY_PERMISSIONS].sort());
  });

  it("a company admin without a seat can't change schedules, and a seat alone isn't enough", async () => {
    await assign(owner, est);
    const sid = await schedule(est);
    expect(await perms(mgr, sid)).toMatchObject({ edit: false, progress: false, publish: false });
    expect(await fails(save(mgr, sid, 1, { summary: "x", schedule: { name: "Mine now" } }))).toMatch(/forbidden/);
    // The owner holds every permission but no seat yet.
    expect((await perms(owner, sid)).edit).toBe(false);
    // est2 has a seat, but "edit assigned schedules" covers only their own bids.
    await assign(owner, est2);
    expect(await perms(est2, sid)).toMatchObject({ edit: false, progress: false });
    expect(await fails(save(est2, sid, 1, { summary: "x", schedule: { name: "Nope" } }))).toMatch(/forbidden/);
    expect(await perms(est, sid)).toMatchObject({ edit: true, progress: true, dependencies: true, publish: false, pdf: true });
    await assign(owner, est2, false);
  });

  it("progress, dependencies and publishing are separate permissions", async () => {
    const sid = await schedule(est);
    await assign(owner, field);
    let s = (await get(field, sid))!;
    expect(s.permissions).toMatchObject({ edit: false, progress: true, dependencies: false, publish: false });
    const [a, b] = s.tasks.map(taskOf);
    // Progress-only: status and % complete save; a date or name change, or a dependency, does not.
    let rev = await save(field, sid, 1, { summary: "progress", tasks: [{ ...a, status: "in_progress", percentComplete: 40, actualStart: "2026-11-16" }] });
    expect(rev).toBe(2);
    expect(await fails(save(field, sid, rev, { summary: "dates", tasks: [{ ...a, status: "in_progress", percentComplete: 40, actualStart: "2026-11-16", plannedEnd: "2026-11-20", durationDays: 5 }] }))).toMatch(/forbidden_edit/);
    expect(await fails(save(field, sid, rev, { summary: "deps", deps: [{ from: a.id, to: b.id, lagDays: 0, maxOverlap: 0 }] }))).toMatch(/forbidden_dependencies/);
    expect(await fails(save(field, sid, rev, { summary: "meta", schedule: { name: "Renamed" } }))).toMatch(/forbidden_edit/);
    rev = await save(field, sid, rev, { summary: "active", schedule: { status: "active" } });
    // An estimator whose "Manage dependencies" is revoked can move dates but not links.
    await setAccess(est, [], ["manage_dependencies"]);
    s = (await get(est, sid))!;
    expect(s.permissions).toMatchObject({ edit: true, dependencies: false });
    expect(await fails(save(est, sid, rev, { summary: "deps", deps: [{ from: a.id, to: b.id, lagDays: 0, maxOverlap: 0 }] }))).toMatch(/forbidden_dependencies/);
    await setAccess(est);
    rev = await save(est, sid, rev, { summary: "deps", deps: [{ from: a.id, to: b.id, lagDays: 0, maxOverlap: 0 }] });
    // Publishing: refused until granted, then allowed even for the progress-only member.
    const pub = (u: string) => as(u, "select public.schedule_publish($1, $2, $3) as r", [sid, rev, { options: {}, content: { v: 1 }, contentHash: "a".repeat(64), publisherName: "F" }]);
    expect(await fails(pub(field))).toMatch(/forbidden/);
    await setAccess(field, ["view_company_bids", "update_progress", "publish_customer_updates"]);
    expect(await fails(pub(field))).toBe("ok");
    // Without a seat, permissions alone don't let anyone write.
    await assign(owner, field, false);
    expect(await perms(field, sid)).toMatchObject({ progress: false, publish: false });
    await setAccess(field, ["view_company_bids", "update_progress"]);
  });

  it("revoking View schedules hides company schedules", async () => {
    const sid = await schedule(est);
    expect(await get(viewer, sid)).not.toBeNull();
    expect((await pool.query("select count(*)::int n from public.project_schedules where id = $1", [sid])).rows[0].n).toBe(1);
    await setAccess(viewer, ["view_company_bids"], ["view_schedules"]);
    expect(await get(viewer, sid)).toBeNull();
    const visible = await asUser(pool, viewer, (q) => q("select id from public.project_schedules where id = $1", [sid]));
    expect(visible.rows).toHaveLength(0);
    await setAccess(viewer, ["view_company_bids"]);
  });

  it("the project manager assigned to someone else's project can see and edit its schedule", async () => {
    const sid = await schedule(est);
    await assign(owner, est2);
    // est2 only sees their own bids: not visible or editable until picked as the project manager.
    expect(await get(est2, sid)).toBeNull();
    expect(await perms(est2, sid)).toMatchObject({ edit: false });
    await pool.query("update public.project_schedules set project_manager_id = $2 where id = $1", [sid, est2]);
    const s = (await get(est2, sid))!;
    expect(s).not.toBeNull();
    expect(s.tasks).toHaveLength(2);
    expect(s.permissions).toMatchObject({ edit: true, progress: true, dependencies: true });
    expect(await save(est2, sid, 1, { summary: "rename", schedule: { name: "Kitchen (PM)" } })).toBe(2);
    // "Edit assigned schedules" revoked: still visible, no longer editable. Unassigned: hidden again.
    await setAccess(est2, [], ["edit_assigned_schedules"]);
    expect(await perms(est2, sid)).toMatchObject({ edit: false });
    await setAccess(est2);
    await pool.query("update public.project_schedules set project_manager_id = null where id = $1", [sid]);
    expect(await get(est2, sid)).toBeNull();
    await assign(owner, est2, false);
  });

  it("reassigning a seat keeps the count, the seat's place and the subscription", async () => {
    // Seats now: est (rank 1). Add est2 so there's a paid seat to move.
    await assign(owner, est2);
    const before = (await as<{ s: { limit: number; seats: { userId: string; rank: number; seatType: string }[] } }>(owner, "select public.company_pm_seats() s")).s;
    expect(before.limit).toBe(3);
    expect(before.seats.map((x) => [x.userId, x.rank, x.seatType])).toEqual([[est, 1, "included"], [est2, 2, "paid"]]);
    const extraBefore = (await pool.query("select pm_extra_editors from public.subscriptions where company_id = $1", [company])).rows[0].pm_extra_editors;

    await as(owner, "select public.company_pm_reassign($1, $2)", [est2, viewer]);
    const after = (await as<{ s: { seats: { userId: string; rank: number; seatType: string; changedBy: string }[] } }>(owner, "select public.company_pm_seats() s")).s;
    expect(after.seats.map((x) => [x.userId, x.rank, x.seatType])).toEqual([[est, 1, "included"], [viewer, 2, "paid"]]);
    expect(after.seats[1].changedBy).toBe(owner);
    expect((await pool.query("select pm_extra_editors from public.subscriptions where company_id = $1", [company])).rows[0].pm_extra_editors).toBe(extraBefore);
    expect((await pool.query("select count(*)::int n from public.pm_editors where company_id = $1", [company])).rows[0].n).toBe(2);
    const audit = await pool.query("select details from public.company_audit_log where company_id = $1 and action = 'pm.editor_reassigned'", [company]);
    expect(audit.rows[0].details).toMatchObject({ from: est2, to: viewer });
    // est2's schedules are untouched; they're just view-only now.
    expect((await as<{ a: { canEdit: boolean } }>(est2, "select public.my_pm_access() a")).a.canEdit).toBe(false);

    expect(await fails(as(owner, "select public.company_pm_reassign($1, $1)", [est]))).toMatch(/same_user/);
    expect(await fails(as(owner, "select public.company_pm_reassign($1, $2)", [est2, mgr]))).toMatch(/not_editor/);
    expect(await fails(as(owner, "select public.company_pm_reassign($1, $2)", [est, viewer]))).toMatch(/already_editor/);
    expect(await fails(as(est, "select public.company_pm_reassign($1, $2)", [est, mgr]))).toMatch(/forbidden/);
    expect(await fails(as(est, "select public.company_pm_seats()"))).toMatch(/forbidden/);
    // A non-owner with the seat permission can reassign too (the migration's carry-over grant runs once, so it's set here).
    await setAccess(mgr, ["manage_users", "manage_pm_seats"]);
    await as(mgr, "select public.company_pm_reassign($1, $2)", [viewer, est2]);
    expect(await fails(assign(est, mgr))).toMatch(/forbidden/);
  });

  it("only the owner can hand out seat and add-on permissions", async () => {
    expect(await fails(as(mgr, "select public.update_company_member($1, 'estimator', array['manage_pm_seats'])", [est]))).not.toBe("ok");
    expect(await fails(as(mgr, "select public.update_company_member($1, 'estimator', array['manage_pm_addons'])", [est]))).not.toBe("ok");
    await as(owner, "select public.update_company_member($1, 'estimator', array['manage_pm_seats'])", [est]);
    const r = (await pool.query("select permissions_granted from public.company_members where user_id = $1", [est])).rows[0].permissions_granted as string[];
    expect(r).toContain("manage_pm_seats");
  });
});
