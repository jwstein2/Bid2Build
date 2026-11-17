// Browser walk for contractor-side signatures (V5.3). Real SQL for every signing table and function runs in a
// throwaway database through scripts/radar/pg-rest.mjs; the rest of the app uses the UX mock. Test data only.
//   scripts/test-db.sh start
//   npx tsx scripts/esign/fixture.ts > /tmp/esign-fixture.json
//   export RADAR_PG_URL=$(node scripts/contractor/setup-db.mjs /tmp/esign-fixture.json)
//   PG_REST_PREFIXES=contractor_,signatures,signing_requests,estimate_versions,company_members,companies,accept_signing,record_signed_pdf \
//     MOCK_ESIGN_FIXTURE=/tmp/esign-fixture.json MOCK_RECENT_SIGNIN=1 node scripts/ux-audit/mock-supabase.mjs &
//   (build + `next start` with NEXT_PUBLIC_ESIGNATURES=on NEXT_PUBLIC_CONTRACTOR_SIGNING=on against the mock on :54321)
//   node scripts/contractor/walk.mjs <screenshotDir>
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const { Client } = require("pg");

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = process.argv[2] ?? "contractor-shots";
fs.mkdirSync(OUT, { recursive: true });
const TOKEN = "walkTokenAbcdefghijklmnopqrstuvwxyz01234567";
const E = (n) => `11111111-1111-4111-8111-11111111111${n}`;
const db = new Client({ connectionString: process.env.RADAR_PG_URL }); await db.connect();

const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600 * 24 * 365 * 50, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };
const browser = await chromium.launch();
const noPopup = () => { try { localStorage.setItem("b2b:onboarding", JSON.stringify({ status: "dismissed", at: new Date().toISOString(), synced: true })); } catch { /* */ } };
async function ctxFor({ signedIn = false, viewport = { width: 1280, height: 900 }, mobile = false } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, acceptDownloads: true, hasTouch: mobile, isMobile: mobile });
  if (signedIn) await ctx.addCookies([authCookie]);
  await ctx.addInitScript(noPopup);
  return ctx;
}
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const shot = (p, name, full = true) => p.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full });
const errors = [];
const watch = (p) => p.on("pageerror", (e) => errors.push(String(e)));
const q1 = async (sql, params) => (await db.query(sql, params)).rows[0];

// ---------- 1. Company Profile → Proposal Signing ----------
{
  const ctx = await ctxFor({ signedIn: true });
  const p = await ctx.newPage(); watch(p);
  await p.goto(`${BASE}/settings/company/signing`, { waitUntil: "networkidle" });
  const policy = p.getByTestId("signing-policy");
  await policy.waitFor();
  check("Proposal Signing page loads the saved policy (Mode A, auto allowed)", (await p.getByTestId("policy-auto").isChecked()) && /Authorized company signer|company signer/i.test(await policy.innerText()));
  const roster = await p.getByTestId("signers-card").innerText();
  check("roster: owner always authorized, estimator not authorized, no signature images", /Always authorized/.test(roster) && /Riley Brooks/.test(roster) && /Not authorized/.test(roster) && (await p.getByTestId("signers-card").locator("img").count()) === 0);
  await shot(p, "01-company-proposal-signing__desktop");
  // Owner authorizes the estimator for their own bids, no automatic application.
  await p.getByTestId("authorize").first().click();
  await p.locator("input[id^='t-']").fill("Sales Representative");
  const [r] = await Promise.all([p.waitForResponse((x) => x.url().includes("/api/signing/authorizations") && x.request().method() === "POST"), p.getByTestId("confirm-authorize").click()]);
  check("owner authorizes estimator (own bids)", r.status() === 200, String(r.status()));
  await p.getByText("Signs own bids").first().waitFor({ timeout: 5000 }).catch(() => {});
  const auth = await q1("select scope, auto_apply_allowed, title, granted_by from public.contractor_signing_authorizations where status = 'active'");
  check("authorization stored with the owner as grantor", auth?.scope === "own_bids" && auth?.auto_apply_allowed === false && auth?.title === "Sales Representative" && auth?.granted_by === user.id, JSON.stringify(auth));
  await shot(p, "02-company-rep-authorized__desktop");
  // Turn on sales rep signatures (Mode B) and save: a new policy revision is recorded.
  const rev0 = Number((await q1("select revision from public.contractor_signing_policies")).revision);
  await p.getByTestId("mode-sales_rep").check();
  await p.getByTestId("policy-reps").check();
  await p.getByTestId("signing-policy").screenshot({ path: path.join(OUT, "02b-company-mode-b__desktop.png") });
  const [s] = await Promise.all([p.waitForResponse((x) => x.url().includes("/api/signing/policy") && x.request().method() === "PUT"), p.getByTestId("save-policy").click()]);
  const rev1 = Number((await q1("select revision from public.contractor_signing_policies")).revision);
  check("saving the policy records a new revision + history row", s.status() === 200 && rev1 === rev0 + 1 && Number((await q1("select count(*) n from public.contractor_signing_policy_history")).n) >= 2, `${rev0}→${rev1}`);
  await ctx.close();
  const m = await ctxFor({ signedIn: true, viewport: { width: 390, height: 844 }, mobile: true });
  const mp = await m.newPage(); watch(mp);
  await mp.goto(`${BASE}/settings/company/signing`, { waitUntil: "networkidle" });
  check("Proposal Signing 390px: no horizontal overflow", (await overflow(mp)) <= 0);
  await shot(mp, "03-company-proposal-signing__m390");
  await m.close();
}

