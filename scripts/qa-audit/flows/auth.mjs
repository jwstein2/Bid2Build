// Batch: authentication and access control.
import { chromium, contextFor, uiLogin, latestCode, watch, recorder, BASE, USERS, q, closeDb, shot, dismissPopups, apiToken, rest } from "../lib.mjs";
const rec = recorder("auth");
const b = await chromium.launch();
const vp = { viewport: { width: 1440, height: 900 } };

await rec.test("AUTH-01", "Auth", "Protected page while signed out", "Redirects to /login", async () => {
  const p = await (await b.newContext(vp)).newPage(); await p.goto(BASE + "/dashboard/customers");
  return /\/login/.test(p.url()) || { fail: `landed on ${p.url()}` };
});
await rec.test("AUTH-02", "Auth", "Sign-in keeps the deep link (next=)", "After sign-in from /dashboard/customers you land on /dashboard/customers", async () => {
  const p = await (await b.newContext(vp)).newPage(); await p.goto(BASE + "/financials/receivables");
  const login = new URL(p.url()); const next = login.searchParams.get("next");
  return next === "/financials/receivables" || { fail: `login next=${next} (deep link lost)` };
});
const newEmail = `qa-new-${Date.now()}@audit.test`;
await rec.test("AUTH-03", "Auth", "New account via email code (sign up)", "Entering a new email + emailed code creates a free account and signs in", async () => {
  const ctx = await b.newContext(vp); const p = await ctx.newPage(); const w = watch(p);
  await uiLogin(p, newEmail);
  const u = await q("select id from auth.users where email = $1", [newEmail]);
  if (!u.length) return { fail: "no auth user" };
  if (/\/login/.test(p.url())) return { fail: `still on login: ${p.url()}` };
  await shot(p, "auth-03-new-account");
  return `landed ${p.url().replace(BASE, "")}; errors=${w.pageErrors.length}`;
});
await rec.test("AUTH-04", "Auth", "Wrong verification code", "Shows a clear message, stays signed out", async () => {
  const p = await (await b.newContext(vp)).newPage(); await p.goto(BASE + "/login"); await p.waitForTimeout(800);
  const f = p.locator("#auth-email"); if (!(await f.isVisible())) await p.getByRole("button", { name: /Continue with email/i }).click();
  await f.fill(USERS.outsider); await f.press("Enter");
  const code = p.locator("input[autocomplete=one-time-code], input[inputmode=numeric]").first(); await code.waitFor();
  await code.fill("000000"); await code.press("Enter"); await p.waitForTimeout(2500);
  const alert = await p.locator("[role=alert], .text-danger, [aria-live]").allInnerTexts();
  const msg = alert.join(" ").trim();
  const signedIn = (await p.context().cookies()).some((c) => /auth-token/.test(c.name));
  if (signedIn) return { fail: "signed in with wrong code" };
  return msg ? `message: ${msg.slice(0, 120)}` : { fail: "no visible error message" };
});
await rec.test("AUTH-05", "Auth", "Resend code", "Requesting again sends a new code email", async () => {
  const p = await (await b.newContext(vp)).newPage(); await p.goto(BASE + "/login"); await p.waitForTimeout(800);
  const f = p.locator("#auth-email"); if (!(await f.isVisible())) await p.getByRole("button", { name: /Continue with email/i }).click();
  await f.fill(USERS.outsider); await f.press("Enter"); const t = Date.now();
  await p.locator("input[autocomplete=one-time-code], input[inputmode=numeric]").first().waitFor();
  const resend = p.getByRole("button", { name: /resend|send.*again|new code/i }).first();
  if (!(await resend.isVisible().catch(() => false))) return { fail: "no resend control visible" };
  await p.waitForTimeout(61000).catch(() => {}); // cooldown
  if (await resend.isDisabled()) return { fail: "resend still disabled after 60s" };
  await resend.click(); await latestCode(USERS.outsider, t + 1000);
  return "new code received";
});
await rec.test("AUTH-06", "Auth", "Sign out", "Sign out ends the session; protected pages redirect to login", async () => {
  const ctx = await b.newContext(vp); const p = await ctx.newPage(); await uiLogin(p, USERS.outsider);
  await p.goto(BASE + "/dashboard"); await dismissPopups(p); await p.getByRole("button", { name: /^Sign out$/ }).first().click();
  await p.waitForTimeout(2000); await p.goto(BASE + "/dashboard");
  return /\/login/.test(p.url()) || { fail: `after sign out at ${p.url()}` };
});
await rec.test("AUTH-07", "Access", "Non-admin opens /admin", "Refused (redirect or not-found), never shows admin data", async () => {
  const ctx = await contextFor(b, "free"); const p = await ctx.newPage(); await p.goto(BASE + "/admin");
  const text = await p.locator("body").innerText();
  if (/Revenue|Customers \//.test(text) && /\/admin/.test(p.url()) && !/not found|no access|only/i.test(text)) return { fail: "admin content visible" };
  return `-> ${p.url().replace(BASE, "")}`;
});
await rec.test("AUTH-08", "Access", "Non-admin calls an owner-only database function, spoofing the owner id", "Permission denied; no grant created", async () => {
  const tok = await apiToken(USERS.free); const [owner] = await q("select id from auth.users where email=$1", [USERS.owner]);
  const r = await rest(tok, "rpc/admin_comp_create", { method: "POST", body: JSON.stringify({ p_caller: owner.id, p_email: "spoof@example.test", p_level: "unlimited", p_days: 7 }) });
  const made = await q("select 1 from public.complimentary_grants where lower(email)='spoof@example.test'");
  if (made.length) return { fail: "grant created by non-admin" };
  return [401, 403, 404].includes(r.status) || { fail: `status ${r.status} ${JSON.stringify(r.body).slice(0, 120)}` };
});
await rec.test("AUTH-08b", "Access", "No owner-only (p_caller) security-definer function is executable by signed-in users or anon", "Zero such functions", async () => {
  const rows = await q("select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and pg_get_function_arguments(p.oid) ~ 'p_caller' and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))");
  const tables = await q("select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity");
  if (rows.length || tables.length) return { fail: `exposed fns: ${rows.map((r) => r.proname).join(",")}; tables without RLS: ${tables.map((t) => t.relname).join(",")}` };
  return "0 exposed owner functions, every public table has RLS";
});
await rec.test("AUTH-09", "Access", "Admin page /admin for platform owner", "Owner sees the Command Center", async () => {
  const ctx = await contextFor(b, "owner"); const p = await ctx.newPage(); await p.goto(BASE + "/admin");
  return /\/admin/.test(p.url()) || { fail: p.url() };
});
await rec.test("AUTH-10", "Access", "Signed-in visit to /login", "Redirects to app (already signed in)", async () => {
  const ctx = await contextFor(b, "free"); const p = await ctx.newPage(); await p.goto(BASE + "/login");
  return !/\/login/.test(p.url()) || { fail: "login page shown to signed-in user" };
});
await rec.test("AUTH-11", "Access", "Sales portal while signed out", "/sales/leads -> /sales/login?next=/sales/leads", async () => {
  const p = await (await b.newContext(vp)).newPage(); await p.goto(BASE + "/sales/leads");
  return /\/sales\/login\?next=%2Fsales%2Fleads/.test(p.url()) || { fail: p.url() };
});
await rec.test("AUTH-12", "Access", "Contractor (no sales role) opens /sales", "Refused, no sales data", async () => {
  const ctx = await contextFor(b, "free"); const p = await ctx.newPage(); await p.goto(BASE + "/sales");
  const t = await p.locator("body").innerText();
  return !/My leads|Commissions this month/i.test(t) || { fail: "sales hub visible to contractor" };
});
console.log(rec.counts); await b.close(); await closeDb();
