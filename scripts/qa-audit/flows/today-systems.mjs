// Batch: the systems merged 2026-11-20 working together (Practice Mode, legal status, staff payouts, GPS time /
// worker hub, ten-year Sales commissions, Affiliate Hub). Local stack only; synthetic people; no money, no email out.
// Run after seed.mjs:  node scripts/qa-audit/flows/today-systems.mjs
import { chromium, contextFor, watch, recorder, BASE, q, closeDb, uiLogin, dismissPopups, shot } from "../lib.mjs";
import { createHash } from "node:crypto";
const rec = recorder("today-systems");
const b = await chromium.launch();
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const tag = Date.now().toString(36);
const id = async (email) => (await q("select id from auth.users where email = $1", [email]))[0]?.id;
const owner = await id("qa-owner@audit.test");

/** Runs SQL as a signed-in user (RLS + auth.uid()), the way the app's own session would. */
async function asUser(uid, sql, params = []) {
  await q("begin");
  try {
    await q("select set_config('request.jwt.claims', $1, true), set_config('role', 'authenticated', true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
    const r = await q(sql, params);
    await q("commit");
    return r[0] ? Object.values(r[0])[0] : null;
  } catch (e) { await q("rollback"); throw e; }
}

const open = async (role, path, opts = {}) => {
  const c = await contextFor(b, role, opts); const p = await c.newPage(); const w = watch(p);
  const res = await p.goto(BASE + path); await p.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  return { c, p, w, status: res?.status() ?? 0 };
};
const clean = (w) => !w.pageErrors.length && !w.failed.some((f) => /^5\d\d /.test(f));

// ---------------------------------------------------------------------------------------------------------------
// 1. Owner pages for today's systems render without errors.
for (const path of ["/admin/staff", "/admin/payouts", "/admin/banking", "/admin/affiliates", "/admin/legal", "/sales/admin", "/projects/workforce/time-tracking", "/legal", "/affiliates", "/affiliates/terms"]) {
  await rec.test(`TS-PAGE${path}`, "Owner pages", `Open ${path}`, "200, no page errors or 5xx", async () => {
    const { c, p, w, status } = await open("owner", path);
    await shot(p, `ts-owner${path.replace(/\//g, "_")}`);
    const ok = status < 400 && clean(w) && !/\/login/.test(new URL(p.url()).pathname);
    await c.close();
    return ok ? `status ${status}` : { fail: `status ${status} url ${p.url()} errors ${[...w.pageErrors, ...w.failed].join(" | ").slice(0, 300)}` };
  });
}

// 2. Public affiliate application: stored for review; with AFFILIATE_EMAILS off nothing is emailed (logged only).
const applicant = `applicant-${tag}@creatorqa.com`;
await rec.test("TS-AFF-APPLY", "Affiliates", "Public application", "Saved as applied; email logged as off, nothing in the outbox", async () => {
  const { c, p } = await open("anon", "/affiliates/apply");
  await p.fill("input[name=email]", applicant);
  await p.fill("input[name=legal_name]", "Quinn Creator");
  const plat = p.locator("select[name=platform]"); if (await plat.count()) await plat.selectOption({ index: 1 }).catch(() => {});
  const url = p.locator("input[name=channel_url]"); if (await url.count()) await url.fill("https://example.org/quinn");
  const country = p.locator("select[name=country]"); if (await country.count()) await country.selectOption("US").catch(() => {});
  await p.locator("input[name=agree]").check();
  await p.getByRole("button", { name: /apply|submit/i }).first().click();
  await p.waitForURL(/ok=1|err=/, { timeout: 15000 }).catch(() => {});
  const row = (await q("select status from public.affiliates where email = $1", [applicant]))[0];
  const log = (await q("select status, error from public.affiliate_email_log where to_email = $1", [applicant]))[0];
  await c.close();
  if (!row) return { fail: `no affiliate row; landed on ${p.url()}` };
  return log?.status === "logged_off" ? `status ${row.status}; email ${log.status} (${log.error})` : { fail: `email log ${JSON.stringify(log)}` };
});

// 3. An active affiliate (invite -> onboarding -> approval through the real functions) and a Sales rep.
const affEmail = `aff-${tag}@creatorqa.com`;
let affCode, affUser;
await rec.test("TS-AFF-SETUP", "Affiliates", "Invite, onboard, approve", "Affiliate is active with a code", async () => {
  const tok = sha(`qa-${tag}`);
  const inv = (await q("select public.admin_affiliate_invite_create($1, $2, 'QA Creator', null, $3, 'Hi', 14) r", [owner, affEmail, tok]))[0].r;
  const { SB_URL, SERVICE_KEY } = await import("../lib.mjs");
  const u = await (await fetch(`${SB_URL}/auth/v1/admin/users`, { method: "POST", headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ email: affEmail, email_confirm: true }) })).json();
  affUser = u.id;
  await asUser(affUser, "select public.affiliate_invite_accept($1)", [tok]);
  await asUser(affUser, "select public.affiliate_my_step('welcome')");
  await asUser(affUser, "select public.affiliate_my_step('profile', $1)", [JSON.stringify({ legal_name: "QA Creator", phone: "555-0100", address_line1: "1 Main St", city: "Rochester", state: "MN", postal_code: "55901", country: "US", tax_residency: "US" })]);
  await asUser(affUser, "select public.affiliate_my_channel_self($1)", [JSON.stringify({ platform: "blog", url: `https://example.org/${tag}`, title: "QA blog" })]);
  await asUser(affUser, "select public.affiliate_my_step('channel_done')");
  for (const l of ["how_it_works", "annual_not_monthly", "ten_year_term", "eligibility", "ftc_disclosure", "honest_claims", "no_spam", "brand_use", "payouts_taxes", "getting_started"]) await asUser(affUser, "select public.affiliate_my_lesson($1)", [l]);
  await asUser(affUser, "select public.affiliate_my_step('learn_done')");
  const me = await asUser(affUser, "select public.affiliate_me()");
  await asUser(affUser, "select public.affiliate_my_agreement_accept($1, $2, 'QA Creator', '127.0.0.1', 'qa')", [me.agreement.id, sha(me.agreement.body)]);
  await q("select public.affiliate_w9_store($1, 'QA Creator', null, 'individual', null, 'ssn', '6789', 'v1.aaaaaaaaaaaaaaaa.bbbb.cccc', 'QA Creator')", [affUser]);
  await q("select public.affiliate_destination_record($1, 'mock', 'test', $2, $3, 'STRIPE TEST BANK', 'checking', '6789', 'verified')", [affUser, `rcpt_${inv.affiliate_id}`, `pm_${inv.affiliate_id}`]);
  await asUser(affUser, "select public.affiliate_my_step('submit')");
  await q("select public.admin_affiliate_decide($1, $2, 'approve', 'QA')", [owner, inv.affiliate_id]);
  affCode = (await q("select code, status from public.affiliates where id = $1", [inv.affiliate_id]))[0];
  return affCode.status === "active" ? `code ${affCode.code}` : { fail: JSON.stringify(affCode) };
});
let repCode;
await rec.test("TS-REP-SETUP", "Sales", "Active rep with a link code", "Rep code exists", async () => {
  const r = (await q("select (public.admin_sales_member_save($1, null, $2, 'QA Rep', null, 'rep', 'active', null, true)) ->> 'id' id", [owner, `rep-${tag}@repsqa.com`]))[0].id;
  await q("update public.sales_reps set status = 'active' where id = $1", [r]);
  repCode = (await q("select code from public.sales_reps where id = $1", [r]))[0].code;
  return repCode ? `code ${repCode}` : false;
});

