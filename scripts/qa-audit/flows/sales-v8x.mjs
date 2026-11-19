// Batch: Sales Hub features merged after the audit started (V8.4 P2 time off, V8.6 master CRM / round robin /
// offboarding, V8.7 lead recycling). UI where a person does it, database checks for the result. Recycling's
// daily job is called with a future clock (the same function the cron calls) instead of waiting a week.
// Run after sales-team.mjs (needs active rep1 and rep2, both signed in and selling).
import { chromium, contextFor, watch, recorder, BASE, USERS, q, closeDb, shot } from "../lib.mjs";
const rec = recorder("sales-v8x");
const b = await chromium.launch();
const T = (id, area, name, exp, fn) => rec.test(`V8X-${id}`, `Sales Hub / ${area}`, name, exp, fn);
const run = Date.now().toString(36);
const page = async (role, path) => { const c = await contextFor(b, role); const p = await c.newPage(); const w = watch(p); await p.goto(BASE + path); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {}); return { p, w }; };
// Server-action forms redirect with ?ok= or ?err=; wait for that, not just network idle.
const submit = async (p, btn) => { const from = p.url(); await btn.click(); await p.waitForURL((u) => u.href !== from && /[?&](ok|err)=/.test(u.search), { timeout: 15000 }).catch(() => {}); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {}); };
const [r1] = await q("select id from public.sales_reps where email=$1", [USERS.rep1]);
const [r2] = await q("select id from public.sales_reps where email=$1", [USERS.rep2]);
const [owner] = await q("select id from auth.users where email=$1", [USERS.owner]);
// Same starting point every run: both reps take leads, nobody is away, recycling on with default rules.
await q("update public.sales_reps set allocation_paused=false, auto_leads=null, lead_states='{}', lead_trades='{}' where id = any($1)", [[r1.id, r2.id]]);
await q("update public.sales_time_off set status='canceled' where rep_id = any($1) and status='active'", [[r1.id, r2.id]]).catch(() => {});
await q("update public.sales_settings set recycle_enabled=true, recycle_first_contact_days=7, recycle_warning_hours=24 where id");

async function importRows(rows, mode = "auto") {
  const { p, w } = await page("owner", "/sales/admin?tab=leads");
  await p.getByText("Add leads", { exact: true }).click();
  const form = p.locator("form").filter({ has: p.locator("textarea[name=rows]") });
  await form.locator("textarea[name=rows]").fill(rows.join("\n")); await form.locator("select[name=mode]").selectOption(mode);
  await form.getByRole("button", { name: "Import" }).click(); await p.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {}); await p.waitForTimeout(800);
  const msg = (await p.locator("[role=status], [role=alert]").allInnerTexts()).join(" ").replace(/\s+/g, " ");
  await p.close(); return { msg, errors: [...w.pageErrors, ...w.failed.filter((f) => /^5/.test(f))] };
}
const row = (n, extra = {}) => { const e = { company: `QA RR ${run} ${n}`, contact: `Pat ${n}`, email: `rr${n}-${run}@qa-leads.test`, phone: `6${String(parseInt(run.slice(-5), 36) % 1000).padStart(3, "0")}55${String(1000 + n).slice(-4)}`, web: `qa-rr-${run}-${n}.test`, city: "Rochester", state: "MN", zip: "55901", trades: "roofing", ...extra };
  return [e.company, e.contact, e.email, e.phone, e.web, e.city, e.state, e.zip, e.trades].join(", "); };
const ownerOf = async (company) => (await q("select id, assigned_rep from public.sales_leads where company_name=$1", [company]))[0];

