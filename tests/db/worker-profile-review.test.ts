/**
 * Worker dashboard: My profile + clock-in review notices (20270227001000), against the real SQL:
 *   - a worker sees only their own profile (no pay/tax/bank) and the open jobs they're on (direct, crew, shift)
 *   - a worker can change only their preferred name, personal contact and emergency contact; logged by field name
 *   - a "forgot my phone" request notifies the owner and time supervisors (never the requester); deciding it clears
 *     the managers' notice and tells the worker; withdrawing clears it too; notices can be dismissed only by their owner
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
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

d("Worker profile + clock-in review notices (database)", () => {
  let owner: string, sup: string, mgr: string, crewUser: string, crew2User: string, otherOwner: string;
  let crew: string, crew2: string, crewGroup: string, company: string;
  const val = <T = unknown>(u: string, sql: string, args: unknown[] = []) => asUser(pool, u, (q) => q(`${sql} as v`, args)).then((r) => r.rows[0].v as T);
  const notices = (u: string) => val<Row[]>(u, "select public.my_notifications()");

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_worker_profile_review"));
    owner = await createUser(pool, "owner@acme.dev");
    sup = await createUser(pool, "sup@acme.dev");
    mgr = await createUser(pool, "mgr@acme.dev");
    crewUser = await createUser(pool, "crew@acme.dev");
    crew2User = await createUser(pool, "crew2@acme.dev");
    otherOwner = await createUser(pool, "boss@other.dev");
    company = (await pool.query("select public.create_company($1, 'Acme Roofing') as id", [owner])).rows[0].id;
    const other = (await pool.query("select public.create_company($1, 'Other') as id", [otherOwner])).rows[0].id;
    await pool.query(`insert into public.company_members (company_id, user_id, role, display_name) values
      ($1, $2, 'manager', 'Sam'), ($1, $3, 'manager', 'Mia'), ($1, $4, 'viewer', 'Cris'), ($1, $5, 'viewer', 'Dee')`, [company, sup, mgr, crewUser, crew2User]);
    await val(owner, "select public.pm_time_supervisor_set($1, 'supervisor')", [sup]);
    const res = (c: string, kind: string, name: string, link: string | null) => pool.query("insert into public.pm_resources (company_id, kind, name, linked_user_id, phone) values ($1, $2, $3, $4, '555-0100') returning id", [c, kind, name, link]).then((r) => r.rows[0].id as string);
    crew = await res(company, "staff", "Cris", crewUser);
    crew2 = await res(company, "staff", "Dee", crew2User);
    crewGroup = await res(company, "crew", "Crew A", null);
    await res(other, "staff", "Oz", null);
    await pool.query("insert into public.pm_crew_members (crew_id, member_id) values ($1, $2)", [crewGroup, crew2]);
    await pool.query("insert into public.pm_employee_profiles (resource_id, title, hourly_cost, hire_date) values ($1, 'Lead roofer', 40, '2025-03-01')", [crew]);
    await pool.query("insert into public.pm_employee_hr (resource_id, pay_rate, pay_rate_unit, department, supervisor_id) values ($1, 28, 'hour', 'Field', $2)", [crew, crew2]);
    const est = (await pool.query("insert into public.estimates (user_id, company_id, title, customer_name, project_address) values ($1, $2, 'Smith roof', 'Pat', '12 Oak Ave') returning id", [owner, company])).rows[0].id;
    const sched = (await pool.query(`insert into public.project_schedules (estimate_id, user_id, company_id, name, status, source_snapshot, calendar, start_date)
      values ($1, $2, $3, 'Smith roof', 'active', '{"estimate":{"projectAddress":"12 Oak Ave"}}'::jsonb, '{"workdays":[1,2,3,4,5],"timezone":"America/Chicago"}'::jsonb, $4) returning id`, [est, owner, company, day(-3)])).rows[0].id;
    const sec = (await pool.query("insert into public.schedule_tasks (schedule_id, kind, source_group_id, name, planned_start, planned_end, duration_days) values ($1, 'section', gen_random_uuid(), 'Roof', $2, $3, 10) returning id", [sched, day(-3), day(7)])).rows[0].id;
    await pool.query(`insert into public.schedule_tasks (schedule_id, parent_id, kind, source_group_id, name, planned_start, planned_end, duration_days, resource_id)
      values ($1, $2, 'item', gen_random_uuid(), 'Shingles', $3, $4, 3, $5), ($1, $2, 'item', gen_random_uuid(), 'Tear-off', $6, $7, 3, $8)`,
      [sched, sec, day(1), day(3), crew, day(-3), day(2), crewGroup]);
  });
  afterAll(async () => { await drop?.(); });

  it("a worker sees their own profile and jobs, without pay", async () => {
    const [p] = await val<Row[]>(crewUser, "select public.pm_worker_my_profile()");
    expect(p).toMatchObject({ resourceId: crew, name: "Cris", companyName: "Acme Roofing", title: "Lead roofer", department: "Field", supervisorName: "Dee", workPhone: "555-0100", hireDate: "2025-03-01" });
    expect(JSON.stringify(p)).not.toMatch(/28|hourly|pay/i);
    expect(p.jobs).toEqual([expect.objectContaining({ name: "Smith roof", address: "12 Oak Ave", openTasks: 1, nextDate: day(1) })]);
    // Crew membership counts; started task shows today as next.
    const [q] = await val<Row[]>(crew2User, "select public.pm_worker_my_profile()");
    expect(q.jobs).toEqual([expect.objectContaining({ name: "Smith roof", nextDate: day(0) })]);
    expect(await val<Row[]>(otherOwner, "select public.pm_worker_my_profile()")).toEqual([]);
  });

  it("a worker can update only their own contact details", async () => {
    expect(await fails(val(crew2User, "select public.pm_worker_profile_save($1, $2)", [crew, { personalPhone: "1" }]))).toMatch(/forbidden/);
    expect(await fails(val(crewUser, "select public.pm_worker_profile_save($1, $2)", [crew, { personalEmail: "nope" }]))).toMatch(/bad_personal_email/);
    const [p] = await val<Row[]>(crewUser, "select public.pm_worker_profile_save($1, $2)", [crew, { preferredName: "Cee", personalPhone: "555-0199", emergencyName: "Ana", emergencyRelation: "Sister", emergencyPhone: "555-0142", department: "Office" }]);
    expect(p).toMatchObject({ preferredName: "Cee", personalPhone: "555-0199", emergencyName: "Ana", emergencyRelation: "Sister", emergencyPhone: "555-0142", department: "Field" });
    expect((await pool.query("select pay_rate from public.pm_employee_hr where resource_id = $1", [crew])).rows[0].pay_rate).toBe("28.00");
    expect((await pool.query("select emergency_name, emergency_phone from public.pm_employee_profiles where resource_id = $1", [crew])).rows[0]).toEqual({ emergency_name: "Ana", emergency_phone: "555-0142" });
    const audit = (await pool.query("select action, fields from public.pm_hr_audit where resource_id = $1 and action = 'worker_self_update'", [crew])).rows[0];
    expect(audit.fields).toEqual(["preferredName", "personalPhone", "emergencyName", "emergencyRelation", "emergencyPhone"]);
    // Dee has no HR file yet: one is created.
    await val(crew2User, "select public.pm_worker_profile_save($1, $2)", [crew2, { personalPhone: "555-0222" }]);
    expect((await pool.query("select personal_phone from public.pm_employee_hr where resource_id = $1", [crew2])).rows[0].personal_phone).toBe("555-0222");
  });

  it("a forgot-my-phone request notifies the owner and supervisors; the decision notifies the worker", async () => {
    const k = await val<Row>(crewUser, "select public.pm_time_correction_request($1)", [{ resourceId: crew, clockIn: ago(60 * 9), clockOut: ago(60), issue: "forgot_phone", reason: "Left my phone at home, started at 7" }]);
    for (const u of [owner, sup]) {
      const n = (await notices(u)).filter((x) => x.kind === "time_correction");
      expect(n).toHaveLength(1);
      expect(n[0]).toMatchObject({ title: "Cris asked to add missing time", data: { correctionId: k.id, issue: "forgot_phone", employeeName: "Cris" } });
    }
    expect((await notices(mgr)).filter((x) => x.kind === "time_correction")).toHaveLength(0);
    expect((await notices(crewUser)).filter((x) => x.kind.startsWith("time_correction"))).toHaveLength(0);
    expect((await notices(otherOwner))).toHaveLength(0);

    await val(sup, "select public.pm_time_correction_decide($1, false, 'Shop camera shows 8:00')", [k.id]);
    expect((await notices(owner)).filter((x) => x.kind === "time_correction")).toHaveLength(0);
    expect((await notices(sup)).filter((x) => x.kind === "time_correction")).toHaveLength(0);
    const [w] = (await notices(crewUser)).filter((x) => x.kind === "time_correction_decided");
    expect(w).toMatchObject({ title: "Your time fix was denied", data: { decision: "denied", note: "Shop camera shows 8:00" } });

    expect(await fails(val(owner, "select public.notification_dismiss($1)", [w.id]))).toMatch(/not_found/);
    await val(crewUser, "select public.notification_dismiss($1)", [w.id]);
    expect((await notices(crewUser)).filter((x) => x.kind === "time_correction_decided")).toHaveLength(0);
  });

  it("withdrawing clears the managers' notice; the owner's own request doesn't notify the owner", async () => {
    const k = await val<Row>(crew2User, "select public.pm_time_correction_request($1)", [{ resourceId: crew2, clockIn: ago(60 * 30), clockOut: ago(60 * 26), issue: "gps_unavailable", reason: "GPS was off" }]);
    expect((await notices(owner)).filter((x) => x.kind === "time_correction")).toHaveLength(1);
    await val(crew2User, "select public.pm_time_correction_withdraw($1)", [k.id]);
    expect((await notices(owner)).filter((x) => x.kind === "time_correction")).toHaveLength(0);
    expect((await notices(crew2User)).filter((x) => x.kind === "time_correction_decided")).toHaveLength(0);

    const me = (await pool.query("insert into public.pm_resources (company_id, kind, name, linked_user_id) values ($1, 'staff', 'Owner', $2) returning id", [company, owner])).rows[0].id;
    await val(owner, "select public.pm_time_correction_request($1)", [{ resourceId: me, clockIn: ago(60 * 50), clockOut: ago(60 * 48), reason: "Forgot" }]);
    expect((await notices(owner)).filter((x) => x.kind === "time_correction")).toHaveLength(0);
    expect((await notices(sup)).filter((x) => x.kind === "time_correction")).toHaveLength(1);
  });
});
