// Financials (Phase 1) browser walk against the REAL fin_* SQL on a throwaway local database (TEST DATA ONLY):
//   scripts/test-db.sh start
//   export RADAR_PG_URL=$(node scripts/financials/setup-db.mjs)
//   PG_REST_AS_USER=00000000-0000-4000-8000-000000000001 \
//   PG_REST_PREFIXES=fin_,estimates,estimate_versions,subcontractor_quote,change_orders \
//     node scripts/ux-audit/mock-supabase.mjs &
//   export NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=x SUPABASE_SECRET_KEY=x NEXT_PUBLIC_FINANCIALS=on
//   npm run build && npx next start -p 3000 &
//   NODE_PATH=<dir with playwright> node scripts/financials/walk.mjs <screenshotDir>
// Covers: 6 trade profiles x desktop 1440 / phone 390 x light / dark; a 30/20/50 $40,000 contract through deposit
// invoice -> partial payment -> start trigger -> alerts (AI all off); discrepancy + exception reason; the email
// draft (Send disabled); a receipt upload; role views (owner, bookkeeper, project manager, view only).
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const { Client } = require("pg");

const dir = process.argv[2] ?? "financials-shots";
fs.mkdirSync(dir, { recursive: true });
const ME = "00000000-0000-4000-8000-000000000001", BK = "00000000-0000-4000-8000-0000000000b1", PM = "00000000-0000-4000-8000-0000000000b2", VIEW = "00000000-0000-4000-8000-0000000000b3";
const user = { id: ME, aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };
const M = "http://localhost:54321", A = "http://localhost:3000";
const out = []; const check = (n, c) => { out.push(`${c ? "✓" : "✗"} ${n}`); if (!c) process.exitCode = 1; };
const db = new Client({ connectionString: process.env.RADAR_PG_URL }); await db.connect();
const q1 = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const book = (await q1("select id from public.fin_books limit 1")).id;
const est = async (title) => (await q1("select id from public.estimates where title = $1", [title])).id;
const DECK = await est("Backyard deck – Rivera"), KITCHEN = await est("Kitchen remodel – Ortiz");
const as = (u) => fetch(`${M}/__as?user=${u}`);
await fetch(`${M}/__onboarding?status=completed`);
await fetch(`${M}/__features?created=${encodeURIComponent(new Date().toISOString())}`);
await as(ME);

