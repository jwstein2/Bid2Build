// V6.0 Stage A: buyer + signed-in navigation journeys, real browser against the mock Supabase
// (fictitious data only; no real email or payment: the mock accepts code 123456 and Stripe is never called).
//   build with NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 STRIPE_PRICE_ENTERPRISE_BASE=x STRIPE_PRICE_ENTERPRISE_SEAT=y ...,
//   `next start`, node scripts/ux-audit/mock-supabase.mjs, then: node scripts/v6/journeys-walk.mjs <dir>
// Works against the old build too: failing checks there are the "before" evidence.
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const dir = process.argv[2] ?? "journeys-shots";
const tag = process.argv[3] ?? "run";
fs.mkdirSync(dir, { recursive: true });
const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };
const out = []; const check = (n, c) => { out.push(`${c ? "✓" : "✗"} ${n}`); };
const M = "http://localhost:54321", A = "http://localhost:3000";
const scenario = (n) => fetch(`${M}/__scenario?name=${n}`);
await fetch(`${M}/__onboarding?status=completed`);
await fetch(`${M}/__features?created=${encodeURIComponent(new Date().toISOString())}`);
const browser = await chromium.launch();
const errors = [];
const DESK = { width: 1440, height: 1000 }, PHONE = { width: 390, height: 844 };
async function open(path, { vp = DESK, signedIn = true } = {}) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 });
  if (signedIn) await ctx.addCookies([authCookie]);
  await ctx.addInitScript(() => {
    try { localStorage.setItem("b2b-theme", JSON.stringify({ mode: "light", at: 4102444800000 })); localStorage.setItem("b2b:onboarding", JSON.stringify({ status: "completed" })); } catch { /* */ }
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${path}: ${e.message}`));
  await page.goto(`${A}${path}`, { waitUntil: "load" });
  const later = page.getByRole("button", { name: "Maybe Later" });
  try { await later.waitFor({ timeout: 2000 }); await later.click(); } catch { /* none */ }
  await page.waitForTimeout(300);
  return { ctx, page };
}

// 1. Enterprise intent through sign-in (signed-out visitor, team of 5).
await scenario("starter");
{
  const { ctx, page } = await open("/pricing#enterprise", { signedIn: false });
  const card = page.getByTestId("enterprise-plan");
  await card.getByRole("button", { name: "More users" }).click();
  await card.getByRole("button", { name: "More users" }).click();
  const total = await card.getByTestId("enterprise-total").innerText();
  await card.getByRole("button", { name: /Get Started with Team/ }).click();
  await page.waitForTimeout(1200);
  const dlg = page.getByRole("dialog");
  const text = (await dlg.count()) ? await dlg.innerText() : "";
  check("Enterprise: verification stays on the pricing page", new URL(page.url()).pathname === "/pricing");
  check("Enterprise: dialog names Team, not a saved bid or free bids", /Team/.test(text) && !/bid is saved/i.test(text) && !/free bids/i.test(text));
  check(`Enterprise: dialog shows the 5-user estimate (${total})`, text.includes("5 licensed users") && text.includes(total.replace("/month", "")));
  await page.screenshot({ path: `${dir}/${tag}-01-enterprise-verify.png` });
  if (await dlg.count()) {
    await dlg.getByLabel(/email/i).first().fill("owner@summit-test.example");
    await dlg.getByRole("button", { name: /Email me a verification code/ }).click();
    await page.waitForTimeout(600);
    await dlg.locator("input[autocomplete='one-time-code']").fill("123456");
    await dlg.getByRole("button", { name: /Verify and continue/ }).click();
    await page.waitForURL(/plan=enterprise/, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const url = new URL(page.url());
    check("Enterprise: back on pricing with the plan and team size kept", url.pathname === "/pricing" && url.searchParams.get("users") === "5");
    const card2 = page.getByTestId("enterprise-plan");
    check("Enterprise: company step is open with a clear next action", (await card2.getByLabel("Company name").count()) === 1 && (await card2.getByRole("button", { name: /Continue to checkout/ }).count()) === 1);
    check("Enterprise: total still matches the estimate", (await card2.getByTestId("enterprise-total").innerText()) === total);
    await page.screenshot({ path: `${dir}/${tag}-02-enterprise-resumed.png` });
  }
  await ctx.close();
}
// Phone: the Enterprise verification dialog fits.
{
  const { ctx, page } = await open("/pricing#enterprise", { signedIn: false, vp: PHONE });
  await page.getByTestId("enterprise-plan").getByRole("button", { name: /Get Started with Team/ }).click();
  await page.waitForTimeout(1200);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - 390);
  check(`Enterprise phone 390: no sideways scroll (overflow ${overflow}px)`, overflow <= 0 && new URL(page.url()).pathname === "/pricing");
  await page.screenshot({ path: `${dir}/${tag}-03-enterprise-verify-phone.png` });
  await ctx.close();
}

// 2. Plain /login says nothing about a saved bid.
{
  const { ctx, page } = await open("/login", { signedIn: false });
  await page.waitForTimeout(600);
  const text = await page.getByRole("dialog").innerText().catch(() => "");
  check("/login: no 'your bid is saved' promise to someone without a bid", !/bid is saved/i.test(text));
  await page.screenshot({ path: `${dir}/${tag}-04-login.png` });
  await ctx.close();
}

// 3. Homepage sign-in promise matches the 6-digit code flow.
{
  const { ctx, page } = await open("/", { signedIn: false });
  const html = await page.content();
  check("homepage: no 'one-time email link' claim", !html.includes("one-time email link"));
  check("homepage: no 'No sign-up until you download' claim", !html.includes("No sign-up until you download"));
  await ctx.close();
}

// 4. Enterprise estimator: billing + nav.
await scenario("enterprise_estimator");
{
  const { ctx, page } = await open("/settings/billing");
  const main = await page.locator("main").innerText();
  check("estimator billing: not shown as a personal $19.99 Unlimited plan", !main.includes("$19.99/month, billed monthly"));
  check("estimator billing: says the seat is the company's Team plan", /Team plan/.test(main) && /Summit Exteriors/.test(main));
  await page.screenshot({ path: `${dir}/${tag}-05-estimator-billing.png`, fullPage: true });
  const nav = page.getByRole("navigation", { name: "Account" });
  check("estimator nav: My bids", (await nav.getByRole("link", { name: "My bids", exact: true }).count()) === 1);
  check("estimator nav: company list is 'My company bids' (no team access)", (await nav.getByRole("link", { name: "My company bids" }).count()) === 1);
  await ctx.close();
}
await scenario("enterprise_owner");
{
  const { ctx, page } = await open("/settings/billing");
  const nav = page.getByRole("navigation", { name: "Account" });
  check("owner nav: Team bids", (await nav.getByRole("link", { name: "Team bids" }).count()) === 1);
  check("owner nav: My subscription (personal) vs Billing & Licenses (company)", (await nav.getByRole("link", { name: "My subscription" }).count()) === 1);
  check("owner billing: one link to Billing & Licenses", (await page.getByTestId("company-billing-pointer").getByRole("link", { name: /Billing & Licenses/ }).count()) === 1);
  await page.screenshot({ path: `${dir}/${tag}-06-owner-billing.png`, fullPage: true });
  await ctx.close();
}
{
  const { ctx, page } = await open("/company/pipeline");
  check("owner Team bids page heading", (await page.getByRole("heading", { level: 1, name: "Team bids" }).count()) === 1);
  await page.screenshot({ path: `${dir}/${tag}-07-team-bids.png` });
  await ctx.close();
}
await scenario("unlimited");
{
  const { ctx, page } = await open("/dashboard", { vp: PHONE });
  await page.getByRole("button", { name: /Menu/ }).click().catch(() => {});
  await page.waitForTimeout(300);
  const nav = page.getByRole("navigation", { name: "Account" });
  check("solo account keeps the plain 'Bids' label", (await nav.getByRole("link", { name: "Bids", exact: true }).count()) === 1);
  await ctx.close();
}

await browser.close();
check("no page errors", errors.length === 0);
if (errors.length) out.push(...errors.map((e) => `  ${e}`));
console.log(out.join("\n"));
fs.writeFileSync(`${dir}/results-${tag}.txt`, out.join("\n") + "\n");
