// Browser checks for the compact Email Proposal dialog (Send via My Email).
// Usage: node scripts/ux-audit/mock-supabase.mjs &  then build + `next start` on :3000 with
//   NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_ESIGNATURES=on
//   node scripts/email-proposal/walk.mjs <screenshotDir>
// The export and signing APIs are intercepted in the browser (the mock database can't finalize bids);
// Gmail and Outlook are intercepted too, so nothing leaves the machine and nothing is sent.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = process.argv[2] ?? "email-proposal-shots";
fs.mkdirSync(OUT, { recursive: true });
const EST = "11111111-1111-4111-8111-111111111111";
const FILE = "Summit-Exteriors_Siding-replacement_B-1004_v1.pdf";

const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600 * 24 * 365 * 50, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };
const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(180_000, 32), Buffer.from("\n%%EOF")]).toString("base64");

const SUBJECT = "Your Estimate from Summit Exteriors LLC — Siding replacement – Johnson residence";
const PDF_BODY = ["Hi Pat,", "", "Thank you for the opportunity to provide an estimate for Siding replacement – Johnson residence.", "", "I've attached our proposal for your review. Please let me know if you have any questions or would like to discuss anything further.", "", "Thank you,", "Alex Rivera", "Summit Exteriors LLC", "(555) 010-2030"].join("\n");
const SIGN_URL = `${BASE}/sign/${"N".repeat(43)}`;
const SIGN_SUBJECT = "Please Review & Sign Your Proposal — Siding replacement – Johnson residence";
const SIGN_BODY = ["Hi Pat,", "", "Thank you for the opportunity to provide an estimate for your project.", "", "Please review your proposal and electronically sign it using the secure link below:", "", SIGN_URL, "", "If you have any questions or would like to discuss anything before signing, please let me know.", "", "Thank you,", "Alex Rivera", "Summit Exteriors LLC", "(555) 010-2030"].join("\n");
/** A compose URL that is safe: no raw spaces, line breaks or "+" (Outlook shows + literally). */
const safeUrl = (href) => !/[\s+]/.test(href) && !/%0D/i.test(href);
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };
const browser = await chromium.launch();
const noPopup = () => { try { localStorage.setItem("b2b:onboarding", JSON.stringify({ status: "dismissed", at: new Date().toISOString(), synced: true })); } catch { /* */ } };

const shareShim = (mode) => `(() => {
  window.__shared = [];
  Object.defineProperty(navigator, "canShare", { configurable: true, value: (d) => Boolean(d && d.files && d.files.length) });
  Object.defineProperty(navigator, "share", { configurable: true, value: async (d) => {
    window.__shared.push({ files: (d.files || []).map((f) => ({ name: f.name, type: f.type, size: f.size })), title: d.title, text: d.text, active: navigator.userActivation ? navigator.userActivation.isActive : null });
    if (${JSON.stringify(mode)} === "cancel") { const e = new Error("cancel"); e.name = "AbortError"; throw e; }
    if (${JSON.stringify(mode)} === "fail") { const e = new Error("nope"); e.name = "NotAllowedError"; throw e; }
  } });
})()`;
const noShareShim = `(() => { Object.defineProperty(navigator, "share", { configurable: true, value: undefined }); Object.defineProperty(navigator, "canShare", { configurable: true, value: undefined }); })()`;

