// V6 P1-B browser walk against the REAL fin_* SQL (TEST DATA ONLY). Same setup as walk-v5.mjs.
//   NODE_PATH=<dir with playwright> node scripts/financials/walk-v6-p1b.mjs <screenshotDir>
// Seeds on the Kitchen job: a customer payment, a sub bill payment, and a $450 expense entered twice.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const { Client } = require("pg");

const dir = process.argv[2] ?? "financials-p1b-shots";
fs.mkdirSync(dir, { recursive: true });
const ME = "00000000-0000-4000-8000-000000000001";
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
const kj = await q1("select id from public.fin_jobs where estimate_id = $1", [KITCHEN]);
const kms = (await db.query("select id from public.fin_payment_milestones where job_id = $1 order by seq", [kj.id])).rows;
const cm = await q1("select id, vendor_id from public.fin_commitments where job_id = $1 limit 1", [kj.id]);
const bill = (await as(ME, "select public.fin_bill_record($1, $2) as r", [book, { vendorId: cm.vendor_id, vendorInvoiceNumber: "BLE-2001", lines: [{ commitmentId: cm.id, amount: "3000.00", description: "Rough-in" }] }])).r.billId;
await as(ME, "select public.fin_bill_approve($1)", [bill]);
const bp = (await as(ME, "select public.fin_bill_payment_record($1, $2) as r", [book, { billId: bill, amount: "1500.00", method: "check", reference: "5512", memo: "INTERNAL-NOTE-XYZ" }])).r;
const inv2 = (await as(ME, "select public.fin_invoice_save($1, $2) as r", [kj.id, { milestoneId: kms[1].id }])).r.invoiceId;
await as(ME, "select public.fin_invoice_issue($1, null, null)", [inv2]);
const pay = (await as(ME, "select public.fin_payment_record($1, $2) as r", [book, { jobId: kj.id, method: "check", reference: "1042", amount: "10000.00", memo: "INTERNAL-NOTE-XYZ", allocations: [{ invoiceId: inv2, amount: "9000.00" }] }])).r;
const e1 = (await as(ME, "select public.fin_expense_record($1, $2) as r", [book, { jobId: kj.id, payee: "Lumber Yard", amount: "450.00", description: "Plywood" }])).r;
await as(ME, "select public.fin_expense_record($1, $2) as r", [book, { jobId: kj.id, payee: "lumber yard", amount: "450.00", description: "Plywood (entered again)" }]);
for (const r of (await db.query("select id from public.fin_expenses where job_id = $1 and status = 'pending' and amount = 450", [kj.id])).rows) await as(ME, "select public.fin_expense_decide($1, 'approve')", [r.id]);
const plywood = async () => (await q1("select coalesce(sum(amount), 0)::text as t from public.fin_job_costs_v where job_id = $1 and description like 'Plywood%'", [kj.id])).t;
check("both $450 copies count before review (900)", (await plywood()) === "900.00");

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
  page.on("response", (r) => { if (r.url().includes("/financials") && r.status() >= 500) errors.push(`${p}: ${r.status()} ${r.url()}`); });
  await page.goto(`${A}${p}`, { waitUntil: "load" });
  const later = page.getByRole("button", { name: "Maybe Later" });
  try { await later.waitFor({ timeout: 1500 }); await later.click(); } catch { /* none */ }
  await page.waitForTimeout(600);
  return { ctx, page };
}
let n = 1;
const shot = async (page, name, full = true) => { await page.screenshot({ path: path.join(dir, `${String(n++).padStart(2, "0")}-${name}.png`), fullPage: full }); };
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

