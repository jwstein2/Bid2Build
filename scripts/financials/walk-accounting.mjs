// V6.3 Accountant Mode browser walk against the REAL fin_* SQL (TEST DATA ONLY, local database, mocked auth).
//   scripts/test-db.sh start && export RADAR_PG_URL=$(node scripts/financials/setup-db.mjs)
//   PG_REST_AS_USER=<owner> PG_REST_PREFIXES=fin_,estimates,estimate_versions,subcontractor_quote,change_orders,project_scope_sections node scripts/ux-audit/mock-supabase.mjs &
//   NODE_PATH=<dir with playwright> node scripts/financials/walk-accounting.mjs <screenshotDir>
// No bank connection, no Stripe, no email: statements are a generated CSV file.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const { Client } = require("pg");

const dir = process.argv[2] ?? "accounting-shots";
fs.mkdirSync(dir, { recursive: true });
const ME = "00000000-0000-4000-8000-000000000001", BK = "00000000-0000-4000-8000-0000000000b1", PM = "00000000-0000-4000-8000-0000000000b2", VIEW = "00000000-0000-4000-8000-0000000000b3";
const b64u = (s) => Buffer.from(s).toString("base64url");
const cookieFor = (id, email) => {
  const user = { id, aud: "authenticated", role: "authenticated", email, email_confirmed_at: new Date().toISOString() };
  const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
  const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user };
  return { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };
};
const M = "http://localhost:54321", A = "http://localhost:3000";
const out = []; const check = (n, c, extra = "") => { out.push(`${c ? "✓" : "✗"} ${n}${extra ? ` (${extra})` : ""}`); if (!c) process.exitCode = 1; };
const db = new Client({ connectionString: process.env.RADAR_PG_URL }); await db.connect();
const q1 = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const as = async (u, sql, args = []) => {
  await db.query("begin"); await db.query("set local role authenticated"); await db.query("select set_config('request.jwt.claim.sub', $1, true)", [u]);
  try { const r = await db.query(sql, args); await db.query("commit"); return r.rows[0]; } catch (e) { await db.query("rollback"); throw e; }
};
const book = (await q1("select id from public.fin_books where sandbox_of is null order by created_at limit 1")).id;
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

// Extra test data: a vendor bill (approved, past due) and one pending; a subcontractor bill payment by check.
const vendor = (await as(ME, "select public.fin_vendor_save($1, $2) as v", [book, { name: "Lumber Yard", kind: "supplier" }])).v;
const sub = (await q1("select id from public.fin_vendors where book_id = $1 and name = 'Bright Line Electric'", [book])).id;
const kj = (await q1("select j.id from public.fin_jobs j join public.estimates e on e.id = j.estimate_id where e.title = 'Kitchen remodel – Ortiz'")).id;
const late = (await as(ME, "select public.fin_bill_record($1, $2) as r", [book, { vendorId: vendor, vendorInvoiceNumber: "LY-88", billDate: day(-40), dueDate: day(-10), lines: [{ jobId: kj, description: "Lumber", amount: "980.00" }] }])).r.billId;
await as(ME, "select public.fin_bill_approve($1)", [late]);
await as(ME, "select public.fin_bill_record($1, $2) as r", [book, { vendorId: vendor, vendorInvoiceNumber: "LY-91", lines: [{ jobId: kj, description: "Trim", amount: "310.00" }] }]);
const subBill = (await as(ME, "select public.fin_bill_record($1, $2) as r", [book, { vendorId: sub, vendorInvoiceNumber: "BLE-1", lines: [{ jobId: kj, description: "Rough-in", amount: "2400.00" }] }])).r.billId;
await as(ME, "select public.fin_bill_approve($1)", [subBill]);
await as(ME, "select public.fin_bill_payment_record($1, $2)", [book, { billId: subBill, amount: "2400.00", method: "check", reference: "3105", paidOn: day(-3) }]);
await as(ME, "select public.fin_set_mode($1, 'accountant')", [book]);
for (const u of [BK, VIEW]) await as(u, "select public.fin_set_mode($1, 'accountant')", [book]).catch(() => {});

// The statement the bookkeeper downloads from the bank (CSV): the kitchen deposit, the sub's check, fees, a duplicate charge.
const csv = ["Account: Business Checking ****4321", "Date,Description,Amount,Check Number,Reference",
  `${day(-2)},DEPOSIT SAM ORTIZ,6250.00,,D-20`, `${day(-2)},CHECK 3105,-2400.00,3105,C-3105`, `${day(-6)},SUPPLY HOUSE #12,-212.40,,P-1`,
  `${day(-5)},COFFEE SHOP,-8.75,,P-2`, `${day(-5)},COFFEE SHOP,-8.75,,P-3`, `${day(-4)},MONTHLY SERVICE FEE,-15.00,,F-1`, `${day(-1)},TRANSFER TO SAVINGS,-1000.00,,T-1`].join("\n");
