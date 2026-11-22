// Browser walk for clickable KPI cards across Built2Bid. Local build against the mock Supabase with
// clearly fake seed data (NOT production):
//   npx tsx scripts/esign/fixture.ts > /tmp/esign-fixture.json
//   MOCK_COMMAND_CENTER=1 MOCK_ADMIN=1 node scripts/ux-audit/mock-supabase.mjs &
//   NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=x SUPABASE_SECRET_KEY=x \
//     NEXT_PUBLIC_ESIGNATURES=on NEXT_PUBLIC_PROJECT_SCHEDULING=on npm run build && npx next start -p 3000 &
//   PART=admin node scripts/kpi-cards/walk.mjs <screenshotDir>
// The contractor part needs the pipeline mock instead (restart it without MOCK_COMMAND_CENTER):
//   MOCK_PIPELINE=1 MOCK_UNLIMITED=1 MOCK_ESIGN_FIXTURE=/tmp/esign-fixture.json node scripts/ux-audit/mock-supabase.mjs &
//   PART=app node scripts/kpi-cards/walk.mjs <screenshotDir>
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium, devices } = createRequire(import.meta.url)("playwright");
const dir = process.argv[2] ?? "kpi-shots";
fs.mkdirSync(dir, { recursive: true });
const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };
const M = "http://localhost:54321", A = "http://localhost:3000";
const PART = process.env.PART ?? "admin";
const out = []; const check = (n, c, extra = "") => out.push(`${c ? "✓" : "✗"} ${n}${extra ? ` (${extra})` : ""}`);
await fetch(`${M}/__onboarding?status=completed`).catch(() => {});
await fetch(`${M}/__features?created=${encodeURIComponent(new Date().toISOString())}`).catch(() => {});

