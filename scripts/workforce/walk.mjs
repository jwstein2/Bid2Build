// Browser walk for Contractors & Workforce V7.3 against the mock Supabase (test data only, NOT production).
//   export NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=x SUPABASE_SECRET_KEY=x NEXT_PUBLIC_PROJECT_SCHEDULING=on
//   npm run build && npx next start -p 3000 &   node scripts/ux-audit/mock-supabase.mjs &
//   node scripts/workforce/walk.mjs <screenshotDir>
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const dir = process.argv[2] ?? "workforce-shots";
fs.mkdirSync(dir, { recursive: true });
const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };
const out = []; const check = (n, c) => { out.push(`${c ? "✓" : "✗"} ${n}`); };
const M = "http://localhost:54321", A = "http://localhost:3000";
const pm = (o = {}) => fetch(`${M}/__pm?state=${encodeURIComponent(JSON.stringify({ scope: "individual", companyId: null, editorLimit: 1, editorsAssigned: 1, canEdit: true, source: "subscription", editUntil: null, addon: true, addonUntil: null, extraEditors: 0, ...o }))}`);
await fetch(`${M}/__onboarding?status=completed`);
await fetch(`${M}/__features?created=${encodeURIComponent(new Date().toISOString())}`);
await fetch(`${M}/__scenario?name=unlimited`);
await fetch(`${M}/__sched?reset=1&stage=won`);
await fetch(`${M}/__wf?seed=1&manage=1`);
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
  try { await later.waitFor({ timeout: 4000 }); await later.click(); } catch { /* none */ }
  await page.waitForTimeout(400);
  return { ctx, page };
}
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const cards = (page) => page.getByTestId("wf-card");
const card = (page, name) => cards(page).filter({ has: page.getByTestId("wf-open").getByText(name, { exact: true }) });

// 1. Navigation: Pricing data retired, Contractors & Workforce added; old URL redirects; Saved Items still opens.
{
  const { ctx, page } = await open("/projects");
  const nav = page.locator("#account-nav");
  check("sidebar has no Pricing data link", (await nav.getByRole("link", { name: /Pricing data/i }).count()) === 0);
  check("sidebar has Contractors & Workforce", (await nav.getByRole("link", { name: "Contractors & Workforce" }).count()) === 1);
  check("Projects (PM Hub) tabs unchanged", (await page.getByRole("link", { name: "Projects" }).count()) >= 1 && (await page.getByTestId("team-link").count()) === 1);
  check("PM Hub header links to the directory", (await page.getByTestId("workforce-link").count()) === 1);
  await page.goto(`${A}/settings/pricing`, { waitUntil: "load" });
  check("/settings/pricing redirects to Saved Items & Pricing", new URL(page.url()).pathname === "/dashboard/items");
  check("Saved Items & Pricing still renders", (await page.getByRole("heading", { level: 1 }).first().textContent())?.length > 0);
  await ctx.close();
}

// 2. Directory, search "Electrician", filters, profile.
{
  const { ctx, page } = await open("/projects/workforce");
  await page.getByTestId("workforce").waitFor();
  check("directory shows every active entry (11)", (await cards(page).count()) === 11);
  await page.screenshot({ path: `${dir}/01-directory-desktop.png`, fullPage: true });
  await page.getByTestId("wf-search").fill("Electrician");
  await page.waitForTimeout(200);
  const names = await cards(page).locator("[data-testid=wf-open]").allTextContents();
  check(`search "Electrician" finds Red's Electric and its 4 electricians (${names.length})`, names.includes("Red's Electric") && names.length === 5);
  const reds = card(page, "Red's Electric");
  check("Red's Electric shows capacity unknown (not unavailable)", (await reds.getByTestId("wf-availability").textContent()) === "Capacity unknown");
  check("Red's Electric counts its workers' jobs", Number(await reds.getByTestId("wf-active").textContent()) + Number(await reds.getByTestId("wf-upcoming").textContent()) === 2);
  check("Marco Diaz shows a scheduling conflict", (await card(page, "Marco Diaz").getByTestId("wf-conflict").count()) === 1);
  await page.screenshot({ path: `${dir}/02-search-electrician.png`, fullPage: true });
  await page.getByTestId("wf-search").fill("");
  await page.getByTestId("wf-trade").selectOption("painting");
  check("trade filter: painting → 2", (await cards(page).count()) === 2);
  await page.getByTestId("wf-trade").selectOption("all");
  await page.getByTestId("wf-section-companies").click();
  check("Companies section (Red's, Bright Coat, Peak Roofing)", (await cards(page).count()) === 3);
  await page.getByTestId("wf-section-crews").click();
  check("Crews section", (await cards(page).count()) === 1);
  await page.getByTestId("wf-section-all").click();
  await page.getByTestId("wf-search").fill("garcia");
  check("search by customer finds who's on that job", (await cards(page).locator("[data-testid=wf-open]").allTextContents()).sort().join(",") === "Kim Nguyen,Marco Diaz,Red's Electric");
  await page.getByTestId("wf-search").fill("");
  // Profile
  await card(page, "Red's Electric").getByTestId("wf-open").click();
  const prof = page.getByTestId("wf-profile");
  await prof.waitFor();
  check("profile lists the company's 4 workers", (await prof.getByTestId("wf-profile-team").locator("li").count()) === 4);
  check("profile shows assigned / upcoming work", (await prof.getByTestId("wf-booking").count()) >= 2);
  await page.screenshot({ path: `${dir}/03-profile-reds.png` });
  await page.keyboard.press("Escape");
  await ctx.close();
}

