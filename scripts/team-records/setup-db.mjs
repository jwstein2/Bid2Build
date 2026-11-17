// Throwaway database for the Team records browser walk: TEST DATA ONLY, never production.
// Applies every migration to a fresh local database and seeds one company (owner = the walk user) with
// a manager and a crew member, staff / subcontractor entries, two projects, a supplier with a price import,
// time entries this week, and Financials bill payments for the 1099 totals.
//   scripts/test-db.sh start
//   export RADAR_PG_URL=$(node scripts/team-records/setup-db.mjs)
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { Client } = require("pg");
const ROOT = path.resolve(import.meta.dirname, "../..");
const ADMIN = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/postgres";
const NAME = "b2b_walk_team_records";
const ME = "00000000-0000-4000-8000-000000000001", MGR = "00000000-0000-4000-8000-0000000000c1", CREW = "00000000-0000-4000-8000-0000000000c2";

const a = new Client({ connectionString: ADMIN }); await a.connect();
await a.query(`drop database if exists ${NAME} with (force)`); await a.query(`create database ${NAME}`); await a.end();
const url = ADMIN.replace(/\/[^/]*$/, `/${NAME}`);
const c = new Client({ connectionString: url }); await c.connect();
await c.query(readFileSync(path.join(ROOT, "supabase/tests/00_stub_supabase.sql"), "utf8"));
for (const f of readdirSync(path.join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort()) await c.query(readFileSync(path.join(ROOT, "supabase/migrations", f), "utf8"));
await c.query(`insert into auth.users (id, email, email_confirmed_at) values ($1, 'ux-test@built2bid.test', now()), ($2, 'pam@summit.test', now()), ($3, 'cris@summit.test', now())`, [ME, MGR, CREW]);
const as = async (u, sql, args = []) => {
  await c.query("begin"); await c.query("set local role authenticated"); await c.query("select set_config('request.jwt.claim.sub', $1, true)", [u]);
  try { const r = await c.query(sql, args); await c.query("commit"); return r.rows[0]; } catch (e) { await c.query("rollback"); throw e; }
};
const company = (await c.query("select public.create_company($1, 'Summit Exteriors LLC') as id", [ME])).rows[0].id;
await c.query("insert into public.company_members (company_id, user_id, role, display_name) values ($1, $2, 'manager', 'Pam Manager'), ($1, $3, 'viewer', 'Cris Carpenter')", [company, MGR, CREW]);
await c.query(`select public.apply_subscription_update(p_user_id => $1::uuid, p_stripe_customer_id => 'cus_walk', p_stripe_subscription_id => 'sub_walk',
  p_status => 'active', p_plan => 'enterprise', p_price_id => 'price_x', p_current_period_end => '2099-01-01'::timestamptz, p_cancel_at_period_end => false,
  p_canceled_at => null, p_ended_at => null, p_event_created => now() - interval '1 minute', p_company_id => $2::uuid, p_seat_quantity => 5)`, [ME, company]);

const save = (p) => as(ME, "select public.pm_resource_save($1) as id", [p]).then((r) => r.id);
const meStaff = await save({ kind: "staff", name: "Alex Rivera", linkedUserId: ME, trades: ["general"], phone: "555-0101" });
const pam = await save({ kind: "staff", name: "Pam Manager", linkedUserId: MGR, trades: ["roofing"] });
const cris = await save({ kind: "staff", name: "Cris Carpenter", linkedUserId: CREW, trades: ["framing", "decking"], phone: "555-0103" });
const jose = await save({ kind: "staff", name: "Jose Martinez", trades: ["framing"] });
const stone = await save({ kind: "subcontractor", name: "Stone Works LLC", contactName: "Sam", trades: ["countertops"], email: "sam@stoneworks.test", phone: "555-0110" });
const bright = await save({ kind: "subcontractor", name: "Bright Electric", trades: ["electrical"], email: "office@bright.test" });
await save({ kind: "subcontractor", name: "Ace Gutters", trades: ["gutters"] });
await save({ kind: "crew", name: "Crew A", members: [cris, jose], capacity: 1 });
await as(ME, "select public.pm_employee_profile_save($1, $2)", [cris, { title: "Lead carpenter", payType: "hourly", hourlyCost: "42.50", hireDate: "2024-04-01", emergencyName: "Dana Carpenter", emergencyPhone: "555-0199" }]);
await as(ME, "select public.pm_employee_profile_save($1, $2)", [jose, { title: "Carpenter", payType: "hourly", hourlyCost: "34.00" }]);
await as(ME, "select public.pm_employee_profile_save($1, $2)", [meStaff, { title: "Owner", payType: "owner" }]);

// Two projects (schedules) in the company.
const CAL = { workdays: [1, 2, 3, 4, 5], holidays: [], timezone: "America/Chicago" };
const proj = async (title, customer) => {
  const est = (await c.query("insert into public.estimates (user_id, company_id, title, customer_name, trades) values ($1, $2, $3, $4, '{decking}') returning id", [ME, company, title, customer])).rows[0].id;
  return (await c.query("insert into public.project_schedules (estimate_id, user_id, company_id, name, status, source_snapshot, calendar, start_date) values ($1, $2, $3, $4, 'active', '{}'::jsonb, $5, current_date - 10) returning id", [est, ME, company, title, CAL])).rows[0].id;
};
const deck = await proj("Backyard deck – Rivera", "Rivera");
const kitchen = await proj("Kitchen remodel – Ortiz", "Ortiz");

// Time this week (Mon..), Chicago hours. Approved Mon/Tue for Cris, pending Wed, Jose manual + rejected.
const monday = (await c.query("select (date_trunc('week', (now() at time zone 'America/Chicago')))::date as d")).rows[0].d.toISOString().slice(0, 10);
const at = (dayOff, hh) => `(${`'${monday}'`}::date + ${dayOff} + time '${hh}') at time zone 'America/Chicago'`;
const entry = (res, sched, d, from, to, brk, status, src = "clock", lat = null) => c.query(
  `insert into public.pm_time_entries (company_id, resource_id, schedule_id, clock_in, clock_out, break_minutes, status, source, in_lat, in_lng, in_accuracy_m, decided_at, decided_by)
   values ($1, $2, $3, ${at(d, from)}, ${at(d, to)}, $4, $5, $6, $7, $8, $9, case when $5 in ('approved','rejected') then now() end, case when $5 in ('approved','rejected') then $10::uuid end)`,
  [company, res, sched, brk, status, src, lat, lat ? -93.2650 : null, lat ? 14 : null, ME]);
await entry(cris, deck, 0, "07:00", "15:30", 30, "approved", "clock", 44.9778);
await entry(cris, deck, 1, "07:00", "15:30", 30, "approved");
await entry(cris, kitchen, 2, "07:15", "16:00", 30, "pending");
await entry(jose, deck, 0, "07:00", "15:30", 30, "approved", "manual");
await entry(jose, deck, 1, "07:00", "12:00", 0, "rejected");
await c.query("update public.pm_time_entries set decision_note = 'Clock-out looks wrong, please check' where status = 'rejected'");
await entry(pam, kitchen, 1, "08:00", "17:00", 60, "pending");

// Suppliers + an import under the same name (links automatically) and items priced from it.
const abc = (await as(ME, "select public.pm_supplier_save($1) as id", [{ name: "ABC Supply – Springfield", accountNumber: "100-2245", repName: "Jordan Lee", phone: "555-0150", email: "jordan@abcsupply.test", website: "abcsupply.com", trades: ["roofing", "siding"] }])).id;
await as(ME, "select public.pm_supplier_save($1) as id", [{ name: "Lakeside Lumber", repName: "Morgan", trades: ["decking", "framing"] }]);
const imp = (await c.query("insert into public.price_imports (user_id, supplier_name, file_name, rows_total, created_count, updated_count, unchanged_count, created_at) values ($1, 'ABC Supply – Springfield', 'abc-november.xlsx', 3, 1, 2, 0, now() - interval '3 days') returning id", [ME])).rows[0].id;
await c.query("update public.price_imports set supplier_id = $1 where id = $2", [abc, imp]);
for (const [n, u, cost, sku] of [["Architectural shingles", "bundle", 38.75, "GAF-HDZ"], ["Synthetic underlayment", "roll", 96.5, "UDL-10"], ["Drip edge 10'", "each", 7.2, "DE-10"]]) {
  await c.query("insert into public.saved_items (user_id, name, unit, unit_cost, supplier_name, supplier_sku, price_source, price_effective_on) values ($1, $2, $3, $4, 'ABC Supply – Springfield', $5, 'supplier_import', current_date - 3)", [ME, n, u, cost, sku]);
}

// Sub records: Stone Works has W-9 + expired GL + agreement; Bright Electric has workers' comp expiring soon.
await as(ME, "select public.pm_sub_tax_save($1, $2)", [stone, { legalName: "Stone Works LLC", taxClassification: "llc_p", tinType: "ein", tinLast4: "6789", address: "12 Quarry Rd, Springfield", w9SignedOn: "2026-01-05" }]);
await as(ME, "select public.pm_sub_document_add($1, $2)", [stone, { docType: "coi_general_liability", issuer: "Acme Mutual", policyNumber: "GL-55821", coverageAmount: "1000000", effectiveOn: "2025-10-01", expiresOn: "2026-10-01" }]);
await as(ME, "select public.pm_sub_document_add($1, $2)", [stone, { docType: "subcontract_agreement", title: "2026 subcontract agreement", signedOn: "2026-01-10" }]);
await as(ME, "select public.pm_sub_document_add($1, $2)", [bright, { docType: "workers_comp", issuer: "State Fund", policyNumber: "WC-1102", effectiveOn: "2025-12-01", expiresOn: (await c.query("select (current_date + 12)::text as d")).rows[0].d }]);

// Financials: bill payments this year for the 1099 totals.
const book = (await c.query("insert into public.fin_books (company_id, name) values ($1, 'Summit Exteriors LLC') returning id", [company])).rows[0].id;
const vStone = (await c.query("insert into public.fin_vendors (book_id, resource_id, name, kind) values ($1, $2, 'Stone Works LLC', 'subcontractor') returning id", [book, stone])).rows[0].id;
const vBright = (await c.query("insert into public.fin_vendors (book_id, resource_id, name, kind) values ($1, $2, 'Bright Electric', 'subcontractor') returning id", [book, bright])).rows[0].id;
const vLoose = (await c.query("insert into public.fin_vendors (book_id, name, kind) values ($1, 'Mike''s Drywall', 'subcontractor') returning id", [book])).rows[0].id;
let n = 0;
const bill = async (v, total, pays) => {
  n++;
  const b = (await c.query("insert into public.fin_vendor_bills (book_id, vendor_id, vendor_invoice_number, seq, number, bill_date, due_date, total, status, approved_at) values ($1, $2, $3, $4, $5, '2026-02-01', '2026-12-31', $6, 'approved', now()) returning id", [book, v, `INV-${n}`, n, `BILL-${n}`, total])).rows[0].id;
  for (const [on, amt, m] of pays) await c.query("insert into public.fin_bill_payments (book_id, bill_id, paid_on, method, amount) values ($1, $2, $3, $4, $5)", [book, b, on, m, amt]);
};
await bill(vStone, 14200, [["2026-03-15", 6000, "check"], ["2026-06-01", 6200, "ach"], ["2026-07-01", 2000, "card"]]);
await bill(vBright, 3400, [["2026-05-20", 3400, "check"]]);
await bill(vLoose, 1500, [["2026-09-10", 1500, "check"]]);

await c.end();
process.stdout.write(url + "\n");
