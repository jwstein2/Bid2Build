// Browser walk for the contextual page walkthrough (V5.2): "Feature walkthrough" teaches the page and
// view on screen, without navigating, resetting filters or acting. Local build against the mock
// Supabase (canned test data, NOT production):
//   MOCK_PIPELINE=1 MOCK_ADMIN=1 node scripts/ux-audit/mock-supabase.mjs &
//   NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=x SUPABASE_SECRET_KEY=x \
//     NEXT_PUBLIC_PROJECT_SCHEDULING=on NEXT_PUBLIC_ESIGNATURES=on npm run build && npx next start -p 3000 &
//   node scripts/features/page-guide-walk.mjs <screenshotDir>
// For every walkthrough it checks, at each step: the highlighted control exists, is visible and is the
// one the step names; the card doesn't cover it and stays inside the viewport; no horizontal overflow;
// the URL never changes; typed search text and filters survive; no write requests are made except the
// walkthrough's own completion record; Back, Next, Skip, Close and Escape work.
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium, devices } = createRequire(import.meta.url)("playwright");
const dir = process.argv[2] ?? "page-guide-shots";
fs.mkdirSync(dir, { recursive: true });
const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };
const M = "http://localhost:54321", A = "http://localhost:3000";
const EST = "11111111-1111-4111-8111-111111111111", DECK = "11111111-1111-4111-8111-111111111112";
const results = [];
const check = (n, ok, d = "") => { results.push({ n, ok: Boolean(ok), d }); console.log(`${ok ? "✓" : "✗"} ${n}${d && !ok ? ` — ${d}` : ""}`); };
const scenario = (n) => fetch(`${M}/__scenario?name=${n}`);
const pm = (o = {}) => fetch(`${M}/__pm?state=${encodeURIComponent(JSON.stringify({ scope: "individual", companyId: null, editorLimit: 1, editorsAssigned: 1, canEdit: true, source: "subscription", editUntil: null, addon: true, addonUntil: null, extraEditors: 0, ...o }))}`);
const meta = async () => (await (await fetch(`${M}/auth/v1/user`)).json()).user_metadata?.b2b_features ?? null;
await fetch(`${M}/__onboarding?status=completed`);
await fetch(`${M}/__features`);

const browser = await chromium.launch();
const errors = [];
const FIN = Boolean(process.env.WALK_FINANCIALS);
const VIEWPORTS = { desktop: { viewport: { width: 1440, height: 1000 } }, tablet: { ...devices["iPad Mini"] }, phone: { ...devices["iPhone 13"] } };

