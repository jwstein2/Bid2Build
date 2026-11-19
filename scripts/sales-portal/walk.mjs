// Sales Portal + Sales Hub browser walk against a REAL database (migration, functions, RLS):
//   scripts/test-db.sh start
//   export RADAR_PG_URL=$(node scripts/sales-portal/setup-db.mjs)
//   MOCK_ADMIN=1 PG_REST_PREFIXES=sales_,admin_sales_ node scripts/ux-audit/mock-supabase.mjs &
//   NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=x SUPABASE_SECRET_KEY=x npm run build && npx next start -p 3000 &
//   node scripts/sales-portal/walk.mjs <screenshotDir>
// The walk flips the mock's database user with /__as: empty = service role (owner pages), the rep id = the rep's own session.
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");
const { Client } = require("pg");

const out = process.argv[2] ?? "sales-portal-shots";
fs.mkdirSync(out, { recursive: true });
const BASE = "http://localhost:3000", MOCK = "http://localhost:54321";
const ME = "00000000-0000-4000-8000-000000000001";
const db = new Client({ connectionString: process.env.RADAR_PG_URL }); await db.connect();
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const results = [];
const check = (n, ok, d = "") => { results.push({ n, ok: Boolean(ok), d }); console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? " — " + d : ""}`); };
const as = (user) => fetch(`${MOCK}/__as?user=${user}`);

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
const go = async (p, path) => { await p.goto(BASE + path, { waitUntil: "load" }); await p.waitForTimeout(600); };
const shot = (p, name) => p.screenshot({ path: `${out}/${name}.png`, fullPage: true });
const noHScroll = async (p) => (await p.evaluate(() => document.documentElement.scrollWidth)) <= 390 + 1;

// ---------- Rep portal (rep's own session) ----------
await as(ME);
for (const kind of ["desktop", "phone"]) {
  const p = await newPage(kind);
  await go(p, "/sales");
  check(`R1 ${kind}: overview greets the rep`, await p.getByRole("heading", { name: /Welcome, Jordan/ }).isVisible());
  const link = await p.getByLabel("Your referral link").inputValue();
  check(`R2 ${kind}: permanent link shown`, link.endsWith("/s/JRDN4K7P"), link);
  check(`R3 ${kind}: no contractor sidebar`, (await p.locator("aside").count()) === 0);
  if (kind === "phone") check("R4 phone: no horizontal scroll", await noHScroll(p));
  await p.getByRole("button", { name: "QR code" }).click();
  check(`R5 ${kind}: QR code renders`, await p.getByRole("img", { name: /QR code/ }).locator("svg").isVisible());
  await shot(p, `01-rep-overview-${kind}`);
  await go(p, "/sales/customers");
  const rows = await p.locator("tbody tr").count();
  check(`R6 ${kind}: only Jordan's 7 customers`, rows === 7, String(rows));
  check(`R7 ${kind}: other rep's customer hidden`, !(await p.getByText("Harbor Plumbing").count()));
  await shot(p, `02-rep-customers-${kind}`);
  await go(p, "/sales/commissions");
  check(`R8 ${kind}: paid statement visible`, await p.getByText("Paid", { exact: true }).first().isVisible());
  check(`R9 ${kind}: year 2 anniversary line at upgraded rate`, await p.getByText("Year 2 anniversary").first().isVisible());
  await shot(p, `03-rep-commissions-${kind}`);
  await p.context().close();
}


