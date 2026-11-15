// Browser walk for e-signatures and the signed-bids dashboard.
// Usage:
//   npx tsx scripts/esign/fixture.ts > /tmp/esign-fixture.json
//   MOCK_ESIGN_FIXTURE=/tmp/esign-fixture.json node scripts/ux-audit/mock-supabase.mjs &
//   (build + `next start` with NEXT_PUBLIC_ESIGNATURES=on against the mock on :54321)
//   node scripts/esign/walk.mjs <screenshotDir>
// The real signing routes, signing page, signed-PDF rendering and dashboard run; only the database is
// the in-memory mock. Create Signing Link is intercepted in the builder (finalize_bid needs a real DB;
// its server logic is covered by tests/esign-routes.test.ts).
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = process.argv[2] ?? "esign-shots";
fs.mkdirSync(OUT, { recursive: true });
const TOKEN = "walkTokenAbcdefghijklmnopqrstuvwxyz01234567";
const EST = "11111111-1111-4111-8111-111111111111";

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

// ---------- 1. Dashboard before any new signature ----------
{
  const ctx = await ctxFor({ signedIn: true });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  const rs = p.getByTestId("recently-signed");
  check("dashboard: Recently Signed section is shown", await rs.isVisible());
  const rsText = await rs.innerText();
  check("dashboard: signed bid shows customer, project, exact signed amount", rsText.includes("John Smith") && rsText.includes("Backyard Deck Replacement") && rsText.includes("$17,985.00"), rsText.split("\n").slice(0, 8).join(" | "));
  check("dashboard: newest signature first", rsText.indexOf("Backyard Deck Replacement") < rsText.indexOf("Fence install"));
  check("dashboard: signed time is relative and local", /Today at \d{1,2}:\d{2}/.test(rsText));
  check("dashboard: failed signed-PDF shows a separate document state, still Signed", /signed PDF is being retried/.test(rsText) && rsText.includes("Signed"));
  check("dashboard: nothing says paid", !/\bpaid\b/i.test(rsText));
  check("dashboard: Recently Signed Bids count = 2", (await p.getByTestId("signed-count").innerText()).includes("2"));
  const badges = await p.getByTestId("signing-badge").allInnerTexts();
  check("My Bids: Awaiting / Expired / Signed badges", ["Awaiting Signature", "Expired", "Signed v1"].every((b) => badges.includes(b)), badges.join(", "));
  const order = await p.evaluate(() => {
    const rs = document.querySelector('[data-testid="recently-signed"]'), credits = [...document.querySelectorAll("section, div")].find((e) => /bid credits/i.test(e.textContent ?? ""));
    return { rsTop: rs?.getBoundingClientRect().top ?? 9999, listTop: document.querySelector('input[aria-label="Search bids"]')?.getBoundingClientRect().top ?? 0, credits: Boolean(credits) };
  });
  check("dashboard: Recently Signed sits above the bid list", order.rsTop < order.listTop);
  await shot(p, "01-dashboard__desktop");
  // Filters
  await p.getByRole("group", { name: "Filter by signature" }).getByRole("button", { name: "Signed" }).click();
  const signedRows = await p.locator('ul.divide-y > li a.font-semibold[href^="/estimates/"]').allInnerTexts();
  check("filter Signed: only signed bids", signedRows.length === 2 && signedRows.every((t) => /Deck rebuild|Fence install/.test(t)), signedRows.join(" | "));
  await shot(p, "02-filter-signed__desktop", false);
  await p.getByRole("group", { name: "Filter by signature" }).getByRole("button", { name: "Awaiting Signature" }).click();
  const awaitingRows = await p.locator('ul.divide-y > li a.font-semibold[href^="/estimates/"]').allInnerTexts();
  check("filter Awaiting: only the open link", awaitingRows.length === 1 && /Siding/.test(awaitingRows[0]), awaitingRows.join(" | "));
  await p.getByRole("group", { name: "Filter by status" }).getByRole("button", { name: "Drafts" }).click();
  await p.getByRole("group", { name: "Filter by signature" }).getByRole("button", { name: "Signed" }).click();
  check("filters combine with status; useful empty state", (await p.locator("text=No signed bids here yet.").count()) === 1);
  await p.getByRole("group", { name: "Filter by status" }).getByRole("button", { name: "All active" }).click();
  await p.getByRole("group", { name: "Filter by signature" }).getByRole("button", { name: "All bids" }).click();
  await p.getByPlaceholder("Search by project, customer, or number").fill("Garcia");
  check("search still works alongside signing filters", (await p.locator('ul.divide-y > li a.font-semibold[href^="/estimates/"]').allInnerTexts()).length === 1);
  const rowSigned = p.locator("li", { hasText: "Fence install – Garcia" }).last();
  check("signed bid row: Delete is not offered (archive instead)", (await rowSigned.getByRole("button", { name: "Delete" }).count()) === 0);
  await ctx.close();

  for (const w of [320, 390, 768]) {
    const c = await ctxFor({ signedIn: true, viewport: { width: w, height: 900 }, mobile: w < 700 });
    const m = await c.newPage();
    await m.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
    check(`dashboard ${w}px: no horizontal overflow`, (await overflow(m)) <= 0);
    const btn = m.getByRole("link", { name: "View Signed Proposal" }).first();
    const box = await btn.boundingBox();
    check(`dashboard ${w}px: View Signed Proposal is tappable (>=40px)`, box && box.height >= 40, box ? `${Math.round(box.height)}px` : "missing");
    await shot(m, `03-dashboard__m${w}`);
    await c.close();
  }
}