async function open(vpName, path, theme = "light") {
  const ctx = await browser.newContext({ ...VIEWPORTS[vpName], deviceScaleFactor: vpName === "desktop" ? 1 : VIEWPORTS[vpName].deviceScaleFactor, reducedMotion: "reduce" });
  await ctx.addCookies([authCookie]);
  // Every context sets its theme explicitly (newest preference wins), so one test's theme never leaks into the next.
  await ctx.addInitScript((m) => { try { localStorage.setItem("b2b-theme", JSON.stringify({ mode: m, at: Date.now() })); } catch {} }, theme);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${path}: ${e.message}`));
  const writes = [];
  page.on("request", (r) => { const u = new URL(r.url()); if (r.method() !== "GET" && u.origin === A) writes.push(`${r.method()} ${u.pathname}`); });
  await page.goto(`${A}${path}`, { waitUntil: "load" });
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await page.evaluate((m) => { if (m === "light") document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", m); }, theme);
  // A freshly upgraded mock account may get "Your New Features Are Ready" once: dismiss it like a person would.
  const modal = page.getByTestId("unlocked-modal");
  if (await modal.waitFor({ timeout: 2500 }).then(() => true, () => false)) { await page.getByRole("button", { name: "Maybe Later" }).click(); await modal.waitFor({ state: "detached" }); }
  return { ctx, page, writes };
}

/** Starts the walkthrough the way a person would on this layout. */
async function start(page, how) {
  if (how === "sidebar-phone") {
    const menu = page.getByRole("button", { name: /^Menu$/ });
    if (await menu.isVisible().catch(() => false)) await menu.click();
    await page.getByTestId("feature-tour-button").click();
  }
  else if (how === "sidebar") await page.getByTestId("feature-tour-button").click();
  else await page.getByTestId("page-guide-button").first().click();
  await page.getByTestId("tour-card").or(page.getByTestId("tour-empty")).first().waitFor({ timeout: 25000 });
  await page.waitForTimeout(250);
}

/** Geometry and visibility of the current step, measured in the page. */
const probe = (page) => page.evaluate(() => {
  const card = document.querySelector("[data-testid='tour-card']");
  const spot = document.querySelector("[data-testid='tour-spotlight']");
  const key = document.querySelector("[data-testid='feature-tour']")?.getAttribute("data-step") ?? null;
  const r = (el) => { const b = el.getBoundingClientRect(); return { top: b.top, left: b.left, right: b.right, bottom: b.bottom, width: b.width, height: b.height }; };
  const c = card ? r(card) : null, s = spot ? r(spot) : null;
  let targetOk = false;
  if (s) {
    // The element at the spotlight's center, under the walkthrough overlay, must be a data-guide control.
    const tour = document.querySelector("[data-testid='feature-tour']");
    // display (not visibility, which is transitioned and lags under reduced motion) takes it out of hit testing at once.
    tour.style.display = "none";
    const hit = document.elementFromPoint(Math.min(Math.max(s.left + s.width / 2, 1), innerWidth - 1), Math.min(Math.max(s.top + s.height / 2, 1), innerHeight - 1));
    tour.style.display = "";
    targetOk = Boolean(hit?.closest("[data-guide]"));
  }
  const overlap = c && s ? Math.max(0, Math.min(c.right, s.right) - Math.max(c.left, s.left)) * Math.max(0, Math.min(c.bottom, s.bottom) - Math.max(c.top, s.top)) : 0;
  return {
    key, title: document.querySelector("#ft-title")?.textContent ?? "", body: document.querySelector("#ft-body")?.textContent ?? "",
    hint: document.querySelector("[data-testid='tour-hint']")?.textContent ?? "",
    progress: document.querySelector("[data-testid='tour-progress']")?.textContent ?? "",
    spot: s, card: c, targetOk,
    // Share of the control the card covers. A control taller than the space beside the card (a phone's KPI
    // grid) can be partly covered at one edge, but never mostly.
    overlapRatio: s ? overlap / Math.max(1, s.width * s.height) : 0,
    cardInView: c ? c.left >= 0 && c.top >= 0 && c.right <= innerWidth + 0.5 && c.bottom <= innerHeight + 0.5 : false,
    overflowX: document.documentElement.scrollWidth - innerWidth,
  };
});

/**
 * Walks every step with Next, checking each one, then Back once, then finishes (or closes). Returns the
 * step titles. `shots` names the before/during/after screenshots.
 */
async function walk(name, page, { how = "sidebar", expectLabel, shots = true, finish = "finish", url } = {}) {
  const before = url ?? page.url();
  if (shots) await page.screenshot({ path: `${dir}/${name}-1-before.png` });
  await start(page, how);
  const titles = [];
  let first = await probe(page);
  check(`${name}: opens on this page's guide (${first.progress})`, expectLabel ? first.progress.startsWith(expectLabel) : first.progress.length > 0, first.progress);
  const total = Number(/of (\d+)/.exec(first.progress)?.[1] ?? 0);
  check(`${name}: has steps to show`, total > 0, first.progress);
  for (let n = 0; n < total; n++) {
    const p = await probe(page);
    titles.push(p.title);
    check(`${name} step ${n + 1} "${p.title}": highlights a real, visible control`, p.spot && p.spot.width > 4 && p.spot.height > 4 && p.targetOk, JSON.stringify(p.spot));
    check(`${name} step ${n + 1}: card stays in view and off the control`, p.cardInView && p.overlapRatio < 0.35, `overlap ${p.overlapRatio.toFixed(2)} card ${JSON.stringify(p.card)}`);
    check(`${name} step ${n + 1}: no horizontal overflow`, p.overflowX <= 1, `${p.overflowX}px`);
    check(`${name} step ${n + 1}: URL unchanged`, page.url() === before, page.url());
    if (shots && (n === 0 || n === Math.floor(total / 2))) await page.screenshot({ path: `${dir}/${name}-2-during-step${n + 1}.png` });
    if (n === 1) {
      await page.getByTestId("tour-card").getByRole("button", { name: "Back" }).click(); await page.waitForTimeout(150);
      check(`${name}: Back returns to step 1`, (await probe(page)).title === titles[0]);
      await page.getByTestId("tour-card").getByRole("button", { name: "Next" }).click(); await page.waitForTimeout(150);
    }
    if (n < total - 1) { await page.getByTestId("tour-card").getByRole("button", { name: "Next" }).click(); await page.waitForTimeout(200); }
  }
  if (finish === "finish") await page.getByTestId("tour-card").getByRole("button", { name: total > 1 ? "Finish" : /Finish|Next/ }).click();
  else if (finish === "escape") await page.keyboard.press("Escape");
  else await page.getByTestId("tour-close").click();
  await page.waitForTimeout(300);
  check(`${name}: closes`, (await page.getByTestId("feature-tour").count()) === 0);
  check(`${name}: still on the same page and view`, page.url() === before, page.url());
  if (shots) await page.screenshot({ path: `${dir}/${name}-3-after.png` });
  return titles;
}

