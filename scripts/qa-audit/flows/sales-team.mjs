// Batch: Sales Hub V8 administration: policy confirmation, adding reps, invite links (create, replace,
// accept), rep sign-in, editing, suspension/removal and reinstatement, role capabilities, isolation.
import { chromium, contextFor, uiLogin, watch, recorder, BASE, USERS, q, closeDb, shot, statePath } from "../lib.mjs";
const rec = recorder("sales-team");
const b = await chromium.launch();
const owner = await contextFor(b, "owner");
const T = (id, name, exp, fn) => rec.test(`SAL-${id}`, "Sales Hub / Administration", name, exp, fn);
const vp = { viewport: { width: 1440, height: 900 } };

async function ownerPage(path) { const p = await owner.newPage(); const w = watch(p); await p.goto(BASE + path); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {}); return { p, w }; }
const repRow = async (email) => (await q("select r.*, (select count(*) from public.sales_rep_invites i where i.rep_id=r.id) invites from public.sales_reps r where lower(email)=$1", [email]))[0];

await T("01", "Confirm the commission policy (Policies tab)", "New confirmed policy version; warning banner gone", async () => {
  const { p, w } = await ownerPage("/sales/admin?tab=policy");
  const form = p.locator("form").filter({ has: p.getByRole("button", { name: "Save policy" }) });
  await form.locator("input[name=note]").fill("QA audit confirm");
  await form.locator("input[name=confirm]").check();
  await form.getByRole("button", { name: "Save policy" }).click(); await p.waitForTimeout(1500); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  const v = await q("select version, confirmed_at, note from public.sales_policy_versions order by version desc limit 1").catch(async () => q("select * from public.sales_policy_versions order by created_at desc limit 1"));
  const banner = await p.getByText("Commission policy not confirmed yet").isVisible().catch(() => false);
  await shot(p, "sales-policy-confirmed");
  if (w.pageErrors.length) return { fail: w.pageErrors.join(";") };
  return !banner ? `latest version ${JSON.stringify(v[0]).slice(0, 160)}` : { fail: "banner still shown" };
});

async function addRep(name, email, role = "rep", sells = true) {
  const { p, w } = await ownerPage("/sales/admin?tab=team");
  const form = p.locator("form").filter({ has: p.getByRole("button", { name: "Add to sales team" }) });
  await form.locator("input[name=full_name]").fill(name); await form.locator("input[name=email]").fill(email);
  await form.locator("input[name=phone]").fill("(555) 010-7000");
  await form.locator("select[name=role]").selectOption(role);
  const s = form.locator("input[name=sells]"); if (await s.count()) { if (sells) await s.check(); else await s.uncheck(); }
  await form.getByRole("button", { name: "Add to sales team" }).click(); await p.waitForTimeout(1500); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {}); await p.waitForTimeout(800);
  const msg = await p.locator("[role=status], [role=alert], .notice").allInnerTexts().catch(() => []);
  await p.close(); return { errors: w.pageErrors, msg: msg.join(" ").slice(0, 160) };
}
await T("02", "Add a sales rep", "sales_reps row (status invited), permanent referral code", async () => {
  const r0 = await addRep("Riley Rep One", USERS.rep1); const r = await repRow(USERS.rep1);
  return r ? `status ${r.status}, role ${r.role}, code ${r.code}` : { fail: `no rep row; ${r0.msg}` };
});
await T("03", "Add a second rep and a Sales Administrator (non-selling)", "Rows created with roles rep and admin (sells=false)", async () => {
  await addRep("Robin Rep Two", USERS.rep2); await addRep("Sam Sales Admin", USERS.salesAdmin, "admin", false);
  const a = await repRow(USERS.salesAdmin); const r2 = await repRow(USERS.rep2);
  return a?.role === "admin" && a?.sells === false && r2 ? "rep2 + admin created" : { fail: JSON.stringify({ a: a && { role: a.role, sells: a.sells }, r2: !!r2 }) };
});
await T("04", "Duplicate rep email is refused", "Second add with the same email does not create another row", async () => {
  const r = await addRep("Riley Duplicate", USERS.rep1); const n = await q("select count(*)::int n from public.sales_reps where lower(email)=$1", [USERS.rep1]);
  return n[0].n === 1 ? `refused/merged (${r.msg || "no message shown"})` : { fail: `${n[0].n} rows` };
});