async function ctxFor({ viewport = { width: 1280, height: 900 }, mobile = false, share = noShareShim, exportFail = false, credit = "starter" } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, acceptDownloads: true, hasTouch: mobile, isMobile: mobile });
  await ctx.addCookies([authCookie]);
  await ctx.addInitScript(noPopup);
  await ctx.addInitScript(share);
  const calls = []; const signing = [];
  await ctx.route("**/api/estimates/save", (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }));
  await ctx.route("https://mail.google.com/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<title>Gmail stub</title>" }));
  await ctx.route("https://outlook.office.com/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<title>Outlook stub</title>" }));
  await ctx.route("https://outlook.live.com/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<title>Outlook.com stub</title>" }));
  await ctx.route("**/api/estimates/*/export", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    calls.push(body);
    await new Promise((r) => setTimeout(r, 400));
    if (exportFail) return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { message: "We could not create the PDF. No bid credit was used. Please try again." } }) });
    // Mirrors finalize_bid: the first export of this version is charged, later ones reuse it for free.
    if (credit === "quota") return route.fulfill({ status: 402, contentType: "application/json", body: JSON.stringify({ error: { code: "quota_exceeded", message: "You've used your free bids." } }) });
    const first = calls.length === 1;
    const source = credit === "unlimited" ? "unlimited" : first ? "starter" : "existing_version";
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ url: null, pdfBase64: PDF, filename: FILE, versionId: "v1", versionNumber: 1, charged: credit !== "unlimited" && first, creditSource: source, credits: { starter: 2, monthly: 0, unlimited: credit === "unlimited", nextCycleAt: "2026-12-01" } }) });
  });
  await ctx.route(`**/api/estimates/${EST}/signing/r-new`, (route) => { signing.revoked = true; return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }); });
  await ctx.route(`**/api/estimates/${EST}/signing`, async (route) => {
    if (route.request().method() === "GET") {
      const pending = signing.length && !signing.revoked ? [{ id: "r-new", estimate_id: EST, version_id: "v1", status: "pending", expires_at: new Date(Date.now() + 30 * 864e5).toISOString(), created_at: new Date().toISOString() }] : [];
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ requests: pending, signatures: [] }) });
    }
    signing.push(1);
    await new Promise((r) => setTimeout(r, 300));
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ url: `${BASE}/sign/${"N".repeat(43)}`, requestId: "r-new", expiresAt: new Date(Date.now() + 30 * 864e5).toISOString(), versionId: "v1", versionNumber: 1, total: "$17,985.00", filename: FILE, pdfBase64: PDF, charged: false, creditSource: "existing_version", credits: { starter: 2, monthly: 0, unlimited: false, nextCycleAt: "2026-12-01" } }) });
  });
  return { ctx, calls, signing };
}

async function openBuilder(p, q = "") {
  await p.goto(`${BASE}/estimates/${EST}${q}`, { waitUntil: "networkidle" });
  await p.waitForSelector('header button[aria-label="Send via My Email"]');
  await p.waitForTimeout(400);
}
const dialog = (p) => p.getByTestId("email-proposal");
const dlgText = async (p) => (await p.locator('[role="dialog"]').innerText());
/** Dialog fits the screen: no scrolling inside it, no sideways page overflow. */
const fit = (p) => p.evaluate(() => {
  const d = document.querySelector('[role="dialog"]');
  return { inner: d.scrollHeight - d.clientHeight, h: Math.round(d.getBoundingClientRect().height), vh: innerHeight, overflow: document.documentElement.scrollWidth - innerWidth };
});
const shot = (p, name) => p.screenshot({ path: path.join(OUT, `${name}.png`) });

