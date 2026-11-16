// Browser walk for Team & Subcontractors V4.2 against the mock Supabase (test data only, NOT production).
//   build with NEXT_PUBLIC_PROJECT_SCHEDULING=on, `next start`, node scripts/ux-audit/mock-supabase.mjs
//   node scripts/projects/team-walk.mjs <screenshotDir>
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const dir = process.argv[2] ?? "team-shots";
fs.mkdirSync(dir, { recursive: true });
const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };
const out = []; const check = (n, c) => out.push(`${c ? "✓" : "✗"} ${n}`);
const M = "http://localhost:54321", A = "http://localhost:3000";
const EST = "11111111-1111-4111-8111-111111111111";
const pm = (o = {}) => fetch(`${M}/__pm?state=${encodeURIComponent(JSON.stringify({ scope: "individual", companyId: null, editorLimit: 1, editorsAssigned: 1, canEdit: true, source: "subscription", editUntil: null, addon: true, addonUntil: null, extraEditors: 0, ...o }))}`);
await fetch(`${M}/__onboarding?status=completed`);
await fetch(`${M}/__features?created=${encodeURIComponent(new Date().toISOString())}`);
await fetch(`${M}/__scenario?name=unlimited`);
await fetch(`${M}/__sched?reset=1&stage=won`);
await fetch(`${M}/__ws?seed=1`);
await fetch(`${M}/__team?reset=1&seed=1&manage=1`);
await pm();
const browser = await chromium.launch();
const errors = [];
async function open(path, vp = { width: 1440, height: 1000 }, theme = null) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 });
  await ctx.addCookies([authCookie]);
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: A });
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

// 1. Directory
{
  const { ctx, page } = await open("/projects");
  check("Projects links to Team & Subcontractors", (await page.getByTestId("team-link").count()) === 1);
  await page.getByTestId("team-link").click();
  await page.getByTestId("team-directory").waitFor();
  check("directory lists staff, subcontractors and crews", (await page.getByTestId("team-card").count()) === 6);
  check("crew shows its members", (await page.getByTestId("team-card").filter({ hasText: "Crew A" }).textContent()).includes("Members: Jose Martinez"));
  check("linked staff marked as you", (await page.getByTestId("team-card").filter({ hasText: "Alex Rivera" }).textContent()).includes("You"));
  await page.screenshot({ path: `${dir}/team-desktop.png`, fullPage: true });
  await page.getByTestId("team-search").fill("countertop");
  check("search by trade", (await page.getByTestId("team-card").count()) === 1);
  await page.getByTestId("copy-email").first().click();
  check("copy email (no sending)", (await page.evaluate(() => navigator.clipboard.readText())) === "sam@stoneworks.test");
  await page.getByTestId("team-search").fill("");
  await page.getByTestId("team-add").click();
  await page.getByTestId("kind-subcontractor").check({ force: true });
  await page.getByTestId("res-name").fill("Bright Electric");
  await page.getByTestId("res-trade").fill("Electrical"); await page.getByTestId("res-trade").press("Enter");
  await page.getByTestId("res-email").fill("office@bright.test");
  await page.screenshot({ path: `${dir}/team-add-desktop.png`, fullPage: false });
  await page.getByTestId("res-save").click();
  await page.getByText("Bright Electric saved.").waitFor({ timeout: 5000 });
  await page.getByTestId("team-card").filter({ hasText: "Bright Electric" }).waitFor({ timeout: 5000 }).catch(() => {});
  check("add a subcontractor (no login created)", (await page.getByTestId("team-card").filter({ hasText: "Bright Electric" }).count()) === 1);
  await ctx.close();
}

// 2. Assign from the task drawer, with trade-aware suggestions and a draft notice
{
  const { ctx, page } = await open("/projects?view=calendar");
  await page.getByTestId("cal-agenda").click();
  await page.getByTestId("agenda-item").filter({ hasText: "Countertops" }).first().click();
  await page.getByTestId("assign-panel").waitFor();
  const groups = await page.getByTestId("assign-select").locator("optgroup").evaluateAll((g) => g.map((x) => x.label));
  check("drawer suggests by trade first", groups[0]?.startsWith("Suggested") && (await page.getByTestId("assign-select").locator("optgroup").first().textContent()).includes("Stone Works"));
  await page.getByTestId("assign-select").selectOption({ label: "Stone Works" });
  await page.getByTestId("assign-status").selectOption("confirmed");
  check("draft notice opens your own email app (mailto)", ((await page.getByTestId("assign-mailto").getAttribute("href")) ?? "").startsWith("mailto:sam%40stoneworks.test"));
  await page.screenshot({ path: `${dir}/drawer-assign-desktop.png` });
  await page.getByTestId("assign-save").click();
  await page.getByText("Assignment saved").waitFor({ timeout: 5000 });
  check("assignment saved; nothing sent", (await page.getByText("Nothing was sent").count()) === 1);
  await page.keyboard.press("Escape");
  await page.getByTestId("tab-workload").click();
  await page.getByTestId("view-workload").waitFor();
  await page.waitForTimeout(800);
  const row = page.getByTestId("workload-row").filter({ hasText: "Stone Works" });
  check("workload shows the directory assignment", (await row.count()) === 1 && (await row.textContent()).includes("Subcontractor"));
  await page.screenshot({ path: `${dir}/workload-desktop.png`, fullPage: true });
  await ctx.close();
}

