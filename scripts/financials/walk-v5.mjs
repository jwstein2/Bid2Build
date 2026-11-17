// V5 / V5.1 Project Financials + Accounts Receivable browser walk against the REAL fin_* SQL (TEST DATA ONLY).
// Same setup as scripts/financials/walk.mjs (setup-db.mjs + mock-supabase + next start), then:
//   NODE_PATH=<dir with playwright> node scripts/financials/walk-v5.mjs <screenshotDir>
// Adds to the seeded Kitchen job: the electrical sub quote moves 6,800 -> 7,200 (forecast, not contract),
// a 3,000 sub bill with a 1,500 payment, and the start-of-work invoice with a partial payment.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const { Client } = require("pg");

const dir = process.argv[2] ?? "financials-v5-shots";
fs.mkdirSync(dir, { recursive: true });
const ME = "00000000-0000-4000-8000-000000000001", PM = "00000000-0000-4000-8000-0000000000b2";
const user = { id: ME, aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };
const M = "http://localhost:54321", A = "http://localhost:3000";
const out = []; const check = (n, c) => { out.push(`${c ? "✓" : "✗"} ${n}`); if (!c) process.exitCode = 1; };
const db = new Client({ connectionString: process.env.RADAR_PG_URL }); await db.connect();
const q1 = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const as = async (u, sql, args = []) => {
  await db.query("begin"); await db.query("set local role authenticated"); await db.query("select set_config('request.jwt.claim.sub', $1, true)", [u]);
  try { const r = await db.query(sql, args); await db.query("commit"); return r.rows[0]; } catch (e) { await db.query("rollback"); throw e; }
};
const book = (await q1("select id from public.fin_books limit 1")).id;
const KITCHEN = (await q1("select id from public.estimates where title = 'Kitchen remodel – Ortiz'")).id;
const kj = (await q1("select id, customer_id from public.fin_jobs where estimate_id = $1", [KITCHEN]));
const kms = (await db.query("select id from public.fin_payment_milestones where job_id = $1 order by seq", [kj.id])).rows;

// Seed the V5.1 story (idempotent enough for one run on a fresh setup-db).
const cm = await q1("select id from public.fin_commitments where job_id = $1 limit 1", [kj.id]);
await as(ME, "select public.fin_commitment_revise($1, '400.00', 'Sub re-quoted: panel upgrade')", [cm.id]);
const vendor = (await q1("select vendor_id from public.fin_commitments where id = $1", [cm.id])).vendor_id;
const bill = (await as(ME, "select public.fin_bill_record($1, $2) as r", [book, { vendorId: vendor, vendorInvoiceNumber: "BLE-1001", lines: [{ commitmentId: cm.id, amount: "3000.00", description: "Rough-in" }] }])).r.billId;
await as(ME, "select public.fin_bill_approve($1)", [bill]);
await as(ME, "select public.fin_bill_payment_record($1, $2)", [book, { billId: bill, amount: "1500.00", method: "check", reference: "5512" }]);
const inv2 = (await as(ME, "select public.fin_invoice_save($1, $2) as r", [kj.id, { milestoneId: kms[1].id }])).r.invoiceId;
await as(ME, "select public.fin_invoice_issue($1, null, null)", [inv2]);
await as(ME, "select public.fin_payment_record($1, $2)", [book, { jobId: kj.id, method: "ach", amount: "10000.00", allocations: [{ invoiceId: inv2, amount: "10000.00" }] }]);
await db.query(`insert into public.project_schedules (estimate_id, user_id, company_id, name, source_snapshot, calendar, start_date, project_manager_id)
  select $1, $2, e.company_id, 'Kitchen', '{}', '{"workdays":[1,2,3,4,5],"holidays":[],"timezone":"America/Chicago"}', current_date, $3 from public.estimates e where e.id = $1
  on conflict do nothing`, [KITCHEN, ME, PM]).catch(() => {});
const S = await q1("select * from public.fin_job_summary_v where job_id = $1", [kj.id]);
console.error(JSON.stringify(S));
check("summary: contract 62,500 (sub re-quote didn't change it)", S.contract_value === "62500.00");
// The bid estimated the electrical sub at 6,500; the sub quoted 6,800 then 7,200: forecast = estimate - 6,500 + 7,200.
check("summary: forecast cost follows the 7,200 sub quote for that trade only", Number(S.forecast_cost) - Number(S.original_estimated_cost) === 700);
check("summary: invoiced = deposit 6,250 + start 25,000", S.invoiced === "31250.00");
check("summary: collected 16,250, AR 15,000", S.collected === "16250.00" && S.outstanding_ar === "15000.00");
check("summary: unpaid sub bills 1,500", S.unpaid_sub_bills === "1500.00");

