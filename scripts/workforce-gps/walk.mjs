// GPS time tracking browser walk against the REAL V8.2 SQL on a throwaway local database (TEST DATA ONLY):
//   scripts/test-db.sh start
//   export RADAR_PG_URL=$(node scripts/workforce-gps/setup-db.mjs)
//   PG_REST_AS_USER=00000000-0000-4000-8000-000000000001 PG_REST_PREFIXES=pm_,price_import,project_schedules,saved_items,schedule_ \
//     node scripts/ux-audit/mock-supabase.mjs &
//   export NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=x SUPABASE_SECRET_KEY=x NEXT_PUBLIC_PROJECT_SCHEDULING=on
//   npm run build && npx next start -p 3000 &
//   node scripts/workforce-gps/walk.mjs <screenshotDir>
// Simulated GPS (Chromium geolocation override). Real waits: 1-minute dwell, 2-minute exit grace (about 4 minutes).
// Covers: off by default + setup checklist, business location from the Company profile (Census lookup + current
// location), jobsite from a project, radius guidance, disclosure + switch on, W-2 confirmation + enrollment
// (subcontractor excluded), employee notice, automatic clock-in after the dwell, leaving -> "Did you stop working?",
// payroll week + CSV, project labor (estimated vs actual), phone widths, no sideways scroll.
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const dir = process.argv[2] ?? "workforce-gps-shots";
fs.mkdirSync(dir, { recursive: true });
const ME = "00000000-0000-4000-8000-000000000001", CREW = "00000000-0000-4000-8000-0000000000c2";
const user = { id: ME, aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };
const out = []; const check = (n, c) => { out.push(`${c ? "✓" : "✗"} ${n}`); console.log(`${c ? "✓" : "✗"} ${n}`); };
const M = "http://localhost:54321", A = "http://localhost:3000";
const as = (u) => fetch(`${M}/__as?user=${u}`);
const HQ = { latitude: 44.97776, longitude: -93.26501, accuracy: 15 };
const DECK = { lat: "44.92990", lng: "-93.29080" };
await fetch(`${M}/__onboarding?status=completed`);
await fetch(`${M}/__features?created=${encodeURIComponent(new Date().toISOString())}`);
await fetch(`${M}/__scenario?name=unlimited`);
await as(ME);
const browser = await chromium.launch();
const errors = [];
async function open(path, vp = { width: 1440, height: 1000 }, geo = HQ) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, acceptDownloads: true, geolocation: geo, permissions: ["geolocation", "notifications"] });
  await ctx.addCookies([authCookie]);
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
const toast = (page, re) => page.getByText(re).first().waitFor({ timeout: 10_000 });

