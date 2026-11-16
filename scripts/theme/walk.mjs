// Browser walk for the customer Light/Dark toggle. Local build against the mock Supabase (test data only,
// NOT production):
//   NEXT_PUBLIC_PROJECT_SCHEDULING=on NEXT_PUBLIC_ESIGNATURES=on npm run build && next start
//   MOCK_PIPELINE=1 MOCK_ESIGN_FIXTURE=/tmp/esign-fixture.json node scripts/ux-audit/mock-supabase.mjs &
//   node scripts/theme/walk.mjs <screenshotDir>
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const dir = process.argv[2] ?? "theme-shots";
fs.mkdirSync(dir, { recursive: true });
const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };
const M = "http://localhost:54321", A = "http://localhost:3000";
const EST = "11111111-1111-4111-8111-111111111111";
const out = []; const check = (n, c) => out.push(`${c ? "✓" : "✗"} ${n}`);
const errors = [];

await fetch(`${M}/__onboarding?status=completed`);
await fetch(`${M}/__features?created=${encodeURIComponent(new Date().toISOString())}`); // also clears saved theme
await fetch(`${M}/__scenario?name=unlimited`);
await fetch(`${M}/__sched?reset=1&stage=won`);
await fetch(`${M}/__pm?state=${encodeURIComponent(JSON.stringify({ scope: "individual", companyId: null, editorLimit: 1, editorsAssigned: 1, canEdit: true, source: "subscription", editUntil: null, addon: true, addonUntil: null, extraEditors: 0 }))}`);
const accountTheme = async () => (await (await fetch(`${M}/auth/v1/user`)).json()).user_metadata?.b2b_theme ?? null;

