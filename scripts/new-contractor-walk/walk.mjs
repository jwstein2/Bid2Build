// New-contractor walk (2026-11-22): a brand-new solo account on phone and desktop, through the first-run
// path. Screenshots + checks for horizontal overflow, console errors and the new guided pieces.
// Usage: mock (MOCK_NEW_ACCOUNT=1 node scripts/ux-audit/mock-supabase.mjs) + `next start` built against it,
// then: node scripts/new-contractor-walk/walk.mjs <outDir>
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.env.BASE ?? "http://localhost:3000";
const out = process.argv[2] ?? "walk-out";
fs.mkdirSync(out, { recursive: true });
const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600 * 24 * 365 * 50, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };
const VPS = [{ name: "phone", width: 390, height: 844, isMobile: true }, { name: "desktop", width: 1440, height: 900, isMobile: false }];
const PAGES = [
  { id: "public-home", path: "/", auth: false },
  { id: "trade-page", path: "/bids/siding", auth: false },
  { id: "academy-classroom", path: "/academy/classroom", auth: false },
  { id: "home", path: "/home", auth: true },
  { id: "my-bids", path: "/dashboard", auth: true },
  { id: "new-bid", path: "/bids", auth: true },
  { id: "customers", path: "/dashboard/customers", auth: true },
  { id: "saved-items", path: "/dashboard/items", auth: true },
  { id: "company-profile", path: "/settings/company", auth: true },
  { id: "welcome-wizard", path: "/welcome", auth: true },
  { id: "account-settings", path: "/settings/account", auth: true },
];

const browser = await chromium.launch();
for (const vp of VPS) {
  for (const auth of [false, true]) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, hasTouch: vp.isMobile, deviceScaleFactor: 1 });
    // Keep the automatic welcome popup out of the page screenshots (it's checked on its own below).
    await ctx.addInitScript(() => { try { localStorage.setItem("b2b:onboarding", JSON.stringify({ status: "dismissed", at: new Date().toISOString(), synced: true })); } catch { /* */ } });
    if (auth) await ctx.addCookies([authCookie]);
    const page = await ctx.newPage();
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
    for (const p of PAGES.filter((x) => x.auth === auth)) {
      errors.length = 0;
      const r = await page.goto(BASE + p.path, { waitUntil: "networkidle" }).catch((e) => ({ status: () => `ERR ${e.message.slice(0, 60)}` }));
      await page.waitForTimeout(400);
      const status = typeof r?.status === "function" ? r.status() : "?";
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      await page.screenshot({ path: path.join(out, `${vp.name}-${p.id}.png`), fullPage: true });
      check(`[${vp.name}] ${p.path} loads`, status === 200, String(status));
      check(`[${vp.name}] ${p.path} no sideways scroll`, overflow <= 1, `${overflow}px`);
      check(`[${vp.name}] ${p.path} no console errors`, errors.filter((e) => !/favicon|Failed to load resource.*(404|401)/.test(e)).length === 0, errors.slice(0, 2).join(" | "));
    }
    if (auth) {
      await page.goto(BASE + "/home", { waitUntil: "networkidle" });
      const gs = page.getByTestId("getting-started");
      check(`[${vp.name}] Home shows Getting started`, await gs.isVisible());
      check(`[${vp.name}] Getting started starts at company setup`, (await page.getByTestId("getting-started-progress").innerText()).includes("Next: Set up your company"));
      if (vp.isMobile) await page.getByRole("button", { name: /Menu/ }).click();
      const more = page.getByTestId("nav-more-toggle");
      check(`[${vp.name}] Simpler menu: More tools shown`, await more.isVisible());
      check(`[${vp.name}] Simpler menu: Financials folded away`, !(await page.locator('#account-nav a[href="/financials"]').isVisible()));
      await more.click();
      check(`[${vp.name}] More tools opens Projects + Financials`, (await page.locator('#nav-more a[href="/projects"]').isVisible()) && (await page.locator('#nav-more a[href="/financials"]').isVisible()));
      await page.screenshot({ path: path.join(out, `${vp.name}-menu-more-tools.png`), fullPage: !vp.isMobile });
      await page.getByTestId("nav-help").click();
      await page.getByTestId("guide-panel").waitFor({ timeout: 5000 }).catch(() => {});
      check(`[${vp.name}] Help & guides opens the Help panel`, await page.getByTestId("guide-panel").isVisible());
      check(`[${vp.name}] Help panel has support, What's new, tour`, (await page.getByTestId("guide-support").count()) > 0 && (await page.getByTestId("guide-whats-new").count()) > 0 && (await page.getByTestId("guide-video").count()) > 0);
      await page.screenshot({ path: path.join(out, `${vp.name}-help-panel.png`) });
      await page.getByTestId("guide-video").click();
      await page.getByTestId("video-placeholder").waitFor({ timeout: 8000 }).catch(() => {});
      check(`[${vp.name}] Tour shows the video placeholder`, await page.getByTestId("video-placeholder").isVisible());
      await page.screenshot({ path: path.join(out, `${vp.name}-tour-placeholder.png`) });
    }
    await ctx.close();
  }
}
await browser.close();
fs.writeFileSync(path.join(out, "results.json"), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