// ---------- 1. Desktop, no file sharing: Gmail / Outlook / Other email app ----------
{
  const { ctx, calls } = await ctxFor();
  const p = await ctx.newPage();
  await openBuilder(p);
  const btn = p.locator('header button[aria-label="Send via My Email"]');
  await btn.click(); await btn.click({ force: true }).catch(() => {});
  await dialog(p).getByText("Preparing PDF").waitFor({ timeout: 3000 }).then(() => shot(p, "01-preparing__desktop")).catch(() => {});
  await dialog(p).getByText(FILE).waitFor({ timeout: 8000 });
  check("double tap prepares the PDF once, through the normal export (deliver: bytes)", calls.length === 1 && calls[0].deliver === "bytes", `${calls.length} request(s)`);
  const t = await dlgText(p);
  check("title is Email Proposal", /Email Proposal/.test(t));
  check("To and Subject come prefilled from the estimate", (await p.inputValue("#se-to")) === "pat@example.test" && (await p.inputValue("#se-subject")) === "Your Estimate from Summit Exteriors LLC — Siding replacement – Johnson residence", await p.inputValue("#se-subject"));
  check("attachment row shows the PDF filename as ready with its size", /Ready\s*· 17\d KB/.test(await p.getByTestId("se-attachment").innerText()), await p.getByTestId("se-attachment").innerText());
  check("no message textarea by default (Edit message instead)", (await p.locator("#se-body").count()) === 0 && (await p.getByTestId("se-edit-message").isVisible()));
  check("no per-field Copy buttons or repeated attachment explanations in the main view", !/Attach automatically|Or attach it yourself|Two quick steps/.test(t) && (await p.getByRole("button", { name: /^Copy (recipient|subject|message)$/ }).count()) === 0);
  check("delivery choices: Gmail, Outlook, Other email app", await p.getByTestId("se-gmail").isVisible() && await p.getByTestId("se-outlook").isVisible() && await p.getByTestId("se-other").isVisible());
  check("credit note from the export is shown", /starter|credit/i.test(t), t.match(/[^\n]*credit[^\n]*/i)?.[0] ?? "");
  const f = await fit(p);
  check("desktop 1280x900: dialog fits without scrolling", f.inner <= 1 && f.overflow <= 0, JSON.stringify(f));
  await shot(p, "02-ready__desktop");

  const gHref = await p.getByTestId("se-gmail").getAttribute("href");
  const g = new URL(gHref);
  check("Gmail link: mail.google.com compose (view=cm, fs=1), exact recipient and subject", g.origin + g.pathname === "https://mail.google.com/mail/" && g.searchParams.get("view") === "cm" && g.searchParams.get("fs") === "1" && g.searchParams.get("to") === "pat@example.test" && g.searchParams.get("su") === SUBJECT, gHref.slice(0, 100));
  check("Gmail link: complete message, line breaks kept as \\n, nothing cut", g.searchParams.get("body") === PDF_BODY);
  check("Gmail link: safely encoded (no raw spaces, + or line breaks; & and – escaped)", safeUrl(gHref) && gHref.includes("%E2%80%93") && gHref.includes("%0A"));
  const [popup, dl] = await Promise.all([ctx.waitForEvent("page"), p.waitForEvent("download"), p.getByTestId("se-gmail").click()]);
  await popup.waitForLoadState().catch(() => {});
  check("Gmail click: one click downloads the PDF and opens Gmail in a new tab", dl.suggestedFilename() === FILE && popup.url().startsWith("https://mail.google.com/mail/?view=cm"), popup.url().slice(0, 60));
  await popup.close();
  const st = await dlgText(p);
  check("Gmail status: says to attach the downloaded PDF by hand, never claims it is attached or sent", /Attach .*just downloaded.*drag it into the email/s.test(st) && !/is attached|email sent|sent successfully/i.test(st));
  await shot(p, "03-after-gmail__desktop");
  let extra = 0; p.on("download", () => extra++);
  const [popup2] = await Promise.all([ctx.waitForEvent("page"), p.getByTestId("se-outlook").click()]);
  await p.waitForTimeout(400);
  check("Outlook click: opens Outlook compose, no duplicate download", popup2.url().startsWith("https://outlook.office.com/mail/deeplink/compose?") && extra === 0 && /already in your downloads/.test(await dlgText(p)), `${popup2.url().slice(0, 60)}, extra downloads ${extra}`);
  const u2 = new URL(popup2.url());
  check("Outlook (Microsoft 365) link: exact recipient, subject and complete message, safely encoded", u2.origin + u2.pathname === "https://outlook.office.com/mail/deeplink/compose" && u2.searchParams.get("to") === "pat@example.test" && u2.searchParams.get("subject") === SUBJECT && u2.searchParams.get("body") === PDF_BODY && safeUrl(popup2.url()));
  await popup2.close();
  const personal = await p.getByRole("link", { name: "Open Outlook.com" }).getAttribute("href");
  const pu = new URL(personal);
  check("Outlook.com (personal) link: deeplink compose with the same recipient, subject and message", pu.origin + pu.pathname === "https://outlook.live.com/mail/0/deeplink/compose" && pu.searchParams.get("to") === "pat@example.test" && pu.searchParams.get("subject") === SUBJECT && pu.searchParams.get("body") === PDF_BODY && safeUrl(personal));

  // Edit message
  await p.getByTestId("se-edit-message").click();
  const body = await p.inputValue("#se-body");
  check("Edit message reveals the prefilled message", body.startsWith("Hi Pat,") && body.trimEnd().endsWith("(555) 010-2030"));
  await p.fill("#se-body", "Hi Pat,\n\nHere's the proposal we talked about. Call me with questions!\n\nAlex");
  await p.fill("#se-subject", "Siding proposal + options");
  const g2 = new URL(await p.getByTestId("se-gmail").getAttribute("href"));
  check("edited message and subject flow into the Gmail draft", g2.searchParams.get("body")?.includes("Call me with questions!") && g2.searchParams.get("su") === "Siding proposal + options");
  await shot(p, "04-edit-message__desktop");
  // More options
  await p.getByText("More options").click();
  const more = await dlgText(p);
  check("More options: Download PDF and Copy message (fallbacks behind disclosure)", /Download PDF/.test(more) && /Copy message/.test(more));
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
  await p.getByRole("button", { name: "Copy message" }).click();
  const clip = await p.evaluate(() => navigator.clipboard.readText()).catch(() => "");
  check("Copy message copies To, Subject and message as plain text", clip.startsWith("To: pat@example.test\nSubject: Siding proposal + options\n\nHi Pat,"), JSON.stringify(clip.slice(0, 60)));
  await shot(p, "05-more-options__desktop");
  // Other email app (no share): download already done, opens default email app
  await p.getByTestId("se-other").click();
  await p.waitForTimeout(300);
  check("Other email app without file sharing: opens the default email app, explains attaching", /Your email app should open/.test(await dlgText(p)));
  await ctx.close();
}

