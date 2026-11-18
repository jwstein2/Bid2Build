// Browser walk for universal search (V6.4). The search SQL runs for real in a throwaway database through
// scripts/radar/pg-rest.mjs (as the signed-in demo owner); the rest of the app uses the UX mock. Test data only.
//   scripts/test-db.sh start
//   export RADAR_PG_URL=$(node scripts/universal-search/setup-db.mjs)
//   PG_REST_PREFIXES=search_ PG_REST_AS_USER=00000000-0000-4000-8000-000000000001 node scripts/ux-audit/mock-supabase.mjs &
//   (build + `next start` against the mock on :54321)
//   node scripts/universal-search/walk.mjs <screenshotDir>
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = process.argv[2] ?? "search-shots";
fs.mkdirSync(OUT, { recursive: true });
const world = JSON.parse(fs.readFileSync(process.env.SEARCH_WORLD_FILE ?? "/tmp/search-world.json", "utf8"));

const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600 * 24 * 365 * 50, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };
const browser = await chromium.launch();
async function ctxFor({ viewport = { width: 1280, height: 860 }, mobile = false, theme = null } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, hasTouch: mobile, isMobile: mobile });
  await ctx.addCookies([authCookie]);
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem("b2b:onboarding", JSON.stringify({ status: "dismissed", at: new Date().toISOString(), synced: true }));
      localStorage.setItem("b2b:walkthrough-seen", "1");
      if (t) localStorage.setItem("b2b-theme", JSON.stringify({ mode: t, at: Date.now() + 1e9 }));
    } catch { /* */ }
  }, theme);
  return ctx;
}
const errors = [];
const watch = (p) => p.on("pageerror", (e) => errors.push(String(e)));
const shot = (p, name) => p.screenshot({ path: path.join(OUT, `${name}.png`) });
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const typeAndWait = async (p, text) => {
  const input = p.getByTestId("global-search-input");
  await input.fill("");
  await Promise.all([p.waitForResponse((r) => r.url().includes("/api/search?") && r.url().includes(`q=${encodeURIComponent(text).replace(/%20/g, "+")}`), { timeout: 15000 }).catch(() => null), input.fill(text)]);
  await p.waitForTimeout(250);
};
const resultTexts = (p) => p.locator("[role=option]").allInnerTexts();
// Ctrl+K before React has hydrated does nothing (as for a real user on a slow load), so try again briefly.
const pressOpen = async (p) => {
  for (let i = 0; i < 10; i++) {
    await p.keyboard.press("Control+k");
    if (await p.getByTestId("global-search-dialog").isVisible().catch(() => false)) return;
    await p.waitForTimeout(500);
  }
};

