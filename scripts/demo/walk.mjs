// Browser walk + screenshots for Demo Mode and the Built2Bid Guide (V7.1). Local build against the mock
// Supabase (canned test data, NOT production, and not the real sample company; the seed itself is
// checked against Postgres in tests/db/demo-mode.test.ts):
//   MOCK_PIPELINE=1 MOCK_ADMIN=1 node scripts/ux-audit/mock-supabase.mjs &
//   NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=x SUPABASE_SECRET_KEY=x \
//     NEXT_PUBLIC_PROJECT_SCHEDULING=on NEXT_PUBLIC_ESIGNATURES=on PRACTICE_MODE=on npm run build && npx next start -p 3000 &
//   node scripts/demo/walk.mjs <screenshotDir>
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium, devices } = createRequire(import.meta.url)("playwright");
const dir = process.argv[2] ?? "demo-shots";
fs.mkdirSync(dir, { recursive: true });
const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };
const M = "http://localhost:54321", A = "http://localhost:3000";
const results = [];
const check = (n, ok, d = "") => { results.push({ n, ok: Boolean(ok), d }); console.log(`${ok ? "✓" : "✗"} ${n}${d && !ok ? ` — ${d}` : ""}`); };
const mock = (p) => fetch(`${M}${p}`);
const browser = await chromium.launch();
const errors = [];
const VP = { desktop: { viewport: { width: 1440, height: 960 } }, phone: { ...devices["iPhone 13"] } };

