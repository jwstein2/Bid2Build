// Throwaway database for the V8.3 worker hub browser walk: TEST DATA ONLY, never production.
// Builds the GPS walk database (scripts/workforce-gps/setup-db.mjs) and adds: HR pay rates, W-2 classification,
// a confirmed shop location, a project assignment for Cris all week (07:00-15:30) and an approved shop entry.
// Projected pay stays OFF (the default); the walk turns it on through the screens.
//   scripts/test-db.sh start
//   export RADAR_PG_URL=$(node scripts/worker-hub/setup-db.mjs)
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import path from "node:path";
const require = createRequire(import.meta.url);
const { Client } = require("pg");
const ROOT = path.resolve(import.meta.dirname, "../..");
const url = execFileSync("node", [path.join(ROOT, "scripts/workforce-gps/setup-db.mjs")], { encoding: "utf8" }).trim();
const ME = "00000000-0000-4000-8000-000000000001";
const c = new Client({ connectionString: url }); await c.connect();
const as = async (u, sql, args = []) => {
  await c.query("begin"); await c.query("set local role authenticated"); await c.query("select set_config('request.jwt.claim.sub', $1, true)", [u]);
  try { const r = await c.query(sql, args); await c.query("commit"); return r.rows[0]; } catch (e) { await c.query("rollback"); throw e; }
};
const res = Object.fromEntries((await c.query("select name, id from public.pm_resources")).rows.map((r) => [r.name, r.id]));
const cris = res["Cris Carpenter"], jose = res["Jose Martinez"];
await c.query("insert into public.pm_employee_hr (resource_id, pay_rate, pay_rate_unit, flsa_status) values ($1, 28, 'hour', 'non_exempt'), ($2, 25, 'hour', 'non_exempt') on conflict (resource_id) do update set pay_rate = excluded.pay_rate", [cris, jose]);
await as(ME, "select public.pm_worker_classification_set($1, 'w2')", [cris]);
const shop = (await as(ME, "select public.pm_work_location_save($1) as id", [{ kind: "business", name: "Main shop", address: "250 Marquette Ave, Minneapolis, MN 55401", lat: 44.97776, lng: -93.26501, confirm: true, everyone: true }])).id;
const deck = (await c.query("select id from public.project_schedules where name like 'Backyard deck%'")).rows[0].id;
const monday = (await c.query("select (date_trunc('week', (now() at time zone 'America/Chicago')))::date::text as d")).rows[0].d;
const sec = (await c.query("insert into public.schedule_tasks (schedule_id, kind, source_group_id, name, planned_start, planned_end, duration_days) values ($1, 'section', gen_random_uuid(), 'Framing', $2, $2::date + 4, 5) returning id", [deck, monday])).rows[0].id;
await c.query(`insert into public.schedule_tasks (schedule_id, parent_id, kind, source_group_id, name, planned_start, planned_end, duration_days, resource_id, assignment_start_time, assignment_end_time, notes)
  values ($1, $2, 'item', gen_random_uuid(), 'Frame and deck', $3, $3::date + 4, 5, $4, '07:00', '15:30', 'Set posts, frame joists, lay composite decking. Bring the post-hole auger.')`, [deck, sec, monday, cris]);
await c.query(`insert into public.pm_time_entries (company_id, resource_id, location_id, clock_in, clock_out, break_minutes, status, source, work_category, decided_at, decided_by)
  select company_id, $1, $2, ($3::date + 2 + time '13:00') at time zone 'America/Chicago', ($3::date + 2 + time '16:00') at time zone 'America/Chicago', 0, 'approved', 'manual', 'shop', now(), $4
  from public.pm_resources where id = $1`, [cris, shop, monday, ME]);
await c.end();
process.stdout.write(url + "\n");
