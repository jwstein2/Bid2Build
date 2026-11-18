// Supplier pricing browser walk against the REAL SQL on a throwaway local database (TEST DATA ONLY):
//   scripts/test-db.sh start
//   export RADAR_PG_URL=$(node scripts/team-records/setup-db.mjs)
//   PG_REST_AS_USER=00000000-0000-4000-8000-000000000001 PG_REST_PREFIXES=pm_,price_import,project_schedules,saved_items,supplier_ \
//     node scripts/ux-audit/mock-supabase.mjs &
//   export NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=x SUPABASE_SECRET_KEY=x NEXT_PUBLIC_PROJECT_SCHEDULING=on
//   npm run build && npx next start -p 3000 &
//   node scripts/supplier-pricing/walk.mjs <screenshotDir>
// Seeds price lists from two suppliers, then covers: cross-check overlaps + search, branch finder links,
// opt-in connection request with consent, pause / remove; 1440 / 390, dark.
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const { Client } = require("pg");
const dir = process.argv[2] ?? "supplier-pricing-shots";
fs.mkdirSync(dir, { recursive: true });
const ME = "00000000-0000-4000-8000-000000000001";

// Seed: real imported prices from two suppliers (test data).
const db = new Client({ connectionString: process.env.RADAR_PG_URL }); await db.connect();
await db.query("delete from public.supplier_connections");
const seedImport = async (supplier, rows, daysAgo) => {
  const sup = (await db.query("select id from public.pm_suppliers where name = $1", [supplier])).rows[0]?.id ?? null;
  const id = (await db.query("insert into public.price_imports (user_id, supplier_name, supplier_id, rows_total) values ($1, $2, $3, $4) returning id", [ME, supplier, sup, rows.length])).rows[0].id;
  for (const [name, unit, cost, sku, expires] of rows) await db.query(
    "insert into public.price_records (user_id, import_id, action, supplier_name, supplier_sku, product_name, unit, unit_cost, effective_on, expires_on) values ($1, $2, 'created', $3, $4, $5, $6, $7, current_date - $8::int, $9)",
    [ME, id, supplier, sku, name, unit, cost, daysAgo, expires ?? null]);
};
await db.query("delete from public.price_records where user_id = $1", [ME]);
await seedImport("ABC Supply – Springfield", [["Architectural shingles", "bundle", 43.5, "GAF-HDZ"], ["Synthetic underlayment", "roll", 92, "UDL-10"], ["Drip edge 10ft", "each", 8.25, "DE-10"]], 3);
await seedImport("Lakeside Lumber", [["Architectural shingles", "bundle", 41.75, "LL-ARCH"], ["Synthetic underlayment", "roll", 96.4, "LL-UDL"], ["Drip edge 10ft", "each", 7.1, "LL-DE", "2026-01-31"], ["2x10x16 pressure treated", "each", 28.9, "PT21016"]], 1);
await db.end();

