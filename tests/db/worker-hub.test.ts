/**
 * V8.3 workforce & HR integration (20270210001000), against the real SQL with synthetic companies:
 *   - one employee record: classification lives on the profile and drives GPS eligibility (1099 can't be enrolled)
 *   - internal shifts (shop / office / training ...) need no project; project shifts need one; overlaps refused
 *   - the worker's schedule merges internal shifts, project assignments (direct + crew) and approved time off
 *   - work categories on time entries: project, shop, unpaid ...; unpaid never counts as paid labor
 *   - projected pay: hidden from workers by default (no amounts returned at all), visible once the company and the
 *     worker allow it; HR admins always see it; other workers and other companies never do
 *   - labor report: scheduled vs actual by job and overhead, cost hidden from people who can't see it
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createUser, dbAvailable, freshDb } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const fails = (p: Promise<unknown>) => p.then(() => "ok", (e: Error) => e.message);

d("Workforce & HR integration (database)", () => {
  let owner: string, mgr: string, crewUser: string, crew2User: string, otherOwner: string;
  let crew: string, crew2: string, sub: string, crewGroup: string, otherStaff: string;
  let sched: string, task: string, shop: string;
  const val = <T = unknown>(u: string, sql: string, args: unknown[] = []) => asUser(pool, u, (q) => q(`${sql} as v`, args)).then((r) => r.rows[0].v as T);
  const monday = "2026-11-16";

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_worker_hub"));
    owner = await createUser(pool, "owner@acme.dev");
    mgr = await createUser(pool, "mgr@acme.dev");
    crewUser = await createUser(pool, "crew@acme.dev");
    crew2User = await createUser(pool, "crew2@acme.dev");
    otherOwner = await createUser(pool, "boss@other.dev");
    const company = (await pool.query("select public.create_company($1, 'Acme Roofing') as id", [owner])).rows[0].id;
    const other = (await pool.query("select public.create_company($1, 'Other Builders') as id", [otherOwner])).rows[0].id;
    await pool.query("insert into public.company_members (company_id, user_id, role, display_name) values ($1, $2, 'manager', 'Mia'), ($1, $3, 'viewer', 'Cris'), ($1, $4, 'viewer', 'Dee')", [company, mgr, crewUser, crew2User]);
    const res = (c: string, kind: string, name: string, link: string | null) => pool.query("insert into public.pm_resources (company_id, kind, name, linked_user_id) values ($1, $2, $3, $4) returning id", [c, kind, name, link]).then((r) => r.rows[0].id as string);
    crew = await res(company, "staff", "Cris", crewUser);
    crew2 = await res(company, "staff", "Dee", crew2User);
    sub = await res(company, "subcontractor", "Sparky LLC", null);
    crewGroup = await res(company, "crew", "Crew A", null);
    otherStaff = await res(other, "staff", "Oz", null);
    await pool.query("insert into public.pm_crew_members (crew_id, member_id) values ($1, $2)", [crewGroup, crew2]);
    await pool.query("insert into public.pm_employee_profiles (resource_id, hourly_cost) values ($1, 40), ($2, 30)", [crew, crew2]);
    await pool.query("insert into public.pm_employee_hr (resource_id, pay_rate, pay_rate_unit, flsa_status) values ($1, 28, 'hour', 'non_exempt'), ($2, 52000, 'year', 'exempt')", [crew, crew2]);
    const est = (await pool.query("insert into public.estimates (user_id, company_id, title, customer_name, project_address) values ($1, $2, 'Smith roof', 'Pat', '12 Oak Ave') returning id", [owner, company])).rows[0].id;
    sched = (await pool.query(`insert into public.project_schedules (estimate_id, user_id, company_id, name, status, source_snapshot, calendar, start_date)
      values ($1, $2, $3, 'Smith roof', 'active', '{}'::jsonb, '{"workdays":[1,2,3,4,5],"holidays":["2026-11-19"],"timezone":"America/Chicago"}'::jsonb, $4) returning id`, [est, owner, company, monday])).rows[0].id;
    const sec = (await pool.query("insert into public.schedule_tasks (schedule_id, kind, source_group_id, name, planned_start, planned_end, duration_days) values ($1, 'section', gen_random_uuid(), 'Roof', $2, '2026-11-20', 5) returning id", [sched, monday])).rows[0].id;
    // Mon..Fri with Thursday a holiday: 4 workdays; 24 estimated hours -> 6 h/day. Assigned to the crew Dee is on.
    task = (await pool.query(`insert into public.schedule_tasks (schedule_id, parent_id, kind, source_group_id, name, planned_start, planned_end, duration_days, resource_id, assignment_hours, notes)
      values ($1, $2, 'item', gen_random_uuid(), 'Tear-off', $3, '2026-11-20', 5, $4, 24, 'Tear off two layers') returning id`, [sched, sec, monday, crewGroup])).rows[0].id;
    // Cris directly on the same task's sibling with times of day.
    await pool.query(`insert into public.schedule_tasks (schedule_id, parent_id, kind, source_group_id, name, planned_start, planned_end, duration_days, resource_id, assignment_start_time, assignment_end_time)
      values ($1, $2, 'item', gen_random_uuid(), 'Shingles', '2026-11-17', '2026-11-18', 2, $3, '07:00', '15:30')`, [sched, sec, crew]);
    shop = await val<string>(owner, "select public.pm_work_location_save($1)", [{ kind: "business", name: "Shop", lat: 44.98, lng: -93.27, confirm: true, everyone: true }]);
  });
  afterAll(async () => { await drop?.(); });

  it("classification lives on the employee record; only W-2 can use GPS time", async () => {
    expect(await fails(val(crewUser, "select public.pm_worker_classification_set($1, 'w2')", [crew]))).toMatch(/forbidden/);
    expect(await fails(val(owner, "select public.pm_worker_classification_set($1, 'w2')", [sub]))).toMatch(/staff_only/);
    expect(await fails(val(otherOwner, "select public.pm_worker_classification_set($1, 'w2')", [crew]))).toMatch(/forbidden/);
    await val(owner, "select public.pm_worker_classification_set($1, '1099')", [crew2]);
    expect(await fails(val(owner, "select public.pm_gps_enrollment_save($1, $2)", [crew2, { enrolled: true, w2Confirmed: true }]))).toMatch(/not_w2/);
    // Confirming W-2 in GPS sets the classification; marking someone 1099 later switches GPS off.
    await val(owner, "select public.pm_gps_enrollment_save($1, $2)", [crew, { enrolled: true, w2Confirmed: true }]);
    expect((await pool.query("select classification from public.pm_employee_profiles where resource_id = $1", [crew])).rows[0].classification).toBe("w2");
    await val(owner, "select public.pm_worker_classification_set($1, '1099')", [crew]);
    const e = (await pool.query("select enrolled, w2_confirmed_at from public.pm_gps_enrollments where resource_id = $1", [crew])).rows[0];
    expect(e.enrolled).toBe(false);
    expect(e.w2_confirmed_at).toBeNull();
    await val(owner, "select public.pm_worker_classification_set($1, 'w2')", [crew]);
    await val(owner, "select public.pm_worker_classification_set($1, 'w2')", [crew2]);
    const map = await val<Record<string, string>>(owner, "select public.pm_worker_classifications()");
    expect(map[crew]).toBe("w2");
    expect(map[sub]).toBeUndefined();
    expect(await fails(val(crewUser, "select public.pm_worker_classifications()"))).toMatch(/forbidden/);
  });

  it("internal shifts need no project, project shifts do, and overlaps are refused", async () => {
    expect(await fails(val(crewUser, "select public.pm_work_shift_save($1)", [{ resourceId: crew, date: monday, startTime: "07:00", endTime: "15:30", category: "shop" }]))).toMatch(/forbidden/);
    expect(await fails(val(owner, "select public.pm_work_shift_save($1)", [{ resourceId: sub, date: monday, startTime: "07:00", endTime: "15:30", category: "shop" }]))).toMatch(/staff_only/);
    expect(await fails(val(owner, "select public.pm_work_shift_save($1)", [{ resourceId: crew, date: monday, startTime: "07:00", endTime: "15:30", category: "project" }]))).toMatch(/project_required/);
    const made = await val<Row[]>(mgr, "select public.pm_work_shift_save($1)", [{ resourceId: crew, date: monday, startTime: "07:00", endTime: "15:30", unpaidBreakMinutes: 30, category: "shop", locationId: shop, notes: "Load trucks" }]);
    expect(made).toHaveLength(1);
    expect(await fails(val(owner, "select public.pm_work_shift_save($1)", [{ resourceId: crew, date: monday, startTime: "15:00", endTime: "17:00", category: "training" }]))).toMatch(/shift_overlap/);
    const multi = await val<Row[]>(owner, "select public.pm_work_shift_save($1)", [{ resourceId: crew, dates: ["2026-11-19", "2026-11-20"], startTime: "08:00", endTime: "12:00", category: "training" }]);
    expect(multi).toHaveLength(2);
    expect(await fails(val(otherOwner, "select public.pm_work_shift_save($1)", [{ resourceId: crew, date: monday, startTime: "18:00", endTime: "19:00", category: "shop" }]))).toMatch(/forbidden/);
    // The worker can read their own shifts; another worker can't.
    expect((await asUser(pool, crewUser, (q) => q("select * from public.pm_work_shifts"))).rows).toHaveLength(3);
    expect((await asUser(pool, crew2User, (q) => q("select * from public.pm_work_shifts"))).rows).toHaveLength(0);
  });

  it("one schedule: internal shifts, project assignments (direct and via crew), holidays skipped, time off", async () => {
    await pool.query("insert into public.pm_pto_entries (resource_id, company_id, kind, start_date, end_date, hours, status) select $1, company_id, 'pto', '2026-11-21', '2026-11-21', 8, 'approved' from public.pm_resources where id = $1", [crew2]);
    const cris = await val<Row[]>(crewUser, "select public.pm_worker_schedule($1, $2, $3)", [crew, monday, "2026-11-22"]);
    const byKind = (k: string) => cris.filter((x) => x.kind === k);
    expect(byKind("shift").map((x) => [x.date, x.hours, x.category])).toEqual([[monday, 8, "shop"], ["2026-11-19", 4, "training"], ["2026-11-20", 4, "training"]]);
    expect(byKind("task").map((x) => [x.date, x.hours, x.estimated])).toEqual([["2026-11-17", 8.5, false], ["2026-11-18", 8.5, false]]);
    expect(byKind("task")[0]).toMatchObject({ project: "Smith roof", task: "Shingles", address: "12 Oak Ave", category: "project" });
    const dee = await val<Row[]>(crew2User, "select public.pm_worker_schedule($1, $2, $3)", [crew2, monday, "2026-11-22"]);
    const tasks = dee.filter((x) => x.kind === "task");
    expect(tasks.map((x) => x.date)).toEqual([monday, "2026-11-17", "2026-11-18", "2026-11-20"]); // Thursday is a holiday
    expect(tasks.every((x) => x.hours === 6 && x.via === "Crew A" && x.estimated === true && x.responsibilities === "Tear off two layers")).toBe(true);
    expect(dee.find((x) => x.kind === "time_off")).toMatchObject({ date: "2026-11-21", hours: 8, category: "time_off" });
    // A worker can't read someone else's schedule; their manager can; another company can't.
    expect(await fails(val(crewUser, "select public.pm_worker_schedule($1, $2, $3)", [crew2, monday, "2026-11-22"]))).toMatch(/forbidden/);
    expect(await val<Row[]>(mgr, "select public.pm_worker_schedule($1, $2, $3)", [crew2, monday, "2026-11-22"])).toHaveLength(5);
    expect(await fails(val(otherOwner, "select public.pm_worker_schedule($1, $2, $3)", [crew, monday, "2026-11-22"]))).toMatch(/forbidden/);
    void task;
  });

  it("time entries carry a work category; non-project paid time needs no project; unpaid is never costed", async () => {
    await val(owner, "select public.pm_gps_settings_save($1)", [{ timezone: "America/Chicago" }]);
    const shopEntry = await val<Row>(crewUser, "select public.pm_clock_in($1)", [{ resourceId: crew, locationId: shop }]);
    expect(shopEntry.workCategory).toBe("shop");
    expect(shopEntry.scheduleId).toBeNull();
    await val(crewUser, "select public.pm_clock_out($1)", [{ entryId: shopEntry.id }]);
    expect(await fails(val(crewUser, "select public.pm_clock_in($1)", [{ resourceId: crew, workCategory: "lunch" }]))).toMatch(/bad_category/);
    const ins = (cat: string | null, sch: string | null, from: string, to: string, status = "approved") => pool.query(
      `insert into public.pm_time_entries (company_id, resource_id, schedule_id, work_category, clock_in, clock_out, status, source)
       select company_id, id, $2, $3, $4::timestamptz, $5::timestamptz, $6, 'manual' from public.pm_resources where id = $1`, [crew, sch, cat, from, to, status]);
    await ins(null, sched, "2026-11-17T13:00:00Z", "2026-11-17T21:00:00Z");           // project (derived)
    await ins("training", null, "2026-11-19T14:00:00Z", "2026-11-19T18:00:00Z");      // paid training
    await ins("unpaid", null, "2026-11-19T18:00:00Z", "2026-11-19T19:00:00Z");        // unpaid time
    const cats = (await pool.query("select work_category from public.pm_time_entries where resource_id = $1 order by clock_in", [crew])).rows.map((r) => r.work_category);
    expect(cats.slice(0, 3)).toEqual(["project", "training", "unpaid"]);
    // Corrections can name a category and why a manual review is needed.
    const k = await val<Row>(crewUser, "select public.pm_time_correction_request($1)", [{ resourceId: crew, clockIn: "2026-11-18T13:00:00Z", clockOut: "2026-11-18T17:00:00Z",
      workCategory: "office", issue: "forgot_phone", reason: "Left my phone at home, was in the office" }]);
    expect(k).toMatchObject({ workCategory: "office", issue: "forgot_phone" });
    const done = await val<Row>(owner, "select public.pm_time_correction_decide($1, true)", [k.id]);
    expect((await pool.query("select work_category from public.pm_time_entries where id = $1", [done.entryId])).rows[0].work_category).toBe("office");
  });

  it("projected pay is hidden from workers by default and no amounts come back", async () => {
    const hidden = await val<Row>(crewUser, "select public.pm_pay_inputs($1)", [crew]);
    expect(hidden).toEqual({ available: false, reason: "hidden" });
    expect(JSON.stringify(hidden)).not.toMatch(/28/);
    expect((await val<Row>(crewUser, "select public.pm_worker_week($1, $2)", [crew, monday])).pay).toEqual({ admin: false, visible: false });
    // The owner (HR) always sees it, even with the module off.
    expect(await val<Row>(owner, "select public.pm_pay_inputs($1)", [crew])).toMatchObject({ available: true, audience: "admin", payRate: 28, payRateUnit: "hour" });
    // A manager without HR access, another worker and another company can't read it.
    expect(await fails(val(mgr, "select public.pm_pay_inputs($1)", [crew]))).toMatch(/forbidden/);
    expect(await fails(val(crew2User, "select public.pm_pay_inputs($1)", [crew]))).toMatch(/forbidden/);
    expect(await fails(val(otherOwner, "select public.pm_pay_inputs($1)", [crew]))).toMatch(/forbidden/);
    expect(await fails(val(crewUser, "select public.pm_pay_settings_save($1)", [{ enabled: true, workersCanSee: true }]))).toMatch(/forbidden/);
    // Pay tables aren't directly readable.
    expect(await fails(asUser(pool, owner, (q) => q("select * from public.pm_pay_settings")))).toMatch(/permission denied/);
    expect(await fails(asUser(pool, crewUser, (q) => q("select * from public.pm_worker_pay_prefs")))).toMatch(/permission denied/);
  });

  it("company + worker switches decide what the worker sees", async () => {
    await val(owner, "select public.pm_pay_settings_save($1)", [{ enabled: true }]);
    expect((await val<Row>(crewUser, "select public.pm_pay_inputs($1)", [crew])).available).toBe(false); // workers still can't see it
    await val(owner, "select public.pm_pay_settings_save($1)", [{ workersCanSee: true, differentials: { training: 2 } }]);
    expect(await val<Row>(crewUser, "select public.pm_pay_inputs($1)", [crew])).toMatchObject({ available: true, audience: "worker", payRate: 28 });
    // Off for one worker: that worker gets nothing; the other still sees theirs.
    await val(owner, "select public.pm_worker_pay_prefs_save($1, $2)", [crew, { workerCanSee: false, rates: { training: 22 } }]);
    expect((await val<Row>(crewUser, "select public.pm_pay_inputs($1)", [crew])).available).toBe(false);
    expect((await val<Row>(crew2User, "select public.pm_pay_inputs($1)", [crew2])).payRateUnit).toBe("year");
    await val(owner, "select public.pm_worker_pay_prefs_save($1, $2)", [crew, { workerCanSee: null }]);
    expect(await val<Row>(crewUser, "select public.pm_pay_inputs($1)", [crew])).toMatchObject({ available: true, rates: { training: 22 } });
    expect(await fails(val(owner, "select public.pm_worker_pay_prefs_save($1, $2)", [crew, { rates: { training: -1 } }]))).toMatch(/bad_rates/);
    expect(await fails(val(owner, "select public.pm_pay_settings_save($1)", [{ differentials: { lunch: 1 } }]))).toMatch(/bad_differentials/);
    const ov = await val<Row>(owner, "select public.pm_pay_admin_overview()");
    expect(ov.workers.find((w: Row) => w.id === crew).workerSees).toBe(true);
  });

  it("labor report: scheduled vs actual by job and overhead; cost hidden from people who can't see it", async () => {
    const rep = await val<Row>(owner, "select public.pm_labor_report($1, $2)", [monday, "2026-11-22"]);
    const job = rep.jobs.find((j: Row) => j.name === "Smith roof");
    expect(job.scheduledHours).toBe(8.5 * 2 + 6 * 4);
    expect(job.actualHours).toBe(8);
    expect(job.actualCost).toBe(320);
    const cat = (c: string) => rep.nonProject.find((x: Row) => x.category === c);
    expect(cat("training")).toMatchObject({ scheduledHours: 8, actualHours: 4 });
    expect(cat("office").actualHours).toBe(4);
    expect(cat("unpaid")).toMatchObject({ actualHours: 1, actualCost: null });
    expect(rep.totals.unpaidHours).toBe(1);
    expect(rep.totals.actualHours).toBe(rep.totals.projectHours + rep.totals.overheadHours);
    // A time supervisor who doesn't manage the team sees hours but no cost; a worker can't run it; other company sees none of it.
    await val(owner, "select public.pm_time_supervisor_set($1, 'supervisor')", [crew2User]);
    const sup = await val<Row>(crew2User, "select public.pm_labor_report($1, $2)", [monday, "2026-11-22"]);
    expect(sup.canSeeCost).toBe(false);
    expect(sup.jobs[0].actualCost).toBeNull();
    expect(await fails(val(crewUser, "select public.pm_labor_report($1, $2)", [monday, "2026-11-22"]))).toMatch(/forbidden/);
    expect((await val<Row>(otherOwner, "select public.pm_labor_report($1, $2)", [monday, "2026-11-22"])).jobs).toEqual([]);
    void otherStaff;
  });

  it("the worker week brings it together for the worker", async () => {
    const w = await val<Row>(crewUser, "select public.pm_worker_week($1, $2)", [crew, "2026-11-18"]);
    expect(w.week).toBe(monday);
    expect(w.resource).toMatchObject({ name: "Cris", classification: "w2", isMe: true });
    expect(w.schedule.length).toBeGreaterThanOrEqual(5);
    expect(w.entries.map((e: Row) => e.workCategory)).toEqual(expect.arrayContaining(["shop", "project", "training", "unpaid", "office"]));
    expect(w.locations.map((l: Row) => [l.name, l.category])).toEqual([["Shop", "shop"]]);
    expect(w.pay).toEqual({ admin: false, visible: true });
    // Dee is now a time supervisor (previous test), so she may open Cris's week; another company can't.
    expect((await val<Row>(crew2User, "select public.pm_worker_week($1, $2)", [crew, monday])).resource.isMe).toBe(false);
    expect(await fails(val(otherOwner, "select public.pm_worker_week($1, $2)", [crew, monday]))).toMatch(/forbidden/);
  });

  it("rollback removes V8.3 and restores the GPS enrollment function", async () => {
    const { readFileSync } = await import("node:fs");
    await pool.query(readFileSync("docs/worker-hub/rollback_20270210001000.sql", "utf8"));
    expect((await pool.query("select to_regclass('public.pm_work_shifts') as t")).rows[0].t).toBeNull();
    expect((await pool.query("select count(*)::int as n from information_schema.columns where table_name = 'pm_employee_profiles' and column_name = 'classification'")).rows[0].n).toBe(0);
    await val(owner, "select public.pm_gps_enrollment_save($1, $2)", [crew2, { enrolled: true, w2Confirmed: true }]);
    await pool.query(readFileSync("supabase/migrations/20270210001000_worker_hub.sql", "utf8"));
    expect((await pool.query("select to_regclass('public.pm_work_shifts') as t")).rows[0].t).not.toBeNull();
  });
});