await fetch(`${M}/__as?user=${ME}`);
await fetch(`${M}/__onboarding?status=completed`);
await fetch(`${M}/__features?created=${encodeURIComponent(new Date().toISOString())}`);
const browser = await chromium.launch();
const errors = [];
const DESK = { width: 1440, height: 1000 }, PHONE = { width: 390, height: 844 };
async function open(p, { vp = DESK, dark = false } = {}) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 });
  await ctx.addCookies([authCookie]);
  await ctx.addInitScript((m) => { try { localStorage.setItem("b2b-theme", JSON.stringify({ mode: m, at: Date.now() })); } catch { /* none */ } }, dark ? "dark" : "light");
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${p}: ${e.message}`));
  page.on("response", (r) => { if ((r.url().includes("/api/financials") || r.url().includes("/financials")) && r.status() >= 500) errors.push(`${p}: ${r.status()} ${r.url()}`); });
  await page.goto(`${A}${p}`, { waitUntil: "load" });
  const later = page.getByRole("button", { name: "Maybe Later" });
  try { await later.waitFor({ timeout: 1500 }); await later.click(); } catch { /* none */ }
  await page.waitForTimeout(600);
  return { ctx, page };
}
let n = 1;
const shot = async (page, name, full = true) => { await page.screenshot({ path: path.join(dir, `${String(n++).padStart(2, "0")}-${name}.png`), fullPage: full }); };
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

// 1. Project Financials summary: desktop light / dark, phone.
for (const [vpName, vp, dark] of [["desktop", DESK, false], ["desktop", DESK, true], ["phone", PHONE, false], ["phone", PHONE, true]]) {
  const { ctx, page } = await open(`/financials/jobs/${KITCHEN}`, { vp, dark });
  await page.getByTestId("fin-job-summary").waitFor({ timeout: 15000 });
  if (!dark && vp === DESK) {
    const cards = ["contract", "estimated", "forecast", "invoiced", "collected", "ar"];
    for (const c of cards) check(`job summary card ${c} present`, (await page.getByTestId(`fin-sum-${c}`).count()) === 1);
    check("summary shows $62,500.00 contract", (await page.getByTestId("fin-sum-contract").innerText()).includes("62,500.00"));
    check("summary shows $15,000.00 AR", (await page.getByTestId("fin-sum-ar").innerText()).includes("15,000.00"));
    check("owner sees the one-click actions", (await page.getByTestId("fin-sum-actions").getByRole("button", { name: /Create invoice/ }).count()) === 1);
  }
  if (vp === PHONE) check(`job summary phone ${dark ? "dark" : "light"}: no horizontal scroll`, await noHScroll(page));
  await shot(page, `job-summary-${vpName}-${dark ? "dark" : "light"}`, vp === PHONE);
  if (!dark && vp === DESK) {
    await page.getByTestId("fin-sum-forecast").click();
    await page.waitForTimeout(700);
    check("forecast card opens the estimate vs forecast table", await page.getByTestId("fin-budget").isVisible());
    await shot(page, "job-forecast-vs-estimate-desktop-light", false);
    await page.getByTestId("fin-sum-bills").click();
    await page.waitForTimeout(700);
    check("bill shows 1,500 unpaid and a pay button", (await page.getByText("$1,500.00 unpaid").count()) >= 1);
    await page.getByRole("button", { name: "Record bill payment" }).first().click();
    await page.getByTestId("fin-bill-pay-dialog").waitFor();
    await page.locator("#bp-amt").fill("1600");
    await page.getByRole("button", { name: "Record payment" }).last().click();
    check("bill payment over the balance is refused in the form", (await page.getByText("more than the $1,500.00 still owed").count()) === 1);
    await shot(page, "bill-payment-dialog-desktop-light", false);
    await page.keyboard.press("Escape");
    await page.getByTestId("fin-sum-ar").click();
    await page.waitForURL(/receivables/);
    check("AR card opens receivables filtered to this job", page.url().includes(`job=${kj.id}`));
  }
  await ctx.close();
}

// 2. Accounts receivable: desktop light / dark, phone, overdue filter.
for (const [vpName, vp, dark, q] of [["desktop", DESK, false, ""], ["desktop", DESK, true, ""], ["phone", PHONE, false, ""], ["desktop", DESK, false, "?bucket=overdue"]]) {
  const { ctx, page } = await open(`/financials/receivables${q}`, { vp, dark });
  await page.getByTestId("fin-receivables").waitFor({ timeout: 15000 });
  if (!q && !dark && vp === DESK) {
    check("AR total outstanding = 15,000 (kitchen) + 4,725 (roof deposit)", (await page.getByTestId("ar-card-open").innerText()).includes("19,725.00"));
    check("every AR card is a link", (await page.locator("[data-testid^=ar-card-][data-metric-href]").count()) === (await page.locator("[data-testid^=ar-card-]").count()));
    check("AR table lists 2 open invoices", (await page.locator("[data-testid=ar-table] tbody tr").count()) === 2);
  }
  if (q) check("overdue filter shows only the roof deposit", (await page.locator("[data-testid=ar-table] tbody tr").count()) === 1);
  if (vp === PHONE) check("AR phone: no horizontal page scroll", await noHScroll(page));
  await shot(page, `receivables${q ? "-overdue" : ""}-${vpName}-${dark ? "dark" : "light"}`);
  await ctx.close();
}

// 3. Customer ledger.
for (const [vpName, vp] of [["desktop", DESK], ["phone", PHONE]]) {
  const { ctx, page } = await open(`/financials/customers/${kj.customer_id}`, { vp });
  await page.getByTestId("fin-customer-ledger").waitFor({ timeout: 15000 });
  if (vp === DESK) check("ledger net balance 15,000", (await page.getByTestId("cust-net").innerText()).includes("15,000.00"));
  if (vp === PHONE) check("ledger phone: no horizontal page scroll", await noHScroll(page));
  await shot(page, `customer-ledger-${vpName}-light`);
  await ctx.close();
}

// 4. Customer invoice PDF: no internal numbers.
{
  const { ctx, page } = await open(`/financials/jobs/${KITCHEN}`);
  const res = await page.request.get(`${A}/api/financials/invoices/${inv2}/pdf`);
  check("invoice PDF renders (application/pdf)", res.status() === 200 && (res.headers()["content-type"] ?? "").includes("application/pdf"));
  const pdfPath = path.join(dir, "invoice.pdf");
  fs.writeFileSync(pdfPath, await res.body());
  try {
    const text = execFileSync("pdftotext", [pdfPath, "-"]).toString();
    check("invoice PDF shows amount due $15,000.00", text.includes("15,000.00"));
    check("invoice PDF has no cost, margin or sub data", !/margin|cost|subcontract|7,200|6,800|Bright Line/i.test(text));
    execFileSync("pdftoppm", ["-png", "-r", "110", "-f", "1", "-l", "1", pdfPath, path.join(dir, `${String(n++).padStart(2, "0")}-invoice-pdf`)]);
  } catch (e) { check(`pdf text check ran (${e.message})`, false); }
  const csv = await page.request.get(`${A}/api/financials/jobs/${KITCHEN}/report`);
  check("job financial report CSV downloads for the owner", csv.status() === 200 && (await csv.text()).includes("Current forecast cost"));
  await ctx.close();
}

// 5. PM (view-only project seat): same numbers, no write buttons.
await fetch(`${M}/__as?user=${PM}`);
{
  const { ctx, page } = await open(`/financials/jobs/${KITCHEN}`);
  await page.getByTestId("fin-job-summary").waitFor({ timeout: 15000 });
  check("PM sees the contract figure", (await page.getByTestId("fin-sum-contract").innerText()).includes("62,500.00"));
  check("PM has no Create invoice / Record payment buttons", (await page.getByTestId("fin-sum-actions").getByRole("button", { name: /Create invoice|Record payment/ }).count()) === 0);
  await shot(page, "job-summary-project-manager-desktop-light", false);
  await ctx.close();
}
await fetch(`${M}/__as?user=${ME}`);

await browser.close(); await db.end();
check(`no page errors or 5xx (${errors.length})`, errors.length === 0);
if (errors.length) console.log(errors.join("\n"));
console.log(out.join("\n"));
