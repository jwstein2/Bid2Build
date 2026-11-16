// Browser walk for feature discovery (registry, What's New notice + page, unlocked modal, walkthrough).
// Local build against the mock Supabase (canned test account, NOT production):
//   node scripts/ux-audit/mock-supabase.mjs &      (free account; the walk switches scenarios itself)
//   (build + `next start` against the mock on :54321)
//   node scripts/features/walk.mjs <screenshotDir>
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const dir = process.argv[2] ?? "features-shots";
fs.mkdirSync(dir, { recursive: true });
const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };
const out = []; const check = (n, c) => out.push(`${c ? "✓" : "✗"} ${n}`);
const M = "http://localhost:54321", A = "http://localhost:3000";
const meta = async () => (await (await fetch(`${M}/auth/v1/user`)).json()).user_metadata?.b2b_features ?? null;
const reset = (created = new Date(Date.now() - 30 * 864e5).toISOString()) => fetch(`${M}/__features?created=${encodeURIComponent(created)}`);
const scenario = (n) => fetch(`${M}/__scenario?name=${n}`);
await fetch(`${M}/__onboarding?status=completed`);
const browser = await chromium.launch();
const errors = [];
async function ctxPage(vp = { width: 1440, height: 1000 }, mobile = false) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, ...(mobile ? { hasTouch: true, isMobile: true } : {}) });
  await ctx.addCookies([authCookie]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  return { ctx, page };
}
const step = async (page) => (await page.getByTestId("tour-progress").textContent())?.trim();
const title = async (page) => (await page.locator("#ft-title").textContent())?.trim();

// 1. Free account, existing (30 days old): What's New notice, no unlocked modal.
await scenario("starter"); await reset();
{
  const { ctx, page } = await ctxPage();
  await page.goto(`${A}/dashboard`, { waitUntil: "networkidle" });
  const notice = page.getByTestId("whats-new-notice");
  await notice.waitFor({ timeout: 8000 });
  const txt = await notice.textContent();
  check("free: What's New notice lists the 4.0 features it can use", txt.includes("Sales pipeline") && txt.includes("Sales analytics") && !txt.includes("Internal Estimate Report"));
  await page.waitForTimeout(2500);
  check("free: no unlocked-features modal", (await page.getByTestId("unlocked-modal").count()) === 0);
  const m0 = await meta();
  check("free: starting state stored per account with nothing acknowledged", m0 && Array.isArray(m0.acked) && m0.acked.length === 0);
  await page.screenshot({ path: `${dir}/notice-free-desktop.png` });

  // Help popover
  await page.getByTestId("help-pipeline").click();
  check("contextual help explains the pipeline", (await page.getByRole("note").textContent()).includes("Draft to Won"));
  await page.keyboard.press("Escape");

  // 2. Walkthrough from the notice
  await notice.getByRole("button", { name: "Show me" }).click();
  await page.getByTestId("feature-tour").waitFor();
  await page.waitForTimeout(400);
  check("tour: step 1 highlights the Pipeline tab", (await step(page)) === "Step 1 of 3" && (await title(page)) === "Your bids as a pipeline" && (await page.getByTestId("tour-spotlight").count()) === 1);
  await page.screenshot({ path: `${dir}/tour-step1-desktop.png` });
  check("tour: notice dismissed when the tour starts", (await page.getByTestId("whats-new-notice").count()) === 0 && (await meta()).notice === "4.0.0");
  await page.getByRole("button", { name: "Next" }).click();
  await page.waitForTimeout(400);
  check("tour: step 2 highlights Analytics", (await title(page)) === "How sales are going" && (await page.getByTestId("tour-spotlight").count()) === 1);
  await page.getByRole("button", { name: "Try it" }).click();
  await page.waitForTimeout(500);
  check("tour: Try it opens the real Analytics view", (await page.getByTestId("view-analytics").getAttribute("aria-selected")) === "true");
  await page.getByRole("button", { name: "Back" }).click();
  check("tour: Back works", (await step(page)) === "Step 1 of 3");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.waitForTimeout(500);
  check("tour: step 3 highlights the sales pay calculator", (await title(page)) === "Estimate your sales pay" && (await page.getByTestId("tour-spotlight").count()) === 1);
  await page.screenshot({ path: `${dir}/tour-step3-desktop.png` });
  await page.getByRole("button", { name: "Finish" }).click();
  await page.waitForTimeout(500);
  check("tour: Finish closes it and saves completion", (await page.getByTestId("feature-tour").count()) === 0 && (await meta()).tour === "completed");

  // 3. What's New page
  await page.goto(`${A}/whats-new`, { waitUntil: "load" }); await page.getByTestId("release").first().waitFor();
  check("What's New: lists both releases from the registry", (await page.getByTestId("release").count()) === 2);
  check("What's New: locked premium feature offers Upgrade", (await page.getByTestId("whats-new-internal_report").getByRole("link", { name: "Upgrade" }).count()) === 1);
  check("What's New: free feature opens directly", (await page.getByTestId("whats-new-pipeline").getByRole("link", { name: "Open" }).count()) === 1);
  await page.screenshot({ path: `${dir}/whats-new-free-desktop.png`, fullPage: true });
  await page.goto(`${A}/dashboard`, { waitUntil: "networkidle" }); await page.waitForTimeout(2000);
  check("free: notice stays dismissed after reload", (await page.getByTestId("whats-new-notice").count()) === 0);
  await ctx.close();
}

