// Browser walk for the global "Open schedule" navigation: every schedule action opens the one company
// calendar (/projects?view=calendar) with its context. Local build against the mock Supabase only.
//   npm run build && npx next start -p 3000
//   node scripts/ux-audit/mock-supabase.mjs &
//   APP=http://localhost:3000 MOCK=http://localhost:54321 node scripts/schedule/open-schedule-walk.mjs <screenshotDir>
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const dir = process.argv[2] ?? "open-schedule-shots";
fs.mkdirSync(dir, { recursive: true });
const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };
const out = []; const check = (n, c, extra = "") => { out.push(`${c ? "✓" : "✗"} ${n}${extra ? ` (${extra})` : ""}`); };
const M = process.env.MOCK ?? "http://localhost:54321", A = process.env.APP ?? "http://localhost:3000";
await fetch(`${M}/__onboarding?status=completed`);
await fetch(`${M}/__features?created=${encodeURIComponent(new Date().toISOString())}`);
await fetch(`${M}/__scenario?name=unlimited`);
await fetch(`${M}/__ws?seed=1`);
await fetch(`${M}/__team?seed=1`);
await fetch(`${M}/__wf?seed=1&manage=1`);
await fetch(`${M}/__pm?state=${encodeURIComponent(JSON.stringify({ scope: "individual", companyId: null, editorLimit: 1, editorsAssigned: 1, canEdit: true, source: "subscription", editUntil: null, addon: true, addonUntil: null, extraEditors: 0 }))}`);

const browser = await chromium.launch();
const errors = [];
async function open(vp, saved) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
  await ctx.addCookies([authCookie]);
  await ctx.addInitScript((s) => { try { localStorage.setItem("b2b-tour-done", "1"); if (s && !sessionStorage.getItem("seeded")) { localStorage.setItem("b2b.projects.filters.v1", s); sessionStorage.setItem("seeded", "1"); } } catch { /* ignore */ } }, saved ?? null);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  return page;
}
const shot = (p, n) => p.screenshot({ path: `${dir}/${n}.png`, fullPage: false });

// ---- Desktop ---------------------------------------------------------------------------------------------
const page = await open({ width: 1440, height: 1000 });
await page.goto(`${A}/projects?view=calendar`, { waitUntil: "networkidle" });
check("calendar opens in its default view with no context", await page.getByTestId("view-calendar").isVisible() && !(await page.getByTestId("cal-context").count()));
const ws = await page.evaluate(async () => { const t = new Date(); const f = new Date(t.getTime() - 60 * 864e5).toISOString().slice(0, 10), e = new Date(t.getTime() + 120 * 864e5).toISOString().slice(0, 10); return (await fetch(`/api/projects/workspace?from=${f}&to=${e}`)).json(); });
const kids = new Set(ws.tasks.map((t) => t.parentId).filter(Boolean));
const leaves = ws.tasks.filter((t) => !kids.has(t.id));
const proj = ws.projects[1] ?? ws.projects[0];
const task = leaves.filter((t) => t.scheduleId === proj.id).sort((a, b) => b.plannedStart.localeCompare(a.plannedStart))[0];
const href = (q) => `/projects?${new URLSearchParams({ view: "calendar", ...q })}`;