const links = {};
async function createInvite(email) {
  const r = await repRow(email);
  const { p } = await ownerPage("/sales/admin?tab=team");
  const card = p.locator("div.p-5, section, article").filter({ hasText: email }).filter({ has: p.getByRole("button", { name: /invite link/i }) }).last();
  await card.getByRole("button", { name: /invite link/i }).click(); await p.waitForTimeout(1500); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {}); await p.waitForTimeout(800);
  const val = await p.locator(`input[aria-label^="Invite link for"]`).first().inputValue().catch(() => "");
  if (!val) await shot(p, `sales-invite-missing-${email.split("@")[0]}`);
  const url = p.url(); await p.close(); return { link: val, rep: r, url };
}
await T("05", "Create an invite link for a rep", "Link /sales/invite/<token> shown once; only a hash stored", async () => {
  const { link, rep, url } = await createInvite(USERS.rep1); links.rep1 = link;
  const inv = await q("select token_hash, expires_at, revoked_at from public.sales_rep_invites where rep_id=$1 order by created_at desc", [rep.id]).catch((e) => [{ err: e.message }]);
  if (!/\/sales\/invite\//.test(link)) return { fail: `no link shown (${link})` };
  const token = link.split("/").pop();
  const stored = JSON.stringify(inv[0]);
  if (stored.includes(token)) return { fail: "raw token stored" };
  if (url.includes(token)) return { fail: "raw token in the page address (browser history, logs)" }; // F4
  return `link shown; expires ${inv[0].expires_at?.toISOString?.().slice(0, 10)}`;
});
await T("06", "New invite link replaces (revokes) the old one", "Old link explains it was replaced; new link works", async () => {
  const old = links.rep1; const { link } = await createInvite(USERS.rep1); links.rep1 = link;
  const p = await (await b.newContext(vp)).newPage(); await p.goto(old); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  const t = await p.locator("body").innerText(); await shot(p, "sales-invite-old-link");
  return /replaced|no longer|revoked|newer/i.test(t) ? `old link: "${t.split("\n").find((l) => /replaced|no longer|revoked|newer/i.test(l))}"` : { fail: t.slice(0, 200) };
});
await T("07", "Unknown invite token", "Plain explanation, no crash", async () => {
  const p = await (await b.newContext(vp)).newPage(); const w = watch(p); await p.goto(BASE + "/sales/invite/abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG"); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  const t = await p.locator("body").innerText(); return w.pageErrors.length ? { fail: w.pageErrors[0] } : `"${t.slice(0, 120).replace(/\n/g, " ")}"`;
});
await T("08", "Rep accepts invite: opens link, signs in with code, lands in their Sales Hub", "Invite accepted, rep active and linked, /sales shows their hub", async () => {
  const ctx = await b.newContext(vp); const p = await ctx.newPage(); const w = watch(p);
  await p.goto(links.rep1); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {}); await shot(p, "sales-invite-welcome");
  const btn = p.getByRole("button", { name: /Continue with email|Sign in|Get started|Accept/i }).first(); if (await btn.isVisible().catch(() => false)) await btn.click();
  await uiLogin(p, USERS.rep1, { loginPath: new URL(links.rep1).pathname });
  await p.waitForTimeout(2000); await p.goto(BASE + "/sales"); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  await ctx.storageState({ path: statePath("rep1") });
  const r = await repRow(USERS.rep1); const inv = await q("select accepted_at from public.sales_rep_invites where rep_id=$1 order by created_at desc limit 1", [r.id]);
  await shot(p, "sales-rep1-hub");
  if (!/\/sales/.test(p.url()) || /login/.test(p.url())) return { fail: `at ${p.url()}` };
  return r.status === "active" && inv[0]?.accepted_at ? `active, accepted; hub at ${p.url().replace(BASE, "")}` : { fail: `status ${r.status}, accepted ${inv[0]?.accepted_at}; errors ${w.pageErrors.join(";")}` };
});
await T("09", "Sign in through /sales/login (rep2 via invite, then sales login)", "Rep2 reaches /sales after accepting; sales admin reaches /sales/admin", async () => {
  for (const [role, email] of [["rep2", USERS.rep2], ["salesAdmin", USERS.salesAdmin]]) {
    const { link } = await createInvite(email); const ctx = await b.newContext(vp); const p = await ctx.newPage();
    await uiLogin(p, email, { loginPath: new URL(link).pathname }); await p.waitForTimeout(1500);
    await ctx.storageState({ path: statePath(role) }); await ctx.close();
  }
  const ctx = await b.newContext({ ...vp, storageState: statePath("salesAdmin") }); const p = await ctx.newPage(); await p.goto(BASE + "/sales/admin"); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  const ok = /\/sales\/admin/.test(p.url()); await shot(p, "sales-admin-hub");
  return ok ? "both signed in; sales admin sees Admin Sales Hub" : { fail: p.url() };
});
await T("10", "Edit a rep (name + phone)", "Change saved and shown after reload", async () => {
  const { p } = await ownerPage("/sales/admin?tab=team");
  const card = p.locator("div.p-5").filter({ hasText: USERS.rep2 }).filter({ has: p.locator("summary") }).last();
  await card.locator("summary", { hasText: "Edit" }).click();
  const f = card.locator("form"); await f.locator("input[name=full_name]").fill("Robin Rep Two Edited"); await f.locator("input[name=phone]").fill("(555) 010-7111");
  await f.getByRole("button", { name: "Save" }).click(); await p.waitForTimeout(1500); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  await p.reload(); const r = await repRow(USERS.rep2);
  const shown = (await p.locator("main").innerText()).includes("Robin Rep Two Edited");
  return r.full_name === "Robin Rep Two Edited" && r.phone === "(555) 010-7111" && shown ? "saved and shown after reload" : { fail: JSON.stringify({ n: r.full_name, ph: r.phone, shown }) };
});
async function setStatus(email, status) {
  const { p } = await ownerPage("/sales/admin?tab=team");
  const card = p.locator("div.p-5").filter({ hasText: email }).filter({ has: p.locator("summary") }).last();
  await card.locator("summary", { hasText: "Edit" }).click();
  await card.locator("form select[name=status]").selectOption(status);
  await card.locator("form").getByRole("button", { name: "Save" }).click(); await p.waitForTimeout(1500); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {}); await p.close();
}
await T("11", "Suspend a rep: they lose Sales Hub access, data kept", "Status suspended; rep's /sales refused; rep row and history preserved", async () => {
  await setStatus(USERS.rep2, "suspended");
  const ctx = await b.newContext({ ...vp, storageState: statePath("rep2") }); const p = await ctx.newPage(); await p.goto(BASE + "/sales"); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  const t = await p.locator("body").innerText(); const r = await repRow(USERS.rep2);
  const blocked = !/My leads|Your link|Team goal/i.test(t) || /suspended|no access|not active/i.test(t);
  return r.status === "suspended" && blocked ? `suspended; rep sees: "${t.slice(0, 100).replace(/\n/g, " ")}"` : { fail: `status ${r.status}; hub visible=${!blocked}` };
});
await T("12", "Reinstate (Active) after suspension", "Status active; rep can open Sales Hub again with the same link/code", async () => {
  const before = await repRow(USERS.rep2); await setStatus(USERS.rep2, "active"); const r = await repRow(USERS.rep2);
  const ctx = await b.newContext({ ...vp, storageState: statePath("rep2") }); const p = await ctx.newPage(); await p.goto(BASE + "/sales"); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  return r.status === "active" && r.code === before.code && /\/sales/.test(p.url()) && !/login/.test(p.url()) ? `active, code kept ${r.code}` : { fail: `status ${r.status} url ${p.url()}` };
});
await T("13", "Remove a rep, then reinstate (data preserved)", "Removed rep can't sign in; setting Active restores them with the same id/code", async () => {
  const before = await repRow(USERS.rep2); await setStatus(USERS.rep2, "removed"); const mid = await repRow(USERS.rep2);
  const { p } = await ownerPage("/sales/admin?tab=team"); const editable = await p.locator("div.p-5").filter({ hasText: USERS.rep2 }).locator("summary").count();
  if (!editable) return { fail: "removed rep has no Edit control, so they can't be reinstated from the UI" };
  await setStatus(USERS.rep2, "active"); const after = await repRow(USERS.rep2);
  return mid.status === "removed" && ["active", "invited"].includes(after.status) && after.id === before.id && after.code === before.code ? "removed then reinstated, same id and code" : { fail: JSON.stringify({ mid: mid.status, after: after.status }) };
});
await T("14", "Termination with a required reason and notes", "Feature per spec: offboarding asks for reason + notes", async () => {
  const { p } = await ownerPage("/sales/admin?tab=team");
  const t = await p.locator("main").innerText();
  return /reason/i.test(t) && /offboard|terminat/i.test(t) ? "present" : { blocked: "NOT IMPLEMENTED: only Access = Active/Suspended/Removed with no reason or notes (structured offboarding is queued in V8.6)" };
});
await T("15", "Sales Administrator cannot change commission policy", "Policy save refused for Sales Admin; owner-only", async () => {
  const ctx = await b.newContext({ ...vp, storageState: statePath("salesAdmin") }); const p = await ctx.newPage(); await p.goto(BASE + "/sales/admin?tab=policy"); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  const save = p.getByRole("button", { name: "Save policy" }); const visible = await save.isVisible().catch(() => false);
  if (!visible) return "Save policy not offered to Sales Admin";
  const before = await q("select count(*)::int n from public.sales_policy_versions");
  await p.locator("input[name=confirm]").check().catch(() => {}); await save.click(); await p.waitForTimeout(1500); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  const after = await q("select count(*)::int n from public.sales_policy_versions");
  return after[0].n === before[0].n ? "save refused by server" : { fail: "Sales Admin created a policy version" };
});
await T("16", "Rep cannot open the Admin Sales Hub", "/sales/admin refused for a plain rep", async () => {
  const ctx = await b.newContext({ ...vp, storageState: statePath("rep1") }); const p = await ctx.newPage(); await p.goto(BASE + "/sales/admin"); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  const t = await p.locator("main").innerText().catch(() => "");
  return !/Admin Sales Hub/.test(t) ? `-> ${p.url().replace(BASE, "")}` : { fail: "rep sees Admin Sales Hub" };
});
await T("17", "Owner rep activity view and export", "View activity opens the rep page; export downloads a file", async () => {
  const r = await repRow(USERS.rep1); const { p } = await ownerPage(`/sales/admin/reps/${r.id}`);
  const ok = !/could not be found/i.test(await p.locator("body").innerText());
  const resp = await owner.request.get(`${BASE}/sales/admin/reps/${r.id}/export`);
  return ok && resp.status() === 200 ? `page ok; export ${resp.headers()["content-type"]}` : { fail: `page ok=${ok}, export ${resp.status()}` };
});
console.log(rec.counts); await b.close(); await closeDb();
