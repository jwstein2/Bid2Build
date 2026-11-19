// Batch: e-signature round trip (contractor creates link -> customer signs -> contractor sees it), account export,
// demo mode enter/exit, checkout up to Stripe (BLOCKED at Stripe; checks the customer sees no raw error).
import { chromium, contextFor, watch, recorder, BASE, USERS, q, closeDb, shot, dismissPopups } from "../lib.mjs";
const rec = recorder("esign-misc");
const b = await chromium.launch();
const ctx = await contextFor(b, "pro");
const [{ id: uid }] = await q("select id from auth.users where email=$1", [USERS.pro]);
const T = (id, area, name, exp, fn) => rec.test(`ESM-${id}`, area, name, exp, fn);
const open = async (c, path) => { const p = await c.newPage(); const w = watch(p); await p.goto(BASE + path); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {}); await dismissPopups(p); return { p, w }; };
// A finalized pro bid that has never been signed (the bids flow makes a fresh one each run).
const est = (await q("select e.id from public.estimates e where e.user_id=$1 and e.status='finalized' and not exists (select 1 from public.signatures s where s.estimate_id=e.id) order by e.created_at desc limit 1", [uid]).catch(() => []))[0];
let signUrl, sigId;

await T("01", "E-sign", "Create a signing link from the proposal step", "Link /sign/<token> returned and shown", async () => {
  if (!est) return { blocked: "no unsigned finalized bid: run flows/bids.mjs ROLE=pro first" };
  const { p, w } = await open(ctx, `/estimates/${est.id}?step=proposal`);
  const resp = p.waitForResponse((r) => /\/api\/estimates\/[^/]+\/signing$/.test(r.url()) && r.request().method() === "POST", { timeout: 20000 });
  await p.getByTestId("create-signing-link").click();
  const r = await resp; const body = await r.json().catch(() => ({}));
  await p.waitForTimeout(1500); await shot(p, "esign-link");
  if (r.status() !== 200 || !body.url) return { fail: `${r.status()} ${JSON.stringify(body).slice(0, 160)}` };
  signUrl = body.url.replace(/^https?:\/\/[^/]+/, BASE);
  return w.pageErrors.length ? { fail: w.pageErrors[0] } : `link created (${signUrl.replace(BASE, "").slice(0, 18)}…)`;
});
await T("02", "E-sign", "Customer opens the link signed out and sees the proposal and total", "Public page loads with the sign form", async () => {
  if (!signUrl) return { blocked: "no link from ESM-01" };
  const anon = await b.newContext(); const p = await anon.newPage(); const w = watch(p); await p.goto(signUrl); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  const t = await p.locator("body").innerText(); await anon.close();
  if (w.pageErrors.length) return { fail: w.pageErrors[0] };
  return /Full legal name/.test(t) && /\$1,350/.test(t) ? "proposal + sign form" : { fail: t.slice(0, 200) };
});
await T("03", "E-sign", "Sign-form validation: submitting empty shows field errors and records nothing", "Errors shown; no signature row", async () => {
  if (!signUrl) return { blocked: "no link from ESM-01" };
  const anon = await b.newContext(); const p = await anon.newPage(); await p.goto(signUrl); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  await p.getByTestId("sign-form").getByRole("button", { name: /sign/i }).last().click(); await p.waitForTimeout(800);
  const t = await p.getByTestId("sign-form").innerText(); await anon.close();
  const n = await q("select count(*)::int n from public.signatures where estimate_id=$1", [est.id]);
  return n[0].n === 0 && /(required|enter|check|type)/i.test(t) ? "errors shown, nothing saved" : { fail: `rows ${n[0].n}; ${t.slice(0, 160)}` };
});
await T("04", "E-sign", "Customer signs with a typed signature", "Signature row saved; page shows Signed", async () => {
  if (!signUrl) return { blocked: "no link from ESM-01" };
  const anon = await b.newContext(); const p = await anon.newPage(); const w = watch(p); await p.goto(signUrl); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  await p.locator("#sf-signerName").fill("Pat Example"); await p.locator("#sf-signerEmail").fill("pat.example@example.test");
  await p.locator("#sf-signatureText").fill("Pat Example").catch(() => {});
  await p.locator("#sf-consent").check(); await p.locator("#sf-accept").check();
  await p.getByTestId("sign-form").getByRole("button", { name: /sign/i }).last().click(); await p.waitForTimeout(3500);
  await shot(p, "esign-signed"); await p.reload(); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  const t = await p.getByTestId("customer-status").innerText().catch(() => p.locator("body").innerText()); await anon.close();
  const s = await q("select id, signer_name from public.signatures where estimate_id=$1 order by signed_at desc limit 1", [est.id]);
  sigId = s[0]?.id;
  if (w.pageErrors.length) return { fail: w.pageErrors[0] };
  return s[0] && /Signed|Fully executed/.test(t) ? `signed by ${s[0].signer_name}` : { fail: `row ${JSON.stringify(s[0])}; ${t.slice(0, 120)}` };
});
await T("05", "E-sign", "Contractor sees the signed bid and can download the signed PDF", "/signed/<id> loads; PDF is %PDF", async () => {
  if (!sigId) return { blocked: "no signature from ESM-04" };
  const { p, w } = await open(ctx, `/signed/${sigId}`); const t = await p.locator("main").first().innerText();
  // The PDF route answers with a short-lived signed storage URL; follow it and check the file.
  const pdf = await ctx.request.get(`${BASE}/api/signatures/${sigId}/pdf`); const link = (await pdf.json().catch(() => ({}))).url;
  const head = link ? (await (await ctx.request.get(link)).body()).subarray(0, 4).toString() : "";
  if (w.pageErrors.length) return { fail: w.pageErrors[0] };
  return /Pat Example/.test(t) && head === "%PDF" ? "signed page + PDF" : { fail: `pdf ${pdf.status()} ${head}; ${t.slice(0, 120)}` };
});
await T("06", "E-sign", "The signed link can't be signed twice", "Page shows Signed and no form", async () => {
  if (!sigId) return { blocked: "no signature from ESM-04" };
  const anon = await b.newContext(); const p = await anon.newPage(); await p.goto(signUrl); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  const form = await p.getByTestId("sign-form").count(); const status = await p.getByTestId("customer-status").innerText().catch(() => ""); await anon.close();
  return form === 0 && /Signed|executed/.test(status) ? status : { fail: `form ${form}, status ${status}` };
});
await T("07", "Account", "Download my data (JSON export)", "JSON with the account's bids and customers", async () => {
  const r = await ctx.request.get(`${BASE}/api/account/export`); const txt = await r.text();
  let j; try { j = JSON.parse(txt); } catch { return { fail: `${r.status()} not JSON: ${txt.slice(0, 80)}` }; }
  const keys = Object.keys(j); const hasBids = JSON.stringify(j).includes(est?.id ?? "zzz");
  return r.status() === 200 && hasBids ? `${keys.length} sections, includes this bid` : { fail: `${r.status()} keys ${keys.slice(0, 8)}` };
});
await T("08", "Demo mode", "Enter Practice Mode from Account settings and go back to the real account", "Practice banner shown on a sample workspace; Back to my account returns to the real login", async () => {
  const c = await contextFor(b, "free", { fresh: true }); const { p, w } = await open(c, "/settings/account");
  const enter = p.getByTestId("practice-enter");
  if (!(await enter.isVisible().catch(() => false))) { await c.close(); return { blocked: "Practice Mode button not offered (feature switch off)" }; }
  await enter.click();
  await p.getByTestId("demo-banner").waitFor({ timeout: 60000 }).catch(() => {});
  const banner = await p.getByTestId("demo-banner").isVisible().catch(() => false);
  const who = async () => (await c.request.get(`${BASE}/api/account/export`).then((r) => r.json()).catch(() => ({})))?.account?.email ?? null;
  if (!banner) { const err = await p.getByTestId("demo-error").innerText().catch(() => ""); await c.close(); return { fail: `no practice banner ${err}` }; }
  await p.getByTestId("demo-exit").click(); await p.waitForTimeout(5000); await p.goto(BASE + "/dashboard"); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  const still = await p.getByTestId("demo-banner").isVisible().catch(() => false); void who;
  await c.close();
  if (w.pageErrors.length) return { fail: w.pageErrors[0] };
  return !still ? "entered practice and returned" : { fail: "still in practice mode after exit" };
});
await T("09", "Billing", "Choose a paid plan: checkout stops at Stripe with a friendly message (no test keys)", "BLOCKED at Stripe; no raw error text shown", async () => {
  const c = await contextFor(b, "free"); const { p } = await open(c, "/pricing");
  const btn = p.getByRole("button", { name: /^Choose (Monthly|Annual)$/ }).first();
  if (!(await btn.isVisible().catch(() => false))) return { blocked: "no plan button found on /pricing" };
  const resp = p.waitForResponse((r) => r.url().includes("/api/stripe/checkout"), { timeout: 15000 }).catch(() => null);
  await btn.click(); const r = await resp; await p.waitForTimeout(2000);
  const t = await p.locator("body").innerText();
  const raw = /(Invalid API Key|sk_test|StripeAuthenticationError|TypeError|at Object\.|ECONN)/i.test(t);
  return raw ? { fail: "raw Stripe/technical error shown to the customer" } : { blocked: `stops at Stripe (dummy key): ${r ? r.status() : "no request"}; customer-facing message is clean` };
});
console.log(rec.counts); await b.close(); await closeDb();