// ---------- 2. Customer signing page ----------
{
  const ctx = await ctxFor();
  const p = await ctx.newPage();
  const res = await p.goto(`${BASE}/sign/${TOKEN}`, { waitUntil: "networkidle" });
  const hdr = res.headers();
  check("signing page: no-referrer, noindex, no-store headers", hdr["referrer-policy"] === "no-referrer" && /noindex/.test(hdr["x-robots-tag"] ?? "") && /no-store/.test(hdr["cache-control"] ?? ""), `${hdr["referrer-policy"]} / ${hdr["x-robots-tag"]} / ${hdr["cache-control"]}`);
  const body = await p.locator("main").innerText();
  for (const [label, re] of [["contractor", /Summit Exteriors LLC/], ["customer", /Pat Johnson/], ["project title", /Siding replacement/], ["address", /48 Oak Lane/], ["proposal number", /#B-1004/], ["total", /\$17,985\.00/], ["exclusions", /Permit fees/], ["payment schedule", /Deposit at signing/], ["terms", /change order/], ["expiration", /Proposal expires/]]) {
    check(`signing page shows ${label}`, re.test(body));
  }
  check("signing page: no internal cost or markup wording", !/markup|margin|profit|unit cost/i.test(body));
  check("signing page: consent boxes start unchecked", !(await p.locator("#sf-consent").isChecked()) && !(await p.locator("#sf-accept").isChecked()));
  await shot(p, "04-signing-page__desktop");
  let posted = 0;
  p.on("request", (r) => { if (r.method() === "POST" && r.url().includes(`/api/sign/${TOKEN}`)) posted++; });
  await p.getByRole("button", { name: "Accept & Sign Proposal" }).click();
  await p.waitForTimeout(300);
  const errs = await p.locator("form [id$='-err']").allInnerTexts();
  check("submit without details: clear errors, nothing sent", errs.length >= 4 && posted === 0, errs.join(" | "));
  await shot(p, "05-signing-errors__desktop");
  // Server refuses a typed signature that doesn't match and unchecked consent, even if the browser is bypassed.
  const direct = await p.evaluate(async (t) => {
    const r = await fetch(`/api/sign/${t}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signerName: "Pat Johnson", signerEmail: "pat@example.test", method: "typed", signatureText: "Pat Johnson", consent: false, accept: true, consentVersion: "esign-consent-2026-11-15" }) });
    return r.status;
  }, TOKEN);
  check("server refuses missing consent (422)", direct === 422, String(direct));
  await ctx.close();
}

// ---------- 3. Sign on a phone with a drawn signature ----------
let newSignatureId = null;
{
  const ctx = await ctxFor({ viewport: { width: 390, height: 844 }, mobile: true });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/sign/${TOKEN}`, { waitUntil: "networkidle" });
  check("signing page 390px: no horizontal overflow", (await overflow(p)) <= 0);
  await shot(p, "06-signing-page__m390");
  await p.fill("#sf-signerName", "Pat Johnson");
  await p.fill("#sf-signerEmail", "pat@example.test");
  await p.getByRole("radio", { name: "Draw" }).click();
  const pad = p.locator("#sf-signatureImage");
  await pad.scrollIntoViewIfNeeded();
  const b = await pad.boundingBox();
  await p.mouse.move(b.x + 20, b.y + b.height * 0.7);
  await p.mouse.down();
  for (let i = 0; i <= 40; i++) await p.mouse.move(b.x + 20 + i * ((b.width - 40) / 40), b.y + b.height * (0.5 + 0.3 * Math.sin(i / 3)));
  await p.mouse.up();
  await p.check("#sf-consent");
  await p.check("#sf-accept");
  await shot(p, "07-signing-drawn__m390", false);
  const [resp] = await Promise.all([p.waitForResponse((r) => r.url().includes(`/api/sign/${TOKEN}`) && r.request().method() === "POST"), p.getByRole("button", { name: "Accept & Sign Proposal" }).click()]);
  const j = await resp.json();
  newSignatureId = j.signatureId;
  check("drawn signature on a phone is accepted", resp.status() === 200 && j.signed === true, JSON.stringify(j));
  check("signed PDF generated right after acceptance", j.pdfReady === true);
  await p.getByText("Your signature has been recorded").waitFor();
  await shot(p, "08-signing-success__m390", false);
  const pdf = await p.evaluate(async (t) => { const r = await fetch(`/api/sign/${t}/pdf`); const b = new Uint8Array(await r.arrayBuffer()); return { status: r.status, type: r.headers.get("content-type"), head: String.fromCharCode(...b.slice(0, 5)), disp: r.headers.get("content-disposition"), size: b.length }; }, TOKEN);
  check("customer can download the signed copy (real PDF)", pdf.status === 200 && pdf.type === "application/pdf" && pdf.head === "%PDF-" && /SIGNED/.test(pdf.disp ?? ""), `${pdf.size} bytes, ${pdf.disp}`);
  const replay = await p.evaluate(async (t) => (await fetch(`/api/sign/${t}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signerName: "Someone Else", signerEmail: "x@example.test", method: "typed", signatureText: "Someone Else", consent: true, accept: true, consentVersion: "esign-consent-2026-11-15" }) })).status, TOKEN);
  check("second signature on the same link is refused (409)", replay === 409, String(replay));
  await p.reload({ waitUntil: "networkidle" });
  check("reloaded link shows Signed, with no form", (await p.getByText("Signature recorded").count()) === 1 && (await p.locator("[data-testid=sign-form]").count()) === 0);
  await shot(p, "09-signing-already-signed__m390");
  await ctx.close();
}

// ---------- 4. Invalid and expired links ----------
{
  const ctx = await ctxFor({ viewport: { width: 390, height: 844 }, mobile: true });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/sign/${"x".repeat(43)}`, { waitUntil: "networkidle" });
  check("unknown link: friendly invalid page, no proposal data", (await p.getByText("This signing link isn't valid").count()) === 1 && !(await p.locator("main").innerText()).includes("$"));
  await shot(p, "10-signing-invalid__m390", false);
  await ctx.close();
}

// ---------- 5. Contractor sees the new signature ----------
{
  const ctx = await ctxFor({ signedIn: true });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  const rsText = await p.getByTestId("recently-signed").innerText();
  check("after signing: newly signed bid appears first in Recently Signed", rsText.indexOf("Siding replacement") > -1 && rsText.indexOf("Siding replacement") < rsText.indexOf("Backyard Deck"), rsText.split("\n").slice(0, 6).join(" | "));
  check("after signing: count updates to 3", (await p.getByTestId("signed-count").innerText()).includes("3"));
  await shot(p, "11-dashboard-after-signing__desktop");
  // Refresh/re-login: a fresh context sees the same thing.
  const ctx2 = await ctxFor({ signedIn: true });
  const p2 = await ctx2.newPage();
  await p2.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  check("Signed status survives a new session", (await p2.getByTestId("recently-signed").innerText()).includes("Siding replacement"));
  await ctx2.close();

  await p.getByRole("link", { name: "View Signed Proposal" }).first().click();
  await p.waitForURL(/\/signed\//);
  const page = await p.locator("main").innerText();
  check("View Signed Proposal: signer, amount, method and exact version", /Pat Johnson/.test(page) && /\$17,985\.00/.test(page) && /Drawn signature/.test(page) && /The exact version the customer signed/i.test(page));
  check("View Signed Proposal: verification is described honestly", /identity not independently verified/i.test(page));
  check("drawn signature image is shown", (await p.locator('img[alt^="Drawn signature"]').count()) === 1);
  await shot(p, "12-signed-proposal__desktop");
  const dl = await p.evaluate(async (id) => { const r = await fetch(`/api/signatures/${id}/pdf`); return { status: r.status, body: await r.json() }; }, newSignatureId);
  check("Download Signed PDF returns a short-lived link", dl.status === 200 && /\/storage\/v1\/object\/sign\//.test(dl.body.url ?? ""), JSON.stringify(dl.body).slice(0, 120));
  const audit = await p.evaluate(async (id) => { const r = await fetch(`/api/signatures/${id}/audit`); return { status: r.status, j: await r.json() }; }, newSignatureId);
  check("audit record: hashes, consent version, timestamps, method", audit.status === 200 && audit.j.document.proposalPdfSha256?.length === 64 && audit.j.consent.version && audit.j.signature.method === "drawn" && audit.j.signature.signedAtUtc && audit.j.document.signedPdfSha256?.length === 64);
  const missing = await p.goto(`${BASE}/signed/99999999-9999-4999-8999-999999999999`);
  check("someone else's / unknown signature id: 404", missing.status() === 404);
  await ctx.close();

  const m = await ctxFor({ signedIn: true, viewport: { width: 390, height: 844 }, mobile: true });
  const mp = await m.newPage();
  await mp.goto(`${BASE}/signed/${newSignatureId}`, { waitUntil: "networkidle" });
  check("signed proposal 390px: no horizontal overflow", (await overflow(mp)) <= 0);
  await shot(mp, "13-signed-proposal__m390");
  await m.close();
}

// ---------- 6. Builder: Create Signing Link ----------
{
  const ctx = await ctxFor({ signedIn: true });
  await ctx.route("**/api/estimates/save", (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }));
  let created = 0;
  await ctx.route(`**/api/estimates/${EST}/signing`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    created++;
    await new Promise((r) => setTimeout(r, 300));
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ url: `http://localhost:3000/sign/${"N".repeat(43)}`, requestId: "r-new", expiresAt: new Date(Date.now() + 30 * 864e5).toISOString(), versionId: "v1", versionNumber: 1, total: "$17,985.00", filename: "Summit.pdf", pdfBase64: Buffer.from("%PDF-1.4\n%%EOF").toString("base64"), charged: false, creditSource: "existing_version", credits: { starter: 2, monthly: 0, unlimited: false, nextCycleAt: "2026-12-01" } }) });
  });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/estimates/${EST}?step=proposal`, { waitUntil: "networkidle" });
  const panel = p.getByTestId("signing-panel");
  await panel.waitFor();
  await panel.getByText(/Signed v1|Awaiting Signature/).first().waitFor({ timeout: 5000 }).catch(() => {});
  check("builder Proposal step: signing panel shows the bid's status", /Signed v1|Awaiting Signature/.test(await panel.innerText()), (await panel.innerText()).replace(/\n/g, " | ").slice(0, 160));
  await shot(p, "14-builder-signing-panel__desktop", false);
  await p.getByTestId("create-signing-link").dblclick();
  await p.getByTestId("signing-url").waitFor();
  check("Create Signing Link: one request even on a double click", created === 1, String(created));
  const dlg = await p.getByRole("dialog").innerText();
  check("link dialog: copy, Send via My Email, Download PDF", /Copy/.test(dlg) && /Send via My Email/.test(dlg) && /Download PDF/.test(dlg));
  const href = await p.getByRole("link", { name: "Send via My Email" }).getAttribute("href");
  check("Send via My Email: mailto with link, customer address and subject, no attachment claim", href.startsWith("mailto:pat@example.test?") && decodeURIComponent(href).includes("/sign/NNNN") && decodeURIComponent(href).includes("Your Estimate from Summit Exteriors LLC") && !/attached/.test(decodeURIComponent(href)));
  await shot(p, "15-builder-link-dialog__desktop", false);
  await ctx.close();
  for (const w of [390, 768]) {
    const c = await ctxFor({ signedIn: true, viewport: { width: w, height: 900 }, mobile: w < 700 });
    await c.route("**/api/estimates/save", (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }));
    const m = await c.newPage();
    await m.goto(`${BASE}/estimates/${EST}?step=proposal`, { waitUntil: "networkidle" });
    await m.getByTestId("signing-panel").waitFor();
    check(`builder ${w}px with signing panel: no horizontal overflow`, (await overflow(m)) <= 0);
    await shot(m, `16-builder-signing-panel__m${w}`, false);
    await c.close();
  }
}

await browser.close();
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
