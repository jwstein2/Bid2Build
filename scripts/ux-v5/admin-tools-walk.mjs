// Owner admin "Tools" menu regression walk (James's tests A–H + every Tools destination).
// Real Chromium, real clicks/keys; assertions on visibility, URL and focus. Mock Supabase, test data only.
//   MOCK_ADMIN=1 MOCK_COMMAND_CENTER=1 node scripts/ux-audit/mock-supabase.mjs   (+ `next start` on :3000)
//   node scripts/ux-v5/admin-tools-walk.mjs <screenshotDir>
// Exit code 1 if any check fails.
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const dir = process.argv[2] ?? "admin-tools-shots";
fs.mkdirSync(dir, { recursive: true });
const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };
const A = process.env.BASE ?? "http://localhost:3000";
const out = []; const check = (n, c) => { out.push(`${c ? "✓" : "✗"} ${n}`); return c; };
const browser = await chromium.launch();
const errors = [];

async function page(vp = { width: 1440, height: 1000 }, path = "/admin") {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
  await ctx.addCookies([authCookie]);
  const p = await ctx.newPage();
  p.setDefaultTimeout(6000);
  p.on("pageerror", (e) => errors.push(`${path}: ${e.message}`));
  ctxs.add(ctx);
  await p.goto(`${A}${path}`, { waitUntil: "load" });
  await p.waitForTimeout(700);
  return { ctx, p };
}
// The trigger and its panel, found by what the user sees (works for the old <details> and the new button).
const trigger = (p) => p.getByRole("navigation", { name: "Owner command center" }).getByText("Tools ▾", { exact: true });
const nav = (p) => p.getByRole("navigation", { name: "Owner command center" });
const navLink = (p, name) => nav(p).getByRole("link", { name, exact: true });
const firstTool = (p) => navLink(p, "Tech Stack & Costs");
const menuVisible = async (p) => firstTool(p).isVisible();
const focusOnTrigger = (p) => p.evaluate(() => (document.activeElement?.textContent ?? "").trim() === "Tools ▾");
async function openMenu(p) { await trigger(p).click(); await p.waitForTimeout(150); return menuVisible(p); }
// Make sure it's open before choosing a tool (on the old build a menu left open from an earlier step would be toggled shut).
async function ensureOpen(p) { if (!(await menuVisible(p))) await openMenu(p); }
// Run one scenario; if an interaction can't be done at all (e.g. the menu is stuck shut/open), record it as a failure and go on.
const ctxs = new Set();
async function scenario(name, fn) {
  try { await fn(); } catch (e) { check(`${name}: could not complete (${String(e.message).split("\n")[0].slice(0, 90)})`, false); }
  for (const c of ctxs) await c.close().catch(() => {}); ctxs.clear();
}

