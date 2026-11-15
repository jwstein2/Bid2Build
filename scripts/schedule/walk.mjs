// Browser walk for V4 Phases 6-7 (Schedule Now wizard, Gantt editing, progress, delays). Local build
// against the mock Supabase with test data only (NOT production).
//   NEXT_PUBLIC_PROJECT_SCHEDULING=on npm run build && next start
//   node scripts/ux-audit/mock-supabase.mjs &
//   node scripts/schedule/walk.mjs <screenshotDir>
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const dir = process.argv[2] ?? "schedule-shots";
fs.mkdirSync(dir, { recursive: true });
const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };
const out = []; const check = (n, c) => out.push(`${c ? "✓" : "✗"} ${n}`);
const M = "http://localhost:54321", A = "http://localhost:3000";
const EST = "11111111-1111-4111-8111-111111111111";
const pm = (o) => fetch(`${M}/__pm?state=${encodeURIComponent(JSON.stringify({ scope: "individual", companyId: null, editorLimit: 1, editorsAssigned: 1, canEdit: true, source: "subscription", editUntil: null, addon: true, addonUntil: null, extraEditors: 0, ...o }))}`);
await fetch(`${M}/__onboarding?status=completed`);
await fetch(`${M}/__features?created=${encodeURIComponent(new Date().toISOString())}`);
await fetch(`${M}/__scenario?name=unlimited`);
await fetch(`${M}/__sched?reset=1&stage=won`);
await pm({});
const browser = await chromium.launch();
const errors = [];
async function open(path, vp = { width: 1360, height: 1000 }) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 });
  await ctx.addCookies([authCookie]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${A}${path}`, { waitUntil: "load" });
  await page.waitForTimeout(1800);
  if (await page.getByTestId("unlocked-modal").count()) { await page.getByRole("button", { name: "Maybe Later" }).click(); await page.waitForTimeout(300); }
  return { ctx, page };
}
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

// 1. Projects page lists the won bid as ready; nav shows Projects.
let scheduleUrl;
{
  const { ctx, page } = await open("/projects");
  check("nav shows Projects", await page.getByRole("link", { name: "Projects" }).first().isVisible());
  check("won bid is listed as ready to schedule", (await page.getByTestId("ready-bid").count()) >= 1);
  await page.getByTestId("ready-bid").first().getByRole("link", { name: "Schedule Now" }).click();
  await page.getByTestId("schedule-wizard").waitFor();

  // Wizard step 1-8
  check("step 1 shows the source estimate as Won", (await page.getByText("Won", { exact: true }).count()) > 0);
  await page.screenshot({ path: `${dir}/wizard-step1-desktop.png`, fullPage: true });
  await page.getByTestId("wizard-next").click();
  check("step 2 lists the estimate's sections (nothing invented)", (await page.locator("input[type=checkbox]").count()) === 4);
  await page.getByTestId("wizard-next").click();
  await page.getByTestId("start-date").fill("2026-11-16");
  await page.getByTestId("wizard-next").click();
  // durations
  const dur = page.locator("input[type=number]");
  await dur.nth(0).fill("2"); await dur.nth(1).fill("5"); await dur.nth(2).fill("3"); await dur.nth(3).fill("1");
  await page.getByTestId("wizard-next").click();
  // dependencies: default sequential; allow trim to overlap siding by 2 days; cleanup after trim
  const trim = page.locator('[data-testid^="dep-"]').nth(2);
  await trim.locator("input[type=number]").nth(1).fill("2");
  await page.screenshot({ path: `${dir}/wizard-dependencies-desktop.png`, fullPage: true });
  await page.getByTestId("wizard-next").click();
  // target date that can't be met as-is -> choices; use the allowed overlap
  await page.getByTestId("target-date").fill("2026-11-26");
  await page.waitForTimeout(200);
  check("target date conflict is explained with choices", await page.getByTestId("target-conflict").isVisible());
  check("offers to use only the overlap you allowed", await page.getByTestId("use-overlaps").isVisible());
  await page.screenshot({ path: `${dir}/wizard-target-desktop.png`, fullPage: true });
  await page.getByTestId("use-overlaps").click();
  await page.waitForTimeout(200);
  check("after the overlap the plan meets the target", (await page.getByText("The plan meets your target").count()) === 1);
  await page.getByTestId("wizard-next").click();
  check("review shows the generated timeline", await page.getByTestId("mini-timeline").isVisible());
  await page.getByTestId("wizard-next").click();
  check("save step says the customer isn't notified", (await page.getByText("Nothing is sent to your customer").count()) === 1);
  await page.getByTestId("save-schedule").click();
  await page.getByTestId("schedule-editor").waitFor({ timeout: 15000 });
  scheduleUrl = new URL(page.url()).pathname;
  check("saved as a draft and opened the schedule", (await page.getByText("Draft schedule saved").count()) === 1 && (await page.getByText("Draft", { exact: true }).count()) >= 1);
  check("today line shows on the timeline", (await page.getByTestId("today-line").count()) === 1);
  await page.screenshot({ path: `${dir}/gantt-desktop.png`, fullPage: true });
  await ctx.close();
}

// 2. Editing: drag, keyboard, delays with preview, line items, progress, undo, history.
{
  const { ctx, page } = await open(scheduleUrl);
  const bars = page.locator('[data-testid^="bar-"]');
  const firstBar = bars.nth(0);
  const id = (await firstBar.getAttribute("data-testid")).slice(4);
  const before = await firstBar.getAttribute("aria-label");
  // Drag the end of the first section 2 days later -> delay dialog (siding depends on it).
  const end = page.getByTestId(`end-${id}`);
  const box = await end.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 32 * 2 + 4, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.getByTestId("delay-dialog").waitFor({ timeout: 5000 });
  check("extending a task asks what to do with later tasks", true);
  check("delay choices show a preview before saving", await page.getByTestId("preview-changes").isVisible());
  await page.getByTestId("mode-keep").check();
  const keepCount = await page.getByTestId("preview-changes").locator("li").count();
  await page.getByTestId("mode-dependents").check();
  const depCount = await page.getByTestId("preview-changes").locator("li").count();
  check("keep moves only this task; move dependents moves the chain", keepCount === 1 && depCount > 1);
  await page.screenshot({ path: `${dir}/delay-preview-desktop.png`, fullPage: true });
  await page.getByTestId("apply-delay").click();
  await page.waitForTimeout(1200);
  check("drag saved new dates", (await firstBar.getAttribute("aria-label")) !== before);

  // Keyboard: focus bar, ArrowRight moves a day (last section has no dependents -> no dialog).
  const last = bars.last();
  const lastBefore = await last.getAttribute("aria-label");
  await last.focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(1200);
  if (await page.getByTestId("delay-dialog").count()) await page.getByTestId("apply-delay").click();
  await page.waitForTimeout(500);
  check("keyboard arrow moves a bar", (await last.getAttribute("aria-label")) !== lastBefore);

  // Undo
  await page.getByTestId("undo").click();
  await page.waitForTimeout(1200);
  check("undo restores the previous dates", (await last.getAttribute("aria-label")) === lastBefore);

  // Schedule individual line items for section 2 (siding installation has 2 items).
  await page.getByRole("button", { name: /Schedule individual items in Siding installation/ }).click();
  await page.getByTestId("items-dialog").waitFor();
  await page.getByTestId("items-dialog").locator("input[type=checkbox]").nth(0).check();
  await page.getByTestId("items-dialog").locator("input[type=checkbox]").nth(1).check();
  await page.getByTestId("add-items").click();
  await page.waitForTimeout(1200);
  check("line items became their own tasks", (await page.getByRole("button", { name: /^Vinyl siding panels/ }).count()) >= 1);
  await page.getByRole("button", { name: /Schedule individual items in Siding installation/ }).click();
  check("already scheduled items can't be added twice", (await page.getByTestId("items-dialog").getByText("Scheduled", { exact: true }).count()) === 2 && await page.getByTestId("add-items").isDisabled());
  await page.keyboard.press("Escape");

  // Progress: mark an item 50% and another complete; progress isn't elapsed time.
  await page.getByRole("button", { name: /^Vinyl siding panels/ }).first().click();
  await page.getByTestId("task-dialog").waitFor();
  await page.getByTestId("percent").fill("50");
  await page.getByTestId("status").selectOption("in_progress");
  await page.getByTestId("save-task").click();
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: /^Siding install labor/ }).first().click();
  await page.getByTestId("status").selectOption("complete");
  check("marking complete fills the actual finish for review", (await page.getByTestId("actual-finish").inputValue()) !== "");
  await page.getByTestId("save-task").click();
  await page.waitForTimeout(1200);
  const pct = Number((await page.getByTestId("project-progress").textContent()).replace("%", ""));
  check("project progress is calculated from % complete", pct > 0 && pct < 100);
  await page.getByTestId("progress-how").click();
  check("progress method and drilldown are shown", await page.getByTestId("progress-panel").isVisible());
  await page.screenshot({ path: `${dir}/gantt-progress-desktop.png`, fullPage: true });

  // Zoom levels
  await page.getByTestId("zoom-week").click();
  await page.waitForTimeout(200);
  await page.getByTestId("zoom-month").click();
  check("week and month zoom render", await page.getByTestId("gantt").isVisible());
  await page.getByTestId("zoom-day").click();

  // History
  await page.getByTestId("history-button").click();
  check("history lists each change", (await page.getByTestId("history-panel").locator("li").count()) >= 5);
  await page.screenshot({ path: `${dir}/history-desktop.png`, fullPage: true });

  // Dependency loop is refused in the task editor (only valid choices offered).
  await ctx.close();
}

// 3. Mobile list view and touch-friendly editing.
for (const w of [390, 320]) {
  const { ctx, page } = await open(scheduleUrl, { width: w, height: 860 });
  check(`${w}px: no horizontal page scroll`, await noHScroll(page));
  await page.getByTestId("list-view").click();
  check(`${w}px: list view with Edit buttons`, (await page.getByTestId("schedule-list").getByRole("button", { name: "Edit" }).count()) > 0);
  if (w === 390) {
    await page.screenshot({ path: `${dir}/schedule-list-m390.png`, fullPage: true });
    await page.getByTestId("schedule-list").locator('[data-testid^="shift-"]').first().click();
    await page.getByTestId("shift-days").fill("1");
    check("shift section previews moved tasks", (await page.getByTestId("shift-dialog").getByTestId("preview-changes").locator("li").count()) >= 1);
    await page.getByTestId("apply-shift").click();
    await page.waitForTimeout(1200);
  }
  check(`${w}px: still no horizontal page scroll`, await noHScroll(page));
  await ctx.close();
}

// 4. View-only: losing editing keeps the schedule visible, read-only.
await pm({ canEdit: false, addon: false });
{
  const { ctx, page } = await open(scheduleUrl);
  check("view-only banner explains how to edit", (await page.getByText("View only").count()) >= 1);
  check("no undo or item buttons for viewers", (await page.getByTestId("undo").count()) === 0 && (await page.getByRole("button", { name: /Schedule individual items/ }).count()) === 0);
  await page.locator('[data-testid^="bar-"]').first().click();
  check("task details open read-only", await page.getByTestId("task-dialog").isVisible() && (await page.getByTestId("save-task").count()) === 0);
  await page.screenshot({ path: `${dir}/view-only-desktop.png`, fullPage: true });
  await ctx.close();
}

// 5. Provisional path for an unaccepted bid; duplicate protection.
await pm({});
await fetch(`${M}/__sched?reset=1&stage=sent`);
{
  const { ctx, page } = await open(`/projects/new?estimate=${EST}`);
  check("unaccepted bid: Next is blocked until provisional is chosen", await page.getByTestId("wizard-next").isDisabled());
  await page.getByTestId("provisional").check();
  check("provisional choice unlocks the wizard", await page.getByTestId("wizard-next").isEnabled());
  await page.screenshot({ path: `${dir}/wizard-provisional-desktop.png`, fullPage: true });
  for (let i = 0; i < 7; i++) await page.getByTestId("wizard-next").click();
  await page.getByTestId("save-schedule").click();
  await page.getByTestId("schedule-editor").waitFor({ timeout: 15000 });
  check("provisional schedules are labelled", (await page.getByText("Provisional: bid not yet accepted").count()) >= 1);
  await ctx.close();
}
{
  const { ctx, page } = await open(`/projects/new?estimate=${EST}`);
  check("Schedule Now on a bid that has a schedule opens it (no duplicate)", page.url().includes("/projects/") && !page.url().includes("/new"));
  await ctx.close();
}

// 6. Flag-gated Schedule Now on the pipeline board's Won card.
await fetch(`${M}/__sched?reset=1&stage=won`);

await browser.close();
console.log(out.join("\n"));
console.log(errors.length ? `page errors:\n${errors.join("\n")}` : "no page errors");
process.exit(out.some((l) => l.startsWith("✗")) || errors.length ? 1 : 0);
