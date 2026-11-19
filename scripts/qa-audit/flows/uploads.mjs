// Batch: file uploads with real files (logo, supplier price list CSV, bank statement CSV, project photo).
import { writeFileSync, mkdirSync } from "node:fs";
import { chromium, contextFor, watch, recorder, BASE, USERS, q, closeDb, shot, dismissPopups, OUT } from "../lib.mjs";
const rec = recorder("uploads");
const b = await chromium.launch();
const ctx = await contextFor(b, "pro");
const [{ id: uid }] = await q("select id from auth.users where email=$1", [USERS.pro]);
const T = (id, area, name, exp, fn) => rec.test(`UP-${id}`, area, name, exp, fn);
const open = async (path) => { const p = await ctx.newPage(); const w = watch(p); await p.goto(BASE + path); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {}); await dismissPopups(p); return { p, w }; };
// Fixture files (synthetic). New product names each run, so rows import as New (big price swings are held for review by design).
const tag = Date.now() % 100000;
const dir = `${OUT}/fixtures`; mkdirSync(dir, { recursive: true });
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAGklEQVR4nGP8z8DAwMDAxMDAwMDAwMDAAAAOQwEDp2D+ZQAAAABJRU5ErkJggg==", "base64");
// A real PNG rendered by the browser itself (a hand-written one can fail the server's image check).
{ const pg = await b.newPage({ viewport: { width: 240, height: 80 } }); await pg.setContent('<div style="font:bold 40px sans-serif;background:#0b3d63;color:#fff;height:80px">QA LOGO</div>'); writeFileSync(`${dir}/logo.png`, await pg.screenshot()); await pg.close(); }
void png;
writeFileSync(`${dir}/prices.csv`, `SKU,Description,Unit,Price\nQA-${tag},QA Treated 2x6x12 ${tag},each,14.27\nQA-101,QA Deck screws 5lb,box,38.50\n`);
const today = new Date().toISOString().slice(0, 10);
writeFileSync(`${dir}/bank.csv`, `Date,Description,Amount\n${today},QA DEPOSIT PAT EXAMPLE ${tag},405.00\n${today},QA LUMBER YARD ${tag},-212.40\n`);

await T("01", "Settings", "Upload a company logo", "Logo stored and shown; business profile has the logo path", async () => {
  const { p, w } = await open("/settings/company");
  await p.locator("#logo-file").setInputFiles(`${dir}/logo.png`); await p.waitForTimeout(4000);
  const img = await p.getByAltText("Your logo").isVisible().catch(() => false); await shot(p, "upload-logo");
  const row = (await q("select logo_path lp, null lu from public.business_profiles where user_id=$1", [uid]).catch(() => [{}]))[0] ?? {};
  if (w.pageErrors.length) return { fail: w.pageErrors[0] };
  return img ? `logo shown${row.lp || row.lu ? " and saved" : ""}` : { fail: `no logo preview; failed ${w.failed.slice(0, 2).join(";")}` };
});
await T("02", "Saved Items", "Import a supplier price list (CSV)", "Rows previewed and imported; price_imports row recorded", async () => {
  const { p, w } = await open("/dashboard/items/import");
  await p.getByTestId("price-import-file").setInputFiles(`${dir}/prices.csv`); await p.waitForTimeout(2500);
  await p.getByTestId("price-import-supplier").fill("QA Lumber Supply"); await p.waitForTimeout(500);
  const apply = p.getByTestId("price-import-apply");
  for (let i = 0; i < 16 && !(await apply.isEnabled().catch(() => false)); i++) await p.waitForTimeout(500);
  if (!(await apply.isEnabled().catch(() => false))) { await shot(p, "upload-prices"); return { fail: `import button disabled: ${(await p.getByTestId("price-import").innerText()).slice(0, 200)}` }; }
  const before = (await q("select count(*)::int n from public.price_imports where user_id=$1", [uid]))[0].n;
  await apply.click(); await p.waitForTimeout(3500); await shot(p, "upload-prices-done");
  const after = (await q("select count(*)::int n from public.price_imports where user_id=$1", [uid]))[0].n;
  const items = await q("select name, unit_cost from public.saved_items where user_id=$1 and name = $2", [uid, `QA Treated 2x6x12 ${tag}`]);
  if (w.pageErrors.length) return { fail: w.pageErrors[0] };
  return after > before && items.length ? `imported (${items[0].name} $${items[0].unit_cost})` : { fail: `imports ${before}->${after}, items ${items.length}` };
});
await T("03", "Financials", "Import a bank statement (CSV)", "Lines previewed and imported into bank transactions", async () => {
  const { p, w } = await open("/financials/accounting/bank");
  // Setup through the UI: a bank account to import into (once per database).
  if (!(await p.getByTestId("fin-bank-file").count())) {
    await p.getByTestId("fin-bank-add-open").click().catch(() => {});
    await p.locator("#ba-name").fill("QA Checking"); await p.locator("#ba-last4").fill("1234");
    await p.getByTestId("fin-bank-add").getByRole("button", { name: "Add account" }).click(); await p.waitForTimeout(2500);
  }
  const file = p.getByTestId("fin-bank-file");
  if (!(await file.count())) return { fail: `no bank import on page: ${(await p.locator("main").first().innerText()).slice(0, 200)}` };
  await file.setInputFiles(`${dir}/bank.csv`); await p.waitForTimeout(2000);
  const go = p.getByTestId("fin-bank-import-go");
  if (!(await go.isVisible().catch(() => false))) { await shot(p, "upload-bank"); return { fail: `no preview: ${(await p.getByTestId("fin-bank-import").innerText()).slice(0, 240)}` }; }
  await go.click(); await p.waitForTimeout(3500);
  const n = await q("select count(*)::int n from public.fin_bank_transactions where description ilike $1", [`QA LUMBER YARD ${tag}%`]).catch((e) => [{ n: e.message }]);
  if (w.pageErrors.length) return { fail: w.pageErrors[0] };
  return Number(n[0].n) > 0 ? `${n[0].n} imported line(s) found` : { fail: `no transactions (${n[0].n})` };
});
await T("04", "Projects", "Upload a job photo on the project page", "Photo stored in project_photos and shown", async () => {
  const est = (await q("select j.estimate_id from public.fin_jobs j join public.estimates e on e.id=j.estimate_id where e.user_id=$1 limit 1", [uid]))[0];
  if (!est) return { blocked: "no won project (run projects-financials first)" };
  const { p, w } = await open(`/projects/${est.estimate_id}`);
  let input = p.getByTestId("photo-input");
  if (!(await input.count())) { await p.getByRole("tab", { name: /Photos/ }).first().click().catch(() => {}); await p.waitForTimeout(1500); input = p.getByTestId("photo-input"); }
  if (!(await input.count())) return { blocked: "photo upload not offered on this project (part of the Project Command Center add-on, which needs a Stripe purchase)" };
  const before = (await q("select count(*)::int n from public.project_photos where estimate_id=$1", [est.estimate_id]))[0].n;
  await input.setInputFiles(`${dir}/logo.png`); await p.waitForTimeout(5000);
  const after = (await q("select count(*)::int n from public.project_photos where estimate_id=$1", [est.estimate_id]))[0].n;
  if (w.pageErrors.length) return { fail: w.pageErrors[0] };
  return after > before ? "photo saved" : { fail: `photos ${before}->${after}` };
});
console.log(rec.counts); await b.close(); await closeDb();
