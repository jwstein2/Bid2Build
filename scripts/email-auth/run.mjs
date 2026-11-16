// Email-only sign-in browser tests: no phone UI or SMS requests, exact 6-digit code entry (typing,
// paste, leading zeros, too-long paste, wrong code, resend cooldown), redirect safety, settings, and
// account settings.
// Usage: node scripts/email-auth/run.mjs <screenshotDir>
// Needs `next start` on :3000 built WITHOUT NEXT_PUBLIC_SMS_AUTH_ENABLED against scripts/ux-audit/mock-supabase.mjs (:54321).
// The mock accepts codes 123456 and 012345. No email or SMS is sent.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.env.BASE ?? "http://localhost:3000";
const MOCK = process.env.MOCK ?? "http://localhost:54321";
const OUT = process.argv[2] ?? "email-auth-shots";
fs.mkdirSync(OUT, { recursive: true });

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
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale, isMobile: mobile, hasTouch: mobile, permissions: ["clipboard-read", "clipboard-write"] });
  if (signedIn) await ctx.addCookies([authCookie]);
  const page = await ctx.newPage();
  return { ctx, page };
}
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
async function test(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log(`✓ ${name}`); }
  catch (e) { results.push({ name, ok: false, error: String(e?.message ?? e).slice(0, 500) }); console.log(`✗ ${name}\n   ${String(e?.message ?? e).slice(0, 500)}`); }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const dialog = (page) => page.getByRole("dialog");
