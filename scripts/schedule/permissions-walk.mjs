// Browser walk for V4 Phase 9 (Enterprise PM permissions and seat reassignment).
// Local build against the mock Supabase with test data only (NOT production).
//   NEXT_PUBLIC_PROJECT_SCHEDULING=on npm run build && next start
//   MOCK_UNLIMITED=1 node scripts/ux-audit/mock-supabase.mjs &
//   node scripts/schedule/permissions-walk.mjs <screenshotDir>
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const dir = process.argv[2] ?? "pm-permissions-shots";
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


const groups = await fetch(`${M}/rest/v1/estimate_groups?estimate_id=eq.${EST}`).then((r) => r.json());
const g = groups.sort((a, b) => a.sort_order - b.sort_order);
const plan = [["Tear-off & prep", "2026-11-09", "2026-11-11", 3], ["Siding", "2026-11-12", "2026-11-20", 7], ["Trim", "2026-11-23", "2026-11-25", 3]];
const sid = await rpc("schedule_create", { p_estimate_id: EST, p_provisional: false, p: { name: "Siding replacement", calendar: CAL, startDate: "2026-11-09", targetEndDate: null,
  tasks: plan.map(([name, s, e, d], i) => ({ key: `k${i}`, kind: "section", sourceGroupId: g[i % g.length].id, name, plannedStart: s, plannedEnd: e, durationDays: d, sortOrder: i })), deps: [] } });