const writesOk = (name, writes) => {
  // /api/theme: the test's own theme setup syncing to the account, not the walkthrough.
  const bad = writes.filter((w) => w !== "POST /api/features" && w !== "POST /api/theme");
  check(`${name}: nothing saved, sent or changed (only the walkthrough's own record)`, bad.length === 0, bad.join(", "));
};

// ── Financials (WALK_FINANCIALS=1): real fin_* SQL on a throwaway local database, TEST DATA ONLY ────────
//   scripts/test-db.sh start && export RADAR_PG_URL=$(node scripts/financials/setup-db.mjs)
//   PG_REST_AS_USER=00000000-0000-4000-8000-000000000001 PG_REST_PREFIXES=fin_,estimates,estimate_versions,subcontractor_quote,change_orders \
//     node scripts/ux-audit/mock-supabase.mjs &   (then build with NEXT_PUBLIC_FINANCIALS=on)
//   WALK_FINANCIALS=1 RADAR_PG_URL=... node scripts/features/page-guide-walk.mjs <screenshotDir>
if (FIN) {
  const { Client } = createRequire(import.meta.url)("pg");
  const db = new Client({ connectionString: process.env.RADAR_PG_URL }); await db.connect();
  const est = async (t) => (await db.query("select id from public.estimates where title = $1", [t])).rows[0].id;
  const KITCHEN = await est("Kitchen remodel – Ortiz"), RIVERA = await est("Backyard deck – Rivera");
  await db.end();
  const as = (u) => fetch(`${M}/__as?user=${u}`);
  const OWNER = "00000000-0000-4000-8000-000000000001", PMU = "00000000-0000-4000-8000-0000000000b2", VIEWER = "00000000-0000-4000-8000-0000000000b3";
  await as(OWNER);
  const run = async (name, path, opts = {}, vp = "desktop", theme = "light") => {
    const { ctx, page, writes } = await open(vp, path, theme);
    if (opts.before) await opts.before(page);
    const titles = await walk(name, page, { how: vp === "desktop" ? "sidebar" : "sidebar-phone", expectLabel: opts.label });
    writesOk(name, writes);
    await ctx.close();
    return titles;
  };
  const home = await run("fin-home-owner", "/financials", { label: "Financials ·" });
  check("financials: owner home teaches headline numbers, alerts and customizing", ["Headline numbers", "Needs attention", "Customize this page"].every((t) => home.includes(t)), home.join(" | "));
  await run("fin-home-phone-dark", "/financials", { label: "Financials ·" }, "phone", "dark");
  await run("fin-records", "/financials/records?view=jobs", { label: "Financials · Records" });
  await run("fin-tools", "/financials/tools", { label: "Financials · All tools" }, "tablet", "black");
  const billing = await run("fin-job-billing", `/financials/jobs/${KITCHEN}`, { label: "Job financials · Billing" });
  {
    // The job's own trades (kitchen + electrical) pick the examples, not the account's usual trades.
    const { ctx, page } = await open("desktop", `/financials/jobs/${KITCHEN}`);
    await start(page, "sidebar");
    let text = "";
    for (let n = 0; n < 8; n++) { const p = await probe(page); text += ` ${p.body} ${p.hint}`; if (await page.getByTestId("tour-card").getByRole("button", { name: "Finish" }).count()) break; await page.getByTestId("tour-card").getByRole("button", { name: "Next" }).click(); await page.waitForTimeout(150); }
    check("financials trade: a kitchen job's tips speak to remodeling, not roofing", /kitchen|remodel/i.test(text) && !/roof/i.test(text), text);
    await page.keyboard.press("Escape");
    await ctx.close();
  }
  check("financials: job billing explains contract, milestones, invoices and payments", ["The contract", "Payment milestones", "Invoices", "Payments"].every((t) => billing.includes(t)), billing.join(" | "));
  const costs = await run("fin-job-costs-owner", `/financials/jobs/${KITCHEN}`, { label: "Job financials · Costs", before: async (p) => { await p.getByRole("tab", { name: "Costs" }).click(); await p.waitForTimeout(300); } });
  check("financials: the Costs tab on screen decides the tutorial", costs.includes("Add a cost") && !costs.includes("Payments"), costs.join(" | "));
  await run("fin-open-job", `/financials/jobs/${RIVERA}`, { label: "Job financials ·" });
  await run("fin-business-config", "/company/business-config", { label: "Business & Trade Configuration" });
  await run("fin-ai-automation", "/company/ai-automation", { label: "AI & Automation" });
  // Roles: the screens hide what a role can't use, and the walkthrough skips those steps.
  await as(PMU);
  const pmCosts = await run("fin-job-costs-pm", `/financials/jobs/${KITCHEN}`, { label: "Job financials ·", before: async (p) => { await p.getByRole("tab", { name: "Costs" }).click(); await p.waitForTimeout(300); } });
  check("financials: a project manager is walked through costs they can record", pmCosts.includes("Add a cost"), pmCosts.join(" | "));
  await as(VIEWER);
  const viewHome = await run("fin-home-view-only", "/financials", { label: "Financials ·" });
  check("financials: view-only isn't shown quick actions, trade setup or Accountant Mode", !["Quick actions", "Trade setup", "Contractor or Accountant Mode"].some((t) => viewHome.includes(t)), viewHome.join(" | "));
  await as(OWNER);
  await report();
}