// ---------- 2. Account Settings → My Signature ----------
{
  const ctx = await ctxFor({ signedIn: true });
  const p = await ctx.newPage(); watch(p);
  await p.goto(`${BASE}/settings/account/signature`, { waitUntil: "networkidle" });
  await p.getByTestId("my-signature-current").waitFor();
  const cur = await p.getByTestId("my-signature-current").innerText();
  check("My Signature shows the signature on file (v1, automatic application on)", /Alex Rivera/.test(cur) && /version 1/i.test(cur) && /Automatic application/.test(cur), cur.replace(/\n/g, " | ").slice(0, 200));
  check("My Signature shows the owner's authority", /owner/i.test(await p.getByTestId("my-authorization").innerText()));
  await shot(p, "04-my-signature-on-file__desktop");
  // Update: draw a new signature, adopt it, leave automatic application unchecked.
  await p.getByRole("button", { name: "Update signature" }).click();
  await p.getByTestId("signature-form").waitFor();
  await p.getByRole("radio", { name: "Draw" }).click();
  const pad = p.locator("#ms-signatureImage");
  await pad.scrollIntoViewIfNeeded();
  const b = await pad.boundingBox();
  await p.mouse.move(b.x + 20, b.y + b.height * 0.7); await p.mouse.down();
  for (let i = 0; i <= 40; i++) await p.mouse.move(b.x + 20 + i * ((b.width - 40) / 40), b.y + b.height * (0.5 + 0.25 * Math.sin(i / 3)));
  await p.mouse.up();
  await p.fill("#ms-title", "Owner");
  const [noAdopt] = await Promise.all([p.waitForTimeout(400).then(() => null), p.getByTestId("save-signature").click()]);
  void noAdopt;
  check("saving without 'Adopt this signature' is refused in the form", /adopt/i.test(await p.getByTestId("signature-form").innerText()) && Number((await q1("select count(*) n from public.contractor_signer_credentials")).n) === 1);
  await p.check("#ms-adopt");
  await shot(p, "05-my-signature-update-drawn__desktop");
  const [r] = await Promise.all([p.waitForResponse((x) => x.url().includes("/api/signing/credential") && x.request().method() === "POST"), p.getByTestId("save-signature").click()]);
  check("new signature saved as version 2 (identity checked by recent sign-in)", r.status() === 200, String(r.status()));
  const creds = (await db.query("select version, status, method, auto_apply_authorized from public.contractor_signer_credentials order by version")).rows;
  check("v1 superseded, v2 active, drawn, automatic application now OFF", creds.length === 2 && creds[0].status === "superseded" && creds[1].status === "active" && creds[1].method === "drawn" && creds[1].auto_apply_authorized === false, JSON.stringify(creds.map((c) => [c.version, c.status, c.method, c.auto_apply_authorized])));
  await p.getByTestId("my-signature-current").waitFor();
  await shot(p, "06-my-signature-v2__desktop");
  await ctx.close();
  const m = await ctxFor({ signedIn: true, viewport: { width: 390, height: 844 }, mobile: true });
  const mp = await m.newPage(); watch(mp);
  await mp.goto(`${BASE}/settings/account/signature`, { waitUntil: "networkidle" });
  check("My Signature 390px: no horizontal overflow", (await overflow(mp)) <= 0);
  await shot(mp, "07-my-signature__m390");
  await m.close();
}

