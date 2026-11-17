// Invoice preview + delete-a-mistake browser walk against the REAL fin_* SQL (TEST DATA ONLY). Setup as walk-v5.mjs.
//   NODE_PATH=<dir with playwright> node scripts/financials/walk-invoice-delete.mjs <screenshotDir>
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const { Client } = require("pg");

const dir = process.argv[2] ?? "invoice-delete-shots";
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
const KITCHEN = (await q1("select id from public.estimates where title = 'Kitchen remodel – Ortiz'")).id;
const kj = await q1("select id from public.fin_jobs where estimate_id = $1", [KITCHEN]);
// A mistaken custom invoice, issued, nothing applied.
const mid = (await as(ME, "select public.fin_invoice_save($1, $2) as r", [kj.id, { kind: "custom", lines: [{ description: "Wrong job: gutter guards", quantity: "1", unitPrice: "640" }] }])).r.invoiceId;
const mistake = (await as(ME, "select public.fin_invoice_issue($1) as r", [mid])).r;
const paidInv = (await q1("select i.id, i.number from public.fin_invoices i join public.fin_invoice_balances_v b on b.invoice_id = i.id where i.job_id = $1 and i.status = 'issued' and b.paid > 0 limit 1", [kj.id]));

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
const shot = async (page, name, full = false) => { await page.screenshot({ path: path.join(dir, `${String(n++).padStart(2, "0")}-${name}.png`), fullPage: full }); };
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

for (const [vpName, vp, dark] of [["desktop", DESK, false], ["desktop", DESK, true], ["phone", PHONE, false]]) {
  const { ctx, page } = await open(`/financials/jobs/${KITCHEN}`, { vp, dark });
  await page.getByTestId("fin-invoices").waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: `Preview invoice ${mistake.number}` }).click();
  await page.getByTestId("fin-invoice-preview").waitFor({ timeout: 10000 });
  const txt = await page.getByTestId("fin-invoice-preview").innerText();
  check(`preview ${vpName} ${dark ? "dark" : "light"}: shows the line and total`, txt.includes("Wrong job: gutter guards") && txt.includes("$640.00"));
  check(`preview ${vpName} ${dark ? "dark" : "light"}: background is blurred`, await page.evaluate(() => [...document.querySelectorAll("[data-state=open]")].some((e) => getComputedStyle(e).backdropFilter.includes("blur"))));
  if (vp === PHONE) check("preview phone: no horizontal scroll", await noHScroll(page));
  await page.waitForTimeout(400);
  await shot(page, `invoice-preview-${vpName}-${dark ? "dark" : "light"}`);
  await ctx.close();
}

{
  const { ctx, page } = await open(`/financials/jobs/${KITCHEN}`);
  await page.getByTestId("fin-invoices").waitFor({ timeout: 15000 });
  if (paidInv) {
    const row = page.locator("li", { hasText: paidInv.number }).first();
    check("an invoice with a payment has no Delete button", (await row.getByTestId("fin-invoice-delete").count()) === 0);
  }
  const row = page.locator("li", { hasText: mistake.number }).first();
  await row.getByTestId("fin-invoice-delete").click();
  await page.getByTestId("fin-delete-rules").waitFor();
  check("delete needs a reason", await page.getByTestId("fin-delete-invoice-confirm").isDisabled());
  await shot(page, "delete-dialog-desktop-light");
  await page.locator("#del-reason").fill("Issued on the wrong job");
  await page.getByTestId("fin-delete-invoice-confirm").click();
  await page.getByTestId("fin-invoice-notice").waitFor({ timeout: 10000 });
  check("success message names the number", (await page.getByTestId("fin-invoice-notice").innerText()).includes(mistake.number));
  check("invoice row is gone", (await page.locator("li", { hasText: "Wrong job" }).count()) === 0 && !(await q1("select 1 as x from public.fin_invoices where id = $1", [mid])));
  check("audit copy kept with the reason", (await q1("select details->>'reason' as r from public.fin_audit_log where action = 'invoice.deleted' and entity_id = $1", [mid]))?.r === "Issued on the wrong job");
  await shot(page, "after-delete-desktop-light");
  // A refused delete (payment applied, even reversed) explains and offers Void.
  const vid = (await as(ME, "select public.fin_invoice_save($1, $2) as r", [kj.id, { kind: "custom", lines: [{ description: "Paid then bounced", quantity: "1", unitPrice: "50" }] }])).r.invoiceId;
  const v = (await as(ME, "select public.fin_invoice_issue($1) as r", [vid])).r;
  const book = (await q1("select book_id from public.fin_jobs where id = $1", [kj.id])).book_id;
  const p = (await as(ME, "select public.fin_payment_record($1, $2) as r", [book, { jobId: kj.id, method: "check", amount: "50.00", allocations: [{ invoiceId: vid, amount: "50.00" }] }])).r;
  await as(ME, "select public.fin_payment_void($1, 'bounced')", [p.paymentId]);
  await page.reload(); await page.getByTestId("fin-invoices").waitFor({ timeout: 15000 });
  await page.locator("li", { hasText: v.number }).first().getByTestId("fin-invoice-delete").click();
  await page.locator("#del-reason").fill("Mistake");
  await page.getByTestId("fin-delete-invoice-confirm").click();
  await page.getByText(/even if later voided/).waitFor({ timeout: 10000 }).catch(async (e) => { await shot(page, "FAIL-refused"); console.log("dialog text:", await page.locator("[role=dialog]").innerText().catch(() => "none")); throw e; });
  check("refused delete explains why and offers Void instead", (await page.getByRole("button", { name: "Void instead" }).count()) === 1);
  await shot(page, "delete-refused-desktop-light");
  await ctx.close();
}

await browser.close(); await db.end();
check(`no page errors or 5xx (${errors.length})`, errors.length === 0);
if (errors.length) console.log(errors.join("\n"));
console.log(out.join("\n"));
