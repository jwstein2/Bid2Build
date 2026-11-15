// Browser walk for V4 Phase 8 (customer schedule updates: preview, publish, PDF, secure link, history).
// Local build against the mock Supabase with test data only (NOT production).
//   NEXT_PUBLIC_PROJECT_SCHEDULING=on npm run build && next start
//   node scripts/ux-audit/mock-supabase.mjs &
//   node scripts/schedule/updates-walk.mjs <screenshotDir>
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const dir = process.argv[2] ?? "schedule-update-shots";
fs.mkdirSync(dir, { recursive: true });
const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };
const out = []; const check = (n, c) => out.push(`${c ? "✓" : "✗"} ${n}`);
const M = "http://localhost:54321", A = "http://localhost:3000";
const EST = "11111111-1111-4111-8111-111111111111";
const CAL = { workdays: [1, 2, 3, 4, 5], holidays: [], timezone: "America/Chicago" };
const pm = (o) => fetch(`${M}/__pm?state=${encodeURIComponent(JSON.stringify({ scope: "individual", companyId: null, editorLimit: 1, editorsAssigned: 1, canEdit: true, source: "subscription", editUntil: null, addon: true, addonUntil: null, extraEditors: 0, ...o }))}`);
const rpc = (name, args) => fetch(`${M}/rest/v1/rpc/${name}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(args) }).then((r) => r.json());
await fetch(`${M}/__onboarding?status=completed`);
await fetch(`${M}/__features?created=${encodeURIComponent(new Date().toISOString())}`);
await fetch(`${M}/__scenario?name=unlimited`);
await fetch(`${M}/__sched?reset=1&stage=won`);
await pm({});

// Test schedule: tear-off done (Nov 9-11), siding in progress (Nov 12-20), trim and cleanup upcoming.
const groups = await fetch(`${M}/rest/v1/estimate_groups?estimate_id=eq.${EST}`).then((r) => r.json());
const g = groups.sort((a, b) => a.sort_order - b.sort_order);
const plan = [["Tear-off & prep", "2026-11-09", "2026-11-11", 3], ["Siding", "2026-11-12", "2026-11-20", 7], ["Trim", "2026-11-23", "2026-11-25", 3], ["Cleanup", "2026-11-30", "2026-11-30", 1]];
const sid = await rpc("schedule_create", { p_estimate_id: EST, p_provisional: false, p: { name: "Siding replacement", calendar: CAL, startDate: "2026-11-09", targetEndDate: null,
  tasks: plan.map(([name, s, e, d], i) => ({ key: `k${i}`, kind: "section", sourceGroupId: g[i % g.length].id, name, plannedStart: s, plannedEnd: e, durationDays: d, sortOrder: i })), deps: [] } });
const camel = (t) => ({ id: t.id, kind: t.kind, sourceGroupId: t.source_group_id, sourceItemId: t.source_item_id, parentId: t.parent_id, splitFrom: t.split_from, name: t.name, sortOrder: t.sort_order,
  plannedStart: t.planned_start, plannedEnd: t.planned_end, durationDays: t.duration_days, actualStart: t.actual_start, actualFinish: t.actual_finish, percentComplete: t.percent_complete, status: t.status, weight: t.weight, assignee: t.assignee, notes: t.notes });
async function edit(fn) {
  const s = await rpc("schedule_get", { p_schedule_id: sid });
  await rpc("schedule_save", { p_schedule_id: sid, p_base_revision: s.schedule.revision, p: { summary: "walk edit", tasks: s.tasks.map((t) => fn(camel(t))) } });
}
await edit((t) => t.name === "Tear-off & prep" ? { ...t, status: "complete", percentComplete: 100, actualStart: "2026-11-09", actualFinish: "2026-11-11", notes: "PRIVATE: crew cost $1,850", assignee: "Bob Crew" }
  : t.name === "Siding" ? { ...t, status: "in_progress", percentComplete: 40, actualStart: "2026-11-12", notes: "PRIVATE: margin 22%" } : t);

const browser = await chromium.launch();
const errors = [];
async function open(path, vp = { width: 1360, height: 1000 }, auth = true) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, acceptDownloads: true });
  if (auth) await ctx.addCookies([authCookie]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${A}${path}`, { waitUntil: "load" });
  await page.waitForTimeout(2500);
  if (await page.getByTestId("unlocked-modal").count()) { await page.getByRole("button", { name: "Maybe Later" }).click(); await page.waitForTimeout(300); }
  return { ctx, page };
}
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const dismiss = async (page) => { if (await page.getByTestId("unlocked-modal").count()) { await page.getByRole("button", { name: "Maybe Later" }).click(); await page.waitForTimeout(300); } };
const previewReady = async (page) => { await page.waitForTimeout(500); await dismiss(page); await page.getByTestId("report-view").waitFor(); await page.waitForFunction(() => !document.querySelector('[aria-label="Updating preview"]')); };