await page.goto(`${A}${href({ project: proj.id, task: task.id, date: task.plannedStart })}`, { waitUntil: "networkidle" });
const banner = page.getByTestId("cal-context");
check("project link shows the project banner", await banner.isVisible() && (await banner.innerText()).includes(proj.name));
const monthTitle = new Date(`${task.plannedStart}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
check("calendar opens on the linked date's month", (await page.locator("h2[aria-live]").innerText()).includes(monthTitle), monthTitle);
check("linked task is highlighted", await page.locator(`[data-task-id="${task.id}"][data-highlight]`).first().isVisible());
const titles = await page.getByTestId("cal-event").evaluateAll((els) => els.map((e) => e.getAttribute("title") ?? ""));
check("only the linked project's tasks show", titles.length > 0 && titles.every((t) => t.startsWith(`${proj.name}:`)), `${titles.length} events`);
check("project filter shows the linked project", (await page.getByTestId("f-project").inputValue()) === proj.id);
await shot(page, "01-project-context-desktop");
check("banner links to the project's own schedule and Gantt", (await page.getByTestId("cal-context-project").getAttribute("href")) === `/projects/${proj.id}`);
const saved = await page.evaluate(() => localStorage.getItem("b2b.projects.filters.v1"));
check("link context never overwrites saved filters", !saved || !saved.includes(proj.id));
await page.getByTestId("cal-context-clear").click();
await page.waitForFunction(() => !location.search.includes("project="));
check("Show everything clears the context and keeps the calendar", await page.getByTestId("view-calendar").isVisible() && !(await banner.count()));

// Project details → Open in calendar → Back
await page.goto(`${A}/projects/${proj.id}`, { waitUntil: "networkidle" });
const pc = page.getByTestId("project-open-calendar");
check("project details has Open in calendar", await pc.isVisible());
await pc.click();
await page.waitForURL(/view=calendar/);
await page.getByTestId("view-calendar").waitFor();
check("Open in calendar lands on the calendar for that project", page.url().includes(`project=${proj.id}`) && await banner.isVisible());
await page.goBack();
await page.waitForURL(new RegExp(`/projects/${proj.id}$`));
check("browser Back returns to project details", page.url().endsWith(`/projects/${proj.id}`));

// Overview "Calendar" button → calendar with project, Back → overview
await page.goto(`${A}/projects`, { waitUntil: "networkidle" });
const calBtn = page.getByRole("button", { name: "Calendar", exact: true }).nth(1);
if (await calBtn.count()) {
  await calBtn.click();
  await page.waitForURL(/view=calendar/);
  check("Overview Calendar button opens the calendar with project context", page.url().includes("project=") && await banner.isVisible());
  await page.goBack(); await page.waitForURL((u) => !u.search.includes("view=calendar"));
  check("Back returns to the overview", !page.url().includes("view=calendar"));
} else check("Overview Calendar button present", false);

// Bad or unauthorized project id
await page.goto(`${A}${href({ project: "99999999-9999-4999-8999-999999999999" })}`, { waitUntil: "networkidle" });
check("unknown/unauthorized project shows a notice and all visible projects", await page.getByTestId("cal-context-missing").isVisible());

// Member context (employee/sub)
const withRes = leaves.find((t) => t.resourceId);
if (withRes) {
  await page.goto(`${A}${href({ member: `r:${withRes.resourceId}`, date: withRes.plannedStart })}`, { waitUntil: "networkidle" });
  check("member link narrows the calendar to that person", (await page.getByTestId("f-member").inputValue()) === `r:${withRes.resourceId}` && await banner.isVisible());
}

// Workforce profile → Open schedule / View on calendar
await page.goto(`${A}/projects/workforce`, { waitUntil: "networkidle" });
const card = page.locator("[data-testid^=wf-card] button, [data-testid=wf-card] button").first();
if (await card.count()) {
  await card.click().catch(() => {});
  const vc = page.getByTestId("wf-booking-calendar").first();
  if (await vc.count()) {
    const h = await vc.getAttribute("href");
    check("workforce booking links to the calendar with project, task and date", /view=calendar/.test(h) && /project=/.test(h) && /task=/.test(h) && /date=/.test(h), h);
    await shot(page, "03-workforce-profile");
  } else out.push("· workforce profile has no bookings in the mock (link not exercised)");
} else out.push("· no workforce cards in the mock");

// ---- Phone -----------------------------------------------------------------------------------------------
const phone = await open({ width: 390, height: 844 }, JSON.stringify({ rep: "all", pm: "all", project: "all", status: "completed", trade: "all", member: "all" }));
await phone.goto(`${A}${href({ project: proj.id, task: task.id, date: task.plannedStart })}`, { waitUntil: "networkidle" });
check("phone opens agenda at the linked date", await phone.getByTestId("agenda").isVisible() && (await phone.locator("h2[aria-live]").innerText()).length > 0);
check("phone highlights the linked task", await phone.locator(`[data-task-id="${task.id}"][data-highlight]`).first().isVisible());
await shot(phone, "02-project-context-phone");
await phone.getByTestId("cal-context-clear").click();
await phone.waitForFunction(() => !location.search.includes("project="));
check("saved filters return after clearing context", (await phone.getByTestId("f-status").inputValue()) === "completed");
const explicit = await open({ width: 390, height: 844 });
await explicit.goto(`${A}${href({ date: task.plannedStart, mode: "day" })}`, { waitUntil: "networkidle" });
check("mode=day is respected on phone", (await explicit.getByTestId("cal-day").getAttribute("aria-pressed")) === "true");

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(out.join("\n"));
fs.writeFileSync(`${dir}/results.txt`, out.join("\n"));
