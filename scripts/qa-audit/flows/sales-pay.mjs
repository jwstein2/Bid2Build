// Batch: Sales Hub pay cycle and rules not covered by sales-crm.mjs: statement approval and payout record (record only,
// no money moves), who may do it, anniversaries (3 payments total), refunds inside vs after the 30-day hold, and the
// Academy quiz. Run after sales-team.mjs and sales-crm.mjs (needs reps, a confirmed policy and an open statement).
import fs from "node:fs";
import { chromium, contextFor, uiLogin, watch, recorder, BASE, USERS, q, closeDb, shot } from "../lib.mjs";
const rec = recorder("sales-pay");
const b = await chromium.launch();
const vp = { viewport: { width: 1440, height: 900 } };
const T = (id, area, name, exp, fn) => rec.test(`SP-${id}`, `Sales Hub / ${area}`, name, exp, fn);
const page = async (role, path) => { const c = await contextFor(b, role); const p = await c.newPage(); const w = watch(p); await p.goto(BASE + path); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {}); return { p, w }; };
const [r1] = await q("select r.id, r.code from public.sales_reps r where r.email=$1", [USERS.rep1]);
// Anniversaries and refunds on a fresh attributed customer (same functions the Stripe webhook calls).
const run = Date.now(); const cust = `qa-cust3-${run}@audit.test`; // invoice ids are unique per run, as Stripe's are
let custId;
await T("04", "Commissions", "Sale + 2 anniversaries, then nothing (3 payments total)", "Lines for years 1, 2, 3; year 4 invoice adds none", async () => {
  const ctx = await b.newContext(vp); const p = await ctx.newPage(); await p.goto(`${BASE}/s/${r1.code}`); await uiLogin(p, cust);
  await q("insert into public.admin_account_labels (user_id, label) select id, 'genuine' from auth.users where email=$1 on conflict (user_id) do update set label='genuine'", [cust]);
  await p.goto(BASE + "/dashboard"); await p.waitForTimeout(2500); await ctx.close();
  [{ id: custId }] = await q("select id from auth.users where email=$1", [cust]);
  for (const [inv, days] of [[`in_qa3_y1_${run}`, 0], [`in_qa3_y2_${run}`, 366], [`in_qa3_y3_${run}`, 731], [`in_qa3_y4_${run}`, 1096]]) {
    await q(`select public.sales_sync_billing($1, 'sub_qa_3', 'active', 'monthly', null, 1999, '{}'::jsonb, $2, 1999, now() + interval '${days} days')`, [custId, inv]);
  }
  const c = await q("select year_no, amount_cents from public.sales_commissions where user_id=$1 and kind='commission' order by year_no", [custId]);
  return c.map((x) => x.year_no).join(",") === "1,2,3" && c.every((x) => x.amount_cents === 1999) ? "years 1,2,3 at $19.99; none for year 4" : { fail: JSON.stringify(c) };
});
await T("05", "Commissions", "Anniversary only if the customer is active and paid", "A past-due renewal with nothing paid creates no anniversary line", async () => {
  const before = (await q("select count(*)::int n from public.sales_commissions where user_id=$1", [custId]))[0].n;
  await q("select public.sales_sync_billing($1, 'sub_qa_3', 'past_due', 'monthly', null, 1999, '{}'::jsonb, null, 0, null)", [custId]);
  const after = (await q("select count(*)::int n from public.sales_commissions where user_id=$1", [custId]))[0].n;
  return after === before ? "no new line" : { fail: `${before} -> ${after}` };
});
await T("06", "Commissions", "Full refund inside the 30-day hold cancels that line", "Year-3 line (still on hold) canceled", async () => {
  // The hold counts from when the line was recorded (the webhook's arrival), so refund 5 days after that.
  await q("select public.sales_invoice_refunded($1, true, now() + interval '5 days')", [`in_qa3_y3_${run}`]);
  const c = (await q("select status from public.sales_commissions where user_id=$1 and year_no=3", [custId]))[0];
  return /cancel|revers|void|inelig/.test(c.status) ? c.status : { fail: c.status };
});
await T("07", "Commissions", "Refund after the hold: no clawback", "Year-1 line paid/approved earlier is kept (flagged, not taken back)", async () => {
  await q("select public.sales_close_month(now() + interval '45 days')");
  const before = (await q("select status, amount_cents from public.sales_commissions where user_id=$1 and year_no=1", [custId]))[0];
  await q("select public.sales_invoice_refunded($1, true, now() + interval '60 days')", [`in_qa3_y1_${run}`]);
  const after = (await q("select status, amount_cents from public.sales_commissions where user_id=$1 and year_no=1", [custId]))[0];
  const neg = (await q("select count(*)::int n from public.sales_commissions where user_id=$1 and amount_cents < 0", [custId]))[0].n;
  return after.amount_cents === 1999 && neg === 0 && !/revers/.test(after.status) ? `kept (${before.status} -> ${after.status})` : { fail: `${JSON.stringify(before)} -> ${JSON.stringify(after)}, negatives ${neg}` };
});