// ---------- 1. Desktop: header field, Ctrl/Cmd+K, typing, keyboard, Escape ----------
{
  const ctx = await ctxFor();
  const p = await ctx.newPage(); watch(p);
  await p.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  const field = p.getByTestId("global-search-field");
  check("desktop header shows the search field", await field.isVisible());
  await p.screenshot({ path: path.join(OUT, "01-header-field__desktop.png"), clip: { x: 0, y: 0, width: 1280, height: 160 } });
  await p.locator("body").click({ position: { x: 5, y: 400 } });
  await pressOpen(p);
  const dialog = p.getByTestId("global-search-dialog");
  await dialog.waitFor({ timeout: 5000 });
  check("Ctrl+K opens the search dialog with the box focused", await p.getByTestId("global-search-input").evaluate((el) => el === document.activeElement));
  await p.waitForTimeout(400);
  const empty = await dialog.innerText();
  check("empty box shows quick actions (no records listed)", /New bid|Add customer/i.test(empty), empty.slice(0, 80).replace(/\n/g, " | "));
  await shot(p, "02-dialog-empty-quick-actions__desktop");

  await typeAndWait(p, "johnson");
  let texts = await resultTexts(p);
  check("'johnson' finds the customer, the kitchen bid and the project", texts.some((t) => /Michael Johnson/.test(t)) && texts.some((t) => /Johnson Kitchen Remodel/.test(t)), `${texts.length} options`);
  check("results show why they matched", /Exact name|Name starts with|Name contains|Related customer/i.test(texts.join("\n")));
  await shot(p, "03-dialog-johnson__desktop");

  const input = p.getByTestId("global-search-input");
  const a0 = await input.getAttribute("aria-activedescendant");
  await p.keyboard.press("ArrowDown"); await p.keyboard.press("ArrowDown");
  const a1 = await input.getAttribute("aria-activedescendant");
  check("arrow keys move the highlighted result (aria-activedescendant)", a0 && a1 && a0 !== a1, `${a0} → ${a1}`);
  await p.keyboard.press("ArrowUp"); await p.keyboard.press("ArrowUp");

  await typeAndWait(p, "jhonson");
  texts = await resultTexts(p);
  check("misspelling 'jhonson' still finds Michael Johnson, marked as similar spelling", texts.some((t) => /Michael Johnson/.test(t) && /Similar spelling/.test(t)));
  await shot(p, "04-dialog-typo__desktop");

  await typeAndWait(p, "1042");
  texts = await resultTexts(p);
  check("'1042' puts the exact project / estimate number first", /Exact (project|estimate) number/.test(texts.find((t) => !/^View all/.test(t)) ?? ""), (texts[0] ?? "").replace(/\n/g, " | "));
  await shot(p, "05-dialog-number__desktop");

  await typeAndWait(p, "overdue invoices");
  texts = await resultTexts(p);
  check("'overdue invoices' finds the overdue invoice", texts.some((t) => /Overdue/i.test(t) && /INV-/i.test(t)), texts.slice(0, 3).join(" || ").replace(/\n/g, " | "));
  await shot(p, "06-dialog-overdue-invoices__desktop");

  await typeAndWait(p, "record payment");
  const action = p.locator("[data-testid^=search-action-]").first();
  check("'record payment' offers the Record payment action", /Record payment/i.test(await action.innerText().catch(() => "")));
  await shot(p, "07-dialog-command-action__desktop");

  await typeAndWait(p, "shg-30-blk");
  texts = await resultTexts(p);
  check("supplier SKU finds the saved item", texts.some((t) => /Exact SKU/.test(t)));

  await typeAndWait(p, "qqqzzzxxx");
  check("no results shows a helpful empty state", await p.getByTestId("search-empty").isVisible());
  await shot(p, "08-dialog-no-results__desktop");

  await p.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden", timeout: 3000 });
  check("Escape closes the dialog", !(await dialog.isVisible()));

  // Header field click → type → Enter opens the highlighted record; focus goes back to the field on close.
  await field.click();
  await dialog.waitFor();
  await typeAndWait(p, "michael johnson");
  const firstHref = await p.locator("[data-testid^=search-result-]").first().getAttribute("data-href");
  await Promise.all([p.waitForURL((u) => u.pathname !== "/dashboard", { timeout: 15000 }).catch(() => null), p.keyboard.press("Enter")]);
  check("Enter opens the highlighted record", firstHref && p.url().includes(firstHref.split("#")[0]), `${firstHref} → ${p.url().replace(BASE, "")}`);

  // View all results keeps the query.
  await p.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  await pressOpen(p);
  await dialog.waitFor();
  await typeAndWait(p, "johnson");
  await Promise.all([p.waitForURL(/\/search\?/, { timeout: 15000 }), p.getByTestId("search-view-all").click()]);
  check("View all results opens /search with the query", new URL(p.url()).searchParams.get("q") === "johnson");
  await p.waitForLoadState("networkidle");
  await shot(p, "09-results-page__desktop");
  await p.getByTestId("search-cat-projects").click().catch(async () => p.locator("[data-testid^=search-cat-]").nth(3).click());
  await p.waitForURL(/type=/, { timeout: 10000 }).catch(() => null);
  await p.waitForLoadState("networkidle");
  const filtered = p.url();
  check("category filter goes into the URL (deep-linkable)", /type=/.test(filtered), filtered.replace(BASE, ""));
  await shot(p, "10-results-page-category__desktop");
  await p.goBack(); await p.waitForLoadState("networkidle");
  check("Back returns to the earlier query and filters", new URL(p.url()).searchParams.get("q") === "johnson" && !/type=/.test(p.url()));
  await ctx.close();
}

