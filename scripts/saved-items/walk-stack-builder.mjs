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

const dir = process.argv[2] ?? "stack-builder-shots";
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


await db.query("delete from public.saved_items where user_id = $1", [ME]);
for (const [name, trade, cat, ct, unit, cost] of [
  ["Dumpster 20 yd", "roofing", "Tear-Off & Disposal", "other", "each", 450],
  ["Synthetic underlayment", "roofing", "Roofing Materials", "material", "roll", 95],
  ["Architectural shingles", "roofing", "Roofing Materials", "material", "bundle", 38.5],
  ["Shingle installation labor", "roofing", "Labor", "labor", "square", 85],
  ["Permit fee", null, "Permits", "other", "each", 150],
]) await db.query("insert into public.saved_items (user_id, name, trade, category, cost_type, unit, unit_cost) values ($1,$2,$3,$4,$5,$6,$7)", [ME, name, trade, cat, ct, unit, cost]);

// 1. Build a scaling stack from saved items, no estimate.
{
  const { ctx, page } = await open("/dashboard/items");
  await page.getByTestId("stack-new").waitFor({ timeout: 15000 });
  await page.getByTestId("stack-new").click();
  const ed = page.getByTestId("stack-editor");
  await ed.waitFor();
  await ed.getByTestId("stack-editor-save").click();
  check("empty stack refused with reasons", (await ed.getByRole("alert").textContent()).includes("Give the stack a name"));
  await ed.getByTestId("stack-name").fill("Re-roof office package");
  for (const n of ["Dumpster 20 yd", "Synthetic underlayment", "Architectural shingles", "Shingle installation labor"]) {
    await ed.getByTestId("stack-pick-search").fill(n);
    await ed.getByRole("button", { name: `Add ${n} to the stack` }).click();
  }
  await ed.getByTestId("stack-pick-search").fill("");
  check("four rows added", (await ed.getByTestId("stack-editor-row").count()) === 4);
  check("trade set from the items", (await ed.locator("select").first().inputValue()) === "roofing");
  await ed.getByTestId("scale-toggle").check();
  await ed.locator("#scale-unit").selectOption("square");
  await ed.locator("#scale-label").fill("Roof area");
  await page.waitForTimeout(200);
  const pers = ed.getByTestId("stack-row-per");
  check("scaling shows per-unit inputs", (await pers.count()) === 4);
  await pers.nth(1).fill("0.1"); await pers.nth(2).fill("3"); await pers.nth(3).fill("1");
  await ed.getByLabel("Architectural shingles waste percent").fill("10");
  await ed.screenshot({ path: path.join(dir, "01-new-stack-desktop.png") });
  await ed.getByTestId("stack-editor-save").click();
  await page.getByText("Created stack “Re-roof office package”.").last().waitFor({ timeout: 10000 });
  await page.waitForTimeout(500);
  const s = await q1("select a.id, a.trade, a.scale_unit, count(i.*)::int n, count(i.qty_per)::int scaled, max(i.waste_pct)::text w from public.assemblies a join public.assembly_items i on i.assembly_id = a.id where a.user_id = $1 group by a.id", [ME]);
  check("saved: roofing, scales by squares, 4 rows, 3 scaled, 10% waste", s?.trade === "roofing" && s.scale_unit === "square" && s.n === 4 && s.scaled === 3 && s.w === "10.00");
  const order = (await db.query("select name from public.assembly_items where assembly_id = $1 order by sort_order", [s.id])).rows.map((r) => r.name);
  check("row order kept", order[0] === "Dumpster 20 yd" && order[3] === "Shingle installation labor");

  // 2. Edit it: add the permit, remove underlayment, move labor up, change dumpster qty.
  const before = (await db.query("select id, name from public.assembly_items where assembly_id = $1", [s.id])).rows;
  const row = page.locator("section[aria-labelledby=saved-stacks-h] li").filter({ hasText: "Re-roof office package" }).first();
  await row.getByTestId("stack-edit").click();
  const ed2 = page.getByTestId("stack-editor");
  await ed2.waitFor();
  check("editor opens with the 4 rows and scaling", (await ed2.getByTestId("stack-editor-row").count()) === 4 && (await ed2.getByTestId("stack-row-per").count()) === 4);
  await ed2.getByLabel("Dumpster 20 yd quantity").fill("2");
  await ed2.getByRole("button", { name: "Remove Synthetic underlayment from the stack" }).click();
  await ed2.getByRole("button", { name: "Move Shingle installation labor up" }).click();
  await ed2.getByTestId("stack-pick-search").fill("permit");
  await ed2.getByRole("button", { name: "Add Permit fee to the stack" }).click();
  await ed2.screenshot({ path: path.join(dir, "02-edit-stack-desktop.png") });
  await ed2.getByTestId("stack-editor-save").click();
  await page.getByText("Saved stack “Re-roof office package”.").last().waitFor({ timeout: 10000 });
  await page.waitForTimeout(500);
  const after = (await db.query("select id, name, quantity::text q from public.assembly_items where assembly_id = $1 order by sort_order", [s.id])).rows;
  check("after edit: dumpster, labor, shingles, permit", after.map((r) => r.name).join("|") === "Dumpster 20 yd|Shingle installation labor|Architectural shingles|Permit fee");
  check("dumpster quantity 2", after[0].q.startsWith("2"));
  check("kept rows keep their ids", after.filter((r) => before.some((b) => b.id === r.id)).length === 3);
  await page.reload({ waitUntil: "load" }); await page.waitForTimeout(1200);
  check("reload shows 4 items", (await page.locator("section[aria-labelledby=saved-stacks-h] li").filter({ hasText: "Re-roof office package" }).first().textContent()).includes("4 items"));
  check("no horizontal scroll (desktop)", await noHScroll(page));
  await ctx.close();
}

// 3. Phone + dark.
{
  const { ctx, page } = await open("/dashboard/items", { vp: PHONE, dark: true });
  await page.getByTestId("stack-new").waitFor({ timeout: 15000 });
  await page.getByTestId("stack-new").click();
  const ed = page.getByTestId("stack-editor");
  await ed.getByTestId("stack-name").fill("Phone stack");
  await ed.getByRole("button", { name: "Add Permit fee to the stack" }).click();
  await ed.getByRole("button", { name: "Add Dumpster 20 yd to the stack" }).click();
  await ed.scrollIntoViewIfNeeded();
  await ed.screenshot({ path: path.join(dir, "03-new-stack-phone-dark.png") });
  check("no horizontal scroll (phone)", await noHScroll(page));
  await ctx.close();
}

await browser.close(); await db.end();
console.log(out.join("\n"));
if (errors.length) { console.log("ERRORS:\n" + errors.join("\n")); process.exitCode = 1; }