const browser = await chromium.launch();
const errors = [];
async function open(path, vp = { width: 1360, height: 1000 }) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 });
  await ctx.addCookies([authCookie]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${A}${path}`, { waitUntil: "load" });
  await page.waitForTimeout(2500);
  await dismiss(page);
  return { ctx, page };
}
const dismiss = async (page) => { if (await page.getByTestId("unlocked-modal").count()) { await page.getByRole("button", { name: "Maybe Later" }).click(); await page.waitForTimeout(300); } };
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const P = (o) => ({ edit: false, progress: false, dependencies: false, publish: false, pdf: false, ...o });

// 1. Progress-only member (e.g. a field lead): can update status and % complete, nothing else.
await pm({ permissions: P({ progress: true, pdf: true }) });
{
  const { ctx, page } = await open(`/projects/${sid}`);
  check("progress-only notice shown", await page.getByTestId("progress-only").isVisible());
  check("no Preview customer update link without Publish", (await page.getByTestId("customer-update").count()) === 0);
  check("Mark active offered (schedule status is progress)", (await page.getByRole("button", { name: "Mark active" }).count()) === 1);
  check("drag hint hidden without edit permission", (await page.getByText("Drag a bar to move it").count()) === 0);
  await page.getByTestId("list-view").click();
  await page.getByRole("button", { name: "Edit" }).nth(1).click();
  await page.getByTestId("task-dialog").waitFor();
  check("dates locked, progress fields open", await page.getByTestId("planned-start").isDisabled() && await page.getByTestId("duration").isDisabled() && !(await page.getByTestId("status").isDisabled()) && !(await page.getByTestId("percent").isDisabled()));
  check("no split, remove or add-dependency controls", (await page.getByTestId("split").count()) === 0 && (await page.getByTestId("add-dependency").count()) === 0 && (await page.getByTestId("open-shift").count()) === 0);
  await page.getByTestId("status").selectOption("in_progress");
  await page.getByTestId("percent").fill("35");
  await page.screenshot({ path: `${dir}/01-progress-only-task.png` });
  await page.getByTestId("save-task").click();
  await page.waitForTimeout(1500);
  const s = await rpc("schedule_get", { p_schedule_id: sid });
  check("progress update saved", s.tasks.some((t) => t.name === "Siding" && t.percent_complete === 35 && t.status === "in_progress"));
  check("no error after saving progress", (await page.locator('[class*="danger"]').count()) === 0);
  const t = s.tasks.find((x) => x.name === "Siding");
  const body = { baseRevision: s.schedule.revision, summary: "x", deps: [], tasks: s.tasks.map((x) => ({ id: x.id, kind: x.kind, sourceGroupId: x.source_group_id, sourceItemId: null, parentId: null, splitFrom: null, name: x.name, sortOrder: x.sort_order,
    plannedStart: x.planned_start, plannedEnd: x.id === t.id ? "2026-11-24" : x.planned_end, durationDays: x.duration_days, actualStart: x.actual_start, actualFinish: x.actual_finish, percentComplete: x.percent_complete, status: x.status, weight: null, assignee: null, notes: null })) };
  const r = await page.request.fetch(`${A}/api/schedules/${sid}`, { method: "PATCH", data: body, headers: { origin: A } });
  check("server refuses a date change (403 forbidden_edit)", r.status() === 403 && (await r.json()).error.code === "forbidden_edit");
  await page.screenshot({ path: `${dir}/02-progress-only-schedule.png`, fullPage: true });
  await ctx.close();
}

// 2. Editor without "Publish customer updates": edits allowed, publishing hidden and refused.
await pm({ permissions: P({ edit: true, progress: true, dependencies: true, pdf: true }) });
{
  const { ctx, page } = await open(`/projects/${sid}`);
  check("editor sees no progress-only notice", (await page.getByTestId("progress-only").count()) === 0);
  check("editor without publish: no customer-update link", (await page.getByTestId("customer-update").count()) === 0);
  await page.goto(`${A}/projects/${sid}/update`, { waitUntil: "load" });
  check("update composer redirects back to the schedule", new URL(page.url()).pathname === `/projects/${sid}`);
  const r = await page.request.post(`${A}/api/schedules/${sid}/updates/preview`, { data: { options: {} }, headers: { origin: A } });
  check("preview API refuses without Publish (403)", r.status() === 403);
  await ctx.close();
}

// 3. Publisher without "Download schedule PDF": shares by link only.
await pm({ permissions: P({ edit: true, progress: true, dependencies: true, publish: true }) });
{
  const s = await rpc("schedule_get", { p_schedule_id: sid });
  const boot = await open(`/projects/${sid}`);
  const made = await boot.page.request.post(`${A}/api/schedules/${sid}/updates`, { data: { options: {}, baseRevision: s.schedule.revision, confirm: true }, headers: { origin: A } });
  check("publishing allowed with Publish customer updates", made.status() === 201 || made.status() === 200);
  const pub = (await made.json()).publication;
  await boot.ctx.close();
  const { ctx, page } = await open(`/projects/${sid}/updates/${pub.id}`);
  check("PDF buttons hidden without Download schedule PDF", (await page.getByTestId("update-pdf").count()) === 0 && (await page.getByTestId("update-delivery").count()) === 1);
  const r = await page.request.get(`${A}/api/schedules/${sid}/updates/${pub.id}/pdf`);
  check("PDF route refuses (403)", r.status() === 403);
  await page.screenshot({ path: `${dir}/03-publisher-no-pdf.png`, fullPage: true });
  await ctx.close();
}

// 4. Enterprise owner: grouped permissions and the seat card (seat type, billing status, reassign, removal warning).
await fetch(`${M}/__scenario?name=enterprise_owner`);
await pm({ scope: "company", companyId: "c", editorLimit: 3, editorsAssigned: 0, source: "stripe", addon: false, extraEditors: 2 });
const M2 = "00000000-0000-4000-8000-000000000002", M3 = "00000000-0000-4000-8000-000000000003";
await rpc("company_pm_assign", { p_user_id: M2, p_assign: true });
await rpc("company_pm_assign", { p_user_id: M3, p_assign: true });
{
  const { ctx, page } = await open("/company/users");
  check("seat card on Users & Permissions", await page.getByTestId("pm-seats").isVisible());
  check("seat types and billing status shown", (await page.getByText("Included with Team", { exact: true }).count()) === 1 && (await page.getByText("Paid editor seat", { exact: true }).count()) === 1 && (await page.getByText("Billed monthly on your Enterprise subscription").count()) === 1);
  check("effective date and last change shown", (await page.getByText(/Effective .* Last change by/).count()) === 2);
  await page.getByRole("button", { name: "Manage" }).nth(1).click();
  check("permissions grouped with scheduling and internal reports", await page.getByTestId("permission-groups").getByText("Project Command Center", { exact: true }).isVisible() && await page.getByTestId("perm-publish_customer_updates").isVisible() && await page.getByTestId("perm-send_internal_reports").isVisible());
  check("seat note explains the seat is also needed", (await page.getByText("Changing a schedule also needs a scheduling editor seat.").count()) >= 1);
  await page.screenshot({ path: `${dir}/04-permission-groups.png`, fullPage: true });
  await page.getByRole("button", { name: "Close" }).click();

  await page.getByTestId(`remove-${M3}`).click();
  const warn = await page.getByTestId("remove-confirm").innerText();
  check("removal warns first: schedules count, view-only, nothing deleted", /2 company schedules/.test(warn) && /view schedules/.test(warn) && /No schedule, task or customer update is deleted/.test(warn));
  await page.screenshot({ path: `${dir}/05-remove-warning.png` });
  await page.getByRole("button", { name: "Keep" }).click();
  check("nothing removed until confirmed", (await fetch(`${M}/rest/v1/rpc/company_pm_seats`, { method: "POST" }).then((r) => r.json())).seats.length === 2);

  await page.getByTestId(`reassign-${M3}`).click();
  await page.getByTestId("reassign-to").selectOption({ label: "Jordan Owner" });
  check("reassign explains no extra charge", (await page.getByTestId("reassign-panel").getByText(/nothing is bought or charged again/).count()) === 1);
  await page.screenshot({ path: `${dir}/06-reassign.png` });
  await page.getByTestId("reassign-confirm").click();
  await page.waitForTimeout(2000);
  const after = await fetch(`${M}/rest/v1/rpc/company_pm_seats`, { method: "POST" }).then((r) => r.json());
  check("seat moved, same count and rank", after.seats.length === 2 && after.seats[1].userId === user.id && after.seats[1].rank === 2 && after.seats[1].seatType === "paid");
  check("success message says billing didn't change", (await page.getByText("Your billed seats didn't change.").count()) === 1);
  await page.screenshot({ path: `${dir}/07-after-reassign.png`, fullPage: true });
  await ctx.close();
}
{
  const { ctx, page } = await open("/company/users", { width: 390, height: 844 });
  check("seat card fits a phone (no sideways scroll)", await page.getByTestId("pm-seats").isVisible() && await noHScroll(page));
  await page.getByTestId("pm-seats").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${dir}/08-seats-mobile.png` });
  await ctx.close();
}
{
  const { ctx, page } = await open("/company/billing");
  check("billing page shows seats for the owner", await page.getByTestId("pm-seats").isVisible());
  await ctx.close();
}

// 5. Estimator member: no seat management on Users & Permissions.
await fetch(`${M}/__scenario?name=enterprise_estimator`);
{
  const { ctx, page } = await open("/company/users");
  check("members without Manage seats don't see the seat card", (await page.getByTestId("pm-seats").count()) === 0);
  await ctx.close();
}

check("no page errors", errors.length === 0);
await browser.close();
console.log(out.join("\n"));
if (errors.length) console.log(errors.slice(0, 5).join("\n"));
process.exit(out.some((l) => l.startsWith("✗")) ? 1 : 0);