// ---------- 2. Phone with file sharing: Gmail/Outlook/Other use the share sheet (attaches the PDF) ----------
for (const vp of [{ name: "m320", viewport: { width: 320, height: 640 } }, { name: "m375", viewport: { width: 375, height: 667 } }, { name: "m390", viewport: { width: 390, height: 844 } }, { name: "m428", viewport: { width: 428, height: 926 } }]) {
  const { ctx, calls } = await ctxFor({ viewport: vp.viewport, mobile: true, share: shareShim("ok") });
  const p = await ctx.newPage();
  await openBuilder(p);
  await p.locator('header button[aria-label="Send via My Email"]').click();
  await dialog(p).getByText(FILE).waitFor({ timeout: 8000 });
  const f = await fit(p);
  const tall = vp.viewport.height >= 800;
  check(`[${vp.name}] dialog: no sideways overflow${tall ? ", fits without scrolling" : " (short screen: scrolls inside the dialog)"}`, f.overflow <= 0 && (!tall || f.inner <= 1), JSON.stringify(f));
  const tap = await p.evaluate(() => ["se-gmail", "se-outlook", "se-other"].map((id) => document.querySelector(`[data-testid="${id}"]`).getBoundingClientRect()).every((r) => r.height >= 44 && r.width >= 44));
  check(`[${vp.name}] Gmail / Outlook / Other buttons are full-size tap targets (44px+)`, tap);
  await shot(p, `06-ready__${vp.name}`);
  let popups = 0; ctx.on("page", () => popups++);
  await p.getByTestId("se-gmail").click();
  await p.waitForTimeout(300);
  const shared = await p.evaluate(() => window.__shared);
  check(`[${vp.name}] Gmail on a phone: share sheet with the prepared v1 PDF (valid PDF bytes), from a fresh tap, no web tab`, shared.length === 1 && shared[0].files[0]?.name === FILE && shared[0].files[0]?.type === "application/pdf" && shared[0].files[0]?.size === Buffer.from(PDF, "base64").length && shared[0].active !== false && popups === 0, JSON.stringify(shared[0]?.files));
  check(`[${vp.name}] share carries the subject and the complete message text`, shared[0]?.title === SUBJECT && shared[0]?.text === PDF_BODY);
  const st = await dlgText(p);
  check(`[${vp.name}] after sharing: tells them to finish in Gmail, never claims it was sent`, /Finish in Gmail/.test(st) && /didn't send anything/.test(st) && !/sent successfully/i.test(st));
  await shot(p, `07-after-share__${vp.name}`);
  await p.getByTestId("se-other").click();
  await p.waitForTimeout(300);
  check(`[${vp.name}] Other email app uses the share sheet too; still one export`, (await p.evaluate(() => window.__shared.length)) === 2 && calls.length === 1);
  const titleBefore = await p.inputValue("#est-title").catch(() => null);
  await p.keyboard.press("Escape");
  await p.waitForTimeout(300);
  check(`[${vp.name}] closing returns to the builder with the bid as it was`, (await p.locator('[role="dialog"]').count()) === 0 && /\/estimates\//.test(p.url()) && (titleBefore === null || (await p.inputValue("#est-title")) === titleBefore));
  await ctx.close();
}

// ---------- 3. Share canceled / share refused ----------
{
  const { ctx } = await ctxFor({ viewport: { width: 390, height: 844 }, mobile: true, share: shareShim("cancel") });
  const p = await ctx.newPage();
  await openBuilder(p);
  await p.locator('header button[aria-label="Send via My Email"]').click();
  await dialog(p).getByText(FILE).waitFor({ timeout: 8000 });
  await p.getByTestId("se-other").click();
  await p.getByText("Sharing was canceled. Nothing was sent.").waitFor({ timeout: 3000 }).then(() => check("canceling the share sheet says nothing was sent", true)).catch(() => check("canceling the share sheet says nothing was sent", false));
  await ctx.close();
}
{
  const { ctx } = await ctxFor({ viewport: { width: 390, height: 844 }, mobile: true, share: shareShim("fail") });
  const p = await ctx.newPage();
  await openBuilder(p);
  await p.locator('header button[aria-label="Send via My Email"]').click();
  await dialog(p).getByText(FILE).waitFor({ timeout: 8000 });
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 4000 }).catch(() => null), p.getByTestId("se-other").click()]);
  await p.waitForTimeout(300);
  check("share sheet refused: falls back to downloading the PDF and the default email app", dl?.suggestedFilename() === FILE && /couldn't share the file/.test(await dlgText(p)));
  await ctx.close();
}

