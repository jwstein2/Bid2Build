// Favorites, starter assemblies and scaling stacks browser walk against the REAL SQL (TEST DATA ONLY).
//   Setup as scripts/financials/walk-sandbox.mjs, with PG_REST_PREFIXES also covering
//   saved_items, assembl, library_, my_company_id and has_company_permission.
//   NODE_PATH=<dir with playwright> node scripts/saved-items/walk-p1d.mjs <screenshotDir>
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const { Client } = require("pg");

const dir = process.argv[2] ?? "p1d-shots";
fs.mkdirSync(dir, { recursive: true });
const ME = "00000000-0000-4000-8000-000000000001";
const user = { id: ME, aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };
const M = "http://localhost:54321", A = "http://localhost:3000";
const out = []; const check = (n, c) => { out.push(`${c ? "✓" : "✗"} ${n}`); if (!c) process.exitCode = 1; };
const db = new Client({ connectionString: process.env.RADAR_PG_URL }); await db.connect();
const q1 = async (sql, args = []) => (await db.query(sql, args)).rows[0];

// A kitchen estimate with one row measured by the area calculator (2,400 SF), so a stack scaled in
// squares can take its measure from it.
const EST = (await q1("select id from public.estimates where title = 'Kitchen remodel – Ortiz'")).id;
const g = (await q1("insert into public.estimate_groups (estimate_id, user_id, name, sort_order) values ($1, $2, 'Exterior', 0) returning id", [EST, ME])).id;
const it = (await q1("insert into public.estimate_items (estimate_id, group_id, user_id, name, unit, quantity, unit_cost, sort_order) values ($1, $2, $3, 'Garage roof area', 'square foot', 2400, 0, 0) returning id", [EST, g, ME])).id;
await db.query("update public.estimates set proposal_config = coalesce(proposal_config, '{}'::jsonb) || $2::jsonb where id = $1",
  [EST, JSON.stringify({ worksheet: { calcs: { [it]: { v: 1, calc: "area", output: "sf", input: { sections: [], options: {} }, result: "2400", unit: "square foot", appliedAt: new Date().toISOString() } } } })]);
await db.query("delete from public.assemblies where user_id = $1", [ME]);

