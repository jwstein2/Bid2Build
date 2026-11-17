// V6-15 subcontractor share disclosure walk against the mock Supabase (fictitious data only, never production).
//   same build/mock setup as scripts/project-operations/walk.mjs, then: node scripts/v6/share-disclosure-walk.mjs <dir>
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

let sid = null;
{
  const { ctx, page } = await open("/dashboard");
  const r = await page.evaluate(async ([est, g1, g2]) => {
    const res = await fetch("/api/schedules", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      estimateId: est, calendar: { workdays: [1, 2, 3, 4, 5], holidays: [], timezone: "America/Chicago" }, startDate: new Date().toISOString().slice(0, 10),
      sections: [{ sourceGroupId: g1, durationDays: 2, sortOrder: 0 }, { sourceGroupId: g2, durationDays: 4, sortOrder: 1 }], deps: [] }) });
    return { status: res.status, body: await res.json() };
  }, [EST, G(1), G(2)]);
  sid = r.body.id;
  await ctx.close();
}
for (const vp of [DESK, PHONE]) {
  const tag = vp === DESK ? "desk" : "phone";
  const { ctx, page } = await open(`/projects/${sid}`, vp);
  await page.getByRole("tab", { name: "Trade scope" }).click();
  await page.getByTestId("scope-panel").waitFor();
  await page.getByTestId("scope-section").nth(1).getByRole("button", { name: "Share", exact: true }).click();
  const d = page.getByTestId("share-drawer");
  await d.waitFor();
  check(`${tag}: customer name/phone/email start unchecked`, !(await d.getByLabel("Customer name").isChecked()) && !(await d.getByLabel("Customer phone").isChecked()) && !(await d.getByLabel("Customer email").isChecked()));
  check(`${tag}: job site address starts unchecked`, !(await d.getByLabel("Job site address").isChecked()));
  check(`${tag}: pricing defaults to No pricing`, await d.getByLabel(/No pricing/).isChecked());
  await d.getByRole("button", { name: "Preview" }).click();
  await page.getByTestId("share-preview").waitFor({ timeout: 5000 }).catch(() => {});
  let pv = await page.getByTestId("share-preview").innerText().catch(() => "");
  check(`${tag}: default preview has no customer or money`, pv.length > 0 && !/Pat Johnson|\$/.test(pv));
  await d.getByLabel("Customer name").check();
  await d.getByLabel(/Approved subcontractor amount/).check();
  await d.getByRole("button", { name: "Preview" }).click();
  await page.waitForTimeout(800);
  pv = await page.getByTestId("share-preview").innerText().catch(() => "");
  check(`${tag}: preview adds the customer name only (no email)`, pv.includes("Pat Johnson") && !pv.includes("pat@example.test"));
  check(`${tag}: approved amount is the accepted sub quote ($2,250.00)`, pv.includes("$2,250.00"));
  await d.getByLabel(/Proposed budget/).check();
  await d.getByRole("button", { name: "Preview" }).click();
  await page.waitForTimeout(800);
  pv = await page.getByTestId("share-preview").innerText().catch(() => "");
  check(`${tag}: proposed budget shown, no markup or customer price wording`, /Proposed budget/.test(pv) && !/markup|margin|profit/i.test(pv));
  check(`${tag}: no sideways scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await d.screenshot({ path: `${dir}/share-disclosure-${tag}.png` });
  await ctx.close();
}
await browser.close();
check("no page errors", errors.length === 0);
if (errors.length) out.push(...errors.map((e) => `  ${e}`));
console.log(out.join("\n"));
fs.writeFileSync(`${dir}/results-share-disclosure.txt`, out.join("\n") + "\n");
