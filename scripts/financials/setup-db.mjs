// Throwaway database for the Financials (Phase 1) browser walk: TEST DATA ONLY, never production.
// Applies every migration (including the fin_* ones) to a fresh local database and seeds one company with
// four people (owner, bookkeeper, project manager, view only), the Financials add-on, and three won bids:
//   * Backyard deck – Rivera: $40,000, schedule 30/20/50, job NOT opened yet (the walk opens it)
//   * Kitchen remodel – Ortiz: opened, deposit invoiced + paid, start confirmed, costs and a commitment
//   * Roof replacement – Lee: opened, deposit invoiced with a past due date (exception reason), unpaid
//   scripts/test-db.sh start
//   export RADAR_PG_URL=$(node scripts/financials/setup-db.mjs)
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
const require = createRequire(import.meta.url);
const { Client } = require("pg");
const ROOT = path.resolve(import.meta.dirname, "../..");
const ADMIN = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/postgres";
const NAME = "b2b_walk_financials";
export const ME = "00000000-0000-4000-8000-000000000001";
export const BK = "00000000-0000-4000-8000-0000000000b1";
export const PM = "00000000-0000-4000-8000-0000000000b2";
export const VIEW = "00000000-0000-4000-8000-0000000000b3";

const a = new Client({ connectionString: ADMIN }); await a.connect();
await a.query(`drop database if exists ${NAME} with (force)`); await a.query(`create database ${NAME}`); await a.end();
const url = ADMIN.replace(/\/[^/]*$/, `/${NAME}`);
const c = new Client({ connectionString: url }); await c.connect();
await c.query(readFileSync(path.join(ROOT, "supabase/tests/00_stub_supabase.sql"), "utf8"));
for (const f of readdirSync(path.join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort()) {
  await c.query(readFileSync(path.join(ROOT, "supabase/migrations", f), "utf8"));
}
await c.query(readFileSync(path.join(ROOT, "supabase/seed.sql"), "utf8"));   // reference data: the trade catalog
await c.query(`insert into auth.users (id, email, email_confirmed_at) values ($1, 'ux-test@built2bid.test', now()), ($2, 'books@summit.test', now()),
  ($3, 'pm@summit.test', now()), ($4, 'viewer@summit.test', now())`, [ME, BK, PM, VIEW]);

const as = async (u, sql, args = []) => {
  await c.query("begin"); await c.query("set local role authenticated"); await c.query("select set_config('request.jwt.claim.sub', $1, true)", [u]);
  try { const r = await c.query(sql, args); await c.query("commit"); return r.rows[0]; } catch (e) { await c.query("rollback"); throw e; }
};
const company = (await c.query("select public.create_company($1, 'Summit Exteriors LLC') as id", [ME])).rows[0].id;
await c.query("insert into public.company_members (company_id, user_id, role, display_name) values ($1, $2, 'manager', 'Bo Books'), ($1, $3, 'manager', 'Pam Manager'), ($1, $4, 'viewer', 'Vic Viewer')", [company, BK, PM, VIEW]);
// Bookkeeper and PM: grant the company bid-view permission so they can open jobs (the job page follows estimate RLS).
await c.query("update public.company_members set permissions_granted = array['view_company_bids'] where company_id = $1 and user_id = any($2)", [company, [BK, PM]]);
await c.query(`select public.apply_subscription_update(p_user_id => $1::uuid, p_stripe_customer_id => 'cus_walk', p_stripe_subscription_id => 'sub_walk',
  p_status => 'active', p_plan => 'enterprise', p_price_id => 'price_x', p_current_period_end => '2099-01-01'::timestamptz, p_cancel_at_period_end => false,
  p_canceled_at => null, p_ended_at => null, p_event_created => now() - interval '1 minute', p_company_id => $2::uuid, p_seat_quantity => 6)`, [ME, company]);
await c.query("select public.apply_fin_update('sub_walk', true, 1, now())");
const book = (await as(ME, "select public.fin_my_book() as b")).b;
await as(ME, "select public.fin_seat_assign($1, $2, 'bookkeeper')", [book, BK]);
await as(ME, "select public.fin_seat_assign($1, $2, 'project_manager')", [book, PM]);
await as(ME, "select public.fin_seat_assign($1, $2, 'view_only')", [book, VIEW]);

async function wonBid({ title, customer, email, total, schedule, trades, items }) {
  const cust = (await c.query("insert into public.customers (user_id, company_id, name, email, project_address) values ($1, $2, $3, $4, '1 Main St') returning id", [ME, company, customer, email])).rows[0].id;
  const id = (await c.query("insert into public.estimates (user_id, company_id, title, customer_name, customer_email, trades, tax_rate) values ($1, $2, $3, $4, $5, $6, 0) returning id",
    [ME, company, title, customer, email, trades])).rows[0].id;
  await c.query("update public.estimates set customer_id = $2 where id = $1", [id, cust]);
  const snapshot = { schema: 1, estimate: { trades, groups: trades.map((t, i) => ({ id: `g${i}`, name: t, trade: t })), items } };
  const proposal = { paymentSchedule: schedule.map(([label, percent]) => ({ label, percent, amount: "$0.00" })) };
  const v = (await c.query(`insert into public.estimate_versions (estimate_id, user_id, version_number, content_hash, snapshot, proposal, total_cost, subtotal, tax, total)
     values ($1, $2, 1, $3, $4, $5, 0, $6, 0, $6) returning id`, [id, ME, createHash("sha256").update(id).digest("hex"), snapshot, proposal, total])).rows[0].id;
  await c.query("begin"); await c.query("select set_config('app.stage_change', 'on', true)");
  await c.query("update public.estimates set pipeline_stage = 'won' where id = $1", [id]); await c.query("commit");
  return { id, v, cust };
}

const deck = await wonBid({ title: "Backyard deck – Rivera", customer: "Pat Rivera", email: "pat@example.test", total: "40000.00", trades: ["decks"],
  schedule: [["Deposit", "30"], ["Project start", "20"], ["Completion", "50"]],
  items: [{ id: "i1", groupId: "g0", costType: "material", quantity: "1", unitCost: "14000" }, { id: "i2", groupId: "g0", costType: "labor", quantity: "1", unitCost: "9000" }, { id: "i3", groupId: "g0", costType: "subcontractor", quantity: "1", unitCost: "4500" }] });
const kitchen = await wonBid({ title: "Kitchen remodel – Ortiz", customer: "Sam Ortiz", email: "sam@example.test", total: "62500.00", trades: ["kitchens", "electrical"],
  schedule: [["Deposit", "10"], ["Start of work", "40"], ["Final completion", "50"]],
  items: [{ id: "k1", groupId: "g0", costType: "material", quantity: "1", unitCost: "21000" }, { id: "k2", groupId: "g0", costType: "labor", quantity: "1", unitCost: "14000" }, { id: "k3", groupId: "g1", costType: "subcontractor", quantity: "1", unitCost: "6500" }] });
const roof = await wonBid({ title: "Roof replacement – Lee", customer: "Morgan Lee", email: "morgan@example.test", total: "18900.00", trades: ["roofing"],
  schedule: [["Deposit", "25"], ["Completion", "75"]],
  items: [{ id: "r1", groupId: "g0", costType: "material", quantity: "1", unitCost: "7200" }, { id: "r2", groupId: "g0", costType: "labor", quantity: "1", unitCost: "5100" }] });

// Kitchen: deposit invoiced and paid (verified), start confirmed, an approved expense, a commitment.
const kj = (await as(ME, "select public.fin_job_open($1, $2) as r", [kitchen.id, kitchen.v])).r.jobId;
const kms = (await c.query("select id from public.fin_payment_milestones where job_id = $1 order by seq", [kj])).rows;
const kinv = (await as(ME, "select public.fin_invoice_save($1, $2) as r", [kj, { milestoneId: kms[0].id }])).r.invoiceId;
await as(ME, "select public.fin_invoice_issue($1, null, null)", [kinv]);
const kpay = (await as(ME, "select public.fin_payment_record($1, $2) as r", [book, { jobId: kj, method: "check", reference: "2041", amount: "6250.00", allocations: [{ invoiceId: kinv, amount: "6250.00" }] }])).r.paymentId;
await as(ME, "select public.fin_payment_verify($1)", [kpay]);
await as(ME, "select public.fin_milestone_trigger_record($1, $2)", [kj, { triggerKind: "project_start_confirmed", milestoneId: kms[1].id }]);
const code = async (like) => (await c.query("select id from public.fin_cost_codes where book_id = $1 and code like $2 order by code limit 1", [book, like])).rows[0]?.id;
const matCode = await code("kitchens:material") ?? await code("%:material");
const subCode = await code("electrical:subcontractor") ?? await code("%:subcontractor");
const exp = (await as(ME, "select public.fin_expense_record($1, $2) as r", [book, { jobId: kj, amount: "1840.25", description: "Cabinet hardware and fasteners", payee: "Supply House", costCodeId: matCode }])).r.expenseId;
await as(ME, "select public.fin_expense_decide($1, 'approve', null)", [exp]);
await as(BK, "select public.fin_expense_record($1, $2) as r", [book, { jobId: kj, amount: "212.40", description: "Dump fees", payee: "County landfill" }]);
const vendor = (await as(ME, "select public.fin_vendor_save($1, $2) as v", [book, { name: "Bright Line Electric", kind: "subcontractor" }])).v;
if (subCode) await as(ME, "select public.fin_commitment_create($1, $2)", [book, { jobId: kj, vendorId: vendor, costCodeId: subCode, title: "Kitchen rewiring", amount: "6800.00" }]);

// Roof: deposit invoiced with a past due date (exception reason) and unpaid -> past due.
const rj = (await as(ME, "select public.fin_job_open($1, $2) as r", [roof.id, roof.v])).r.jobId;
const rms = (await c.query("select id from public.fin_payment_milestones where job_id = $1 order by seq", [rj])).rows;
const rinv = (await as(ME, "select public.fin_invoice_save($1, $2) as r", [rj, { milestoneId: rms[0].id, dueDate: new Date(Date.now() - 12 * 864e5).toISOString().slice(0, 10) }])).r.invoiceId;
await as(ME, "select public.fin_invoice_issue($1, $2, $3)", [rinv, new Date(Date.now() - 26 * 864e5).toISOString().slice(0, 10), "Customer asked for net 14 on the deposit"]);
await as(ME, "select public.fin_alerts_refresh($1)", [book]);

await c.end();
console.error(JSON.stringify({ book, company, deck: deck.id, kitchen: kitchen.id, roof: roof.id }));
console.log(url);
