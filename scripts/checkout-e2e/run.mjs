// Checkout-flow browser tests: plan choice → email code → automatic checkout, plus recovery paths.
// Usage: node scripts/checkout-e2e/run.mjs <screenshotDir>
// Needs `next start` on :3000 built against scripts/ux-audit/mock-supabase.mjs (:54321).
// Stripe is never contacted: /api/stripe/checkout and the Stripe page are intercepted in the browser.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = process.argv[2] ?? "checkout-shots";
fs.mkdirSync(OUT, { recursive: true });
const STRIPE = "https://checkout.stripe.test/c/pay/";

const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600 * 24 * 365 * 50, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };

const results = [];
const browser = await chromium.launch();

/** New context with an intercepted checkout API. `respond(plan, n)` returns {status, body} or "abort". */
async function setup({ signedIn = false, viewport = { width: 1280, height: 900 }, respond, scale = 2, mobile = false } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale, isMobile: mobile, hasTouch: mobile });
  if (signedIn) await ctx.addCookies([authCookie]);
  const calls = [];
  await ctx.route("**/api/stripe/checkout", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    calls.push(body);
    const r = respond ? await respond(body.plan, calls.length) : null;
    if (r === "abort") return route.abort("internetdisconnected");
    if (r) return route.fulfill({ status: r.status, contentType: "application/json", body: JSON.stringify(r.body) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ url: `${STRIPE}cs_test_${body.plan}`, plan: body.plan }) });
  });
  await ctx.route(`${STRIPE}**`, (route) => {
    const plan = route.request().url().split("cs_test_")[1];
    return route.fulfill({ status: 200, contentType: "text/html", body: `<title>Stripe (mock)</title><h1 id="stripe">Mock Stripe Checkout</h1><p id="plan">${plan}</p>` });
  });
  const page = await ctx.newPage();
  return { ctx, page, calls };
}

const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
const fullShot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });

async function test(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log(`✓ ${name}`); }
  catch (e) { results.push({ name, ok: false, error: String(e?.message ?? e).slice(0, 400) }); console.log(`✗ ${name}\n   ${String(e?.message ?? e).slice(0, 400)}`); }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const dialog = (page) => page.getByRole("dialog");

async function verifyEmail(page, { email = "new-contractor@example.test", wrongFirst = false } = {}) {
  await page.getByLabel("Business email").fill(email);
  await page.getByRole("button", { name: /Email me a verification code/ }).click();
  await page.getByLabel("Verification code").waitFor();
  if (wrongFirst) {
    await page.getByLabel("Verification code").fill("000000");
    await page.getByRole("button", { name: /Verify and continue/ }).click();
    await page.getByText(/incorrect or has expired/).waitFor();
  }
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: /Verify and continue/ }).click();
}

// 1. Monthly: choose → verify (after one wrong code) → straight to Stripe with monthly.
await test("Monthly selected → OTP (wrong code first) → automatic checkout, one request", async () => {
  const { ctx, page, calls } = await setup();
  await page.goto(`${BASE}/pricing`);
  await fullShot(page, "desktop-pricing");
  await page.getByRole("button", { name: "Choose Monthly" }).click();
  await dialog(page).getByText("You're almost there!").waitFor();
  expect(await dialog(page).getByText("Verify your email to continue with Unlimited Monthly.").isVisible(), "monthly heading copy");
  expect(await dialog(page).getByText("$19.99").isVisible(), "monthly price in modal");
  await shot(page, "desktop-modal-monthly-email");
  await page.getByLabel("Business email").fill("new-contractor@example.test");
  await page.getByRole("button", { name: /Email me a verification code/ }).click();
  await page.getByLabel("Verification code").waitFor();
  await page.getByLabel("Verification code").fill("000000");
  await page.getByRole("button", { name: /Verify and continue/ }).click();
  await page.getByText(/incorrect or has expired/).waitFor();
  expect(await dialog(page).getByText("Unlimited Monthly", { exact: true }).isVisible(), "plan kept after wrong code");
  await shot(page, "desktop-modal-wrong-code");
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: /Verify and continue/ }).click();
  await page.waitForURL(/checkout\.stripe\.test/);
  expect((await page.textContent("#plan")) === "monthly", "Stripe got monthly");
  expect(calls.length === 1 && calls[0].plan === "monthly", `expected 1 monthly call, got ${JSON.stringify(calls)}`);
  expect(!("price" in calls[0]), "client never sends a price");
  await ctx.close();
});