// ---------- CRM (Phase 2) ----------
{
  const p = await newPage("desktop");
  await go(p, "/sales/leads");
  check("C1 rep sees only their 5 leads", (await p.locator("tbody tr").count()) === 5);
  check("C2 overdue task flagged", await p.getByText(/^Overdue/).first().isVisible());
  await shot(p, "06-rep-leads-desktop");
  await p.getByRole("table").getByRole("link", { name: "Twin Cities Roofing" }).click();
  await p.waitForURL(/\/sales\/leads\//);
  await p.getByLabel("What happened").fill("Ran the demo; sending recap.");
  await p.getByRole("button", { name: "Log it" }).click();
  await p.getByText("Logged.").waitFor();
  check("C3 activity logged", await p.getByText("Ran the demo; sending recap.").isVisible());
  await shot(p, "07-rep-lead-detail");
  // Duplicate of another rep's lead is refused.
  await go(p, "/sales/leads");
  await p.getByLabel("Business name").fill("Harbor Plumbing");
  await p.getByLabel("ZIP").fill("55802");
  await p.getByRole("button", { name: "Add lead" }).click();
  await p.waitForURL(/err=/);
  check("C4 duplicate warning names the business", await p.getByText(/Possible duplicate: Harbor Plumbing/).isVisible());
  await p.context().close();
  const m = await newPage("phone");
  await go(m, "/sales/leads");
  check("C5 phone: leads page has no horizontal scroll", await noHScroll(m));
  await shot(m, "06-rep-leads-phone");
  await m.context().close();
}

// A signed-in person who isn't sales staff.
await q("update public.sales_reps set user_id = null, email = 'jordan@sales.example' where code = 'JRDN4K7P'");
{
  const p = await newPage("desktop");
  await go(p, "/sales");
  check("R10 non-staff account sees the not-on-team page", await p.getByRole("heading", { name: "This account isn't on the sales team" }).isVisible());
  await shot(p, "04-not-sales-staff");
  await p.context().close();
}
await q("update public.sales_reps set user_id = $1, email = 'ux-test@built2bid.test' where code = 'JRDN4K7P'", [ME]);
{
  const p = await newPage("desktop");
  await p.context().clearCookies();
  await go(p, "/sales/login");
  check("R11 sales login page", (await p.locator("h1").first().textContent())?.includes("Built2Bid sales portal") && await p.getByText("Use the email address the Built2Bid owner invited").isVisible());
  await shot(p, "05-sales-login");
  // Rep link: sets the cookie, redirects home with sales UTM tags.
  const res = await p.request.get(`${BASE}/s/MAYA7Q2R`, { maxRedirects: 0 });
  check("R12 /s/<code> redirects with UTM tags", res.status() === 307 && /utm_source=sales_rep/.test(res.headers().location ?? ""), res.headers().location);
  check("R13 /s/<code> sets the rep cookie", /b2b_rep=MAYA7Q2R\./.test(res.headers()["set-cookie"] ?? ""));
  await p.context().close();
}

// ---------- Owner Sales Hub (service role) ----------
await as("");
for (const kind of ["desktop", "phone"]) {
  const p = await newPage(kind);
  await go(p, "/admin/sales-hub");
  if (kind === "phone") check("H8 phone: no horizontal page scroll", await noHScroll(p));
  check(`H1 ${kind}: hub overview`, await p.getByRole("heading", { name: "Sales Hub" }).isVisible());
  if (kind === "desktop") check("H2 policy banner until confirmed", await p.getByText("Commission policy not confirmed yet").isVisible());
  await shot(p, `10-hub-overview-${kind}`);
  if (kind === "phone") { await p.context().close(); continue; }
  for (const [tab, n] of [["team", "11-hub-team"], ["customers", "12-hub-customers"], ["commissions", "13-hub-commissions"], ["statements", "14-hub-statements"], ["policy", "15-hub-policy"]]) {
    await go(p, `/admin/sales-hub?tab=${tab}`);
    await shot(p, n);
  }
  // Approve is blocked until the policy is confirmed.
  await go(p, "/admin/sales-hub?tab=statements");
  check("H3 approve disabled before policy confirmation", await p.getByRole("button", { name: /^Approve/ }).first().isDisabled());
  // Confirm the policy.
  await go(p, "/admin/sales-hub?tab=policy");
  await p.getByLabel(/I confirm these are the commission rules/).check();
  await p.getByRole("button", { name: "Save policy" }).click();
  await p.waitForURL(/ok=/);
  check("H4 policy confirmed", (await q("select policy_confirmed_at from public.sales_settings"))[0].policy_confirmed_at !== null);
  // Approve + record a payout.
  await go(p, "/admin/sales-hub?tab=statements");
  await p.getByRole("button", { name: /^Approve/ }).first().click();
  await p.getByText("Statement approved.").waitFor();
  await p.getByRole("button", { name: "Record payout" }).first().click();
  await p.getByText("Payout recorded.").waitFor();
  const paid = await q("select count(*)::int as n from public.sales_payouts");
  check("H5 approve + record payout", paid[0].n === 2, String(paid[0].n));
  await shot(p, "16-hub-after-payout");
  // Leads tab: assign the unassigned lead to Jordan.
  await go(p, "/admin/sales-hub?tab=leads");
  await p.getByLabel("Select Ridge Drywall").check();
  await p.locator("form").filter({ has: p.getByRole("button", { name: "Assign selected" }) }).getByLabel("Assign selected to").selectOption({ label: "Jordan Ellis" });
  await p.getByRole("button", { name: "Assign selected" }).click();
  await p.getByText("1 lead updated.").waitFor();
  check("H9 owner assigns a lead", (await q("select r.full_name from public.sales_leads l join public.sales_reps r on r.id = l.assigned_rep where l.company_name = 'Ridge Drywall'"))[0]?.full_name === "Jordan Ellis");
  await shot(p, "18-hub-leads");
  // Add a rep.
  await go(p, "/admin/sales-hub?tab=team");
  const form = p.locator("form").first();
  await form.getByLabel("Full name").fill("Casey Nguyen");
  await form.getByLabel("Email").fill("casey@sales.example");
  await form.getByRole("button", { name: "Add to sales team" }).click();
  await p.waitForURL(/ok=/);
  check("H6 new rep invited with a code", (await q("select code from public.sales_reps where email = 'casey@sales.example' and status = 'invited'")).length === 1);
  // Reassign needs a reason.
  await go(p, "/admin/sales-hub?tab=customers");
  const af = p.locator("form").first();
  await af.getByLabel("Customer account email").fill("mike@ridgelineelectric.biz");
  await af.getByLabel("Rep").selectOption({ label: "Maya Torres" });
  await af.getByLabel("Reason").fill("Territory change");
  await af.getByRole("button", { name: "Assign" }).click();
  await p.waitForURL(/ok=/);
  check("H7 reassigned with history", (await q("select count(*)::int as n from public.sales_attribution_history where action = 'reassigned'"))[0].n === 1);
  await shot(p, "17-hub-after-reassign");
  await p.context().close();
}

check("Z no page errors", errors.length === 0, errors.join(" | "));
fs.writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2));
console.log(`${results.filter((r) => r.ok).length}/${results.length} passed`);
await browser.close(); await db.end();
process.exit(results.every((r) => r.ok) ? 0 : 1);