// ── 1. Free account: Bids Pipeline, with typed search + date range that must survive ─────────────
await scenario("starter"); await pm({ scope: "none", canEdit: false, editorLimit: 0, editorsAssigned: 0, addon: false });
{
  const { ctx, page, writes } = await open("desktop", "/dashboard?view=pipeline");
  const search = page.getByRole("textbox", { name: "Search bids" });
  await search.fill("Lee");
  await page.getByTestId("range").selectOption("90d").catch(() => page.getByTestId("range").selectOption({ index: 2 }));
  await page.evaluate(() => window.scrollTo(0, 120));
  const urlBefore = page.url(), rangeBefore = await page.getByTestId("range").inputValue(), scrollBefore = await page.evaluate(() => scrollY);
  const titles = await walk("free-pipeline-desktop", page, { expectLabel: "Bids · Pipeline", url: urlBefore });
  check("free pipeline: teaches stages and bid cards, not other views", titles.includes("Stages") && titles.includes("Bid cards") && !titles.includes("Estimate your sales pay"), titles.join(" | "));
  check("free pipeline: typed search kept", (await search.inputValue()) === "Lee");
  check("free pipeline: date range kept", (await page.getByTestId("range").inputValue()) === rangeBefore);
  check("free pipeline: view still Pipeline", (await page.getByTestId("view-pipeline").getAttribute("aria-selected")) === "true");
  check("free pipeline: scroll position restored", Math.abs((await page.evaluate(() => scrollY)) - scrollBefore) < 4, `${await page.evaluate(() => scrollY)} vs ${scrollBefore}`);
  check("free pipeline: finished walkthrough remembered per page", ((await meta())?.guides ?? []).includes("dashboard.pipeline"));
  writesOk("free pipeline", writes);

  // Restart from the ? help popover ("Show me how this page works"), then Skip.
  await page.getByTestId("help-pipeline").click();
  await page.getByTestId("page-guide-from-help").click();
  await page.getByTestId("tour-card").waitFor();
  check("help popover: Show me how this page works restarts it (not blocked by completion)", (await probe(page)).progress.startsWith("Bids · Pipeline"));
  await page.getByTestId("tour-card").getByRole("button", { name: "Skip" }).click(); await page.waitForTimeout(200);
  check("Skip closes it", (await page.getByTestId("feature-tour").count()) === 0);
  // Keyboard: arrow keys move, Escape closes.
  await start(page, "sidebar");
  const k1 = (await probe(page)).title;
  await page.keyboard.press("ArrowRight"); await page.waitForTimeout(150);
  const k2 = (await probe(page)).title;
  await page.keyboard.press("ArrowLeft"); await page.waitForTimeout(150);
  check("keyboard: → and ← move between steps", k1 !== k2 && (await probe(page)).title === k1);
  await page.keyboard.press("Escape"); await page.waitForTimeout(150);
  check("keyboard: Escape closes", (await page.getByTestId("feature-tour").count()) === 0);
  // Clicking the highlighted control does nothing while the walkthrough is open (shield).
  await start(page, "sidebar");
  const sp = (await probe(page)).spot;
  await page.mouse.click(sp.left + sp.width / 2, sp.top + sp.height / 2); await page.waitForTimeout(250);
  check("clicking the highlighted area can't press the control under it", page.url() === urlBefore && (await page.getByTestId("feature-tour").count()) === 1);
  await page.getByTestId("tour-close").click();

  // Missing target: remove a control the guide names; the step is skipped and reported, never shown empty.
  await page.evaluate(() => { document.querySelector("[data-guide='bids.kpis']")?.remove(); window.__b2bGuideMissing = []; });
  const t2 = await walk("free-pipeline-missing-target", page, { shots: false, finish: "close", url: urlBefore });
  check("missing control: its step is skipped, no empty spotlight", !t2.includes("Your pipeline at a glance"), t2.join(" | "));
  await ctx.close();
}