// 2. Annual, including the code-step screenshot and the in-modal plan switch.
await test("Annual selected → OTP → automatic checkout (and plan switch inside modal)", async () => {
  const { ctx, page, calls } = await setup();
  await page.goto(`${BASE}/pricing`);
  await page.getByRole("button", { name: "Choose Monthly" }).click();
  await dialog(page).getByRole("radio", { name: "Annual" }).click();
  await dialog(page).getByText("Verify your email to continue with Unlimited Annual.").waitFor();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
  expect(await dialog(page).getByText("Equivalent to $12.42/month.").isVisible(), "annual equivalent in modal");
  expect(await dialog(page).getByText(/Billed annually: \$149 charged once a year/).isVisible(), "annual billing line");
  await shot(page, "desktop-modal-annual-email");
  await page.getByLabel("Business email").fill("annual@example.test");
  await page.getByRole("button", { name: /Email me a verification code/ }).click();
  await page.getByLabel("Verification code").waitFor();
  await shot(page, "desktop-modal-annual-code");
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: /Verify and continue/ }).click();
  await page.waitForURL(/checkout\.stripe\.test/);
  expect((await page.textContent("#plan")) === "annual", "Stripe got annual");
  expect(calls.length === 1 && calls[0].plan === "annual", `calls ${JSON.stringify(calls)}`);
  await ctx.close();
});

// 3. Refresh mid-verification keeps plan and email, reopens at the code step.
await test("Page refresh during verification → plan and code step preserved", async () => {
  const { ctx, page, calls } = await setup();
  await page.goto(`${BASE}/pricing`);
  await page.getByRole("button", { name: "Choose Annual" }).click();
  await page.getByLabel("Business email").fill("refresh@example.test");
  await page.getByRole("button", { name: /Email me a verification code/ }).click();
  await page.getByLabel("Verification code").waitFor();
  await page.reload();
  await page.getByLabel("Verification code").waitFor();
  expect(await dialog(page).getByText(/continue with Unlimited Annual/).first().isVisible(), "annual kept after refresh");
  expect(await dialog(page).getByText(/refresh@example.test/).isVisible(), "email kept after refresh");
  await shot(page, "desktop-modal-after-refresh");
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: /Verify and continue/ }).click();
  await page.waitForURL(/checkout\.stripe\.test/);
  expect(calls.length === 1 && calls[0].plan === "annual", `calls ${JSON.stringify(calls)}`);
  await ctx.close();
});

// 4. Closing the modal never discards the plan.
await test("Closing the verification modal keeps the selection with a Continue button", async () => {
  const { ctx, page } = await setup();
  await page.goto(`${BASE}/pricing`);
  await page.getByRole("button", { name: "Choose Monthly" }).click();
  await page.keyboard.press("Escape");
  await page.getByText("Your Unlimited Monthly selection is saved.").waitFor();
  await page.getByRole("button", { name: /Continue to secure checkout/ }).click();
  await dialog(page).getByText("Verify your email to continue with Unlimited Monthly.").waitFor();
  await ctx.close();
});