const browser = await chromium.launch();
const DESK = { width: 1440, height: 1000 }, PHONE = { width: 390, height: 844 };
async function ctx(vp, { auth = true, isMobile = false } = {}) {
  const c = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, isMobile, hasTouch: isMobile });
  if (auth) await c.addCookies([authCookie]);
  // Record the page background on the very first animation frame (catches any light flash).
  await c.addInitScript(() => {
    requestAnimationFrame(() => { window.__firstBg = getComputedStyle(document.body || document.documentElement).backgroundColor; });
  });
  return c;
}
async function open(c, path) {
  const page = await c.newPage();
  page.on("pageerror", (e) => errors.push(`${path}: ${e.message}`));
  await page.goto(`${A}${path}`, { waitUntil: "load" });
  await page.waitForTimeout(1800);
  await dismiss(page);
  return page;
}
/** Closes the "Unlocked" / What's New pop-ups the mock account can trigger, so they don't block clicks. */
async function dismiss(page) {
  for (let i = 0; i < 3; i++) {
    const dlg = page.getByRole("dialog").filter({ visible: true });
    if (!(await dlg.count())) return;
    const later = page.getByRole("button", { name: /Maybe Later|Not now|Close/i }).filter({ visible: true });
    if (await later.count()) await later.first().click(); else await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
}
const bg = (page, sel = "body") => page.evaluate((s) => getComputedStyle(document.querySelector(s)).backgroundColor, sel);
const isDark = (rgb) => { const [r, g, b] = rgb.match(/\d+/g).map(Number); return (r + g + b) / 3 < 60; };
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const shot = (page, name, fullPage = true) => page.screenshot({ path: `${dir}/${name}.png`, fullPage });

// 1. Default is light; one click switches instantly without a reload; saved to device + account.
{
  const c = await ctx(DESK);
  const page = await open(c, "/dashboard");
  check("new user defaults to Light", !isDark(await bg(page)) && (await page.getAttribute("html", "data-theme")) === null);
  await shot(page, "dashboard-light-desktop", false);
  const toggle = page.getByTestId("theme-toggle").filter({ visible: true });
  check("desktop: one sun/moon toggle visible top right", (await toggle.count()) === 1 && (await toggle.boundingBox()).x > DESK.width - 120 && (await toggle.boundingBox()).y < 80);
  check("toggle is labelled and reports its state", (await toggle.getAttribute("aria-label")) === "Dark mode" && (await toggle.getAttribute("aria-pressed")) === "false");
  await page.evaluate(() => { window.__noReload = true; });
  await dismiss(page);
  await toggle.click();
  await page.waitForTimeout(150);
  check("one click switches to Dark immediately", isDark(await bg(page)) && (await toggle.getAttribute("aria-pressed")) === "true");
  check("no page reload", await page.evaluate(() => window.__noReload === true));
  check("saved on this device", (await page.evaluate(() => JSON.parse(localStorage.getItem("b2b-theme")).mode)) === "dark");
  await page.waitForTimeout(800);
  check("saved to the account profile", (await accountTheme())?.mode === "dark");
  await shot(page, "dashboard-dark-desktop", false);
  // Keyboard: focus ring visible and Enter toggles back.
  await toggle.focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(150);
  check("keyboard Enter switches back to Light", !isDark(await bg(page)));
  await page.keyboard.press("Space");
  await page.waitForTimeout(150);
  check("keyboard Space switches to Dark", isDark(await bg(page)));
  const ring = await toggle.evaluate((el) => getComputedStyle(el).outlineStyle);
  check("visible focus indicator on the toggle", ring !== "none");
  await page.reload({ waitUntil: "load" });
  check("reload stays Dark with no light first frame", isDark(await page.evaluate(() => window.__firstBg)) && isDark(await bg(page)));
  await c.close();
}

// 2. Every major customer screen in Dark (desktop + phone), and Light screenshots for comparison.
const ROUTES = [
  ["dashboard-pipeline", "/dashboard"],
  ["customers", "/dashboard/customers"],
  ["saved-items", "/dashboard/items"],
  ["templates", "/dashboard/templates"],
  ["projects", "/projects"],
  ["estimate-builder", `/estimates/${EST}`],
  ["company-profile", "/settings/company"],
  ["billing", "/settings/billing"],
  ["account-settings", "/settings/account"],
  ["pricing-data", "/settings/pricing"],
  ["whats-new", "/whats-new"],
];
const setDark = (c) => c.addInitScript(() => { try { if (!localStorage.getItem("b2b-theme")) localStorage.setItem("b2b-theme", JSON.stringify({ mode: "dark", at: Date.now() })); } catch {} });
for (const [vpName, vp, isMobile] of [["desktop", DESK, false], ["m390", PHONE, true]]) {
  const c = await ctx(vp, { isMobile });
  await setDark(c);
  for (const [id, path] of ROUTES) {
    const page = await open(c, path);
    check(`${vpName} ${id}: dark from the first frame`, isDark(await page.evaluate(() => window.__firstBg)) && isDark(await bg(page)));
    check(`${vpName} ${id}: toggle reachable`, (await page.getByTestId("theme-toggle").filter({ visible: true }).count()) >= 1);
    check(`${vpName} ${id}: no horizontal scroll`, await noHScroll(page));
    await shot(page, `${id}-dark-${vpName}`);
    await page.close();
  }
  await c.close();
}

// 3. Pipeline table + analytics views, menus, dialogs and the Gantt in Dark.
{
  const c = await ctx(DESK);
  await setDark(c);
  let page = await open(c, "/dashboard");
  for (const v of ["table", "analytics"]) {
    const tab = page.getByTestId(`view-${v}`);
    if (await tab.count()) { await tab.click(); await page.waitForTimeout(500); await shot(page, `pipeline-${v}-dark-desktop`); }
  }
  const pipe = page.getByTestId("view-pipeline");
  if (await pipe.count()) {
    await pipe.click(); await page.waitForTimeout(400);
    const menu = page.getByTestId("move-menu").first();
    if (await menu.count()) { await menu.click(); await page.waitForTimeout(300); await shot(page, "pipeline-menu-dark-desktop", false); await page.keyboard.press("Escape"); }
  }
  // Builder: proposal preview stays a light document; quantity calculator dialog.
  page = await open(c, `/estimates/${EST}?step=proposal`);
  const article = page.locator('article[aria-label="Proposal preview"]').first();
  if (await article.count()) check("builder: proposal preview stays light (customer document unchanged)", !isDark(await article.evaluate((el) => getComputedStyle(el).backgroundColor)));
  check("builder: app chrome is dark", isDark(await bg(page)));
  await shot(page, "builder-proposal-dark-desktop");
  page = await open(c, `/estimates/${EST}?step=estimate`);
  await shot(page, "builder-estimate-dark-desktop");
  const calc = page.getByRole("button", { name: /calculator/i }).first();
  if (await calc.count()) { await calc.click(); await page.waitForTimeout(500); await shot(page, "builder-calculator-dialog-dark-desktop", false); await page.keyboard.press("Escape"); }
  // Gantt: create a schedule through the wizard.
  page = await open(c, "/projects");
  const ready = page.getByTestId("ready-bid").first();
  if (await ready.count()) {
    await ready.getByRole("link", { name: "Schedule Now" }).click();
    await page.getByTestId("schedule-wizard").waitFor();
    await shot(page, "schedule-wizard-dark-desktop");
    await page.getByTestId("wizard-next").click();
    await page.getByTestId("wizard-next").click();
    await page.getByTestId("start-date").fill("2026-11-16");
    await shot(page, "schedule-date-picker-dark-desktop");
    await page.getByTestId("wizard-next").click();
    const dur = page.locator("input[type=number]");
    for (let i = 0; i < Math.min(4, await dur.count()); i++) await dur.nth(i).fill(String(i + 2));
    for (let i = 0; i < 4; i++) { const n = page.getByTestId("wizard-next"); if (await n.count() && await n.isEnabled()) { await n.click(); await page.waitForTimeout(250); } }
    const save = page.getByTestId("save-schedule");
    if (await save.count()) {
      await save.click();
      await page.getByTestId("schedule-editor").waitFor({ timeout: 15000 });
      await page.waitForTimeout(600);
      check("Gantt schedule renders in Dark", isDark(await bg(page)));
      await shot(page, "gantt-dark-desktop");
      const sched = new URL(page.url()).pathname;
      const p2 = await open(c, `${sched}/update`);
      const report = p2.getByTestId("report-view").first();
      if (await report.count()) check("customer update preview stays light", !isDark(await report.evaluate((el) => getComputedStyle(el).backgroundColor)));
      await shot(p2, "customer-update-preview-dark-desktop");
      const cm = await ctx(PHONE, { isMobile: true }); await setDark(cm);
      const p3 = await open(cm, sched);
      await shot(p3, "gantt-dark-m390");
      await cm.close();
    }
  } else check("a won bid is ready to schedule (for the Gantt check)", false);
  // Walkthrough / tour overlay.
  page = await open(c, "/dashboard");
  const tour = page.getByRole("button", { name: /premium feature tour|feature tour|walkthrough/i }).first();
  if (await tour.count()) { await tour.click(); await page.waitForTimeout(700); await shot(page, "feature-walkthrough-dark-desktop", false); }
  await c.close();
}

// 4. Phone (a new device: empty storage): the account's Dark choice from step 1 follows the user;
//    the toggle sits in the top bar.
{
  const c = await ctx(PHONE, { isMobile: true });
  const page = await open(c, "/dashboard");
  check("new device (phone) opens in the account's Dark choice, no light first frame", isDark(await page.evaluate(() => window.__firstBg)) && isDark(await bg(page)));
  const t = page.getByTestId("theme-toggle").filter({ visible: true });
  check("phone: toggle in the top bar", (await t.count()) === 1 && (await t.boundingBox()).y < 70);
  const box = await t.boundingBox();
  check("phone: 44px touch target", box.width >= 44 && box.height >= 44);
  await dismiss(page);
  await t.tap();
  await page.waitForTimeout(150);
  check("phone: tap switches to Light", !isDark(await bg(page)));
  await shot(page, "dashboard-light-m390", false);
  await t.tap();
  await page.waitForTimeout(150);
  check("phone: tap again switches to Dark", isDark(await bg(page)));
  await shot(page, "dashboard-dark-m390", false);
  await page.getByRole("button", { name: "Menu" }).click();
  await shot(page, "menu-open-dark-m390", false);
  await c.close();
  const c320 = await ctx({ width: 320, height: 700 }, { isMobile: true });
  const p320 = await open(c320, "/dashboard");
  check("320px: top bar fits without horizontal scroll", await noHScroll(p320));
  await shot(p320, "dashboard-light-m320", false);
  await c320.close();
}

// 5. Preference follows the account to a new device (empty localStorage).
{
  const c = await ctx(DESK);
  const page = await open(c, "/settings/billing");
  check("new device picks up the account's Dark choice with no light first frame", (await accountTheme())?.mode === "dark" && isDark(await page.evaluate(() => window.__firstBg)));
  await c.close();
}

// 6. Unchanged areas: marketing pages and public proposal pages stay light even with Dark saved.
{
  const c = await ctx(DESK, { auth: false });
  await setDark(c);
  for (const path of ["/", "/pricing", "/bids"]) {
    const page = await open(c, path);
    check(`${path}: marketing page unchanged (light)`, !isDark(await bg(page)));
    await page.close();
  }
  await c.close();
}

// 7. Guests: localStorage only.
{
  const c = await ctx(DESK, { auth: false });
  const page = await open(c, "/start/siding");
  await page.waitForURL(/\/builder/, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1200);
  if (page.url().includes("/builder")) {
    const t = page.getByTestId("theme-toggle").filter({ visible: true });
    await dismiss(page);
    await t.click(); await page.waitForTimeout(200);
    check("guest builder: toggle switches to Dark", isDark(await bg(page)));
    await page.waitForTimeout(500);
    check("guest: nothing sent to an account", (await accountTheme())?.at !== JSON.parse(await page.evaluate(() => localStorage.getItem("b2b-theme"))).at);
    check("guest: saved to this browser only", (await page.evaluate(() => JSON.parse(localStorage.getItem("b2b-theme")).mode)) === "dark");
    await shot(page, "guest-builder-dark-desktop");
  } else out.push(`- guest builder not reached from /bids/siding (landed on ${new URL(page.url()).pathname})`);
  await c.close();
}

// Reduced motion respected.
{
  const c = await browser.newContext({ viewport: DESK, reducedMotion: "reduce" });
  await c.addCookies([authCookie]);
  const page = await c.newPage();
  await page.goto(`${A}/dashboard`, { waitUntil: "load" });
  const d = await page.getByTestId("theme-toggle").filter({ visible: true }).evaluate((el) => getComputedStyle(el).transitionDuration);
  check("reduced motion: no transitions", parseFloat(d) <= 0.0001);
  await c.close();
}

await browser.close();
console.log(out.join("\n"));
console.log(errors.length ? `page errors:\n${errors.join("\n")}` : "no page errors");