// ---------- 4. Export failure ----------
{
  const { ctx, calls } = await ctxFor({ exportFail: true });
  const p = await ctx.newPage();
  await openBuilder(p);
  await p.locator('header button[aria-label="Send via My Email"]').click();
  await p.getByText("No bid credit was used").waitFor({ timeout: 6000 });
  check("failed PDF: error with Try again; delivery buttons disabled", (await p.getByRole("button", { name: "Try again" }).count()) === 1 && (await p.getByTestId("se-gmail").getAttribute("aria-disabled")) === "true" && (await p.getByTestId("se-other").isDisabled()));
  await shot(p, "08-export-failed__desktop");
  await p.getByRole("button", { name: "Try again" }).click();
  await p.waitForTimeout(800);
  check("Try again makes one more request", calls.length === 2);
  await ctx.close();
}

// ---------- 5. Signing link (e-signatures on) ----------
for (const vp of [{ name: "desktop", viewport: { width: 1280, height: 900 }, mobile: false }, { name: "m390", viewport: { width: 390, height: 844 }, mobile: true }]) {
  const { ctx, calls, signing } = await ctxFor({ viewport: vp.viewport, mobile: vp.mobile, share: vp.mobile ? shareShim("ok") : noShareShim });
  const p = await ctx.newPage();
  await openBuilder(p);
  await p.locator('header button[aria-label="Send via My Email"]').click();
  await dialog(p).getByText(FILE).waitFor({ timeout: 8000 });
  await p.getByRole("radio", { name: "Signing link" }).click();
  check(`[${vp.name}] Signing link tab: no link is created until they ask`, signing.length === 0 && await p.getByTestId("se-create-link").isVisible());
  await p.getByTestId("se-create-link").click();
  await p.getByTestId("signing-url").waitFor({ timeout: 5000 });
  check(`[${vp.name}] Create signing link: one request, link shown in the dialog`, signing.length === 1 && (await p.inputValue('[data-testid="signing-url"]')).includes("/sign/NNNN"));
  const g = new URL(await p.getByTestId("se-gmail").getAttribute("href"));
  const gb = g.searchParams.get("body") ?? "";
  check(`[${vp.name}] Signing link: review-and-sign subject and message with the exact link, no attachment wording`, (await p.inputValue("#se-subject")) === SIGN_SUBJECT && gb === SIGN_BODY && g.searchParams.get("su") === SIGN_SUBJECT && g.searchParams.get("to") === "pat@example.test" && !/attach/i.test(gb), g.searchParams.get("su"));
  const f = await fit(p);
  check(`[${vp.name}] signing link view fits without scrolling`, f.inner <= 1 && f.overflow <= 0, JSON.stringify(f));
  await shot(p, `09-signing-link__${vp.name}`);
  let downloads = 0; p.on("download", () => downloads++);
  if (!vp.mobile) {
    const [pop] = await Promise.all([ctx.waitForEvent("page"), p.getByTestId("se-gmail").click()]);
    await p.waitForTimeout(300);
    check("[desktop] Gmail with a signing link: opens Gmail, downloads nothing", pop.url().includes("mail.google.com") && downloads === 0 && /with your signing link/.test(await dlgText(p)));
    await pop.close();
  } else {
    let pops = 0; ctx.on("page", (pg) => { pops++; void pg.close(); });
    await p.getByTestId("se-gmail").click();
    await p.waitForTimeout(400);
    check("[m390] Gmail with a signing link on a phone: no share sheet, no file", (await p.evaluate(() => window.__shared.length)) === 0 && downloads === 0 && pops === 1);
  }
  await p.getByRole("radio", { name: "PDF attachment" }).click();
  check(`[${vp.name}] back to PDF attachment: reuses the prepared PDF, no new export, PDF subject back`, calls.length === 1 && (await p.getByTestId("se-attachment").innerText()).includes(FILE) && (await p.inputValue("#se-subject")) === SUBJECT);
  await p.getByRole("radio", { name: "Signing link" }).click();
  check(`[${vp.name}] tab switching never creates another signing request`, signing.length === 1 && (await p.inputValue('[data-testid="signing-url"]')) === SIGN_URL);
  await ctx.close();
}

