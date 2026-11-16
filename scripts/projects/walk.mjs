// Browser walk for Projects Workspace V4.1 against the mock Supabase (test data only, NOT production).
//   build with NEXT_PUBLIC_PROJECT_SCHEDULING=on, `next start`, node scripts/ux-audit/mock-supabase.mjs
//   node scripts/projects/walk.mjs <screenshotDir>
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const dir = process.argv[2] ?? "projects-shots";
fs.mkdirSync(dir, { recursive: true });
const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };
const out = []; const check = (n, c) => out.push(`${c ? "✓" : "✗"} ${n}`);
const M = "http://localhost:54321", A = "http://localhost:3000";
const pm = (o = {}) => fetch(`${M}/__pm?state=${encodeURIComponent(JSON.stringify({ scope: "individual", companyId: null, editorLimit: 1, editorsAssigned: 1, canEdit: true, source: "subscription", editUntil: null, addon: true, addonUntil: null, extraEditors: 0, ...o }))}`);
await fetch(`${M}/__onboarding?status=completed`);
await fetch(`${M}/__features?created=${encodeURIComponent(new Date().toISOString())}`);
await fetch(`${M}/__scenario?name=unlimited`);
await fetch(`${M}/__sched?reset=1&stage=won`);
await fetch(`${M}/__ws?seed=1`);
await pm();
const browser = await chromium.launch();
const errors = [];
async function open(path, vp = { width: 1440, height: 1000 }, theme = null) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 });
  await ctx.addCookies([authCookie]);
  if (theme) await ctx.addInitScript((m) => { try { localStorage.setItem("b2b-theme", JSON.stringify({ mode: m, at: Date.now() })); } catch {} }, theme);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${A}${path}`, { waitUntil: "load" });
  const later = page.getByRole("button", { name: "Maybe Later" });
  try { await later.waitFor({ timeout: 3000 }); await later.click(); } catch { /* none */ }
  await page.waitForTimeout(400);
  return { ctx, page };
}
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

// Desktop: every view
{
  const { ctx, page } = await open("/projects");
  check("overview: five metrics", (await page.getByTestId("metric").count()) === 5);
  check("overview: project cards show rep and PM", (await page.getByTestId("project-card").count()) === 4 && (await page.getByText("Jordan Sales").count()) > 0 && (await page.getByText("Pat Manager").count()) > 0);
  await page.screenshot({ path: `${dir}/overview-desktop.png`, fullPage: true });
  await page.getByTestId("layout-table").click();
  check("overview: sortable table view", (await page.getByTestId("project-row").count()) === 4);
  await page.getByRole("button", { name: "Progress" }).click();
  await page.screenshot({ path: `${dir}/overview-table-desktop.png`, fullPage: true });
  // Filters
  await page.getByTestId("f-rep").selectOption({ label: "Jordan Sales" });
  check("filter by salesperson", (await page.getByTestId("project-row").count()) === 2);
  await page.getByTestId("f-pm").selectOption({ label: "No PM yet" });
  check("salesperson + PM filters combine", (await page.getByTestId("project-row").count()) === 1);
  await page.getByTestId("reset-filters").click();
  check("reset filters", (await page.getByTestId("project-row").count()) === 4);
  await page.getByTestId("f-project").selectOption({ label: "Deck Rebuild – Lee" });
  check("filter by project", (await page.getByTestId("project-row").count()) === 1);
  await page.reload(); await page.waitForTimeout(800);
  check("filters are remembered", (await page.getByTestId("f-project").inputValue()) !== "all");
  await page.getByTestId("reset-filters").click();

  // Calendar
  await page.getByTestId("tab-calendar").click();
  await page.getByTestId("view-calendar").waitFor();
  check("calendar: overlapping projects shown together", new Set(await page.getByTestId("cal-event").evaluateAll((els) => els.map((e) => e.title.split(":")[0]))).size >= 3);
  await page.screenshot({ path: `${dir}/calendar-month-desktop.png`, fullPage: true });
  await page.getByTestId("cal-week").click();
  await page.screenshot({ path: `${dir}/calendar-week-desktop.png`, fullPage: true });
  await page.getByTestId("cal-event").first().click();
  await page.getByTestId("task-drawer").waitFor();
  check("calendar: event opens quick-detail drawer with assignee", (await page.getByTestId("drawer-assignee").textContent()).length > 0);
  await page.screenshot({ path: `${dir}/calendar-drawer-desktop.png` });
  await page.keyboard.press("Escape");
  await page.getByTestId("cal-agenda").click();
  check("calendar: agenda view", (await page.getByTestId("agenda-item").count()) > 0);

  // Timeline + drag
  await page.getByTestId("tab-timeline").click();
  await page.getByTestId("view-timeline").waitFor();
  check("timeline: projects grouped", (await page.getByTestId("timeline-project").count()) === 4);
  check("timeline: today line", await page.getByTestId("timeline-today").count() === 1);
  await page.screenshot({ path: `${dir}/timeline-desktop.png`, fullPage: true });
  const bar = page.locator("[data-testid^=tl-end-]").nth(2);
  const box = await bar.boundingBox();
  await page.mouse.move(box.x + 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + 2 + 12 * 3, box.y + box.height / 2, { steps: 6 }); await page.mouse.up();
  await page.getByTestId("task-drawer").waitFor();
  await page.waitForTimeout(800);
  check("timeline: drag-to-resize opens a preview (nothing saved yet)", (await page.getByTestId("drawer-save-dates").count()) === 1);
  await page.screenshot({ path: `${dir}/timeline-resize-preview-desktop.png` });
  const movedName = (await page.getByTestId("task-drawer").locator("h2").first().textContent()).trim();
  const movedProject = (await page.getByTestId("task-drawer").locator("a[href^='/projects/']").first().textContent()).trim();
  await page.getByTestId("drawer-save-dates").click();
  await page.getByText("Dates saved").waitFor({ timeout: 5000 });
  check("timeline: saved through the schedule API", true);
  await page.keyboard.press("Escape");
  await page.getByTestId("tab-calendar").click(); await page.getByTestId("cal-month").click();
  // Read the saved end back from the workspace API (the engine may snap a weekend end to a workday).
  const savedEnd = await page.evaluate(async ([n, pn]) => {
    const r = await fetch("/api/projects/workspace?from=2026-01-01&to=2027-01-31"); const j = await r.json(); const w = j.data ?? j;
    const pid = w.projects.find((p) => p.name === pn)?.id; return w.tasks.find((t) => t.name === n && t.scheduleId === pid)?.plannedEnd;
  }, [movedName, movedProject]);
  if (!(await page.locator(`[data-day="${savedEnd}"]`).count())) await page.getByRole("button", { name: "Next" }).click();
  await page.locator(`[data-day="${savedEnd}"] > button`).first().click();
  await page.getByTestId("cal-week").click();
  check(`same change appears in the calendar (${movedName} ends ${savedEnd})`, !!savedEnd && (await page.locator(`[data-day="${savedEnd}"] [data-testid=cal-event]`, { hasText: movedName }).count()) > 0);

  // Workload
  await page.getByTestId("tab-workload").click();
  await page.getByTestId("view-workload").waitFor();
  check("workload: double-booking from real assignments (Crew A / Crew B)", (await page.getByTestId("conflict").count()) >= 1);
  check("workload: booked days, no invented utilization %", !(await page.getByTestId("workload-table").textContent()).includes("%"));
  await page.screenshot({ path: `${dir}/workload-desktop.png`, fullPage: true });

  // My Work
  await page.getByTestId("tab-mywork").click();
  await page.getByTestId("view-mywork").waitFor();
  check("my work: tasks on projects I manage / assigned to me", (await page.getByTestId("mywork-item").count()) > 0);
  await page.screenshot({ path: `${dir}/mywork-desktop.png`, fullPage: true });

  // Project detail: people, activity, closeout
  await page.getByTestId("tab-overview").click();
  await page.getByTestId("project-card").filter({ hasText: "Deck Rebuild" }).getByRole("link", { name: "Deck Rebuild – Lee" }).click();
  await page.getByTestId("project-summary").waitFor();
  check("detail: summary shows salesperson and PM separately", (await page.getByTestId("summary-rep").textContent()) === "Jordan Sales" && (await page.getByTestId("summary-pm").textContent()) === "Not assigned");
  await page.getByTestId("edit-people").click();
  await page.getByTestId("pm-select").selectOption({ label: "Pat Manager" });
  await page.getByTestId("save-people").click();
  await page.waitForTimeout(1200);
  check("detail: PM assigned and logged", (await page.getByTestId("summary-pm").textContent()) === "Pat Manager" && (await page.getByTestId("activity").textContent()).includes("Project manager assigned"));
  await page.getByTestId("closeout-open").click();
  check("closeout: unfinished tasks need a reason", await page.getByTestId("closeout-confirm").isDisabled());
  await page.screenshot({ path: `${dir}/detail-closeout-desktop.png`, fullPage: false });
  await page.getByTestId("closeout-reason").fill("Customer paused the railing work");
  await page.getByTestId("closeout-confirm").click();
  await page.waitForTimeout(1200);
  check("closeout: project completed and history kept", (await page.getByTestId("activity").textContent()).includes("Project completed"));
  await page.screenshot({ path: `${dir}/detail-desktop.png`, fullPage: true });
  await ctx.close();
}

// View-only user
await pm({ canEdit: false, addon: false });
{
  const { ctx, page } = await open("/projects?view=timeline");
  await page.getByTestId("view-timeline").waitFor();
  const b = page.locator("[data-testid^=tl-bar-]").first();
  await b.click();
  await page.getByTestId("task-drawer").waitFor();
  check("view-only: drawer has no move/progress controls", (await page.getByTestId("drawer-preview").count()) === 0 && (await page.getByTestId("drawer-save-progress").count()) === 0);
  await ctx.close();
}
await pm();

// Mobile + dark
for (const [name, vp] of [["m390", { width: 390, height: 844 }], ["m320", { width: 320, height: 720 }]]) {
  const { ctx, page } = await open("/projects", vp);
  check(`${name}: no horizontal page scroll (overview)`, await noHScroll(page));
  await page.screenshot({ path: `${dir}/overview-${name}.png`, fullPage: true });
  await page.getByTestId("tab-calendar").click();
  check(`${name}: calendar opens in agenda view`, await page.getByTestId("agenda").waitFor({ timeout: 4000 }).then(() => true, () => false));
  await page.screenshot({ path: `${dir}/calendar-agenda-${name}.png`, fullPage: true });
  await page.getByTestId("tab-more").click();
  await page.getByRole("button", { name: "My Work" }).click();
  await page.getByTestId("view-mywork").waitFor();
  check(`${name}: overflow menu reaches My Work; no horizontal scroll`, await noHScroll(page));
  await page.getByTestId("mywork-item").first().click();
  await page.getByTestId("task-drawer").waitFor();
  check(`${name}: date fields to move a task without dragging`, (await page.getByTestId("drawer-start").count()) === 1);
  await page.screenshot({ path: `${dir}/drawer-${name}.png` });
  await ctx.close();
}
for (const theme of ["dark", "black"]) {
  const { ctx, page } = await open("/projects", { width: 1440, height: 1000 }, theme);
  check(`${theme}: theme applied`, (await page.getAttribute("html", "data-theme")) === theme);
  await page.screenshot({ path: `${dir}/overview-${theme}.png`, fullPage: true });
  await page.getByTestId("tab-timeline").click(); await page.getByTestId("view-timeline").waitFor();
  await page.screenshot({ path: `${dir}/timeline-${theme}.png`, fullPage: true });
  await page.getByTestId("tab-calendar").click(); await page.getByTestId("view-calendar").waitFor();
  await page.screenshot({ path: `${dir}/calendar-${theme}.png`, fullPage: true });
  await ctx.close();
}
await browser.close();
console.log(out.join("\n"));
console.log(errors.length ? `page errors: ${[...new Set(errors)].join(" | ")}` : "no page errors");
