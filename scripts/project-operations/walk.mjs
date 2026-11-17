// Browser walk for V4.3 Project Operations + V4.4 Bid Style against the mock Supabase (test data only, NOT production).
//   build with NEXT_PUBLIC_PROJECT_SCHEDULING=on and NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321, `next start`,
//   node scripts/ux-audit/mock-supabase.mjs, then: node scripts/project-operations/walk.mjs <screenshotDir>
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const dir = process.argv[2] ?? "ops-shots";
fs.mkdirSync(dir, { recursive: true });
const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };
const out = []; const check = (n, c) => out.push(`${c ? "✓" : "✗"} ${n}`);
const M = "http://localhost:54321", A = "http://localhost:3000";
const EST = "11111111-1111-4111-8111-111111111111";
const G = (n) => `22222222-2222-4222-8222-00000000000${n}`;
const pm = (o = {}) => fetch(`${M}/__pm?state=${encodeURIComponent(JSON.stringify({ scope: "individual", companyId: null, editorLimit: 1, editorsAssigned: 1, canEdit: true, source: "subscription", editUntil: null, addon: true, addonUntil: null, extraEditors: 0, ...o }))}`);
await fetch(`${M}/__onboarding?status=completed`);
await fetch(`${M}/__features?created=${encodeURIComponent(new Date().toISOString())}`);
await fetch(`${M}/__scenario?name=unlimited`);
await fetch(`${M}/__sched?reset=1&stage=won`);
await fetch(`${M}/__team?reset=1&seed=1&manage=1`);
await fetch(`${M}/__ops?seed=1&styleManaged=1&allow=0&canOverride=1`);
await pm();
const browser = await chromium.launch();
const errors = [];
const DESK = { width: 1440, height: 1000 }, PHONE = { width: 390, height: 844 };
async function open(path, vp = DESK) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 });
  await ctx.addCookies([authCookie]);
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: A });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${path}: ${e.message}`));
  await page.goto(`${A}${path}`, { waitUntil: "load" });
  const later = page.getByRole("button", { name: "Maybe Later" });
  try { await later.waitFor({ timeout: 2500 }); await later.click(); } catch { /* none */ }
  await page.waitForTimeout(400);
  return { ctx, page };
}
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

// 1. Dashboard + Projects: Needs Review queue, notification bell
{
  const { ctx, page } = await open("/dashboard");
  check("dashboard shows the Needs Review queue", (await page.getByText("Needs PM Review").count()) > 0 || (await page.getByText(/Needs Review/i).count()) > 0);
  await page.screenshot({ path: `${dir}/01-dashboard-review-queue-desktop.png` });
  const bell = page.getByRole("button", { name: /Task review notices/ }).first();
  if (await bell.count()) { await bell.click(); await page.waitForTimeout(500); await page.screenshot({ path: `${dir}/02-task-review-notice-desktop.png` }); check("task review notice offers Confirm Complete", (await page.getByText("Confirm Complete").count()) > 0); }
  await ctx.close();
}
{
  const { ctx, page } = await open("/projects#review");
  await page.waitForTimeout(500);
  check("projects page lists newly approved jobs", (await page.getByText("Siding replacement – Johnson residence").count()) > 0);
  await page.screenshot({ path: `${dir}/03-projects-needs-review-desktop.png` });
  const open1 = page.getByRole("button", { name: /Review/ }).first();
  if (await open1.count()) { await open1.click(); await page.waitForTimeout(800); await page.screenshot({ path: `${dir}/04-review-drawer-desktop.png` }); }
  await ctx.close();
}
{
  const { ctx, page } = await open("/projects", PHONE);
  check("projects (phone): no horizontal scroll", await noHScroll(page));
  await page.screenshot({ path: `${dir}/05-projects-review-phone.png` });
  await ctx.close();
}

// 2. Create a schedule for the approved bid (draft), then Project Detail tabs
let sid = null;
{
  const { ctx, page } = await open("/dashboard");
  const r = await page.evaluate(async ([est, g1, g2]) => {
    const res = await fetch("/api/schedules", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      estimateId: est, calendar: { workdays: [1, 2, 3, 4, 5], holidays: [], timezone: "America/Chicago" }, startDate: new Date().toISOString().slice(0, 10),
      sections: [{ sourceGroupId: g1, durationDays: 2, sortOrder: 0 }, { sourceGroupId: g2, durationDays: 4, sortOrder: 1 }], deps: [{ from: g1, to: g2, lagDays: 0, maxOverlap: 0 }] }) });
    return { status: res.status, body: await res.json() };
  }, [EST, G(1), G(2)]);
  sid = r.body.id; check("draft schedule created (no stage change)", r.status === 201 && !!sid);
  await ctx.close();
}
if (sid) {
  const { ctx, page } = await open(`/projects/${sid}`);
  check("project detail has a Dashboard breadcrumb", (await page.getByTestId("breadcrumbs").count()) > 0);
  check("project detail tabs", (await page.getByTestId("project-tabs").getByRole("tab").count()) === 5);
  await page.screenshot({ path: `${dir}/06-project-schedule-tab-desktop.png` });
  await page.getByRole("tab", { name: "Trade scope" }).click();
  await page.getByTestId("scope-panel").waitFor();
  await page.getByTestId("scope-section").first().locator("button[aria-expanded]").click();
  await page.waitForTimeout(300);
  check("scope keeps internal notes separate (never shared)", (await page.getByText("Internal notes (never shared)").count()) > 0);
  await page.screenshot({ path: `${dir}/07-trade-scope-desktop.png`, fullPage: true });
  await page.getByTestId("scope-section").first().getByRole("button", { name: "Share", exact: true }).click();
  await page.getByTestId("share-drawer").waitFor();
  await page.getByTestId("share-drawer").getByRole("button", { name: "Preview" }).click();
  await page.getByTestId("share-preview").waitFor({ timeout: 5000 }).catch(() => {});
  check("share preview shows only chosen fields", (await page.getByTestId("share-preview").count()) === 1 && !(await page.getByTestId("share-preview").textContent()).includes("flower beds"));
  await page.screenshot({ path: `${dir}/08-subcontractor-share-preview-desktop.png` });
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Documents" }).click();
  await page.getByTestId("documents-panel").waitFor();
  check("contract summary on project", (await page.getByTestId("contract-summary").count()) === 1);
  check("history marks the re-signature", (await page.getByText(/Re-signed/i).count()) > 0);
  await page.screenshot({ path: `${dir}/09-documents-history-desktop.png`, fullPage: true });
  await page.getByRole("tab", { name: "Photos" }).click();
  await page.getByTestId("photos-panel").waitFor();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${dir}/10-photos-desktop.png`, fullPage: true });
  await page.getByRole("button", { name: /Open photo Front of house/ }).click();
  await page.getByTestId("photo-drawer").waitFor();
  check("AI suggestions shown as suggestions to review", (await page.getByText(/AI suggestions/).count()) > 0);
  await page.screenshot({ path: `${dir}/11-photo-drawer-desktop.png` });
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Internal costs" }).click();
  await page.getByTestId("costs-panel").waitFor();
  check("internal costs compares original vs sub bids", (await page.getByTestId("cost-line").count()) === 2);
  await page.screenshot({ path: `${dir}/12-internal-costs-desktop.png`, fullPage: true });
  await page.getByRole("button", { name: "Prepare Change Order" }).first().click();
  await page.waitForTimeout(800);
  check("Prepare Change Order opens a prefilled draft in Documents", (await page.getByRole("tab", { name: "Documents", selected: true }).count()) === 1);
  await page.screenshot({ path: `${dir}/13-prepared-change-order-desktop.png`, fullPage: true });
  await ctx.close();
  const p2 = await open(`/projects/${sid}?tab=photos`, PHONE);
  await p2.page.getByTestId("photos-panel").waitFor(); await p2.page.waitForTimeout(600);
  check("project photos (phone): no horizontal scroll", await noHScroll(p2.page));
  await p2.page.screenshot({ path: `${dir}/14-photos-phone.png`, fullPage: true });
  await p2.page.goto(`${A}/projects/${sid}?tab=scope`); await p2.page.getByTestId("scope-panel").waitFor(); await p2.page.waitForTimeout(400);
  await p2.page.screenshot({ path: `${dir}/15-trade-scope-phone.png`, fullPage: true });
  await p2.ctx.close();
}

