// Mobile Home dashboard walk (TEST DATA ONLY, throwaway local database + mock Supabase, never production):
//   scripts/test-db.sh start
//   export RADAR_PG_URL=$(node scripts/financials/setup-db.mjs)
//   PG_REST_AS_USER=00000000-0000-4000-8000-000000000001 \
//   PG_REST_PREFIXES=fin_,estimates,estimate_versions,customers,dashboard_,my_company,my_workspace_access,search_capabilities,my_pm_access,company_,project_schedules,schedule_,pm_,subcontractor_quote,change_orders,business_profiles \
//     node scripts/ux-audit/mock-supabase.mjs &
//   NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=x SUPABASE_SECRET_KEY=x \
//   NEXT_PUBLIC_FINANCIALS=on NEXT_PUBLIC_PROJECT_SCHEDULING=on NEXT_PUBLIC_UNIFIED_HOME=on npm run build && npx next start -p 3000 &
//   node scripts/mobile-dashboard/walk.mjs <screenshotDir>
// Checks /home at 320/360/375/390/430 (touch phones), 768 tablet, 1024 and 1440 desktop, in Light and Dark, in
// Contractor and Accountant Mode: no horizontal scroll, the heading never squeezed, the mode switch on its own row on
// phones, metrics in the first screen, readable (untruncated) values, 44px tap targets, keyboard focus, drilldowns.
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");
const { Client } = require("pg");

const dir = process.argv[2] ?? "mobile-dashboard-shots";
fs.mkdirSync(dir, { recursive: true });
const ME = "00000000-0000-4000-8000-000000000001";
const user = { id: ME, aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: ME, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };
const M = "http://localhost:54321", A = "http://localhost:3000";
const SHOTS_ONLY = process.env.SHOTS_ONLY === "1";
const out = []; const check = (n, c, extra = "") => { out.push(`${c ? "✓" : "✗"} ${n}${extra ? ` (${extra})` : ""}`); if (!c) process.exitCode = 1; };

const db = new Client({ connectionString: process.env.RADAR_PG_URL }); await db.connect();
const book = (await db.query("select id from public.fin_books where sandbox_of is null order by created_at limit 1")).rows[0].id;
const setMode = async (mode) => {
  await db.query("begin"); await db.query("set local role authenticated"); await db.query("select set_config('request.jwt.claim.sub', $1, true)", [ME]);
  await db.query("select public.fin_set_mode($1, $2)", [book, mode]); await db.query("commit");
};
await fetch(`${M}/__onboarding?status=completed`).catch(() => {});
await fetch(`${M}/__features?created=${encodeURIComponent(new Date().toISOString())}`).catch(() => {});

const PHONES = process.env.ONLY_INTERACTION ? [] : [320, 360, 375, 390, 430];
const SIZES = [...PHONES.map((w) => ({ w, h: w <= 320 ? 568 : w <= 375 ? 667 : w <= 390 ? 844 : 932, phone: true })), { w: 768, h: 1024 }, { w: 1024, h: 768 }, { w: 1440, h: 900 }];
const browser = await chromium.launch();
const errors = [];