// 1. Schedule page -> Preview customer update. Edits so far are internal.
let link1;
{
  const { ctx, page } = await open(`/projects/${sid}`);
  check("schedule page offers Preview customer update", await page.getByTestId("customer-update").isVisible());
  await page.getByTestId("updates-button").click();
  check("no customer updates yet; edits stay internal", (await page.getByText("No updates published yet.").count()) === 1);
  await page.getByTestId("customer-update").click();
  await page.getByTestId("update-composer").waitFor();
  await previewReady(page);
  const view = page.getByTestId("report-view");
  const text = await view.innerText();
  check("preview shows the overall progress from % complete", (await page.getByTestId("report-progress").innerText()).trim() === "41%");
  check("preview groups completed, current and upcoming work", /Current work/.test(text) && /Completed/.test(text) && /Upcoming/.test(text));
  check("completed work shows its recorded finish", /Completed Nov 11, 2026/.test(text));
  check("preview never shows private notes, assignees or costs", !/PRIVATE|Bob Crew|\$\d|margin/i.test(text));
  check("scope and line items are off by default", !/Scope:/.test(text) && !(await page.getByTestId("opt-showTaskDetails").isChecked()));
  check("publish is blocked until the preview is confirmed", await page.getByTestId("publish-update").isDisabled());
  await page.getByTestId("opt-showScope").check();
  const firstScope = page.locator('[data-testid^="scope-"]').nth(1);
  await firstScope.check();
  await page.getByTestId("opt-notes").fill("Siding is going up on the north and east walls. Trim starts Monday the 23rd.");
  await previewReady(page);
  const t2 = await view.innerText();
  check("scope summary shows only for the section turned on", (t2.match(/Scope:/g) ?? []).length === 1);
  check("progress notes appear exactly as written", t2.includes("Trim starts Monday the 23rd."));
  await page.screenshot({ path: `${dir}/composer-desktop.png`, fullPage: true });
  await page.getByTestId("confirm-preview").check();
  await page.getByTestId("publish-update").click();
  await page.getByTestId("update-delivery").waitFor();
  check("publishing says nothing was sent yet", (await page.getByText("Nothing has been sent yet.").count()) === 1);
  const pdf = await page.request.get(A + await page.getByTestId("update-pdf").getAttribute("href"));
  check("customer update PDF downloads", pdf.status() === 200 && pdf.headers()["content-type"] === "application/pdf");
  await page.getByTestId("update-create-link").click();
  await page.getByTestId("update-link").waitFor();
  link1 = await page.getByTestId("update-link").inputValue();
  check("secure link created", /\/updates\/[A-Za-z0-9_-]{43}$/.test(link1));
  await page.screenshot({ path: `${dir}/published-share-desktop.png`, fullPage: true });
  await ctx.close();
}

// 2. Customer opens the link (no account): same content, mobile friendly, PDF available.
const path1 = new URL(link1).pathname;
for (const w of [390, 320]) {
  const { ctx, page } = await open(path1, { width: w, height: 860 }, false);
  check(`${w}px customer page shows the update`, await page.getByTestId("report-view").isVisible());
  check(`${w}px customer page has no horizontal scroll`, await noHScroll(page));
  if (w === 390) {
    const t = await page.getByTestId("report-view").innerText();
    check("customer page has the approved notes and no private data", t.includes("Trim starts Monday the 23rd.") && !/PRIVATE|Bob Crew|\$\d/.test(t));
    const pdf = await page.request.get(A + await page.getByRole("link", { name: "Download PDF" }).getAttribute("href"));
    check("customer can download the PDF", pdf.status() === 200);
    await page.screenshot({ path: `${dir}/customer-link-mobile.png`, fullPage: true });
  }
  await ctx.close();
}

