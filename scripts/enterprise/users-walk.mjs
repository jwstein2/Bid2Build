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
const out = []; const check = (n, c) => out.push(`${c ? "✓" : "✗"} ${n}`);
const scenario = (n) => fetch(`http://localhost:54321/__scenario?name=${n}`);
const browser = await chromium.launch();
const dir = process.argv[2] ?? "enterprise-shots";
for (const [label, vp] of [["desktop", { width: 1280, height: 900 }], ["m390", { width: 390, height: 844 }], ["m320", { width: 320, height: 720 }]]) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 });
  await ctx.addCookies([authCookie]);
  const calls = [];
  await ctx.route("**/api/company/invitations", async (r) => {
    const b = JSON.parse(r.request().postData() ?? "{}"); calls.push({ method: r.request().method(), ...b });
    if (r.request().method() === "POST") return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ inviteUrl: "http://localhost:3000/company/join?token=abc123", expiresAt: new Date(Date.now() + 7 * 864e5).toISOString() }) });
    return r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
  });
  await ctx.route("**/api/company/members", async (r) => {
    const b = JSON.parse(r.request().postData()); calls.push(b);
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b.action === "recovery" ? { ok: true, sentTo: "c•••@summit.test" } : b.action === "team_create" ? { id: "t2" } : { ok: true }) });
  });
  const page = await ctx.newPage();
  await scenario("enterprise_owner");
  await page.goto("http://localhost:3000/company/users");
  const body = await page.textContent("body");
  check(`${label}: seat summary shows 4 of 5`, /4\s*of\s*5/.test(await page.getByTestId("seat-summary").textContent()));
  check(`${label}: roster lists 3 active + deactivated section`, (await page.getByTestId("member-row").count()) === 4 && body.includes("Deactivated (1)"));
  check(`${label}: pending invite listed`, body.includes("newhire@summit.test"));
  if (vp.width < 1024) await page.getByRole("button", { name: "Menu" }).click();
  check(`${label}: company nav shows Users & Permissions + Billing`, (await page.getByRole("link", { name: "Users & Permissions" }).first().isVisible()) && (await page.getByRole("link", { name: "Billing & Licenses" }).first().isVisible()));
  if (vp.width < 1024) await page.screenshot({ path: `${dir}/company-nav-${label}.png` });
  if (vp.width < 1024) await page.getByRole("button", { name: "Close" }).first().click();
  let sw = await page.evaluate(() => document.documentElement.scrollWidth);
  check(`${label}: no horizontal scroll (${sw})`, sw <= vp.width);
  await page.screenshot({ path: `${dir}/company-users-${label}.png`, fullPage: true });

  // Invite: link shown once, no seat purchase.
  await page.getByLabel("Email").first().fill("crew@summit.test");
  await page.getByRole("button", { name: "Create invitation" }).click();
  await page.getByTestId("invite-link").waitFor();
  check(`${label}: invite link shown`, (await page.getByTestId("invite-link").textContent()).includes("/company/join?token=abc123"));
  check(`${label}: invite sent email+role`, calls.at(-1)?.email === "crew@summit.test" && calls.at(-1)?.role === "estimator");

  await page.getByRole("button", { name: /Revoke/ }).click();
  await page.waitForTimeout(300);
  check(`${label}: revoke sends DELETE with id`, calls.at(-1)?.method === "DELETE" && calls.at(-1)?.id === "55555555-5555-4555-8555-0000000000b1");

  // Casey (estimator with a custom analytics grant): editor starts from real permissions.
  const casey = page.getByTestId("member-row").filter({ hasText: "Casey Estimator" });
  await casey.getByRole("button", { name: "Manage" }).click();
  check(`${label}: custom grant pre-checked`, await casey.getByLabel(/analytics/i).isChecked());
  await casey.getByLabel(/margin/i).check();
  await casey.getByRole("button", { name: "Save access" }).click();
  await page.waitForTimeout(300);
  const upd = calls.at(-1);
  check(`${label}: save keeps existing grant and adds new`, upd?.action === "update" && upd.granted.includes("view_analytics") && upd.granted.includes("view_margin") && upd.role === "estimator");
  await casey.getByRole("button", { name: "Deactivate…" }).click();
  check(`${label}: deactivate asks for confirmation`, await casey.getByRole("alertdialog").isVisible());
  sw = await page.evaluate(() => document.documentElement.scrollWidth);
  check(`${label}: no horizontal scroll with editor open (${sw})`, sw <= vp.width);
  await page.screenshot({ path: `${dir}/company-users-editor-${label}.png`, fullPage: true });
  await casey.getByRole("button", { name: "Yes, deactivate" }).click();
  await page.waitForTimeout(300);
  check(`${label}: deactivate sent`, calls.at(-1)?.action === "status" && calls.at(-1)?.status === "deactivated");

  const riley = page.getByTestId("member-row").filter({ hasText: "Riley Manager" });
  await riley.getByRole("button", { name: "Manage" }).click();
  await riley.getByRole("button", { name: "Send secure sign-in link" }).click();
  await riley.getByRole("status").waitFor();
  check(`${label}: recovery confirms masked address`, (await riley.getByRole("status").textContent()).includes("c•••@summit.test"));

  await page.getByLabel("New team").fill("Roofing");
  await page.getByRole("button", { name: "Create team" }).click();
  await page.waitForTimeout(300);
  check(`${label}: create team sent`, calls.at(-1)?.action === "team_create" && calls.at(-1)?.name === "Roofing");

  // Dashboard plan card names Enterprise (paid owner, complimentary owner).
  await page.goto("http://localhost:3000/dashboard");
  check(`${label}: dashboard plan says Enterprise`, (await page.getByTestId("plan-enterprise").textContent()).includes("Summit Exteriors LLC"));
  await scenario("enterprise_comp");
  await page.goto("http://localhost:3000/dashboard");
  const comp = await page.getByTestId("plan-enterprise").textContent();
  check(`${label}: comp dashboard says complimentary + Manage team`, comp.includes("complimentary") && comp.includes("Manage team & licenses"));
  if (label !== "desktop") await page.screenshot({ path: `${dir}/dashboard-enterprise-${label}.png` });

  // Estimator: no admin controls.
  await scenario("enterprise_estimator");
  await page.goto("http://localhost:3000/company/users");
  check(`${label}: estimator sees no invite form or Manage`, (await page.getByTestId("invite-form").count()) === 0 && (await page.getByRole("button", { name: "Manage" }).count()) === 0);

  // Join page (signed in, matching email) and signed out.
  await page.goto("http://localhost:3000/company/join?token=abc123");
  check(`${label}: join page shows company + accept`, (await page.getByRole("button", { name: /Accept and join Summit Exteriors/ }).count()) === 1);
  sw = await page.evaluate(() => document.documentElement.scrollWidth);
  check(`${label}: join no horizontal scroll (${sw})`, sw <= vp.width);
  await page.screenshot({ path: `${dir}/company-join-${label}.png`, fullPage: true });
  await ctx.clearCookies();
  await page.goto("http://localhost:3000/company/join?token=abc123");
  check(`${label}: signed-out join offers sign-in`, (await page.getByRole("link", { name: /Sign in or create your account/ }).count()) === 1);
  await ctx.close();
}
await browser.close();
console.log(out.join("\n"));
process.exit(out.some((l) => l.startsWith("✗")) ? 1 : 0);