// A. Outside click on a non-interactive area.
await scenario("A", async () => {
  const { p } = await page();
  check("A1 click Tools opens the menu", await openMenu(p));
  await p.screenshot({ path: `${dir}/A-tools-open.png` });
  await p.locator("h1").first().click({ position: { x: 5, y: 5 } }); await p.waitForTimeout(200);
  check("A2 click outside (page heading) closes the menu", !(await menuVisible(p)));
  await p.screenshot({ path: `${dir}/A-after-outside-click.png` });
  await openMenu(p);
  await p.mouse.click(30, 900); await p.waitForTimeout(200);
  check("A3 click outside (empty page area) closes the menu", !(await menuVisible(p)));
});
// B. Select destinations (representative here; every destination below).
for (const [label, href] of [["Tech Stack & Costs", "/admin/costs"], ["Complimentary access", "/admin/complimentary"], ["Opportunity Radar", "/admin/marketing/radar"]]) await scenario(`B ${label}`, async () => {
  const { p } = await page();
  await openMenu(p);
  await navLink(p, label).click();
  await p.waitForURL(`**${href}`, { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(500);
  const ok = check(`B select "${label}" → ${href} loads and the menu is closed`, new URL(p.url()).pathname === href && !(await menuVisible(p)));
  await p.screenshot({ path: `${dir}/B-${href.replace(/\//g, "_")}${ok ? "" : "-FAIL"}.png` });
});
// C. Escape.
await scenario("C", async () => {
  const { p } = await page();
  await openMenu(p);
  await p.keyboard.press("Escape"); await p.waitForTimeout(150);
  check("C1 Escape closes the menu", !(await menuVisible(p)));
  check("C2 focus returns to the Tools button", await focusOnTrigger(p));
  await trigger(p).focus(); await p.keyboard.press("Enter"); await p.waitForTimeout(150);
  check("C3 keyboard: Enter on Tools opens it and focus moves into the menu", (await menuVisible(p)) && await p.evaluate(() => document.activeElement?.tagName === "A"));
  await p.keyboard.press("ArrowDown");
  check("C4 keyboard: ArrowDown moves to the next tool", await p.evaluate(() => document.activeElement?.textContent === "Scaling forecast"));
  await p.keyboard.press("Escape"); await p.waitForTimeout(150);
  check("C5 Escape from inside the menu closes it and returns focus", !(await menuVisible(p)) && (await focusOnTrigger(p)));
});
// D. Toggle.
await scenario("D", async () => {
  const { p } = await page();
  check("D1 click Tools opens", await openMenu(p));
  await trigger(p).click(); await p.waitForTimeout(150);
  check("D2 click Tools again closes", !(await menuVisible(p)));
  check("D3 click Tools a third time opens again", await openMenu(p));
});
// E. Navigation to another top-level section, then Back / Forward.
await scenario("E", async () => {
  const { p } = await page();
  await openMenu(p);
  await navLink(p, "Revenue").click();
  await p.waitForURL("**/admin/revenue", { timeout: 15000 }).catch(() => {}); await p.waitForTimeout(500);
  check("E1 clicking Revenue (top nav) while Tools is open navigates and closes Tools", p.url().endsWith("/admin/revenue") && !(await menuVisible(p)));
  await p.goBack(); await p.waitForTimeout(800);
  check("E2 Back to Overview: Tools is not open", new URL(p.url()).pathname === "/admin" && !(await menuVisible(p)));
  await p.goForward(); await p.waitForTimeout(800);
  check("E3 Forward to Revenue: Tools is not open", p.url().endsWith("/admin/revenue") && !(await menuVisible(p)));
  await ensureOpen(p);
  await navLink(p, "Metric definitions").click(); await p.waitForTimeout(800);
  await p.goBack(); await p.waitForTimeout(800);
  check("E4 Back after choosing a tool: Tools is not open", !(await menuVisible(p)));
});
// F. Another popover/menu on the page closes Tools (KPI card drawer, a dialog).
await scenario("F", async () => {
  const { p } = await page(undefined, "/admin/revenue");
  await openMenu(p);
  const kpi = p.locator("[data-metric-drawer]").first();
  if (await kpi.count()) {
    await kpi.click(); await p.waitForTimeout(400);
    check("F1 opening a KPI drawer (Revenue) closes Tools", !(await menuVisible(p)) && (await p.getByRole("dialog").count()) > 0);
    await p.keyboard.press("Escape"); await p.waitForTimeout(300);
    check("F2 Escape closes the drawer; Tools stays closed", (await p.getByRole("dialog").count()) === 0 && !(await menuVisible(p)));
  } else check("F KPI drawer present on Revenue", false);
  // The range selector and test-data toggle are links, not menus: clicking one with Tools open must close Tools and work.
  await ensureOpen(p);
  // At 1440 the open menu sits over "90 days"/"12 months" (a click there lands on the menu, as it should), so use the
  // visible left edge of "7 days".
  await p.getByRole("link", { name: "7 days" }).first().click({ position: { x: 5, y: 14 } }); await p.waitForTimeout(800);
  check("F3 clicking a range link with Tools open: range applies and Tools closes", p.url().includes("range=7d") && !(await menuVisible(p)));
});
// G. Phone width (390) and tablet (768).
for (const vp of [{ width: 390, height: 844 }, { width: 768, height: 1024 }]) await scenario(`G${vp.width}`, async () => {
  const { p } = await page(vp);
  await trigger(p).scrollIntoViewIfNeeded();
  check(`G${vp.width} tap Tools opens`, await openMenu(p));
  const box = await firstTool(p).locator("xpath=..").boundingBox();
  check(`G${vp.width} menu fits on screen`, !!box && box.x >= 0 && box.x + box.width <= vp.width + 1);
  await p.screenshot({ path: `${dir}/G-${vp.width}-open.png` });
  await p.mouse.click(vp.width - 10, vp.height - 10); await p.waitForTimeout(200);
  check(`G${vp.width} tap outside closes`, !(await menuVisible(p)));
  await ensureOpen(p);
  await navLink(p, "Audit log").click(); await p.waitForURL("**/admin/audit", { timeout: 15000 }).catch(() => {}); await p.waitForTimeout(500);
  check(`G${vp.width} tap a tool navigates and closes`, p.url().endsWith("/admin/audit") && !(await menuVisible(p)));
});
// H. Dark command-center pages and light admin pages.
for (const [path, theme] of [["/admin", "dark"], ["/admin/templates", "light"], ["/admin/flags", "light"]]) await scenario(`H ${path}`, async () => {
  const { p } = await page(undefined, path);
  check(`H ${theme} (${path}) opens`, await openMenu(p));
  await p.screenshot({ path: `${dir}/H-${theme}${path.replace(/\//g, "_")}-open.png` });
  await p.mouse.click(30, 900); await p.waitForTimeout(200);
  check(`H ${theme} (${path}) outside click closes`, !(await menuVisible(p)));
  await openMenu(p); await p.keyboard.press("Escape"); await p.waitForTimeout(150);
  check(`H ${theme} (${path}) Escape closes`, !(await menuVisible(p)));
});
// Every Tools destination: click, route, menu closed, page loaded, a way back.
const TOOLS = [["Tech Stack & Costs", "/admin/costs"], ["Scaling forecast", "/admin/costs/forecast"], ["Business Scorecard", "/admin/revenue/scorecard"], ["Complimentary access", "/admin/complimentary"],
  ["Creator Partnerships", "/admin/creators"], ["Bids by state", "/admin/states"], ["Metric definitions", "/admin/definitions"], ["Opportunity Radar", "/admin/marketing/radar"],
  ["Outreach funnel (Sales)", "/admin/sales"], ["Referrals", "/admin/referrals"], ["Market intelligence", "/admin/market"], ["Trade templates", "/admin/templates"],
  ["Scope & exclusions", "/admin/proposal-text"], ["Feature flags", "/admin/flags"], ["Import & PDF errors", "/admin/logs"], ["Audit log", "/admin/audit"], ["Pricing integrations", "/settings/pricing"]];
const rows = [];
for (const [label, href] of TOOLS) await scenario(`Tool "${label}"`, async () => {
  const { p } = await page(undefined, "/admin/operations");
  {
    await p.goto(`${A}/admin/operations`, { waitUntil: "load" }); await p.waitForTimeout(300);
    await ensureOpen(p);
    const resp = p.waitForResponse((r) => new URL(r.url()).pathname === href && r.request().resourceType() === "document", { timeout: 4000 }).catch(() => null);
    await navLink(p, label).click();
    await p.waitForURL(`**${href}`, { timeout: 15000 }).catch(() => {}); await p.waitForTimeout(600);
    const at = new URL(p.url()).pathname;
    const closed = !(await menuVisible(p));
    const h1 = (await p.locator("h1").first().textContent().catch(() => ""))?.trim() ?? "";
    const crashed = (await p.getByText(/Something went wrong|This page could not be found|Application error/i).count()) > 0;
    const back = (await p.getByRole("link", { name: /^(Overview|Owner|Admin|Back|← )/ }).count()) > 0 || (await p.locator('a[href="/admin"]').count()) > 0;
    await resp;
    const pass = at === href && closed && !crashed && h1.length > 0;
    rows.push({ label, href, at, closed, h1, crashed, back });
    check(`Tool "${label}" → ${href}: route ${at === href ? "ok" : at}, menu ${closed ? "closed" : "OPEN"}, page "${h1.slice(0, 40)}"${crashed ? " CRASHED" : ""}, way back ${back ? "yes" : "NO"}`, pass);
    await p.screenshot({ path: `${dir}/tool${href.replace(/\//g, "_")}${pass ? "" : "-FAIL"}.png` });
  }
});
fs.writeFileSync(`${dir}/tools-destinations.json`, JSON.stringify(rows, null, 2));
await browser.close();
const real = errors.filter((e) => !/hydrat/i.test(e));
check(`no page errors (${real.length})`, real.length === 0);
if (real.length) console.log(real.slice(0, 8).join("\n"));
console.log(out.join("\n"));
const failed = out.filter((l) => l.startsWith("✗")).length;
console.log(`${out.length - failed}/${out.length} passed`);
process.exit(failed ? 1 : 0);
