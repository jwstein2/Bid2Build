// Walk for the UI polish pass (mobile menus, builder sections, save badge, tap feedback). Local build
// against the mock Supabase (test data only, NOT production):
//   npm run build && npx next start   +   node scripts/ux-audit/mock-supabase.mjs &
//   curl "localhost:54321/__onboarding?status=completed"; node scripts/ui-polish/walk.mjs <outDir> [--reduced]
import { createRequire } from "node:module"; import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const dir = process.argv[2]; const reduced = process.argv.includes("--reduced"); fs.mkdirSync(dir, { recursive: true });
const b64u = (s) => Buffer.from(s).toString("base64url");
const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const cookieVal = `base64-${b64u(JSON.stringify({ access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user }))}`;
const authCookie = { name: "sb-localhost-auth-token", value: cookieVal, domain: "localhost", path: "/" };
const A = "http://localhost:3000", EST = "11111111-1111-4111-8111-111111111111";
const out = []; const check = (n, c, extra = "") => out.push(`${c ? "PASS" : "FAIL"} ${n}${extra ? " (" + extra + ")" : ""}`);
const browser = await chromium.launch(); const errors = [];
async function page(vp, auth, mobile = true) {
  const c = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile, reducedMotion: reduced ? "reduce" : "no-preference" });
  if (auth) await c.addCookies([authCookie]);
  // Visitor welcome popup already dismissed, so it can't open over the menu mid-check.
  await c.addInitScript(() => { try { localStorage.setItem("b2b:onboarding", JSON.stringify({ status: "completed", at: new Date().toISOString() })); } catch {} });
  const p = await c.newPage(); p.on("pageerror", (e) => errors.push(e.message)); p.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 150)); });
  return p;
}
const PHONE = { width: 390, height: 844 };
// 1. Public mobile menu
{
  const p = await page(PHONE, false); await p.goto(A + "/", { waitUntil: "networkidle" });
  const btn = p.getByRole("button", { name: "Open menu" });
  await btn.click(); await p.waitForTimeout(400);
  await p.screenshot({ path: `${dir}/public-menu-open__m390.png` });
  check("public menu opens", await p.locator("nav[aria-label=Mobile]").isVisible());
  const focusedInMenu = await p.evaluate(() => !!document.activeElement?.closest("nav[aria-label=Mobile]"));
  check("public menu: focus moves into the menu", focusedInMenu);
  await p.keyboard.press("Escape"); await p.waitForTimeout(300);
  check("public menu: Escape closes", !(await p.locator("nav[aria-label=Mobile]").isVisible()));
  if (await p.locator("nav[aria-label=Mobile]").isVisible()) await p.locator("header button[aria-expanded=true]").click();
  check("public menu: focus returns to Menu button", await p.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Open menu"));
  if (!(await p.locator("nav[aria-label=Mobile]").isVisible())) await p.getByRole("button", { name: "Open menu" }).click();
  await p.waitForTimeout(400);
  const scrim = p.locator("[data-testid=mobile-menu-scrim]");
  await p.mouse.click(200, 800); await p.waitForTimeout(400);
  const stillOpen = await p.locator("nav[aria-label=Mobile]").isVisible();
  check("public menu: tap outside closes", !stillOpen, (await scrim.count()) ? "" : "no scrim");
  if (stillOpen) { await p.goto(A + "/", { waitUntil: "networkidle" }); }
  await p.getByRole("button", { name: "Open menu" }).click(); await p.waitForTimeout(300);
  await p.locator("nav[aria-label=Mobile]").getByRole("link", { name: "Pricing" }).click(); await p.waitForURL("**/pricing"); await p.waitForTimeout(400);
  check("public menu: closes after navigating", !(await p.locator("nav[aria-label=Mobile]").isVisible()));
  if (await p.locator("nav[aria-label=Mobile]").isVisible()) await p.locator("header button[aria-expanded=true]").click();
  await p.goBack(); await p.waitForTimeout(500);
  check("public menu: closed after Back", !(await p.locator("nav[aria-label=Mobile]").isVisible()));
  const sizes = await p.evaluate(async () => { document.querySelector("button[aria-label='Open menu']").click(); await new Promise(r => setTimeout(r, 400)); return [...document.querySelectorAll("nav[aria-label=Mobile] a")].map(a => Math.round(a.getBoundingClientRect().height)); });
  check("public menu: every link ≥ 44px tall", sizes.length > 0 && sizes.every((h) => h >= 44), sizes.join(","));
  await p.context().close();
}
// 2. App phone menu
{
  const p = await page(PHONE, true); await p.goto(A + "/dashboard", { waitUntil: "networkidle" });
  const btn = p.locator("button[aria-controls=account-nav]");
  await btn.click(); await p.waitForTimeout(400);
  await p.screenshot({ path: `${dir}/app-menu-open__m390.png` });
  check("app menu opens", await p.locator("#account-nav").isVisible());
  await p.keyboard.press("Escape"); await p.waitForTimeout(300);
  check("app menu: Escape closes", !(await p.locator("#account-nav").isVisible()));
  if (await p.locator("#account-nav").isVisible()) await btn.click();
  check("app menu: focus returns to Menu button", await p.evaluate(() => document.activeElement?.getAttribute("aria-controls") === "account-nav"));
  await p.context().close();
}
// 3. Desktop: app nav unaffected by Escape
{
  const p = await page({ width: 1440, height: 900 }, true, false); await p.goto(A + "/dashboard", { waitUntil: "networkidle" });
  await p.keyboard.press("Escape"); await p.waitForTimeout(200);
  check("desktop sidebar stays visible after Escape", await p.locator("#account-nav").isVisible());
  await p.context().close();
}
// 4. Builder: section toggle, chevron, save badge
for (const [vn, vp, mob] of [["m390", PHONE, true], ["d1440", { width: 1440, height: 900 }, false]]) {
  const p = await page(vp, true, mob); await p.goto(A + `/estimates/${EST}?step=estimate`, { waitUntil: "networkidle" }); await p.waitForSelector("nav[aria-label=\"Builder steps\"]");
  // reach the estimate step
  const estStep = p.getByRole("button", { name: /^Estimate$|Build estimate|Estimate/ }).first();
  const toggles = p.locator("button[aria-controls^=gp-]");
  if (!(await toggles.count())) { try { await estStep.click(); await p.waitForTimeout(600); } catch {} }
  const n = await toggles.count();
  check(`builder ${vn}: section toggles present`, n > 0, String(n));
  if (n > 1) {
    const t = toggles.nth(1); const was = await t.getAttribute("aria-expanded");
    await t.click(); await p.waitForTimeout(60);
    const id = await t.getAttribute("aria-controls");
    const anim = await p.evaluate((id) => { const el = document.getElementById(id); return el ? getComputedStyle(el).animationName : "missing"; }, id);
    await p.waitForTimeout(400);
    check(`builder ${vn}: section toggles open`, (await t.getAttribute("aria-expanded")) !== was);
    out.push(`INFO builder ${vn}: panel animation = ${anim}`);
    const tf = await p.evaluate((id) => getComputedStyle(document.getElementById(id)).transform, id);
    check(`builder ${vn}: no transform left on panel after reveal`, tf === "none", tf);
    const rot = await t.evaluate((b) => getComputedStyle(b.querySelector("svg")).rotate);
    out.push(`INFO builder ${vn}: open chevron rotate = ${rot}`);
    await p.screenshot({ path: `${dir}/builder-section-open__${vn}.png` });
  }
  const badge = await p.locator("[data-testid=save-badge]").count();
  out.push(`INFO builder ${vn}: save badge with data-state present = ${badge > 0}`);
  await p.context().close();
}
// 5. Buttons: press feedback present
{
  const p = await page(PHONE, false); await p.goto(A + "/pricing", { waitUntil: "networkidle" });
  const cls = await p.evaluate(() => [...document.querySelectorAll("a,button")].filter(e => e.className.includes?.("active:scale")).length);
  out.push(`INFO pricing: ${cls} buttons/links with press feedback`);
  await p.context().close();
}
await browser.close();
fs.writeFileSync(`${dir}/interactions.txt`, out.join("\n") + "\n\nconsole/page errors:\n" + (errors.join("\n") || "none") + "\n");
console.log(out.join("\n")); console.log("errors:", errors.length ? errors.join(" | ") : "none");