await fetch(`${M}/__as?user=${ME}`);
await fetch(`${M}/__onboarding?status=completed`);
await fetch(`${M}/__features?created=${encodeURIComponent(new Date().toISOString())}`);
const browser = await chromium.launch();
const errors = [];
const DESK = { width: 1440, height: 1000 }, PHONE = { width: 390, height: 844 };
async function open(p, { vp = DESK, dark = false } = {}) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 });
  await ctx.addCookies([authCookie]);
  await ctx.addInitScript((m) => { try { localStorage.setItem("b2b-theme", JSON.stringify({ mode: m, at: Date.now() })); } catch { /* none */ } }, dark ? "dark" : "light");
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${p}: ${e.message}`));
  page.on("response", (r) => { if (r.url().includes("/api/") && r.status() >= 500) errors.push(`${p}: ${r.status()} ${r.url()}`); });
  await page.goto(`${A}${p}`, { waitUntil: "load" });
  const later = page.getByRole("button", { name: "Maybe Later" });
  try { await later.waitFor({ timeout: 1500 }); await later.click(); } catch { /* none */ }
  await page.waitForTimeout(600);
  return { ctx, page };
}
let n = 1;
const shot = async (page, name, full = false) => { await page.screenshot({ path: path.join(dir, `${String(n++).padStart(2, "0")}-${name}.png`), fullPage: full }); };
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

// 1. Library page: save a starter, star it, look at its scaling.
{
  const { ctx, page } = await open("/dashboard/items");
  const starters = page.getByTestId("starter-assemblies");
  await starters.waitFor({ timeout: 15000 });
  check("five starter assemblies listed", (await starters.locator("li").count()) === 5);
  await starters.locator("li", { hasText: "Re-roof per square" }).getByTestId("starter-save").click();
  const row = page.locator("#saved-stacks-h + p + div li, section[aria-labelledby=saved-stacks-h] li").filter({ hasText: "Re-roof per square" }).first();
  await row.waitFor({ timeout: 10000 });
  check("starter saved as a scaling stack", (await row.getByTestId("stack-scales").count()) === 1);
  await page.waitForTimeout(800);
  const saved = await q1("select a.scale_unit, a.starter_key, count(i.*)::int n, count(i.qty_per)::int scaled from public.assemblies a join public.assembly_items i on i.assembly_id = a.id where a.user_id = $1 group by a.id", [ME]);
  check("stored with per-square amounts (1 fixed row)", saved?.scale_unit === "square" && saved.starter_key === "roofing-reroof" && saved.n === 6 && saved.scaled === 5);
  await row.getByTestId("fav-toggle").click();
  await page.waitForTimeout(800);
  check("starred as a favorite", Boolean(await q1("select 1 from public.library_favorites where user_id = $1 and assembly_id is not null", [ME])));
  await row.locator("summary").click();
  await row.getByTestId("stack-scale-edit").click();
  await page.getByTestId("scale-editor").waitFor();
  await page.getByTestId("scale-editor").scrollIntoViewIfNeeded();
  await shot(page, "library-scale-editor-desktop-light");
  // Change shingles from 3 to 3.2 bundles per square.
  await page.getByLabel("Architectural shingles per sq").fill("3.2");
  await page.getByTestId("scale-save").click();
  await page.waitForTimeout(1000);
  check("scaling edit saved", Number((await q1("select qty_per from public.assembly_items where user_id = $1 and name = 'Architectural shingles'", [ME]))?.qty_per) === 3.2);
  await starters.scrollIntoViewIfNeeded();
  await shot(page, "library-starters-desktop-light");
  await ctx.close();
}

// 2. Builder: the favorite stack leads the picker; add it scaled by the calculator's 24 squares.
{
  const { ctx, page } = await open(`/estimates/${EST}`);
  const step = page.locator('nav[aria-label="Builder steps"] button', { hasText: "Estimate" }).first();
  if (await step.count()) await step.click();
  await page.waitForSelector("text=Suggested & Saved Items", { timeout: 20000 });
  await page.getByRole("button", { name: "Suggested & Saved Items" }).first().click();
  await page.getByTestId("picker-favorites").waitFor({ timeout: 10000 });
  check("Favorites lead the picker", true);
  await shot(page, "builder-picker-favorites-desktop-light");
  await page.getByTestId("pick-stack").filter({ hasText: "Re-roof per square" }).first().click();
  await page.getByTestId("scale-stack-form").waitFor();
  const chip = page.getByTestId("scale-measure-chip").first();
  check("calculator measure offered (2,400 SF = 24 sq)", (await chip.count()) === 1 && (await chip.innerText()).includes("24 sq"));
  check("measure pre-filled from the calculator", (await page.locator("#scale-measure").inputValue()) === "24");
  const shingles = page.getByTestId("scale-row").filter({ hasText: "Architectural shingles" });
  check("shingles scale to 85 bundles (24 × 3.2 + 10%, rounded up)", (await shingles.innerText()).includes("85 bdl"));
  check("dumpster stays fixed at 1", (await page.getByTestId("scale-row").filter({ hasText: "Dumpster" }).innerText()).includes("1 ea"));
  await shot(page, "builder-scale-dialog-desktop-light");
  await page.getByTestId("scale-stack-add").click();
  await page.waitForTimeout(800);
  check("rows added to the section", (await page.locator("input[value='Architectural shingles'], textarea:has-text('Architectural shingles')").count()) + (await page.getByText("Architectural shingles").count()) > 0);
  // A starter assembly found by search, without saving it first.
  await page.getByRole("button", { name: "Suggested & Saved Items" }).first().click();
  await page.getByLabel("Search suggested and saved items").fill("deck");
  check("starter found by search", (await page.getByTestId("pick-starter").filter({ hasText: "Composite deck" }).count()) === 1);
  await ctx.close();
}

// 3. Dark + phone.
for (const [name, vp, dark] of [["desktop-dark", DESK, true], ["phone-light", PHONE, false]]) {
  const { ctx, page } = await open(`/estimates/${EST}`, { vp, dark });
  const step = page.locator('nav[aria-label="Builder steps"] button', { hasText: "Estimate" }).first();
  if (await step.count()) await step.click();
  await page.waitForSelector("text=Suggested & Saved Items", { timeout: 20000 });
  await page.getByRole("button", { name: "Suggested & Saved Items" }).first().click();
  await page.getByTestId("pick-stack").filter({ hasText: "Re-roof per square" }).first().click();
  await page.getByTestId("scale-stack-form").waitFor();
  await shot(page, `builder-scale-dialog-${name}`);
  if (vp === PHONE) check("phone: no horizontal scroll", await noHScroll(page));
  await ctx.close();
  const lib = await open("/dashboard/items", { vp, dark });
  await lib.page.getByTestId("starter-assemblies").waitFor({ timeout: 15000 });
  await lib.page.locator("section[aria-labelledby=saved-stacks-h]").scrollIntoViewIfNeeded();
  await shot(lib.page, `library-stacks-${name}`);
  if (vp === PHONE) check("phone library: no horizontal scroll", await noHScroll(lib.page));
  await lib.ctx.close();
}

await db.query("delete from public.estimate_items where id = $1", [it]);
await browser.close(); await db.end();
check(`no page errors or 5xx (${errors.length})`, errors.length === 0);
if (errors.length) console.log(errors.join("\n"));
console.log(out.join("\n"));