// 4. Affiliate link -> sign up -> attributed to the affiliate. With a Sales link too, the earlier visit owns the customer.
async function signupVia(paths, email) {
  // A normal desktop user agent: the affiliate link (correctly) ignores "HeadlessChrome" as a bot.
  const c = await b.newContext({ viewport: { width: 1440, height: 900 }, userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36" }); const p = await c.newPage();
  for (const path of paths) { await p.goto(BASE + path); await p.waitForTimeout(1200); }
  const cookies = (await c.cookies()).map((k) => k.name);
  await uiLogin(p, email);
  await p.goto(BASE + "/dashboard"); await p.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(3000); // attribution is recorded after the page is sent
  await c.close();
  const uid = await id(email);
  return { uid, cookies };
}
await rec.test("TS-ATTR-AFF", "Attribution", "Affiliate link, then sign up", "Customer owned by the affiliate", async () => {
  if (!affCode) return { blocked: "no affiliate" };
  const { uid, cookies } = await signupVia([`/a/${affCode.code}?c=spring&s=youtube`], `cust-aff-${tag}@shopqa.com`);
  const ref = (await q("select affiliate_id, campaign, source from public.affiliate_referrals where user_id = $1", [uid]))[0];
  return ref ? `cookie ${cookies.includes("b2b_aff")}, campaign ${ref.campaign}` : { fail: `no referral row; cookies ${cookies.join(",")}` };
});
await rec.test("TS-ATTR-BOTH", "Attribution", "Affiliate link first, then a Sales link, then sign up", "Exactly one owner (the affiliate)", async () => {
  if (!affCode || !repCode) return { blocked: "setup failed" };
  const { uid } = await signupVia([`/a/${affCode.code}`, `/s/${repCode}`], `cust-both-${tag}@shopqa.com`);
  const a = (await q("select count(*)::int n from public.affiliate_referrals where user_id = $1", [uid]))[0].n;
  const s = (await q("select count(*)::int n from public.sales_attributions where user_id = $1", [uid]))[0].n;
  return a + s === 1 && a === 1 ? "affiliate owns it" : { fail: `affiliate ${a}, sales ${s}` };
});
await rec.test("TS-ATTR-MANUAL", "Attribution", "Sales Hub manual assign of an affiliate customer", "Refused (owned_by_affiliate)", async () => {
  const uid = await id(`cust-aff-${tag}@shopqa.com`); if (!uid) return { blocked: "no customer" };
  const rep = (await q("select id from public.sales_reps where code = $1", [repCode]))[0].id;
  const err = await q("select public.admin_sales_attribution_set($1, $2, $3, 'QA manual')", [owner, `cust-aff-${tag}@shopqa.com`, rep]).then(() => "ok", (e) => e.message);
  return err === "owned_by_affiliate" ? "refused" : { fail: `got ${err}` };
});

// 5. Affiliate Hub pages for the affiliate.
for (const path of ["/affiliate-hub", "/affiliate-hub/earnings", "/affiliate-hub/customers", "/affiliate-hub/resources", "/affiliate-hub/profile", "/affiliate-hub/calendar"]) {
  await rec.test(`TS-HUB${path}`, "Affiliate Hub", `Open ${path} as the affiliate`, "200, no errors, privacy-safe customer labels", async () => {
    const c = await b.newContext({ viewport: { width: 1440, height: 900 } }); const p = await c.newPage(); const w = watch(p);
    await uiLogin(p, affEmail, { loginPath: "/affiliate-hub/login" });
    const res = await p.goto(BASE + path); await p.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    const text = await p.locator("main").innerText().catch(() => "");
    await shot(p, `ts-hub${path.replace(/\//g, "_")}`); await c.close();
    if (text.includes(`cust-aff-${tag}`)) return { fail: "customer email shown to the affiliate" };
    return (res?.status() ?? 0) < 400 && clean(w) ? `status ${res?.status()}` : { fail: `${res?.status()} ${[...w.pageErrors, ...w.failed].join(" | ").slice(0, 300)}` };
  });
}

// 6. Practice Mode: from a practice session, payout + affiliate routes and sends are refused; nothing leaves.
await rec.test("TS-PRACTICE", "Practice Mode", "Enter practice, try payout and affiliate routes", "403 demo_blocked; no Mailpit message", async () => {
  const { c, p } = await open("pro", "/dashboard");
  await dismissPopups(p);
  const enter = await p.evaluate(async () => (await fetch("/api/demo/enter", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "practice" }) })).status);
  if (enter >= 400) { await c.close(); return { fail: `enter practice ${enter}` }; }
  await p.goto(BASE + "/dashboard"); await p.waitForTimeout(1500);
  const before = (await (await fetch("http://127.0.0.1:54324/api/v1/messages?limit=1")).json()).total ?? 0;
  const codes = await p.evaluate(async () => {
    const out = {};
    for (const u of ["/api/payouts/return", "/api/affiliate-payouts/return", "/api/payouts/export", "/api/comms"]) out[u] = (await fetch(u, { method: u === "/api/comms" ? "POST" : "GET", redirect: "manual", headers: { "content-type": "application/json" }, body: u === "/api/comms" ? "{}" : undefined })).status;
    return out;
  });
  const hub = await p.goto(BASE + "/affiliate-hub"); const hubText = await p.locator("body").innerText().catch(() => "");
  const staff = await p.goto(BASE + "/staff"); const staffUrl = p.url();
  await shot(p, "ts-practice-staff");
  await p.evaluate(async () => fetch("/api/demo/exit", { method: "POST" }));
  const after = (await (await fetch("http://127.0.0.1:54324/api/v1/messages?limit=1")).json()).total ?? 0;
  await c.close();
  const blocked = Object.entries(codes).filter(([, s]) => s !== 403);
  if (blocked.length) return { fail: `not blocked: ${JSON.stringify(codes)}` };
  if (after !== before) return { fail: `${after - before} email(s) sent` };
  if (/QA Creator|Earnings/.test(hubText) && !/sign in|not an affiliate|apply/i.test(hubText)) return { fail: "practice session saw affiliate data" };
  return `routes ${JSON.stringify(codes)}; hub ${hub?.status()}; staff ${staff?.status()} -> ${new URL(staffUrl).pathname}`;
});