// 1. Receipt PDFs (API, through the app's auth + RLS path).
{
  const { ctx, page } = await open(`/financials/jobs/${KITCHEN}`);
  const r = await page.request.get(`${A}/api/financials/payments/${pay.paymentId}/receipt`);
  const buf = await r.body();
  check("customer receipt: 200 PDF", r.status() === 200 && buf.subarray(0, 5).toString() === "%PDF-");
  check("customer receipt: private, inline", (r.headers()["cache-control"] ?? "").includes("no-store") && (r.headers()["content-disposition"] ?? "").startsWith("inline"));
  fs.writeFileSync(path.join(dir, "customer-receipt.pdf"), buf);
  const dl = await page.request.get(`${A}/api/financials/payments/${pay.paymentId}/receipt?download=1`);
  check("customer receipt: ?download=1 is an attachment", (dl.headers()["content-disposition"] ?? "").startsWith("attachment"));
  const v = await page.request.get(`${A}/api/financials/bill-payments/${bp.billPaymentId ?? bp.id}/receipt`);
  const vb = await v.body();
  check("sub payment record: 200 PDF", v.status() === 200 && vb.subarray(0, 5).toString() === "%PDF-");
  fs.writeFileSync(path.join(dir, "sub-payment-record.pdf"), vb);
  check("bad id is a 404", (await page.request.get(`${A}/api/financials/payments/not-a-uuid/receipt`)).status() === 404);

  // 2. Payments list shows the receipt link.
  await page.getByTestId("fin-payments").waitFor({ timeout: 15000 });
  check("payments list has a Receipt PDF link", (await page.getByTestId("fin-payment-receipt").count()) >= 1);
  await page.getByTestId("fin-payments").scrollIntoViewIfNeeded();
  await shot(page, "payments-receipt-link-desktop-light", false);

  // 3. Costs: bill payment record link + void buttons with reason.
  await page.getByRole("tab", { name: "Costs" }).click();
  await page.waitForTimeout(600);
  check("bill payment has a payment-record link", (await page.getByTestId("fin-bill-payment-receipt").count()) >= 1);
  await page.locator("#fin-bills").scrollIntoViewIfNeeded();
  await shot(page, "costs-void-and-records-desktop-light", false);

  // 4. Needs review: the duplicate, then void it from the queue.
  await page.getByRole("tab", { name: /Needs review/ }).click();
  await page.waitForTimeout(600);
  check("review shows the possible duplicate", (await page.getByText("Possible duplicate").count()) >= 1);
  check("review explains nothing was changed", (await page.getByText(/within 3 days\. Nothing was changed/).count()) >= 1);
  await shot(page, "review-possible-duplicate-desktop-light", false);
  await page.getByTestId("fin-void-duplicate").click();
  await page.waitForTimeout(1500);
  check("after voiding the duplicate, the cost counts once (450)", (await plywood()) === "450.00");
  const voided = await q1("select decision_note from public.fin_expenses where job_id = $1 and status = 'void' and amount = 450", [kj.id]);
  check(`voided copy keeps a reason (${voided?.decision_note})`, voided?.decision_note === `Duplicate of ${e1.number}`);
  check("the duplicate leaves the review queue", (await page.getByTestId("fin-void-duplicate").count()) === 0);
  await ctx.close();
}

// 5. Void dialog: reason required + correction help; light/dark/phone.
for (const [vpName, vp, dark] of [["desktop", DESK, false], ["desktop", DESK, true], ["phone", PHONE, false]]) {
  const { ctx, page } = await open(`/financials/jobs/${KITCHEN}`, { vp, dark });
  await page.getByRole("tab", { name: "Costs" }).click();
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "Void", exact: true }).first().click();
  await page.getByTestId("fin-void-help").waitFor({ timeout: 5000 });
  check(`void dialog ${vpName} ${dark ? "dark" : "light"}: needs a reason`, await page.getByTestId("fin-void-confirm").isDisabled());
  if (vp === PHONE) check("void dialog phone: no horizontal scroll", await noHScroll(page));
  await shot(page, `void-dialog-${vpName}-${dark ? "dark" : "light"}`, false);
  await ctx.close();
}

// 6. Void a bill that has a payment is refused by the DB; void an expense with a reason works.
{
  const { ctx, page } = await open(`/financials/jobs/${KITCHEN}`);
  await page.getByRole("tab", { name: "Costs" }).click();
  await page.waitForTimeout(600);
  const exp = await q1("select id, number from public.fin_expenses where job_id = $1 and status = 'approved' and amount = 450", [kj.id]);
  const row = page.locator("li", { hasText: exp.number }).first();
  await row.getByRole("button", { name: "Void", exact: true }).click();
  await page.locator("#void-reason").fill("Returned to the store");
  await page.getByTestId("fin-void-confirm").click();
  await page.waitForTimeout(1500);
  check("expense voided with its reason", (await q1("select status, decision_note from public.fin_expenses where id = $1", [exp.id])).decision_note === "Returned to the store");
  check("the voided expense still shows, with its reason", (await page.getByText("Returned to the store").count()) >= 1);
  await shot(page, "expense-voided-desktop-light", false);
  await ctx.close();
}

await browser.close(); await db.end();
check(`no page errors or 5xx (${errors.length})`, errors.length === 0);
if (errors.length) console.log(errors.join("\n"));
console.log(out.join("\n"));