// ---------- 3. Dashboard + signed proposal awaiting contractor (customer-first, manual) ----------
const deck = await q1("select id from public.signatures where estimate_id = $1", [E(2)]);
{
  const ctx = await ctxFor({ signedIn: true });
  const p = await ctx.newPage(); watch(p);
  await p.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  const card = p.getByTestId("awaiting-countersign");
  const has = await card.isVisible().catch(() => false);
  check("dashboard lists contracts awaiting a contractor signature", has && /Deck rebuild|Morgan Lee|Backyard Deck/.test(await card.innerText()), has ? (await card.innerText()).replace(/\n/g, " | ").slice(0, 160) : "card missing");
  if (has) await card.screenshot({ path: path.join(OUT, "08-dashboard-awaiting-countersign__desktop.png") });
  await p.goto(`${BASE}/signed/${deck.id}`, { waitUntil: "networkidle" });
  const badge = await p.locator("main").getByText(/Awaiting Contractor Signature|Fully executed/).first().innerText();
  check("signed page: 'Awaiting Contractor Signature', no contractor signature drawn", /Awaiting Contractor Signature/i.test(badge) && /Authorized signer/.test(await p.locator("main").innerText()), badge);
  await shot(p, "09-signed-awaiting-contractor__desktop");
  // Countersign: statement required, then signs.
  await p.getByTestId("countersign").first().click();
  const cs = p.getByTestId("countersign-confirm").first().locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]");
  await cs.scrollIntoViewIfNeeded();
  const stmt = await cs.innerText();
  check("countersign shows the exact statement with version and total", /version 1/.test(stmt) && /\$17,985\.00/.test(stmt), stmt.replace(/\n/g, " ").slice(0, 200));
  check("countersign button disabled until the statement is confirmed", await p.getByTestId("countersign-submit").isDisabled());
  await p.getByTestId("countersign-confirm").check();
  await cs.screenshot({ path: path.join(OUT, "10-countersign-panel__desktop.png") });
  const [r] = await Promise.all([p.waitForResponse((x) => x.url().includes(`/api/estimates/${E(2)}/countersign`)), p.getByTestId("countersign-submit").click()]);
  const j = await r.json().catch(() => ({}));
  check("countersign recorded", r.status() === 200, `${r.status()} ${JSON.stringify(j).slice(0, 160)}`);
  const k = await q1("select application, trigger, sequence, corrective, credential_version, ip_address, statement_text, applied_at from public.contractor_signatures where estimate_id = $1", [E(2)]);
  check("interactive record: customer-first, credential v2, IP + statement kept, not corrective", k?.application === "interactive" && k?.sequence === "customer_first" && !k?.corrective && k?.credential_version === 2 && Boolean(k?.ip_address) && /on behalf of/i.test(k?.statement_text ?? ""), JSON.stringify(k).slice(0, 220));
  const ex = await q1("select executed_at, pdf_status from public.contractor_executed_documents where signature_id = $1", [deck.id]);
  check("executed record opened (executed at the later signing time)", Boolean(ex?.executed_at) && new Date(ex.executed_at).getTime() === new Date(k.applied_at).getTime(), JSON.stringify(ex));
  await p.reload({ waitUntil: "networkidle" });
  check("signed page now 'Fully executed'", await p.locator("main").getByText("Fully executed").first().isVisible() && !(await p.locator("main").getByText("Awaiting Contractor Signature").count()));
  await shot(p, "11-signed-fully-executed__desktop");
  const hist = await p.getByTestId("signature-history").innerText().catch(() => "");
  check("signature history lists customer and contractor events in order", /Customer signed/i.test(hist) && /Contractor sign/i.test(hist), hist.replace(/\n/g, " | ").slice(0, 200));
  // Download the executed PDF (the route signs a storage URL with the _EXECUTED filename).
  const exj = await p.evaluate(async (id) => (await fetch(`/api/signatures/${id}/executed`)).json(), deck.id);
  check("executed PDF route returns a download named …_EXECUTED.pdf", /_EXECUTED\.pdf/.test(decodeURIComponent(exj.url ?? "")), decodeURIComponent(exj.url ?? JSON.stringify(exj)).slice(-90));
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 30000 }), p.getByTestId("executed-pdf").first().click()]);
  const file = path.join(OUT, "deck-executed.pdf");
  await dl.saveAs(file);
  check("executed PDF downloads from the signed page", fs.readFileSync(file).subarray(0, 4).toString() === "%PDF");
  // A repeat countersign (double click, retry) returns the same record; nothing new is written.
  const again = await p.evaluate(async (id) => (await (await fetch(`/api/estimates/${id}/countersign`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ versionId: "44444444-4444-4444-8444-000000000002", confirm: true }) })).json()), E(2));
  check("repeat countersign is idempotent (same record, still one row)", again.contractorSignatureId === j.contractorSignatureId && Number((await q1("select count(*) n from public.contractor_signatures where estimate_id = $1", [E(2)])).n) === 1, JSON.stringify(again).slice(0, 120));
  await ctx.close();
  const m = await ctxFor({ signedIn: true, viewport: { width: 390, height: 844 }, mobile: true });
  const mp = await m.newPage(); watch(mp);
  await mp.goto(`${BASE}/signed/${deck.id}`, { waitUntil: "networkidle" });
  check("signed page 390px: no horizontal overflow", (await overflow(mp)) <= 0);
  await shot(mp, "12-signed-fully-executed__m390");
  await m.close();
}