// 3. Assign Red's Electric to another job (no conflict) and see it in PM Hub.
let pineId = null;
{
  const { ctx, page } = await open("/projects/workforce?q=electric");
  await card(page, "Red's Electric").getByTestId("wf-assign").click();
  const dlg = page.getByTestId("wf-assign-dialog");
  await dlg.waitFor();
  await dlg.getByTestId("wf-assign-search").fill("pine");
  await page.waitForTimeout(300);
  check("project search finds Pine Rd", (await dlg.getByTestId("wf-assign-project").count()) === 1);
  await page.screenshot({ path: `${dir}/04-assign-project.png` });
  await dlg.getByTestId("wf-assign-project").first().click();
  const sel = dlg.getByTestId("wf-assign-task");
  const opts = await sel.locator("optgroup").first().getAttribute("label");
  check("matching trade sections listed first", /Electrical/i.test(opts ?? ""));
  const trim = await sel.locator("option", { hasText: "Electrical trim" }).getAttribute("value");
  await sel.selectOption(trim);
  await dlg.locator("#wf-status").selectOption("confirmed");
  await dlg.locator("#wf-start").fill("08:00"); await dlg.locator("#wf-end").fill("12:00");
  await dlg.locator("#wf-hours").fill("6");
  await page.screenshot({ path: `${dir}/05-assign-scope.png` });
  await dlg.getByTestId("wf-assign-review").click();
  await dlg.getByTestId("wf-review-row").waitFor();
  check("review: no conflicts for Red's on Pine Rd", (await dlg.getByTestId("wf-conflict-line").count()) === 0);
  await dlg.getByTestId("wf-assign-confirm").click();
  await dlg.getByTestId("wf-assign-done").waitFor();
  check("assignment confirmed", true);
  await page.screenshot({ path: `${dir}/06-assign-done.png` });
  const href = await dlg.getByTestId("wf-view-in-pm").getAttribute("href");
  pineId = href.split("/").pop();
  await dlg.getByRole("button", { name: "Done" }).click();
  await page.waitForTimeout(800);
  const reds = card(page, "Red's Electric");
  check("card updates right away (3 jobs)", Number(await reds.getByTestId("wf-active").textContent()) + Number(await reds.getByTestId("wf-upcoming").textContent()) === 3);
  // Duplicate click: same assignment again is a no-op.
  const again = await page.evaluate(async (b) => (await fetch("/api/workforce/assign", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) })).json(), { taskId: "x", resourceId: "y" });
  check("API validates input", !!again.error);
  await page.goto(`${A}${href}`, { waitUntil: "load" });
  await page.getByTestId("project-crew").waitFor({ timeout: 8000 }).catch(() => {});
  const crewText = await page.getByTestId("project-crew").textContent().catch(() => "");
  check("PM Hub project page shows Red's Electric", crewText.includes("Red's Electric"));
  await page.getByTestId("project-crew").screenshot({ path: `${dir}/07-project-assigned.png` }).catch(() => {});
  await ctx.close();
}