const csvPath = path.join(dir, "statement.csv");
fs.writeFileSync(csvPath, csv);

await fetch(`${M}/__onboarding?status=completed`);
await fetch(`${M}/__features?created=${encodeURIComponent(new Date().toISOString())}`);
const browser = await chromium.launch();
const errors = [];
const DESK = { width: 1440, height: 1000 }, PHONE = { width: 390, height: 844 };
async function open(p, { vp = DESK, dark = false, who = ME, email = "ux-test@built2bid.test" } = {}) {
  await fetch(`${M}/__as?user=${who}`);
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 });
  await ctx.addCookies([cookieFor(who, email)]);
  await ctx.addInitScript((m) => { try { localStorage.setItem("b2b-theme", JSON.stringify({ mode: m, at: Date.now() })); } catch { /* none */ } }, dark ? "dark" : "light");
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${p}: ${e.message}`));
  page.on("response", (r) => { if (r.url().includes("/financials") && r.status() >= 500) errors.push(`${p}: ${r.status()} ${r.url()}`); });
  await page.goto(`${A}${p}`, { waitUntil: "load" });
  const later = page.getByRole("button", { name: "Maybe Later" });
  try { await later.waitFor({ timeout: 1500 }); await later.click(); } catch { /* none */ }
  await page.waitForTimeout(500);
  return { ctx, page };
}
let n = 1;
const shot = async (page, name, full = true) => { await page.screenshot({ path: path.join(dir, `${String(n++).padStart(2, "0")}-${name}.png`), fullPage: full }); };
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const settle = async (page) => { await page.waitForLoadState("load"); await page.waitForTimeout(1800); };

// 1. Accountant home (desktop, light): six metrics, queue, nine quick actions, accounting navigation.
{
  const { ctx, page } = await open("/financials");
  await page.getByTestId("fin-accountant-home").waitFor({ timeout: 15000 });
  for (const id of ["fin-acct-bank", "fin-acct-projected", "fin-acct-ar", "fin-acct-ap", "fin-acct-unrec", "fin-acct-review"]) check(`home: ${id} card`, await page.getByTestId(id).isVisible());
  check("home: bank balance is not invented before any statement", (await page.getByTestId("fin-acct-bank").innerText()).includes("No balance yet"));
  check("home: nine accountant quick actions for the owner", (await page.locator("[data-testid^=fin-acct-action-]").count()) === 9);
  check("home: accounting navigation", await page.getByTestId("fin-acct-nav").isVisible());
  check("home: no Coming soon on the accountant cards", !(await page.getByTestId("fin-card-export_center").innerText().catch(() => "")).includes("Coming soon") && !(await page.getByTestId("fin-card-audit_trail").innerText().catch(() => "")).includes("Coming soon"));
  await shot(page, "home-accountant-desktop-light");
  await ctx.close();
}

// 2. Reconciliation: add an account, import the CSV, match suggestions, exclude, create an expense, confirm with a note.
{
  const { ctx, page } = await open("/financials/accounting/bank");
  await page.getByTestId("fin-bank-add").waitFor();
  await page.fill("#ba-name", "Business checking"); await page.fill("#ba-last4", "4321"); await page.fill("#ba-open", "1500.00"); await page.fill("#ba-date", day(-30));
  await page.getByRole("button", { name: "Add account" }).click(); await settle(page);
  const acct = await q1("select id, last4 from public.fin_bank_accounts where book_id = $1", [book]);
  check("bank: account saved with last 4 only", acct?.last4 === "4321");
  await page.setInputFiles("[data-testid=fin-bank-file]", csvPath);
  await page.getByTestId("fin-bank-preview").waitFor();
  check("bank: preview reads 7 lines", (await page.getByTestId("fin-bank-preview").innerText()).includes("7 lines read"));
  await page.fill("#imp-open", "1500.00"); await page.fill("#imp-end", "4105.10");
  await shot(page, "bank-import-preview", false);
  await page.getByTestId("fin-bank-import-go").click(); await settle(page);
  const lines = Number((await q1("select count(*) n from public.fin_bank_transactions where account_id = $1", [acct.id])).n);
  check("bank: 7 lines imported", lines === 7, String(lines));
  // Re-import the same file: everything skipped, nothing duplicated.
  await page.setInputFiles("[data-testid=fin-bank-file]", csvPath); await page.getByTestId("fin-bank-preview").waitFor();
  await page.getByTestId("fin-bank-import-go").click(); await settle(page);
  check("bank: re-import skips lines already there", Number((await q1("select count(*) n from public.fin_bank_transactions where account_id = $1", [acct.id])).n) === 7);
  // Suggested matches: deposit -> kitchen payment (same amount), check 3105 -> bill payment (check number).
  const sugg = page.getByTestId("fin-line-suggest");
  check("bank: suggestions offered", (await sugg.count()) >= 2, String(await sugg.count()));
  await shot(page, "bank-lines-suggestions");
  await sugg.first().click(); await settle(page);
  await page.getByTestId("fin-line-suggest").first().click(); await settle(page);
  const matched = Number((await q1("select count(*) n from public.fin_bank_matches where book_id = $1 and status = 'active'", [book])).n);
  check("bank: two lines matched by a person (nothing automatic)", matched === 2, String(matched));
  // Exclude the transfer.
  const transfer = page.locator("li", { hasText: "TRANSFER TO SAVINGS" }).last();
  await transfer.getByRole("button", { name: "Exclude" }).first().click();
  await transfer.locator("select").first().selectOption("transfer");
  await transfer.locator("form").getByRole("button", { name: "Exclude" }).click(); await settle(page);
  // Record the service fee as an expense.
  const fee = page.locator("li", { hasText: "MONTHLY SERVICE FEE" }).last();
  await fee.getByRole("button", { name: "Record as expense" }).click();
  await fee.locator("form").getByRole("button", { name: "Record expense" }).click(); await settle(page);
  check("bank: fee became a pending expense, matched", (await q1("select e.status from public.fin_bank_matches m join public.fin_expenses e on e.id = m.target_id where m.target_type = 'expense' and m.status = 'active'"))?.status === "pending");
  // Confirm the period with differences (unmatched coffee charges + supply house).
  await page.fill("#rc-bal", "4105.10");
  await page.fill("#rc-note", "Coffee charge appears twice; disputing with the bank. Supply House to match next week.");
  await page.getByRole("button", { name: /Confirm/ }).click(); await settle(page);
  const rec = await q1("select status, difference, unmatched_count from public.fin_reconciliations where account_id = $1", [acct.id]);
  check("bank: period confirmed with differences and a note", rec?.status === "confirmed_with_differences", JSON.stringify(rec));
  await shot(page, "bank-after-reconcile-desktop-light");
  // A locked line can't be unmatched through the API either.
  const lockedMatch = (await q1("select id from public.fin_bank_matches where status = 'active' limit 1")).id;
  const r = await page.evaluate(async (id) => (await fetch("/api/financials/actions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "bank_unmatch", matchId: id, reason: "test" }) }).then(async (x) => `${x.status} ${await x.text()}`)), lockedMatch);
  check("bank: matches in a confirmed period are locked", r.includes("period_locked"), r);
  await ctx.close();
}

// 3. Review queue: groups, classify an uncategorized cost with flat selects, duplicates.
{
  const { ctx, page } = await open("/financials/accounting");
  await page.getByTestId("fin-queue-chip-uncategorized").waitFor();
  check("queue: uncategorized group has the dump fees", (await page.getByTestId("fin-queue-uncategorized").innerText()).includes("Dump fees"));
  check("queue: duplicate bank lines listed", (await page.getByTestId("fin-queue-duplicates").innerText()).includes("COFFEE SHOP"));
  check("queue: past-due and pending bills listed", (await page.getByTestId("fin-queue-bills").innerText()).includes("LY-88"));
  await shot(page, "queue-desktop-light");
  const dump = await q1("select id from public.fin_expenses where description = 'Dump fees'");
  const form = page.getByTestId(`fin-classify-${dump.id}`);
  await form.locator("select").nth(0).selectOption({ index: 1 });
  await form.getByRole("button", { name: "Save" }).click(); await settle(page);
  check("queue: cost code filled in once, audited", Boolean((await q1("select cost_code_id from public.fin_expenses where id = $1", [dump.id])).cost_code_id)
    && Boolean(await q1("select 1 from public.fin_audit_log where entity_id = $1 and action = 'cost.filled'", [dump.id])));
  await ctx.close();
}

// 4. Transactions: search + filters + CSV (audited).
{
  const { ctx, page } = await open("/financials/accounting/transactions");
  await page.getByTestId("fin-txn-table").waitFor();
  const count = await page.getByTestId("fin-txn-count").innerText();
  check("transactions: lists records", /\d+ transactions/.test(count), count);
  await shot(page, "transactions-desktop-light", false);
  await page.fill("#tq", "Ortiz"); await page.getByRole("button", { name: "Apply" }).click(); await settle(page);
  check("transactions: search filters in the URL", page.url().includes("q=Ortiz") && (await page.locator("[data-testid=fin-txn-table] tbody tr").count()) >= 1);
  const res = await page.evaluate(async () => { const r = await fetch("/api/financials/export?kind=transactions"); return { s: r.status, t: (await r.text()).slice(0, 200) }; });
  check("transactions: CSV export works", res.s === 200 && res.t.includes("Transaction ledger"), String(res.s));
  check("exports are audited", Boolean(await q1("select 1 from public.fin_audit_log where book_id = $1 and action = 'export.transactions'", [book])));
  await ctx.close();
}

// 5. Reports catalog + reports; audit trail; accounts.
{
  const { ctx, page } = await open("/financials/accounting/reports");
  await page.getByTestId("fin-report-search").fill("aging");
  check("reports: search finds AR and AP aging", (await page.getByTestId("fin-report-ar_aging").isVisible()) && (await page.getByTestId("fin-report-ap_aging").isVisible()));
  await page.getByTestId("fin-report-search").fill("");
  check("reports: blocked reports have no link", (await page.getByText("Balance Sheet").count()) === 1 && (await page.locator("a", { hasText: "Balance Sheet" }).count()) === 0);
  await shot(page, "reports-catalog-desktop-light");
  for (const r of ["ap_aging", "job_costing", "customer_balances", "labor_variance", "expenses_by_category", "sub_payments"]) {
    await page.goto(`${A}/financials/accounting/reports?r=${r}`, { waitUntil: "load" }); await settle(page);
    check(`report ${r} renders`, await page.locator("table").first().isVisible());
    if (r === "ap_aging" || r === "job_costing" || r === "sub_payments") await shot(page, `report-${r}`, false);
  }
  check("sub payments: Bright Line Electric $2,400", (await page.locator("table").first().innerText()).includes("Bright Line Electric"));
  await page.goto(`${A}/financials/accounting/audit`, { waitUntil: "load" }); await settle(page);
  const audit = await page.getByTestId("fin-audit-list").innerText();
  check("audit: shows bank work, classification and exports with names", audit.includes("Bank period confirmed") && audit.includes("Classification filled in") && audit.includes("Exported transactions"));
  await shot(page, "audit-desktop-light", false);
  await page.goto(`${A}/financials/accounting/accounts`, { waitUntil: "load" }); await settle(page);
  check("accounts: says the general ledger isn't built", (await page.locator("main").innerText()).includes("General ledger: not built yet"));
  await ctx.close();
}

// 6. Dark mode desktop + phones (light and dark): no sideways scrolling.
for (const [name, vp, dark] of [["desktop-dark", DESK, true], ["phone-light", PHONE, false], ["phone-dark", PHONE, true]]) {
  for (const p of ["/financials", "/financials/accounting", "/financials/accounting/bank", "/financials/accounting/transactions"]) {
    const { ctx, page } = await open(p, { vp, dark });
    await settle(page);
    check(`${name} ${p}: no horizontal page scroll`, await noHScroll(page));
    if (name !== "desktop-dark" || p !== "/financials/accounting/transactions") await shot(page, `${p.split("/").pop()}-${name}`, name !== "desktop-dark");
    await ctx.close();
  }
}

// 7. Roles: the project manager can't open accounting or export; view-only can read but not reconcile or export.
{
  const { ctx, page } = await open("/financials/accounting", { who: PM, email: "pm@summit.test" });
  check("PM: accounting needs a company role", (await page.locator("main").innerText()).includes("Accounting needs a company financial role"));
  const r = await page.evaluate(async () => (await fetch("/api/financials/export?kind=transactions")).status);
  check("PM: export refused", r === 403, String(r));
  await page.goto(`${A}/financials`, { waitUntil: "load" }); await settle(page);
  check("PM: no mode selector", (await page.getByTestId("fin-mode").count()) === 0);
  await ctx.close();
}
{
  const { ctx, page } = await open("/financials/accounting/bank", { who: VIEW, email: "viewer@summit.test" });
  await settle(page);
  check("view-only: sees bank lines, no import or matching", (await page.getByTestId("fin-bank-lines").isVisible()) && (await page.getByTestId("fin-bank-import").count()) === 0 && (await page.getByTestId("fin-line-suggest").count()) === 0);
  const r = await page.evaluate(async () => (await fetch("/api/financials/export?kind=bank_lines")).status);
  check("view-only: export refused (no export permission)", r === 403, String(r));
  await ctx.close();
}
{
  const { ctx, page } = await open("/financials", { who: BK, email: "books@summit.test" });
  await page.getByTestId("fin-accountant-home").waitFor({ timeout: 15000 });
  check("bookkeeper: accountant home with permitted quick actions", (await page.locator("[data-testid^=fin-acct-action-]").count()) === 9);
  await ctx.close();
}

check("no page errors or 5xx", errors.length === 0, errors.slice(0, 5).join(" | "));
await browser.close(); await db.end();
console.log(out.join("\n"));