// 5. Network failure → retry.
await test("Network failure → prominent retry, plan preserved, then succeeds", async () => {
  const { ctx, page, calls } = await setup({ respond: (_p, n) => (n === 1 ? "abort" : null) });
  await page.goto(`${BASE}/pricing`);
  await page.getByRole("button", { name: "Choose Annual" }).click();
  await verifyEmail(page);
  await dialog(page).getByText("Checkout didn't open").waitFor();
  expect(await dialog(page).getByText(/couldn't reach the server/).isVisible(), "network message");
  await shot(page, "desktop-checkout-failed-retry");
  await dialog(page).getByRole("button", { name: /Continue to secure checkout/ }).click();
  await page.waitForURL(/checkout\.stripe\.test/);
  expect(calls.length === 2 && calls.every((c) => c.plan === "annual"), `calls ${JSON.stringify(calls)}`);
  await ctx.close();
});

// 6. Stripe initiation failure.
await test("Stripe initiation failure → clear message and retry", async () => {
  const { ctx, page } = await setup({ signedIn: true, respond: () => ({ status: 500, body: { error: { code: "checkout_failed", message: "We couldn't start checkout. Please try again." } } }) });
  await page.goto(`${BASE}/pricing`);
  await page.getByRole("button", { name: "Choose Monthly" }).click();
  await dialog(page).getByText("We couldn't start checkout. Please try again.").waitFor();
  expect(await dialog(page).getByRole("button", { name: /Continue to secure checkout/ }).isVisible(), "retry button");
  await ctx.close();
});

// 7. Logged-in user → immediate checkout, no modal.
await test("Logged-in user → immediate checkout", async () => {
  const { ctx, page, calls } = await setup({ signedIn: true });
  await page.goto(`${BASE}/pricing`);
  await page.getByRole("button", { name: "Choose Monthly" }).click();
  await page.waitForURL(/checkout\.stripe\.test/);
  expect(calls.length === 1 && calls[0].plan === "monthly", `calls ${JSON.stringify(calls)}`);
  await ctx.close();
});

// 8. Existing subscriber → subscription management.
await test("Existing subscriber → sent to subscription management, no checkout", async () => {
  const { ctx, page } = await setup({ signedIn: true, respond: () => ({ status: 409, body: { error: { code: "already_subscribed", message: "You already have Unlimited." } } }) });
  await page.goto(`${BASE}/pricing`);
  await page.getByRole("button", { name: "Choose Annual" }).click();
  await page.waitForURL(/\/settings\/billing\?notice=already_subscribed/);
  await ctx.close();
});

// 9. Email-link sign-in returns to /pricing?resume=… → automatic checkout; duplicate tabs → one request.
await test("Email-link return (two tabs at once) → exactly one checkout request", async () => {
  const { ctx, page, calls } = await setup({ signedIn: true, respond: async () => { await new Promise((r) => setTimeout(r, 800)); return null; } });
  const page2 = await ctx.newPage();
  await Promise.all([page.goto(`${BASE}/pricing?resume=annual`), page2.goto(`${BASE}/pricing?resume=annual`)]);
  await Promise.race([page.waitForURL(/checkout\.stripe\.test/), page2.waitForURL(/checkout\.stripe\.test/)]);
  await page.waitForTimeout(1500);
  expect(calls.length === 1 && calls[0].plan === "annual", `expected one call, got ${calls.length}`);
  await ctx.close();
});

// 10. Old login link (/login?next=/pricing?upgrade=monthly) now resumes too: this was the reported bug.
await test("Login page path (original bug) → verify → automatic checkout", async () => {
  const { ctx, page, calls } = await setup();
  await page.goto(`${BASE}/login?next=${encodeURIComponent("/pricing?upgrade=monthly")}`);
  await page.getByLabel("Business email").fill("legacy@example.test");
  await page.getByRole("button", { name: /Email me a sign-in link/ }).click();
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: /Verify and continue/ }).click();
  await page.waitForURL(/checkout\.stripe\.test/, { timeout: 15000 });
  expect(calls.length === 1 && calls[0].plan === "monthly", `calls ${JSON.stringify(calls)}`);
  await ctx.close();
});

// 11. Cancelled checkout → plan preserved, no automatic redirect.
await test("Checkout cancellation → plan preserved, no auto-redirect, Continue works", async () => {
  const { ctx, page, calls } = await setup({ signedIn: true });
  await page.goto(`${BASE}/pricing?checkout=cancelled&plan=annual`);
  await page.getByText("Checkout was cancelled. You have not been charged.").waitFor();
  await page.getByText("Your Unlimited Annual selection is saved.").waitFor();
  await page.waitForTimeout(800);
  expect(calls.length === 0, "no automatic checkout after cancel");
  expect(!page.url().includes("checkout=cancelled"), "one-shot params removed");
  await shot(page, "desktop-cancelled-banner");
  await page.getByRole("button", { name: /Continue to secure checkout/ }).click();
  await page.waitForURL(/checkout\.stripe\.test/);
  expect(calls.length === 1 && calls[0].plan === "annual", `calls ${JSON.stringify(calls)}`);
  await ctx.close();
});

// 12. Back button from Stripe → no second automatic request.
await test("Back from Stripe → resume banner, no duplicate request", async () => {
  const { ctx, page, calls } = await setup({ signedIn: true });
  await page.goto(`${BASE}/pricing?resume=monthly`);
  await page.waitForURL(/checkout\.stripe\.test/);
  await page.goBack();
  await page.getByText("You haven't finished checking out.").waitFor();
  await page.waitForTimeout(800);
  expect(calls.length === 1, `expected 1 call, got ${calls.length}`);
  await ctx.close();
});