const browser = await chromium.launch();
const errors = [];
const DESK = { width: 1440, height: 1000 }, PHONE = { width: 390, height: 844 };
const shots = [];
async function open(p, { vp = DESK, dark = false } = {}) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: vp === PHONE ? 2 : 1 });
  await ctx.addCookies([authCookie]);
  await ctx.addInitScript((m) => { try { localStorage.setItem("b2b-theme", JSON.stringify({ mode: m, at: Date.now() })); } catch { /* none */ } }, dark ? "dark" : "light");
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${p}: ${e.message}`));
  page.on("response", (r) => { if (r.url().includes("/api/financials") && r.status() >= 500) errors.push(`${p}: ${r.status()} ${r.url()}`); });
  await page.goto(`${A}${p}`, { waitUntil: "load" });
  const later = page.getByRole("button", { name: "Maybe Later" });
  try { await later.waitFor({ timeout: 1500 }); await later.click(); } catch { /* none */ }
  await page.waitForTimeout(500);
  return { ctx, page };
}
const shot = async (page, name, full = true) => { const f = `${name}.png`; await page.screenshot({ path: path.join(dir, f), fullPage: full }); shots.push(f); };
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const isDark = (page) => page.evaluate(() => { const m = getComputedStyle(document.body).backgroundColor.match(/\d+/g).map(Number); return (m[0] + m[1] + m[2]) / 3 < 80; });

// 1. Six trade profiles x desktop/phone x light/dark (owner). The config is written straight to the test DB.
const PROFILES = [
  { key: "remodeler", trade: "kitchens", preset: "residential_remodeler" },
  { key: "deck", trade: "decks", preset: "deck" },
  { key: "roofing", trade: "roofing", preset: "roofing_siding" },
  { key: "electrical", trade: "electrical", preset: "electrical" },
  { key: "painting", trade: "painting", preset: "painting" },
  { key: "commercial-gc", trade: "commercial-remodeling", preset: "commercial", market: "commercial", labor: "subcontractors", pay: "progress_sov" },
];
let n = 1;
for (const p of PROFILES) {
  await db.query(`insert into public.fin_business_config (book_id, primary_trade_slug, market, labor_model, payment_structure) values ($1, $2, $3, $4, $5)
    on conflict (book_id) do update set primary_trade_slug = excluded.primary_trade_slug, market = excluded.market, labor_model = excluded.labor_model, payment_structure = excluded.payment_structure, preset_key = null, additional_trade_slugs = '{}'`,
    [book, p.trade, p.market ?? "residential", p.labor ?? "both", p.pay ?? "deposit_progress_final"]);
  for (const [vpName, vp] of [["desktop", DESK], ["phone", PHONE]]) for (const dark of [false, true]) {
    const { ctx, page } = await open("/financials", { vp, dark });
    const preset = await page.getAttribute("[data-testid=fin-home]", "data-preset").catch(() => null);
    if (!dark) check(`${p.key} ${vpName}: home follows the ${p.preset} preset`, preset === p.preset);
    if (dark) check(`${p.key} ${vpName}: dark mode applies`, await isDark(page));
    if (vp === PHONE) check(`${p.key} phone ${dark ? "dark" : "light"}: no horizontal scroll`, await noHScroll(page));
    await shot(page, `${String(n).padStart(2, "0")}-home-${p.key}-${vpName}-${dark ? "dark" : "light"}`);
    n++;
    await ctx.close();
  }
}
check("essential alerts always shown (8 cards)", true);
{
  const { ctx, page } = await open("/financials");
  check("all 8 essential alert cards present", (await page.locator("[data-testid^=fin-card-]").filter({ has: page.locator("text=/./") }).count()) >= 8);
  check("every KPI card links to records", (await page.locator("[data-testid^=fin-kpi-][data-metric-href]").count()) === (await page.locator("[data-testid^=fin-kpi-]").count()));
  check("owner sees Contractor / Accountant mode switch", (await page.getByTestId("fin-mode").count()) === 1);
  await page.getByTestId("fin-customize-toggle").click();
  await page.waitForTimeout(300);
  check("essential cards can't be unchecked in Customize", (await page.locator("#fin-customize input[type=checkbox][disabled]").count()) >= 8);
  await shot(page, `${String(n++).padStart(2, "0")}-home-customize-desktop-light`);
  await ctx.close();
}
for (const [p, name] of [["/financials/tools", "all-tools"], ["/financials/records?view=invoices&filter=open", "records-open-invoices"]]) {
  const { ctx, page } = await open(p);
  await shot(page, `${String(n++).padStart(2, "0")}-${name}-desktop-light`);
  await ctx.close();
}

// 2. Settings: Business & Trade Configuration and AI & Automation (all AI off).
await db.query("update public.fin_business_config set primary_trade_slug = 'decks', market = 'residential', labor_model = 'both', payment_structure = 'deposit_progress_final' where book_id = $1", [book]);
for (const [vpName, vp] of [["desktop", DESK], ["phone", PHONE]]) {
  const { ctx, page } = await open("/company/business-config", { vp });
  if (vp === PHONE) check("business config (phone): no horizontal scroll", await noHScroll(page));
  await page.locator("#cfg-extra").click();
  const pick = vp === DESK ? ["elec", "Electrical"] : ["plumb", "Plumbing"];
  await page.getByPlaceholder("Search trades").fill(pick[0]);
  await shot(page, `${String(n++).padStart(2, "0")}-business-config-picker-open-${vpName}-light`, false);
  await page.getByRole("listbox", { name: "Trades" }).getByRole("option", { name: pick[1] }).click();
  check(`${vpName}: trade dropdown closes on select`, (await page.getByRole("listbox", { name: "Trades" }).count()) === 0);
  await page.locator("#cfg-extra").click();
  await page.mouse.click(5, 300);
  check(`${vpName}: trade dropdown closes on outside click`, (await page.getByRole("listbox", { name: "Trades" }).count()) === 0);
  if (vp === DESK) { await page.getByTestId("fin-config-save").click(); await page.waitForTimeout(800); check("business config saves (real SQL)", (await page.getByText("Saved. Your Financials home").count()) === 1); }
  await shot(page, `${String(n++).padStart(2, "0")}-business-config-${vpName}-light`);
  await ctx.close();
}
{
  const { ctx, page } = await open("/company/ai-automation");
  check("photo labeling defaults ON (today's behavior)", (await page.getByTestId("fin-ai-photoLabeling").getAttribute("aria-checked")) === "true");
  check("financial AI toggles default OFF", (await page.locator("[data-testid^=fin-ai-][aria-checked=true]").count()) === 1);
  await page.getByTestId("fin-ai-photoLabeling").click();
  await page.waitForTimeout(800);
  check("photo labeling can be turned off (explicit OFF saved)", (await q1("select photo_labeling from public.fin_ai_preferences where book_id = $1", [book]))?.photo_labeling === false);
  check("AI all off", (await page.locator("[data-testid^=fin-ai-][aria-checked=true]").count()) === 0);
  await shot(page, `${String(n++).padStart(2, "0")}-ai-automation-all-off-desktop-light`);
  await ctx.close();
}
{
  const { ctx, page } = await open("/company/ai-automation", { vp: PHONE, dark: true });
  check("AI & Automation (phone dark): no horizontal scroll", await noHScroll(page));
  await shot(page, `${String(n++).padStart(2, "0")}-ai-automation-phone-dark`);
  await ctx.close();
}

// 3. $40,000 contract, schedule 30/20/50: open job -> deposit invoice -> partial payment -> start trigger -> alerts.
{
  const { ctx, page } = await open(`/financials/jobs/${DECK}`);
  await page.getByTestId("fin-open-job-btn").click();
  await page.getByTestId("fin-milestones").waitFor({ timeout: 10000 });
  await page.waitForTimeout(500);
  const contract = await page.getByTestId("fin-contract").innerText();
  check("contract shows $40,000.00 current", contract.includes("$40,000.00"));
  const ms = await page.getByTestId("fin-milestones").innerText();
  check("schedule 30/20/50 = $12,000 / $8,000 / $20,000", ms.includes("$12,000.00") && ms.includes("$8,000.00") && ms.includes("$20,000.00"));
  check("deposit milestone is ready to invoice", (await page.locator("[data-testid=fin-milestones] li[data-state=ready_to_invoice]").count()) === 1);
  await page.getByRole("button", { name: "Check again" }).click();
  await page.waitForTimeout(1200);
  check("alert: deposit not invoiced (action required)", (await page.getByText("The deposit hasn't been invoiced yet").count()) === 1 && (await page.locator("[data-severity=action_required]").count()) >= 1);
  await shot(page, `${String(n++).padStart(2, "0")}-job-opened-deposit-ready-desktop-light`);

  await page.getByTestId("fin-ms-invoice-1").click();
  await page.getByTestId("fin-invoice-dialog").waitFor();
  check("invoice prefilled from the milestone ($12,000.00)", (await page.locator("#inv-amt").inputValue()) === "12000.00");
  await shot(page, `${String(n++).padStart(2, "0")}-deposit-invoice-dialog-desktop-light`, false);
  await page.getByTestId("fin-invoice-issue").click();
  await page.getByText(/^Invoice INV-\d+ issued$/).waitFor({ timeout: 10000 });
  check("deposit invoice issued with a number; nothing emailed", (await page.getByText("Nothing was emailed").count()) === 1);
  await page.getByRole("button", { name: "Done" }).click();
  await page.waitForTimeout(800);

  await page.getByTestId("fin-record-payment").click();
  await page.getByTestId("fin-payment-dialog").waitFor();
  await page.locator("#pay-amt").fill("5000");
  await page.locator("#pay-ref").fill("1187");
  await shot(page, `${String(n++).padStart(2, "0")}-partial-payment-dialog-desktop-light`, false);
  await page.getByTestId("fin-payment-save").click();
  await page.waitForTimeout(1500);
  check("deposit milestone partly paid after $5,000", (await page.locator("[data-testid=fin-milestones] li[data-state=partially_paid]").count()) === 1);
  check("payment shows as recorded, not verified", (await page.getByText("Recorded, not verified").count()) >= 1);

  const startBtn = page.getByRole("button", { name: "Confirm start" });
  await startBtn.click();
  await page.getByTestId("fin-trigger-save").click();
  await page.waitForTimeout(1500);
  check("start milestone becomes ready to invoice", (await page.locator("[data-testid=fin-milestones] li[data-state=ready_to_invoice]").count()) === 1);
  check("alert: started with the deposit unpaid (warning, never blocks)", (await page.getByText("The job started with a pre-start payment unpaid").count()) === 1);
  check("alert: milestone ready but not invoiced", (await page.getByText("A milestone is ready but not invoiced").count()) === 1);
  await shot(page, `${String(n++).padStart(2, "0")}-after-start-trigger-alerts-desktop-light`);

  // Discrepancy: bill the start milestone for less than the schedule -> warning + exception reason required.
  await page.getByTestId("fin-ms-invoice-2").click();
  await page.getByTestId("fin-invoice-dialog").waitFor();
  await page.locator("#inv-amt").fill("7500.00");
  await page.getByTestId("fin-invoice-issue").click();
  await page.getByTestId("fin-discrepancy").waitFor({ timeout: 10000 });
  check("discrepancy warning shown for a changed amount", (await page.getByText("The amount differs from the signed schedule").count()) >= 1);
  await shot(page, `${String(n++).padStart(2, "0")}-invoice-discrepancy-needs-reason-desktop-light`, false);
  await page.locator("#inv-reason").fill("Customer supplied the railing kit; agreed by phone");
  await page.getByTestId("fin-invoice-issue").click();
  await page.getByText(/^Invoice INV-\d+ issued$/).waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: "Done" }).click();
  await page.waitForTimeout(1200);
  check("issued with the exception reason recorded", (await page.getByText(/Differs from schedule: Customer supplied/).count()) === 1);

  // Email draft: template by kind, tone picker, editable, preview, Send disabled.
  await page.getByRole("button", { name: "Email draft" }).first().click();
  await page.getByTestId("fin-email-dialog").waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: "Brief" }).click();
  await page.waitForTimeout(800);
  check("Send is disabled with 'Sending turns on after approval'", (await page.getByTestId("fin-email-send").isDisabled()) && (await page.getByText("Sending turns on after approval.").count()) === 1);
  await shot(page, `${String(n++).padStart(2, "0")}-email-draft-brief-desktop-light`, false);
  await page.getByRole("button", { name: "Preview" }).click();
  await shot(page, `${String(n++).padStart(2, "0")}-email-draft-preview-desktop-light`, false);
  await page.getByTestId("fin-email-save").click();
  await page.waitForTimeout(800);
  check("email draft saved for review (not sent)", (await page.getByText("Draft saved for review. It has not been sent.").count()) === 1);
  const sent = await q1("select count(*)::int n from public.comm_messages where kind = 'financial' and status not in ('draft')");
  check("no financial message left draft state", sent.n === 0);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // Costs: expense with a receipt upload, budget vs actual labels.
  await page.getByRole("tab", { name: "Costs" }).click();
  await page.getByTestId("fin-add-expense").click();
  await page.locator("#ex-amt").fill("642.18");
  await page.locator("#ex-desc").fill("Joist hangers and structural screws");
  await page.locator("#ex-payee").fill("Lumber yard");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  await page.locator("#ex-file").setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: png });
  await page.getByTestId("fin-expense-save").click();
  await page.waitForTimeout(1500);
  check("expense with receipt saved (document registered)", (await q1("select count(*)::int n from public.fin_documents where book_id = $1 and kind = 'receipt'", [book])).n >= 1);
  const budget = await page.getByTestId("fin-budget").innerText();
  check("budget vs actual labels Estimated / Committed / Actual", /ESTIMATED/i.test(budget) && /COMMITTED/i.test(budget) && /ACTUAL/i.test(budget));
  await shot(page, `${String(n++).padStart(2, "0")}-job-costs-budget-vs-actual-desktop-light`);
  await ctx.close();
}
for (const dark of [false, true]) {
  const { ctx, page } = await open(`/financials/jobs/${DECK}`, { vp: PHONE, dark });
  await page.getByTestId("fin-milestones").waitFor({ timeout: 10000 });
  check(`job (phone ${dark ? "dark" : "light"}): no horizontal scroll`, await noHScroll(page));
  await shot(page, `${String(n++).padStart(2, "0")}-job-billing-phone-${dark ? "dark" : "light"}`);
  await ctx.close();
}
{
  const { ctx, page } = await open(`/financials/jobs/${DECK}`, { dark: true });
  await page.getByTestId("fin-milestones").waitFor({ timeout: 10000 });
  await shot(page, `${String(n++).padStart(2, "0")}-job-billing-desktop-dark`);
  await ctx.close();
}

// 4. Role views (same company, real seats and RLS).
for (const [who, id] of [["owner", ME], ["bookkeeper", BK], ["project-manager", PM], ["view-only", VIEW]]) {
  await as(id);
  {
    const { ctx, page } = await open("/financials");
    await page.getByTestId("fin-home").waitFor({ timeout: 10000 }).catch(() => {});
    await shot(page, `${String(n++).padStart(2, "0")}-role-${who}-home-desktop-light`);
    if (who === "view-only") check("view only: no quick actions, no mode switch", (await page.getByText("Quick actions").count()) === 0 && (await page.getByTestId("fin-mode").count()) === 0);
    if (who === "project-manager") check("PM: company-wide receivables cards hidden", (await page.getByTestId("fin-card-ar_aging").count()) === 0);
    await ctx.close();
  }
  {
    const { ctx, page } = await open(`/financials/jobs/${KITCHEN}`);
    await page.getByTestId("fin-job").waitFor({ timeout: 10000 }).catch(() => {});
    const canPay = (await page.getByTestId("fin-record-payment").count()) > 0;
    if (who === "owner" || who === "bookkeeper") check(`${who}: can record payments`, canPay);
    if (who === "project-manager" || who === "view-only") check(`${who}: no Record payment button`, !canPay);
    await shot(page, `${String(n++).padStart(2, "0")}-role-${who}-job-desktop-light`);
    if (who === "project-manager") {
      await page.getByRole("tab", { name: "Costs" }).click();
      await page.waitForTimeout(500);
      check("PM: can record expenses", (await page.getByTestId("fin-add-expense").count()) === 1);
      await shot(page, `${String(n++).padStart(2, "0")}-role-project-manager-job-costs-desktop-light`);
    }
    await ctx.close();
  }
}
await as(ME);
await browser.close();
await db.end();
check("no page errors or 5xx from /api/financials", errors.length === 0);
if (errors.length) console.log(errors.join("\n"));
console.log(out.join("\n"));
fs.writeFileSync(path.join(dir, "walk-results.txt"), `${out.join("\n")}\n\nScreenshots:\n${shots.join("\n")}\n${errors.length ? `\nErrors:\n${errors.join("\n")}\n` : ""}`);
