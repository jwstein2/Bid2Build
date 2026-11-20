// V8.3 worker hub browser walk against the REAL SQL on a throwaway local database (TEST DATA ONLY):
//   scripts/test-db.sh start
//   export RADAR_PG_URL=$(node scripts/worker-hub/setup-db.mjs)
//   PG_REST_AS_USER=00000000-0000-4000-8000-000000000001 PG_REST_PREFIXES=pm_,price_import,project_schedules,saved_items,schedule_ \
//     node scripts/ux-audit/mock-supabase.mjs &
//   export NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=x SUPABASE_SECRET_KEY=x NEXT_PUBLIC_PROJECT_SCHEDULING=on
//   npm run build && npx next start -p 3000 &
//   node scripts/worker-hub/walk.mjs <screenshotDir>
// Covers: classification on the employee record, internal shifts next to project assignments, labor report (job
// cost vs overhead), projected pay off for workers by default with NO amounts from the API, turning it on, the
// worker's "My work" dashboard (duty state, week, breakdown, assignment detail, pay card + disclaimer), clocking in
// for shop time without a project, phone widths, no sideways scroll, no page errors.
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const dir = process.argv[2] ?? "worker-hub-shots";
fs.mkdirSync(dir, { recursive: true });
const ME = "00000000-0000-4000-8000-000000000001", CREW = "00000000-0000-4000-8000-0000000000c2";
const b64u = (s) => Buffer.from(s).toString("base64url");
const cookieFor = (id, email) => {
  const user = { id, aud: "authenticated", role: "authenticated", email, email_confirmed_at: new Date().toISOString() };
  const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
  const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user };
  return { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };
};
const out = []; const check = (n, c) => { out.push(`${c ? "✓" : "✗"} ${n}`); console.log(`${c ? "✓" : "✗"} ${n}`); };
const M = "http://localhost:54321", A = "http://localhost:3000";
const as = (u) => fetch(`${M}/__as?user=${u}`);
await fetch(`${M}/__onboarding?status=completed`);
await fetch(`${M}/__features?created=${encodeURIComponent(new Date().toISOString())}`);
await fetch(`${M}/__scenario?name=unlimited`);
const browser = await chromium.launch();
const errors = [];
async function open(path, who, vp = { width: 1440, height: 1000 }) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, acceptDownloads: true });
  await ctx.addCookies([who === CREW ? cookieFor(CREW, "cris@summit.test") : cookieFor(ME, "ux-test@built2bid.test")]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${path}: ${e.message}`));
  await page.goto(`${A}${path}`, { waitUntil: "load" });
  const later = page.getByRole("button", { name: "Maybe Later" });
  try { await later.waitFor({ timeout: 3500 }); await later.click(); } catch { /* none */ }
  await page.waitForTimeout(300);
  return { ctx, page };
}
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const shot = (page, name) => page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
const tab = async (page, key, testid) => {
  for (let i = 0; i < 10 && !(await page.getByTestId(testid).isVisible().catch(() => false)); i++) { await page.getByTestId(`gps-tab-${key}`).click(); await page.waitForTimeout(600); }
  await page.getByTestId(testid).waitFor();
};
let crisId = null;

// 1. Owner: classification, schedules, labor report, projected pay (off for workers).
await as(ME);
{
  const { ctx, page } = await open("/projects/workforce/time-tracking?tab=employees", ME);
  await page.getByTestId("gps-admin").waitFor();
  await page.getByTestId("gps-employees").waitFor();
  const sel = page.locator('[data-testid^="hub-class-"]');
  check("Employees tab shows the classification on the one employee record", (await sel.count()) >= 2);
  const row = page.locator("tr", { hasText: "Jose Martinez" });
  await row.locator('[data-testid^="hub-class-"]').selectOption("1099");
  await page.getByText(/Jose Martinez saved as 1099 contractor/).waitFor({ timeout: 10_000 });
  check("marking Jose as 1099 saves and says GPS is off for non-W-2", true);
  check("Jose's GPS switch is now disabled", await row.locator('[data-testid^="gps-enroll-"]').isDisabled());
  crisId = (await page.locator("tr", { hasText: "Cris Carpenter" }).locator('[data-testid^="hub-class-"]').getAttribute("data-testid")).replace("hub-class-", "");
  await shot(page, "01-admin-classification");

  await tab(page, "schedules", "hub-schedules");
  await page.getByTestId("hub-sched-person").selectOption({ label: "Cris Carpenter" });
  await page.waitForTimeout(1200);
  check("project assignment from the deck schedule appears in Cris's week", /Backyard deck/.test(await page.getByTestId("hub-sched-week").textContent()));
  await page.getByTestId("hub-shift-new").click();
  const days = page.locator('[data-testid^="hub-shift-day-"]');
  const sat = await days.nth(5).getAttribute("data-testid");
  await days.nth(5).click();
  await page.getByTestId("hub-shift-start").fill("08:00");
  await page.getByTestId("hub-shift-end").fill("12:00");
  await page.getByTestId("hub-shift-category").selectOption("training");
  await page.getByTestId("hub-shift-save").click();
  await page.getByText("Shift added.").waitFor({ timeout: 10_000 });
  await page.waitForTimeout(800);
  check(`a training shift (no project needed) is added on ${sat.replace("hub-shift-day-", "")}`, /Training/.test(await page.getByTestId("hub-sched-week").textContent()));
  await shot(page, "02-admin-schedules");

  await tab(page, "report", "hub-report");
  await page.getByTestId("hub-report-jobs").waitFor();
  await page.waitForTimeout(1200);
  const jobs = await page.getByTestId("hub-report-jobs").textContent(), oh = await page.getByTestId("hub-report-overhead").textContent();
  check("labor report lists the deck job with scheduled and actual hours", /Backyard deck/.test(jobs));
  check("labor report shows paid shop time as overhead, not a job", /Shop/.test(oh));
  check("owner sees labor cost (employer cost rate), not pay rates", /\$/.test(jobs) && !/28\.00/.test(jobs));
  await shot(page, "03-admin-labor-report");

  await tab(page, "pay", "hub-pay");
  await page.getByTestId("hub-pay-settings").waitFor();
  check("projected pay starts off", !(await page.getByTestId("hub-pay-enabled").isChecked()));
  check("show-to-workers starts off", !(await page.getByTestId("hub-pay-workers").isChecked()));
  check("the disclaimer is on the admin page", /not a guaranteed paycheck/.test(await page.getByTestId("hub-pay").textContent()));
  const crisRow = page.getByTestId(`hub-pay-row-${crisId}`);
  check("admin can still see Cris's scheduled projection while it's off for workers", /\$/.test(await crisRow.textContent()));
  check("final pay says it only comes from payroll", /payroll/i.test(await crisRow.textContent()));
  await shot(page, "04-admin-pay-off");
  await ctx.close();
}

// 2. Worker with projection hidden: no amounts from the API, no pay card.
await as(CREW);
{
  const { ctx, page } = await open("/clock", CREW, { width: 390, height: 844 });
  await page.getByTestId("worker-home").waitFor();
  const r = await page.request.get(`${A}/api/workforce/hub/pay?resourceId=${crisId}`);
  const body = await r.text();
  check(`pay API for the worker returns no amounts while hidden (${body.slice(0, 40)})`, r.ok() && /"available":false/.test(body) && !/gross|payRate|28/.test(body));
  check("no pay card on My work while hidden", (await page.getByTestId("pay-card").count()) === 0);
  check("duty state says off duty", /off/i.test(await page.getByTestId("duty-state").textContent()));
  check("week stats show scheduled and actual hours", /Scheduled/i.test(await page.getByTestId("week-stats").textContent()));
  check("week calendar includes the deck assignment and the training shift", /Backyard deck/.test(await page.getByTestId("week-calendar").textContent()) && /Training/.test(await page.getByTestId("week-calendar").textContent()));
  check("hours breakdown by project and internal work", /Backyard deck/.test(await page.getByTestId("hours-breakdown").textContent()));
  await shot(page, "05-phone-my-work-pay-hidden");
  await page.getByTestId("cal-item").filter({ hasText: "Backyard deck" }).first().click();
  await page.getByTestId("assignment-detail").waitFor();
  const det = await page.getByTestId("assignment-detail").textContent();
  check("assignment detail shows location, schedule and responsibilities", /Bryant/.test(det) && /7:00 AM/.test(det) && /post-hole auger/.test(det));
  await page.screenshot({ path: `${dir}/06-phone-assignment-detail.png` });
  await page.keyboard.press("Escape");
  check("phone: no sideways scroll", await noHScroll(page));
  await ctx.close();
}

// 3. Owner turns projection on and shows it to workers.
await as(ME);
{
  const { ctx, page } = await open("/projects/workforce/time-tracking?tab=pay", ME);
  await page.getByTestId("hub-pay-settings").waitFor();
  await page.getByTestId("hub-pay-enabled").click();
  await page.getByTestId("hub-pay-workers").click();
  await page.getByTestId("hub-pay-save").click();
  await page.getByText("Projected pay settings saved.").waitFor({ timeout: 10_000 });
  await page.waitForTimeout(800);
  check("Cris now marked visible to them", /Visible to them/.test(await page.getByTestId(`hub-pay-row-${crisId}`).textContent()));
  await shot(page, "07-admin-pay-on");
  await ctx.close();
}

// 4. Worker sees three distinct numbers + disclaimer; clocks in for shop time without a project.
await as(CREW);
{
  const { ctx, page } = await open("/clock", CREW, { width: 390, height: 844 });
  await page.getByTestId("pay-card").waitFor();
  const card = await page.getByTestId("pay-card").textContent();
  check("pay card shows scheduled projection and actual estimate", /\$/.test(card) && /Scheduled/i.test(card) && /Actual/i.test(card));
  check("final pay is shown as not available until payroll", /payroll/i.test(await page.getByTestId("pay-final").textContent()));
  check("disclaimer: Estimated gross pay — not a guaranteed paycheck", /Estimated gross pay — not a guaranteed paycheck/.test(await page.getByTestId("pay-disclaimer").textContent()));
  await page.getByTestId("pay-card").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${dir}/08-phone-pay-card.png` });
  const cat = page.getByTestId("clock-category");
  await cat.scrollIntoViewIfNeeded();
  await cat.selectOption("shop");
  await page.getByTestId("manual-punch").click();
  await page.waitForTimeout(2500);
  await page.reload({ waitUntil: "load" });
  await page.getByTestId("duty-state").waitFor();
  const duty = await page.getByTestId("duty-state").textContent();
  check(`clocked in for shop time with no project; duty state: "${duty.trim().slice(0, 60)}"`, /Shop/.test(duty) && !/customer project/i.test(duty));
  await shot(page, "09-phone-on-shop-time");
  check("phone: no sideways scroll", await noHScroll(page));
  await ctx.close();
  const d = await open("/clock", CREW);
  await d.page.getByTestId("worker-home").waitFor();
  await shot(d.page, "10-desktop-my-work");
  await d.ctx.close();
}

// 5. Owner phone width.
await as(ME);
{
  const { ctx, page } = await open("/projects/workforce/time-tracking?tab=report", ME, { width: 390, height: 844 });
  await page.getByTestId("hub-report").waitFor();
  await page.waitForTimeout(1000);
  check("admin labor report: no sideways scroll at 390", await noHScroll(page));
  await shot(page, "11-admin-report-phone");
  await ctx.close();
}

await browser.close();
check(`no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`, errors.length === 0);
fs.writeFileSync(`${dir}/results.txt`, out.join("\n") + "\n");
process.exit(out.some((l) => l.startsWith("✗")) ? 1 : 0);
