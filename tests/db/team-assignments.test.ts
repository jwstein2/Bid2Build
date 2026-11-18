/**
 * V4.2 Team & Subcontractors + assignments, against the real SQL:
 *   - directory is scoped to the company (or the solo account); viewers read, only schedule editors change it
 *   - staff can link only to active members of the same company; crews hold only same-directory entries
 *   - section assignment flows to its tasks, task overrides survive a section reassignment
 *   - "confirmed" records who/when; resources from another company are refused; revision bumps once
 *   - typing a different Gantt "Assigned to" name replaces the directory assignment
 *   - rollback removes V4.2 cleanly
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { applyMigration, asUser, createUser, dbAvailable, freshDb } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;

const CAL = { workdays: [1, 2, 3, 4, 5], holidays: [], timezone: "America/Chicago" };
const fails = (p: Promise<unknown>) => p.then(() => "ok", (e: Error) => e.message);
type Row = Record<string, unknown>;

d("Team & Subcontractors + assignments (database)", () => {
  let solo: string, owner: string, est: string, viewer: string, otherOwner: string, company: string, otherCompany: string;
  const as = <T = Row>(u: string, sql: string, args: unknown[] = []) => asUser(pool, u, (q) => q(sql, args)).then((r) => r.rows[0] as T);
  const sub = (u: string, plan: string, companyId: string | null, seats: number | null) =>
    pool.query(
      `select public.apply_subscription_update(p_user_id => $1::uuid, p_stripe_customer_id => 'cus_' || $1, p_stripe_subscription_id => 'sub_' || $1,
        p_status => 'active', p_plan => $2, p_price_id => 'price_x', p_current_period_end => '2099-01-01'::timestamptz, p_cancel_at_period_end => false,
        p_canceled_at => null, p_ended_at => null, p_event_created => now() - interval '1 minute', p_company_id => $3::uuid, p_seat_quantity => $4)`,
      [u, plan, companyId, seats],
    );
  const team = (u: string) => as<{ t: { canManage: boolean; resources: Row[] } }>(u, "select public.pm_team() as t").then((r) => r.t);
  const saveRes = (u: string, p: object) => as<{ id: string }>(u, "select public.pm_resource_save($1) as id", [p]).then((r) => r.id);
  const assign = (u: string, sid: string, rev: number, items: object[]) => as<{ r: number }>(u, "select public.schedule_assign($1, $2, $3) as r", [sid, rev, JSON.stringify(items)]).then((r) => r.r);
  const tasks = async (sid: string) => (await pool.query("select * from public.schedule_tasks where schedule_id = $1 order by sort_order, kind desc, name", [sid])).rows as Row[];
  const rev = async (sid: string) => (await pool.query("select revision from public.project_schedules where id = $1", [sid])).rows[0].revision as number;

  async function schedule(u: string, companyId: string | null) {
    const id = (await pool.query("insert into public.estimates (user_id, company_id, title, customer_name, trades) values ($1, $2, 'Job', 'Pat', '{framing}') returning id", [u, companyId])).rows[0].id as string;
    const c = await pool.connect();
    try {
      await c.query("begin"); await c.query("select set_config('app.stage_change', 'on', true)");
      await c.query("update public.estimates set pipeline_stage = 'won' where id = $1", [id]); await c.query("commit");
    } finally { c.release(); }
    const g = (await pool.query("insert into public.estimate_groups (estimate_id, user_id, name, sort_order) values ($1, $2, 'Framing', 0) returning id", [id, u])).rows[0].id as string;
    const i1 = (await pool.query("insert into public.estimate_items (estimate_id, group_id, user_id, name, quantity, unit, unit_cost, sort_order) values ($1, $2, $3, 'Walls', 1, 'ea', 1, 0) returning id", [id, g, u])).rows[0].id as string;
    const i2 = (await pool.query("insert into public.estimate_items (estimate_id, group_id, user_id, name, quantity, unit, unit_cost, sort_order) values ($1, $2, $3, 'Roof', 1, 'ea', 1, 1) returning id", [id, g, u])).rows[0].id as string;
    const p = { name: "Job", calendar: CAL, startDate: "2026-11-16", deps: [], tasks: [
      { key: "s", kind: "section", sourceGroupId: g, name: "Framing", plannedStart: "2026-11-16", plannedEnd: "2026-11-19", durationDays: 4, sortOrder: 0 },
      { key: "a", kind: "item", parentKey: "s", sourceGroupId: g, sourceItemId: i1, name: "Walls", plannedStart: "2026-11-16", plannedEnd: "2026-11-17", durationDays: 2, sortOrder: 1 },
      { key: "b", kind: "item", parentKey: "s", sourceGroupId: g, sourceItemId: i2, name: "Roof", plannedStart: "2026-11-18", plannedEnd: "2026-11-19", durationDays: 2, sortOrder: 2 },
    ] };
    return as<{ id: string }>(u, "select public.schedule_create($1, false, $2) as id", [id, p]).then((r) => r.id);
  }

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_team_assign"));
    solo = await createUser(pool, "solo@test.dev");
    owner = await createUser(pool, "owner@acme.dev");
    est = await createUser(pool, "est@acme.dev");
    viewer = await createUser(pool, "viewer@acme.dev");
    otherOwner = await createUser(pool, "boss@other.dev");
    company = (await pool.query("select public.create_company($1, 'Acme') as id", [owner])).rows[0].id;
    otherCompany = (await pool.query("select public.create_company($1, 'Other') as id", [otherOwner])).rows[0].id;
    await pool.query("insert into public.company_members (company_id, user_id, role, display_name) values ($1, $2, 'estimator', 'Erin'), ($1, $3, 'viewer', 'Val')", [company, est, viewer]);
    await sub(solo, "monthly", null, null);
    await pool.query("select public.apply_pm_update('sub_' || $1, true, 0, now())", [solo]);
    await sub(owner, "enterprise", company, 5);
    await sub(otherOwner, "enterprise", otherCompany, 3);
    await pool.query("select public.apply_pm_update('sub_' || $1, false, 1, now())", [owner]);
    await as(owner, "select public.company_pm_assign($1, true)", [est]);
    await as(otherOwner, "select public.company_pm_assign($1, true)", [otherOwner]);
  });
  afterAll(async () => { await drop?.(); });

  it("directory is per company / per solo account; viewers read but can't change it", async () => {
    const sub1 = await saveRes(est, { kind: "subcontractor", name: "Stone Works", contactName: "Sam", trades: ["Countertops", "countertops"], email: "sam@stone.test", phone: "555-0100" });
    await saveRes(solo, { kind: "subcontractor", name: "Solo Sub" });
    await saveRes(otherOwner, { kind: "crew", name: "Other Crew" });
    const t = await team(viewer);
    expect(t.canManage).toBe(false);
    expect(t.resources.map((r) => r.name)).toEqual(["Stone Works"]);
    expect(t.resources[0].trades).toEqual(["countertops"]);
    expect((await team(solo)).resources.map((r) => r.name)).toEqual(["Solo Sub"]);
    expect(await fails(saveRes(viewer, { kind: "staff", name: "Nope" }))).toMatch(/forbidden/);
    expect(await fails(saveRes(otherOwner, { id: sub1, kind: "subcontractor", name: "Hijack" }))).toMatch(/not_found/);
    expect(await fails(as(viewer, "insert into public.pm_resources (company_id, kind, name) values ($1, 'crew', 'x')", [company]))).toMatch(/permission denied/);
  });

  it("staff link only to active members of the same company; crews only hold same-directory entries", async () => {
    const erin = await saveRes(owner, { kind: "staff", name: "Erin", linkedUserId: est, trades: ["framing"] });
    expect(await fails(saveRes(owner, { kind: "staff", name: "Boss", linkedUserId: otherOwner }))).toMatch(/not_member/);
    const theirs = (await team(otherOwner)).resources[0].id as string;
    expect(await fails(saveRes(owner, { kind: "crew", name: "Crew A", members: [theirs] }))).toMatch(/bad_member/);
    const crew = await saveRes(owner, { kind: "crew", name: "Crew A", members: [erin], trades: ["framing"], capacity: 2 });
    const c = (await team(est)).resources.find((r) => r.id === crew)!;
    expect(c.members).toEqual([erin]);
    expect(c.capacity).toBe(2);
    await as(owner, "select public.pm_resource_set_status($1, 'archived')", [erin]);
    expect((await team(est)).resources.find((r) => r.id === crew)!.members).toEqual([]);
  });

  it("section assignment flows to its tasks; overrides survive; confirmed is recorded; one revision", async () => {
    const sid = await schedule(est, company);
    const [sec, walls, roof] = await tasks(sid);
    const crew = await saveRes(owner, { kind: "crew", name: "Framers" });
    const sub2 = await saveRes(owner, { kind: "subcontractor", name: "Roof Co" });
    const r0 = await rev(sid);
    const r1 = await assign(est, sid, r0, [{ taskId: sec.id, resourceId: crew, status: "requested" }]);
    expect(r1).toBe(r0 + 1);
    let t = await tasks(sid);
    expect(t.map((x) => x.resource_id)).toEqual([crew, crew, crew]);
    expect(t.map((x) => x.assignment_inherited)).toEqual([false, true, true]);
    expect(t[1].assignee).toBe("Framers");
    // Override one task, then reassign the section: the override stays.
    const r2 = await assign(est, sid, r1, [{ taskId: roof.id, resourceId: sub2, status: "confirmed" }]);
    const crew2 = await saveRes(owner, { kind: "crew", name: "Framers B" });
    await assign(est, sid, r2, [{ taskId: sec.id, resourceId: crew2, status: "tentative" }]);
    t = await tasks(sid);
    expect(t.find((x) => x.id === walls.id)!.resource_id).toBe(crew2);
    const rf = t.find((x) => x.id === roof.id)!;
    expect(rf.resource_id).toBe(sub2);
    expect(rf.assignment_status).toBe("confirmed");
    expect(rf.assignment_confirmed_by).toBe(est);
    expect(rf.assignment_confirmed_at).not.toBeNull();
    expect(await fails(assign(est, sid, r1, [{ taskId: sec.id, resourceId: null }]))).toMatch(/stale_revision/);
  });

  it("refuses other companies' resources, archived entries, and people without edit rights", async () => {
    const sid = await schedule(est, company);
    const [sec] = await tasks(sid);
    const theirs = (await team(otherOwner)).resources[0].id as string;
    const r = await rev(sid);
    expect(await fails(assign(est, sid, r, [{ taskId: sec.id, resourceId: theirs }]))).toMatch(/bad_resource/);
    const old = await saveRes(owner, { kind: "subcontractor", name: "Gone Co" });
    await as(owner, "select public.pm_resource_set_status($1, 'archived')", [old]);
    expect(await fails(assign(est, sid, r, [{ taskId: sec.id, resourceId: old }]))).toMatch(/bad_resource/);
    expect(await fails(assign(viewer, sid, r, [{ taskId: sec.id, resourceId: null }]))).toMatch(/forbidden/);
    expect(await fails(as(viewer, "select public.schedule_set_report_assignees($1, 'names_contacts')", [sid]))).toMatch(/forbidden/);
    await as(est, "select public.schedule_set_report_assignees($1, 'hidden')", [sid]);
    expect((await pool.query("select report_assignees from public.project_schedules where id = $1", [sid])).rows[0].report_assignees).toBe("hidden");
  });

  it("new projects default to names only on the customer report; Gantt text replaces a directory assignment", async () => {
    const sid = await schedule(solo, null);
    expect((await pool.query("select report_assignees from public.project_schedules where id = $1", [sid])).rows[0].report_assignees).toBe("names");
    const [sec] = await tasks(sid);
    const me = await saveRes(solo, { kind: "staff", name: "Me", linkedUserId: solo });
    const r1 = await assign(solo, sid, await rev(sid), [{ taskId: sec.id, resourceId: me }]);
    const full = (await as<{ s: { tasks: Row[] } }>(solo, "select public.schedule_get($1) as s", [sid])).s;
    const task = (x: Row) => ({ id: x.id, kind: x.kind, sourceGroupId: x.source_group_id, sourceItemId: x.source_item_id, parentId: x.parent_id, name: x.name, sortOrder: x.sort_order,
      plannedStart: x.planned_start, plannedEnd: x.planned_end, durationDays: x.duration_days, percentComplete: x.percent_complete, status: x.status, assignee: x.assignee, notes: x.notes });
    // Re-saving unchanged keeps the assignment.
    const r2 = (await as<{ r: number }>(solo, "select public.schedule_save($1, $2, $3) as r", [sid, r1, { tasks: full.tasks.map(task) }])).r;
    expect((await tasks(sid))[0].resource_id).toBe(me);
    await as(solo, "select public.schedule_save($1, $2, $3)", [sid, r2, { tasks: full.tasks.map((x) => (x.id === sec.id ? { ...task(x), assignee: "Someone else" } : task(x))) }]);
    const s0 = (await tasks(sid))[0];
    expect(s0.resource_id).toBeNull();
    expect(s0.assignee).toBe("Someone else");
    const a = await as<{ a: Row[] }>(solo, "select public.pm_task_assignments('2026-11-01', '2026-12-31') as a");
    expect(a.a.every((x) => x.id !== sec.id)).toBe(true);
  });

  it("rollback removes V4.2 and the migration re-applies", async () => {
    // Later migrations depend on the directory: roll them back first (newest first).
    // The Financial Command Center points at change orders / quotes / the directory: roll it back first (newest first).
    await pool.query(readFileSync("docs/financials/rollback_20261213001000.sql", "utf8"));
    await pool.query(readFileSync("docs/financials/rollback_20261211001000.sql", "utf8"));
    await pool.query(readFileSync("docs/supplier-pricing/rollback_20261211001000.sql", "utf8"));
    await pool.query(readFileSync("docs/team-records/rollback_20261210001000.sql", "utf8"));
    await pool.query(readFileSync("docs/financials/rollback_20261201007000.sql", "utf8"));
    await pool.query(readFileSync("docs/financials/rollback_20261130201000.sql", "utf8"));
    await pool.query(readFileSync("docs/financials/rollback_20261130101000.sql", "utf8"));
    await pool.query(readFileSync("docs/financials/rollback_20261130001000.sql", "utf8"));
    await pool.query(readFileSync("docs/financials/rollback_20261129002000.sql", "utf8"));
    await pool.query(readFileSync("docs/project-operations/rollback_20261129001000.sql", "utf8")); // newest first
    for (const f of ["20261128001000", "20261126001000", "20261125001000", "20261124004000", "20261124003000", "20261124002000", "20261124001000"]) await pool.query(readFileSync(`docs/financials/rollback_${f}.sql`, "utf8"));
    for (const f of ["20261119004000", "20261119003000", "20261119002000", "20261119001000"]) await pool.query(readFileSync(`docs/project-operations/rollback_${f}.sql`, "utf8"));
    await pool.query(readFileSync("docs/projects-workspace/rollback_20261118002000.sql", "utf8"));
    expect((await pool.query("select to_regclass('public.pm_resources') as t")).rows[0].t).toBeNull();
    expect((await pool.query("select count(*)::int as n from information_schema.columns where table_name = 'schedule_tasks' and column_name = 'resource_id'")).rows[0].n).toBe(0);
    await applyMigration(pool, "20261118002000_team_assignments.sql");
    expect((await pool.query("select to_regclass('public.pm_resources') as t")).rows[0].t).not.toBeNull();
  });
});