// 1. Owner: off by default, setup checklist, then locations.
{
  const { ctx, page } = await open("/projects/workforce/time-tracking");
  await page.getByTestId("gps-admin").waitFor();
  check("switch starts off and Turn on is disabled until setup is done", await page.getByTestId("gps-on").isDisabled());
  check("limits section explains foreground / minimized / closed", /closed/i.test(await page.getByTestId("gps-limits").textContent()));
  await shot(page, "01-admin-off-checklist");

  for (let i = 0; i < 10 && !(await page.getByTestId("gps-add-business").isVisible()); i++) { await page.getByTestId("gps-tab-locations").click(); await page.waitForTimeout(500); }
  await page.getByTestId("gps-add-business").click();
  const ed = page.getByTestId("gps-location-editor");
  check("business address prefilled from the Company profile", (await ed.locator("input").nth(1).inputValue()).includes("250 Marquette"));
  await ed.getByRole("button", { name: "Find the address" }).click();
  await page.waitForTimeout(4000);
  const censusOk = (await ed.locator("ul li button").count()) > 0;
  check(`free Census address lookup ${censusOk ? "returned a match" : "(no match / unreachable here; fallback to current location)"}`, true);
  if (censusOk) await ed.locator("ul li button").first().click();
  await ed.getByRole("button", { name: "Use my current location" }).click();
  await page.waitForTimeout(800);
  check("current location fills the pin", (await ed.locator("input[inputmode=decimal]").first().inputValue()).startsWith("44.97"));
  await ed.getByRole("radio").nth(3).check();
  await ed.getByLabel("Custom radius in metres").fill("40");
  check("small radius shows an accuracy warning", /accura|GPS/i.test(await page.getByTestId("gps-radius-guidance").textContent()));
  await shot(page, "02-location-editor-small-radius");
  await ed.getByRole("radio").first().check();
  await page.getByTestId("gps-confirm-pin").check();
  await page.getByTestId("gps-save-location").click();
  await page.getByTestId("gps-location").first().waitFor();
  check("business location saved and Ready", /Ready/.test(await page.getByTestId("gps-location").first().textContent()));

  const deckId = await page.getByTestId("gps-add-project").locator("option").filter({ hasText: "Backyard deck" }).getAttribute("value");
  await page.getByTestId("gps-add-project").selectOption(deckId);
  const ed2 = page.getByTestId("gps-location-editor");
  check("jobsite address comes from the project", (await ed2.locator("input").nth(1).inputValue()).includes("Bryant Ave"));
  await ed2.getByLabel("Latitude").fill(DECK.lat);
  await ed2.getByLabel("Longitude").fill(DECK.lng);
  await ed2.getByRole("radio").nth(1).check();
  await page.getByTestId("gps-confirm-pin").check();
  await page.getByTestId("gps-save-location").click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="gps-location"]').length === 2);
  check("two locations ready", (await page.getByTestId("gps-location").filter({ hasText: "Ready" }).count()) === 2);
  await shot(page, "03-locations");

  // 2. Disclosure + settings, then switch on.
  await page.getByTestId("gps-tab-settings").click();
  await page.getByTestId("gps-ack").check();
  await page.getByTestId("gps-save-settings").click();
  await page.waitForTimeout(1200);
  await shot(page, "04-settings-disclosure");
  await page.getByTestId("gps-tab-overview").click();
  await page.getByTestId("gps-on").click();
  await page.getByTestId("gps-off").waitFor();
  check("switched on after a confirmed location + disclosure", true);

  // 3. Employees: W-2 confirm + enroll Cris; subcontractor not eligible.
  await page.getByTestId("gps-tab-employees").click();
  const tbl = page.getByTestId("gps-employees");
  check("subcontractor listed as not eligible", /Subcontractor: not eligible/.test(await tbl.textContent()));
  const crisRow = tbl.locator("tr").filter({ hasText: "Cris Carpenter" });
  check("GPS checkbox disabled until W-2 is confirmed", await crisRow.locator("input[type=checkbox]").nth(1).isDisabled());
  await crisRow.getByLabel("Cris Carpenter is a W-2 employee whose hours we track").click();
  await toast(page, /confirmed as a W-2 employee/);
  await crisRow.locator("input[type=checkbox]").nth(1).click();
  await toast(page, /GPS time tracking turned on for Cris/);
  check("Jose (no login) can't be enrolled", await tbl.locator("tr").filter({ hasText: "Jose Martinez" }).locator("input[type=checkbox]").nth(1).isDisabled());
  await shot(page, "05-employees-w2");
  await ctx.close();
}