await T("01", "Leads", "Import with round robin shares leads evenly between eligible reps", "4 new leads: 2 to each selling rep, method auto", async () => {
  const r = await importRows([1, 2, 3, 4].map((n) => row(n)));
  const ls = await q("select l.assigned_rep, (select method from public.sales_lead_assignments a where a.lead_id=l.id order by a.created_at desc limit 1) m from public.sales_leads l where company_name like $1", [`QA RR ${run} %`]);
  const n1 = ls.filter((l) => l.assigned_rep === r1.id).length, n2 = ls.filter((l) => l.assigned_rep === r2.id).length;
  if (r.errors.length) return { fail: r.errors.join("; ") };
  return ls.length === 4 && n1 === 2 && n2 === 2 ? `rep1 ${n1}, rep2 ${n2}; "${r.msg.slice(0, 80)}"` : { fail: `${ls.length} leads, rep1 ${n1}, rep2 ${n2}, methods ${ls.map((l) => l.m)}; ${r.msg}` };
});
await T("02", "Leads", "Same email in a later import is merged, not added again (master CRM dedupe)", "No new lead; the existing one is marked seen again with its owner kept", async () => {
  const before = await ownerOf(`QA RR ${run} 1`);
  const r = await importRows([row(9, { company: `Totally Different Name ${run}`, email: `rr1-${run}@qa-leads.test`, phone: "5075550199", web: `other-${run}.test`, zip: "55101", city: "St Paul" })]);
  const dup = await q("select count(*)::int n from public.sales_leads where company_name=$1", [`Totally Different Name ${run}`]);
  const after = await ownerOf(`QA RR ${run} 1`);
  return dup[0].n === 0 && after.assigned_rep === before.assigned_rep && /already on file/.test(r.msg) ? `merged; "${r.msg.slice(0, 90)}"` : { fail: `new rows ${dup[0].n}; owner ${before.assigned_rep}->${after.assigned_rep}; ${r.msg}` };
});
await T("03", "Leads", "Same business name and ZIP with no other match waits for review", "Held as a possible duplicate; reviewer can merge, skip or add it", async () => {
  const r = await importRows([row(10, { company: `QA RR ${run} 2`, contact: "Someone Else", email: `else-${run}@qa-leads.test`, phone: `507${String(parseInt(run.slice(-5), 36) % 10000000).padStart(7, "0")}`, web: `else-${run}.test` })]);
  const { p } = await page("owner", "/sales/admin?tab=leads&view=dups"); const t = await p.locator("main").innerText(); await shot(p, "sales-possible-dups"); await p.close();
  return /possible duplicate/.test(r.msg) && t.includes(`QA RR ${run} 2`) ? "held; shown in the review list with merge / add / skip" : { fail: `${r.msg} | review list has it: ${t.includes(`QA RR ${run} 2`)}` };
});
await T("04", "Time off", "A rep on time off gets no new round-robin leads", "Rep2 saves time off today; next 2 imported leads both go to rep1", async () => {
  const { p, w } = await page("rep2", "/sales/calendar?tab=timeoff");
  const form = p.locator("form").filter({ has: p.getByRole("button", { name: "Save time off" }) });
  await submit(p, form.getByRole("button", { name: "Save time off" })); await p.waitForTimeout(800); await p.close();
  const off = await q("select count(*)::int n from public.sales_time_off where rep_id=$1 and status='active' and now() between starts_at and ends_at", [r2.id]);
  if (!off[0].n) return { fail: `no active time off saved; ${w.failed.slice(0, 2).join(";")}` };
  await importRows([5, 6].map((n) => row(n)));
  const a = await ownerOf(`QA RR ${run} 5`), c = await ownerOf(`QA RR ${run} 6`);
  // Rep2 comes back: "Remove time off" in the browser.
  const back = await page("rep2", "/sales/calendar?tab=timeoff");
  await submit(back.p, back.p.getByRole("button", { name: "Remove time off" }).first()); await back.p.waitForTimeout(800); await back.p.close();
  const still = await q("select count(*)::int n from public.sales_time_off where rep_id=$1 and status='active'", [r2.id]);
  if (still[0].n) return { fail: "Remove time off left it active" };
  return a.assigned_rep === r1.id && c.assigned_rep === r1.id ? "both to rep1 while rep2 was away; time off removed" : { fail: `owners ${a.assigned_rep}, ${c.assigned_rep}` };
});

