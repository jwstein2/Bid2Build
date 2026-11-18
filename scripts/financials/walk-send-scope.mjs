// Invoice send states + scope-removal change orders browser walk against the REAL fin_* SQL (TEST DATA ONLY).
//   Setup as walk-v5.mjs, with PG_REST_PREFIXES also covering comm_ and change_orders.
//   NODE_PATH=<dir with playwright> node scripts/financials/walk-send-scope.mjs <screenshotDir>
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const { Client } = require("pg");

const dir = process.argv[2] ?? "send-scope-shots";
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
// An issued invoice with nothing sent or paid yet.
const sid = (await as(ME, "select public.fin_invoice_save($1, $2) as r", [kj.id, { kind: "custom", lines: [{ description: "Cabinet hardware upgrade", quantity: "1", unitPrice: "380" }] }])).r.invoiceId;
const sinv = (await as(ME, "select public.fin_invoice_issue($1) as r", [sid])).r;
// Approved change orders: two scope removals and one addition.
const co = async (num, title, amount) => (await q1(
  `insert into public.change_orders (estimate_id, user_id, company_id, number, title, amount, status, approval_method, approval_note, approved_version, decided_at, version)
   select id, user_id, company_id, $2, $3, $4, 'signed', 'manual', 'Signed on site', 1, now(), 1 from public.estimates where id = $1 returning id`, [KITCHEN, num, title, amount])).id;
const base = Number((await q1("select coalesce(max(number), 0) as n from public.change_orders where estimate_id = $1", [KITCHEN])).n);
await co(base + 1, "Remove pantry shelving", "-800.00");
await co(base + 2, "Skip backsplash tile", "-300.00");
await co(base + 3, "Add under-cabinet lights", "450.00");

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
const row = (page) => page.getByTestId("fin-invoices").locator("li", { hasText: sinv.number }).first();
const coRow = (page, t) => page.getByTestId("fin-change-orders").locator("li", { hasText: t });

{
  const { ctx, page } = await open(`/financials/jobs/${KITCHEN}`);
  await page.getByTestId("fin-invoices").waitFor({ timeout: 15000 });
  check("new invoice shows Issued, not sent", (await row(page).getByTestId("fin-send-status").getAttribute("data-state")) === "issued");
  check("every invoice row has a status track", (await page.getByTestId("fin-invoices").getByTestId("fin-send-status").count()) >= 2);
  await row(page).getByTestId("fin-invoice-mark-sent").click();
  await page.locator("#ms-method").selectOption("printed");
  await shot(page, "mark-sent-dialog-desktop-light");
  await page.getByTestId("fin-mark-sent-confirm").click();
  await page.waitForFunction((num) => [...document.querySelectorAll("[data-testid=fin-invoices] li")].some((li) => li.textContent.includes(num) && li.querySelector("[data-state=sent]")), sinv.number, { timeout: 10000 });
  check("marked as sent shows Sent + printed", (await row(page).innerText()).includes("printed"));
  check("sent invoice has no Delete button", (await row(page).getByTestId("fin-invoice-delete").count()) === 0);
  await page.getByTestId("fin-invoices").scrollIntoViewIfNeeded();
  await shot(page, "invoice-sent-desktop-light");
  await row(page).getByTestId("fin-invoice-unmark-sent").click();
  await page.locator("#ms-reason").fill("Marked the wrong invoice");
  await page.getByTestId("fin-mark-sent-confirm").click();
  await page.waitForFunction((num) => [...document.querySelectorAll("[data-testid=fin-invoices] li")].some((li) => li.textContent.includes(num) && li.querySelector("[data-state=issued]")), sinv.number, { timeout: 10000 });
  check("undo sent returns to Issued and keeps the reason", (await q1("select undo_reason from public.fin_invoice_sends where invoice_id = $1", [sid]))?.undo_reason === "Marked the wrong invoice");

  // Change orders.
  const card = page.getByTestId("fin-change-orders");
  await card.scrollIntoViewIfNeeded();
  check("change orders card lists all three as not billed", (await card.locator("[data-settlement=open]").count()) === 3);
  await shot(page, "change-orders-open-desktop-light");
  await coRow(page, "Remove pantry shelving").getByTestId("fin-co-credit").click();
  await page.getByTestId("fin-co-form").waitFor();
  await shot(page, "co-credit-dialog-desktop-light");
  await page.getByTestId("fin-co-confirm").click();
  await coRow(page, "Remove pantry shelving").locator("[data-settlement=credited]").waitFor({ timeout: 10000 }).catch(() => {});
  check("scope removal credited", (await coRow(page, "Remove pantry shelving").getAttribute("data-settlement")) === "credited");
  check("credit memo linked to the change order", Number((await q1("select amount from public.fin_credit_memos where change_order_id is not null and job_id = $1 and status = 'issued' order by created_at desc limit 1", [kj.id]))?.amount) === 800);
  const amend = coRow(page, "Skip backsplash tile").getByTestId("fin-co-amend");
  if (await amend.count()) {
    await amend.click(); await page.getByTestId("fin-co-confirm").click();
    await page.waitForFunction(() => [...document.querySelectorAll("[data-testid=fin-co-row]")].some((li) => li.textContent.includes("Skip backsplash") && li.dataset.settlement !== "open"), null, { timeout: 10000 });
    check("scope removal taken off a remaining payment", ["amended", "amendment_pending"].includes(await coRow(page, "Skip backsplash tile").getAttribute("data-settlement")));
  } else check("scope removal taken off a remaining payment (no remaining payment to reduce)", false);
  await coRow(page, "Add under-cabinet lights").getByTestId("fin-co-milestone").click();
  await page.getByTestId("fin-co-confirm").click();
  await page.waitForFunction(() => [...document.querySelectorAll("[data-testid=fin-co-row]")].some((li) => li.textContent.includes("under-cabinet") && li.dataset.settlement === "milestones"), null, { timeout: 10000 });
  check("added scope becomes its own payment", true);
  await card.scrollIntoViewIfNeeded();
  await shot(page, "change-orders-settled-desktop-light");
  await ctx.close();
}
for (const [name, vp, dark] of [["desktop-dark", DESK, true], ["phone-light", PHONE, false]]) {
  const { ctx, page } = await open(`/financials/jobs/${KITCHEN}`, { vp, dark });
  await page.getByTestId("fin-change-orders").waitFor({ timeout: 15000 });
  await page.getByTestId("fin-change-orders").scrollIntoViewIfNeeded();
  await shot(page, `change-orders-${name}`);
  await page.getByTestId("fin-invoices").scrollIntoViewIfNeeded();
  await shot(page, `invoices-${name}`);
  if (vp === PHONE) check("phone: no horizontal scroll", await noHScroll(page));
  await ctx.close();
}

await browser.close(); await db.end();
check(`no page errors or 5xx (${errors.length})`, errors.length === 0);
if (errors.length) console.log(errors.join("\n"));
console.log(out.join("\n"));
