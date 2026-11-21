// Batch: Enterprise (Team) company: invitations, joining, seats, roles and restrictions, teams, approval rule,
// company pipeline visibility of an estimator's bid.
import { chromium, contextFor, uiLogin, watch, recorder, BASE, USERS, q, closeDb, shot, statePath, dismissPopups, apiToken, rest } from "../lib.mjs";
const rec = recorder("enterprise");
const b = await chromium.launch();
const vp = { viewport: { width: 1440, height: 900 } };
const owner = await contextFor(b, "entOwner");
const T = (id, name, exp, fn) => rec.test(`ENT-${id}`, "Enterprise / Team", name, exp, fn);
const open = async (ctx, path) => { const p = await ctx.newPage(); const w = watch(p); await p.goto(BASE + path); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {}); await dismissPopups(p); return { p, w }; };
const [{ id: ownerId }] = await q("select id from auth.users where email=$1", [USERS.entOwner]);
const [{ id: estId }] = await q("select id from auth.users where email=$1", [USERS.entEstimator]);
let link = "";
// Test setup: start each run with the estimator outside the company (synthetic accounts only).
await q("delete from public.company_members where user_id=$1", [estId]); await q("delete from public.company_invitations where lower(email)=$1", [USERS.entEstimator]);

await T("01", "Invite an estimator", "Invitation created (seat reserved); join link available", async () => {
  const { p, w } = await open(owner, "/company/users");
  const form = p.locator("form").filter({ has: p.getByRole("button", { name: "Create invitation" }) });
  await form.locator("input").first().fill(USERS.entEstimator); await form.locator("select").first().selectOption({ label: "Estimator / Sales Rep" });
  await form.getByRole("button", { name: "Create invitation" }).click(); await p.waitForTimeout(2500);
  link = await p.locator("input[readonly]").filter({ hasText: "" }).evaluateAll((es) => es.map((e) => e.value).find((v) => /company\/join/.test(v)) ?? "");
  if (!link) link = (await p.locator("main").innerText()).match(/https?:\/\/\S*company\/join\S*/)?.[0] ?? "";
  const inv = await q("select role, accepted_at, email from public.company_invitations where lower(email)=$1 order by created_at desc limit 1", [USERS.entEstimator]).catch((e) => [{ err: e.message }]);
  await shot(p, "ent-invite");
  if (w.pageErrors.length) return { fail: w.pageErrors[0] };
  return inv[0]?.email ? `invitation ${inv[0].role}; link ${link ? "shown" : "not shown (emailed)"}` : { fail: JSON.stringify(inv) };
});
await T("02", "Estimator joins the company", "After sign-in through the join link, estimator is a company member with role estimator", async () => {
  const ctx = await b.newContext(vp); const p = await ctx.newPage();
  if (!link) {
    // Invitation emails go through the app's mailer (not configured locally); the join page with the token is the same path.
    return { fail: "no join link shown after creating the invitation" };
  }
  await p.goto(link); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  await uiLogin(p, USERS.entEstimator, { loginPath: new URL(link).pathname + new URL(link).search }); await p.waitForTimeout(1500);
  const acc = p.getByRole("button", { name: /Join|Accept/i }).first(); if (await acc.isVisible().catch(() => false)) { await acc.click(); await p.waitForTimeout(2000); }
  await ctx.storageState({ path: statePath("entEstimator") });
  const m = await q("select role from public.company_members where user_id=$1", [estId]);
  return m[0]?.role ? `member as ${m[0].role}` : { fail: `not a member; at ${p.url()}` };
});
await T("03", "Seat count updates", "2 of 3 licensed seats in use", async () => {
  const { p } = await open(owner, "/company/users"); const t = await p.locator("main").innerText();
  return (/2 of 3 licensed seats/.test(t) && !/pending invitation/.test(t)) || { fail: (t.match(/\d of \d licensed seats[^\n]*/) ?? ["no seat line"])[0] };
});
await T("04", "Estimator cannot open company billing or user management", "/company/billing and /company/users refused for estimator", async () => {
  const ctx = await b.newContext({ ...vp, storageState: statePath("entEstimator") }); const out = [];
  for (const path of ["/company/billing", "/company/users"]) {
    const p = await ctx.newPage(); await p.goto(BASE + path); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    const t = await p.locator("main").innerText().catch(() => "");
    out.push(`${path}: ${/Invite a team member|Payment method|Billing/i.test(t) && p.url().endsWith(path) && !/only|no access|isn.t available|ask/i.test(t) ? "VISIBLE" : "refused"}`);
  }
  return out.every((x) => x.endsWith("refused")) ? out.join("; ") : { fail: out.join("; ") };
});
await T("05", "Estimator cannot invite people through the API", "POST /api/company/invitations refused for estimator", async () => {
  const ctx = await b.newContext({ ...vp, storageState: statePath("entEstimator") });
  const r = await ctx.request.post(`${BASE}/api/company/invitations`, { data: { email: "sneaky@example.test", role: "manager" } });
  const made = await q("select 1 from public.company_invitations where email='sneaky@example.test'");
  return !made.length && r.status() >= 400 ? `refused ${r.status()}` : { fail: `status ${r.status()}, created=${made.length}` };
});
await T("06", "Estimator's bid shows in the owner's company pipeline", "Owner sees the estimator's bid on /company/pipeline", async () => {
  const ctx = await b.newContext({ ...vp, storageState: statePath("entEstimator") }); const { p } = await open(ctx, "/start/roofing");
  await p.waitForURL(/\/estimates\//, { timeout: 20000 }).catch(() => {}); const id = p.url().match(/estimates\/([0-9a-f-]{36})/)?.[1];
  if (!id) return { fail: `estimator could not start a bid (${p.url()})` };
  await p.waitForTimeout(2000);
  const { p: op } = await open(owner, "/company/pipeline"); const t = await op.locator("main").innerText();
  const e = (await q("select title, company_id from public.estimates where id=$1", [id]))[0];
  return e.company_id && t.includes(e.title) ? `listed (${e.title})` : { fail: `company_id ${e.company_id}; listed=${t.includes(e.title)}` };
});
await T("07", "A different company cannot see this company's bids (RLS)", "Outsider reads 0 rows of this company's estimates", async () => {
  const [{ company_id }] = await q("select company_id from public.company_members where user_id=$1", [ownerId]);
  const tok = await apiToken(USERS.outsider); const r = await rest(tok, `estimates?company_id=eq.${company_id}&select=id`);
  return Array.isArray(r.body) && r.body.length === 0 ? "0 rows" : { fail: JSON.stringify(r.body).slice(0, 120) };
});
await T("08", "Create a team", "Team saved and listed", async () => {
  const { p } = await open(owner, "/company/users");
  const f = p.locator("form").filter({ has: p.getByRole("button", { name: "Create team" }) }); await f.locator("input").first().fill("QA Roofing Team");
  await f.getByRole("button", { name: "Create team" }).click(); await p.waitForTimeout(2000);
  const t = await q("select name from public.company_teams where name='QA Roofing Team'").catch(async () => []);
  return t.length || (await p.locator("main").innerText()).includes("QA Roofing Team") ? "created" : { fail: "not saved" };
});
await T("09", "Approval rule toggle persists", "Require-approval setting saved after reload", async () => {
  const { p } = await open(owner, "/company");
  // The sidebar's Practice Mode switch (#196) is also a switch: target the approval toggle itself.
  const sw = p.getByTestId("approval-toggle");
  if (!(await sw.isVisible().catch(() => false))) return { fail: "no approval toggle" };
  const before = String(await sw.isChecked());
  await sw.click(); await p.waitForTimeout(2000); await p.reload(); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  const after = String(await p.getByTestId("approval-toggle").isChecked());
  return before !== after ? `${before} -> ${after}` : { fail: `unchanged ${before}` };
});
console.log(rec.counts); await b.close(); await closeDb();
