// Enterprise browser walk. Needs `next start` on :3000 built against scripts/ux-audit/mock-supabase.mjs, with
// SUPABASE_SECRET_KEY=mock and dummy STRIPE_SECRET_KEY=sk_test_* + STRIPE_PRICE_* (Enterprise ones included). Stripe is never contacted.
// Usage: node scripts/enterprise/<file> <screenshotDir>
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };
await import("node:fs").then((fs) => fs.mkdirSync(process.argv[2] ?? "enterprise-shots", { recursive: true }));
const out = [];
const check = (n, c) => { out.push(`${c ? "✓" : "✗"} ${n}`); };
const browser = await chromium.launch();
for (const [label, vp, signed] of [["desktop", { width: 1280, height: 900 }, false], ["m390", { width: 390, height: 844 }, true], ["m320", { width: 320, height: 700 }, true]]) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 });
  if (signed) await ctx.addCookies([authCookie]);
  let sent = null;
  await ctx.route("**/api/stripe/enterprise-checkout", async (r) => { sent = JSON.parse(r.request().postData()); r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ url: "https://checkout.stripe.test/x", plan: "enterprise" }) }); });
  await ctx.route("https://checkout.stripe.test/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<h1 id=stripe>Mock Stripe</h1>" }));
  const page = await ctx.newPage();
  await page.goto("http://localhost:3000/pricing#enterprise");
  const ent = page.getByTestId("enterprise-plan");
  await ent.scrollIntoViewIfNeeded();
  check(`${label}: total for 3 users is $49.99`, (await page.getByTestId("enterprise-total").textContent()).includes("$49.99"));
  const input = ent.locator('input[type="number"]');
  await input.fill("200");
  check(`${label}: 200 users = $3,218.02`, (await page.getByTestId("enterprise-total").textContent()).includes("$3,218.02"));
  await input.fill("5");
  check(`${label}: 5 users = $89.97`, (await page.getByTestId("enterprise-total").textContent()).includes("$89.97"));
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  check(`${label}: no horizontal scroll (${sw} <= ${vp.width})`, sw <= vp.width);
  await ent.screenshot({ path: `${process.argv[2] ?? "enterprise-shots"}/enterprise-card-${label}.png` });
  if (!signed) {
    await ent.getByRole("button", { name: "Get Started with Enterprise" }).click();
    await page.waitForURL(/login/);
    check(`${label}: signed-out goes to sign in and returns to Enterprise`, decodeURIComponent(page.url()).includes("/pricing?plan=enterprise"));
  } else {
    await ent.getByRole("button", { name: "Get Started with Enterprise" }).click();
    await ent.getByRole("button", { name: /Continue to checkout/ }).click();
    check(`${label}: company name required`, (await ent.getByRole("alert").textContent()).includes("company name"));
    await ent.getByLabel("Company name").fill("Summit Exteriors");
    await ent.screenshot({ path: `${process.argv[2] ?? "enterprise-shots"}/enterprise-form-${label}.png` });
    await ent.getByRole("button", { name: /Continue to checkout/ }).click();
    await page.waitForSelector("#stripe");
    check(`${label}: checkout sends company + users`, sent?.companyName === "Summit Exteriors" && sent?.users === 5);
  }
  if (label === "desktop") { await page.goto("http://localhost:3000/pricing"); await page.screenshot({ path: `${process.argv[2] ?? "enterprise-shots"}/pricing-full-desktop.png`, fullPage: true }); }
  await ctx.close();
}
await browser.close();
console.log(out.join("\n"));
