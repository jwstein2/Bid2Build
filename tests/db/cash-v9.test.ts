/**
 * V9 cash-flow forecasting (20270217001000), against the real SQL:
 *   - settings: only financial config holders save; other companies can't read them
 *   - milestone progress rules: only for work-based milestones; confirming below the threshold fails; confirming at it
 *     records the milestone's own trigger once (the existing status view says ready_to_invoice); a second confirm fails
 *   - alerts: server-only sync, no repeat for an unchanged condition, a changed condition re-opens, cleared ones resolve
 *   - labor sums: costed by hourly cost, never per person; other companies are refused
 *   - the rollback removes only V9 objects and the migration re-applies
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { applyMigration, dbAvailable, freshDb, type Row } from "./harness";
import { asFn, fails, rowsFn, setupWorld, wonBid, type World } from "./fin-fixtures";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
let w: World;

d("V9 cash forecasting (database)", () => {
  let as: ReturnType<typeof asFn>;
  let rows: ReturnType<typeof rowsFn>;
  let job: string;
  let ms: Row[];

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_cash_v9"));
    w = await setupWorld(pool);
    as = asFn(pool); rows = rowsFn(pool);
    await as(w.owner, "select public.fin_seat_assign($1, $2, 'bookkeeper')", [w.book, w.bk]);
    await as(w.owner, "select public.fin_seat_assign($1, $2, 'sales_rep')", [w.book, w.rep]);
    const est = await wonBid(pool, w.owner, w.company, { title: "Kitchen", total: "100000.00", tax: "0.00",
      schedule: [{ label: "Deposit", percent: "30" }, { label: "At 30% complete", percent: "30" }, { label: "Completion", percent: "40" }] });
    job = (await as<{ r: Row }>(w.owner, "select public.fin_job_open($1, $2) as r", [est.id, est.v1])).r.jobId;
    ms = await rows(w.owner, "select id, trigger_kind, amount from public.fin_payment_milestones where job_id = $1 order by seq", [job]);
  }, 120_000);
  afterAll(async () => { if (drop) await drop(); });

  it("settings: owner saves, a sales rep can't, another company can't read them", async () => {
    await as(w.owner, "select public.fin_cash_settings_save($1, $2)", [w.book, { minCash: "15000", collectionDays: 5, collectionBasis: "issue", benchmark: { material: 30, subcontractor: 25 } }]);
    const s = (await pool.query("select * from public.fin_cash_settings where book_id = $1", [w.book])).rows[0];
    expect(Number(s.min_cash)).toBe(15000);
    expect(s.collection_basis).toBe("issue");
    expect(await fails(as(w.rep, "select public.fin_cash_settings_save($1, $2)", [w.book, { minCash: "1" }]))).toMatch(/forbidden|read_only/);
    expect(await fails(as(w.owner, "select public.fin_cash_settings_save($1, $2)", [w.book, { benchmark: { gold: 5 } }]))).toMatch(/bad_benchmark/);
    expect(await rows(w.rival, "select * from public.fin_cash_settings")).toHaveLength(0);
    expect(await fails(as(w.owner, "insert into public.fin_cash_settings (book_id) values ($1)", [w.rivalBook]))).toMatch(/permission denied/);
  });

  it("milestone progress rule: confirm at verified 30% records the trigger once", async () => {
    expect(ms.map((m) => m.trigger_kind)).toEqual(["agreement_signed", "phase_completed_verified", "final_completion_confirmed"]);
    expect(await fails(as(w.owner, "select public.fin_milestone_progress_rule_save($1, $2)", [ms[0].id, { threshold: 30 }]))).toMatch(/trigger_not_progress/);
    await as(w.owner, "select public.fin_milestone_progress_rule_save($1, $2)", [ms[1].id, { threshold: 30, method: "duration" }]);
    expect(await fails(as(w.rival, "select public.fin_milestone_progress_rule_save($1, $2)", [ms[1].id, { threshold: 10 }]))).toMatch(/forbidden/);
    expect(await fails(as(w.owner, "select public.fin_milestone_progress_confirm($1, $2)", [ms[1].id, { percent: 25 }]))).toMatch(/below_threshold/);
    expect(await fails(as(w.owner, "select public.fin_milestone_progress_confirm($1, $2)", [ms[2].id, { percent: 100 }]))).toMatch(/no_progress_rule/);
    const before = (await rows(w.owner, "select state from public.fin_milestone_status_v where milestone_id = $1", [ms[1].id]))[0];
    expect(before.state).toBe("not_triggered");
    await as(w.owner, "select public.fin_milestone_progress_confirm($1, $2)", [ms[1].id, { percent: 31, method: "duration" }]);
    const after = (await rows(w.owner, "select state from public.fin_milestone_status_v where milestone_id = $1", [ms[1].id]))[0];
    expect(after.state).toBe("ready_to_invoice");
    expect(await fails(as(w.owner, "select public.fin_milestone_progress_confirm($1, $2)", [ms[1].id, { percent: 40 }]))).toMatch(/already_triggered/);
    const trig = (await pool.query("select trigger_kind, note from public.fin_milestone_triggers where milestone_id = $1", [ms[1].id])).rows;
    expect(trig).toHaveLength(1);
    expect(trig[0].trigger_kind).toBe("phase_completed_verified");
    expect(trig[0].note).toMatch(/Verified progress 31/);
    const audit = (await pool.query("select action from public.fin_audit_log where book_id = $1 and action like 'milestone.progress%' order by id", [w.book])).rows.map((r) => r.action);
    expect(audit).toEqual(["milestone.progress_rule_saved", "milestone.progress_confirmed"]);
    // The signed milestone itself is unchanged.
    const m = (await pool.query("select amount, trigger_kind from public.fin_payment_milestones where id = $1", [ms[1].id])).rows[0];
    expect(Number(m.amount)).toBe(30000);
  });

  it("alerts: server-only sync, no repeats, re-open on change, auto-resolve when cleared", async () => {
    const alert = (fp: string) => [{ kind: "low_cash", key: "low_cash", fingerprint: fp, severity: "critical", title: "Cash falls below $15,000 on Dec 19", body: "", details: { date: "2026-12-19" }, actions: [] }];
    expect(await fails(as(w.owner, "select public.fin_cash_alerts_sync($1, $2::jsonb)", [w.book, JSON.stringify(alert("a"))]))).toMatch(/permission denied/);
    const first = (await pool.query("select public.fin_cash_alerts_sync($1, $2::jsonb) as ids", [w.book, JSON.stringify(alert("a"))])).rows[0].ids;
    expect(first).toHaveLength(1);
    const again = (await pool.query("select public.fin_cash_alerts_sync($1, $2::jsonb) as ids", [w.book, JSON.stringify(alert("a"))])).rows[0].ids;
    expect(again).toHaveLength(0);
    await as(w.owner, "select public.fin_cash_alert_set($1, $2)", [first[0], { status: "acknowledged" }]);
    expect((await pool.query("select public.fin_cash_alerts_sync($1, $2::jsonb) as ids", [w.book, JSON.stringify(alert("a"))])).rows[0].ids).toHaveLength(0);
    expect((await pool.query("select public.fin_cash_alerts_sync($1, $2::jsonb) as ids", [w.book, JSON.stringify(alert("b"))])).rows[0].ids).toHaveLength(1);
    expect(await fails(as(w.owner, "select public.fin_cash_alert_set($1, $2)", [first[0], { status: "snoozed" }]))).toMatch(/bad_snooze/);
    expect(await fails(as(w.rival, "select public.fin_cash_alert_set($1, $2)", [first[0], { status: "resolved" }]))).toMatch(/not_found|forbidden/);
    await pool.query("select public.fin_cash_alerts_sync($1, '[]'::jsonb)", [w.book]);
    const a = (await pool.query("select status, status_by from public.fin_cash_alerts where id = $1", [first[0]])).rows[0];
    expect(a.status).toBe("resolved");
    expect(a.status_by).toBeNull();
    expect((await pool.query("select public.fin_cash_alerts_sync($1, $2::jsonb) as ids", [w.book, JSON.stringify(alert("b"))])).rows[0].ids).toHaveLength(1);
    expect(await rows(w.owner, "select id from public.fin_cash_alerts")).toHaveLength(1);
    expect(await rows(w.rival, "select id from public.fin_cash_alerts")).toHaveLength(0);
    expect(await rows(w.rep, "select id from public.fin_cash_alerts")).toHaveLength(0);
  });

  it("labor sums: scheduled shop shift costed at hourly cost; other companies refused", async () => {
    const res = (await pool.query("insert into public.pm_resources (company_id, kind, name) values ($1, 'staff', 'Cris') returning id", [w.company])).rows[0].id;
    await pool.query("insert into public.pm_employee_profiles (resource_id, hourly_cost) values ($1, 30)", [res]);
    const day = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
    await pool.query("insert into public.pm_work_shifts (company_id, resource_id, work_date, start_time, end_time, unpaid_break_minutes, work_category) values ($1, $2, $3, '08:00', '16:30', 30, 'shop')", [w.company, res, day]);
    const r = (await as<{ r: Row }>(w.owner, "select public.fin_forecast_labor($1, current_date, current_date + 30) as r", [w.book])).r;
    const shop = (r.scheduled as Row[]).find((x) => x.category === "shop");
    expect(shop).toMatchObject({ date: day, hours: 8, cost: 240 });
    expect(JSON.stringify(r)).not.toMatch(/Cris|"30"|resourceId/);
    expect(await fails(as(w.rival, "select public.fin_forecast_labor($1, current_date, current_date + 30)", [w.book]))).toMatch(/forbidden/);
    expect(await fails(as(w.owner, "select public.fin_forecast_labor($1, current_date, current_date + 500)", [w.book]))).toMatch(/bad_range/);
  });

  it("commitment terms and forecast overrides need the right permission and keep history", async () => {
    const vendor = (await as<{ v: string }>(w.bk, "select public.fin_vendor_save($1, $2) as v", [w.book, { name: "Sparky Electric", kind: "subcontractor" }])).v;
    const cc = (await pool.query("select id from public.fin_cost_codes where book_id = $1 limit 1", [w.book])).rows[0].id;
    const c = (await as<{ r: Row }>(w.bk, "select public.fin_commitment_create($1, $2) as r", [w.book, { jobId: job, vendorId: vendor, costCodeId: cc, title: "Electrical", amount: "2300.00" }])).r;
    const cid = (c.commitmentId ?? c.id) as string;
    await as(w.bk, "select public.fin_commitment_terms_save($1, $2)", [cid, { payBasis: "completion", payDays: 7 }]);
    expect(await fails(as(w.rep, "select public.fin_commitment_terms_save($1, $2)", [cid, { payDays: 1 }]))).toMatch(/forbidden|read_only/);
    expect(await fails(as(w.owner, "select public.fin_forecast_override_save($1, $2)", [job, { costCodeId: cc, amount: "3100", reason: "" }]))).toMatch(/check|violates/);
    await as(w.owner, "select public.fin_forecast_override_save($1, $2)", [job, { costCodeId: cc, amount: "3100.00", reason: "Panel upgrade quoted" }]);
    await as(w.owner, "select public.fin_forecast_override_save($1, $2)", [job, { costCodeId: cc, amount: "3300.00", reason: "Revised quote" }]);
    const hist = (await pool.query("select amount, superseded_at from public.fin_forecast_overrides where job_id = $1 order by created_at", [job])).rows;
    expect(hist).toHaveLength(2);
    expect(hist[0].superseded_at).not.toBeNull();
    expect(hist[1].superseded_at).toBeNull();
  });

  it("rollback removes only V9 objects and the migration re-applies", async () => {
    const trigBefore = Number((await pool.query("select count(*) from public.fin_milestone_triggers")).rows[0].count);
    await pool.query(readFileSync("docs/cash-v9/rollback_20270217001000.sql", "utf8"));
    expect((await pool.query("select to_regclass('public.fin_cash_alerts') as t")).rows[0].t).toBeNull();
    expect(Number((await pool.query("select count(*) from public.fin_milestone_triggers")).rows[0].count)).toBe(trigBefore);
    await applyMigration(pool, "20270217001000_cash_v9.sql");
    await applyMigration(pool, "20270217001000_cash_v9.sql");
    expect((await pool.query("select to_regclass('public.fin_cash_alerts') as t")).rows[0].t).not.toBeNull();
  });
});
