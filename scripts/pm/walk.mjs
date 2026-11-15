// Browser walk for Phase 5 PM add-on billing UI (flag on). Local build against the mock Supabase,
// test data only (NOT production). Stripe isn't reachable with the dummy key, so purchase previews
// are covered by tests/pm-billing.test.ts; this checks the cards, states and editor assignment.
//   NEXT_PUBLIC_PROJECT_SCHEDULING=on STRIPE_PRICE_PM_ADDON=price_pm_m STRIPE_PRICE_PM_EDITOR=price_pm_ed npm run build && next start
//   node scripts/ux-audit/mock-supabase.mjs &
//   node scripts/pm/walk.mjs <screenshotDir>
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const dir = process.argv[2] ?? "pm-shots";
fs.mkdirSync(dir, { recursive: true });
const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };
const out = []; const check = (n, c) => out.push(`${c ? "✓" : "✗"} ${n}`);
const M = "http://localhost:54321", A = "http://localhost:3000";
const pmState = (o) => fetch(`${M}/__pm?state=${encodeURIComponent(JSON.stringify({ scope: "none", companyId: null, editorLimit: 0, editorsAssigned: 0, canEdit: false, source: null, editUntil: null, addon: false, addonUntil: null, extraEditors: 0, ...o }))}`);
await fetch(`${M}/__onboarding?status=completed`);
await fetch(`${M}/__features?created=${encodeURIComponent(new Date().toISOString())}`);
const browser = await chromium.launch();
const errors = [];
async function open(path, vp = { width: 1280, height: 1000 }) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 });
  await ctx.addCookies([authCookie]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${A}${path}`, { waitUntil: "load" });
  await page.waitForTimeout(2200);
  // The one-time "new features" popup may open for a newly paid scenario; close it.
  if (await page.getByTestId("unlocked-modal").count()) { await page.getByRole("button", { name: "Maybe Later" }).click(); await page.waitForTimeout(300); }
  return { ctx, page };
}

// Free account: no add-on card.
await fetch(`${M}/__scenario?name=starter`); await pmState({});
{ const { ctx, page } = await open("/settings/billing");
  check("free: no scheduling add-on card", (await page.getByTestId("pm-addon").count()) === 0);
  await ctx.close(); }

// Unlimited monthly, no add-on.
await fetch(`${M}/__scenario?name=unlimited`); await pmState({});
{ const { ctx, page } = await open("/settings/billing");
  const card = page.getByTestId("pm-addon");
  check("unlimited: add-on card offers $4.99/month with one editor", (await card.textContent()).includes("$4.99/month") && await card.getByRole("button", { name: "Add project scheduling" }).isVisible());
  await page.screenshot({ path: `${dir}/addon-offer-desktop.png`, fullPage: true });
  await card.getByRole("button", { name: "Add project scheduling" }).click();
  await card.getByRole("alert").waitFor({ timeout: 10000 });
  check("unlimited: if Stripe can't be reached, nothing is charged and it says so", (await card.getByRole("alert").textContent()).includes("Nothing was charged"));
  await ctx.close(); }

// Add-on active -> remove flow explains period-end access.
await pmState({ scope: "individual", canEdit: true, editorLimit: 1, editorsAssigned: 1, source: "subscription", addon: true });
{ const { ctx, page } = await open("/settings/billing");
  const card = page.getByTestId("pm-addon");
  check("active: badge and next charge shown", (await card.textContent()).includes("active") && (await card.textContent()).includes("Next charge"));
  await card.getByRole("button", { name: "Remove add-on" }).click();
  const rm = page.getByTestId("pm-remove");
  const t = await rm.textContent();
  check("remove: explains no refund, editing until period end, schedules kept view-only", t.includes("no refund") && t.includes("keep editing") && t.includes("Nothing is deleted"));
  await page.screenshot({ path: `${dir}/addon-remove-desktop.png`, fullPage: true });
  await ctx.close(); }

// Removed, still inside the paid period.
await pmState({ scope: "individual", canEdit: true, editorLimit: 1, source: "subscription", addon: false, addonUntil: new Date(Date.now() + 9 * 864e5).toISOString() });
{ const { ctx, page } = await open("/settings/billing");
  const card = page.getByTestId("pm-addon");
  check("ending: shows when editing ends and offers turning it back on", (await card.textContent()).includes("Editing stays on until") && await card.getByRole("button", { name: "Turn it back on" }).isVisible());
  await ctx.close(); }

// Enterprise owner: editors card, assignment, limit.
await fetch(`${M}/__scenario?name=enterprise_owner`); await pmState({ scope: "company", companyId: "55555555-5555-4555-8555-000000000001", editorLimit: 1, editorsAssigned: 0, source: "stripe" });
{ const { ctx, page } = await open("/company/billing");
  const card = page.getByTestId("pm-editors");
  await card.waitFor({ timeout: 8000 });
  check("enterprise: 1 included editor, separate from licensed users", (await card.textContent()).includes("1 schedule editor is included") && (await card.textContent()).includes("don't change your licensed users"));
  check("enterprise: starts with 0 of 1 assigned", (await page.getByTestId("pm-editor-summary").textContent()).startsWith("0 of 1"));
  await card.getByRole("button", { name: /^Make .* a schedule editor$/ }).first().click();
  await page.waitForTimeout(1200);
  check("enterprise: assigning uses the included seat", (await page.getByTestId("pm-editor-summary").textContent()).startsWith("1 of 1"));
  const makeBtns = card.getByRole("button", { name: /^Make .* a schedule editor$/ });
  check("enterprise: other members can't be made editors when seats are full", (await makeBtns.count()) > 0 && await makeBtns.first().isDisabled());
  check("enterprise: billing admin can buy extra editor seats", await card.getByRole("button", { name: "Preview change" }).isVisible());
  await page.screenshot({ path: `${dir}/enterprise-editors-desktop.png`, fullPage: true });
  await ctx.close(); }
{ const { ctx, page } = await open("/company/billing", { width: 390, height: 844 });
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  check(`enterprise m390: no horizontal scroll (${sw})`, sw <= 390);
  await page.getByTestId("pm-editors").screenshot({ path: `${dir}/enterprise-editors-m390.png` });
  await ctx.close(); }

// Complimentary Enterprise: no purchase controls.
await fetch(`${M}/__scenario?name=enterprise_comp`); await pmState({ scope: "company", editorLimit: 1, editorsAssigned: 1, source: "complimentary" });
{ const { ctx, page } = await open("/company/billing");
  const card = page.getByTestId("pm-editors");
  check("complimentary enterprise: no charge controls", (await card.getByRole("button", { name: "Preview change" }).count()) === 0);
  await ctx.close(); }

check("no page errors", errors.length === 0);
if (errors.length) console.log(errors);
await browser.close();
console.log(out.join("\n"));
const failed = out.filter((l) => l.startsWith("✗")).length;
console.log(`\n${out.length - failed}/${out.length} checks passed`);
process.exit(failed ? 1 : 0);
