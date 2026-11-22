// Home card previews walk (TEST DATA ONLY: local DB from scripts/financials/setup-db.mjs + mock Supabase, same setup as scripts/mobile-dashboard/walk.mjs).
// Usage: node scripts/home-card-previews/walk.mjs <screenshotDir>
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");
const dir = process.argv[2];
const ME = "00000000-0000-4000-8000-000000000001";
const user = { id: ME, aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: ME, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };
const M = "http://localhost:54321", A = "http://localhost:3000";
const out = []; const check = (n, c, x = "") => { out.push(`${c ? "✓" : "✗"} ${n}${x ? ` (${x})` : ""}`); if (!c) process.exitCode = 1; };
await fetch(`${M}/__onboarding?status=completed`).catch(() => {});
await fetch(`${M}/__features?created=${encodeURIComponent(new Date().toISOString())}`).catch(() => {});
const browser = await chromium.launch();
const errors = [];
async function open(w, h, phone, theme = "light") {
  const ctx = await browser.newContext(phone ? { ...devices["iPhone 13"], viewport: { width: w, height: h }, deviceScaleFactor: 2 } : { viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await ctx.addCookies([authCookie]);
  await ctx.addInitScript((m) => { try { localStorage.setItem("b2b-theme", JSON.stringify({ mode: m, at: Date.now() })); localStorage.setItem("b2b:welcome-seen", "1"); } catch {} }, theme);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${w}: ${e.message}`));
  await page.goto(`${A}/home`, { waitUntil: "load" });
  await page.getByTestId("dashboard-builder").waitFor({ timeout: 30000 });
  for (const name of ["Maybe Later", "Skip", "Close"]) { const b = page.getByRole("button", { name, exact: true }).first(); if (await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); await page.waitForTimeout(300); } }
  await page.waitForTimeout(500);
  return { ctx, page };
}
const CARDS = ["widget-fin_ar", "widget-fin_cash_received", "widget-sales_drafts", "widget-sales_win_rate"];
for (const [w, h, phone, theme] of [[390, 844, true, "light"], [768, 1024, false, "light"], [1440, 900, false, "light"], [1440, 900, false, "dark"], [1024, 768, false, "light"]]) {
  const { ctx, page } = await open(w, h, phone, theme);
  const tag = `${w}-${theme}`;
  for (const id of CARDS) check(`${tag} ${id} shown`, await page.getByTestId(id).isVisible());
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`${tag} no horizontal scroll`, overflow <= 0, String(overflow));
  // row tap targets
  const small = await page.$$eval('[data-preview-card] li > a', (as) => as.filter((a) => a.getBoundingClientRect().height < 44).length);
  check(`${tag} preview rows ≥44px`, small === 0, String(small));
  const grid = page.getByTestId("dash-grid");
  await grid.scrollIntoViewIfNeeded();
  const box = await page.getByTestId("widget-fin_ar").boundingBox();
  await page.evaluate((y) => window.scrollTo(0, y - 80), (box?.y ?? 0) + (await page.evaluate(() => window.scrollY)));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${dir}/home-${tag}.png`, fullPage: true });
  if (w === 1440 && theme === "light") {
    const ar = await page.getByTestId("widget-fin_ar-rows").innerText();
    check("AR: overdue biggest first", ar.indexOf("Northwoods") < ar.indexOf("Morgan Lee"), ar.replace(/\n/g, " | ").slice(0, 200));
    check("AR: paid invoice not listed", !ar.includes("Sam Ortiz"));
    const pay = await page.getByTestId("widget-fin_cash_received").innerText();
    check("Collected: unverified PMT-0002 not listed", !pay.includes("PMT-0002") && !pay.includes("999.99"), pay.replace(/\n/g, " | "));
    check("Collected: verified listed", pay.includes("PMT-0001") && pay.includes("PMT-0003"));
    check("Collected headline = verified only", pay.includes("$8,650.00") && pay.includes("1 not yet verified"), pay.split("\n").slice(0, 4).join(" | "));
    await page.getByTestId("widget-fin_cash_received-explain").locator("summary").click();
    check("Collected explains its calculation", (await page.getByTestId("widget-fin_cash_received-explain").innerText()).includes("verified payments only"));
    await page.getByTestId("widget-fin_cash_received").screenshot({ path: `${dir}/card-fin_cash_received-explain.png` });
    const dr = await page.getByTestId("widget-sales_drafts").innerText();
    check("Drafts: most recent first", dr.indexOf("Northwoods") < dr.indexOf("Priya Patel") && dr.indexOf("Priya Patel") < dr.indexOf("Chris Johnson"), dr.replace(/\n/g, " | "));
    check("Drafts: View all drafts", dr.includes("View all drafts"));
    const wr = await page.getByTestId("widget-sales_win_rate").innerText();
    check("Win rate: bar + rows", (await page.getByTestId("win-loss-bar").count()) === 1 && wr.includes("View decided bids"), wr.replace(/\n/g, " | "));
    // truncation has tooltip
    const t = await page.getByTestId("widget-fin_ar-rows").locator("a").first().getAttribute("title");
    check("AR row has full-text tooltip", Boolean(t && t.includes("Northwoods Property Management Group of Greater Minneapolis LLC")), t ?? "");
    for (const id of CARDS) await page.getByTestId(id).screenshot({ path: `${dir}/card-${id.replace("widget-", "")}.png` });
    // keyboard: tab reaches a row and shows focus
    await page.getByTestId("widget-sales_drafts-rows").locator("a").first().focus();
    const focused = await page.evaluate(() => document.activeElement?.getAttribute("href"));
    check("keyboard focus lands on a draft row", Boolean(focused?.startsWith("/estimates/")), focused ?? "");
    await page.getByTestId("widget-sales_drafts").screenshot({ path: `${dir}/card-sales_drafts-focus.png` });
    // clicks
    const href = await page.getByTestId("widget-fin_ar-rows").locator("a").first().getAttribute("href");
    check("AR row → job invoices", /^\/financials\/jobs\/[0-9a-f-]+#fin-invoices$/.test(href ?? ""), href ?? "");
    await page.getByTestId("widget-fin_ar-rows").locator("a").first().click();
    await page.waitForURL(/financials\/jobs/, { timeout: 30000 });
    await page.getByTestId("fin-invoices").waitFor({ timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(800);
    const inView = await page.evaluate(() => { const r = document.getElementById("fin-invoices")?.getBoundingClientRect(); return r ? r.top < window.innerHeight && r.bottom > 0 : false; });
    check("job page scrolled to invoices", inView);
    await page.screenshot({ path: `${dir}/click-ar-row.png` });
    await page.goBack(); await page.getByTestId("dashboard-builder").waitFor();
    const ph = await page.getByTestId("widget-fin_cash_received").locator("li a").first().getAttribute("href");
    check("payment row → job payments", /#fin-payments$/.test(ph ?? ""), ph ?? "");
    const hl = await page.getByTestId("widget-fin_ar").locator("a").first().getAttribute("href");
    check("AR headline keeps receivables link", hl === "/financials/receivables?bucket=open", hl ?? "");
    const ft = await page.getByTestId("widget-fin_cash_received").locator("a").last().innerText();
    check("Collected keeps View records", ft.includes("View records"), ft);
  }
  await ctx.close();
}
check("no page errors", errors.length === 0, errors.join("; "));
console.log(out.join("\n"));
await browser.close();
