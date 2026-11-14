// SMS sign-in browser tests: phone code sign-in, new vs existing accounts, linking a phone to an
// existing email account, checkout continuity (monthly + annual), refresh mid-verification, settings.
// Usage: node scripts/sms-auth/run.mjs <screenshotDir>
// Needs `next start` on :3000 built with NEXT_PUBLIC_SMS_SIGNIN=on against scripts/ux-audit/mock-supabase.mjs (:54321).
// No SMS is sent and Stripe is never contacted (checkout API + Stripe page are intercepted in the browser).
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.env.BASE ?? "http://localhost:3000";
const MOCK = process.env.MOCK ?? "http://localhost:54321";
const OUT = process.argv[2] ?? "sms-shots";
fs.mkdirSync(OUT, { recursive: true });
const STRIPE = "https://checkout.stripe.test/c/pay/";
const KNOWN = "5552345678"; // has an account in the mock
const NEW = "5553334444"; // no account yet

const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600 * 24 * 365 * 50, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };

const results = [];
const browser = await chromium.launch();
const log = async (reset = false) => (await fetch(`${MOCK}/__otp-log${reset ? "?reset=1" : ""}`)).json();

async function setup({ signedIn = false, viewport = { width: 1280, height: 900 }, mobile = false, scale = 2 } = {}) {
  await log(true);
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale, isMobile: mobile, hasTouch: mobile });
  if (signedIn) await ctx.addCookies([authCookie]);
  const calls = [];
  await ctx.route("**/api/stripe/checkout", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    calls.push(body);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ url: `${STRIPE}cs_test_${body.plan}`, plan: body.plan }) });
  });
  await ctx.route(`${STRIPE}**`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: `<title>Stripe (mock)</title><h1 id="stripe">Mock Stripe Checkout</h1><p id="plan">${route.request().url().split("cs_test_")[1]}</p>` }));
  const page = await ctx.newPage();
  return { ctx, page, calls };
}
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
async function test(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log(`✓ ${name}`); }
  catch (e) { results.push({ name, ok: false, error: String(e?.message ?? e).slice(0, 500) }); console.log(`✗ ${name}\n   ${String(e?.message ?? e).slice(0, 500)}`); }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const dialog = (page) => page.getByRole("dialog");
const noHScroll = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "page scrolls sideways");

async function enterPhone(page, digits) {
  await page.getByLabel("Mobile number").fill(digits);
  await page.getByRole("button", { name: /Text me a code/ }).click();
}
async function enterCode(page, code = "123456", button = /Verify and continue/, label = "Verification code") {
  await page.getByLabel(label).fill(code);
  await page.getByRole("button", { name: button }).click();
}

await test("Login: existing number → wrong code → right code → dashboard, no account created", async () => {
  const { ctx, page } = await setup();
  await page.goto(`${BASE}/login?next=/dashboard`);
  await dialog(page).getByLabel("Mobile number").waitFor();
  expect(await page.getByText("We'll text a 6-digit code").isVisible(), "login lead copy");
  await shot(page, "desktop-login-phone");
  await page.getByLabel("Mobile number").fill(KNOWN);
  expect(await page.getByLabel("Mobile number").inputValue() === "(555) 234-5678", "as-you-type formatting");
  await page.getByRole("button", { name: /Text me a code/ }).click();
  await dialog(page).getByText("Enter the code we texted you").waitFor();
  expect(await dialog(page).getByText("(555) 234-5678").first().isVisible(), "code step names the number");
  expect(await page.getByLabel("Verification code").getAttribute("autocomplete") === "one-time-code", "SMS autofill hint");
  expect(await page.getByRole("button", { name: /Resend code in \d+s/ }).isDisabled(), "resend cooldown");
  await enterCode(page, "000000");
  await page.getByText(/expired or is incorrect/).waitFor();
  await shot(page, "desktop-login-wrong-code");
  await enterCode(page);
  await page.waitForURL(/\/dashboard/);
  const l = await log();
  const otp = l.filter((x) => x.kind === "otp");
  expect(otp.length === 1 && otp[0].phone === "+15552345678" && otp[0].create_user === false && otp[0].channel === "sms", `one non-creating SMS send: ${JSON.stringify(otp)}`);
  expect(l.some((x) => x.kind === "verify" && x.type === "sms"), "verified as sms");
  await ctx.close();
});