// 3. Bid builder: sub quote indicator + panel, managed style notice, contract panel
{
  const { ctx, page } = await open(`/estimates/${EST}`);
  await page.waitForTimeout(1500);
  check("builder has the Dashboard home control", (await page.getByTestId("builder-home").count()) === 1);
  await page.screenshot({ path: `${dir}/16-builder-desktop.png` });
  await page.getByRole("button", { name: "Expand all" }).click().catch(() => {});
  await page.waitForTimeout(500);
  const badge = page.locator("[data-testid=sub-quote-badge]").first();
  check("line items show a sub quote indicator", (await badge.count()) > 0);
  if (await badge.count()) { await badge.scrollIntoViewIfNeeded(); await page.locator("tr", { has: badge }).getByRole("button", { name: "Show item details" }).first().click(); await page.waitForTimeout(800); await page.screenshot({ path: `${dir}/17-sub-quote-panel-desktop.png` }); }
  const prop = page.getByRole("button", { name: /^Proposal/ }).first();
  if (await prop.count()) { await prop.click(); await page.waitForTimeout(1000); }
  const panel = page.getByTestId("proposal-style-panel");
  if (await panel.count()) {
    await panel.scrollIntoViewIfNeeded();
    check("managed style notice in the bid editor", (await page.getByText("Your company manages proposal formatting. Contact your company administrator to request changes.").count()) > 0);
    check("Reset to Company Default offered", (await page.getByRole("button", { name: "Reset to Company Default" }).count()) > 0);
    await page.screenshot({ path: `${dir}/18-managed-style-proposal-step-desktop.png` });
  }
  await ctx.close();
}