// 4. Crew phone: notice, automatic clock-in after the dwell, leave -> asked, clock out.
await as(CREW);
{
  const { ctx, page } = await open("/clock", { width: 390, height: 844 });
  await page.getByTestId("employee-clock").waitFor();
  await page.getByTestId("gps-consent").waitFor();
  check("employee sees the notice before anything is recorded", /location/i.test(await page.getByTestId("gps-consent").textContent()));
  await shot(page, "06-phone-notice");
  await page.getByTestId("gps-agree").click();
  await page.getByTestId("gps-card").waitFor();
  const start = page.getByTestId("gps-start");
  if (await start.count()) await start.click();
  await page.getByTestId("gps-live").waitFor({ timeout: 15_000 });
  await page.waitForTimeout(1500);
  check("arrival detected (At Main office / shop)", /Main office/.test(await page.getByTestId("gps-live").textContent()));
  check("phone screen says to keep Built2Bid open", /open/i.test(await page.getByTestId("gps-card").textContent()));
  await shot(page, "07-phone-arrived-waiting-dwell");
  console.log("waiting for the 1-minute dwell…");
  await page.waitForTimeout(65_000);
  await ctx.setGeolocation({ ...HQ, latitude: HQ.latitude + 0.00005 });
  await page.getByTestId("clock-banner").waitFor({ timeout: 70_000 });
  const banner = await page.getByTestId("clock-banner").textContent();
  check(`automatic clock-in banner: "${banner.trim()}"`, /Clocked in — Main office/.test(banner));
  check("status shows on the clock", /Clocked in|On the clock/i.test(await page.getByTestId("clock-state").textContent()));
  await shot(page, "08-phone-clocked-in");
  // Leave: far away, then wait out the 2-minute grace.
  await ctx.setGeolocation({ latitude: 44.90, longitude: -93.20, accuracy: 12 });
  await page.waitForTimeout(2000);
  console.log("left; waiting out the 2-minute grace…");
  await page.waitForTimeout(125_000);
  await ctx.setGeolocation({ latitude: 44.9001, longitude: -93.2001, accuracy: 12 });
  await page.getByTestId("away-prompt").waitFor({ timeout: 70_000 });
  check("asked 'did you stop working?' instead of a silent clock-out", true);
  await shot(page, "09-phone-away-prompt");
  await page.getByTestId("away-prompt").getByRole("button", { name: /^Clock out at/ }).click();
  await page.getByTestId("manual-punch").waitFor();
  await page.waitForTimeout(1500);
  check("clocked out at departure time", /Clocked out|Not clocked in|Off the clock/i.test(await page.getByTestId("clock-state").textContent()));
  check("phone: no sideways scroll", await noHScroll(page));
  await page.getByTestId("my-week").scrollIntoViewIfNeeded();
  await shot(page, "10-phone-my-week");
  await ctx.close();
}

// 5. Owner: overview exceptions, payroll week, project labor.
await as(ME);
{
  const { ctx, page } = await open("/projects/workforce/time-tracking");
  await page.getByTestId("gps-admin").waitFor();
  await shot(page, "11-admin-on");
  await page.getByTestId("gps-tab-payroll").click();
  await page.getByTestId("gps-payroll").waitFor();
  await page.waitForTimeout(800);
  check("payroll week lists Cris", /Cris Carpenter/.test(await page.getByTestId("gps-payroll").textContent()));
  const dl = page.waitForEvent("download", { timeout: 5000 }).catch(() => null);
  if (await page.getByTestId("gps-export-payroll").isEnabled()) await page.getByTestId("gps-export-payroll").click();
  const d = await dl;
  if (d) { const p = `${dir}/payroll.csv`; await d.saveAs(p); check("payroll CSV downloaded with a header row", /Employee/i.test(fs.readFileSync(p, "utf8").split("\n")[0])); }
  else check("payroll CSV downloaded", false);
  await shot(page, "12-payroll-week");
  await ctx.close();
  const sched = (await (await fetch(`${M}/rest/v1/project_schedules?select=id,name`, { headers: { apikey: "x" } })).json().catch(() => [])) ?? [];
  const deck = Array.isArray(sched) ? sched.find((s) => /deck/i.test(s.name)) : null;
  if (deck) {
    const p2 = await open(`/projects/${deck.id}`);
    const panel = p2.page.getByTestId("project-labor");
    try { await panel.waitFor({ timeout: 10_000 }); check("project shows estimated vs actual labor", /Estimated/i.test(await panel.textContent())); await panel.scrollIntoViewIfNeeded(); await p2.page.screenshot({ path: `${dir}/13-project-labor.png` }); }
    catch { check("project labor panel visible", false); }
    await p2.ctx.close();
  } else check("found the deck project", false);
  const p3 = await open("/projects/workforce/time-tracking", { width: 390, height: 844 });
  await p3.page.getByTestId("gps-admin").waitFor();
  check("admin: no sideways scroll at 390", await noHScroll(p3.page));
  await shot(p3.page, "14-admin-phone");
  await p3.ctx.close();
}

await browser.close();
check(`no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`, errors.length === 0);
fs.writeFileSync(`${dir}/results.txt`, out.join("\n") + "\n");
process.exit(out.some((l) => l.startsWith("✗")) ? 1 : 0);