// Statement approval: the next month-end puts this run's earned year-1 line on an open statement. Each run moves
// one month further out, because a month whose statement is already approved or paid takes no new lines.
await T("07b", "Payouts", "Earned line goes on the next open month-end statement", "Line attached to an open statement", async () => {
  for (let m = 2; m < 40; m++) {
    await q(`select public.sales_close_month(now() + interval '${m} months')`);
    const c = (await q("select statement_id from public.sales_commissions where user_id=$1 and year_no=1", [custId]))[0];
    if (c?.statement_id) { const s = (await q("select status, period_month::text pm from public.sales_statements where id=$1", [c.statement_id]))[0]; return s.status === "open" ? `on the ${s.pm} statement` : { fail: JSON.stringify(s) }; }
  }
  return { fail: "never attached to a statement" };
});
const stmt = (await q("select id, total_cents from public.sales_statements where rep_id=$1 and status='open' order by period_month limit 1", [r1.id]))[0];
await T("01", "Payouts", "Sales Admin may approve other reps' statements but can't record payouts (owner only, V8.3)", "Approve offered for rep1's statement; no Record payout", async () => {
  const { p } = await page("salesAdmin", "/sales/admin?tab=statements");
  const approve = await p.getByRole("button", { name: /^Approve/ }).count(); const pay = await p.getByRole("button", { name: "Record payout" }).count();
  return pay === 0 && (approve > 0 || !stmt) ? `approve ${approve}, record payout ${pay}` : { fail: `approve ${approve}, record ${pay}` };
});
await T("02", "Payouts", "Owner approves the rep's open statement", "Statement approved with approver and time recorded", async () => {
  if (!stmt) return { blocked: "no open statement (run sales-crm.mjs first)" };
  const { p, w } = await page("owner", "/sales/admin?tab=statements");
  const card = p.locator("form").filter({ has: p.locator(`input[name=id][value="${stmt.id}"]`) }).filter({ has: p.getByRole("button", { name: /^Approve/ }) }).first();
  await card.getByRole("button", { name: /^Approve/ }).click(); await p.waitForTimeout(2500);
  const s = (await q("select status, approved_at, approved_by from public.sales_statements where id=$1", [stmt.id]))[0]; await shot(p, "sales-statement-approved");
  if (w.pageErrors.length) return { fail: w.pageErrors[0] };
  return s.status === "approved" && s.approved_by ? `approved $${(stmt.total_cents / 100).toFixed(2)}` : { fail: JSON.stringify(s) };
});
await T("03", "Payouts", "Owner records the payout (check, reference) after paying outside the app", "Statement paid; lines paid; rep sees it as paid", async () => {
  if (!stmt) return { blocked: "no open statement" };
  const { p, w } = await page("owner", "/sales/admin?tab=statements");
  const form = p.locator("form").filter({ has: p.locator(`input[name=id][value="${stmt.id}"]`) }).filter({ has: p.getByRole("button", { name: "Record payout" }) }).first();
  await form.locator("select[name=method]").selectOption("check"); await form.locator("input[name=reference]").fill("QA check 1001");
  await form.getByRole("button", { name: "Record payout" }).click(); await p.waitForTimeout(2500);
  const s = (await q("select status, paid_at from public.sales_statements where id=$1", [stmt.id]))[0];
  const lines = await q("select status from public.sales_commissions where statement_id=$1", [stmt.id]);
  const rep = await page("rep1", "/sales/commissions"); const t = await rep.p.locator("main").innerText();
  if (w.pageErrors.length) return { fail: w.pageErrors[0] };
  return s.status === "paid" && lines.every((l) => l.status === "paid") && /paid/i.test(t) ? `paid; ${lines.length} line(s) paid; rep sees Paid` : { fail: `${JSON.stringify(s)} lines ${lines.map((l) => l.status)}` };
});

// Academy quiz: answers graded on the server.
const src = fs.readFileSync(new URL("../../../src/lib/sales/academy.ts", import.meta.url), "utf8");
const qStart = src.indexOf("quiz: [", src.indexOf('id: "prospecting"'));
const block = src.slice(qStart, src.indexOf("\n    ],", qStart));
const answers = [...block.matchAll(/answer: (\d)/g)].map((m) => Number(m[1]));
const quiz = async (pick) => {
  const c = await contextFor(b, "rep2"); const p = await c.newPage(); await p.goto(BASE + "/sales/academy/prospecting"); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  for (let i = 0; i < answers.length; i++) await p.locator(`input[type=radio][name=q${i}]`).nth(pick(i)).check();
  await p.getByRole("button", { name: /Submit|Check|Grade/ }).first().click(); await p.waitForTimeout(2500);
  const t = await p.locator("main").innerText(); await p.close(); return t;
};
const [r2] = await q("select id from public.sales_reps where email=$1", [USERS.rep2]);
await T("08", "Academy", "Wrong answers don't pass the topic quiz", "Score shown, not passed; progress not marked passed", async () => {
  if (answers.length < 3) return { fail: `could not read quiz answers (${answers.length})` };
  await q("delete from public.sales_academy_progress where rep_id=$1 and topic='prospecting'", [r2.id]).catch(() => {});
  const t = await quiz((i) => (answers[i] + 1) % 4);
  const pr = await q("select passed_at is not null as passed from public.sales_academy_progress where rep_id=$1 and topic='prospecting'", [r2.id]).catch(() => []);
  return !pr.some((x) => x.passed) && /\d+\s*(of|\/)\s*\d+/.test(t) ? "not passed" : { fail: `progress ${JSON.stringify(pr)}; ${t.slice(0, 120)}` };
});
await T("09", "Academy", "Right answers pass the topic quiz", "Passed and recorded", async () => {
  const t = await quiz((i) => answers[i]);
  const pr = await q("select passed_at is not null as passed from public.sales_academy_progress where rep_id=$1 and topic='prospecting'", [r2.id]).catch((e) => [{ err: e.message }]);
  return pr.some((x) => x.passed) ? "passed and recorded" : { fail: `progress ${JSON.stringify(pr)}; ${t.slice(0, 120)}` };
});
console.log(rec.counts); await b.close(); await closeDb();