const browser = await chromium.launch();
const errors = [];
async function open(path, { vp = { width: 1440, height: 1000 }, theme = null, touch = false, dpr = 2 } = {}) {
  const ctx = await browser.newContext(touch ? { ...devices["iPhone 13"] } : { viewport: vp, deviceScaleFactor: dpr });
  await ctx.addCookies([authCookie]);
  if (theme) await ctx.addInitScript((m) => { try { localStorage.setItem("b2b-theme", JSON.stringify({ mode: m, at: Date.now() })); } catch {} }, theme);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${path}: ${e.message}`));
  const res = await page.goto(`${A}${path}`, { waitUntil: "load" });
  await page.waitForTimeout(1200);
  // The fake account has never seen the "new features" popup: dismiss it once (the mock remembers).
  if (PART === "app" && !open.acked) {
    open.acked = true;
    const later = page.getByRole("button", { name: "Maybe Later" });
    if (await later.waitFor({ timeout: 6000 }).then(() => true, () => false)) { await later.click(); await page.waitForTimeout(500); }
  }
  return { ctx, page, status: res?.status() };
}
const center = (loc) => loc.evaluate((e) => e.scrollIntoView({ block: "center" }));
const shot = (page, name, full = false) => page.screenshot({ path: `${dir}/${name}.png`, fullPage: full });

// 1. Every actionable card on every dashboard: links resolve, drawers open. No nested interactive controls.
const PAGES = PART === "admin" ? ["/admin", "/admin/customers", "/admin/complimentary", "/admin/revenue", "/admin/usage", "/admin/marketing", "/admin/operations", "/admin/costs", "/admin/states", "/admin/marketing/radar", "/admin/sales"] : ["/dashboard", "/projects", "/company", "/company/billing", "/settings/billing"];
for (const path of PAGES) {
  const { ctx, page, status } = await open(path);
  const cards = page.locator(".metric-action");
  const n = await cards.count();
  const hrefs = await page.locator("a.metric-action").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
  const nested = await page.locator(".metric-action").evaluateAll((els) => els.filter((e) => e.querySelector("a, button, input, select")).length);
  let broken = [];
  for (const h of new Set(hrefs)) {
    if (!h || h.startsWith("#")) { if (h && h.length > 1 && !(await page.locator(h.split("?")[0]).count()) && !h.startsWith("#metric-")) broken.push(h); continue; }
    const url = new URL(h, `${A}${path}`); const target = url.pathname + url.search;
    const r = await ctx.request.get(`${A}${target}`, { maxRedirects: 0 }).catch(() => null);
    if (!r || r.status() >= 400) broken.push(`${h} → ${r?.status()}`);
  }
  check(`${path}: ${n} clickable cards, ${hrefs.length} links, no broken links`, status === 200 && broken.length === 0, broken.join(", "));
  check(`${path}: no interactive control nested inside a card`, nested === 0, String(nested));
  await ctx.close();
}

if (PART === "admin") {
// 2. Complimentary Access: each card opens its filtered view; zero shows a useful empty state; Back restores.
{
  const { ctx, page } = await open("/admin/complimentary");
  await shot(page, "complimentary-desktop");
  await page.getByTestId("comp-kpi").filter({ hasText: "Pending invitations" }).click();
  await page.waitForURL(/state=pending/);
  await page.waitForTimeout(800);
  const pendingUrl = page.url();
  check("Pending invitations → ?state=pending", /state=pending/.test(pendingUrl));
  const body = await page.locator("#grants").innerText();
  check("Pending view shows pending rows or 'No pending invitations.'", /Invitation pending|No pending invitations\./.test(body));
  await shot(page, "complimentary-pending");
  await page.getByTestId("comp-kpi").filter({ hasText: "Converted to paid" }).click();
  await page.waitForURL(/state=converted/); await page.waitForTimeout(800);
  check("Converted to paid → ?state=converted", /state=converted/.test(page.url()));
  await page.goBack(); await page.waitForTimeout(1000);
  check("Browser Back restores the previous filtered view", /state=pending/.test(page.url()));
  await page.reload(); await page.waitForTimeout(800);
  check("Refresh keeps the filter", /state=pending/.test(page.url()) && (await page.getByTestId("comp-kpi").filter({ hasText: "Showing" }).count()) === 1);
  await ctx.close();
}

// 3. Keyboard: Tab to a card and press Enter; a drawer card opens with Space and closes with Escape (and Back).
{
  const { ctx, page } = await open("/admin/revenue");
  const first = page.locator("a.metric-action").first();
  await first.focus();
  const ring = await first.evaluate((e) => getComputedStyle(e).outlineStyle);
  check("focused card shows a visible focus ring", ring !== "none", ring);
  await shot(page, "revenue-focus");
  const href = await first.getAttribute("href");
  await page.keyboard.press("Enter"); await page.waitForTimeout(1500);
  check("Enter on a focused card navigates to its records", page.url().includes(href.split("#")[0]), page.url());
  await page.goBack(); await page.waitForTimeout(1200);
  const drawer = page.locator('[data-metric-drawer="net-mrr"]');
  await drawer.focus(); await page.keyboard.press(" "); await page.waitForTimeout(600);
  check("Space opens the calculation drawer", await page.getByTestId("metric-drawer").isVisible());
  check("open drawer is in the URL (#metric-net-mrr)", page.url().endsWith("#metric-net-mrr"));
  await shot(page, "revenue-drawer");
  await page.keyboard.press("Escape"); await page.waitForTimeout(500);
  check("Escape closes the drawer and clears the hash", !(await page.getByTestId("metric-drawer").isVisible()) && !page.url().includes("#metric"));
  await drawer.click(); await page.waitForTimeout(500);
  await page.goBack(); await page.waitForTimeout(600);
  check("Browser Back closes an open drawer", !(await page.getByTestId("metric-drawer").isVisible()));
  await ctx.close();
}

// 4. Owner dashboards: screenshots, and drilldowns carry the date range.
{
  const { ctx, page } = await open("/admin?range=90d");
  await shot(page, "overview-desktop");
  const h = await page.locator("a.metric-action").first().getAttribute("href");
  check("Overview card keeps the 90-day range", /range=90d/.test(h), h);
  await page.locator("a.metric-action", { hasText: "Newly activated" }).click(); await page.waitForTimeout(1500);
  check("Newly activated → customers filtered to that cohort", /cohort=activated/.test(page.url()) && await page.getByTestId("drill-filter").isVisible());
  await shot(page, "customers-drill");
  for (const p of ["/admin/marketing", "/admin/usage", "/admin/costs", "/admin/operations"]) { await page.goto(`${A}${p}`); await page.waitForTimeout(1200); await shot(page, `${p.split("/").pop()}-desktop`); }
  await page.goto(`${A}/admin/costs#metric-budget`); await page.waitForTimeout(1200);
  check("A drawer link opens the drawer on load (shareable)", await page.getByTestId("metric-drawer").isVisible());
  await shot(page, "costs-budget-drawer");
  await ctx.close();
}

