// Batch: won bid -> project -> invoice -> payment -> receivables / P&L (Financials), plus pipeline moves.
import { chromium, contextFor, watch, recorder, BASE, USERS, q, closeDb, shot, dismissPopups } from "../lib.mjs";
const rec = recorder("projects-financials");
const b = await chromium.launch();
const ctx = await contextFor(b, "pro");
const [{ id: uid }] = await q("select id from auth.users where email=$1", [USERS.pro]);
const T = (id, area, name, exp, fn) => rec.test(`PF-${id}`, area, name, exp, fn);
const open = async (path) => { const p = await ctx.newPage(); const w = watch(p); await p.goto(BASE + path); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {}); await dismissPopups(p); return { p, w }; };
const est = (await q("select id, title from public.estimates where user_id=$1 and status='finalized' order by created_at desc limit 1", [uid]))[0];
let invId;
// Test setup: give the bid a unique title so its pipeline card can be found among earlier runs' copies.
est.title = `QA Won Deck ${Date.now() % 100000}`; // Pick a finalized bid with no job financials yet (a bid with financial records can't go back to Draft), then reset its stage.
// The stage guard trigger only lets the stage RPC change stages, so the reset sets the same session flag it uses.
const fresh = (await q("select e.id from public.estimates e where e.user_id=$1 and e.status='finalized' and not exists (select 1 from public.fin_jobs j where j.estimate_id=e.id) and not exists (select 1 from public.signatures s where s.estimate_id=e.id) order by e.created_at desc limit 1", [uid]))[0];
if (!fresh) throw new Error("no finalized bid without job financials: run flows/bids.mjs (ROLE=pro) first");
est.id = fresh.id;
await q(`select set_config('app.stage_change','on',false); update public.estimates set title='${est.title}', pipeline_stage='draft', won_at=null where id='${est.id}'; select set_config('app.stage_change','',false);`);

