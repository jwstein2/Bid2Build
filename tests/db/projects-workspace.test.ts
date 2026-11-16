/**
 * Projects Workspace V4.1, against the real SQL:
 *   - pm_workspace returns only authorized projects (no cross-company leakage), tasks within the window
 *   - salesperson is backfilled from the estimate creator; PM is never automatic; both are separate
 *   - only editors can change people; people must be active company members
 *   - activity log records creation, saves, task completion and customer updates
 *   - closeout refuses unfinished tasks without a reason, never marks tasks complete, and reopen works
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { readFileSync } from "node:fs";
import { applyMigration, asUser, createUser, dbAvailable, freshDb } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;

const CAL = { workdays: [1, 2, 3, 4, 5], holidays: [], timezone: "America/Chicago" };
const fails = (p: Promise<unknown>) => p.then(() => "ok", (e: Error) => e.message);
type Row = Record<string, unknown>;
const taskOf = (t: Row) => ({
  id: t.id, kind: t.kind, sourceGroupId: t.source_group_id, sourceItemId: t.source_item_id, parentId: t.parent_id, splitFrom: t.split_from,
  name: t.name, sortOrder: t.sort_order, plannedStart: t.planned_start, plannedEnd: t.planned_end, durationDays: t.duration_days,
  actualStart: t.actual_start, actualFinish: t.actual_finish, percentComplete: t.percent_complete, status: t.status, weight: t.weight, assignee: t.assignee, notes: t.notes,
});

d("Projects workspace (database)", () => {
  let solo: string, owner: string, est: string, viewer: string, outsider: string, company: string, otherOwner: string, otherCompany: string;
  const as = <T = Row>(u: string, sql: string, args: unknown[] = []) => asUser(pool, u, (q) => q(sql, args)).then((r) => r.rows[0] as T);
  const sub = (u: string, plan: string, companyId: string | null, seats: number | null) =>
    pool.query(
      `select public.apply_subscription_update(p_user_id => $1::uuid, p_stripe_customer_id => 'cus_' || $1, p_stripe_subscription_id => 'sub_' || $1,
        p_status => 'active', p_plan => $2, p_price_id => 'price_x', p_current_period_end => '2099-01-01'::timestamptz, p_cancel_at_period_end => false,
        p_canceled_at => null, p_ended_at => null, p_event_created => now() - interval '1 minute', p_company_id => $3::uuid, p_seat_quantity => $4)`,
      [u, plan, companyId, seats],
    );
  const ws = (u: string, from = "2026-11-01", to = "2026-12-31") => as<{ w: { projects: Row[]; tasks: Row[]; people: Row[] } }>(u, "select public.pm_workspace($1, $2) as w", [from, to]).then((r) => r.w);
  const get = (u: string, sid: string) => as<{ s: { schedule: Row; tasks: Row[] } }>(u, "select public.schedule_get($1) as s", [sid]).then((r) => r.s);
  const save = (u: string, sid: string, rev: number, p: object) => as<{ r: number }>(u, "select public.schedule_save($1, $2, $3) as r", [sid, rev, p]).then((r) => r.r);
  const feed = (u: string, sid: string) => as<{ f: Row[] }>(u, "select public.project_activity_feed($1) as f", [sid]).then((r) => r.f);

  async function schedule(u: string, companyId: string | null, title = "Kitchen") {
    const id = (await pool.query("insert into public.estimates (user_id, company_id, title, customer_name, trades) values ($1, $2, $3, 'Pat', '{framing}') returning id", [u, companyId, title])).rows[0].id as string;
    const c = await pool.connect();
    try {
      await c.query("begin"); await c.query("select set_config('app.stage_change', 'on', true)");
      await c.query("update public.estimates set pipeline_stage = 'won' where id = $1", [id]); await c.query("commit");
    } finally { c.release(); }
    const g1 = (await pool.query("insert into public.estimate_groups (estimate_id, user_id, name, sort_order) values ($1, $2, 'Framing', 0) returning id", [id, u])).rows[0].id as string;
    const g2 = (await pool.query("insert into public.estimate_groups (estimate_id, user_id, name, sort_order) values ($1, $2, 'Flooring', 1) returning id", [id, u])).rows[0].id as string;
    const p = { name: title, calendar: CAL, startDate: "2026-11-16", deps: [], tasks: [
      { key: "a", kind: "section", sourceGroupId: g1, name: "Framing", plannedStart: "2026-11-16", plannedEnd: "2026-11-19", durationDays: 4, sortOrder: 0 },
      { key: "b", kind: "section", sourceGroupId: g2, name: "Flooring", plannedStart: "2026-11-20", plannedEnd: "2026-11-24", durationDays: 3, sortOrder: 1 },
    ] };
    return as<{ id: string }>(u, "select public.schedule_create($1, false, $2) as id", [id, p]).then((r) => r.id);
  }

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_projects_ws"));
    solo = await createUser(pool, "solo@test.dev");
    owner = await createUser(pool, "owner@acme.dev");
    est = await createUser(pool, "est@acme.dev");
    viewer = await createUser(pool, "viewer@acme.dev");
    outsider = await createUser(pool, "out@test.dev");
    otherOwner = await createUser(pool, "boss@other.dev");
    company = (await pool.query("select public.create_company($1, 'Acme') as id", [owner])).rows[0].id;
    otherCompany = (await pool.query("select public.create_company($1, 'Other') as id", [otherOwner])).rows[0].id;
    await pool.query("insert into public.company_members (company_id, user_id, role, display_name) values ($1, $2, 'estimator', 'Erin Estimator'), ($1, $3, 'viewer', 'Val Viewer')", [company, est, viewer]);
    await pool.query("update public.company_members set permissions_granted = '{view_company_bids}' where user_id = $1", [viewer]);
    await sub(solo, "monthly", null, null);
    await pool.query("select public.apply_pm_update('sub_' || $1, true, 0, now())", [solo]);
    await sub(owner, "enterprise", company, 5);
    await sub(otherOwner, "enterprise", otherCompany, 3);
    await pool.query("select public.apply_pm_update('sub_' || $1, false, 1, now())", [owner]);
    await as(owner, "select public.company_pm_assign($1, true)", [est]);
    await as(otherOwner, "select public.company_pm_assign($1, true)", [otherOwner]);
  });
  afterAll(async () => { await drop?.(); });

  it("salesperson defaults to the estimate creator; nobody is PM automatically", async () => {
    const sid = await schedule(est, company);
    const p = (await ws(est)).projects.find((x) => x.id === sid)!;
    expect(p.sales_rep_id).toBe(est);
    expect(p.project_manager_id).toBeNull();
    expect((p.permissions as Row).edit).toBe(true);
  });

  it("only authorized projects and tasks are returned (no cross-company or cross-account leakage)", async () => {
    const mine = await schedule(solo, null, "Solo deck");
    const theirs = await schedule(otherOwner, otherCompany, "Other co job");
    const soloWs = await ws(solo);
    expect(soloWs.projects.map((p) => p.id)).toEqual([mine]);
    expect(soloWs.tasks.every((t) => t.schedule_id === mine)).toBe(true);
    const viewerWs = await ws(viewer);
    expect(viewerWs.projects.some((p) => p.id === theirs || p.id === mine)).toBe(false);
    expect(viewerWs.projects.length).toBeGreaterThan(0);
    expect(viewerWs.projects.every((p) => (p.permissions as Row).edit === false)).toBe(true);
    expect((await ws(outsider)).projects).toEqual([]);
    // People list: own company only.
    const names = viewerWs.people.map((p) => p.name);
    expect(names).toContain("Erin Estimator");
    expect(viewerWs.people.some((p) => p.id === otherOwner)).toBe(false);
  });

  it("the date window limits tasks but keeps project summaries", async () => {
    const w = await ws(solo, "2027-03-01", "2027-03-31");
    expect(w.projects.length).toBe(1);
    expect(w.tasks).toEqual([]);
    expect(await fails(ws(solo, "2026-01-01", "2028-01-01"))).toMatch(/bad_window/);
  });

  it("people: editors only, company members only, logged", async () => {
    const sid = await schedule(est, company, "Bath");
    expect(await fails(as(viewer, "select public.schedule_set_people($1, $2, $3)", [sid, est, viewer]))).toMatch(/forbidden/);
    expect(await fails(as(est, "select public.schedule_set_people($1, $2, $3)", [sid, est, otherOwner]))).toMatch(/not_member/);
    expect(await fails(as(est, "select public.schedule_set_people($1, $2, $3)", [sid, est, owner]))).toBe("ok");
    const p = (await ws(est)).projects.find((x) => x.id === sid)!;
    expect(p).toMatchObject({ sales_rep_id: est, project_manager_id: owner });
    expect((await feed(est, sid)).some((a) => a.kind === "people_changed")).toBe(true);
    // Solo: only themselves.
    const s2 = await schedule(solo, null, "Fence");
    expect(await fails(as(solo, "select public.schedule_set_people($1, $2, $3)", [s2, solo, est]))).toMatch(/not_member/);
  });

  it("activity log: created, task completed, customer update; bid approval from stage history", async () => {
    const sid = await schedule(solo, null, "Roof");
    const s = await get(solo, sid);
    const a = taskOf(s.tasks[0]);
    await save(solo, sid, 1, { summary: "Framing done", tasks: [{ ...a, status: "complete", percentComplete: 100, actualStart: "2026-11-16", actualFinish: "2026-11-19" }] });
    await as(solo, "select public.schedule_publish($1, $2, $3)", [sid, 2, { options: {}, content: { v: 1 }, contentHash: "b".repeat(64), publisherName: "S" }]);
    const f = await feed(solo, sid);
    const kinds = f.map((x) => x.kind);
    expect(kinds).toEqual(expect.arrayContaining(["schedule_created", "schedule_changed", "task_completed", "customer_update"]));
    expect(f.find((x) => x.kind === "customer_update")!.audience).toBe("customer");
    expect(f.find((x) => x.kind === "task_completed")!.audience).toBe("internal");
    // Nobody else can read it.
    expect(await feed(outsider, sid)).toEqual([]);
  });

  it("closeout: unfinished tasks need a reason, tasks are never auto-completed, reopen restores", async () => {
    const sid = await schedule(solo, null, "Siding");
    expect(await fails(as(solo, "select public.schedule_closeout($1, 1, '2026-11-25', null)", [sid]))).toMatch(/incomplete_tasks/);
    expect(await fails(as(viewer, "select public.schedule_closeout($1, 1, '2026-11-25', 'x')", [sid]))).toMatch(/forbidden/);
    const rev = (await as<{ r: number }>(solo, "select public.schedule_closeout($1, 1, '2026-11-25', 'Customer cancelled flooring') as r", [sid])).r;
    expect(rev).toBe(2);
    const s = await get(solo, sid);
    expect(s.schedule).toMatchObject({ status: "completed", actual_finish: "2026-11-25", closeout_note: "Customer cancelled flooring" });
    expect(s.tasks.every((t) => t.status === "not_started")).toBe(true);
    const f = await feed(solo, sid);
    expect(f.filter((x) => x.kind === "project_completed").length).toBe(1);
    expect(f.some((x) => x.kind === "schedule_changed" && String(x.summary).startsWith("Project completed"))).toBe(false);
    // Completed projects still appear (history kept) and can be reopened.
    expect((await ws(solo)).projects.find((p) => p.id === sid)!.status).toBe("completed");
    expect(await fails(as(solo, "select public.schedule_reopen($1, 1)", [sid]))).toMatch(/stale_revision/);
    expect((await as<{ r: number }>(solo, "select public.schedule_reopen($1, 2) as r", [sid])).r).toBe(3);
    expect((await get(solo, sid)).schedule.status).toBe("active");
  });

  it("rollback removes V4.1 cleanly, keeps schedules, and the migration re-applies", async () => {
    const before = (await pool.query("select count(*)::int as n from public.project_schedules")).rows[0].n;
    await pool.query(readFileSync("docs/projects-workspace/rollback_20261118001000.sql", "utf8"));
    expect((await pool.query("select to_regclass('public.project_activity') as t")).rows[0].t).toBeNull();
    expect((await pool.query("select count(*)::int as n from information_schema.columns where table_name = 'project_schedules' and column_name in ('sales_rep_id','project_manager_id')")).rows[0].n).toBe(0);
    expect((await pool.query("select count(*)::int as n from public.project_schedules")).rows[0].n).toBe(before);
    await applyMigration(pool, "20261118001000_projects_workspace.sql");
    expect((await pool.query("select count(*)::int as n from public.project_schedules where sales_rep_id is not null")).rows[0].n).toBe(before);
  });
});
