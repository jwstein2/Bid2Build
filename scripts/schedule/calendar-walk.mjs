// Browser walk for V4.5A (Schedule Now company calendar beside the wizard). Local build against the mock
// Supabase with test data only (NOT production). Nothing here touches real customers or charges.
//   npm run build && npx next start -p 3001
//   MOCK_PORT=54322 node scripts/ux-audit/mock-supabase.mjs &
//   APP=http://localhost:3001 MOCK=http://localhost:54322 node scripts/schedule/calendar-walk.mjs <screenshotDir>
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const dir = process.argv[2] ?? "calendar-shots";
fs.mkdirSync(dir, { recursive: true });
const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };
const out = []; const check = (n, c) => { out.push(`${c ? "✓" : "✗"} ${n}`); };
const M = process.env.MOCK ?? "http://localhost:54321", A = process.env.APP ?? "http://localhost:3000";
const pm = (o) => fetch(`${M}/__pm?state=${encodeURIComponent(JSON.stringify({ scope: "individual", companyId: null, editorLimit: 1, editorsAssigned: 1, canEdit: true, source: "subscription", editUntil: null, addon: true, addonUntil: null, extraEditors: 0, ...o }))}`);
const reset = async () => {
  await fetch(`${M}/__onboarding?status=completed`);
  await fetch(`${M}/__features?created=${encodeURIComponent(new Date().toISOString())}`);
  await fetch(`${M}/__scenario?name=unlimited`);
  await fetch(`${M}/__sched?reset=1&stage=won`);
  await fetch(`${M}/__ws?seed=1`);
  await fetch(`${M}/__team?seed=1`);
  await pm({});
};
const schedules = async () => (await (await fetch(`${M}/__sched`)).json()).schedules.length - 4; // minus the 4 seeded jobs
// Next weekday at least n days out, as the seeded jobs use.
const day = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };

