// Batch: Sales Hub rep workflows: leads (create, duplicate guard, details, stage, notes, tasks), lead
// isolation between reps, owner lead assignment, referral link attribution, commission ledger math per
// policy v2 (simulated paid invoices through the same database functions the Stripe webhook calls),
// first-month cancel, 30-day hold, month close, accelerators settings, dual-role switcher.
import { chromium, contextFor, uiLogin, watch, recorder, BASE, USERS, q, closeDb, shot, statePath, apiToken, rest } from "../lib.mjs";
const rec = recorder("sales-crm");
const b = await chromium.launch();
const vp = { viewport: { width: 1440, height: 900 } };
const as = (role) => b.newContext({ ...vp, storageState: statePath(role) });
const T = (id, area, name, exp, fn) => rec.test(`SCRM-${id}`, `Sales Hub / ${area}`, name, exp, fn);
const rep = async (email) => (await q("select * from public.sales_reps where lower(email)=$1", [email]))[0];
const r1 = await rep(USERS.rep1), r2 = await rep(USERS.rep2);
const lead = { company: `QA Roofing Co ${Date.now() % 100000}`, email: `owner${Date.now() % 100000}@qa-roofing.example.test` };
let leadId;

await T("01", "Leads", "Rep adds a lead", "Lead saved, owned by the rep, listed on My leads", async () => {
  const ctx = await as("rep1"); const p = await ctx.newPage(); const w = watch(p); await p.goto(BASE + "/sales/leads"); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  const f = p.locator("form").filter({ has: p.getByRole("button", { name: "Add lead" }) });
  const sum = p.locator("summary", { hasText: /add/i }).first(); if (await sum.isVisible().catch(() => false) && !(await f.locator("input[name=company_name]").isVisible())) await sum.click();
  await f.locator("input[name=company_name]").fill(lead.company); await f.locator("input[name=contact_name]").fill("Casey Owner");
  await f.locator("input[name=email]").fill(lead.email); await f.locator("input[name=phone]").fill("(555) 010-3300");
  await f.locator("input[name=city]").fill("Rochester"); await f.locator("input[name=state]").fill("MN"); await f.locator("input[name=zip]").fill("55901");
  await f.getByRole("button", { name: "Add lead" }).click(); await p.waitForTimeout(1500); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  const row = (await q("select id, assigned_rep as rep_id, stage from public.sales_leads where company_name=$1", [lead.company]))[0];
  leadId = row?.id; await shot(p, "sales-rep-leads");
  if (!row) return { fail: `no lead row; errors ${w.pageErrors.join(";")}` };
  return row.rep_id === r1.id && (await p.locator("main").innerText()).includes(lead.company) ? `lead ${row.stage}, owned by rep1, listed` : { fail: `rep_id ${row.rep_id}` };
});
await T("02", "Leads", "Duplicate lead warning", "Adding the same company/email again warns instead of silently duplicating", async () => {
  const ctx = await as("rep1"); const p = await ctx.newPage(); await p.goto(BASE + "/sales/leads"); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  const f = p.locator("form").filter({ has: p.getByRole("button", { name: "Add lead" }) });
  const sum = p.locator("summary", { hasText: /add/i }).first(); if (await sum.isVisible().catch(() => false) && !(await f.locator("input[name=company_name]").isVisible())) await sum.click();
  await f.locator("input[name=company_name]").fill(lead.company + " LLC"); await f.locator("input[name=phone]").fill("555-010-3300"); await f.locator("input[name=zip]").fill("55901");
  await f.getByRole("button", { name: "Add lead" }).click(); await p.waitForTimeout(1500); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  const n = (await q("select count(*)::int n from public.sales_leads where company_name like $1", [lead.company + "%"]))[0].n;
  const t = await p.locator("main").innerText();
  return n === 1 ? `blocked: "${(t.match(/[^\n]*(duplicate|already)[^\n]*/i) ?? [""])[0].slice(0, 120)}"` : { fail: `${n} rows for the same email` };
});
await T("02b", "Leads", "Duplicate check by email (same owner email, different spelling of the name, no ZIP)", "Flagged as a possible duplicate", async () => {
  const tok = await apiToken(USERS.rep2);
  const r = await rest(tok, "rpc/sales_crm_lead_create", { method: "POST", body: JSON.stringify({ p: { company_name: "QA Roofing Company", email: lead.email, trades: [], allow_duplicate: false } }) });
  if (r.body?.ok === false) return `flagged (${r.body.error})`;
  await q("delete from public.sales_leads where id=$1", [r.body?.lead?.id]);
  return { fail: "another rep added a lead with the same owner email (V8.6 master CRM says email is a duplicate key)" };
});
await T("03", "Leads", "Lead details: log a call note", "Activity saved and shown on the lead timeline", async () => {
  const ctx = await as("rep1"); const p = await ctx.newPage(); await p.goto(`${BASE}/sales/leads/${leadId}`); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  const f = p.locator("form").filter({ has: p.getByRole("button", { name: "Log it" }) });
  await f.locator("select[name=kind]").selectOption("call"); await f.locator("[name=body]").fill("QA: called, interested in a demo Tuesday");
  await f.getByRole("button", { name: "Log it" }).click(); await p.waitForTimeout(1500); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {}); await p.reload();
  const a = await q("select kind, body from public.sales_activities where lead_id=$1 order by created_at desc limit 1", [leadId]);
  return a[0]?.kind === "call" && (await p.locator("main").innerText()).includes("interested in a demo") ? "saved + shown after reload" : { fail: JSON.stringify(a) };
});
await T("04", "Leads", "Add a follow-up task and mark it done, then reopen", "Task saved; done/reopen toggles persist", async () => {
  const ctx = await as("rep1"); const p = await ctx.newPage(); await p.goto(`${BASE}/sales/leads/${leadId}`); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  const f = p.locator("form").filter({ has: p.getByRole("button", { name: "Add task" }) });
  await f.locator("[name=title]").fill("QA follow-up call"); await f.locator("[name=due]").fill("2026-11-25");
  await f.getByRole("button", { name: "Add task" }).click(); await p.waitForTimeout(1500); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  const t1 = await q("select id, done_at, due_at from public.sales_tasks where lead_id=$1 and title='QA follow-up call'", [leadId]).catch(async () => q("select * from public.sales_tasks where lead_id=$1", [leadId]));
  if (!t1.length) return { fail: "task not saved" };
  await p.getByRole("button", { name: "Done" }).first().click(); await p.waitForTimeout(1500); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  const t2 = await q("select done_at from public.sales_tasks where id=$1", [t1[0].id]);
  await p.getByRole("button", { name: "Reopen" }).first().click(); await p.waitForTimeout(1500); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  const t3 = await q("select done_at from public.sales_tasks where id=$1", [t1[0].id]);
  return t2[0].done_at && !t3[0].done_at ? "added, done, reopened" : { fail: JSON.stringify({ t2: t2[0], t3: t3[0] }) };
});
await T("05", "Leads", "Change lead stage and details", "Stage + phone saved; shown after reload", async () => {
  const ctx = await as("rep1"); const p = await ctx.newPage(); await p.goto(`${BASE}/sales/leads/${leadId}`); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  const f = p.locator("form").filter({ has: p.getByRole("button", { name: "Save details" }) });
  const opts = await f.locator("select[name=stage] option").evaluateAll((os) => os.map((o) => o.value));
  const target = opts.find((v) => /contact|demo|qualif/i.test(v)) ?? opts[1];
  await f.locator("select[name=stage]").selectOption(target); await f.locator("input[name=phone]").fill("(555) 010-3399");
  await f.getByRole("button", { name: "Save details" }).click(); await p.waitForTimeout(1500); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  const l = (await q("select stage, phone from public.sales_leads where id=$1", [leadId]))[0];
  return l.stage === target && l.phone === "(555) 010-3399" ? `stage ${l.stage}` : { fail: JSON.stringify(l) };
});
await T("06", "Isolation", "Another rep cannot open this lead by URL", "rep2 gets refused/not found; no lead details", async () => {
  const ctx = await as("rep2"); const p = await ctx.newPage(); await p.goto(`${BASE}/sales/leads/${leadId}`); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  const t = await p.locator("body").innerText();
  return !t.includes(lead.company) ? `refused (${p.url().replace(BASE, "")})` : { fail: "rep2 sees rep1's lead" };
});
await T("07", "Isolation", "Another rep cannot read this lead through the database API", "RLS returns no rows for rep2", async () => {
  const tok = await apiToken(USERS.rep2); const r = await rest(tok, `sales_leads?id=eq.${leadId}&select=id,company_name`);
  const r3 = await rest(tok, `sales_activities?lead_id=eq.${leadId}&select=id`);
  const denied = (x) => (Array.isArray(x.body) && x.body.length === 0) || [401, 403].includes(x.status) || x.body?.code === "42501";
  return denied(r) && denied(r3) ? `refused (${r.status}${r.body?.code ? " " + r.body.code : ""})` : { fail: `leads ${JSON.stringify(r.body).slice(0, 100)}` };
});
await T("08", "Isolation", "A contractor customer cannot read any sales data", "RLS returns no rows from sales_leads / sales_commissions / sales_reps", async () => {
  const tok = await apiToken(USERS.free);
  const out = []; for (const t of ["sales_leads", "sales_commissions", "sales_reps", "sales_activities"]) { const r = await rest(tok, `${t}?select=id&limit=5`); out.push(`${t}:${Array.isArray(r.body) ? r.body.length : r.status}`); }
  return out.every((x) => /:(0|401|403|404)$/.test(x)) ? out.join(" ") : { fail: out.join(" ") };
});
await T("09", "Leads", "Owner sees the lead in All leads and reassigns it to rep2", "Assignment saved; lead moves to rep2; rep1 no longer sees it", async () => {
  const ctx = await contextFor(b, "owner"); const p = await ctx.newPage(); await p.goto(BASE + "/sales/admin?tab=leads"); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  const t = await p.locator("main").innerText(); if (!t.includes(lead.company)) return { fail: "lead not in All leads" };
  const form = p.locator("form").filter({ has: p.locator("input[name=lead]") });
  await form.getByRole("checkbox", { name: `Select ${lead.company}` }).check();
  const sel = form.locator("select[name=rep]");
  if (!(await sel.count())) return { fail: "no assign control found" };
  const val = r2.id;
  await sel.selectOption(val); await form.getByRole("button", { name: /assign|update|move/i }).first().click(); await p.waitForTimeout(1500); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  const l = (await q("select assigned_rep as rep_id from public.sales_leads where id=$1", [leadId]))[0];
  return l.rep_id === r2.id ? "reassigned to rep2" : { fail: `rep_id now ${l.rep_id}` };
});
const custEmail = `qa-cust-${Date.now()}@audit.test`;
await T("10", "Attribution", "Visitor opens a rep link, then signs up: account attributed to that rep", "Cookie set by /s/<code>; sales_attributions row for rep1 after first sign-in", async () => {
  const ctx = await b.newContext(vp); const p = await ctx.newPage(); await p.goto(`${BASE}/s/${r1.code}`); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  const cookie = (await ctx.cookies()).find((c) => c.name === "b2b_rep");
  if (!cookie) return { fail: `no b2b_rep cookie (landed ${p.url()})` };
  await uiLogin(p, custEmail);
  // Synthetic emails (.test) are excluded from rep credit as test accounts (referral_excluded); label this one genuine
  // the way the owner would, then load the app again so attribution is recorded.
  await q("insert into public.admin_account_labels (user_id, label) select id, 'genuine' from auth.users where email=$1 on conflict (user_id) do update set label='genuine'", [custEmail]);
  await p.goto(BASE + "/dashboard"); await p.waitForTimeout(3000);
  const a = await q("select a.rep_id from public.sales_attributions a join auth.users u on u.id=a.user_id where u.email=$1", [custEmail]);
  return a[0]?.rep_id === r1.id ? `landed ${new URL(p.url()).pathname}; attributed to rep1` : { fail: `attribution ${JSON.stringify(a)}` };
});
await T("11", "Attribution", "Attributed customer shows on the rep's Customers page", "rep1 /sales/customers lists the new account", async () => {
  const ctx = await as("rep1"); const p = await ctx.newPage(); await p.goto(BASE + "/sales/customers"); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  const t = await p.locator("main").innerText(); await shot(p, "sales-rep-customers");
  return t.includes(custEmail) || /1 customer|signed up/i.test(t) ? "listed" : { fail: t.slice(0, 200) };
});
// Commission math. The webhook computes the basis (monthly list price, src/lib/sales/basis.ts, unit tested) and calls
// sales_sync_billing; we call the same function with the webhook's arguments.
const [{ id: custId }] = await q("select id from auth.users where email=$1", [custEmail]);
await T("12", "Commissions", "Paid first invoice (monthly $19.99) creates a sale-month commission of $19.99 on a 30-day hold", "1 line, amount 1999, status held/pending, policy version recorded", async () => {
  await q("select public.sales_sync_billing($1, 'sub_qa_1', 'active', 'monthly', null, 1999, '{\"source\":\"qa\"}'::jsonb, 'in_qa_1', 1999, now())", [custId]);
  const c = await q("select amount_cents, status, year_no, policy_version, earned_at from public.sales_commissions where user_id=$1", [custId]);
  if (c.length !== 1) return { fail: `${c.length} lines` };
  return c[0].amount_cents === 1999 && c[0].year_no === 1 ? `1999 cents, ${c[0].status}, policy v${c[0].policy_version}` : { fail: JSON.stringify(c[0]) };
});
await T("13", "Commissions", "Same invoice delivered twice (webhook retry) doesn't double count", "Still 1 line", async () => {
  await q("select public.sales_sync_billing($1, 'sub_qa_1', 'active', 'monthly', null, 1999, '{}'::jsonb, 'in_qa_1', 1999, now())", [custId]);
  const n = (await q("select count(*)::int n from public.sales_commissions where user_id=$1", [custId]))[0].n; return n === 1 || { fail: `${n} lines` };
});
await T("14", "Commissions", "Second month's invoice inside year 1 pays nothing extra", "Still 1 line (3 payments total: sale + 2 anniversaries)", async () => {
  await q("select public.sales_sync_billing($1, 'sub_qa_1', 'active', 'monthly', null, 1999, '{}'::jsonb, 'in_qa_2', 1999, now() + interval '31 days')", [custId]);
  const n = (await q("select count(*)::int n from public.sales_commissions where user_id=$1 and kind='commission'", [custId]))[0].n; return n === 1 || { fail: `${n} lines` };
});
await T("15", "Commissions", "Rep sees the pending commission on My commissions", "$19.99 shown as pending/on hold", async () => {
  const ctx = await as("rep1"); const p = await ctx.newPage(); await p.goto(BASE + "/sales/commissions"); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  const t = await p.locator("main").innerText(); await shot(p, "sales-rep-commissions");
  return t.includes("19.99") ? "shows $19.99" : { fail: t.slice(0, 300) };
});
await T("16", "Commissions", "Owner sees it on Commission approvals", "Line listed with the rep's name and $19.99", async () => {
  const ctx = await contextFor(b, "owner"); const p = await ctx.newPage(); await p.goto(BASE + "/sales/admin?tab=commissions"); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  const t = await p.locator("main").innerText(); return t.includes("19.99") ? "listed" : { fail: t.slice(0, 300) };
});
await T("17", "Commissions", "Month close before the 30-day hold ends leaves the line held", "No statement line yet", async () => {
  await q("select public.sales_close_month(now())");
  const c = (await q("select status, statement_id from public.sales_commissions where user_id=$1", [custId]))[0];
  return !c.statement_id ? `still ${c.status}` : { fail: JSON.stringify(c) };
});
await T("18", "Commissions", "Month close after the hold (simulated +45 days) makes it earned on a statement", "Status earned/approved-ready with a statement", async () => {
  await q("select public.sales_close_month(now() + interval '45 days')");
  const c = (await q("select status, statement_id, earned_at from public.sales_commissions where user_id=$1", [custId]))[0];
  return c.earned_at || c.statement_id || /earned|approved|payable/.test(c.status) ? `status ${c.status}, statement ${c.statement_id ? "yes" : "no"}` : { fail: JSON.stringify(c) };
});
// Annual customer + first-month cancel (second customer, direct attribution through the rep link function).
const cust2 = `qa-cust2-${Date.now()}@audit.test`;
await T("19", "Commissions", "Annual plan ($149) pays on monthly list price: $19.99, not $149/12", "Commission 1999 when basis comes from monthly list", async () => {
  const ctx = await b.newContext(vp); const p = await ctx.newPage(); await p.goto(`${BASE}/s/${r1.code}`); await uiLogin(p, cust2);
  await q("insert into public.admin_account_labels (user_id, label) select id, 'genuine' from auth.users where email=$1 on conflict (user_id) do update set label='genuine'", [cust2]);
  await p.goto(BASE + "/dashboard"); await p.waitForTimeout(2500);
  const [{ id }] = await q("select id from auth.users where email=$1", [cust2]);
  // basis.ts: annual_basis = monthly_list -> 1999 for an annual subscriber (tests/sales-*.test.ts cover the function).
  await q("select public.sales_sync_billing($1, 'sub_qa_2', 'active', 'annual', null, 1999, '{\"annual\":true}'::jsonb, 'in_qa_a1', 14900, now())", [id]);
  const c = await q("select amount_cents, status from public.sales_commissions where user_id=$1", [id]);
  return c[0]?.amount_cents === 1999 ? `1999 (${c[0].status})` : { fail: JSON.stringify(c) };
});
await T("20", "Commissions", "Customer cancels inside the first month: rep not paid for that sale", "Sale-month line canceled/voided", async () => {
  const [{ id }] = await q("select id from auth.users where email=$1", [cust2]);
  await q("select public.sales_customer_canceled($1, now() + interval '10 days')", [id]);
  const c = (await q("select amount_cents, status, reason from public.sales_commissions where user_id=$1", [id]))[0];
  return /cancel|void|revers/.test(c.status) ? `${c.status} (${c.reason ?? ""})` : { fail: JSON.stringify(c) };
});
await T("21", "Commissions", "Stripe webhook -> commission path end to end", "Signed invoice.paid event creates the line", async () => ({ blocked: "Needs Stripe test-mode keys: the webhook re-fetches the subscription from Stripe (no test keys available; live keys must not be used). Database half verified in SCRM-12..20." }));
await T("22", "Recognition", "Owner opens Recognition & incentives and saves accelerator rules (off by default)", "Settings saved; accelerators stay off until an active-from month is set", async () => {
  const ctx = await contextFor(b, "owner"); const p = await ctx.newPage(); const w = watch(p); await p.goto(BASE + "/sales/admin?tab=recognition"); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  const btn = p.getByRole("button", { name: /save/i }).first(); if (!(await btn.isVisible().catch(() => false))) return { fail: "no save control on Recognition tab" };
  const before = await q("select count(*)::int n from public.sales_accelerators").catch(() => [{ n: -1 }]);
  await btn.click(); await p.waitForTimeout(1500); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  const t = await p.locator("main").innerText(); const errs = w.pageErrors.concat(w.failed.filter((f) => /^5/.test(f)));
  await shot(p, "sales-recognition");
  return errs.length ? { fail: errs.join(";") } : /error|couldn.t/i.test(t.slice(0, 400)) ? { fail: t.slice(0, 200) } : `saved (rows before ${before[0].n})`;
});
await T("23", "Recognition", "Rep sees personal-best progress (no Bronze-Diamond rank)", "Rep hub shows personal best / own best month, no rank tiers", async () => {
  const ctx = await as("rep1"); const p = await ctx.newPage(); await p.goto(BASE + "/sales"); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  const t = await p.locator("main").innerText();
  if (/\b(Bronze|Diamond|Platinum)\b/.test(t)) return { fail: "rank tiers still shown" };
  return /best/i.test(t) ? "personal best shown" : { fail: "no personal-best progress on rep hub" };
});
await T("24", "Roles", "Dual-role Sales Admin who also sells gets the My / Admin switcher", "Switcher visible; switching changes the view", async () => {
  // Make the sales admin a selling admin through the owner UI.
  const own = await contextFor(b, "owner"); const p0 = await own.newPage(); await p0.goto(BASE + "/sales/admin?tab=team");
  const card = p0.locator("div.p-5").filter({ hasText: USERS.salesAdmin }).filter({ has: p0.locator("summary") }).last();
  await card.locator("summary", { hasText: "Edit" }).click(); await card.locator("form input[name=sells]").check(); await card.locator("form").getByRole("button", { name: "Save" }).click(); await p0.waitForTimeout(1500);
  const ctx = await as("salesAdmin"); const p = await ctx.newPage(); await p.goto(BASE + "/sales"); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  const sw = p.getByRole("navigation", { name: "Choose hub" }).locator("a:not([aria-current])");
  const n = await sw.count(); if (!n) return { fail: "no switcher" };
  const from = p.url(); await sw.first().click(); await p.waitForTimeout(1500);
  return p.url() !== from ? `switched ${new URL(from).pathname} -> ${new URL(p.url()).pathname}` : { fail: "switcher did nothing" };
});
// Round robin, recycling, time off, offboarding and the reward/preferences/calendar pages: flows/sales-v8x.mjs.
console.log(rec.counts); await b.close(); await closeDb();