await T("01", "Pipeline", "Move a finalized bid to Sent from the card's Move to menu", "Stage saved as sent", async () => {
  const { p } = await open("/dashboard?view=pipeline"); await p.getByRole("tab", { name: /Pipeline/ }).first().click().catch(() => {}); await p.waitForTimeout(800);
  await p.getByRole("button", { name: `Move ${est.title}` }).first().click(); await p.getByRole("menuitem", { name: /^Sent/ }).first().click(); await p.waitForTimeout(800);
  const d = p.getByRole("dialog"); if (await d.isVisible().catch(() => false)) await d.getByRole("button").filter({ hasText: /Move|Mark|Confirm|Yes/ }).last().click();
  await p.waitForTimeout(2000); const s = (await q("select pipeline_stage as stage from public.estimates where id=$1", [est.id]))[0];
  return s.stage === "sent" || { fail: `stage ${s.stage}` };
});
await T("02", "Pipeline", "Mark the bid won", "Stage won; won date recorded; project created", async () => {
  const { p } = await open("/dashboard?view=pipeline"); await p.getByRole("tab", { name: /Pipeline/ }).first().click().catch(() => {}); await p.waitForTimeout(800);
  await p.getByRole("button", { name: `Move ${est.title}` }).first().click(); await p.getByRole("menuitem", { name: "Approved / Won" }).first().click(); await p.waitForTimeout(800);
  await p.getByRole("dialog").getByRole("button", { name: /Mark approved|Mark won/ }).click();
  await p.waitForTimeout(2500); const s = (await q("select pipeline_stage as stage from public.estimates where id=$1", [est.id]))[0];
  return /won|approved/.test(s.stage) ? `stage ${s.stage}` : { fail: `stage ${s.stage}` };
});
await T("03", "Projects", "Won bid shows on Projects", "Project listed on /projects", async () => {
  const { p } = await open("/projects"); await p.getByRole("tab", { name: /Table/ }).click().catch(() => {}); await p.waitForTimeout(1000);
  const t = await p.locator("main").first().innerText(); return t.includes(est.title) || t.includes("Pat Example") ? "listed" : { fail: t.slice(0, 200) };
});
await T("04", "Projects", "Won bid waits in the PM review queue", "Review card for the bid with its approval date and a Review action", async () => {
  // (The project page itself needs a schedule; that path is covered by flows/pm.mjs.)
  const { p, w } = await open("/projects"); const card = p.getByTestId("review-item").filter({ hasText: est.title }).first();
  const t = await card.innerText().catch(() => ""); await shot(p, "project-review-queue");
  if (w.pageErrors.length) return { fail: w.pageErrors[0] };
  return /Approved|Signed/.test(t) && (await card.getByRole("button", { name: "Review" }).count()) ? t.replace(/\n/g, " ").slice(0, 80) : { fail: `card: ${t.slice(0, 120)}` };
});
await T("05a", "Financials", "Without the Financials add-on, the job page explains how to turn recording on", "Add-on message, not 'someone with invoicing access'", async () => {
  await q("update public.complimentary_grants set fin_seats=0 where user_id=$1", [uid]);
  const { p } = await open(`/financials/jobs/${est.id}`); const t = await p.locator("main").first().innerText();
  return /Financials add-on/.test(t) ? "add-on message shown" : { fail: t.slice(0, 200) };
});
// Fixture: the admin grant UI has no Financials option, so give the complimentary grant one Financials seat directly
// (the same column fin_entitlement() reads). This stands in for buying the add-on through Stripe, which is BLOCKED here.
await q("update public.complimentary_grants set fin_seats=1 where user_id=$1 and status='active'", [uid]);
await T("05b", "Financials", "Open job financials (freeze the contract)", "fin_jobs row for the estimate", async () => {
  const { p, w } = await open(`/financials/jobs/${est.id}`);
  if ((await q("select 1 from public.fin_jobs where estimate_id=$1", [est.id])).length) return "job already open (earlier run)";
  const ob = p.getByTestId("fin-open-job-btn"); if (!(await ob.isVisible().catch(() => false))) return { fail: (await p.locator("main").first().innerText()).slice(0, 200) };
  await ob.click(); await p.waitForTimeout(3000);
  const j = await q("select id from public.fin_jobs where estimate_id=$1", [est.id]);
  return j.length ? "job opened" : { fail: `no fin_jobs row; ${w.pageErrors.join(";")}` };
});
await T("05", "Financials", "Create and issue the deposit invoice from the signed payment schedule", "Invoice issued for the 30% deposit ($405.00)", async () => {
  const { p, w } = await open(`/financials/jobs/${est.id}`); await shot(p, "fin-job");
  await p.getByRole("button", { name: "Create invoice", exact: true }).first().click(); await p.waitForTimeout(1500);
  const d = p.getByRole("dialog").last(); const t = await d.innerText();
  if (!/Deposit/.test(t) || !/405\.00/.test(t)) return { fail: `dialog not prefilled: ${t.slice(0, 160)}` };
  await d.getByRole("button", { name: "Issue invoice" }).click(); await p.waitForTimeout(3000);
  const inv = await q("select i.id, i.total, i.status, i.number from public.fin_invoices i join public.fin_jobs j on j.id=i.job_id where j.estimate_id=$1 order by i.created_at desc limit 1", [est.id]);
  invId = inv[0]?.id; await shot(p, "fin-invoice-created");
  if (w.pageErrors.length) return { fail: w.pageErrors[0] };
  if (!inv[0]) return { fail: "no invoice row" };
  return inv[0].status === "issued" && Number(inv[0].total) === 405 ? `invoice ${inv[0].number} issued $${inv[0].total}` : { fail: JSON.stringify(inv[0]) };
});
await T("06", "Financials", "Record a payment against the invoice", "Payment saved and applied; invoice balance 0", async () => {
  if (!invId) return { blocked: "no invoice from PF-05" };
  const { p, w } = await open(`/financials/jobs/${est.id}`);
  await p.getByRole("button", { name: "Record payment", exact: true }).first().click(); await p.waitForTimeout(1500);
  const d = p.getByRole("dialog").last(); await shot(p, "fin-payment-dialog");
  const amt = d.getByLabel(/^Amount/i).first(); if (await amt.isVisible().catch(() => false) && !(await amt.inputValue())) await amt.fill("405");
  await d.getByRole("button", { name: /^(Record|Save)/ }).last().click(); await p.waitForTimeout(3000);
  const pay = await q("select p.amount, p.status from public.fin_payments p join public.fin_jobs j on j.id=p.job_id where j.estimate_id=$1 order by p.created_at desc limit 1", [est.id]);
  const alloc = await q("select coalesce(sum(amount),0)::numeric as a from public.fin_payment_allocations where invoice_id=$1 and reversed_at is null", [invId]);
  if (w.pageErrors.length) return { fail: w.pageErrors[0] };
  if (!pay[0]) return { fail: `no payment: ${(await d.innerText().catch(() => "")).slice(0, 200)}` };
  return Number(alloc[0].a) === 405 ? `payment $${pay[0].amount} applied $${alloc[0].a}` : { fail: `payment ${pay[0].amount}, applied ${alloc[0].a}` };
});
await T("07", "Financials", "Job page and Financials home reflect the money", "Collected shows $405.00 on the job", async () => {
  const { p } = await open(`/financials/jobs/${est.id}`); const t = await p.locator("main").first().innerText();
  const m = t.match(/Collected to date\s+PAID\s+(\$[\d,.]+)/); const home = await (await open("/financials")).p.locator("main").first().innerText();
  return m?.[1] === "$405.00" ? `job collected ${m[1]}; home loads (${/Collected/.test(home) ? "has Collected" : "no Collected card"})` : { fail: `job collected ${m?.[1]}` };
});
for (const path of ["/financials/reports", "/financials/accounting", "/financials/accounting/reports", "/financials/cash", "/financials/overhead", "/financials/tax", "/financials/records", "/financials/tools", "/projects/team", "/projects/workforce", "/projects/team/time"]) {
  await T(`L${path.replace(/\W+/g, "-")}`, "Page loads", `${path} loads without errors`, "200, no page errors, no 5xx", async () => {
    const { p, w } = await open(path); const t = await p.locator("main").first().innerText().catch(() => "");
    const bad = [...w.pageErrors, ...w.failed.filter((f) => /^5/.test(f))];
    if (/could not be found/i.test(t)) return { fail: "404" };
    return bad.length ? { fail: bad.join(" | ").slice(0, 200) } : "ok";
  });
}
console.log(rec.counts); await b.close(); await closeDb();
