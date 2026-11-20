// Compensation V3 browser check (rep dashboard, How you get paid, owner Compensation & payroll), desktop + phone.
//   scripts/test-db.sh start
//   export RADAR_PG_URL=$(node scripts/sales-portal/setup-db.mjs)
//   MOCK_ADMIN=1 PG_REST_PREFIXES=sales_,admin_sales_ node scripts/ux-audit/mock-supabase.mjs &
//   NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=x SUPABASE_SECRET_KEY=x npm run build && npx next start -p 3000 &
//   node scripts/sales-portal/comp-v3-walk.mjs <screenshotDir>
// Seeds isolated test data into the throwaway walk database only (112 qualifying test customers for the mock rep).
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");
const { Client } = require("pg");

const out = process.argv[2] ?? "comp-v3-shots";
fs.mkdirSync(out, { recursive: true });
const BASE = "http://localhost:3000", MOCK = "http://localhost:54321";
const ME = "00000000-0000-4000-8000-000000000001";
const db = new Client({ connectionString: process.env.RADAR_PG_URL }); await db.connect();
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const results = [];
const check = (n, ok, d = "") => { results.push({ n, ok: Boolean(ok), d }); console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? " — " + d : ""}`); };
const as = (user, claim = "") => fetch(`${MOCK}/__as?user=${user}&claim=${claim}`);

// --- Seed: 112 qualifying customers (a few annual), awards through 100, one approved + one disputed.
const jordan = (await q("select id from public.sales_reps where code = 'JRDN4K7P'"))[0].id;
const owner = (await q("select id from auth.users where email = 'owner@built2bid.org'"))[0].id;
await q(`with g as (select i, now() - interval '400 days' + make_interval(hours => i * 50) as t from generate_series(1, 112) i),
  u as (insert into auth.users (email, email_confirmed_at) select 'v3walk' || i || '@co.test', now() from g returning id, email),
  a as (insert into public.sales_attributions (user_id, rep_id, source, sub_status, plan, basis_cents, basis_detail, first_paid_at, first_paid_month, last_paid_at, mrr_list_cents)
        select u.id, $1, 'manual', case when g.i % 9 = 0 then 'canceled' else 'active' end, case when g.i % 7 = 0 then 'annual' else 'monthly' end, 1999,
          jsonb_build_object('lines', jsonb_build_array(jsonb_build_object('kind', 'plan', 'months', case when g.i % 7 = 0 then 12 else 1 end))),
          g.t, public.sales_month_of(g.t), g.t + interval '31 days', case when g.i % 7 = 0 then 1658 else 1999 end
        from u join g on u.email = 'v3walk' || g.i || '@co.test' returning user_id, first_paid_at, plan)
 insert into public.sales_revenue (invoice_id, rep_id, user_id, gross_cents, revenue_cents, paid_at, period_months, billing_reason)
 select 'v3walk_' || a.user_id || '_' || k, $1, a.user_id, case when a.plan = 'annual' then 19900 else 1999 end, case when a.plan = 'annual' then 19900 else 1999 end,
   a.first_paid_at + make_interval(days => 31 * (k - 1)), case when a.plan = 'annual' then 12 else 1 end, case k when 1 then 'subscription_create' else 'subscription_cycle' end
 from a cross join generate_series(1, 2) k where k = 1 or a.plan <> 'annual'`, [jordan]);
await q("update public.sales_settings set milestone_model = 'v3_active_mrr', milestone_qualification = 'second_cycle', milestone_every = 25, milestone_min_cents = 0 where id");
await q("select public.sales_milestones_evaluate(null, now())");
const a10 = (await q("select id from public.sales_milestone_awards where rep_id = $1 and milestone = 10", [jordan]))[0]?.id;
const a25 = (await q("select id from public.sales_milestone_awards where rep_id = $1 and milestone = 25", [jordan]))[0]?.id;
if (a10) { await q("update public.sales_milestone_awards set opened_at = now() where id = $1", [a10]); await q("select public.admin_sales_milestone_approve($1, $2)", [owner, a10]); }
if (a25) { await q("update public.sales_milestone_awards set opened_at = now() where id = $1", [a25]); await q("insert into public.sales_milestone_disputes (award_id, rep_id, note) values ($1, $2, 'Two customers from March seem missing')", [a25, jordan]); }
await q("update public.sales_milestone_awards set opened_at = now() where rep_id = $1 and opened_at is null and milestone < 100", [jordan]);
await q("update public.sales_reps set work_state = 'MN', work_locality = 'Rochester' where id = $1", [jordan]);
await q("select public.admin_sales_jurisdiction_save($1, 'randomized_activity_bonus', 'MN', null, 'not_approved', null, null, current_date, null, 'Awaiting counsel review')", [owner]);
const comp = (await q("select public.sales_compensation_for($1) as c", [jordan]))[0].c;
check("seed: qualifying customers and next milestone", comp.qualifying >= 100 && comp.next?.at > comp.qualifying, `${comp.qualifying} qualifying, next ${comp.next?.at}, MRR ${comp.qualifying_mrr_cents}`);

// --- Browser
const browser = await chromium.launch();
const errors = [];
async function newPage(kind) {
  const ctx = await browser.newContext(kind === "phone" ? { ...devices["iPhone 13"] } : { viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
  const user = { id: ME, aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
  const b64u = (s) => Buffer.from(s).toString("base64url");
  const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: ME, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
  const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600 * 24 * 365 * 50, expires_at: 4102444800, user };
  await ctx.addCookies([{ name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" }]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${page.url()}: ${e}`));
  return page;
}
const go = async (p, path) => { await p.goto(BASE + path, { waitUntil: "load" }); await p.waitForTimeout(700); };
const noHScroll = async (p) => (await p.evaluate(() => document.documentElement.scrollWidth)) <= (p.viewportSize()?.width ?? 390) + 1;