await test("Invalid number is caught before any text is sent", async () => {
  const { ctx, page } = await setup();
  await page.goto(`${BASE}/login`);
  await enterPhone(page, "555-1234");
  await page.getByText(/Enter a 10-digit mobile number/).waitFor();
  expect((await log()).length === 0, "no SMS request for an invalid number");
  await ctx.close();
});

await test("New number → 'first time' choice → create account → signed in", async () => {
  const { ctx, page } = await setup();
  await page.goto(`${BASE}/login?next=/dashboard`);
  await enterPhone(page, NEW);
  await dialog(page).getByText("Is this your first time here?").waitFor();
  await shot(page, "desktop-new-number-choice");
  await page.getByRole("button", { name: /I'm new here/ }).click();
  await dialog(page).getByText("Enter the code we texted you").waitFor();
  await enterCode(page);
  await page.waitForURL(/\/dashboard/);
  const otp = (await log()).filter((x) => x.kind === "otp");
  expect(otp.length === 2 && otp[0].create_user === false && otp[1].create_user === true, `probe then create: ${JSON.stringify(otp)}`);
  await ctx.close();
});

await test("New number + existing email account → email code → confirm phone → same account (no duplicate)", async () => {
  const { ctx, page } = await setup();
  await page.goto(`${BASE}/login?next=/dashboard`);
  await enterPhone(page, NEW);
  await page.getByRole("button", { name: /I signed up with email before/ }).click();
  await page.getByLabel("Email on your account").fill("ux-test@built2bid.test");
  await shot(page, "desktop-link-email");
  await page.getByRole("button", { name: /Email me a verification code/ }).click();
  await enterCode(page);
  await dialog(page).getByText("Confirm your phone").waitFor();
  await shot(page, "desktop-link-confirm-phone");
  await enterCode(page, "123456", /Add phone and continue/);
  await page.waitForURL(/\/dashboard/);
  const l = await log();
  const seq = l.map((x) => `${x.kind}:${x.type ?? ""}:${x.create_user ?? ""}`);
  expect(JSON.stringify(seq) === JSON.stringify(["otp::false", "otp::false", "verify:email:", "update_user::", "verify:phone_change:"]), `sequence ${JSON.stringify(seq)}`);
  expect(!l.some((x) => x.create_user === true), "never creates an account while linking");
  expect(l.find((x) => x.kind === "update_user").phone === "+15553334444", "links the number that was entered");
  await ctx.close();
});

await test("Linking refuses an email with no account (a typo can't create a second account)", async () => {
  const { ctx, page } = await setup();
  await page.goto(`${BASE}/login`);
  await enterPhone(page, NEW);
  await page.getByRole("button", { name: /I signed up with email before/ }).click();
  await page.getByLabel("Email on your account").fill("typo@example.test");
  await page.getByRole("button", { name: /Email me a verification code/ }).click();
  await page.getByText(/couldn't find an account with that email/).waitFor();
  await ctx.close();
});

await test("'Use email instead' keeps the email path for recovery", async () => {
  const { ctx, page } = await setup();
  await page.goto(`${BASE}/login?next=/dashboard`);
  await page.getByRole("button", { name: "Use email instead" }).click();
  await page.getByLabel("Business email").fill("someone@example.test");
  await page.getByRole("button", { name: /Email me a verification code/ }).click();
  await enterCode(page);
  await page.waitForURL(/\/dashboard/);
  const otp = (await log()).filter((x) => x.kind === "otp");
  expect(otp.length === 1 && otp[0].email === "someone@example.test" && otp[0].create_user === true, `email sign-up: ${JSON.stringify(otp)}`);
  await ctx.close();
});

for (const plan of ["monthly", "annual"]) {
  await test(`Checkout ${plan}: choose plan → text code → straight to Stripe with ${plan}, no second plan pick`, async () => {
    const { ctx, page, calls } = await setup();
    await page.goto(`${BASE}/pricing`);
    await page.getByRole("button", { name: plan === "monthly" ? "Choose Monthly" : "Choose Annual" }).click();
    await dialog(page).getByText("You're almost there!").waitFor();
    expect(await dialog(page).getByText(plan === "monthly" ? "$19.99" : "$149").first().isVisible(), "plan price in modal");
    expect(await dialog(page).getByText(/Verify your mobile number to continue/).isVisible(), "phone copy");
    await shot(page, `desktop-checkout-${plan}-phone`);
    await enterPhone(page, KNOWN);
    await dialog(page).getByText(/We texted a 6-digit code to \(555\) 234-5678/).waitFor();
    await shot(page, `desktop-checkout-${plan}-code`);
    await enterCode(page);
    await page.waitForURL(`${STRIPE}**`);
    expect(await page.locator("#plan").textContent() === plan, "Stripe got the chosen plan");
    expect(calls.length === 1 && calls[0].plan === plan, `one checkout request: ${JSON.stringify(calls)}`);
    await ctx.close();
  });
}

await test("Checkout: refresh while waiting for the text reopens the code step with the same plan and number", async () => {
  const { ctx, page, calls } = await setup();
  await page.goto(`${BASE}/pricing`);
  await page.getByRole("button", { name: "Choose Annual" }).click();
  await enterPhone(page, KNOWN);
  await page.getByLabel("Verification code").waitFor();
  await page.reload();
  await dialog(page).getByLabel("Verification code").waitFor();
  expect(await dialog(page).getByText("$149").first().isVisible(), "annual kept after refresh");
  expect(await dialog(page).getByText(/\(555\) 234-5678/).first().isVisible(), "number kept after refresh");
  expect(await page.getByRole("button", { name: /Resend code in \d+s/ }).isDisabled(), "cooldown survives the refresh");
  await enterCode(page);
  await page.waitForURL(`${STRIPE}**`);
  expect(calls.length === 1 && calls[0].plan === "annual", "annual checkout after refresh");
  expect((await log()).filter((x) => x.kind === "otp").length === 1, "refresh did not send a second text");
  await ctx.close();
});

await test("Settings: signed-in email account can add a phone (verified by code)", async () => {
  const { ctx, page } = await setup({ signedIn: true });
  await page.goto(`${BASE}/settings/account`);
  await page.getByRole("heading", { name: "Sign-in methods" }).waitFor();
  await page.getByRole("button", { name: "Add phone" }).click();
  await page.getByLabel("Mobile number").fill(NEW);
  await page.getByRole("button", { name: /Text me a code/ }).click();
  await page.getByLabel(/Code texted to/).fill("123456");
  await shot(page, "desktop-settings-add-phone");
  await page.getByRole("button", { name: "Confirm phone" }).click();
  await page.getByText(/Phone added/).waitFor();
  const l = await log();
  expect(l.some((x) => x.kind === "update_user" && x.phone === "+15553334444") && l.some((x) => x.kind === "verify" && x.type === "phone_change"), `link calls ${JSON.stringify(l)}`);
  await ctx.close();
});

await test("Settings: a number owned by another account is refused with a clear message", async () => {
  const { ctx, page } = await setup({ signedIn: true });
  await page.goto(`${BASE}/settings/account`);
  await page.getByRole("button", { name: "Add phone" }).click();
  await page.getByLabel("Mobile number").fill("5559990000");
  await page.getByRole("button", { name: /Text me a code/ }).click();
  await page.getByText(/already used by another Built2Bid account/).waitFor();
  await ctx.close();
});

for (const [w, h, tag] of [[390, 844, "m390"], [320, 640, "m320"]]) {
  await test(`Mobile ${w}px: phone step, new-number choice and checkout code fit without sideways scroll`, async () => {
    const { ctx, page } = await setup({ viewport: { width: w, height: h }, mobile: true, scale: 3 });
    await page.goto(`${BASE}/login`);
    await page.getByLabel("Mobile number").waitFor();
    await noHScroll(page);
    await shot(page, `${tag}-login-phone`);
    await enterPhone(page, NEW);
    await dialog(page).getByText("Is this your first time here?").waitFor();
    await noHScroll(page);
    await shot(page, `${tag}-new-number-choice`);
    await page.goto(`${BASE}/pricing`);
    await page.getByRole("button", { name: "Choose Monthly" }).click();
    await enterPhone(page, KNOWN);
    await page.getByLabel("Verification code").waitFor();
    await noHScroll(page);
    await shot(page, `${tag}-checkout-code`);
    await ctx.close();
  });
}

await browser.close();
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