// ---------- 4. Customer signs a proposal the contractor already signed (contractor-first, auto) ----------
{
  const ctx = await ctxFor({ viewport: { width: 390, height: 844 }, mobile: true });
  const p = await ctx.newPage(); watch(p);
  await p.goto(`${BASE}/sign/${TOKEN}`, { waitUntil: "networkidle" });
  const body = await p.locator("main").innerText();
  check("customer sees the contractor signature already on the proposal", /CONTRACTOR SIGNATURE|Contractor signature/i.test(body) && /Alex Rivera/.test(body), "");
  check("signing page 390px: no horizontal overflow", (await overflow(p)) <= 0);
  await shot(p, "13-customer-sign-contractor-first__m390");
  await p.fill("#sf-signerName", "Pat Johnson");
  await p.fill("#sf-signerEmail", "pat@example.test");
  await p.getByRole("radio", { name: "Type" }).click();
  await p.fill("#sf-signatureText", "Pat Johnson");
  await p.check("#sf-consent");
  await p.check("#sf-accept");
  const [resp] = await Promise.all([p.waitForResponse((r) => r.url().includes(`/api/sign/${TOKEN}`) && r.request().method() === "POST"), p.getByRole("button", { name: "Accept & Sign Proposal" }).click()]);
  const j = await resp.json();
  check("customer signature accepted and agreement fully executed at once", resp.status() === 200 && j.signed === true && j.execution === "fully_executed", JSON.stringify(j).slice(0, 200));
  await p.getByText("Your signature has been recorded").waitFor().catch(() => {});
  await p.reload({ waitUntil: "networkidle" });
  check("customer page says 'Fully executed'", /Fully executed/.test(await p.getByTestId("customer-status").innerText().catch(() => "")));
  await shot(p, "14-customer-fully-executed__m390");
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 30000 }), p.getByRole("link", { name: /Download/ }).first().click()]);
  const file = path.join(OUT, "siding-executed.pdf");
  await dl.saveAs(file);
  check("customer downloads the fully executed PDF", /_EXECUTED\.pdf$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  const k = await q1("select application, sequence, ip_address, user_agent, authorization_given_at from public.contractor_signatures where estimate_id = $1", [E(1)]);
  check("automatic record: contractor-first, no IP/device evidence, authorization time kept", k.application === "auto_policy" && k.sequence === "contractor_first" && k.ip_address === null && k.user_agent === null && Boolean(k.authorization_given_at), JSON.stringify(k));
  await ctx.close();
}

// ---------- 5. Historical contract (signed before the feature) ----------
{
  const roof = await q1("select id from public.signatures where estimate_id = $1", [E(4)]);
  const ctx = await ctxFor({ signedIn: true });
  const p = await ctx.newPage(); watch(p);
  await p.goto(`${BASE}/signed/${roof.id}`, { waitUntil: "networkidle" });
  const t = await p.locator("main").innerText();
  check("historical contract: no 'Awaiting Contractor', no fabricated contractor signature", !/Awaiting Contractor Signature/i.test(t) && Number((await q1("select count(*) n from public.contractor_signatures where estimate_id = $1", [E(4)])).n) === 0);
  await shot(p, "15-signed-historical__desktop");
  await ctx.close();
}

// ---------- 6. Builder signing panel ----------
{
  const ctx = await ctxFor({ signedIn: true });
  await ctx.route("**/api/estimates/save", (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }));
  const p = await ctx.newPage(); watch(p);
  await p.goto(`${BASE}/estimates/${E(1)}?step=proposal`, { waitUntil: "networkidle" });
  const st = p.getByTestId("contractor-status");
  const ok = await st.waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
  check("builder signing panel shows contractor signature status", ok && /Contractor signature/i.test(await st.innerText()), ok ? (await st.innerText()).replace(/\n/g, " | ").slice(0, 200) : "missing");
  if (ok) await p.getByTestId("signing-panel").screenshot({ path: path.join(OUT, "16-builder-signing-panel__desktop.png") });
  await ctx.close();
}

// ---------- integrity: nothing else touched ----------
const billing = await q1("select count(*) n from public.contractor_signing_events where event like '%bill%' or event like '%charge%'");
check("no billing events from signing", Number(billing.n) === 0);
const ev = (await db.query("select event from public.contractor_signing_events order by id")).rows.map((r) => r.event);
check("append-only audit events recorded", ev.length >= 8, ev.join(","));
check("no browser errors", errors.length === 0, errors.slice(0, 3).join(" | "));

fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
await browser.close(); await db.end();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