await as(ME); // the rep's own session
for (const kind of ["desktop", "phone"]) {
  const p = await newPage(kind);
  await go(p, "/sales");
  const dlg = p.locator("dialog[open] button:has-text('Close')");
  if (await dlg.count()) await dlg.first().click();
  const comp = p.locator("#comp-h");
  check(`${kind}: rep dashboard shows Your compensation`, await comp.count() === 1);
  const txt = await p.locator("section[aria-labelledby='comp-h']").innerText().catch(() => "");
  for (const label of ["Total attributed customers", "Qualifying milestone customers", "Active paying customers", "Qualifying active MRR", "Current milestone", "Next milestone", "Remaining", "Standard subscription commissions", "One-time milestone bonuses", "Payout history", "estimate at today"]) {
    check(`${kind}: shows "${label}"`, txt.includes(label));
  }
  check(`${kind}: progress bar`, await p.locator("section[aria-labelledby='comp-h'] [role=progressbar]").count() === 1);
  if (kind === "phone") check("phone: no horizontal scroll on dashboard", await noHScroll(p));
  await comp.scrollIntoViewIfNeeded();
  await p.locator("section[aria-labelledby='comp-h']").screenshot({ path: `${out}/01-rep-compensation-${kind}.png` });
  await go(p, "/sales/how-you-get-paid");
  const how = await p.locator("main").innerText();
  check(`${kind}: how-you-get-paid has the $96 example`, how.includes("$96.00"));
  check(`${kind}: how-you-get-paid shows program availability`, how.includes("Activity bonus drawing"));
  if (kind === "phone") check("phone: no horizontal scroll on how-you-get-paid", await noHScroll(p));
  await p.screenshot({ path: `${out}/02-how-you-get-paid-${kind}.png`, fullPage: true });
  await p.context().close();
}

await as("", ME); // service role carrying the owner's id (the mock user is also a platform owner)
for (const kind of ["desktop", "phone"]) {
  const p = await newPage(kind);
  await go(p, "/sales/admin?tab=compensation");
  const main = await p.locator("main").innerText();
  for (const label of ["Milestone rules in force", "Payroll export", "Compensation by month", "Representatives", "Milestone awards and their calculations", "Disputes and adjustments", "Incentive programs and jurisdictions", "Randomized activity bonus"]) {
    check(`${kind}: owner tab shows "${label}"`, main.includes(label));
  }
  check(`${kind}: award records verified`, (await p.locator("text=Record verified").count()) > 0 && (await p.locator("text=Record changed").count()) === 0);
  if (kind === "phone") check("phone: no page-level horizontal scroll on owner tab", await noHScroll(p));
  await p.screenshot({ path: `${out}/03-owner-compensation-${kind}.png`, fullPage: true });
  const csv = await p.request.get(`${BASE}/sales/admin/payroll/export?month=${new Date().toISOString().slice(0, 7)}`);
  check(`${kind}: payroll CSV downloads`, csv.ok() && (await csv.text()).startsWith("Rep,Email"), String(csv.status()));
  await p.context().close();
}
check("no page errors", errors.length === 0, errors.join(" | "));
fs.writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2));
await browser.close(); await db.end();
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