// 5. Mobile + touch: tap targets work.
{
  const { ctx, page } = await open("/admin/complimentary", { touch: true });
  await shot(page, "complimentary-m390");
  const exp = page.getByTestId("comp-kpi").filter({ hasText: "Expiring within 7 days" });
  await center(exp); await exp.tap();
  await page.waitForURL(/state=expiring_soon/); await page.waitForTimeout(600);
  check("Tap on a card works (touch)", /state=expiring_soon/.test(page.url()));
  await page.goto(`${A}/admin/usage`); await page.waitForTimeout(1200);
  await center(page.locator('[data-metric-drawer="finalized"]')); await page.locator('[data-metric-drawer="finalized"]').tap(); await page.waitForTimeout(600);
  check("Tap opens a drawer on mobile", await page.getByTestId("metric-drawer").isVisible());
  await shot(page, "usage-drawer-m390");
  await ctx.close();
}

}
if (PART === "app") {
// 6. Contractor Bids dashboard in Light / Dark / Black: filter by card, Back, empty state, analytics drawer.
for (const theme of ["light", "dark", "black"]) {
  const { ctx, page } = await open("/dashboard?view=pipeline", { theme });
  await page.getByTestId("metric-awaiting").click(); await page.waitForTimeout(500);
  const url = page.url();
  check(`[${theme}] Awaiting signature card filters the board (?focus=awaiting)`, /focus=awaiting/.test(url) && await page.getByTestId("pipeline-focus-note").isVisible());
  const cols = await page.locator('section[data-testid^="column-"]').count();
  check(`[${theme}] only the Awaiting column is shown`, cols === 1, String(cols));
  await shot(page, `bids-awaiting-${theme}`);
  if (theme === "light") {
    await page.getByTestId("metric-draft").hover(); await page.waitForTimeout(250);
    await shot(page, "bids-hover-light");
    await page.getByTestId("metric-draft").click(); await page.waitForTimeout(400);
    await page.goBack(); await page.waitForTimeout(500);
    check("Back on the Bids dashboard returns to the previous card filter", /focus=awaiting/.test(page.url()));
    await page.reload(); await page.waitForTimeout(1200);
    check("Refresh keeps the Bids card filter", await page.getByTestId("pipeline-focus-note").isVisible());
    await page.getByTestId("view-analytics").click(); await page.waitForTimeout(500);
    await page.getByTestId("an-won").click(); await page.waitForTimeout(500);
    check("Analytics tile opens the bids behind it", await page.getByTestId("metric-drawer").isVisible());
    await shot(page, "bids-analytics-drawer");
  }
  await ctx.close();
}
{
  const { ctx, page } = await open("/dashboard?view=pipeline", { touch: true, theme: "dark" });
  await center(page.getByTestId("metric-won")); await page.getByTestId("metric-won").tap(); await page.waitForTimeout(500);
  check("[mobile] Won card filters the board on tap", /focus=won/.test(page.url()));
  await shot(page, "bids-won-m390-dark");
  await ctx.close();
}

// 7. Projects overview cards.
{
  await fetch(`${M}/__ws?seed=1`).catch(() => {});
  for (const theme of ["light", "black"]) {
    const { ctx, page } = await open("/projects", { theme });
    const card = page.getByTestId("metric-delayed");
    if (await card.count()) {
      await card.click(); await page.waitForTimeout(800);
      check(`[${theme}] Delayed card → ?focus=delayed`, /focus=delayed/.test(page.url()));
      const list = await page.locator('[data-testid="project-card"], [data-testid="metric-empty"]').count();
      check(`[${theme}] filtered list or empty state shown`, list > 0);
      await shot(page, `projects-delayed-${theme}`);
      await page.goBack(); await page.waitForTimeout(800);
      check(`[${theme}] Back clears the projects filter`, !/focus=/.test(page.url()));
    } else check(`[${theme}] projects workspace rendered metrics`, false, "no metric-delayed (scheduling off in this build?)");
    await ctx.close();
  }
}

}
await browser.close();
fs.writeFileSync(`${dir}/results.txt`, [...out, "", errors.length ? `Page errors:\n${errors.join("\n")}` : "No page errors"].join("\n"));
console.log(out.join("\n"));
console.log(errors.length ? `\nPage errors:\n${errors.join("\n")}` : "\nNo page errors");