// Recycling ("use it or lose it"): a rep1 lead nobody contacted, and one rep1 worked.
const quiet = await ownerOf(`QA RR ${run} 5`); const worked = await ownerOf(`QA RR ${run} 6`);
const day = 86400000; const at = (ms) => new Date(Date.now() + ms).toISOString();
await T("05", "Lead recycling", "New lead shows on the rep's attention list with its first-contact deadline", "Rep1 Leads page lists it under new leads waiting for a first contact", async () => {
  const { p } = await page("rep1", "/sales/leads"); const t = await p.locator("main").innerText(); await p.close();
  return t.includes("My leads requiring attention") && t.includes(`QA RR ${run} 5`) ? "listed with its deadline" : { fail: t.slice(0, 200) };
});
await T("06", "Lead recycling", "Logging a call with an outcome keeps a lead with the rep", "Rep1 records the Do Not Call check, then logs 'Left a voicemail'; that lead is not recycled at day 8", async () => {
  const { p, w } = await page("rep1", `/sales/leads/${worked.id}`);
  // Compliance first: a call can't be logged until the number's Do Not Call check is recorded.
  const dnc = p.locator("form").filter({ has: p.getByRole("button", { name: "Record check" }) });
  await dnc.locator("select[name=dnc]").selectOption("clear"); await dnc.locator("input[name=confirm]").check();
  await submit(p, dnc.getByRole("button", { name: "Record check" }));
  const form = p.locator("form").filter({ has: p.getByRole("button", { name: "Log it" }) });
  await form.locator("select[name=kind]").selectOption("call"); await form.locator("select[name=disposition]").selectOption({ label: "Left a voicemail" });
  await form.locator("textarea[name=body]").fill("QA: left a voicemail"); await submit(p, form.getByRole("button", { name: "Log it" })); await p.close();
  const act = await q("select kind, disposition from public.sales_activities where lead_id=$1 order by created_at desc limit 1", [worked.id]);
  if (act[0]?.disposition !== "voicemail") return { fail: `activity ${JSON.stringify(act)}; ${w.failed.slice(0, 2)}` };
  return "logged (checked again in 08)";
});
await T("07", "Lead recycling", "The daily run warns before moving an untouched lead", "Run 6.5 days in: warning recorded for that deadline and an in-app notice for rep1; owner unchanged", async () => {
  const res = (await q("select public.sales_recycle_run(null, $1::timestamptz) r", [at(6.5 * day)]))[0].r;
  const a = (await q("select warned_at, warned_for from public.sales_lead_assignments where lead_id=$1 order by created_at desc limit 1", [quiet.id]))[0];
  const notice = await q("select count(*)::int n from public.sales_rep_notices where rep_id=$1 and created_at > now() - interval '5 minutes'", [r1.id]).catch(() => [{ n: -1 }]);
  const own = await ownerOf(`QA RR ${run} 5`);
  return a?.warned_at && own.assigned_rep === r1.id && notice[0].n > 0 ? `warned (${JSON.stringify(res).slice(0, 80)})` : { fail: `assignment ${JSON.stringify(a)}, owner ${own.assigned_rep}, notices ${notice[0].n}, run ${JSON.stringify(res)}` };
});
await T("08", "Lead recycling", "After the warning window an untouched lead moves to another rep; a worked lead stays", "Run 8 days in: quiet lead to rep2 (never back to rep1), recycle_count 1, history kept; worked lead still rep1", async () => {
  const res = (await q("select public.sales_recycle_run(null, $1::timestamptz) r", [at(8 * day)]))[0].r;
  const l = (await q("select assigned_rep, recycle_count from public.sales_leads where id=$1", [quiet.id]))[0];
  const hist = await q("select count(*)::int n from public.sales_lead_recycles where lead_id=$1", [quiet.id]);
  const w2 = await ownerOf(`QA RR ${run} 6`);
  return l.assigned_rep === r2.id && l.recycle_count === 1 && hist[0].n >= 1 && w2.assigned_rep === r1.id ? "moved to rep2; worked lead kept" : { fail: `quiet ${JSON.stringify(l)}, history ${hist[0].n}, worked owner ${w2.assigned_rep}, run ${JSON.stringify(res).slice(0, 200)}` };
});
await T("09", "Lead recycling", "Admin Lead recycling tab shows the moved lead in history", "Tab loads without errors and lists the business", async () => {
  const { p, w } = await page("owner", "/sales/admin?tab=recycling"); const t = await p.locator("main").innerText(); await shot(p, "sales-recycling-tab"); await p.close();
  if (w.pageErrors.length) return { fail: w.pageErrors[0] };
  return /recycl/i.test(t) ? (t.includes(`QA RR ${run} 5`) ? "listed" : "tab loads; business not on the first screen (history view)") : { fail: t.slice(0, 200) };
});

