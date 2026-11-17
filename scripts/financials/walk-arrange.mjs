// Financials home: press-and-hold drag for "Your cards" and quick actions, plus choosing quick actions in
// Customize. Same throwaway setup as walk.mjs (TEST DATA ONLY). Usage:
//   NODE_PATH=<dir with playwright> node scripts/financials/walk-arrange.mjs <screenshotDir>
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");
const { Client } = require("pg");

const dir = process.argv[2] ?? "financials-arrange-shots";
fs.mkdirSync(dir, { recursive: true });
const ME = "00000000-0000-4000-8000-000000000001";
const user = { id: ME, aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };
const M = "http://localhost:54321", A = "http://localhost:3000";
const out = []; const check = (n, c, extra = "") => { out.push(`${c ? "✓" : "✗"} ${n}${extra ? ` (${extra})` : ""}`); if (!c) process.exitCode = 1; };
const db = new Client({ connectionString: process.env.RADAR_PG_URL }); await db.connect();
const book = (await db.query("select id from public.fin_books limit 1")).rows[0].id;
const myPrefs = async () => (await db.query("select cards, quick_actions from public.fin_dashboard_prefs where book_id = $1 and scope = 'user' and user_id = $2", [book, ME])).rows[0] ?? null;
await db.query("delete from public.fin_dashboard_prefs where book_id = $1 and scope = 'user'", [book]);
await fetch(`${M}/__as?user=${ME}`);
await fetch(`${M}/__onboarding?status=completed`);
await fetch(`${M}/__features?created=${encodeURIComponent(new Date().toISOString())}`);

