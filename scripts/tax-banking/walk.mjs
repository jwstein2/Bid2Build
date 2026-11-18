// V6.9 browser walk (TEST DATA ONLY: local database + mocked auth + PRACTICE bank). Screenshots of the new pages.
//   scripts/test-db.sh start && export RADAR_PG_URL=$(node scripts/financials/setup-db.mjs) && node scripts/tax-banking/seed.mjs
//   PG_REST_AS_USER=00000000-0000-4000-8000-000000000001 PG_REST_PREFIXES=fin_,tax_,estimates,estimate_versions,estimate_items,estimate_groups,subcontractor_quote,change_orders,project_scope_sections,customers \
//     node scripts/ux-audit/mock-supabase.mjs &
//   NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=x SUPABASE_SECRET_KEY=x NEXT_PUBLIC_FINANCIALS=on npm run build && npx next start -p 3000 &
//   node scripts/tax-banking/walk.mjs <screenshotDir> <estimateId>
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const dir = process.argv[2] ?? "tax-banking-shots";
const EST = process.argv[3];
fs.mkdirSync(dir, { recursive: true });
const ME = "00000000-0000-4000-8000-000000000001";
const b64u = (s) => Buffer.from(s).toString("base64url");
const cookie = () => {
  const user = { id: ME, aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
  const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: ME, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
  return { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify({ access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user }))}`, domain: "localhost", path: "/" };
};
const A = "http://localhost:3000", M = "http://localhost:54321";
await fetch(`${M}/__features?created=${encodeURIComponent(new Date().toISOString())}`).catch(() => {});
const browser = await chromium.launch();
const out = [], errors = [];
const check = (name, ok, extra = "") => { out.push(`${ok ? "✓" : "✗"} ${name}${extra ? ` (${extra})` : ""}`); if (!ok) process.exitCode = 1; };
let n = 1;
async function visit(p, name, { phone = false, dark = false, act } = {}) {
  const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
  await ctx.addCookies([cookie()]);
  await ctx.addInitScript((m) => { try { localStorage.setItem("b2b-theme", JSON.stringify({ mode: m, at: Date.now() })); localStorage.setItem("b2b-onboarding-done", "1"); } catch { /* none */ } }, dark ? "dark" : "light");
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${p}: ${e.message}`));
  page.on("response", (r) => { if (r.status() >= 500 && r.url().startsWith(A)) errors.push(`${p}: ${r.status()} ${r.url()}`); });
  await page.goto(`${A}${p}`, { waitUntil: "load" });
  for (const label of ["Maybe Later", "Skip", "Not now"]) { const b = page.getByRole("button", { name: label }); if (await b.count()) await b.first().click().catch(() => {}); }
  await page.waitForTimeout(600);
  if (act) await act(page);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  if (phone) check(`${name}: no sideways scroll on phone`, wide);
  await page.screenshot({ path: path.join(dir, `${String(n++).padStart(2, "0")}-${name}${phone ? "-phone" : ""}${dark ? "-dark" : ""}.png`), fullPage: true });
  await ctx.close();
  return page;
}
const has = (t) => async (page) => check(`shows "${t}"`, (await page.getByText(t, { exact: false }).count()) > 0);

await visit("/financials/cash", "cash-line", { act: async (p) => { await has("Bank-reported balance")(p); await has("Biweekly payroll")(p); await has("$50,500.00")(p); } });
await visit("/financials/cash", "cash-bar", { act: async (p) => { await p.getByRole("radio", { name: "bar" }).click(); await p.waitForTimeout(300); } });
await visit("/financials/cash?h=90", "cash-area-90", { act: async (p) => { await p.getByRole("radio", { name: "area" }).click(); await p.locator("svg[role=img] rect[tabindex='0']").nth(20).hover(); await p.waitForTimeout(200); } });
await visit("/financials/cash", "cash-table", { act: async (p) => { await p.getByRole("radio", { name: "table" }).click(); await has("Money in")(p); } });
await visit("/financials/cash", "cash-scheduled", { dark: true, act: async (p) => { await p.getByRole("radio", { name: "Scheduled" }).click(); await p.waitForTimeout(300); } });
await visit("/financials/cash", "cash", { phone: true });
await visit("/financials/banks", "banks", { act: async (p) => { await has("Sandbox Community Bank (mock)")(p); await has("••4821")(p); check("no full account number shown", !(await p.locator("main").innerText()).match(/\d{8,}/)); } });
await visit("/financials/banks", "banks-practice-link", { act: async (p) => { await p.getByTestId("bank-connect").click(); await p.waitForTimeout(200); } });
await visit("/financials/banks", "banks", { phone: true, dark: true });
await visit("/financials/tax", "tax-updates", { act: async (p) => { await has("Olmsted County")(p); await has("Needs review")(p); await has("doesn't guarantee compliance")(p); } });
await visit("/financials/tax?view=setup", "tax-setup");
await visit("/financials/tax?view=authorities", "tax-agencies", { act: async (p) => check("51 agencies listed", (await p.locator("[data-testid=tax-authorities] tbody tr").count()) === 51) });
await visit("/financials/tax", "tax-updates", { phone: true });
await visit("/financials", "financials-home", { act: async (p) => { await has("Cash position")(p); } });
if (EST) await visit(`/estimates/${EST}`, "bid-tax-details", { act: async (p) => {
  const b = p.getByTestId("tax-details-open"); if (await b.count()) { await b.scrollIntoViewIfNeeded(); await b.click(); await p.getByTestId("tax-details").waitFor({ timeout: 8000 }).catch(() => {}); await p.waitForTimeout(1500); await p.getByTestId("tax-details").scrollIntoViewIfNeeded().catch(() => {}); }
  check("tax details panel opens", (await p.getByTestId("tax-details").count()) > 0);
} });
await browser.close();
fs.writeFileSync(path.join(dir, "walk-results.txt"), [...out, "", "Errors:", ...(errors.length ? errors : ["none"])].join("\n"));
console.log([...out, "", "Errors:", ...(errors.length ? errors : ["none"])].join("\n"));