// ---------- 6. Edits per mode, link reuse, stale and revoked links ----------
{
  const { ctx, calls, signing } = await ctxFor();
  const p = await ctx.newPage();
  await openBuilder(p, "?step=proposal");
  await p.locator('header button[aria-label="Send via My Email"]').click();
  await dialog(p).getByText(FILE).waitFor({ timeout: 8000 });
  await p.fill("#se-subject", "Siding proposal for Pat");
  await p.getByTestId("se-edit-message").click();
  await p.fill("#se-body", "Hi Pat,\n\nProposal attached.\n\nAlex");
  await p.getByRole("radio", { name: "Signing link" }).click();
  await p.getByTestId("se-create-link").click();
  await p.getByTestId("signing-url").waitFor({ timeout: 5000 });
  check("PDF subject/message edits don't leak into the signing-link email", (await p.inputValue("#se-subject")) === SIGN_SUBJECT && (await p.inputValue("#se-body")) === SIGN_BODY);
  await p.fill("#se-subject", "Pat, please sign when you can");
  await p.getByRole("radio", { name: "PDF attachment" }).click();
  check("switching back keeps the typed PDF subject and message", (await p.inputValue("#se-subject")) === "Siding proposal for Pat" && (await p.inputValue("#se-body")) === "Hi Pat,\n\nProposal attached.\n\nAlex");
  await p.getByRole("radio", { name: "Signing link" }).click();
  check("…and the typed signing-link subject is never overwritten", (await p.inputValue("#se-subject")) === "Pat, please sign when you can");
  await p.keyboard.press("Escape");
  // Reopen: unchanged bid, so the same link is reused, with no new request.
  await p.locator('header button[aria-label="Send via My Email"]').click();
  await dialog(p).getByText(FILE).waitFor({ timeout: 8000 });
  await p.getByRole("radio", { name: "Signing link" }).click();
  check("reopening Email Proposal reuses the valid link (no new signing request)", signing.length === 1 && (await p.getByTestId("signing-url").count()) === 1 && (await p.inputValue('[data-testid="signing-url"]')) === SIGN_URL);
  await p.keyboard.press("Escape");
  await p.getByTestId("create-signing-link").click();
  await p.getByTestId("signing-url").waitFor({ timeout: 5000 });
  check("Proposal step Create Signing Link on an unchanged bid shows the same link, no new request", signing.length === 1);
  await p.keyboard.press("Escape");
  // Revoke it from the signing panel: it must never be offered again.
  const panel = p.getByTestId("signing-panel");
  await panel.getByRole("button", { name: "Revoke link" }).click({ timeout: 5000 });
  await p.waitForTimeout(500);
  await p.locator('header button[aria-label="Send via My Email"]').click();
  await dialog(p).getByText(FILE).waitFor({ timeout: 8000 });
  await p.getByRole("radio", { name: "Signing link" }).click();
  check("after Revoke link, the dialog offers Create signing link instead of the revoked link", signing.revoked === true && (await p.getByTestId("signing-url").count()) === 0 && await p.getByTestId("se-create-link").isVisible());
  await p.getByTestId("se-create-link").click();
  await p.getByTestId("signing-url").waitFor({ timeout: 5000 });
  check("a new request is made only when needed (after the revoke)", signing.length === 2);
  await p.keyboard.press("Escape");
  // Edit the bid: the link belongs to the old version and is dropped.
  await p.getByRole("button", { name: /Customer & project/ }).first().click();
  await p.fill("#est-title", "Siding replacement – Johnson home");
  await p.waitForTimeout(300);
  await p.locator('header button[aria-label="Send via My Email"]').click();
  await dialog(p).getByText(FILE).waitFor({ timeout: 8000 });
  await p.getByRole("radio", { name: "Signing link" }).click();
  check("after editing the bid, the old link is not offered (a new version needs a new link)", (await p.getByTestId("signing-url").count()) === 0 && await p.getByTestId("se-create-link").isVisible());
  check("every PDF in this run came from the one export path (deliver: bytes)", calls.every((c) => c.deliver === "bytes"), String(calls.length));
  await ctx.close();
}