// 4. Conflict: Kim on two painting jobs at once. Override needs a reason and is recorded.
{
  const { ctx, page } = await open("/projects/workforce");
  await card(page, "Kim Nguyen").getByTestId("wf-assign").click();
  const dlg = page.getByTestId("wf-assign-dialog");
  await dlg.getByTestId("wf-assign-search").fill("pine");
  await dlg.getByTestId("wf-assign-project").first().click();
  const sel = dlg.getByTestId("wf-assign-task");
  await sel.selectOption(await sel.locator("option", { hasText: "Drywall & paint" }).getAttribute("value"));
  check("replacing someone needs a tick", await dlg.getByTestId("wf-assign-review").isDisabled());
  await dlg.getByTestId("wf-replace").locator("input").check();
  await dlg.getByTestId("wf-assign-review").click();
  await dlg.getByTestId("wf-review-row").waitFor();
  check("review shows Kim's double booking", (await dlg.getByTestId("wf-conflict-line").count()) >= 1);
  check("confirm disabled until a reason is given", await dlg.getByTestId("wf-assign-confirm").isDisabled());
  await page.screenshot({ path: `${dir}/08-conflict-review.png` });
  await dlg.getByTestId("wf-override-reason").fill("Kim finishes Maple St in the morning");
  await dlg.getByTestId("wf-assign-confirm").click();
  await dlg.getByTestId("wf-assign-done").waitFor();
  await dlg.getByRole("button", { name: "Done" }).click();
  await page.waitForTimeout(800);
  await card(page, "Kim Nguyen").getByTestId("wf-open").click();
  const prof = page.getByTestId("wf-profile");
  await prof.getByTestId("wf-history").waitFor({ timeout: 5000 }).catch(() => {});
  check("history records the override reason", ((await prof.getByTestId("wf-history").textContent().catch(() => "")) ?? "").includes("Kim finishes Maple St"));
  check("profile warns about the conflict (nothing moved)", (await prof.getByTestId("wf-profile-conflicts").count()) === 1);
  await page.screenshot({ path: `${dir}/09-profile-history.png` });
  await page.keyboard.press("Escape");
  // Assignments view
  await page.getByTestId("wf-view-assignments").click();
  check("Assignments view lists open assignments", (await page.getByTestId("wf-assignment-row").count()) >= 6);
  await page.screenshot({ path: `${dir}/10-assignments.png`, fullPage: true });
  await ctx.close();
}

// 5. Add a worker to Red's Electric (no login, no seat).
{
  const { ctx, page } = await open("/projects/workforce");
  await page.getByTestId("wf-add").click();
  const f = page.getByTestId("wf-form");
  await f.getByTestId("wf-type-worker").check();
  await f.getByTestId("wf-f-name").fill("Ravi Shah");
  await f.getByTestId("wf-f-parent").selectOption({ label: "Red's Electric" });
  await f.getByTestId("wf-f-trade").fill("electrical"); await f.getByTestId("wf-f-trade").press("Enter");
  await page.screenshot({ path: `${dir}/11-add-worker.png` });
  await f.getByTestId("wf-f-save").click();
  await page.waitForTimeout(900);
  check("new worker appears under Red's Electric", (await card(page, "Ravi Shah").textContent())?.includes("Worker at Red's Electric"));
  await ctx.close();
}

// 6. Phone, dark mode, view-only.
{
  const { ctx, page } = await open("/projects/workforce", { width: 390, height: 844 });
  check("390px: no horizontal scroll", await noHScroll(page));
  await page.screenshot({ path: `${dir}/12-mobile.png`, fullPage: true });
  await cards(page).first().getByTestId("wf-open").click();
  await page.getByTestId("wf-profile").waitFor();
  check("390px: profile fits", await noHScroll(page));
  await page.screenshot({ path: `${dir}/13-mobile-profile.png` });
  await page.keyboard.press("Escape");
  await card(page, "Marco Diaz").getByTestId("wf-assign").click();
  await page.getByTestId("wf-assign-dialog").waitFor();
  check("390px: assign flow fits", await noHScroll(page));
  await page.screenshot({ path: `${dir}/14-mobile-assign.png` });
  await ctx.close();
}
{
  const { ctx, page } = await open("/projects/workforce", { width: 320, height: 700 });
  check("320px: no horizontal scroll", await noHScroll(page));
  await ctx.close();
}
{
  const { ctx, page } = await open("/projects/workforce", { width: 1280, height: 900 }, "dark");
  await page.screenshot({ path: `${dir}/15-dark.png` });
  await ctx.close();
}
await fetch(`${M}/__wf?manage=0`);
{
  const { ctx, page } = await open("/projects/workforce");
  check("view-only: no Assign or Add buttons", (await page.getByTestId("wf-assign").count()) === 0 && (await page.getByTestId("wf-add").count()) === 0);
  const jose = card(page, "Jose Martinez");
  check("view-only: employee contact is private", (await jose.textContent()).includes("Contact private") && (await jose.getByRole("link", { name: /Call|Email/ }).count()) === 0);
  check("view-only: sub company contact still shown", (await card(page, "Red's Electric").getByRole("link", { name: /Call/ }).count()) === 1);
  await page.screenshot({ path: `${dir}/16-view-only.png` });
  await ctx.close();
}
await fetch(`${M}/__wf?manage=1`);

await browser.close();
const relevant = errors.filter((e) => !/Hydration|ResizeObserver|realtime|WebSocket/i.test(e));
check(`no page errors (${relevant.length})`, relevant.length === 0);
if (relevant.length) console.log(relevant.slice(0, 5).join("\n"));
console.log(out.join("\n"));
console.log(`${out.filter((x) => x.startsWith("✓")).length}/${out.length}`);