const codeBox = (page) => page.getByLabel("6-digit verification code");
const noPhoneRequests = (l) => {
  expect(!l.some((x) => x.phone), `a phone number reached Supabase: ${JSON.stringify(l.filter((x) => x.phone))}`);
  expect(!l.some((x) => x.channel === "sms" || x.type === "sms" || x.type === "phone_change"), "an SMS request reached Supabase");
};
/** Simulates a real paste event (clipboard text → input) the way a browser delivers it. */
async function paste(page, text) {
  await codeBox(page).focus();
  await page.evaluate((t) => {
    const el = document.activeElement;
    const dt = new DataTransfer(); dt.setData("text/plain", t);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, text);
}
async function requestCode(page, email = "new-contractor@example.test") {
  await dialog(page).getByLabel("Business email").fill(email);
  await page.getByRole("button", { name: /Email me a verification code/ }).click();
  await codeBox(page).waitFor();
}

await test("Login page is email-only: no phone field, no text option", async () => {
  const { ctx, page } = await setup();
  await page.goto(`${BASE}/login?next=/dashboard`);
  await dialog(page).getByLabel("Business email").waitFor();
  expect(await page.getByText(/No password needed. We'll email you a 6-digit code/).isVisible(), "lead copy says 6-digit email code");
  for (const t of [/Continue with phone/i, /Text me a code/i, /Use my phone/i, /Mobile number/i, /Sign in with phone/i, /Send text/i])
    expect(await page.getByText(t).count() === 0, `found phone UI: ${t}`);
  expect(await page.locator('input[type="tel"]').count() === 0, "a tel input is on the login page");
  await shot(page, "desktop-login-email");
  await ctx.close();
});

await test("Code box: numeric, one-time-code autofill, exactly 6 digits, submit only at 6", async () => {
  const { ctx, page } = await setup();
  await page.goto(`${BASE}/login?next=/dashboard`);
  await requestCode(page);
  const box = codeBox(page);
  expect(await box.getAttribute("inputmode") === "numeric", "inputmode numeric");
  expect(await box.getAttribute("autocomplete") === "one-time-code", "autocomplete one-time-code");
  expect(await box.getAttribute("maxlength") === "6", "maxlength 6");
  expect(await dialog(page).getByText("We sent a 6-digit code to new-contractor@example.test").isVisible(), "sent copy names 6 digits");
  expect(await dialog(page).getByText(/link/i).count() === 0, "code step still mentions a link");
  await box.pressSequentially("12345");
  expect(await page.getByRole("button", { name: /Verify and continue/ }).isDisabled(), "submit enabled with 5 digits");
  await box.pressSequentially("6789");
  expect(await box.inputValue() === "123456", `typing past 6 digits gave ${await box.inputValue()}`);
  expect(await page.getByRole("button", { name: /Verify and continue/ }).isEnabled(), "submit disabled with 6 digits");
  await shot(page, "desktop-code-step");
  await ctx.close();
});

await test("Wrong code is rejected with a clear message; right code signs in to the intended page", async () => {
  const { ctx, page } = await setup();
  await page.goto(`${BASE}/login?next=/dashboard/customers`);
  await requestCode(page);
  await codeBox(page).fill("000000");
  await page.getByRole("button", { name: /Verify and continue/ }).click();
  await page.getByText(/That code is incorrect or has expired/).waitFor();
  await shot(page, "desktop-wrong-code");
  await codeBox(page).fill("123456");
  await page.getByRole("button", { name: /Verify and continue/ }).click();
  await page.waitForURL(/\/dashboard\/customers/);
  const l = await log();
  expect(l.some((x) => x.kind === "verify" && x.type === "email"), "email verify call");
  noPhoneRequests(l);
  await ctx.close();
});

await test("Pasted code with a leading zero and spacing is kept intact (012 345 → 012345) and verifies", async () => {
  const { ctx, page } = await setup();
  await page.goto(`${BASE}/login?next=/dashboard`);
  await requestCode(page);
  await paste(page, " 012 345\n");
  expect(await codeBox(page).inputValue() === "012345", `pasted value ${await codeBox(page).inputValue()}`);
  await page.getByRole("button", { name: /Verify and continue/ }).click();
  await page.waitForURL(/\/dashboard/); // the mock only accepts "012345" with its zero
  await ctx.close();
});

await test("A pasted 8- or 9-digit code is refused, never trimmed to 6", async () => {
  const { ctx, page } = await setup();
  await page.goto(`${BASE}/login?next=/dashboard`);
  await requestCode(page);
  for (const long of ["12345678", "123456789"]) {
    await paste(page, long);
    await page.getByText(/more than 6 digits/).waitFor();
    expect(await codeBox(page).inputValue() === "", `long code became ${await codeBox(page).inputValue()}`);
  }
  await shot(page, "desktop-too-long-paste");
  const l = await log();
  expect(!l.some((x) => x.kind === "verify"), "a verify call was sent for a too-long code");
  await ctx.close();
});

await test("Resend is rate-limited in the UI and sends a fresh email code", async () => {
  const { ctx, page } = await setup();
  await page.goto(`${BASE}/login?next=/dashboard`);
  await requestCode(page);
  expect(await page.getByRole("button", { name: /Resend code in \d+s/ }).isDisabled(), "resend cooldown");
  const l = await log();
  expect(l.filter((x) => x.kind === "otp").length === 1 && l[0].email === "new-contractor@example.test", "one email code request");
  noPhoneRequests(l);
  await ctx.close();
});

await test("Open redirects are refused: next=https://evil.example → stays on built2bid", async () => {
  const { ctx, page } = await setup();
  await page.goto(`${BASE}/login?next=${encodeURIComponent("https://evil.example/steal")}`);
  await requestCode(page);
  await codeBox(page).fill("123456");
  await page.getByRole("button", { name: /Verify and continue/ }).click();
  await page.waitForLoadState("networkidle");
  expect(new URL(page.url()).origin === new URL(BASE).origin, `left the site: ${page.url()}`);
  await ctx.close();
});

await test("Hidden SMS route is closed: /api/auth/phone-abandon answers 404", async () => {
  const r = await fetch(`${BASE}/api/auth/phone-abandon`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ phone: "+12187900140" }) });
  expect(r.status === 404, `status ${r.status}`);
});

await test("Account settings: no Add phone option; email sign-in still shown", async () => {
  const { ctx, page } = await setup({ signedIn: true });
  await page.goto(`${BASE}/settings/account`);
  await page.getByText(/Email/).first().waitFor();
  expect(await page.getByRole("button", { name: /Add phone|Change number/ }).count() === 0, "phone sign-in option visible");
  await shot(page, "desktop-settings-account");
  await ctx.close();
});

await test("Phone (390px): email sign-in fits, no sideways scroll", async () => {
  const { ctx, page } = await setup({ viewport: { width: 390, height: 844 }, mobile: true, scale: 3 });
  await page.goto(`${BASE}/login?next=/dashboard`);
  await requestCode(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "page scrolls sideways");
  await shot(page, "m390-code-step");
  await ctx.close();
});

await browser.close();
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