async function open(vp, path) {
  const ctx = await browser.newContext({ ...VP[vp], deviceScaleFactor: 2, reducedMotion: "reduce" });
  await ctx.addCookies([authCookie]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${path}: ${e.message}`));
  await page.goto(`${A}${path}`, { waitUntil: "load" });
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  const modal = page.getByTestId("unlocked-modal");
  if (await modal.isVisible().catch(() => false)) await page.keyboard.press("Escape");
  return { ctx, page };
}
const shot = (page, name) => page.screenshot({ path: `${dir}/${name}.png` });
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

async function scene(name, fn) {
  try { await fn(); } catch (e) { check(name, false, e.message.split("\n")[0]); }
}

// Baseline: an established account (welcome popup answered, created long ago).
await mock("/__onboarding?status=completed");
await mock(`/__features?created=${encodeURIComponent(new Date(Date.now() - 90 * 86400000).toISOString())}`);
await mock("/__scenario?name=unlimited");
await mock("/__demo");

await scene("guide launcher + panel (desktop)", async () => {
  const { ctx, page } = await open("desktop", "/dashboard");
  const launcher = page.getByTestId("guide-launcher");
  await launcher.waitFor({ timeout: 8000 });
  const box = await launcher.boundingBox();
  check("launcher sits bottom-left", box && box.x < 40 && box.y > 960 - 90, JSON.stringify(box));
  await launcher.click();
  const panel = page.getByTestId("guide-panel");
  await panel.waitFor();
  await page.getByTestId("guide-page-walkthrough").waitFor();
  check("panel lists the page walkthrough", true);
  await page.waitForTimeout(600);
  await shot(page, "01-guide-panel-desktop");
  await page.getByTestId("guide-search").fill("add a customer");
  await page.getByTestId("guide-results").waitFor();
  const n = await page.getByTestId("guide-result").count();
  check("help search returns verified results", n > 0, `${n}`);
  await shot(page, "02-guide-help-search");
  await page.keyboard.press("Escape");
  check("Escape closes the panel and focus returns to the launcher", await panel.isHidden() && await page.evaluate(() => document.activeElement?.getAttribute("data-testid") === "guide-launcher"));
  await page.getByTestId("guide-launcher").click();
  await page.getByTestId("guide-minimize").click();
  check("minimize leaves a small edge tab", await page.getByTestId("guide-launcher-min").isVisible());
  await page.getByTestId("guide-launcher-min").click();
  await page.getByTestId("guide-panel").waitFor();
  await ctx.close();
});

await scene("Demo Mode entry in Account settings", async () => {
  const { ctx, page } = await open("desktop", "/settings/account");
  await page.getByTestId("demo-enter").first().waitFor({ timeout: 8000 });
  await page.getByTestId("demo-enter").first().scrollIntoViewIfNeeded();
  await shot(page, "03-settings-demo-toggle");
  check("owner sees Enter Demo Mode in settings", true);
  check("sidebar has Demo Mode for the owner", await page.getByTestId("nav-demo-enter").count() > 0);
  await ctx.close();
});

await scene("Demo Mode banner on dashboard, customers and projects", async () => {
  await mock("/__demo?kind=owner_demo");
  await mock("/__ws?seed=1");
  for (const [path, name] of [["/dashboard", "04-demo-dashboard"], ["/dashboard/customers", "05-demo-customers"], ["/projects", "06-demo-projects"], ["/dashboard?view=table", "07-demo-estimates"]]) {
    const { ctx, page } = await open("desktop", path);
    const banner = page.getByTestId("demo-banner");
    await banner.waitFor({ timeout: 8000 });
    check(`DEMO MODE banner on ${path}`, (await banner.textContent())?.includes("DEMO MODE"));
    check(`no demo-mode offer popups on ${path}`, await page.getByTestId("guide-offer").count() === 0);
    await shot(page, name);
    if (path === "/dashboard") {
      await page.getByTestId("demo-reset").click();
      await page.getByTestId("demo-reset-confirm").waitFor();
      await shot(page, "08-demo-reset-confirm");
      await page.keyboard.press("Tab");
      check("reset needs a confirmation", await page.getByTestId("demo-reset-confirm").isVisible());
    }
    await ctx.close();
  }
  const { ctx, page } = await open("phone", "/dashboard");
  await page.getByTestId("demo-banner").waitFor({ timeout: 8000 });
  check("demo banner fits a phone", await noOverflow(page));
  await shot(page, "09-demo-dashboard-phone");
  await ctx.close();
  await mock("/__demo");
});

await scene("first-time onboarding offer + first step", async () => {
  await mock(`/__features?created=${encodeURIComponent(new Date(Date.now() - 86400000).toISOString())}`);
  await mock("/__activation?state=new");
  const { ctx, page } = await open("desktop", "/dashboard");
  const offer = page.getByTestId("guide-offer");
  await offer.waitFor({ timeout: 10000 });
  check("new account is offered the first-bid journey", (await offer.getAttribute("data-tour")) === "first-estimate");
  await shot(page, "10-onboarding-offer");
  await page.getByTestId("guide-offer-start").click();
  await page.getByTestId("tour-card").waitFor({ timeout: 6000 });
  await page.waitForTimeout(300);
  await shot(page, "11-onboarding-step1");
  await page.getByRole("button", { name: /^(Next|Finish)$/ }).click();
  const cont = page.getByTestId("guide-continue");
  await cont.waitFor({ timeout: 6000 });
  check("next part waits for the builder (no auto navigation)", page.url().endsWith("/dashboard"));
  await shot(page, "12-onboarding-continue");
  await page.getByTestId("guide-stop").click();
  await ctx.close();
  await mock("/__activation?state=reset");
  await mock(`/__features?created=${encodeURIComponent(new Date(Date.now() - 90 * 86400000).toISOString())}`);
});

await scene("PM Hub walkthrough", async () => {
  await mock(`/__pm?state=${encodeURIComponent(JSON.stringify({ scope: "individual", companyId: null, editorLimit: 1, editorsAssigned: 1, canEdit: true, source: "subscription", editUntil: null, addon: true, addonUntil: null, extraEditors: 0 }))}`);
  await mock("/__ws?seed=1");
  const { ctx, page } = await open("desktop", "/projects");
  const offer = page.getByTestId("guide-offer");
  await offer.waitFor({ timeout: 10000 });
  check("PM Hub offer on first visit", (await offer.getAttribute("data-tour")) === "pm-hub");
  check("offer text matches the brief", /Want a quick walkthrough\?/.test(await offer.textContent()));
  await shot(page, "13-pmhub-offer");
  await page.getByTestId("guide-offer-start").click();
  await page.getByTestId("tour-card").waitFor({ timeout: 6000 });
  await page.waitForTimeout(300);
  await shot(page, "14-pmhub-step");
  await page.keyboard.press("Escape");
  await ctx.close();
});

await scene("Enterprise owner walkthrough", async () => {
  await mock("/__scenario?name=enterprise_owner");
  const { ctx, page } = await open("desktop", "/company/users");
  await page.getByTestId("guide-launcher").click();
  const item = page.getByTestId("guide-tour-enterprise-owner");
  await item.waitFor({ timeout: 8000 });
  check("Enterprise owner tour listed for an owner", true);
  check("staff tour not listed for an owner", await page.getByTestId("guide-tour-enterprise-staff").count() === 0);
  await item.click();
  await page.locator("[data-testid=tour-card], [data-testid=guide-continue]").first().waitFor({ timeout: 6000 });
  await page.waitForTimeout(300);
  await shot(page, "15-enterprise-walkthrough");
  await ctx.close();
  await mock("/__scenario?name=enterprise_estimator");
  const s = await open("desktop", "/dashboard");
  await s.page.getByTestId("guide-launcher").click();
  await s.page.getByTestId("guide-panel").waitFor();
  await s.page.waitForTimeout(800);
  check("estimator never sees the owner/billing tour", await s.page.getByTestId("guide-tour-enterprise-owner").count() === 0);
  await s.ctx.close();
  await mock("/__scenario?name=unlimited");
});

await scene("phone: launcher clear of controls, panel fits", async () => {
  const { ctx, page } = await open("phone", "/dashboard");
  await page.getByTestId("guide-launcher").waitFor({ timeout: 8000 });
  check("no horizontal overflow on phone", await noOverflow(page));
  await shot(page, "16-phone-launcher");
  await page.getByTestId("guide-launcher").click();
  await page.getByTestId("guide-panel").waitFor();
  const b = await page.getByTestId("guide-panel").boundingBox();
  const vw = page.viewportSize().width;
  check("panel inside the phone screen", b && b.x >= 0 && b.x + b.width <= vw + 1, JSON.stringify(b));
  await page.waitForTimeout(400);
  await shot(page, "17-phone-guide-panel");
  await ctx.close();
});

await browser.close();
check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
fs.writeFileSync(`${dir}/results.json`, JSON.stringify({ results, errors }, null, 2));
process.exit(failed.length ? 1 : 0);
