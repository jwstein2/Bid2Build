// Practice sandbox browser walk against the REAL fin_* SQL (TEST DATA ONLY).
//   Setup as walk-v5.mjs, with PG_REST_PREFIXES also covering comm_ and change_orders.
//   NODE_PATH=<dir with playwright> node scripts/financials/walk-sandbox.mjs <screenshotDir>
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const { Client } = require("pg");

const dir = process.argv[2] ?? "sandbox-shots";
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
const realBook = (await q1("select book_id from public.fin_jobs where estimate_id = $1 and not sandbox", [KITCHEN])).book_id;
const realInvoices = Number((await q1("select count(*) n from public.fin_invoices where book_id = $1", [realBook])).n);
const realJobNo = (await q1("select job_number from public.fin_jobs where estimate_id = $1 and not sandbox", [KITCHEN])).job_number;
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

// 1. Enter from the Financials home.
{
  const { ctx, page } = await open("/financials");
  await page.getByTestId("fin-sandbox-enter").click();
  await page.getByTestId("fin-sandbox-rules").waitFor();
  await shot(page, "enter-dialog-desktop-light");
  await page.getByTestId("fin-sandbox-enter-confirm").click();
  await page.getByTestId("fin-sandbox-banner").waitFor({ timeout: 15000 });
  check("banner shows after switching", true);
  await shot(page, "home-in-sandbox-desktop-light");
  await ctx.close();
}
const sbx = await q1("select id from public.fin_books where sandbox_of = $1 and sandbox_archived_at is null", [realBook]);
check("sandbox book created for the real book", Boolean(sbx));
const sj = await q1("select id, job_number from public.fin_jobs where book_id = $1 and estimate_id = $2", [sbx.id, KITCHEN]);
check("open job copied into the sandbox with an SBX number", Boolean(sj) && String(sj.job_number).startsWith("SBX"));

// 2. Practice an invoice on the copied job.
const iid = (await as(ME, "select public.fin_invoice_save($1, $2) as r", [sj.id, { kind: "custom", lines: [{ description: "Practice: extra trim", quantity: "1", unitPrice: "250" }] }])).r.invoiceId;
const inv = (await as(ME, "select public.fin_invoice_issue($1) as r", [iid])).r;
check("sandbox invoice numbered SBX-", String(inv.number).startsWith("SBX"));
{
  const { ctx, page } = await open(`/financials/jobs/${KITCHEN}`);
  await page.getByTestId("fin-invoices").waitFor({ timeout: 15000 });
  check("job page shows the sandbox banner", await page.getByTestId("fin-sandbox-banner").isVisible());
  check("job page is the sandbox copy", (await page.getByTestId("fin-job").innerText()).includes(String(sj.job_number)));
  check("no email draft buttons in the sandbox", (await page.getByRole("button", { name: /email draft/i }).count()) === 0);
  await shot(page, "job-in-sandbox-desktop-light");
  await page.getByTestId("fin-invoices").getByRole("button", { name: `Preview invoice ${inv.number}` }).click();
  await page.getByTestId("fin-preview-sandbox").waitFor({ timeout: 10000 });
  check("invoice preview carries the sandbox notice", true);
  await shot(page, "preview-in-sandbox-desktop-light");
  const pdf = await page.request.get(`${A}/api/financials/invoices/${iid}/pdf`);
  check("sandbox invoice PDF renders", pdf.ok() && (await pdf.body()).subarray(0, 4).toString() === "%PDF");
  await ctx.close();
}
check("real books untouched", Number((await q1("select count(*) n from public.fin_invoices where book_id = $1", [realBook])).n) === realInvoices);
// (Email refusal at the database is covered by tests/db/fin-sandbox.test.ts.)

// 3. Dark + phone in the sandbox.
for (const [name, vp, dark] of [["desktop-dark", DESK, true], ["phone-light", PHONE, false]]) {
  const { ctx, page } = await open(`/financials/jobs/${KITCHEN}`, { vp, dark });
  await page.getByTestId("fin-sandbox-banner").waitFor({ timeout: 15000 });
  await shot(page, `job-in-sandbox-${name}`);
  if (vp === PHONE) check("phone: no horizontal scroll", await noHScroll(page));
  await ctx.close();
}

// 4. Start over, then back to the real books.
{
  const { ctx, page } = await open("/financials");
  await page.getByTestId("fin-sandbox-reset").click();
  await shot(page, "start-over-dialog-desktop-light");
  await page.getByTestId("fin-sandbox-reset-confirm").click();
  await page.waitForTimeout(1500);
  check("start over archives the old sandbox", Boolean((await q1("select sandbox_archived_at from public.fin_books where id = $1", [sbx.id])).sandbox_archived_at));
  await page.getByTestId("fin-sandbox-banner").waitFor({ timeout: 15000 });
  await page.getByTestId("fin-sandbox-leave").click();
  await page.getByTestId("fin-sandbox-enter").waitFor({ timeout: 15000 });
  check("back to real books hides the banner", (await page.getByTestId("fin-sandbox-banner").count()) === 0);
  await ctx.close();
}
{
  const { ctx, page } = await open(`/financials/jobs/${KITCHEN}`);
  await page.getByTestId("fin-job").waitFor({ timeout: 15000 });
  check("job page shows the real job again", (await page.getByTestId("fin-job").innerText()).includes(String(realJobNo)));
  await ctx.close();
}

await browser.close(); await db.end();
check(`no page errors or 5xx (${errors.length})`, errors.length === 0);
if (errors.length) console.log(errors.join("\n"));
console.log(out.join("\n"));