const browser = await chromium.launch();
const errors = [];
async function open(vp = { width: 1440, height: 1000 }, theme = "light") {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: vp.width < 800 ? 2 : 1 });
  await ctx.addCookies([authCookie]);
  if (theme !== "light") await ctx.addInitScript((t) => { try { localStorage.setItem("b2b-theme", t); } catch { /* ignore */ } document.documentElement?.setAttribute("data-theme", t); }, theme);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${A}/projects/new?estimate=11111111-1111-4111-8111-111111111111`, { waitUntil: "load" });
  await page.getByTestId("schedule-wizard").waitFor();
  if (await page.getByTestId("unlocked-modal").count()) { await page.getByRole("button", { name: "Maybe Later" }).click(); await page.waitForTimeout(300); }
  await page.waitForTimeout(900);
  if (theme !== "light") await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
  return { ctx, page };
}
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const shot = (page, name, full = false) => page.screenshot({ path: `${dir}/${name}.png`, fullPage: full });
const next = async (page) => { await page.getByTestId("wizard-next").click(); await page.waitForTimeout(350); };
const box = (page, id) => page.getByTestId(id).boundingBox();

const START = day(1); // same days as the seeded "Kitchen Remodel – Ortiz" demolition by Crew A

// ── Desktop, light: all 9 steps with the calendar beside the wizard ──────────────────────────────
await reset();
{
  const { ctx, page } = await open();
  const w = await box(page, "wizard-column"), c = await box(page, "company-cal-panel");
  check("desktop: wizard on the left, calendar on the right", !!w && !!c && w.x < c.x && Math.abs(w.y - c.y) < 40);
  const share = c.width / (w.width + c.width);
  check(`desktop: calendar takes 40–45% of the split (${Math.round(share * 100)}%)`, share >= 0.38 && share <= 0.46);
  check("desktop: left sidebar still shown", await page.locator("aside, nav").first().isVisible());
  check("desktop: 'View Company Calendar' button hidden when the calendar is already beside the wizard", !(await page.getByTestId("view-company-calendar").isVisible()));
  check("step 1: existing company work shows before a start date", (await page.getByTestId("cal-existing").count()) > 0);
  check("step 1: no draft overlay before a start date", (await page.getByTestId("cal-draft").count()) === 0);
  await shot(page, "schedule-now-new-desktop-layout");
  await shot(page, "schedule-now-step1-source-estimate-with-calendar");

  await next(page); // 2 sections
  check("step 2: calendar still visible", await page.getByTestId("company-calendar").isVisible());
  await next(page); // 3 start
  await shot(page, "schedule-now-step3-start-date-before");
  await page.getByTestId("start-date").fill(START);
  await page.waitForTimeout(500);
  check("step 3: draft appears once a start date is chosen", (await page.getByTestId("cal-draft").count()) > 0);
  check("step 3: overlap count is shown", /\d/.test(await page.getByTestId("overlap-count").innerText()));
  await shot(page, "schedule-now-step3-start-date-with-calendar");

  // Click a date on the calendar to set the start (before/after).
  const target = day(8);
  const cell = page.locator(`[data-testid="cal-day"][data-day="${target}"]`);
  await shot(page, "calendar-click-date-before");
  await cell.click();
  await page.getByTestId("use-as-start").click();
  await page.waitForTimeout(400);
  check("clicking a date and 'Start this job' sets the start date", (await page.getByTestId("start-date").inputValue()) === target);
  await shot(page, "calendar-click-date-after");
  await page.getByTestId("start-date").fill(START);
  await page.waitForTimeout(400);

  await next(page); // 4 durations
  const draftBefore = await page.getByTestId("cal-draft").count();
  await shot(page, "schedule-now-step4-durations-before");
  await page.locator("input[type=number]").nth(1).fill("9");
  await page.waitForTimeout(500);
  const draftAfter = await page.getByTestId("cal-draft").count();
  check(`step 4: changing a duration updates the draft (${draftBefore} → ${draftAfter} chips)`, draftAfter > draftBefore);
  await shot(page, "schedule-now-step4-durations-after");

  // Quick view of an existing project keeps the form intact.
  await page.getByTestId("cal-existing").first().click();
  await page.waitForTimeout(300);
  check("project quick view opens", await page.getByTestId("cal-quickview").isVisible());
  check("quick view kept the typed duration", (await page.locator("input[type=number]").nth(1).inputValue()) === "9");
  await shot(page, "calendar-project-quickview-open");
  await page.getByRole("button", { name: "Close details" }).click();

  // Show the overlapping work list.
  await page.getByTestId("show-overlaps").click();
  check("overlap list lists other projects", (await page.getByTestId("overlap-list").locator("li").count()) > 0);
  await shot(page, "calendar-overlap-list-open");
  await page.getByTestId("show-overlaps").click();

  await next(page); // 5 deps
  await next(page); // 6 target
  await next(page); // 7 review
  await next(page); // 8 assign
  const sticky = await page.evaluate(() => { window.scrollTo(0, document.body.scrollHeight); return new Promise((r) => setTimeout(() => r(document.querySelector('[data-testid="company-cal-panel"]').getBoundingClientRect().top), 300)); });
  check(`calendar stays in view while scrolling (top ${Math.round(sticky)}px)`, sticky >= 0 && sticky < 120);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "schedule-now-step8-assign-before");
  await page.getByTestId("assign-step-select").first().selectOption({ label: "Crew A" });
  await page.waitForTimeout(500);
  const possible = await page.getByTestId("conflict-possible").count();
  check(`step 8: same crew on another job shows a POSSIBLE conflict (${possible})`, possible > 0);
  check("step 8: Next stays enabled (conflicts never block)", await page.getByTestId("wizard-next").isEnabled());
  check("no schedule saved yet", (await schedules()) === 0);
  await shot(page, "schedule-now-step8-assign-with-conflicts");

  // Expand and collapse keeps the wizard state.
  await page.getByTestId("company-cal-expand").click();
  await page.waitForTimeout(400);
  const exp = await box(page, "company-cal-panel");
  check("expanded calendar fills most of the screen", exp.width > 1200);
  await shot(page, "schedule-now-calendar-expanded");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check("Escape returns to the split view", (await box(page, "company-cal-panel")).width < 700);
  check("assignment survived expand/collapse", (await page.getByTestId("assign-step-select").first().locator("option:checked").innerText()).includes("Crew A"));

  await next(page); // 9 save
  check("step 9: calendar still shown on the save step", await page.getByTestId("company-calendar").isVisible());
  check("step 9: date clicks no longer offer to change the start", await (async () => { await page.locator(`[data-testid="cal-day"][data-day="${START}"]`).click(); await page.waitForTimeout(200); return (await page.getByTestId("use-as-start").count()) === 0; })());
  check("still nothing saved before Save", (await schedules()) === 0);
  await shot(page, "schedule-now-step9-final-confirmation-before-save");
  await page.getByTestId("save-schedule").click();
  await page.waitForURL(/\/projects\/(?!schedule)/, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(800);
  check("Save creates exactly one schedule", (await schedules()) === 1);
  await shot(page, "schedule-now-after-save");
  check("desktop: no horizontal scroll", await noHScroll(page));
  await ctx.close();
}

// ── Desktop, dark ─────────────────────────────────────────────────────────────────────────────
await reset();
for (const theme of ["dark", "black"]) {
  const { ctx, page } = await open({ width: 1440, height: 1000 }, theme);
  await next(page); await next(page);
  await page.getByTestId("start-date").fill(START);
  await next(page); await next(page); await next(page); await next(page); await next(page);
  await page.getByTestId("assign-step-select").first().selectOption({ label: "Crew A" });
  await page.waitForTimeout(500);
  check(`${theme}: conflict card renders`, (await page.getByTestId("conflict-possible").count()) > 0);
  await shot(page, `schedule-now-step8-assign-with-conflicts-${theme}`);
  await ctx.close();
}

// ── Tablet: calendar below the wizard ─────────────────────────────────────────────────────────
{
  const { ctx, page } = await open({ width: 1024, height: 1200 });
  await page.getByTestId("view-company-calendar").click();
  await page.waitForTimeout(300);
  const w = await box(page, "wizard-column"), c = await box(page, "company-cal-panel");
  check("tablet: calendar sits below the wizard", !!c && c.y > w.y + w.height - 5);
  check("tablet: no horizontal scroll", await noHScroll(page));
  await shot(page, "schedule-now-tablet-calendar-below", true);
  await ctx.close();
}

// ── Mobile: full-screen drawer, back to the same step with state kept ─────────────────────────
for (const theme of ["light", "dark"]) {
  const { ctx, page } = await open({ width: 390, height: 844 }, theme);
  check(`mobile ${theme}: calendar hidden until asked for`, !(await page.getByTestId("company-cal-panel").isVisible()));
  await next(page); await next(page);
  await page.getByTestId("start-date").fill(START);
  await next(page);
  await page.locator("input[type=number]").nth(0).fill("4");
  await shot(page, `schedule-now-mobile-step4-before-calendar-${theme}`);
  await page.getByTestId("view-company-calendar").click();
  await page.waitForTimeout(400);
  const c = await box(page, "company-cal-panel");
  check(`mobile ${theme}: drawer is full screen`, c && c.width >= 389 && c.height >= 800);
  check(`mobile ${theme}: draft shows in the drawer`, (await page.getByTestId("cal-draft").count()) > 0);
  check(`mobile ${theme}: no horizontal scroll`, await noHScroll(page));
  await shot(page, `schedule-now-mobile-calendar-drawer-${theme}`);
  await page.getByTestId("company-cal-close").click();
  await page.waitForTimeout(300);
  check(`mobile ${theme}: back returns to step 4 with the duration kept`, (await page.locator("input[type=number]").nth(0).inputValue()) === "4" && !(await page.getByTestId("company-cal-panel").isVisible()));
  await shot(page, `schedule-now-mobile-step4-after-calendar-${theme}`);
  await ctx.close();
}

await browser.close();
const real = errors.filter((e) => !/ERR_TUNNEL|Failed to fetch/.test(e));
check(`no page errors (${real.length})`, real.length === 0);
if (real.length) console.log(real.slice(0, 5).join("\n"));
console.log(out.join("\n"));
const failed = out.filter((l) => l.startsWith("✗")).length;
console.log(`\n${out.length - failed}/${out.length} checks passed`);
process.exit(failed ? 1 : 0);
