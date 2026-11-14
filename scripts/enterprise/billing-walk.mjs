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
import("node:fs").then((fs) => fs.mkdirSync(process.argv[2] ?? "enterprise-shots", { recursive: true }));
await import("node:fs").then((fs) => fs.mkdirSync(process.argv[2] ?? "enterprise-shots", { recursive: true }));
const out = []; const check = (n, c) => out.push(`${c ? "✓" : "✗"} ${n}`);
const scenario = (n) => fetch(`http://localhost:54321/__scenario?name=${n}`);
const browser = await chromium.launch();
for (const [label, vp] of [["desktop", { width: 1280, height: 900 }], ["m390", { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 });
  await ctx.addCookies([authCookie]);
  const calls = [];
  await ctx.route("**/api/company/seats", async (r) => {
    const b = JSON.parse(r.request().postData()); calls.push(b);
    if (b.action === "preview") return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ fromUsers: 5, toUsers: b.users, beforeCents: 8997, afterCents: 10796, deltaCents: 1799, dueNowCents: 900, creditCents: 0, prorationDate: 1700000000, currentPeriodEnd: null }) });
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, users: b.users }) });
  });
  const page = await ctx.newPage();
  await scenario("enterprise_owner");
  await page.goto("http://localhost:3000/company/billing");
  check(`${label}: owner sees licensed users 5`, (await page.getByTestId("licensed").textContent()) === "5");
  check(`${label}: monthly total $89.97`, (await page.textContent("body")).includes("$89.97"));
  await page.getByRole("button", { name: "Preview change" }).click();
  await page.getByTestId("seat-preview").waitFor();
  check(`${label}: preview shows due now`, (await page.getByTestId("due-now").textContent()) === "$9.00");
  check(`${label}: preview sent fromUsers=5 users=6`, calls[0]?.fromUsers === 5 && calls[0]?.users === 6);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  check(`${label}: no horizontal scroll (${sw})`, sw <= vp.width);
  await page.screenshot({ path: `${process.argv[2] ?? "enterprise-shots"}/company-billing-owner-${label}.png`, fullPage: true });
  await page.getByRole("button", { name: /Confirm and pay/ }).click();
  await page.getByRole("status").waitFor();
  check(`${label}: confirm uses previewed proration date`, calls[1]?.action === "confirm" && calls[1]?.prorationDate === 1700000000);
  const minus = page.getByRole("button", { name: "Fewer users" });
  // seatsUsed is 4 so it cannot go below 4
  await page.goto("http://localhost:3000/company/billing");
  await minus.click(); await minus.click();
  check(`${label}: can't go below seats in use`, (await page.locator('[data-testid=seat-changer] input').inputValue()) === "4" && await minus.isDisabled());
  await scenario("enterprise_estimator");
  await page.goto("http://localhost:3000/company/billing");
  check(`${label}: estimator can't manage billing`, (await page.textContent("body")).includes("managed by your company owner"));
  await scenario("enterprise_comp");
  await page.goto("http://localhost:3000/company/billing");
  const body = await page.textContent("body");
  check(`${label}: comp company has no seat purchase and no charges`, body.includes("complimentary") && !(await page.getByTestId("seat-changer").count()));
  await page.screenshot({ path: `${process.argv[2] ?? "enterprise-shots"}/company-billing-comp-${label}.png`, fullPage: true });
  await scenario("enterprise_past_due");
  await page.goto("http://localhost:3000/company/billing");
  check(`${label}: past due banner, no seat changes`, (await page.textContent("body")).includes("Payment failed") && !(await page.getByTestId("seat-changer").count()));
  await scenario("enterprise_owner");
  await page.goto("http://localhost:3000/pricing#enterprise");
  check(`${label}: pricing page shows Manage Enterprise for owner`, await page.getByRole("link", { name: "Manage Enterprise" }).isVisible());
  await ctx.close();
}
await scenario("starter");
await browser.close();
console.log(out.join("\n"));
