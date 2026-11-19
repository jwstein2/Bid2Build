// Batch: buttons whose database functions must pass Supabase's safeupdate guard (every DELETE/UPDATE needs a
// WHERE clause in API sessions). F11: these three failed on that guard; local Supabase loads it like production.
import { chromium, contextFor, watch, recorder, BASE, q, closeDb } from "../lib.mjs";
const rec = recorder("db-guards");
const b = await chromium.launch();
const page = async (role, path) => { const c = await contextFor(b, role); const p = await c.newPage(); const w = watch(p); await p.goto(BASE + path); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {}); return { p, w }; };
await rec.test("DBG-01", "Financials", "Billing alerts: Check again", "200 from the server; no error shown", async () => {
  const { p, w } = await page("pro", "/financials"); const codes = [];
  p.on("response", (r) => { if (r.url().includes("/api/financials/actions")) codes.push(r.status()); });
  const btn = p.getByRole("button", { name: "Check again" }).first(); if (!(await btn.count())) return { blocked: "no alerts panel on this account" };
  await btn.click(); await p.waitForTimeout(2500);
  const err = (await p.locator("[role=alert]").allInnerTexts()).filter((t) => /went wrong/i.test(t));
  return codes[0] === 200 && !err.length && !w.pageErrors.length ? "refreshed" : { fail: `status ${codes}, ${err.join(" ")}` };
});
await rec.test("DBG-02", "Admin / Market Intelligence", "Recompute now", "A finished refresh run is recorded", async () => {
  const before = (await q("select count(*)::int n from market.refresh_runs where finished_at is not null"))[0].n;
  const { p } = await page("owner", "/admin/market/settings"); await p.getByRole("button", { name: "Recompute now" }).click(); await p.waitForTimeout(5000);
  const after = (await q("select count(*)::int n from market.refresh_runs where finished_at is not null"))[0].n;
  return after === before + 1 ? "run recorded" : { fail: `${before} -> ${after}` };
});
await rec.test("DBG-03", "Admin / Market Intelligence", "Save thresholds", "Settings row updated", async () => {
  const before = (await q("select updated_at from market.settings"))[0]?.updated_at?.toISOString();
  const { p } = await page("owner", "/admin/market/settings"); await p.getByRole("button", { name: "Save thresholds" }).click(); await p.waitForTimeout(3000);
  const after = (await q("select updated_at from market.settings"))[0]?.updated_at?.toISOString();
  return after && after !== before ? "saved" : { fail: `updated_at unchanged (${before})` };
});
console.log(rec.counts); await b.close(); await closeDb();
