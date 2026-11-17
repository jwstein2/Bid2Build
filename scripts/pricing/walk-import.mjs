// V5 Pricing Intelligence browser walk: supplier price import, undo, Refresh Material Costs, target margin.
// TEST DATA ONLY, against the real SQL. Setup (same as scripts/financials/walk-v5.mjs):
//   scripts/test-db.sh start && export RADAR_PG_URL=$(node scripts/financials/setup-db.mjs)
//   PG_REST_AS_USER=00000000-0000-4000-8000-000000000001 PG_REST_PREFIXES=fin_,estimate,customers,company_members,project_schedules,business_profiles,companies,saved_items,assembl,price_,library_access \
//     node scripts/ux-audit/mock-supabase.mjs &
//   next start -p 3000 (built with NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321)
//   node scripts/pricing/walk-import.mjs <screenshotDir>
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const { Client } = require("pg");

const dir = process.argv[2] ?? "pricing-shots";
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

// Seed: two saved items, a 30% target margin, and a draft roofing estimate that uses the shingles at the old price.
const shingles = (await q1("insert into public.saved_items (user_id, name, unit, unit_cost, trade, category, cost_type) values ($1, 'Architectural shingles', 'bundle', 38.50, 'roofing', 'Materials', 'material') returning id", [ME])).id;
await db.query("insert into public.saved_items (user_id, name, unit, unit_cost, trade, cost_type) values ($1, 'Ridge cap', 'bundle', 60, 'roofing', 'material')", [ME]);
await db.query("insert into public.business_profiles (user_id, company_name) values ($1, 'Summit Exteriors LLC') on conflict (user_id) do nothing", [ME]);
await db.query("update public.business_profiles set target_margin_pct = 30 where user_id = $1", [ME]);
const est = (await q1("insert into public.estimates (user_id, title, customer_name, trades, tax_rate, pricing_mode, pricing_percent) values ($1, 'Roof – Nguyen (draft)', 'Lin Nguyen', '{roofing}', 0, 'markup', 25) returning id", [ME])).id;
const grp = (await q1("insert into public.estimate_groups (estimate_id, user_id, name, sort_order) values ($1, $2, 'Materials', 0) returning id", [est, ME])).id;
await db.query("insert into public.estimate_items (estimate_id, group_id, user_id, name, cost_type, quantity, unit, unit_cost, sort_order) values ($1, $2, $3, 'Architectural shingles', 'material', 30, 'bundle', 38.50, 0), ($1, $2, $3, 'Roofing labor', 'labor', 30, 'square', 95, 1)", [est, grp, ME]);

const csvPath = path.join(os.tmpdir(), "abc-supply-nov.csv");
fs.writeFileSync(csvPath, `Item #,Description,UOM,Net Price,Pack Qty
GAF-TL-01,Architectural shingles,BDL,"$41.25",
UDL-10,"Synthetic underlayment, 10 sq",RL,89.00,
NAIL-1,"Coil nails 1-1/4""",BX,"$120.00",4
DRIP-8,Drip edge 8ft,EA,abc,
RIDGE,Ridge cap,BDL,90.00,
`);

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
  page.on("response", (r) => { if (r.url().includes("/api/library") && r.status() >= 500) errors.push(`${p}: ${r.status()} ${r.url()}`); });
  await page.goto(`${A}${p}`, { waitUntil: "load" });
  const later = page.getByRole("button", { name: "Maybe Later" });
  try { await later.waitFor({ timeout: 1500 }); await later.click(); } catch { /* none */ }
  await page.waitForTimeout(600);
  return { ctx, page };
}
let n = 1;
const shot = async (page, name, full = true) => { await page.screenshot({ path: path.join(dir, `${String(n++).padStart(2, "0")}-${name}.png`), fullPage: full }); };
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

// 1. Library page: import link + target margin setting.
{
  const { ctx, page } = await open("/dashboard/items");
  await page.getByTestId("items-import-link").waitFor({ timeout: 15000 });
  check("library shows Import supplier price list", true);
  check("target margin setting shows 30", (await page.locator("#tm").inputValue()) === "30");
  await shot(page, "library-desktop");
  await ctx.close();
}