// ── 2. Table and Analytics views (free) ───────────────────────────────────────────────────────────
for (const v of ["table", "analytics"]) {
  const { ctx, page, writes } = await open("desktop", `/dashboard?view=${v}`);
  const titles = await walk(`free-${v}-desktop`, page, { expectLabel: v === "table" ? "Bids · Table" : "Bids · Analytics" });
  if (v === "table") check("table: teaches open/edit and row actions", titles.includes("Open and edit an estimate") && titles.includes("Everything else for a bid"), titles.join(" | "));
  else check("analytics: teaches KPIs and sales pay on the Analytics view itself", titles.includes("How sales are going") && titles.includes("Estimate your sales pay"), titles.join(" | "));
  check(`${v}: view unchanged after walkthrough`, (await page.getByTestId(`view-${v}`).getAttribute("aria-selected")) === "true");
  writesOk(v, writes);
  await ctx.close();
}

// ── 3. Phone + tablet Pipeline; Dark and Black themes ─────────────────────────────────────────────
{
  const { ctx, page, writes } = await open("phone", "/dashboard?view=pipeline", "dark");
  await walk("free-pipeline-phone-dark", page, { how: "sidebar-phone", expectLabel: "Bids · Pipeline" });
  check("phone: menu closed so the page is visible", (await page.locator("#account-nav").isVisible()) === false);
  writesOk("phone pipeline", writes);
  await ctx.close();
}
{
  const { ctx, page } = await open("tablet", "/dashboard?view=analytics", "black");
  await walk("free-analytics-tablet-black", page, { how: "sidebar-phone", expectLabel: "Bids · Analytics" });
  await ctx.close();
}

