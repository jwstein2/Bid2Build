// Throwaway database for the Sales Portal browser walk (real migration, functions and RLS).
//   scripts/test-db.sh start
//   export RADAR_PG_URL=$(node scripts/sales-portal/setup-db.mjs)
// The mock signed-in user (scripts/ux-audit/mock-supabase.mjs, id ...0001) is both a platform admin
// (for /admin/sales-hub, mock run without PG_REST_AS_USER) and an active sales rep (for /sales, mock run
// with PG_REST_AS_USER=<that id>), so one database serves both walks.
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { Client } = require("pg");
const ROOT = path.resolve(import.meta.dirname, "../..");
const ADMIN = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/postgres";
const NAME = "b2b_walk_sales_portal";
const ME = "00000000-0000-4000-8000-000000000001";

const a = new Client({ connectionString: ADMIN }); await a.connect();
await a.query(`drop database if exists ${NAME} with (force)`); await a.query(`create database ${NAME}`); await a.end();
const url = ADMIN.replace(/\/[^/]*$/, `/${NAME}`);
const c = new Client({ connectionString: url }); await c.connect();
await c.query(readFileSync(path.join(ROOT, "supabase/tests/00_stub_supabase.sql"), "utf8"));
for (const f of readdirSync(path.join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort()) {
  await c.query(readFileSync(path.join(ROOT, "supabase/migrations", f), "utf8"));
}
const q = (sql, p = []) => c.query(sql, p);
const one = async (sql, p = []) => Object.values((await q(sql, p)).rows[0])[0];

await q("insert into auth.users (id, email, email_confirmed_at, created_at) values ($1, 'ux-test@built2bid.test', now(), now() - interval '400 days')", [ME]);
const owner = await one("insert into auth.users (email, email_confirmed_at) values ('owner@built2bid.org', now()) returning id");
await q("insert into public.admin_roles (user_id, role) values ($1, 'admin'), ($2, 'admin')", [owner, ME]);

// Sales team: the mock user (Jordan) plus two others.
await q("insert into public.sales_reps (user_id, email, full_name, phone, role, status, code, payout_note, activated_at, created_at) values ($1, 'ux-test@built2bid.test', 'Jordan Ellis', '(555) 201-3344', 'rep', 'active', 'JRDN4K7P', 'ACH via payroll', now() - interval '420 days', now() - interval '430 days')", [ME]);
const maya = await one("insert into public.sales_reps (email, full_name, role, status, code, payout_note, activated_at) values ('maya@sales.example', 'Maya Torres', 'manager', 'active', 'MAYA7Q2R', 'Check', now() - interval '200 days') returning id");
await q("insert into public.sales_reps (email, full_name, role, status, code) values ('devon@sales.example', 'Devon Park', 'rep', 'invited', 'DVNP8M3X')");
const jordan = await one("select id from public.sales_reps where code = 'JRDN4K7P'");

const customers = [
  // email, business, rep, months since first paid (null = free), basis cents, sub status, has bid
  ["office@summitroofing.biz", "Summit Roofing Co.", jordan, 13, 4999, "active", true],
  ["hello@brightdeck.biz", "Bright Deck & Fence", jordan, 8, 1999, "active", true],
  ["jobs@clearviewpaint.biz", "Clearview Painting", jordan, 1, 1242, "active", true],
  ["team@northstarhvac.biz", "North Star HVAC", jordan, 0, 1999, "active", true],
  ["info@ironcladconcrete.biz", "Ironclad Concrete", jordan, 5, 1999, "canceled", true],
  ["owner@greenleafland.biz", "Greenleaf Landscaping", jordan, null, null, null, true],
  ["mike@ridgelineelectric.biz", "Ridgeline Electric", jordan, null, null, null, false],
  ["sales@harborplumbing.biz", "Harbor Plumbing", maya, 2, 7797, "active", true],
];
const monthStart = (back) => `(date_trunc('month', now() at time zone 'America/Chicago') - interval '${back} months')::date`;
for (const [email, biz, rep, back, basis, status, bid] of customers) {
  const u = await one("insert into auth.users (email, email_confirmed_at, created_at) values ($1, now(), now() - interval '1 day' * $2) returning id", [email, (back ?? 0) * 30 + 12]);
  await q("insert into public.business_profiles (user_id, company_name) values ($1, $2)", [u, biz]);
  if (bid) await q("insert into public.estimates (user_id, title) values ($1, 'Sample bid')", [u]);
  await q(`insert into public.sales_attributions (user_id, rep_id, source, code, attributed_at, plan, sub_status, basis_cents, first_paid_at, first_paid_month, last_paid_at)
           values ($1, $2, 'link', 'X', now() - interval '1 day' * $3, $4, $5, $6, ${back == null ? "null" : `${monthStart(back)} + interval '9 days'`}, ${back == null ? "null" : monthStart(back)}, ${back == null ? "null" : "now() - interval '5 days'"})`,
    [u, rep, (back ?? 0) * 30 + 10, back == null ? null : basis === 1242 ? "annual" : basis === 7797 ? "enterprise" : "monthly", status, basis]);
  if (status) await q("insert into public.subscriptions (stripe_subscription_id, user_id, stripe_customer_id, status, plan, source_event_created) values ($1, $2, $3, $4, $5, now())", [`sub_${u}`, u, `cus_${u}`, status, basis === 1242 ? "annual" : basis === 7797 ? "enterprise" : "monthly"]);
  if (back != null) {
    await q(`insert into public.sales_commissions (rep_id, user_id, year_no, period_month, amount_cents, status, stripe_invoice_id, created_at)
             values ($1, $2, 1, ${monthStart(back)}, $3, 'pending', $4, ${monthStart(back)} + interval '9 days')`, [rep, u, back >= 12 ? 1999 : basis, `in_${email.split("@")[0]}`]);
    if (back >= 12) await q(`insert into public.sales_commissions (rep_id, user_id, year_no, period_month, amount_cents, status, stripe_invoice_id) values ($1, $2, 2, ${monthStart(back - 12)}, $3, 'pending', $4)`, [rep, u, basis, `in2_${email.split("@")[0]}`]);
  }
  for (let v = 0; v < 6; v++) await q("insert into public.sales_link_events (rep_id, kind) values ($1, 'visit')", [rep]);
}
for (let v = 0; v < 40; v++) await q("insert into public.sales_link_events (rep_id, kind, created_at) values ($1, 'visit', now() - interval '1 day' * $2)", [jordan, v]);
// Close every past month, confirm the policy, approve + pay the oldest statement.
for (let back = 14; back >= 0; back--) await q(`select public.sales_close_month((${monthStart(back)} + interval '1 day')::timestamptz)`);
await q("update public.sales_settings set policy_confirmed_at = now(), policy_confirmed_by = $1", [owner]);
const oldest = await one("select id from public.sales_statements where rep_id = $1 order by period_month limit 1", [jordan]);
if (oldest) {
  await q("select public.admin_sales_statement_approve($1, $2)", [owner, oldest]);
  await q("select public.admin_sales_payout_record($1, $2, 'ach', 'PR-2207', current_date - 20)", [owner, oldest]);
}
await q("update public.sales_settings set policy_confirmed_at = null"); // show the owner banner in the walk
await c.end();
console.log(url);
