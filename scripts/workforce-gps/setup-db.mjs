// Throwaway database for the GPS time tracking browser walk: TEST DATA ONLY, never production.
// Applies every migration to a fresh local database and seeds one synthetic company (owner = the walk user) with a
// W-2 crew member who has a login, an employee without one, a subcontractor, a business address in the Company
// profile, two projects with addresses and labor lines, and approved time from earlier this week.
// GPS tracking itself starts OFF; the walk sets it up through the screens. Settings are pre-saved (not enabled)
// with a 1-minute dwell and 2-minute exit grace so the walk doesn't have to wait long.
//   scripts/test-db.sh start
//   export RADAR_PG_URL=$(node scripts/workforce-gps/setup-db.mjs)
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { Client } = require("pg");
const ROOT = path.resolve(import.meta.dirname, "../..");
const ADMIN = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/postgres";
const NAME = "b2b_walk_workforce_gps";
const ME = "00000000-0000-4000-8000-000000000001", CREW = "00000000-0000-4000-8000-0000000000c2";

const a = new Client({ connectionString: ADMIN }); await a.connect();
await a.query(`drop database if exists ${NAME} with (force)`); await a.query(`create database ${NAME}`); await a.end();
const url = ADMIN.replace(/\/[^/]*$/, `/${NAME}`);
const c = new Client({ connectionString: url }); await c.connect();
await c.query(readFileSync(path.join(ROOT, "supabase/tests/00_stub_supabase.sql"), "utf8"));
for (const f of readdirSync(path.join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort()) await c.query(readFileSync(path.join(ROOT, "supabase/migrations", f), "utf8"));
await c.query(`insert into auth.users (id, email, email_confirmed_at) values ($1, 'ux-test@built2bid.test', now()), ($2, 'cris@summit.test', now())`, [ME, CREW]);
const as = async (u, sql, args = []) => {
  await c.query("begin"); await c.query("set local role authenticated"); await c.query("select set_config('request.jwt.claim.sub', $1, true)", [u]);
  try { const r = await c.query(sql, args); await c.query("commit"); return r.rows[0]; } catch (e) { await c.query("rollback"); throw e; }
};
const company = (await c.query("select public.create_company($1, 'Summit Exteriors LLC') as id", [ME])).rows[0].id;
await c.query("insert into public.company_members (company_id, user_id, role, display_name) values ($1, $2, 'viewer', 'Cris Carpenter')", [company, CREW]);
await c.query(`select public.apply_subscription_update(p_user_id => $1::uuid, p_stripe_customer_id => 'cus_walk', p_stripe_subscription_id => 'sub_walk',
  p_status => 'active', p_plan => 'enterprise', p_price_id => 'price_x', p_current_period_end => '2099-01-01'::timestamptz, p_cancel_at_period_end => false,
  p_canceled_at => null, p_ended_at => null, p_event_created => now() - interval '1 minute', p_company_id => $2::uuid, p_seat_quantity => 5)`, [ME, company]);
await c.query("insert into public.business_profiles (user_id, company_name, address) values ($1, 'Summit Exteriors LLC', '250 Marquette Ave, Minneapolis, MN 55401') on conflict (user_id) do update set address = excluded.address", [ME]);

const save = (p) => as(ME, "select public.pm_resource_save($1) as id", [p]).then((r) => r.id);
await save({ kind: "staff", name: "Alex Rivera", linkedUserId: ME, trades: ["general"] });
const cris = await save({ kind: "staff", name: "Cris Carpenter", linkedUserId: CREW, trades: ["framing", "decking"], phone: "555-0103" });
const jose = await save({ kind: "staff", name: "Jose Martinez", trades: ["framing"] });
await save({ kind: "subcontractor", name: "Bright Electric LLC", trades: ["electrical"], email: "office@bright.test" });
await as(ME, "select public.pm_employee_profile_save($1, $2)", [cris, { title: "Lead carpenter", payType: "hourly", hourlyCost: "42.50" }]);
await as(ME, "select public.pm_employee_profile_save($1, $2)", [jose, { title: "Carpenter", payType: "hourly", hourlyCost: "34.00" }]);

const CAL = { workdays: [1, 2, 3, 4, 5], holidays: [], timezone: "America/Chicago" };
const proj = async (title, customer, address, laborHours, rate) => {
  const est = (await c.query("insert into public.estimates (user_id, company_id, title, customer_name, project_address, trades) values ($1, $2, $3, $4, $5, '{decking}') returning id", [ME, company, title, customer, address])).rows[0].id;
  const g = (await c.query("insert into public.estimate_groups (estimate_id, user_id, name) values ($1, $2, 'Work') returning id", [est, ME])).rows[0].id;
  await c.query("insert into public.estimate_items (estimate_id, group_id, user_id, name, cost_type, quantity, unit, unit_cost) values ($1, $2, $3, 'Carpentry labor', 'labor', $4, 'hours', $5), ($1, $2, $3, 'Lumber package', 'material', 1, 'each', 4200)", [est, g, ME, laborHours, rate]);
  return (await c.query("insert into public.project_schedules (estimate_id, user_id, company_id, name, status, source_snapshot, calendar, start_date) values ($1, $2, $3, $4, 'active', $6, $5, current_date - 10) returning id", [est, ME, company, title, CAL,
    { estimate: { id: est, title, number: "EST-1", customerName: customer, projectAddress: address }, trades: ["decking"], version: null, sections: [] }])).rows[0].id;
};
const deck = await proj("Backyard deck – Rivera", "Rivera", "4120 Bryant Ave S, Minneapolis, MN 55409", 40, 45);
await proj("Kitchen remodel – Ortiz", "Ortiz", "88 Elm St, Edina, MN 55424", 120, 45);

// Approved time earlier this week on the deck (manual clock), so the labor panel and payroll have history.
const monday = (await c.query("select (date_trunc('week', (now() at time zone 'America/Chicago')))::date::text as d")).rows[0].d;
for (const [res, off] of [[cris, 0], [jose, 0], [cris, 1]]) {
  await c.query(`insert into public.pm_time_entries (company_id, resource_id, schedule_id, clock_in, clock_out, break_minutes, status, source, decided_at, decided_by)
    values ($1, $2, $3, ($4::date + $5::int + time '07:00') at time zone 'America/Chicago', ($4::date + $5::int + time '15:30') at time zone 'America/Chicago', 30, 'approved', 'clock', now(), $6)`,
    [company, res, deck, monday, off, ME]);
}
// Settings saved but OFF; short dwell / grace so the walk is quick; any time of day so the walk works whenever it runs.
await as(ME, "select public.pm_gps_settings_save($1)", [{ entryDwellMin: 1, exitGraceMin: 2, startRule: "any_time", exitAction: "ask" }]);

await c.end();
process.stdout.write(url + "\n");