// ---------- 2. Mobile 390px: icon → full screen, autofocus, no overflow ----------
{
  const ctx = await ctxFor({ viewport: { width: 390, height: 844 }, mobile: true });
  const p = await ctx.newPage(); watch(p);
  await p.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  const icon = p.getByTestId("global-search-icon").first();
  check("mobile header shows a search icon", await icon.isVisible());
  await icon.tap();
  const dialog = p.getByTestId("global-search-dialog");
  await dialog.waitFor();
  const box = await dialog.boundingBox();
  check("mobile search is full screen", box && box.width >= 388 && box.height >= 800, box ? `${Math.round(box.width)}×${Math.round(box.height)}` : "");
  check("mobile search box is focused", await p.getByTestId("global-search-input").evaluate((el) => el === document.activeElement));
  await typeAndWait(p, "bright electric");
  const texts = await resultTexts(p);
  check("'bright electric' finds the sub, the vendor and the vendor bill", texts.some((t) => /Bright Electric/.test(t)) && texts.some((t) => /bill|BE-7781/i.test(t)), `${texts.length} options`);
  check("mobile 390px: no horizontal overflow", (await overflow(p)) <= 0);
  await shot(p, "11-mobile-full-screen__m390");
  await p.getByRole("button", { name: /close/i }).first().tap().catch(() => p.keyboard.press("Escape"));
  await p.goto(`${BASE}/search?q=johnson`, { waitUntil: "networkidle" });
  check("results page 390px: no horizontal overflow", (await overflow(p)) <= 0);
  await shot(p, "12-results-page__m390");
  await ctx.close();
}

// ---------- 2b. Phone headers with the new search icon fit from 320px up ----------
for (const width of [320, 360, 390, 430]) {
  const ctx = await ctxFor({ viewport: { width, height: 800 }, mobile: true });
  const p = await ctx.newPage(); watch(p);
  for (const route of ["/dashboard", "/bids"]) {
    await p.goto(`${BASE}${route}`, { waitUntil: "load" });
    await p.waitForTimeout(1200);
    const inner = await p.evaluate(() => window.innerWidth);
    check(`${route} at ${width}px: header fits (no zoom-out / overflow)`, inner === width && (await overflow(p)) <= 0, `innerWidth ${inner}`);
    if (width === 320) await p.screenshot({ path: path.join(OUT, `16-header${route.replace(/\//g, "-")}__m320.png`), clip: { x: 0, y: 0, width, height: 140 } });
  }
  await ctx.close();
}

// ---------- 3. Dark mode ----------
{
  const ctx = await ctxFor({ theme: "dark" });
  const p = await ctx.newPage(); watch(p);
  await p.goto(`${BASE}/dashboard`, { waitUntil: "load" });
  await p.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await pressOpen(p);
  await p.getByTestId("global-search-dialog").waitFor();
  await typeAndWait(p, "johnson");
  const bg = await p.getByTestId("global-search-dialog").evaluate((el) => getComputedStyle(el).backgroundColor);
  check("dark mode: dialog uses the dark surface", !/rgb\(255, 255, 255\)/.test(bg), bg);
  await shot(p, "13-dialog-johnson__desktop-dark");
  await p.keyboard.press("Escape");
  await p.goto(`${BASE}/search?q=johnson`, { waitUntil: "load" });
  await p.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await p.waitForTimeout(200);
  await shot(p, "14-results-page__desktop-dark");
  await ctx.close();
}

// ---------- 4. Sandbox (practice) mode: only practice invoices ----------
{
  const pg = require("pg");
  const db = new pg.Client({ connectionString: process.env.RADAR_PG_URL }); await db.connect();
  const asOwner = async (sql, args = []) => { await db.query("begin"); await db.query("set local role authenticated"); await db.query("select set_config('request.jwt.claim.sub', $1, true)", [user.id]); await db.query(sql, args); await db.query("commit"); };
  await asOwner("select public.fin_sandbox_enter($1)", [world.book]);
  const ctx = await ctxFor();
  const p = await ctx.newPage(); watch(p);
  await p.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  await pressOpen(p);
  await p.getByTestId("global-search-dialog").waitFor();
  await typeAndWait(p, "invoices");
  const texts = await resultTexts(p);
  const inv = texts.filter((t) => /INV-/.test(t));
  check("practice mode: invoice results are practice copies only, labelled Practice", inv.length > 0 && inv.every((t) => /SBX-INV-/.test(t) && /Practice/.test(t)), inv.join(" || ").replace(/\n/g, " | "));
  await shot(p, "15-dialog-practice-mode__desktop");
  await ctx.close();
  await asOwner("select public.fin_sandbox_leave()");
  await db.end();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed; page errors: ${errors.length}`);
if (errors.length) console.log(errors.slice(0, 5).join("\n"));
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ results, errors }, null, 2));
process.exit(failed.length ? 1 : 0);