// 3. Customer report: names only by default, contact info only when chosen
{
  const { ctx, page } = await open("/projects");
  await page.getByTestId("project-card").filter({ hasText: "Kitchen Remodel" }).getByRole("link", { name: "Kitchen Remodel – Ortiz" }).click();
  await page.getByTestId("project-summary").waitFor();
  const id = new URL(page.url()).pathname.split("/")[2];
  await page.goto(`${A}/projects/${id}/update`, { waitUntil: "load" });
  await page.getByTestId("opt-assignees").waitFor();
  check("report option defaults to names only", (await page.getByTestId("opt-assignees").inputValue()) === "names");
  await page.getByTestId("report-assigned").first().waitFor({ timeout: 6000 }).catch(() => {});
  const line = await page.getByTestId("report-assigned").first().textContent().catch(() => "");
  check("preview shows who's doing it, without contact info", line.includes("Stone Works") && !line.includes("555"));
  await page.getByTestId("opt-assignees").selectOption("names_contacts");
  await page.waitForTimeout(1500);
  check("contact info only after opting in", ((await page.getByTestId("report-assigned").first().textContent()) ?? "").includes("555-0110"));
  await page.getByTestId("opt-assignees").selectOption("hidden");
  await page.waitForTimeout(1500);
  check("can hide who's doing the work", (await page.getByTestId("report-assigned").count()) === 0);
  await page.screenshot({ path: `${dir}/update-assignees-desktop.png`, fullPage: true });
  await ctx.close();
}

// 4. Schedule Now: assign step with suggestions and quick add
{
  const { ctx, page } = await open(`/projects/new?estimate=${EST}`);
  await page.getByTestId("schedule-wizard").waitFor();
  for (let i = 0; i < 7; i++) await page.getByTestId("wizard-next").click();
  await page.getByTestId("assign-step").waitFor();
  check("wizard has an Assign who's doing the work step", (await page.getByText("Assign who's doing the work").count()) === 1);
  const sel = page.getByTestId("assign-step-select").first();
  await sel.selectOption({ label: "Crew A" });
  await page.getByTestId("assign-step-add").nth(1).click();
  await page.getByTestId("res-name").fill("Quick Sub LLC");
  await page.getByTestId("res-save").click();
  await page.waitForTimeout(800);
  check("quick add selects the new contact", (await page.getByTestId("assign-step-select").nth(1).locator("option:checked").textContent()) === "Quick Sub LLC");
  await page.screenshot({ path: `${dir}/wizard-assign-desktop.png`, fullPage: true });
  let assignBody = null;
  page.on("request", (r) => { if (/\/api\/projects\/[^/]+\/assign$/.test(r.url())) assignBody = JSON.parse(r.postData()); });
  await page.getByTestId("wizard-next").click();
  await page.getByTestId("save-schedule").click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}\?created=1/, { timeout: 15000 }).catch(() => {});
  check("saving assigns the sections in one call (no notices sent)", Boolean(assignBody && assignBody.items.length === 2));
  check("wizard lands on the project without an assignment error", !page.url().includes("assign=failed"));
  await ctx.close();
}

// 5. View-only: no assign controls, directory read-only
await pm({ canEdit: false, addon: false });
await fetch(`${M}/__team?manage=0`);
{
  const { ctx, page } = await open("/projects/team");
  check("view-only: no Add button", (await page.getByTestId("team-add").count()) === 0);
  await page.goto(`${A}/projects?view=timeline`, { waitUntil: "load" });
  await page.locator("[data-testid^=tl-bar-]").first().click();
  await page.getByTestId("task-drawer").waitFor();
  check("view-only: drawer has no assignment controls", (await page.getByTestId("assign-panel").count()) === 0);
  await ctx.close();
}
await pm();
await fetch(`${M}/__team?manage=1`);

// 6. Phones and themes
for (const [name, vp] of [["m390", { width: 390, height: 844 }], ["m320", { width: 320, height: 720 }]]) {
  const { ctx, page } = await open("/projects/team", vp);
  await page.getByTestId("team-directory").waitFor();
  check(`${name}: directory has no horizontal scroll`, await noHScroll(page));
  await page.screenshot({ path: `${dir}/team-${name}.png`, fullPage: true });
  await page.goto(`${A}/projects?view=calendar`, { waitUntil: "load" });
  await page.getByTestId("agenda-item").first().click();
  await page.getByTestId("assign-panel").waitFor();
  check(`${name}: assign from the drawer without dragging`, (await page.getByTestId("assign-select").count()) === 1 && await noHScroll(page));
  await page.screenshot({ path: `${dir}/drawer-assign-${name}.png` });
  await ctx.close();
}
for (const theme of ["dark", "black"]) {
  const { ctx, page } = await open("/projects/team", { width: 1280, height: 900 }, theme);
  await page.getByTestId("team-directory").waitFor();
  check(`${theme}: theme applied`, (await page.evaluate(() => document.documentElement.dataset.theme)) === theme);
  await page.screenshot({ path: `${dir}/team-${theme}.png`, fullPage: true });
  await ctx.close();
}

await browser.close();
console.log(out.join("\n"));
console.log(errors.length ? `page errors:\n${errors.join("\n")}` : "no page errors");