async function open({ w, h, phone }, theme) {
  const ctx = await browser.newContext(phone ? { ...devices["iPhone 13"], viewport: { width: w, height: h }, deviceScaleFactor: 2 } : { viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await ctx.addCookies([authCookie]);
  await ctx.addInitScript((m) => { try { localStorage.setItem("b2b-theme", JSON.stringify({ mode: m, at: Date.now() })); localStorage.setItem("b2b:welcome-seen", "1"); } catch {} }, theme);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${w}: ${e.message}`));
  await page.goto(`${A}/home`, { waitUntil: "load" });
  await page.getByTestId("dashboard-builder").waitFor({ timeout: 20000 });
  // Dismiss any first-visit popups (welcome video / new features) so they don't cover the layout.
  for (const name of ["Maybe Later", "Skip", "Close"]) {
    const b = page.getByRole("button", { name, exact: true }).first();
    if (await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); await page.waitForTimeout(300); }
  }
  await page.waitForTimeout(400);
  return { ctx, page };
}

const rect = (loc) => loc.evaluate((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, b: r.bottom, r: r.right }; });

for (const mode of ["contractor", "accountant"]) {
  await setMode(mode);
  for (const theme of ["light", "dark"]) {
    for (const size of SIZES) {
      // Every size in Light; Dark at a phone, tablet and desktop width to keep the run short.
      if (theme === "dark" && ![360, 390, 768, 1440].includes(size.w)) continue;
      const tag = `${mode}-${theme}-${size.w}`;
      const { ctx, page } = await open(size, theme);
      await page.screenshot({ path: `${dir}/${tag}.png` });
      if (size.w === 390 || size.w === 1440) await page.screenshot({ path: `${dir}/${tag}-full.png`, fullPage: true });
      if (SHOTS_ONLY) { await ctx.close(); continue; }

      const vw = size.w, vh = size.h;
      const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
      check(`${tag}: no horizontal scroll`, scroll <= vw, `scrollWidth ${scroll}`);
      check(`${tag}: theme applied`, (await page.evaluate(() => document.documentElement.dataset.theme ?? "light")) === theme || theme === "light");
      const builder = page.getByTestId("dashboard-builder");
      check(`${tag}: ${mode} mode shown`, (await builder.getAttribute("data-mode")) === mode);

      const h1 = await rect(page.locator("h1").first());
      const sub = await rect(page.getByTestId("dash-subtitle"));
      check(`${tag}: heading has room`, sub.w >= Math.min(180, (vw - 32) * 0.6), `h1 ${Math.round(h1.w)}px, subtitle ${Math.round(sub.w)}px`);
      check(`${tag}: subtitle on one line`, sub.h <= 28, `${Math.round(sub.h)}px tall`);
      const subText = (await page.getByTestId("dash-subtitle").textContent())?.trim();
      check(`${tag}: concise subtitle`, subText === "Your business at a glance.", subText);

      const toggle = page.getByTestId("fin-mode");
      if (await toggle.count()) {
        const t = await rect(toggle);
        if (size.phone) check(`${tag}: mode switch on its own row`, t.y >= sub.b - 1 && t.w >= vw - 48, `top ${Math.round(t.y)} vs subtitle bottom ${Math.round(sub.b)}, width ${Math.round(t.w)}`);
        check(`${tag}: mode switch inside the screen`, t.r <= vw + 0.5);
        const btns = await toggle.locator("button").evaluateAll((els) => els.map((e) => ({ h: e.getBoundingClientRect().height, clipped: e.scrollWidth > e.clientWidth + 1 })));
        check(`${tag}: mode buttons 40px+ and unclipped`, btns.every((b) => b.h >= 40 && !b.clipped), JSON.stringify(btns));
      } else check(`${tag}: mode switch present`, false);

      const cust = await rect(page.getByTestId("dash-customize"));
      check(`${tag}: Customize reachable`, cust.r <= vw + 0.5 && cust.h >= 40);
      check(`${tag}: Customize doesn't overlap heading`, cust.x >= h1.x + h1.w - 0.5 || cust.y >= sub.b - 1 || cust.b <= h1.y);

      // The first metric card starts in the first screen on phones.
      const metrics = page.locator('[data-testid="dash-grid"] .metric-action');
      const firstMetric = await rect(metrics.first());
      check(`${tag}: a metric in the first screen`, firstMetric.y < vh - 40, `first metric top ${Math.round(firstMetric.y)} / ${vh}`);
      if (size.phone) {
        const cols = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="dash-grid"]')).gridTemplateColumns.split(" ").length);
        check(`${tag}: two-column KPI grid`, cols === 2, `${cols} columns`);
        const pairs = await page.locator('[data-testid="dash-grid"] > li[data-compact]').count();
        check(`${tag}: KPI tiles share rows`, pairs >= 2, `${pairs} compact tiles`);
      }
      const trunc = await page.locator('[data-testid="dash-grid"] .metric-value').evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().right > window.innerWidth).map((e) => e.textContent));
      check(`${tag}: metric values fully readable`, trunc.length === 0, trunc.join(", "));
      const overflowCells = await page.locator('[data-testid="dash-grid"] > li').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().right > window.innerWidth + 0.5).length);
      check(`${tag}: no widget past the screen edge`, overflowCells === 0);

      if (size.phone) {
        // Phone header: brand, New bid, search, notifications (when available), theme, menu; no "Home" label row.
        const bar = page.locator("aside").first();
        check(`${tag}: brand in header`, await bar.locator("a[href='/home'], a[href='/dashboard']").first().isVisible());
        const nb = bar.locator('[data-guide="bids.new-bid"]');
        const nbr = await rect(nb);
        check(`${tag}: New bid in header, 44px`, (await nb.isVisible()) && nbr.h >= 44 && nbr.w >= 44);
        check(`${tag}: search + notifications + menu in header`, (await bar.getByRole("button", { name: /search/i }).first().isVisible()) && (await bar.getByTestId("notification-bell").isVisible()) && (await bar.locator('[aria-controls="account-nav"]').isVisible()));
        check(`${tag}: no redundant Home label`, !(await bar.getByTestId("nav-current").isVisible().catch(() => false)));
        const asideH = (await rect(bar)).h;
        check(`${tag}: compact header`, asideH <= 72, `${Math.round(asideH)}px`);
        const small = await bar.locator("a:visible, button:visible").evaluateAll((els) => els.filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 44 || r.width < 44) && !e.closest("nav"); }).map((e) => e.getAttribute("aria-label") || e.textContent?.trim()));
        check(`${tag}: header tap targets 44px`, small.filter((s) => s !== "Built2Bid" && !/home/i.test(s ?? "")).length === 0, small.join(", "));
        const qa = page.locator('[data-testid="widget-quick_actions"] a:visible');
        if (await qa.count()) {
          const hs = await qa.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
          check(`${tag}: quick actions 44px`, hs.every((x) => x >= 44), hs.join(","));
          const labels = await qa.allTextContents();
          check(`${tag}: New bid not repeated in quick actions`, !labels.some((l) => /create bid/i.test(l)), labels.join(" | "));
        }
      }
      await ctx.close();
    }
  }
}