// 4. Same account upgrades: checkout return shows the unlocked modal once.
await scenario("unlimited");
{
  const { ctx, page } = await ctxPage();
  await page.goto(`${A}/settings/billing?checkout=success&plan=monthly`, { waitUntil: "networkidle" });
  const modal = page.getByTestId("unlocked-modal");
  await modal.waitFor({ timeout: 12000 });
  const names = await modal.getByTestId("unlocked-feature").allTextContents();
  check(`upgrade: "Your New Features Are Ready" lists the 3 Unlimited features (${names.length})`, names.length === 3 && names.some((n) => n.includes("Internal Estimate Report")) && names.some((n) => n.includes("Saved Items")) && !names.some((n) => n.includes("Sales pipeline")));
  check("upgrade: modal has Explore Features, Maybe Later and Close", await page.getByRole("button", { name: "Explore Features" }).isVisible() && await page.getByRole("button", { name: "Maybe Later" }).isVisible() && await page.getByRole("button", { name: "Close" }).isVisible());
  await page.screenshot({ path: `${dir}/unlocked-modal-desktop.png` });
  await page.getByRole("button", { name: "Explore Features" }).click();
  await page.waitForURL("**/dashboard");
  await page.getByTestId("feature-tour").waitFor({ timeout: 8000 });
  await page.waitForTimeout(400);
  check("explore: walkthrough of the unlocked features starts on the dashboard", (await step(page)) === "Step 1 of 3");
  const t1 = await title(page);
  // Every step points at something on screen: internal report = first bid's Open link (Table view).
  let lit = 0;
  for (let k = 0; k < 3; k++) {
    if ((await page.getByTestId("tour-spotlight").count()) === 1 && (await page.getByText("This isn't on the current screen.").count()) === 0) lit++;
    if (k < 2) { await page.getByRole("button", { name: "Next" }).click(); await page.waitForTimeout(500); }
  }
  check(`explore: all 3 unlocked-feature steps highlight a visible control (${lit}/3, first: ${t1})`, lit === 3);
  await page.screenshot({ path: `${dir}/tour-unlocked-desktop.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);
  const m = await meta();
  check("explore: features acknowledged, Escape records a skip", ["internal_report", "library", "templates"].every((id) => m.acked.includes(id)) && m.tour === "dismissed");
  await page.goto(`${A}/dashboard`, { waitUntil: "networkidle" }); await page.waitForTimeout(3000);
  check("upgrade: modal doesn't reopen on the next visit", (await page.getByTestId("unlocked-modal").count()) === 0);
  await page.goto(`${A}/whats-new`, { waitUntil: "load" }); await page.getByTestId("release").first().waitFor();
  check("What's New (paid): premium feature shows Included", (await page.getByTestId("whats-new-internal_report").textContent()).includes("Included in your plan"));
  await ctx.close();
}

// 5. Long-time paying customer at rollout: told only about the new premium feature.
await scenario("unlimited"); await reset();
{
  const { ctx, page } = await ctxPage();
  await page.goto(`${A}/dashboard`, { waitUntil: "networkidle" });
  const modal = page.getByTestId("unlocked-modal");
  await modal.waitFor({ timeout: 8000 });
  const names = await modal.getByTestId("unlocked-feature").allTextContents();
  check(`existing paid: modal lists only Internal Estimate Report (${names.length})`, names.length === 1 && names[0].includes("Internal Estimate Report"));
  await page.getByRole("button", { name: "Maybe Later" }).click();
  await page.waitForTimeout(500);
  check("existing paid: Maybe Later acknowledges (no tour)", (await meta()).acked.includes("internal_report") && (await page.getByTestId("feature-tour").count()) === 0);
  await ctx.close();
}

// 6. Brand-new account: no "what's new" for the current release.
await scenario("starter"); await reset(new Date().toISOString());
{
  const { ctx, page } = await ctxPage();
  await page.goto(`${A}/dashboard`, { waitUntil: "networkidle" }); await page.waitForTimeout(3000);
  check("new account: no What's New notice and no modal", (await page.getByTestId("whats-new-notice").count()) === 0 && (await page.getByTestId("unlocked-modal").count()) === 0);
  await ctx.close();
}

// 7. Mobile: notice, walkthrough and What's New fit; sidebar-only steps fall back to a centered card.
await scenario("unlimited"); await reset();
await fetch(`${M}/__features`); // keep created date; clear state
for (const [label, vp] of [["m390", { width: 390, height: 844 }], ["m320", { width: 320, height: 720 }]]) {
  const { ctx, page } = await ctxPage(vp, true);
  await page.goto(`${A}/dashboard`, { waitUntil: "networkidle" });
  if (label === "m390") {
    await page.getByTestId("unlocked-modal").waitFor({ timeout: 8000 });
    await page.screenshot({ path: `${dir}/unlocked-modal-${label}.png` });
    await page.getByRole("button", { name: "Explore Features" }).tap();
    await page.getByTestId("feature-tour").waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${dir}/tour-${label}.png` });
    const box = await page.locator('[aria-labelledby="ft-title"]').boundingBox();
    check(`${label}: tour card fits the screen`, box.x >= 0 && box.x + box.width <= vp.width);
    await page.getByRole("button", { name: "Close walkthrough" }).tap();
  }
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  check(`${label}: dashboard has no horizontal scroll (${sw})`, sw <= vp.width);
  await page.goto(`${A}/whats-new`, { waitUntil: "load" }); await page.getByTestId("release").first().waitFor();
  const sw2 = await page.evaluate(() => document.documentElement.scrollWidth);
  check(`${label}: What's New has no horizontal scroll (${sw2})`, sw2 <= vp.width);
  await page.screenshot({ path: `${dir}/whats-new-${label}.png`, fullPage: true });
  await ctx.close();
}