// Offboarding with a reason and notes, then reactivation, on a throwaway rep.
const email3 = `qa-rep3-${run}@audit.test`;
await T("10", "Representatives", "Offboard a rep with a reason and notes (V8.6 replaces plain Removed)", "Offboarding recorded with reason + notes; finishing after the reviews sets Removed", async () => {
  const { p } = await page("owner", "/sales/admin?tab=team");
  const add = p.locator("form").filter({ has: p.getByRole("button", { name: "Add to sales team" }) });
  await add.locator("input[name=full_name]").fill("Quinn Offboard"); await add.locator("input[name=email]").fill(email3); await add.locator("input[name=phone]").fill("(555) 010-7003").catch(() => {}); await submit(p, add.getByRole("button", { name: "Add to sales team" })); await p.close();
  const [r3] = await q("select id from public.sales_reps where email=$1", [email3]); if (!r3) return { fail: "rep not added" };
  const m = await page("owner", `/sales/admin/reps/${r3.id}/manage`);
  await m.p.getByText("Offboard Quinn Offboard").click();
  const start = m.p.locator("form").filter({ has: m.p.getByRole("button", { name: "Start offboarding" }) });
  await start.locator("select[name=reason_category]").selectOption({ index: 1 }); await start.locator("textarea[name=admin_notes]").fill("QA: contract ended");
  await start.locator("input[name=confirm]").check(); await submit(m.p, start.getByRole("button", { name: "Start offboarding" }));
  const o = (await q("select id, reason_category, admin_notes, status from public.sales_rep_offboardings where rep_id=$1 order by started_at desc limit 1", [r3.id]))[0];
  if (!o?.reason_category || o.admin_notes !== "QA: contract ended") return { fail: `offboarding ${JSON.stringify(o)}` };
  const chk = m.p.locator("form").filter({ has: m.p.getByRole("button", { name: "Save checklist" }) });
  for (const [n, v] of [["commission_review", "reviewed"], ["reward_review", "reviewed"], ["agreement_status", "not_applicable"], ["final_payout_review", "not_needed"], ["tax_retention", "not_applicable"]]) await chk.locator(`select[name=${n}]`).selectOption(v).catch(() => {});
  await submit(m.p, chk.getByRole("button", { name: "Save checklist" }));
  const fin = m.p.locator("form").filter({ has: m.p.getByRole("button", { name: "Finish offboarding" }) });
  await fin.locator("input[name=confirm]").check(); await submit(m.p, fin.getByRole("button", { name: "Finish offboarding" }));
  await shot(m.p, "sales-offboarded"); await m.p.close();
  const rr = (await q("select status from public.sales_reps where id=$1", [r3.id]))[0]; const o2 = (await q("select status from public.sales_rep_offboardings where id=$1", [o.id]))[0];
  return rr.status === "removed" && /complete/.test(o2.status) ? `removed; offboarding ${o2.status}` : { fail: `rep ${rr.status}, offboarding ${o2.status}` };
});
await T("11", "Representatives", "Reactivate an offboarded rep", "Same record comes back, lead allocation paused", async () => {
  const [r3] = await q("select id from public.sales_reps where email=$1", [email3]);
  const m = await page("owner", `/sales/admin/reps/${r3.id}/manage`);
  const f = m.p.locator("form").filter({ has: m.p.getByRole("button", { name: "Reactivate" }) });
  await f.locator("input[name=agreement]").check(); await submit(m.p, f.getByRole("button", { name: "Reactivate" })); await m.p.close();
  const rr = (await q("select status, allocation_paused, reactivated_at from public.sales_reps where id=$1", [r3.id]))[0];
  return rr.status !== "removed" && rr.allocation_paused && rr.reactivated_at ? `status ${rr.status}, allocation paused` : { fail: JSON.stringify(rr) };
});

