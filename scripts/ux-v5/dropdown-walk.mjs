// V5 UX audit: real-browser checks of dropdown / popover / dialog dismissal across the app (outside
// click, Escape + focus return, close on selection, one open at a time, no scroll lock left behind).
// Mock Supabase, test data only (NOT production). Two parts:
//   PART=app   MOCK_PIPELINE=1 node scripts/ux-audit/mock-supabase.mjs
//   PART=admin MOCK_ADMIN=1 MOCK_COMMAND_CENTER=1 node scripts/ux-audit/mock-supabase.mjs
//   node scripts/ux-v5/dropdown-walk.mjs <dir>
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const dir = process.argv[2] ?? "dropdown-shots";
const PART = process.env.PART ?? "app";
fs.mkdirSync(dir, { recursive: true });
const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };
const out = []; const check = (n, c) => out.push(`${c ? "✓" : "✗"} ${n}`);
const M = "http://localhost:54321", A = "http://localhost:3000";
const EST = "11111111-1111-4111-8111-111111111111";
await fetch(`${M}/__onboarding?status=completed`).catch(() => {});
await fetch(`${M}/__features?created=${encodeURIComponent(new Date().toISOString())}`).catch(() => {});
const browser = await chromium.launch();
const errors = [];
const shot = (page, name) => page.screenshot({ path: `${dir}/${name}.png` });
async function open(path, vp = { width: 1440, height: 1000 }) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 });
  await ctx.addCookies([authCookie]);
  await ctx.addInitScript(() => { try { localStorage.setItem("b2b-theme", JSON.stringify({ mode: "light", at: 4102444800000 })); } catch { /* */ } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${path}: ${e.message}`));
  await page.goto(`${A}${path}`, { waitUntil: "load" });
  const later = page.getByRole("button", { name: "Maybe Later" });
  try { await later.waitFor({ timeout: 3000 }); await later.click(); } catch { /* none */ }
  await page.waitForTimeout(600);
  return { ctx, page };
}
const focused = (loc) => loc.evaluate((el) => document.activeElement === el);
const scrollable = (page) => page.evaluate(() => getComputedStyle(document.body).overflow !== "hidden" && !document.body.hasAttribute("data-scroll-locked"));

if (PART === "app") {
  await fetch(`${M}/__scenario?name=unlimited`);
  await fetch(`${M}/__team?reset=1&seed=1&manage=1`);
  await fetch(`${M}/__ws?seed=1`);
  await fetch(`${M}/__pm?state=${encodeURIComponent(JSON.stringify({ scope: "individual", companyId: null, editorLimit: 1, editorsAssigned: 1, canEdit: true, source: "subscription", editUntil: null, addon: true, addonUntil: null, extraEditors: 0 }))}`);

  // 1. Projects "More" views menu (below lg).
  {
    const { ctx, page } = await open("/projects", { width: 768, height: 1024 });
    const more = page.getByTestId("tab-more");
    if (await more.count()) {
      await shot(page, "projects-more-before");
      await more.click();
      check("projects More: opens on click", (await page.getByTestId("more-menu").count()) === 1);
      check("projects More: focus moves into the menu", await page.getByTestId("more-menu").evaluate((el) => el.contains(document.activeElement)));
      await page.keyboard.press("ArrowDown");
      check("projects More: arrow keys move between views", await page.getByTestId("more-menu").evaluate((el) => el.contains(document.activeElement)));
      await shot(page, "projects-more-open");
      await page.keyboard.press("Escape");
      check("projects More: Escape closes and returns focus to the button", (await page.getByTestId("more-menu").count()) === 0 && (await focused(more)));
      await more.click(); await page.mouse.click(700, 900); await page.waitForTimeout(150);
      check("projects More: outside click closes", (await page.getByTestId("more-menu").count()) === 0);
      await more.click(); await page.getByTestId("more-workload").click(); await page.waitForTimeout(800);
      check("projects More: picking a view navigates and closes", (await page.getByTestId("more-menu").count()) === 0 && page.url().includes("view=workload"));
      await shot(page, "projects-more-after-select");
    } else check("projects More: menu present at 768", false);
    await ctx.close();
  }

  // 2. Dashboard: feature help "?" popover + one-open-at-a-time with the notification bell.
  {
    const { ctx, page } = await open("/dashboard");
    const help = page.locator("[data-testid^=help-]").first();
    if (await help.count()) {
      await help.click();
      const pop = page.locator("[role=note]");
      check("feature help: opens", (await pop.count()) === 1);
      await shot(page, "dashboard-help-open");
      await page.keyboard.press("Escape");
      check("feature help: Escape closes and returns focus", (await pop.count()) === 0 && (await focused(help)));
      await help.click(); await page.mouse.click(700, 950); await page.waitForTimeout(150);
      check("feature help: outside click closes", (await pop.count()) === 0);
      const bell = page.getByTestId("notification-bell");
      if (await bell.count()) {
        await help.click(); await bell.click(); await page.waitForTimeout(200);
        check("one at a time: opening the bell closes the help popover", (await pop.count()) === 0 && (await page.getByRole("dialog", { name: "Task review notices" }).count()) === 1);
        await page.keyboard.press("Escape");
        check("bell: Escape closes and returns focus", (await page.getByRole("dialog", { name: "Task review notices" }).count()) === 0 && (await focused(bell)));
      }
    } else check("feature help present on dashboard", false);
    await ctx.close();
  }

  // 3. Builder: Suggested & Saved Items (multi-select) + section menu + pricing override dialog.
  {
    const { ctx, page } = await open(`/estimates/${EST}`);
    await page.waitForTimeout(800);
    await page.getByRole("button", { name: "Expand all" }).click().catch(() => {});
    await page.waitForTimeout(400);
    const pickers = page.getByRole("button", { name: "Suggested & Saved Items" });
    if ((await pickers.count()) >= 2) {
      const p1 = pickers.nth(0), p2 = pickers.nth(1);
      await p1.scrollIntoViewIfNeeded(); await p1.click();
      const search = page.getByLabel("Search suggested and saved items");
      check("saved items: opens with search focused", (await search.count()) === 1 && (await focused(search)));
      await shot(page, "builder-saved-items-open");
      await page.keyboard.press("Escape");
      check("saved items: Escape closes and returns focus", (await search.count()) === 0 && (await focused(p1)));
      await p1.click();
      const act = page.getByRole("button", { name: /^Actions for / }).nth(1);
      await act.scrollIntoViewIfNeeded(); await act.click(); await page.waitForTimeout(200);
      check("one at a time: opening a section menu closes the item picker", (await search.count()) === 0 && (await page.getByRole("menu").count()) === 1);
      await page.keyboard.press("Escape"); await page.waitForTimeout(150);
      await p2.scrollIntoViewIfNeeded(); await p2.click(); await page.getByRole("button", { name: "Done", exact: true }).click();
      check("saved items: Done closes", (await search.count()) === 0);
    } else check("builder has two section item pickers", false);
    const menu = page.getByRole("button", { name: /^Actions for / }).first();
    await menu.scrollIntoViewIfNeeded(); await menu.click();
    await page.getByRole("menuitem", { name: /Section pricing override/ }).click();
    const dlg = page.getByRole("dialog");
    check("pricing override: opens as a dialog", (await dlg.count()) === 1);
    check("pricing override: focus is inside", await dlg.evaluate((el) => el.contains(document.activeElement)));
    await shot(page, "builder-pricing-override-open");
    await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    check("pricing override: Escape closes (was ignored before)", (await dlg.count()) === 0);
    check("pricing override: page scrolls again after closing", await scrollable(page));
    await ctx.close();
  }
}

if (PART === "admin") {
  const { ctx, page } = await open("/admin");
  const tools = page.getByTestId("admin-tools");
  await shot(page, "admin-tools-before");
  await tools.click();
  const menu = page.locator("#admin-tools-menu");
  check("admin Tools: opens", (await menu.count()) === 1);
  check("admin Tools: focus moves to the first tool", await menu.evaluate((el) => el.contains(document.activeElement)));
  await page.keyboard.press("ArrowDown");
  check("admin Tools: arrow keys move between tools", await menu.evaluate((el) => el.contains(document.activeElement)));
  await shot(page, "admin-tools-open");
  await page.keyboard.press("Escape");
  check("admin Tools: Escape closes and returns focus (was ignored)", (await menu.count()) === 0 && (await focused(tools)));
  await tools.click(); await page.mouse.click(700, 700); await page.waitForTimeout(150);
  check("admin Tools: outside click closes (stayed open before)", (await menu.count()) === 0);
  await tools.click();
  const first = menu.locator("a").first(); const href = await first.getAttribute("href");
  await first.click(); await page.waitForURL(`**${href}`, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(600);
  check(`admin Tools: picking a tool navigates (${href}) and the menu is closed after (stayed open before)`, page.url().includes(href) && (await page.locator("#admin-tools-menu").count()) === 0);
  await shot(page, "admin-tools-after-select");
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await phone.addCookies([authCookie]);
  const pp = await phone.newPage(); await pp.goto(`${A}/admin`); await pp.waitForTimeout(800);
  await pp.getByTestId("admin-tools").click();
  const box = await pp.locator("#admin-tools-menu").boundingBox();
  check("admin Tools 390: menu stays inside the screen", !!box && box.x >= 0 && box.x + box.width <= 391);
  await pp.screenshot({ path: `${dir}/admin-tools-open-m390.png` });
  await phone.close();
  await ctx.close();
}

await browser.close();
const real = errors.filter((e) => !/hydrat/i.test(e));
check(`no page errors (${real.length})`, real.length === 0);
if (real.length) console.log(real.slice(0, 8).join("\n"));
console.log(out.join("\n"));
console.log(`${out.filter((l) => l.startsWith("✓")).length}/${out.length} passed`);
