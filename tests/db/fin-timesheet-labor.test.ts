/**
 * Timesheet labor in job costing and the billed P&L (20270103001000):
 *   - approved hours on a project's schedule are costed at the worker's hourly cost, on the job's labor cost code
 *   - pending/rejected hours and hours with no hourly cost don't count (no-rate hours are reported)
 *   - the billed P&L shows them as labor; the cash P&L doesn't
 *   - a book can turn timesheet labor off (managers only); other companies never see it
 *   - rollback restores the earlier views
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { dbAvailable, freshDb, type Row } from "./harness";
import { asFn, fails, rowsFn, setupWorld, wonBid, type World } from "./fin-fixtures";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
let w: World;

d("timesheet labor in job costing (database)", () => {
  let as: ReturnType<typeof asFn>;
  let rows: ReturnType<typeof rowsFn>;
  let job: string, est: string, worker: string, noRate: string;
  const entry = (resource: string, day: string, hours: number, status = "approved", breakMin = 0) => pool.query(
    `insert into public.pm_time_entries (company_id, resource_id, schedule_id, clock_in, clock_out, break_minutes, status, source)
     select $1, $2, s.id, ($3 || 'T14:00:00Z')::timestamptz, ($3 || 'T14:00:00Z')::timestamptz + make_interval(mins => $4::int), $6, $5, 'manual'
       from public.project_schedules s where s.estimate_id = $7`, [w.company, resource, day, Math.round(hours * 60), status, breakMin, est]);
  const labor = () => as<{ r: Row }>(w.owner, "select public.fin_job_timesheet_labor($1) as r", [job]).then((x) => x.r);
  const actual = async (u = w.owner) => (await rows(u, "select coalesce(sum(actual), 0)::text as a from public.fin_job_budget_v where job_id = $1 and cost_type = 'labor'", [job]))[0].a as string;
  const pl = (basis: string) => as<{ r: Row }>(w.owner, "select public.fin_report_pl($1, $2, '2026-11-01', '2026-11-30') as r", [w.book, basis]).then((x) => (x.r.rows as Row[]).filter((r) => r.dir === "cost" && r.type === "labor"));

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_fin_timesheet_labor"));
    w = await setupWorld(pool);
    as = asFn(pool); rows = rowsFn(pool);
    const bid = await wonBid(pool, w.owner, w.company, { title: "Deck", total: "10000.00" });
    est = bid.id;
    job = (await as<{ r: Row }>(w.owner, "select public.fin_job_open($1, $2) as r", [bid.id, bid.v1])).r.jobId;
    await pool.query(`insert into public.project_schedules (estimate_id, user_id, company_id, name, status, source_snapshot, calendar, start_date)
      values ($1, $2, $3, 'Deck', 'active', '{}'::jsonb, '{"workdays":[1,2,3,4,5],"holidays":[],"timezone":"America/Chicago"}'::jsonb, '2026-11-02')`, [est, w.owner, w.company]);
    worker = (await pool.query("insert into public.pm_resources (company_id, kind, name) values ($1, 'staff', 'Cris') returning id", [w.company])).rows[0].id;
    noRate = (await pool.query("insert into public.pm_resources (company_id, kind, name) values ($1, 'staff', 'Dana') returning id", [w.company])).rows[0].id;
    await pool.query("insert into public.pm_employee_profiles (resource_id, hourly_cost) values ($1, 32.50), ($2, null)", [worker, noRate]);
  }, 120_000);
  afterAll(async () => { await drop?.(); });

  it("costs approved hours at the hourly rate on the job's labor code; pending and no-rate hours don't count", async () => {
    const before = Number(await actual());
    await entry(worker, "2026-11-03", 8.5, "approved", 30);   // 8 h x 32.50 = 260.00
    await entry(worker, "2026-11-04", 4, "pending");
    await entry(noRate, "2026-11-04", 6);
    expect(Number(await actual()) - before).toBe(260);
    const l = await labor();
    expect(l).toMatchObject({ counted: true, hours: "14.00", amount: "260.00", uncostedHours: "6.00", workers: ["Dana"] });
    const code = (await pool.query("select cc.cost_type, cc.trade_slug from public.fin_timesheet_labor_v t join public.fin_cost_codes cc on cc.id = t.cost_code_id where t.resource_id = $1", [worker]));
    // The view is owner-rights but filtered to the caller; as superuser (no auth uid) nothing passes the filter.
    expect(code.rowCount).toBe(0);
    const mine = await rows(w.owner, "select cc.cost_type, cc.trade_slug from public.fin_timesheet_labor_v t join public.fin_cost_codes cc on cc.id = t.cost_code_id where t.resource_id = $1", [worker]);
    expect(mine[0]).toMatchObject({ cost_type: "labor", trade_slug: "decks" });
  });

  it("shows on the billed P&L as labor, not on the cash P&L", async () => {
    expect((await pl("billed")).reduce((s, r) => s + Number(r.amount), 0)).toBeGreaterThanOrEqual(260);
    const drill = await rows(w.owner, "select source, amount::text, party from public.fin_report_entries_v where book_id = $1 and source = 'time_entry'", [w.book]);
    expect(drill).toEqual([{ source: "time_entry", amount: "260.00", party: "Cris" }]);
    expect(await rows(w.owner, "select 1 from public.fin_report_entries_v where book_id = $1 and source = 'time_entry' and basis = 'cash'", [w.book])).toHaveLength(0);
  });

  it("other companies never see it; only financial managers can turn it off", async () => {
    expect(await rows(w.rival, "select * from public.fin_timesheet_labor_v")).toHaveLength(0);
    expect(await fails(as(w.viewer, "select public.fin_set_timesheet_labor($1, false)", [w.book]))).toMatch(/forbidden/);
    await as(w.owner, "select public.fin_set_timesheet_labor($1, false)", [w.book]);
    expect((await labor()).counted).toBe(false);
    expect(await rows(w.owner, "select 1 from public.fin_report_entries_v where source = 'time_entry'")).toHaveLength(0);
    expect(await rows(w.owner, "select 1 from public.fin_job_costs_v where source = 'time_entry'")).toHaveLength(0);
    await as(w.owner, "select public.fin_set_timesheet_labor($1, true)", [w.book]);
    expect((await pool.query("select action from public.fin_audit_log where action = 'book.timesheet_labor'")).rowCount).toBe(2);
  });

  it("rollback restores the earlier views and re-apply works", async () => {
    await pool.query(readFileSync("docs/financials/rollback_20270103001000.sql", "utf8"));
    expect((await pool.query("select to_regclass('public.fin_timesheet_labor_v') as v")).rows[0].v).toBeNull();
    expect((await pool.query("select count(*)::int as n from public.fin_job_costs_v")).rows[0].n).toBeGreaterThanOrEqual(0);
    await pool.query(readFileSync("supabase/migrations/20270103001000_fin_timesheet_labor.sql", "utf8"));
    await pool.query(readFileSync("supabase/migrations/20270103001000_fin_timesheet_labor.sql", "utf8"));
    expect((await labor()).amount).toBe("260.00");
  });
});