if (!SHOTS_ONLY) {
  // Interaction: menu opens/closes with Escape and keeps focus; theme toggles; mode switch works; a metric drills down;
  // Customize opens and closes; keyboard focus is visible on the header controls.
  await setMode("contractor");
  const { ctx, page } = await open({ w: 390, h: 844, phone: true }, "light");
  const menu = page.locator('[aria-controls="account-nav"]');
  await menu.click();
  check("390: menu opens", await page.locator("#account-nav").isVisible());
  await page.screenshot({ path: `${dir}/interaction-390-menu-open.png` });
  await page.keyboard.press("Escape");
  check("390: Escape closes menu and returns focus", !(await page.locator("#account-nav").isVisible()) && (await menu.evaluate((e) => e === document.activeElement)));
  const ring = await menu.evaluate((e) => { const s = getComputedStyle(e); return s.outlineStyle !== "none" || s.boxShadow !== "none"; });
  check("390: focus visible on Menu button", ring);
  // With notifications in the bar, the theme switch is the first row of the Menu.
  await menu.click();
  const theme = page.locator("#account-nav").getByTestId("theme-toggle");
  const before = await theme.getAttribute("data-theme-mode");
  await theme.click(); await page.waitForTimeout(300);
  check("390: theme switch in Menu toggles", (await theme.getAttribute("data-theme-mode")) !== before && (await page.evaluate(() => document.documentElement.dataset.theme)) === "dark");
  await theme.click(); await theme.click(); await page.waitForTimeout(300);
  await menu.click();
  // Notifications open as a sheet inside the screen.
  await page.locator("aside").getByTestId("notification-bell").click();
  const sheet = page.getByRole("dialog", { name: "Task review notices" });
  const sr = await rect(sheet);
  check("390: notifications open inside the screen", (await sheet.isVisible()) && sr.x >= 0 && sr.r <= 390, JSON.stringify(sr));
  await page.screenshot({ path: `${dir}/interaction-390-notifications.png` });
  await page.keyboard.press("Escape");
  await page.getByTestId("dash-customize").click();
  check("390: Customize opens edit mode", await page.getByTestId("dash-toolbar").isVisible());
  await page.screenshot({ path: `${dir}/interaction-390-customize.png` });
  const editCols = await page.locator('[data-testid="dash-grid"] > li[data-compact]').count();
  check("390: edit mode uses full-width cells", editCols === 0);
  await page.getByTestId("dash-done").click();
  const card = page.locator('[data-testid="dash-grid"] a.metric-action').first();
  const href = await card.getAttribute("href");
  await card.click(); await page.waitForURL((u) => !u.pathname.startsWith("/home"), { timeout: 15000 }).catch(() => {});
  check("390: metric opens its records", page.url().includes(href.split("?")[0]), `${href} -> ${page.url()}`);
  await page.goto(`${A}/home`, { waitUntil: "load" });
  await page.getByTestId("fin-mode").getByRole("button", { name: /Accountant/ }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="dashboard-builder"]')?.getAttribute("data-mode") === "accountant", null, { timeout: 15000 }).catch(() => {});
  check("390: switching to Accountant Mode works", (await page.getByTestId("dashboard-builder").getAttribute("data-mode")) === "accountant");
  await page.screenshot({ path: `${dir}/interaction-390-accountant.png` });
  await ctx.close();
  await setMode("contractor");

  // Keyboard: Tab from the top reaches New bid, search, theme, menu, then the page; each shows a focus ring.
  const k = await open({ w: 1440, h: 900 }, "light");
  await k.page.keyboard.press("Tab");
  let rings = 0;
  for (let i = 0; i < 12; i++) {
    await k.page.keyboard.press("Tab");
    rings += await k.page.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return 0; const s = getComputedStyle(e); return s.outlineStyle !== "none" && s.outlineWidth !== "0px" ? 1 : s.boxShadow !== "none" ? 1 : 0; });
  }
  check("1440: keyboard focus visible on header/sidebar controls", rings >= 10, `${rings}/12`);
  await k.ctx.close();
}

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close(); await db.end();
fs.writeFileSync(`${dir}/results.txt`, out.join("\n") + "\n");
console.log(out.join("\n"));
console.log(`\n${out.filter((l) => l.startsWith("✓")).length} passed, ${out.filter((l) => l.startsWith("✗")).length} failed`);