// 3. Siding slips 3 days; the next update identifies it. The first update stays frozen.
await edit((t) => t.name === "Siding" ? { ...t, plannedEnd: "2026-11-25", durationDays: 10, status: "delayed" } : t.name === "Trim" ? { ...t, plannedStart: "2026-11-26", plannedEnd: "2026-12-01" } : t.name === "Cleanup" ? { ...t, plannedStart: "2026-12-02", plannedEnd: "2026-12-02" } : t);
{
  const { ctx, page } = await open(`/projects/${sid}/update`);
  await previewReady(page);
  const t = await page.getByTestId("report-view").innerText();
  check("slip is identified: finish moved later, was Nov 20, now Nov 25", t.includes("Finish moved later: was Nov 20, now Nov 25."));
  check("revised forecast with the previous one", (await page.getByTestId("report-forecast").innerText()).includes("Dec 2, 2026") && (await page.getByTestId("report-previous-forecast").innerText()).includes("Nov 30, 2026"));
  check("delayed work is labelled Delayed, not complete", /Delayed/.test(t));
  await page.screenshot({ path: `${dir}/composer-slip-desktop.png`, fullPage: true });
  await page.getByTestId("confirm-preview").check();
  await page.getByTestId("opt-showTimeline").uncheck();
  check("changing an option needs a fresh confirmation", !(await page.getByTestId("confirm-preview").isChecked()));
  await page.getByTestId("opt-showTimeline").check();
  await previewReady(page);
  await page.getByTestId("confirm-preview").check();
  await page.getByTestId("publish-update").click();
  await page.getByTestId("update-delivery").waitFor();
  check("second update is numbered 2", (await page.getByText("Update 2 published").count()) === 1);
  await ctx.close();
}
{
  const { ctx, page } = await open(path1, { width: 390, height: 860 }, false);
  const t = await page.getByTestId("report-view").innerText();
  check("the first update's link still shows its frozen copy", (await page.getByTestId("report-forecast").innerText()).includes("Nov 30, 2026") && !t.includes("Finish moved later"));
  await ctx.close();
}

// 4. History and revoking the link.
{
  const { ctx, page } = await open(`/projects/${sid}`);
  await page.getByTestId("updates-button").click();
  check("history lists both updates, newest first", (await page.getByTestId("publication-2").count()) === 1 && (await page.getByTestId("publication-1").count()) === 1);
  check("history records what was done, never 'delivered'", (await page.getByTestId("publication-1").innerText()).includes("Secure link created") && !/delivered/i.test(await page.getByTestId("updates-panel").innerText()));
  check("link opens are shown", (await page.getByTestId("publication-1").innerText()).includes("Link opened"));
  await page.getByTestId("updates-panel").screenshot({ path: `${dir}/history-desktop.png` });
  await page.getByTestId("publication-1").getByRole("link", { name: "View" }).click();
  await page.getByTestId("published-update").waitFor();
  await page.getByTestId("update-revoke").click();
  await page.getByText("The link is turned off.").waitFor();
  await ctx.close();
}
{
  const { ctx, page } = await open(path1, { width: 390, height: 860 }, false);
  check("a turned-off link no longer shows the update", (await page.getByText("This link is no longer active").count()) === 1 && (await page.getByTestId("report-view").count()) === 0);
  await page.screenshot({ path: `${dir}/customer-link-revoked-mobile.png`, fullPage: true });
  await ctx.close();
}

// 5. Mobile composer.
for (const w of [390, 320]) {
  const { ctx, page } = await open(`/projects/${sid}/update`, { width: w, height: 860 });
  check(`${w}px composer: no horizontal scroll`, await noHScroll(page));
  await page.getByTestId("tab-preview").click();
  await previewReady(page);
  check(`${w}px composer: preview tab shows the report`, await page.getByTestId("report-view").isVisible());
  check(`${w}px composer: still no horizontal scroll`, await noHScroll(page));
  if (w === 390) await page.screenshot({ path: `${dir}/composer-mobile.png`, fullPage: true });
  await ctx.close();
}

// 6. View-only: sees history, can't publish.
await pm({ canEdit: false, addon: false });
{
  const { ctx, page } = await open(`/projects/${sid}/update`);
  check("view-only users are sent back to the schedule", /\/projects\/[0-9a-f-]{36}$/.test(page.url()));
  await page.getByTestId("updates-button").click();
  check("view-only users see the history without publishing", (await page.getByTestId("publication-1").count()) === 1 && (await page.getByText("New customer update").count()) === 0);
  await ctx.close();
}
await pm({});

await browser.close();
console.log(out.join("\n"));
console.log(errors.length ? `page errors:\n${errors.join("\n")}` : "no page errors");
process.exit(out.some((l) => l.startsWith("✗")) || errors.length ? 1 : 0);
