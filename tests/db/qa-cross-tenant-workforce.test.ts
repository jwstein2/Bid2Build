/**
 * QA 2026-11-20: tenant isolation across today's workforce functions (V8.2 GPS + V8.3 worker hub), against the real
 * SQL. Company B's owner (and a worker of Company A) try every resource- or id-taking function with Company A's ids.
 * Each call must be refused or return nothing of Company A's. Synthetic companies only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createUser, dbAvailable, freshDb } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const refused = (p: Promise<unknown>) => p.then((v) => ({ ok: true, v }), (e: Error) => ({ ok: false, v: e.message }));

d("QA: workforce functions never cross companies (database)", () => {
  let ownerA: string, workerA: string, ownerB: string;
  let staffA: string, staffA2: string, staffB: string, locA: string, locB: string;
  const as = <T = unknown>(u: string, sql: string, args: unknown[] = []) => asUser(pool, u, (q) => q(`${sql} as v`, args)).then((r) => r.rows[0].v as T);

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_qa_cross_tenant"));
    ownerA = await createUser(pool, "owner@alpha.dev");
    workerA = await createUser(pool, "crew@alpha.dev");
    ownerB = await createUser(pool, "owner@beta.dev");
    const a = (await pool.query("select public.create_company($1, 'Alpha Roofing') as id", [ownerA])).rows[0].id;
    const b = (await pool.query("select public.create_company($1, 'Beta Builders') as id", [ownerB])).rows[0].id;
    await pool.query("insert into public.company_members (company_id, user_id, role, display_name) values ($1, $2, 'viewer', 'Cris')", [a, workerA]);
    const res = (c: string, name: string, link: string | null) => pool.query("insert into public.pm_resources (company_id, kind, name, linked_user_id) values ($1, 'staff', $2, $3) returning id", [c, name, link]).then((r) => r.rows[0].id as string);
    staffA = await res(a, "Cris", workerA);
    staffA2 = await res(a, "Dee", null);
    staffB = await res(b, "Oz", null);
    await pool.query("insert into public.pm_employee_hr (resource_id, pay_rate, pay_rate_unit, flsa_status) values ($1, 28, 'hour', 'non_exempt'), ($2, 30, 'hour', 'non_exempt')", [staffA, staffA2]);
    locA = await as<string>(ownerA, "select public.pm_work_location_save($1)", [{ kind: "business", name: "Alpha shop", lat: 44.98, lng: -93.27, confirm: true }]);
    locB = await as<string>(ownerB, "select public.pm_work_location_save($1)", [{ kind: "business", name: "Beta shop", lat: 45.01, lng: -93.2, confirm: true }]);
  }, 120_000);
  afterAll(async () => { await drop?.(); });

  it("Company B's owner can't change or read Company A's employees", async () => {
    const before = (await pool.query("select * from public.pm_resources where id = $1", [staffA])).rows[0] as Row;
    const calls: [string, unknown[]][] = [
      ["select public.pm_worker_classification_set($1, '1099')", [staffA]],
      ["select public.pm_worker_pay_prefs_save($1, $2)", [staffA, { projectionEnabled: true, workerCanSee: true, rates: { project: 99 } }]],
      ["select public.pm_gps_enrollment_save($1, $2)", [staffA, { enrolled: true, w2Confirmed: true }]],
      ["select public.pm_timesheet_signoff($1, '2026-11-16')", [staffA]],
      ["select public.pm_gps_device_status($1, $2)", [staffA, { permission: "granted" }]],
      ["select public.pm_gps_consent($1, true, 1)", [staffA]],
    ];
    for (const [sql, args] of calls) {
      const r = await refused(as(ownerB, sql, args));
      expect(r.ok, `${sql} should be refused, returned ${JSON.stringify(r.v)}`).toBe(false);
    }
    const after = (await pool.query("select * from public.pm_resources where id = $1", [staffA])).rows[0] as Row;
    expect(after).toEqual(before);
    expect((await pool.query("select count(*)::int n from public.pm_worker_pay_prefs where resource_id = $1", [staffA])).rows[0].n).toBe(0);
    expect((await pool.query("select count(*)::int n from public.pm_gps_enrollments where resource_id = $1", [staffA])).rows[0].n).toBe(0);
  });

  it("reads of Company A's employee return nothing to Company B", async () => {
    for (const sql of ["select public.pm_pay_inputs($1)", "select public.pm_gps_events_list($1, 14)", "select public.pm_worker_week($1, '2026-11-16')", "select public.pm_worker_schedule($1, '2026-11-16', '2026-11-22')"]) {
      const r = await refused(as<Row | null>(ownerB, sql, [staffA]));
      const leaked = r.ok && r.v !== null && JSON.stringify(r.v).match(/Cris|28|Alpha/);
      expect(leaked, `${sql} leaked ${JSON.stringify(r.v)}`).toBeFalsy();
    }
    expect(await as(ownerB, "select public.pm_time_readable($1)", [staffA])).toBe(false);
  });

  it("locations can't be assigned across companies in either direction", async () => {
    expect((await refused(as(ownerB, "select public.pm_work_location_assign($1, $2, false)", [locA, [staffB]]))).ok).toBe(false);
    expect((await refused(as(ownerB, "select public.pm_work_location_set_status($1, 'archived')", [locA]))).ok).toBe(false);
    // Company B's own location with Company A's employee: refused or silently ignored, never stored.
    await refused(as(ownerB, "select public.pm_work_location_assign($1, $2, false)", [locB, [staffA]]));
    expect((await pool.query("select count(*)::int n from public.pm_work_location_assignments where location_id = $1 and resource_id = $2", [locB, staffA])).rows[0].n).toBe(0);
    expect((await pool.query("select status from public.pm_work_locations where id = $1", [locA])).rows[0].status).toBe("active");
  });

  it("a worker can't edit their own pay switches or a coworker's records", async () => {
    expect((await refused(as(workerA, "select public.pm_worker_pay_prefs_save($1, $2)", [staffA, { workerCanSee: true }]))).ok).toBe(false);
    expect((await refused(as(workerA, "select public.pm_worker_classification_set($1, 'w2')", [staffA2]))).ok).toBe(false);
    expect((await refused(as(workerA, "select public.pm_gps_enrollment_save($1, $2)", [staffA2, { enrolled: true, w2Confirmed: true }]))).ok).toBe(false);
    expect(await as(workerA, "select public.pm_time_readable($1)", [staffA2])).toBe(false);
  });
});