// ---------- 7. Bid credits ----------
{
  const { ctx, calls } = await ctxFor();
  const p = await ctx.newPage();
  await openBuilder(p);
  await p.locator('header button[aria-label="Send via My Email"]').click();
  await dialog(p).getByText(FILE).waitFor({ timeout: 8000 });
  check("first export: the dialog says which credit was used", /Bid finalized with 1 starter credit/.test(await dlgText(p)));
  await p.keyboard.press("Escape");
  await p.locator('header button[aria-label="Send via My Email"]').click();
  await dialog(p).getByText(FILE).waitFor({ timeout: 8000 });
  check("reopening on the unchanged version: 'No credit used'", /Re-downloaded version 1\. No credit used/.test(await dlgText(p)) && calls.length === 2);
  await p.keyboard.press("Escape");
  await p.locator('header button[aria-label="Download PDF"]').click();
  await p.waitForTimeout(900);
  check("Download PDF of the same version goes through the same export (deliver: download)", calls.length === 3 && calls[2].deliver === "download");
  await ctx.close();
}
{
  const { ctx, calls } = await ctxFor({ credit: "quota" });
  const p = await ctx.newPage();
  await openBuilder(p);
  await p.locator('header button[aria-label="Send via My Email"]').click();
  await p.getByText("You've used your free bids").waitFor({ timeout: 6000 }).catch(() => {});
  check("free account at its limit: upgrade prompt, Email Proposal closes, nothing shared or downloaded", (await p.getByText("You've used your free bids").count()) >= 1 && (await p.getByTestId("email-proposal").count()) === 0 && calls.length === 1);
  await shot(p, "11-quota-upgrade__desktop");
  await ctx.close();
}
{
  const { ctx } = await ctxFor({ credit: "unlimited" });
  const p = await ctx.newPage();
  await openBuilder(p);
  await p.locator('header button[aria-label="Send via My Email"]').click();
  await dialog(p).getByText(FILE).waitFor({ timeout: 8000 });
  check("Unlimited account: PDF ready, no starter-credit wording", !/starter credit/.test(await dlgText(p)));
  await ctx.close();
}