// ── 4. Estimate builder (step on screen decides; trade adapts) ───────────────────────────────────
await scenario("starter");
{
  const { ctx, page, writes } = await open("desktop", `/estimates/${EST}`);
  await page.getByRole("button", { name: /^3\s*Estimate$|Estimate$/ }).first().click().catch(() => {});
  await page.waitForTimeout(500);
  const title = await page.locator("#est-title").inputValue();
  const titles = await walk("builder-estimate-siding-free", page, { how: "page", expectLabel: "Estimate builder · Estimate" });
  check("builder: free account told saved items are an Unlimited feature", titles.includes("Saved items"), titles.join(" | "));
  check("builder: still on the Estimate step, title untouched", (await page.locator("[aria-current='step']").textContent()).includes("Estimate") && (await page.locator("#est-title").inputValue()) === title);
  writesOk("builder", writes.filter((w) => !w.includes("/api/estimates")));
  await ctx.close();
}
{
  // Customer & project step on a deck bid: copy speaks to deck builders (project-level trade wins).
  const { ctx, page } = await open("desktop", `/estimates/${DECK}`);
  await page.getByRole("button", { name: /Customer & project$/ }).first().click().catch(() => {});
  await page.waitForTimeout(500);
  await start(page, "page");
  let text = "";
  for (let n = 0; n < 8; n++) { const p = await probe(page); text += ` ${p.body} ${p.hint}`; if (await page.getByTestId("tour-card").getByRole("button", { name: "Finish" }).count()) break; await page.getByTestId("tour-card").getByRole("button", { name: "Next" }).click(); await page.waitForTimeout(150); }
  check("trade: deck bid examples speak to deck building", /deck/i.test(text) && !/siding|shingle/i.test(text), text);
  await page.getByTestId("tour-close").click();
  await ctx.close();
}
{
  const { ctx, page } = await open("phone", `/estimates/${EST}`);
  await page.getByRole("button", { name: /Proposal$/ }).first().click().catch(() => {});
  await page.waitForTimeout(500);
  await walk("builder-proposal-phone", page, { how: "page", expectLabel: "Estimate builder · Proposal" });
  await ctx.close();
}

// ── 5. Customers: directory and details ──────────────────────────────────────────────────────────
await scenario("unlimited");
{
  const { ctx, page, writes } = await open("desktop", "/dashboard/customers");
  await walk("customers-directory", page, { expectLabel: "Customers · Directory" });
  writesOk("customers", writes);
  const first = page.getByTestId("customer-row").first();
  if (await first.count()) {
    await first.click(); await page.waitForURL(/\/dashboard\/customers\/[0-9a-f-]{36}/); await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    await walk("customer-detail", page, { expectLabel: "Customer · Overview" });
  } else check("customer detail: a customer row to open", false, "no customer rows in mock");
  await ctx.close();
}

// ── 6. Projects: overview, calendar, Schedule Now (editor), viewer ─────────────────────────────────
await pm({}); await fetch(`${M}/__sched?reset=1&stage=won`); await fetch(`${M}/__ws?seed=1`); await fetch(`${M}/__team?seed=1`);
{
  const { ctx, page, writes } = await open("desktop", "/projects");
  await walk("projects-overview-editor", page, { expectLabel: "Projects · Overview" });
  writesOk("projects", writes);
  await ctx.close();
}
{
  const { ctx, page } = await open("desktop", "/projects?view=calendar");
  const titles = await walk("projects-calendar", page, { expectLabel: "Projects · Calendar" });
  check("calendar: teaches the calendar, not the overview", titles.includes("Month, week or agenda") && !titles.includes("What needs attention"), titles.join(" | "));
  await ctx.close();
}
for (const vp of ["desktop", "tablet"]) {
  const { ctx, page, writes } = await open(vp, `/projects/new?estimate=${EST}`);
  const titles = await walk(`schedule-now-${vp}`, page, { how: vp === "desktop" ? "sidebar" : "sidebar-phone", expectLabel: "Schedule Now" });
  check(`schedule now (${vp}): explains the Company Calendar (panel or its toggle)`, titles.includes("Company Calendar"), titles.join(" | "));
  writesOk(`schedule now ${vp}`, writes);
  await ctx.close();
}
await pm({ canEdit: false, scope: "company", editorLimit: 1, editorsAssigned: 1 });
{
  const { ctx, page } = await open("desktop", "/projects?view=timeline");
  await start(page, "sidebar");
  const seen = [];
  for (let n = 0; n < 6; n++) { const p = await probe(page); seen.push(p.body); if (await page.getByTestId("tour-card").getByRole("button", { name: "Finish" }).count()) break; await page.getByTestId("tour-card").getByRole("button", { name: "Next" }).click(); await page.waitForTimeout(150); }
  check("PM viewer: timeline isn't explained as editable", !seen.join(" ").includes("Dragging a bar"), seen.join(" | "));
  await page.keyboard.press("Escape");
  await ctx.close();
}