// 2. Import: upload, mapping, preview.
for (const [vpName, vp, dark] of [["desktop", DESK, false], ["phone", PHONE, false], ["desktop", DESK, true]]) {
  const { ctx, page } = await open("/dashboard/items/import", { vp, dark });
  await page.getByTestId("price-import-file").setInputFiles(csvPath);
  await page.getByTestId("price-import-preview").waitFor({ timeout: 10000 });
  const tag = `${vpName}${dark ? "-dark" : ""}`;
  if (vpName === "desktop" && !dark) {
    check("columns auto-mapped (SKU = Item #)", (await page.locator("#map-sku").inputValue()) === "0");
    check("supplier name prefilled from the file", (await page.locator("#pi-supplier").inputValue()).length > 0);
    await page.locator("#pi-supplier").fill("ABC Supply – Springfield");
    const status = async (s) => page.locator(`[data-testid=price-import-table] tr[data-status=${s}]`).count();
    check("preview: 1 change, 2 new, 1 invalid (price 'abc'), 1 flagged big change", (await status("changed")) === 2 && (await status("new")) === 2 && (await status("invalid")) === 1);
    const ridge = page.locator("[data-testid=price-import-table] tr", { hasText: "Ridge cap" }).locator("input[type=checkbox]");
    check("+50% ridge cap is left unticked for review", !(await ridge.isChecked()));
    check("invalid row can't be ticked", await page.locator("[data-testid=price-import-table] tr[data-status=invalid] input").isDisabled());
    await page.locator("label", { hasText: "Prices are per pack" }).locator("input").check();
    check("pack price converts to per unit ($120 ÷ 4)", (await page.locator("[data-testid=price-import-table] tr", { hasText: "Coil nails" }).innerText()).includes("$30.00"));
    await shot(page, `import-preview-${tag}`);
    await page.getByTestId("price-import-apply").click();
    await page.getByText(/Imported: 2 new items, 1 price updated/).waitFor({ timeout: 10000 });
    check("import applies 2 new + 1 update", true);
    const s = await q1("select unit_cost::text, price_source, supplier_name, supplier_sku from public.saved_items where id = $1", [shingles]);
    check("shingles saved price now 41.25 from ABC Supply #GAF-TL-01", s.unit_cost === "41.2500" && s.price_source === "supplier_import" && s.supplier_sku === "GAF-TL-01");
    await page.getByTestId("price-import-history").getByRole("button", { name: "Undo" }).waitFor({ timeout: 5000 }).catch(() => {});
    check("history lists the import with Undo", (await page.getByTestId("price-import-history").getByRole("button", { name: "Undo" }).count()) === 1);
    await shot(page, `import-done-${tag}`);
  } else {
    check(`import preview ${tag}: no horizontal page scroll`, await noHScroll(page));
    await shot(page, `import-preview-${tag}`);
  }
  await ctx.close();
}

// 3. Library shows the price source.
{
  const { ctx, page } = await open("/dashboard/items");
  await page.getByTestId("item-price-source").first().waitFor({ timeout: 10000 });
  check("library shows 'Price from ABC Supply' on the item", (await page.getByTestId("item-price-source").first().innerText()).includes("ABC Supply"));
  await ctx.close();
}

// 4. Builder: Refresh Material Costs on the draft + target-margin warning.
{
  const { ctx, page } = await open(`/estimates/${est}`);
  const refresh = page.getByTestId("refresh-costs");
  try { await refresh.waitFor({ timeout: 20000 }); } catch { /* checked below */ }
  check("draft bid offers 'Material prices changed'", await refresh.isVisible());
  check("25% markup (20% margin) warns under the 30% target", await page.getByTestId("target-margin-warning").isVisible());
  if (await refresh.isVisible()) {
    await page.getByTestId("refresh-costs-review").click();
    await refresh.scrollIntoViewIfNeeded();
    await shot(page, "builder-refresh-desktop", false);
    check("refresh lists the shingles 38.50 → 41.25", (await refresh.innerText()).includes("$41.25"));
    await page.getByTestId("refresh-costs-apply").click();
    await page.waitForTimeout(500);
    check("after applying, the refresh card goes away", !(await refresh.isVisible()));
  }
  await ctx.close();
  // A finalized (sent) bid never offers a refresh.
  await db.query("update public.estimates set status = 'finalized' where id = $1", [est]);
  const f = await open(`/estimates/${est}`);
  await f.page.getByTestId("target-margin-warning").waitFor({ timeout: 20000 }).catch(() => {});
  check("finalized (sent) bid shows no refresh", (await f.page.getByTestId("refresh-costs").count()) === 0);
  await f.ctx.close();
}

// 5. Undo restores the old price and removes the created items.
{
  const { ctx, page } = await open("/dashboard/items/import");
  await page.getByTestId("price-import-history").getByRole("button", { name: "Undo" }).click();
  await page.getByText(/Undone: 1 price restored, 2 new items removed/).waitFor({ timeout: 10000 });
  const s = await q1("select unit_cost::text, price_source from public.saved_items where id = $1", [shingles]);
  check("undo restores shingles to 38.50 (manual)", s.unit_cost === "38.5000" && s.price_source === "manual");
  await shot(page, "import-undone-desktop");
  await ctx.close();
}

check(`no page errors or 5xx (${errors.length})`, errors.length === 0);
if (errors.length) console.log(errors.join("\n"));
await browser.close(); await db.end();
console.log(out.join("\n"));