// 13. Delayed webhook → confirming state, no premature Unlimited.
await test("Delayed webhook → 'Confirming your payment' state, still Free", async () => {
  const { ctx, page } = await setup({ signedIn: true });
  await page.goto(`${BASE}/settings/billing?checkout=success&plan=annual`);
  await page.getByText("Confirming your Unlimited Annual payment…").waitFor();
  expect(await page.getByText("Free", { exact: true }).isVisible(), "plan still Free until Stripe confirms");
  await shot(page, "desktop-billing-confirming");
  await ctx.close();
});

// 14. Pricing copy.
await test("Pricing copy: $19.99/month billed monthly; $149/year billed annually; ≈38% savings", async () => {
  const { ctx, page } = await setup();
  await page.goto(`${BASE}/pricing`);
  const text = await page.textContent("main");
  for (const s of ["$19.99/month", "Billed monthly. Cancel anytime.", "$149/year", "Billed annually", "Equivalent to $12.42/month. Save approximately 38% compared with monthly billing.", "include exactly the same features"]) expect(text.includes(s), `missing "${s}"`);
  expect(!text.includes("Just $12.42"), "old copy removed");
  await ctx.close();
});

// 15. Mobile widths: no overflow, modal fits, inputs use the right keyboards.
for (const width of [320, 375, 390, 430]) {
  await test(`Mobile ${width}px: pricing readable, modal fits, no horizontal overflow`, async () => {
    const { ctx, page, calls } = await setup({ viewport: { width, height: 760 }, mobile: true, scale: 2 });
    await page.goto(`${BASE}/pricing`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow <= 0, `page overflows by ${overflow}px`);
    const annualCard = page.locator("h2", { hasText: "Unlimited Annual" }).locator("..");
    await annualCard.scrollIntoViewIfNeeded();
    await annualCard.screenshot({ path: path.join(OUT, `m${width}-annual-card.png`) });
    if (width === 390 || width === 320) await fullShot(page, `m${width}-pricing`);
    const btn = page.getByRole("button", { name: "Choose Annual" });
    const box = await btn.boundingBox();
    expect(box && box.height >= 44, `tap target ${box?.height}px`);
    const priceLine = annualCard.locator("p", { hasText: "$149/year" }).first();
    const lh = await priceLine.evaluate((el) => el.getBoundingClientRect().height);
    expect(lh < 60, `price line wraps (${lh}px)`);
    await btn.click();
    const dlg = dialog(page);
    await dlg.waitFor();
    const fits = async () => { const b = await dlg.boundingBox(); return b && b.x >= 0 && b.y >= 0 && b.x + b.width <= width + 0.5 && b.y + b.height <= 760 + 0.5; };
    expect(await fits(), "email step modal fits viewport");
    expect((await page.getByLabel("Business email").getAttribute("type")) === "email", "email keyboard");
    await shot(page, `m${width}-modal-email`);
    await page.getByLabel("Business email").fill("phone@example.test");
    await page.getByRole("button", { name: /Email me a verification code/ }).click();
    await page.getByLabel("Verification code").waitFor();
    expect((await page.getByLabel("Verification code").getAttribute("inputmode")) === "numeric", "numeric keyboard");
    expect(await fits(), "code step modal fits viewport");
    await shot(page, `m${width}-modal-code`);
    await page.getByLabel("Verification code").fill("123456");
    await page.getByRole("button", { name: /Verify and continue/ }).click();
    await page.waitForURL(/checkout\.stripe\.test/);
    expect(calls.length === 1 && calls[0].plan === "annual", `calls ${JSON.stringify(calls)}`);
    await ctx.close();
  });
}

await test("Mobile 390px: cancelled banner and retry modal", async () => {
  const { ctx, page } = await setup({ viewport: { width: 390, height: 760 }, mobile: true, signedIn: true, respond: () => "abort" });
  await page.goto(`${BASE}/pricing?checkout=cancelled&plan=monthly`);
  await page.getByText("Your Unlimited Monthly selection is saved.").waitFor();
  await shot(page, "m390-cancelled-banner");
  await page.getByRole("button", { name: /Continue to secure checkout/ }).click();
  await dialog(page).getByText("Checkout didn't open").waitFor();
  await shot(page, "m390-checkout-failed-retry");
  await ctx.close();
});

await browser.close();
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