const browser = await chromium.launch();
const errors = [];
async function open(opts) {
  const ctx = await browser.newContext(opts);
  await ctx.addCookies([authCookie]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => { if (r.url().includes("/api/financials") && r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${A}/financials`, { waitUntil: "networkidle" });
  await page.getByTestId("fin-home").waitFor({ timeout: 15000 });
  return { ctx, page };
}
const order = (page, id) => page.$$eval(`[data-testid=${id}] > li`, (ls) => ls.map((l) => l.getAttribute("data-sort-key")));
const center = async (loc) => { await loc.scrollIntoViewIfNeeded(); const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
async function waitSaved(page, id) { await page.locator(`[data-testid=${id}] + p`).filter({ hasText: "Saved" }).waitFor({ timeout: 10000 }); await page.waitForLoadState("networkidle"); }

// 1. Desktop mouse: hold 600 ms, drag the first card onto the third, let go.
{
  const { ctx, page } = await open({ viewport: { width: 1440, height: 1000 } });
  const before = await order(page, "fin-cards-grid");
  check("desktop: Your cards is arrangeable", before.length >= 3, before.join(","));
  const first = page.locator("[data-testid=fin-cards-grid] > li").nth(0), third = page.locator("[data-testid=fin-cards-grid] > li").nth(2);
  const a = await center(first), b = await center(third);
  // A quick click still navigates (sanity: href present), a hold does not.
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.waitForTimeout(600);
  check("desktop: holding lifts the card", (await page.getAttribute("[data-testid=fin-cards-grid]", "data-dragging")) === before[0]);
  await page.screenshot({ path: path.join(dir, "01-desktop-lifted.png") });
  await page.mouse.move(b.x, b.y, { steps: 12 }); await page.mouse.up();
  await waitSaved(page, "fin-cards-grid");
  const after = await order(page, "fin-cards-grid");
  check("desktop: card moved to the third spot and stayed after refresh", after[2] === before[0] && page.url().endsWith("/financials"), after.join(","));
  const prefs = await myPrefs();
  check("desktop: saved as my own layout", Boolean(prefs) && prefs.cards.map((c) => c.key).indexOf(before[0]) > prefs.cards.map((c) => c.key).indexOf(before[1]));
  await page.reload({ waitUntil: "networkidle" });
  check("desktop: order survives a reload", (await order(page, "fin-cards-grid"))[2] === before[0]);
  // Escape cancels.
  const now = await order(page, "fin-cards-grid");
  const c0 = await center(page.locator("[data-testid=fin-cards-grid] > li").nth(0)), c1 = await center(page.locator("[data-testid=fin-cards-grid] > li").nth(1));
  await page.mouse.move(c0.x, c0.y); await page.mouse.down(); await page.waitForTimeout(600);
  await page.mouse.move(c1.x, c1.y, { steps: 8 }); await page.keyboard.press("Escape"); await page.mouse.up();
  await page.waitForTimeout(300);
  check("desktop: Esc puts the card back", (await order(page, "fin-cards-grid")).join() === now.join() && page.url().endsWith("/financials"));
  // A normal click still opens the card.
  const href = await page.locator("[data-testid=fin-cards-grid] > li a").first().getAttribute("href");
  await page.locator("[data-testid=fin-cards-grid] > li a").first().click();
  await page.waitForURL((u) => !u.pathname.endsWith("/financials"), { timeout: 10000 }).catch(() => {});
  check("desktop: a quick click still opens the card", !page.url().endsWith("/financials"), `${href} -> ${page.url()}`);
  await ctx.close();
}

// 2. Quick actions: drag on desktop, then choose them in Customize.
{
  const { ctx, page } = await open({ viewport: { width: 1440, height: 1000 } });
  const before = await order(page, "fin-quick-row");
  check("quick actions are arrangeable", before.length >= 2, before.join(","));
  const a = await center(page.locator("[data-testid=fin-quick-row] > li").nth(0)), b = await center(page.locator("[data-testid=fin-quick-row] > li").nth(1));
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.waitForTimeout(600);
  await page.mouse.move(b.x + 10, b.y, { steps: 10 }); await page.mouse.up();
  await waitSaved(page, "fin-quick-row");
  const after = await order(page, "fin-quick-row");
  check("quick action moved and saved", after[1] === before[0] && (await myPrefs())?.quick_actions?.[1] === before[0], after.join(","));
  await page.waitForTimeout(500);
  await page.getByTestId("fin-customize-toggle").click();
  const box = page.getByTestId("fin-customize-quick");
  check("Customize says these are my picks", await box.getByText("You picked these.").isVisible());
  await box.getByLabel("Export for your accountant").check();
  await page.screenshot({ path: path.join(dir, "02-customize-quick.png"), fullPage: false });
  await box.screenshot({ path: path.join(dir, "03-customize-quick-panel.png") });
  await page.getByTestId("fin-customize-save").click();
  await page.locator("#fin-customize").getByText("Saved for you.").waitFor({ timeout: 10000 });
  await page.waitForFunction(() => [...document.querySelectorAll("[data-testid=fin-quick-row] > li")].some((l) => l.dataset.sortKey === "export"), null, { timeout: 8000 }).catch(() => {});
  const q = await order(page, "fin-quick-row");
  check("added quick action shows last on the home page", q.at(-1) === "export" && (await myPrefs()).quick_actions.at(-1) === "export", q.join(","));
  check("Customize kept the order I dragged", q[0] === after[0] && q[1] === after[1], q.join(","));
  await box.getByRole("button", { name: "Use the default quick actions" }).click();
  await page.getByTestId("fin-customize-save").click();
  await page.waitForTimeout(1500); await page.waitForLoadState("networkidle");
  check("back to the trade's quick actions", (await myPrefs()).quick_actions === null && !(await order(page, "fin-quick-row")).includes("export"));
  await ctx.close();
}

// 3. Phone (touch): press and hold, drag, let go. Page must not scroll while dragging.
{
  const { ctx, page } = await open({ ...devices["iPhone 13"] });
  const cdp = await ctx.newCDPSession(page);
  const grid = page.getByTestId("fin-cards-grid");
  await grid.scrollIntoViewIfNeeded();
  const before = await order(page, "fin-cards-grid");
  const a = await center(page.locator("[data-testid=fin-cards-grid] > li").nth(0)), b = await center(page.locator("[data-testid=fin-cards-grid] > li").nth(1));
  const touch = (type, p) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: p ? [{ x: p.x, y: p.y }] : [] });
  const y0 = await page.evaluate(() => scrollY);
  await touch("touchStart", a); await page.waitForTimeout(650);
  check("phone: holding lifts the card", (await page.getAttribute("[data-testid=fin-cards-grid]", "data-dragging")) === before[0]);
  for (let i = 1; i <= 10; i++) { await touch("touchMove", { x: a.x, y: a.y + ((b.y + 10 - a.y) * i) / 10 }); await page.waitForTimeout(30); }
  await page.screenshot({ path: path.join(dir, "04-phone-dragging.png") });
  await touch("touchEnd");
  const y1 = await page.evaluate(() => scrollY);
  await waitSaved(page, "fin-cards-grid");
  const after = await order(page, "fin-cards-grid");
  check("phone: card moved down one", after[1] === before[0], after.join(","));
  check("phone: page didn't scroll during the drag", Math.abs(y1 - y0) < 5, `${y0} -> ${y1}`);
  check("phone: still on the Financials home (no navigation)", page.url().endsWith("/financials"));
  check("phone: no horizontal scroll", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  // A normal swipe still scrolls.
  await touch("touchStart", a); for (let i = 1; i <= 6; i++) { await touch("touchMove", { x: a.x, y: a.y - 40 * i }); await page.waitForTimeout(16); } await touch("touchEnd");
  await page.waitForTimeout(400);
  check("phone: a quick swipe doesn't pick a card up", (await page.getAttribute("[data-testid=fin-cards-grid]", "data-dragging")) === null);
  await page.screenshot({ path: path.join(dir, "05-phone-after.png") });
  await ctx.close();
}

check("no page errors or failed Financials requests", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(out.join("\n"));
await browser.close(); await db.end();