// ---------- 8. Long messages and keyboard use ----------
{
  const { ctx } = await ctxFor();
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
  const p = await ctx.newPage();
  await openBuilder(p);
  await p.locator('header button[aria-label="Send via My Email"]').click();
  await dialog(p).getByText(FILE).waitFor({ timeout: 8000 });
  await p.getByTestId("se-edit-message").click();
  const long = `Hi Pat,\n\n${"Scope detail. ".repeat(260)}\n\nAlex`;
  await p.fill("#se-body", long);
  let pops = 0; ctx.on("page", (pg) => { pops++; void pg.close(); });
  await p.getByTestId("se-gmail").click();
  await p.waitForTimeout(400);
  const clip = await p.evaluate(() => navigator.clipboard.readText()).catch(() => "");
  check("message too long for a web link: says so and copies the full message (never silently cut)", /too long for a Gmail link/.test(await dlgText(p)) && clip.endsWith("Alex") && clip.includes(long.slice(0, 40)), `popups ${pops}`);
  await ctx.close();
}
{
  const { ctx } = await ctxFor();
  const p = await ctx.newPage();
  await openBuilder(p);
  await p.locator('header button[aria-label="Send via My Email"]').click();
  await dialog(p).getByText(FILE).waitFor({ timeout: 8000 });
  const order = [];
  for (let i = 0; i < 14; i++) { await p.keyboard.press("Tab"); order.push(await p.evaluate(() => document.activeElement?.getAttribute("data-testid") || document.activeElement?.id || document.activeElement?.textContent?.trim().slice(0, 20))); }
  check("keyboard: Tab reaches To, Subject, Edit message, Gmail, Outlook, Other email app and More options", ["se-to", "se-subject", "se-edit-message", "se-gmail", "se-outlook", "se-other"].every((k) => order.includes(k)) && order.some((t) => /More options/.test(t ?? "")), order.join(" > "));
  await p.getByRole("radio", { name: "PDF attachment" }).focus();
  await p.keyboard.press("ArrowRight");
  check("keyboard: arrow keys switch between PDF attachment and Signing link", (await p.getByRole("radio", { name: "Signing link" }).getAttribute("aria-checked")) === "true" && (await p.evaluate(() => document.activeElement?.getAttribute("data-mode"))) === "link");
  await p.keyboard.press("ArrowLeft");
  await p.getByTestId("se-other").focus();
  await p.keyboard.press("Enter");
  await p.waitForTimeout(300);
  check("keyboard: Enter on Other email app works", /Your email app should open/.test(await dlgText(p)));
  await p.keyboard.press("Escape");
  check("keyboard: Escape closes the dialog", (await p.locator('[role="dialog"]').count()) === 0);
  await ctx.close();
}
// From the Proposal step's Create Signing Link: the dialog opens in signing-link mode
{
  const { ctx, calls, signing } = await ctxFor();
  const p = await ctx.newPage();
  await openBuilder(p, "?step=proposal");
  await p.getByTestId("create-signing-link").dblclick();
  await p.getByTestId("signing-url").waitFor({ timeout: 6000 });
  check("Proposal step Create Signing Link: one request, opens Email Proposal on the Signing link tab", signing.length === 1 && (await p.getByRole("radio", { name: "Signing link" }).getAttribute("aria-checked")) === "true" && calls.length === 0);
  await shot(p, "10-from-signing-panel__desktop");
  await p.getByRole("radio", { name: "PDF attachment" }).click();
  await dialog(p).getByText(FILE).waitFor({ timeout: 8000 });
  check("switching to PDF attachment prepares the PDF once (same finalized version, no extra credit server-side)", calls.length === 1 && calls[0].deliver === "bytes");
  await ctx.close();
}

await browser.close();
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