const user = { id: ME, aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };
const out = []; const check = (n, c) => { out.push(`${c ? "✓" : "✗"} ${n}`); };
const M = "http://localhost:54321", A = "http://localhost:3000";
await fetch(`${M}/__onboarding?status=completed`);
await fetch(`${M}/__features?created=${encodeURIComponent(new Date().toISOString())}`);
await fetch(`${M}/__scenario?name=unlimited`);
const browser = await chromium.launch();
const errors = [];
async function open(path, vp = { width: 1440, height: 1000 }, theme = null) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 });
  await ctx.addCookies([authCookie]);
  if (theme) await ctx.addInitScript((m) => { try { localStorage.setItem("b2b-theme", JSON.stringify({ mode: m, at: Date.now() })); } catch {} }, theme);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${path}: ${e.message}`));
  await page.goto(`${A}${path}`, { waitUntil: "load" });
  const later = page.getByRole("button", { name: "Maybe Later" });
  try { await later.waitFor({ timeout: 3500 }); await later.click(); } catch { /* none */ }
  await page.waitForTimeout(300);
  return { ctx, page };
}
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const shot = (page, name) => page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });

// 1. Cross-check + branches + connections, desktop
{
  const { ctx, page } = await open("/projects/team/pricing");
  await page.getByTestId("supplier-pricing").waitFor();
  check("Team nav has the Supplier pricing tab, marked current", (await page.getByTestId("team-nav").getByRole("link", { name: "Supplier pricing" }).getAttribute("aria-current")) === "page");
  await page.getByTestId("cross-check-group").first().waitFor();
  const groups = page.getByTestId("cross-check-group");
  check("three overlapping products compared (single-supplier lumber left out)", (await groups.count()) === 3);
  const shingles = groups.filter({ hasText: "Architectural shingles" });
  const st = await shingles.textContent();
  check("shingles: Lakeside lowest, ABC +$1.75", /Lakeside Lumber.*Lowest/.test(st) && /\+\$1\.75/.test(st));
  const drip = await groups.filter({ hasText: "Drip edge" }).textContent();
  check("expired Lakeside drip edge is flagged and not ranked", /Expired/.test(drip) && !/Lowest/.test(drip));
  await shot(page, "01-cross-check");
  await page.getByTestId("cross-check-q").fill("pressure");
  await page.getByRole("button", { name: "Compare" }).click();
  await page.getByText("2x10x16 pressure treated").waitFor();
  check("search finds a single-supplier product", (await groups.count()) === 1);
  await page.getByTestId("cross-check-q").fill("titanium");
  await page.getByRole("button", { name: "Compare" }).click();
  await page.getByTestId("cross-check-empty").waitFor();
  check("no-match search says so", /No imported prices match/.test(await page.getByTestId("cross-check-empty").textContent()));

  await page.getByTestId("branch-near").fill("55401");
  const link = page.getByTestId("branch-finder").getByRole("link", { name: /Lakeside Lumber/ });
  const href = await link.getAttribute("href");
  check("branch link opens a map search near the ZIP in a new tab", href.startsWith("https://www.google.com/maps/search/") && href.includes("55401") && (await link.getAttribute("target")) === "_blank");

  const cards = page.getByTestId("provider-card");
  check("nine pricing sources listed, none connected", (await cards.count()) === 9 && (await page.getByTestId("connections").getByText("Connected", { exact: true }).count()) === 0);
  const abc = page.locator('[data-provider="abc_supply"]');
  await abc.getByTestId("provider-request").click();
  const form = abc.getByTestId("connect-form");
  await form.getByRole("combobox").selectOption({ label: "ABC Supply – Springfield" });
  await form.getByLabel("Ship-to account number").fill("100-2245");
  await form.getByLabel("Branch number").fill("0417");
  check("save is disabled until consent is ticked", await form.getByTestId("connect-save").isDisabled());
  await form.getByTestId("connect-consent").check();
  await shot(page, "02-connect-form");
  await form.getByTestId("connect-save").click();
  await page.getByText(/Request saved\. ABC Supply will go live here/).waitFor();
  await page.locator('[data-provider="abc_supply"]').getByText("Requested: waiting on supplier access").waitFor();
  check("request saved with account + branch, status Requested", /Account 100-2245 · Branch 0417/.test(await page.locator('[data-provider="abc_supply"]').textContent()));
  await page.locator('[data-provider="abc_supply"]').getByRole("button", { name: "Pause" }).click();
  await page.locator('[data-provider="abc_supply"]').getByText("Paused", { exact: true }).waitFor();
  check("pause works", true);
  await shot(page, "03-connections");
  await page.locator('[data-provider="abc_supply"]').getByRole("button", { name: "Remove" }).click();
  await page.getByText(/ABC Supply removed\. Its account number was deleted\./).waitFor();
  await page.locator('[data-provider="abc_supply"]').getByText("Not connected").waitFor();
  check("remove deletes the request", true);
  await ctx.close();
}

// 2. Suppliers page links here
{
  const { ctx, page } = await open("/projects/team/suppliers");
  await page.getByTestId("supplier-pricing-link").click();
  await page.waitForURL(/\/projects\/team\/pricing/);
  check("Suppliers page links to Supplier pricing", true);
  await ctx.close();
}

// 3. Phone + dark
{
  const { ctx, page } = await open("/projects/team/pricing", { width: 390, height: 844 });
  await page.getByTestId("cross-check-group").first().waitFor();
  check("phone: no sideways scroll", await noHScroll(page));
  await shot(page, "04-phone");
  await ctx.close();
}
{
  const { ctx, page } = await open("/projects/team/pricing", { width: 1440, height: 1000 }, "dark");
  await page.getByTestId("cross-check-group").first().waitFor();
  check("dark mode renders", true);
  await shot(page, "05-dark");
  await ctx.close();
}

await browser.close();
if (errors.length) out.push(...errors.map((e) => `✗ page error: ${e}`));
console.log(out.join("\n"));
const failed = out.filter((l) => l.startsWith("✗")).length;
console.log(`\n${out.length - failed}/${out.length} passed`);
process.exit(failed ? 1 : 0);