// 4. Company Settings → Proposal & Bid Style (owner)
{
  await fetch(`${M}/__scenario?name=enterprise_owner`);
  const { ctx, page } = await open("/company/proposal-style");
  check("style settings page: customization toggle (off)", (await page.getByTestId("allow-customization").count()) === 1 && !(await page.getByTestId("allow-customization").isChecked()));
  await page.screenshot({ path: `${dir}/19-company-proposal-style-desktop.png`, fullPage: true });
  await ctx.close();
  const p2 = await open("/company/proposal-style", PHONE);
  check("style settings (phone): no horizontal scroll", await noHScroll(p2.page));
  await p2.page.screenshot({ path: `${dir}/20-company-proposal-style-phone.png` });
  await p2.ctx.close();
  await fetch(`${M}/__scenario?name=unlimited`);
}

// 5. Saved Items: frequent first + form flow; customers photo library
{
  await fetch(`${M}/__reset_library`);
  const { ctx, page } = await open("/dashboard/items");
  await page.getByRole("button", { name: "New Saved Item" }).click().catch(() => {});
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${dir}/21-saved-item-form-desktop.png`, fullPage: true });
  await ctx.close();
}
{
  const { ctx, page } = await open("/dashboard/customers");
  await page.getByRole("button", { name: "Photos" }).first().click();
  await page.getByTestId("photos-panel").waitFor().catch(() => {});
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${dir}/22-customer-photos-desktop.png`, fullPage: true });
  await ctx.close();
}

await browser.close();
console.log(out.join("\n"));
if (errors.length) console.log("page errors:\n" + errors.join("\n"));
