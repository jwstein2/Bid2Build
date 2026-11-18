/**
 * Financials "today" follows the book's time zone (20261211001000). A deposit due on signing is never
 * overdue the same local day, whatever the hour in UTC; the milestone status view agrees with the alerts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Pool } from "pg";
import { dbAvailable, freshDb, type Row } from "./harness";
import { asFn, rowsFn, setupWorld, wonBid, type World } from "./fin-fixtures";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
let w: World;

// The two extremes: 14 hours ahead of UTC and 11 behind. One of them is on another calendar day from UTC
// at almost any hour, which is exactly when the old current_date comparison went wrong.
const ZONES = ["Pacific/Kiritimati", "Pacific/Pago_Pago", "America/Chicago"];
const localDate = (tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

d("financial dates use the book's time zone (database)", () => {
  let as: ReturnType<typeof asFn>;
  let rows: ReturnType<typeof rowsFn>;
  let job: string;
  const setZone = (tz: string) => pool.query("update public.fin_books set timezone = $2 where id = $1", [w.book, tz]);
  const openAlerts = async () => {
    await as(w.owner, "select public.fin_alerts_refresh($1)", [w.book]);
    return (await rows(w.owner, "select kind from public.fin_alerts where job_id = $1 and status = 'open' order by kind", [job])).map((r: Row) => r.kind);
  };

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_fin_local_dates"));
    w = await setupWorld(pool);
    as = asFn(pool); rows = rowsFn(pool);
    const b = await wonBid(pool, w.owner, w.company, { title: "Local dates" });
    job = (await as<{ r: Row }>(w.owner, "select public.fin_job_open($1, $2) as r", [b.id, b.v1])).r.jobId;
  }, 120_000);
  afterAll(async () => { await drop?.(); });

  it("a deposit due today (book time) is not overdue in any time zone", async () => {
    for (const tz of ZONES) {
      await setZone(tz);
      expect((await as<{ t: string }>(w.owner, "select public.fin_book_today($1)::text as t", [w.book])).t).toBe(localDate(tz));
      // Re-open the deposit's due date in this zone: it is due the day the agreement was signed, which is today here.
      const ms = (await rows(w.owner, "select due_on::text, overdue, days_overdue from public.fin_milestone_status_v where job_id = $1 and is_deposit", [job]))[0];
      expect(ms).toMatchObject({ due_on: localDate(tz), overdue: false, days_overdue: 0 });
      expect(await openAlerts()).toEqual(["deposit_not_invoiced"]);
    }
  });

  it("it becomes overdue the next local day, by exactly one day", async () => {
    await setZone("America/Chicago");
    await pool.query("alter table public.fin_contract_snapshots disable trigger fin_contract_snapshots_immutable");
    await pool.query("update public.fin_contract_snapshots set created_at = now() - interval '1 day' where job_id = $1", [job]);
    await pool.query("alter table public.fin_contract_snapshots enable trigger fin_contract_snapshots_immutable");
    const ms = (await rows(w.owner, "select overdue, days_overdue from public.fin_milestone_status_v where job_id = $1 and is_deposit", [job]))[0];
    expect(ms).toMatchObject({ overdue: true, days_overdue: 1 });
    expect(await openAlerts()).toEqual(["deposit_not_invoiced", "deposit_overdue"]);
  });

  it("rollback restores the old functions and the migration re-applies", async () => {
    await pool.query(readFileSync("docs/financials/rollback_20261211001000.sql", "utf8"));
    expect((await pool.query("select to_regprocedure('public.fin_book_today(uuid)') as f")).rows[0].f).toBeNull();
    await as(w.owner, "select public.fin_alerts_refresh($1)", [w.book]);
    const up = readFileSync("supabase/migrations/20261211001000_fin_book_local_dates.sql", "utf8");
    await pool.query(up); await pool.query(up);
    expect(await openAlerts()).toEqual(["deposit_not_invoiced", "deposit_overdue"]);
  });
});