// 7. Workforce: a company with an employee linked to a login. Owner sees time tracking; the employee gets the clock
//    and their own week; another company's owner gets nothing of theirs through the API.
await rec.test("TS-WORKFORCE", "GPS time / worker hub", "Owner, employee and outsider", "Employee sees own clock; outsider sees nothing", async () => {
  const entOwner = await id("qa-ent-owner@audit.test"), est = await id("qa-ent-estimator@audit.test"), out = await id("qa-outsider@audit.test");
  let company = (await q("select company_id from public.company_members where user_id = $1 and role = 'owner' limit 1", [entOwner]))[0]?.company_id;
  if (!company) company = (await q("select public.create_company($1, 'QA Roofing') id", [entOwner]))[0].id;
  if (!(await q("select 1 from public.company_members where company_id = $1 and user_id = $2", [company, est])).length)
    await q("insert into public.company_members (company_id, user_id, role, display_name) values ($1, $2, 'viewer', 'Est QA')", [company, est]);
  let res = (await q("select id from public.pm_resources where company_id = $1 and linked_user_id = $2", [company, est]))[0]?.id;
  if (!res) res = (await q("insert into public.pm_resources (company_id, kind, name, linked_user_id) values ($1, 'staff', 'Est QA', $2) returning id", [company, est]))[0].id;
  const o = await open("entOwner", "/projects/workforce/time-tracking"); const oOk = o.status < 400 && clean(o.w); await shot(o.p, "ts-workforce-owner"); await o.c.close();
  const e = await open("entEstimator", "/clock"); const eOk = e.status < 400 && clean(e.w); await shot(e.p, "ts-workforce-clock");
  const week = await e.p.evaluate(async () => (await fetch("/api/workforce/hub/week")).status); await e.c.close();
  const x = await open("outsider", "/dashboard");
  const leak = await x.p.evaluate(async (rid) => { const r = await fetch(`/api/workforce/gps?events=${rid}`); return { s: r.status, t: (await r.text()).slice(0, 200) }; }, res);
  await x.c.close();
  void out;
  const leaked = leak.s === 200 && /Est QA|lat|distance/.test(leak.t) && !/"events":\[\]/.test(leak.t);
  if (!oOk || !eOk) return { fail: `owner page ${o.status} ${o.w.failed.join(",")}; clock ${e.status} ${e.w.failed.join(",")}` };
  return leaked ? { fail: `outsider read events: ${leak.t}` } : `clock ok, week ${week}, outsider events ${leak.s}`;
});

// 8. Staff payouts: a Sales rep's payout settings page and the staff portal render; the owner's payouts page shows
//    practice mode only (no live money).
await rec.test("TS-STAFF", "Staff payouts", "Rep opens Payout Settings; payouts stay off/practice", "Page renders; payout_settings.mode is off or test", async () => {
  const r = await open("rep1", "/staff/payouts"); const ok = r.status < 400 && clean(r.w); await shot(r.p, "ts-staff-payouts"); await r.c.close();
  const mode = (await q("select mode from public.payout_settings"))[0]?.mode;
  return ok && mode !== "live" ? `status ${r.status}, mode ${mode}` : { fail: `status ${r.status}, mode ${mode}, ${r.w.failed.join(",")}` };
});

// 9. Legal status shows on the public pages (Legal Review Pending) without signing in.
await rec.test("TS-LEGAL", "Legal status", "Public /legal and /terms show the review status", "Badge text present", async () => {
  const { c, p } = await open("anon", "/terms"); const t = await p.locator("body").innerText(); await c.close();
  return /Legal Review Pending|Current Published Version/i.test(t) ? "badge shown" : { fail: "no status badge on /terms" };
});

console.log(rec.counts); await b.close(); await closeDb();