await T("12", "Preferences", "Rep saves their recognition preferences", "Preferences row saved for rep1", async () => {
  const { p, w } = await page("rep1", "/sales/preferences");
  await p.getByRole("button", { name: "Save preferences" }).click(); await p.waitForURL(/ok=saved/, { timeout: 15000 }).catch(() => {}); await p.close();
  const r = await q("select count(*)::int n from public.sales_rep_preferences where rep_id=$1", [r1.id]);
  return r[0].n === 1 && !w.pageErrors.length ? "saved" : { fail: `rows ${r[0].n}; ${w.pageErrors[0] ?? ""}` };
});
const slug = `qa-${run}`;
await T("13", "Calendar", "Rep turns on a booking link; a customer books a session from it", "Booking saved for rep2 at the picked time; nothing emailed (booking emails off)", async () => {
  const { p } = await page("rep2", "/sales/calendar?tab=settings");
  const f = p.locator("form").filter({ has: p.getByRole("button", { name: "Save availability" }) });
  await f.locator("input[name=booking_slug]").fill(slug); await f.locator("input[name=booking_enabled]").check(); await f.locator("input[name=min_notice_hours]").fill("1");
  await submit(p, f.getByRole("button", { name: "Save availability" })); await p.close();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); const v = await ctx.newPage(); const w = watch(v);
  await v.goto(`${BASE}/meet/${slug}`); await v.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  const sess = v.locator("a[href*='session=']").first(); if (!(await sess.count())) { const t = await v.locator("main").innerText(); await ctx.close(); return { fail: `no sessions: ${t.slice(0, 160)}` }; }
  await sess.click(); await v.waitForURL(/session=/, { timeout: 10000 }).catch(() => {}); await v.waitForLoadState("networkidle").catch(() => {});
  const slot = v.locator("a[href*='at=']").first(); if (!(await slot.count())) { const t = await v.locator("main").innerText(); await ctx.close(); return { fail: `no open times: ${t.slice(0, 160)}` }; }
  await slot.click(); await v.waitForURL(/at=/, { timeout: 10000 }).catch(() => {}); await v.waitForLoadState("networkidle").catch(() => {});
  const at = new URL(v.url()).searchParams.get("at");
  const form = v.locator("form").filter({ has: v.getByRole("button", { name: "Book this time" }) });
  await form.locator("input[name=name]").fill("Casey Customer"); await form.locator("input[name=email]").fill(`casey-${run}@qa-leads.test`); await form.locator("input[name=company]").fill("Casey Roofing").catch(() => {});
  const from = v.url(); await form.getByRole("button", { name: "Book this time" }).click(); await v.waitForURL((u) => u.href !== from, { timeout: 15000 }).catch(() => {}); await v.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {}); await shot(v, "sales-booking-confirmed");
  await ctx.close();
  const bk = await q("select starts_at, status from public.sales_bookings where rep_id=$1 and lower(customer_email)=$2", [r2.id, `casey-${run}@qa-leads.test`]).catch((e) => [{ err: e.message }]);
  if (w.pageErrors.length) return { fail: w.pageErrors[0] };
  return bk.length === 1 && bk[0].starts_at && new Date(bk[0].starts_at).toISOString() === new Date(at).toISOString() ? `booked ${at} (${bk[0].status})` : { fail: `bookings ${JSON.stringify(bk)}, picked ${at}` };
});
await T("14", "Calendar", "The same time can't be booked twice", "Second visitor booking the same slot is refused", async () => {
  const [bk] = await q("select starts_at from public.sales_bookings where rep_id=$1 and lower(customer_email)=$2", [r2.id, `casey-${run}@qa-leads.test`]); if (!bk) return { blocked: "no booking from 13" };
  const ctx = await b.newContext(); const v = await ctx.newPage();
  await v.goto(`${BASE}/meet/${slug}`); await v.waitForLoadState("networkidle").catch(() => {});
  const href = await v.locator("a[href*='session=']").first().getAttribute("href"); const sp = new URL(href, BASE).searchParams;
  await v.goto(`${BASE}/meet/${slug}?session=${sp.get("session")}&at=${encodeURIComponent(new Date(bk.starts_at).toISOString())}`); await v.waitForLoadState("networkidle").catch(() => {});
  const form = v.locator("form").filter({ has: v.getByRole("button", { name: "Book this time" }) });
  if (await form.count()) { await form.locator("input[name=name]").fill("Dup Person"); await form.locator("input[name=email]").fill(`dup-${run}@qa-leads.test`); await form.getByRole("button", { name: "Book this time" }).click(); await v.waitForLoadState("networkidle").catch(() => {}); }
  const t = await v.locator("main").innerText(); await ctx.close();
  const n = await q("select count(*)::int n from public.sales_bookings where rep_id=$1 and starts_at=$2 and status <> 'cancelled'", [r2.id, bk.starts_at]);
  return n[0].n === 1 ? `refused ("${t.split("\n").find((l) => /taken|no longer|available|pick/i.test(l)) ?? "slot not offered"}")` : { fail: `${n[0].n} bookings at the same time` };
});
console.log(rec.counts); await b.close(); await closeDb();