// ── 7. Company profile + Subscription (free and Unlimited) ────────────────────────────────────────
await scenario("starter");
{
  const { ctx, page, writes } = await open("desktop", "/settings/company");
  await walk("company-profile", page, { expectLabel: "Company profile" });
  writesOk("company profile", writes);
  await page.goto(`${A}/settings/billing`, { waitUntil: "load" }); await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  const t = await walk("subscription-free", page, { expectLabel: "Subscription" });
  // Upgrade cards only render when Stripe keys are configured (not in this local build), so that step is skipped here.
  check("subscription (free): plan and credits, no billing-portal step", t.includes("Your plan") && t.includes("Credits") && !t.includes("Manage billing"), t.join(" | "));
  await ctx.close();
}

// ── 8. Enterprise owner vs staff ──────────────────────────────────────────────────────────────────
await scenario("enterprise_owner");
{
  const { ctx, page } = await open("desktop", "/company/users");
  const t = await walk("enterprise-owner-users", page, { expectLabel: "Company · Team & Access" });
  check("enterprise owner: invite people is explained", t.includes("Invite people"), t.join(" | "));
  await ctx.close();
}
await scenario("enterprise_estimator");
{
  const { ctx, page } = await open("desktop", "/company/users");
  await start(page, "sidebar");
  const titles = [];
  for (let n = 0; n < 5; n++) { titles.push((await probe(page)).title); if (await page.getByTestId("tour-card").getByRole("button", { name: "Finish" }).count()) break; await page.getByTestId("tour-card").getByRole("button", { name: "Next" }).click(); await page.waitForTimeout(150); }
  check("enterprise staff: no invite/teams steps without the permission", !titles.includes("Invite people") && !titles.includes("Teams"), titles.join(" | "));
  await page.screenshot({ path: `${dir}/enterprise-staff-users-during.png` });
  await page.keyboard.press("Escape");
  await ctx.close();
}

// ── 9. Platform owner (separate walkthrough) ─────────────────────────────────────────────────────
{
  const { ctx, page } = await open("desktop", "/admin");
  await walk("admin-owner", page, { how: "page", expectLabel: "Owner command center" });
  await ctx.close();
}

// ── 10. Feature announcements stay on the page they start from ───────────────────────────────────
await scenario("starter"); await fetch(`${M}/__features`);
{
  const { ctx, page } = await open("desktop", "/whats-new");
  const before = page.url();
  await page.getByRole("main").getByTestId("feature-tour-button").click();
  await page.getByTestId("tour-card").waitFor();
  check("What's New walkthrough: runs on What's New (no redirect to the dashboard)", page.url() === before);
  await page.screenshot({ path: `${dir}/whats-new-announcement.png` });
  await page.keyboard.press("Escape");
  await ctx.close();
}

await report();

async function report() {
  await browser.close();
  const relevant = errors.filter((e) => !/Failed to load resource|ResizeObserver/.test(e));
  check("no page errors", relevant.length === 0, relevant.slice(0, 5).join(" | "));
  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync(`${dir}/results${FIN ? "-financials" : ""}.json`, JSON.stringify({ passed: results.length - failed.length, failed: failed.length, results }, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}
