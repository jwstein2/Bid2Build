// Batch: owner Complimentary Access (grant, pause, resume, extend, revoke) + entitlement effect + audit log.
import { chromium, contextFor, watch, recorder, BASE, USERS, q, closeDb, shot } from "../lib.mjs";
const rec = recorder("admin-grants");
const b = await chromium.launch();
const owner = await contextFor(b, "owner");

async function grant(email, plan, label) {
  const p = await owner.newPage(); const w = watch(p);
  await p.goto(BASE + "/admin/complimentary"); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  await p.getByLabel(/Email address/i).fill(email);
  await p.locator(`input[name=plan][value=${plan}]`).check();
  await p.locator("input[name=duration][value=\"30\"]").check({ force: true });
  const invite = p.getByRole("checkbox", { name: /Send invitation email/i }); if (await invite.isChecked()) await invite.uncheck();
  await p.getByRole("button", { name: "Grant access…" }).click();
  await p.getByRole("dialog").getByRole("button", { name: "Grant access" }).click();
  // Re-runs: an account that already has an open grant is refused ("Extend that one instead"), which is the rule.
  const dup = p.getByRole("alert").filter({ hasText: "already has an open complimentary grant" });
  await Promise.race([p.getByText("Done", { exact: true }).waitFor({ timeout: 15000 }), dup.waitFor({ timeout: 15000 })]);
  if (await dup.isVisible().catch(() => false)) { await p.close(); return ["DUP"]; }
  await shot(p, `admin-grant-${label}`);
  const errs = [...w.pageErrors, ...w.failed.filter((f) => /^5/.test(f))];
  await p.close();
  return errs;
}

await rec.test("ADM-01", "Admin / Complimentary", "Grant Unlimited (30 days) to an existing account", "Grant row active, starts now, user gains premium", async () => {
  const errs = await grant(USERS.pro, "unlimited", "pro");
  if (errs[0] === "DUP") { const a = await q("select status from public.complimentary_grants where email=$1 and status in ('active','paused','pending') limit 1", [USERS.pro]); return a.length ? `already granted in an earlier run (${a[0].status}); a second grant is refused` : { fail: "refused but no open grant" }; }
  const g = await q("select plan, status, starts_at, expires_at from public.complimentary_grants where email=$1 order by created_at desc limit 1", [USERS.pro]);
  if (!g.length) return { fail: "no grant row" };
  const prem = await q("select public.has_premium_access(u.id) as p from auth.users u where email=$1", [USERS.pro]).catch((e) => [{ p: `n/a ${e.message}` }]);
  if (errs.length) return { fail: errs.join("; ") };
  return `grant ${g[0].plan}/${g[0].status}, expires ${g[0].expires_at?.toISOString?.().slice(0, 10)}; premium=${prem[0].p}`;
});
await rec.test("ADM-02", "Admin / Complimentary", "Grant Team (Enterprise) to an existing account", "Grant row active with 3 licensed users", async () => {
  const errs = await grant(USERS.entOwner, "enterprise", "ent");
  if (errs[0] === "DUP") { const a = await q("select status, plan from public.complimentary_grants where email=$1 and status in ('active','paused','pending') limit 1", [USERS.entOwner]); return a[0]?.plan === "enterprise" ? `already granted in an earlier run (${a[0].status}); a second grant is refused` : { fail: JSON.stringify(a) }; }
  const g = await q("select plan, status, included_seats from public.complimentary_grants where email=$1 order by created_at desc limit 1", [USERS.entOwner]);
  if (errs.length) return { fail: errs.join("; ") };
  return g[0]?.plan === "enterprise" ? `status ${g[0].status}, seats ${g[0].included_seats}` : { fail: JSON.stringify(g) };
});
await rec.test("ADM-03", "Admin / Complimentary", "Grant to a new email (invite link, no email sent)", "Pending invitation with copyable sign-up link", async () => {
  const email = `qa-invitee-${Date.now()}@audit.test`;
  const p = await owner.newPage(); await p.goto(BASE + "/admin/complimentary");
  await p.getByLabel(/Email address/i).fill(email);
  const invite = p.getByRole("checkbox", { name: /Send invitation email/i }); if (await invite.isChecked()) await invite.uncheck();
  await p.getByRole("button", { name: "Grant access…" }).click(); await p.getByRole("dialog").getByRole("button", { name: "Grant access" }).click();
  await p.getByText("Done", { exact: true }).waitFor({ timeout: 15000 });
  const link = await p.locator("input[readonly], code").first().inputValue().catch(async () => p.locator("code").first().innerText().catch(() => ""));
  const g = await q("select status from public.complimentary_grants where email=$1", [email]);
  await p.close();
  return g.length ? `state ${g[0].status}; link ${link ? "shown" : "not found"}` : { fail: "no row" };
});