// 8. Full walkthrough for a paid account started from the Pipeline view (the reported bug: "Estimate your
// sales pay" said "This isn't on the current screen" because the calculator lives in Analytics). Every step
// must highlight a visible control, in Light and Dark, on desktop and phone.
await scenario("unlimited");
for (const theme of ["light", "dark"]) {
  for (const [label, vp, mobile] of [["desktop", { width: 1440, height: 900 }, false], ["m390", { width: 390, height: 844 }, true]]) {
    await fetch(`${M}/__features`);
    const { ctx, page } = await ctxPage(vp, mobile);
    await ctx.addInitScript((m) => { try { localStorage.setItem("b2b-theme", JSON.stringify({ mode: m, at: Date.now() })); } catch {} }, theme);
    await page.goto(`${A}/dashboard?view=pipeline`, { waitUntil: "load" }); await page.waitForTimeout(1500);
    const modal = page.getByTestId("unlocked-modal");
    if (await modal.waitFor({ timeout: 5000 }).then(() => true, () => false)) await page.getByRole("button", { name: "Maybe Later" }).click();
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("b2b:features:tour", { detail: null })));
    await page.getByTestId("feature-tour").waitFor();
    const total = Number((await step(page)).match(/of (\d+)/)[1]);
    const missing = [];
    for (let k = 0; k < total; k++) {
      await page.waitForTimeout(800);
      const t = await title(page);
      const ok = (await page.getByTestId("tour-spotlight").count()) === 1 && (await page.getByText("This isn't on the current screen.").count()) === 0;
      if (!ok) missing.push(t);
      await page.screenshot({ path: `${dir}/full-tour-${theme}-${label}-step${k + 1}.png` });
      if (t === "Estimate your sales pay") check(`${theme} ${label}: sales pay step opens Analytics`, (await page.getByTestId("view-analytics").getAttribute("aria-selected")) === "true");
      await page.getByRole("button", { name: k === total - 1 ? "Finish" : "Next" }).click();
    }
    check(`${theme} ${label}: all ${total} walkthrough steps highlight a visible control${missing.length ? ` (missing: ${missing.join(", ")})` : ""}`, total === 6 && missing.length === 0);
    if (mobile) { await page.waitForTimeout(400); check(`${theme} ${label}: menu closes again after the walkthrough`, (await page.locator("#account-nav").isVisible()) === false); }
    check(`${theme} ${label}: theme applied`, (await page.getAttribute("html", "data-theme")) === (theme === "light" ? null : theme));
    await ctx.close();
  }
}

check("no page errors", errors.length === 0);
if (errors.length) console.log(errors);
await browser.close();
console.log(out.join("\n"));
const failed = out.filter((l) => l.startsWith("✗")).length;
console.log(`\n${out.length - failed}/${out.length} checks passed`);
process.exit(failed ? 1 : 0);