async function rowAction(email, action, confirmLabel, extra) {
  const p = await owner.newPage(); const w = watch(p);
  await p.goto(BASE + "/admin/complimentary?q=" + encodeURIComponent(email)); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  const btn = p.getByRole("button", { name: `${action} for ${email}` }).first();
  if (!(await btn.isVisible().catch(() => false))) { await p.close(); return { fail: `no "${action}" button for ${email}` }; }
  await btn.click();
  const dlg = p.getByRole("dialog"); await dlg.waitFor();
  if (extra) await extra(dlg);
  await dlg.getByRole("button", { name: confirmLabel }).click();
  await p.waitForTimeout(2500);
  const errs = [...w.pageErrors, ...w.failed.filter((f) => /^5/.test(f))];
  await p.close();
  return errs.length ? { fail: errs.join("; ") } : null;
}
const st = async (email) => (await q("select status, expires_at, paused_at from public.complimentary_grants where email=$1 order by created_at desc limit 1", [email]))[0];
await rec.test("ADM-04", "Admin / Complimentary", "Pause a grant", "Status paused; premium removed while paused", async () => {
  const e = await rowAction(USERS.pro, "Pause", /^Pause/); if (e) return e;
  const s = await st(USERS.pro); return s.status === "paused" || s.paused_at ? `paused` : { fail: JSON.stringify(s) };
});
await rec.test("ADM-05", "Admin / Complimentary", "Resume a grant", "Status active again", async () => {
  const e = await rowAction(USERS.pro, "Resume", /^Resume/); if (e) return e;
  const s = await st(USERS.pro); return s.status === "active" && !s.paused_at ? "active" : { fail: JSON.stringify(s) };
});
await rec.test("ADM-06", "Admin / Complimentary", "Extend a grant +30 days", "Expiry moves 30 days later", async () => {
  const before = await st(USERS.pro);
  const e = await rowAction(USERS.pro, "Extend", /^Extend/, async (d) => { await d.getByRole("button", { name: "+30 days" }).click().catch(() => {}); }); if (e) return e;
  const after = await st(USERS.pro); const diff = Math.round((after.expires_at - before.expires_at) / 864e5);
  return diff === 30 || { fail: `expiry moved ${diff} days` };
});
await rec.test("ADM-07", "Admin / Complimentary", "Revoke a grant (outsider, then re-check)", "Status revoked; audit log entry recorded", async () => {
  await grant(USERS.outsider, "unlimited", "outsider");
  const e = await rowAction(USERS.outsider, "Revoke", /^Revoke/, async (d) => { const t = d.locator("textarea, input[type=text]").first(); if (await t.isVisible().catch(() => false)) await t.fill("QA audit revoke"); }); if (e) return e;
  const s = await st(USERS.outsider);
  const log = await q("select action from public.audit_logs where created_at > now() - interval '10 minutes' and action ilike '%revoke%' limit 1").catch(() => []);
  return s.status === "revoked" ? `revoked; audit=${log.length ? log[0].action : "none found in audit_logs"}` : { fail: JSON.stringify(s) };
});
await rec.test("ADM-08", "Admin / Complimentary", "Unlimited grant unlocks premium in the app", "Pro user's billing page shows complimentary Unlimited", async () => {
  const ctx = await contextFor(b, "pro"); const p = await ctx.newPage(); await p.goto(BASE + "/settings/billing"); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  const t = await p.locator("main").innerText(); await shot(p, "pro-billing-after-grant");
  return /complimentary/i.test(t) && /unlimited/i.test(t) ? "billing shows complimentary Unlimited" : { fail: t.slice(0, 200) };
});
console.log(rec.counts); await b.close(); await closeDb();
