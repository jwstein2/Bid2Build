// Browser checks for the P0 fixes, Send via My Email and Watch Demo.
// Usage: node scripts/p0-email/walk.mjs <screenshotDir>
// Needs `next start` on :3000 built against scripts/ux-audit/mock-supabase.mjs (:54321).
// The export API is intercepted in the browser (the mock database can't finalize bids); nothing is sent anywhere.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = process.argv[2] ?? "p0-shots";
fs.mkdirSync(OUT, { recursive: true });
const EST = "11111111-1111-4111-8111-111111111111";

const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600 * 24 * 365 * 50, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF").toString("base64");

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };
const browser = await chromium.launch();
const noPopup = () => { try { localStorage.setItem("b2b:onboarding", JSON.stringify({ status: "dismissed", at: new Date().toISOString(), synced: true })); } catch { /* */ } };

async function ctxFor({ signedIn = false, viewport = { width: 1280, height: 900 }, share = null, exportFail = false } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, acceptDownloads: true });
  if (signedIn) await ctx.addCookies([authCookie]);
  await ctx.addInitScript(noPopup);
  if (share) await ctx.addInitScript(share);
  const calls = [];
  await ctx.route("**/api/estimates/save", (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }));
  await ctx.route("**/api/estimates/*/export", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    calls.push(body);
    await new Promise((r) => setTimeout(r, 400)); // like a real render: long enough for a double tap
    if (exportFail) return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { message: "We could not create the PDF. No bid credit was used. Please try again." } }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ url: body.deliver === "bytes" ? "https://storage.test/x" : null, pdfBase64: PDF, filename: "Summit-Exteriors-Proposal.pdf", versionId: "v1", versionNumber: 1, charged: calls.length === 1, creditSource: calls.length === 1 ? "starter" : "none", credits: { starter: 2, monthly: 0, unlimited: false, nextCycleAt: "2026-12-01" } }) });
  });
  return { ctx, calls };
}

// ---------- 1. Builder header at every width ----------
{
  const { ctx } = await ctxFor();
  const p = await ctx.newPage();
  await p.goto(`${BASE}/start/decks`, { waitUntil: "networkidle" });
  await p.waitForURL(/builder\?draft=/);
  await p.waitForSelector("#est-title");
  for (const w of [320, 375, 390, 428, 650, 700, 768, 780, 1024, 1440]) {
    await p.setViewportSize({ width: w, height: 800 });
    await p.waitForTimeout(250);
    const m = await p.evaluate(() => {
      const r = (el) => el?.getBoundingClientRect();
      const btns = ["Download PDF", "Send via My Email"].map((l) => r(document.querySelector(`header button[aria-label="${l}"]`)));
      const prev = [...document.querySelectorAll("header button")].find((b) => /Preview/.test(b.textContent ?? ""));
      return {
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        title: r(document.getElementById("est-title")).width,
        clipped: [...btns, r(prev)].some((b) => !b || b.right > window.innerWidth + 0.5 || b.left < 0 || b.width < 30),
        header: r(document.querySelector("header")).height,
      };
    });
    await p.screenshot({ path: path.join(OUT, `header-${w}.png`), clip: { x: 0, y: 0, width: w, height: Math.min(Math.ceil(m.header) + 10, 400) } });
    check(`header ${w}px: no page overflow, buttons fully visible, title readable`, m.overflow <= 0 && !m.clipped && m.title >= Math.min(200, w - 80), `overflow ${m.overflow}, title ${Math.round(m.title)}px, header ${Math.round(m.header)}px`);
  }
  await ctx.close();
}

// ---------- 2. Title, validation, step indicators (anonymous draft) ----------
{
  const { ctx } = await ctxFor();
  const p = await ctx.newPage();
  await p.goto(`${BASE}/start/decks`, { waitUntil: "networkidle" });
  await p.waitForURL(/builder\?draft=/);
  const startTitle = await p.inputValue("#est-title");
  check("new bid starts with the trade's starter title", /Project$/.test(startTitle), startTitle);

  // Download with nothing filled in: missing-details notice, jumps to company name, no sign-in dialog
  await p.locator('header button[aria-label="Download PDF"]').click();
  await p.waitForSelector('[data-testid="export-missing"]');
  const missing = await p.locator('[data-testid="export-missing"] li').allTextContents();
  check("Download on an empty draft lists what is missing instead of asking to sign up", missing.length >= 4 && missing.some((t) => t.includes("Add a project address before downloading this proposal.")), missing.map((t) => t.split(".")[0]).join(" | "));
  await p.waitForTimeout(300);
  check("it opens the first missing field (company name)", await p.evaluate(() => document.activeElement?.id === "b-name"));
  check("no sign-in dialog was opened", (await p.locator('[role="dialog"]').count()) === 0);
  await p.screenshot({ path: path.join(OUT, "validation-missing.png") });

  // Step indicators: nothing is checked yet
  const marks = async () => p.evaluate(() => [...document.querySelectorAll('nav[aria-label="Builder steps"] button')].map((b) => (b.textContent ?? "").replace(/\s+/g, " ").trim()));
  await p.getByRole("button", { name: /Customer & project/ }).first().click();
  await p.getByRole("button", { name: /^\d?\s*Estimate/ }).first().click();
  let m = await marks();
  check("opened but empty steps are not marked done", !m.some((t) => t.includes("(done)")) && m.filter((t) => t.includes("(needs details)")).length >= 2, m.join(" | "));
  await p.screenshot({ path: path.join(OUT, "steps-needs-attention.png"), clip: { x: 0, y: 0, width: 1280, height: 220 } });

  // Fill company
  await p.getByRole("button", { name: /Company/ }).first().click();
  await p.fill("#b-name", "Summit Decks LLC");
  await p.fill("#b-contact", "Alex Rivera");
  await p.fill("#b-email", "alex@summit.test");
  await p.fill("#b-phone", "5550102030");
  await p.fill("#b-addr", "120 Main St, Springfield");
  // Customer & project, including the title
  await p.getByRole("button", { name: /Customer & project/ }).first().click();
  const t0 = await p.inputValue("#p-title");
  const ph = await p.getAttribute("#p-title", "placeholder");
  check("project title field shows the starter title as a suggestion, not as text to append to", t0 === "" && ph === startTitle, `value "${t0}", placeholder "${ph}"`);
  await p.click("#p-title");
  await p.keyboard.type("Smith backyard deck");
  check("typing a title replaces the starter title", (await p.inputValue("#p-title")) === "Smith backyard deck" && (await p.inputValue("#est-title")) === "Smith backyard deck");
  await p.fill("#c-name", "Pat Smith");
  await p.fill("#c-email", "pat@example.com");
  await p.fill("#c-addr", "48 Oak Lane");
  await p.screenshot({ path: path.join(OUT, "title-typed.png") });
  m = await marks();
  check("company and customer steps show a check once complete", m[0].includes("(done)") && m[1].includes("(done)"), m.slice(0, 2).join(" | "));

  // Header title on a fresh starter title: select-all on focus
  // (checked on a second draft below)

  // Estimate: add an unpriced item → still not done
  await p.getByRole("button", { name: /^\d?\s*Estimate/ }).first().click();
  await p.waitForTimeout(300);
  m = await marks();
  check("estimate with no priced items is not marked done", !m[2].includes("(done)"), m[2]);

  // Proposal preview: legal placeholder gone, edited title shown
  await p.getByRole("button", { name: /^\d?\s*Proposal/ }).first().click();
  await p.waitForTimeout(400);
  const livePreview = p.locator("text=Live preview: exactly what your customer will see").locator("..");
  check("proposal preview shows the edited title", (await livePreview.innerText()).includes("Smith backyard deck"));
  // A legacy draft's terms with the old instructional sentence
  await p.fill("#pt-terms", "Valid for 30 days. [Placeholder terms: have these reviewed by your attorney.]");
  await p.waitForTimeout(300);
  const preview = await livePreview.innerText();
  check("proposal preview keeps real terms but drops instructional legal text", preview.includes("Valid for 30 days.") && !/placeholder|attorney/i.test(preview));
  check("terms guidance stays in the editor", (await p.locator("main").innerText()).includes("Only you see this note"));
  await p.screenshot({ path: path.join(OUT, "proposal-step.png"), fullPage: false });

  // Reload: title persists (autosave to this device)
  await p.reload({ waitUntil: "networkidle" });
  check("edited title survives a refresh", (await p.inputValue("#est-title")) === "Smith backyard deck");
  await ctx.close();
}
{
  const { ctx } = await ctxFor();
  const p = await ctx.newPage();
  await p.goto(`${BASE}/start/roofing`, { waitUntil: "networkidle" });
  await p.waitForURL(/builder\?draft=/);
  await p.click("#est-title");
  await p.waitForTimeout(100);
  await p.keyboard.type("Lee roof");
  check("header title: typing over the starter title replaces it", (await p.inputValue("#est-title")) === "Lee roof", await p.inputValue("#est-title"));
  await ctx.close();
}

// ---------- 3. Send via My Email (signed in, complete estimate) ----------
const shareShim = (mode) => `(() => {
  window.__shared = [];
  Object.defineProperty(navigator, "canShare", { configurable: true, value: (d) => Boolean(d && d.files && d.files.length) });
  Object.defineProperty(navigator, "share", { configurable: true, value: async (d) => {
    window.__shared.push({ files: (d.files || []).map((f) => ({ name: f.name, type: f.type, size: f.size })), title: d.title, text: d.text, active: navigator.userActivation ? navigator.userActivation.isActive : null });
    if (${JSON.stringify(mode)} === "cancel") { const e = new Error("cancel"); e.name = "AbortError"; throw e; }
  } });
})()`;
const noShareShim = `(() => { try { delete Navigator.prototype.share; delete Navigator.prototype.canShare; } catch {} Object.defineProperty(navigator, "share", { configurable: true, value: undefined }); Object.defineProperty(navigator, "canShare", { configurable: true, value: undefined }); })()`;

async function openSend(p) {
  await p.goto(`${BASE}/estimates/${EST}`, { waitUntil: "networkidle" });
  await p.waitForSelector('header button[aria-label="Send via My Email"]');
  await p.waitForTimeout(500);
}

for (const vp of [{ name: "desktop", viewport: { width: 1280, height: 900 } }, { name: "m390", viewport: { width: 390, height: 844 } }]) {
  // 3a. File sharing supported
  {
    const { ctx, calls } = await ctxFor({ signedIn: true, viewport: vp.viewport, share: shareShim("ok") });
    const p = await ctx.newPage();
    await openSend(p);
    const btn = p.locator('header button[aria-label="Send via My Email"]');
    await btn.click(); await btn.click({ force: true }).catch(() => {}); // double tap
    await p.getByText("Share PDF to email app").waitFor({ timeout: 8000 });
    check(`[${vp.name}] double tap prepares the PDF once (one export request)`, calls.length === 1, `${calls.length} request(s)`);
    check(`[${vp.name}] Send uses the normal export, asking for the PDF bytes`, calls[0]?.deliver === "bytes");
    const to = await p.inputValue("#se-to"); const subj = await p.inputValue("#se-subject"); const body = await p.inputValue("#se-body");
    check(`[${vp.name}] recipient, subject and greeting come from the estimate`, to === "pat@example.test" && subj === "Your Estimate from Summit Exteriors LLC — Siding replacement – Johnson residence" && body.startsWith("Hi Pat,"), `${to} | ${subj}`);
    check(`[${vp.name}] signature uses only entered details`, body.trimEnd().endsWith("Alex Rivera\nSummit Exteriors LLC\n(555) 010-2030"), JSON.stringify(body.split("\n").slice(-3)));
    await p.screenshot({ path: path.join(OUT, `send-share-ready-${vp.name}.png`), fullPage: false });
    await p.getByRole("button", { name: "Share PDF to email app" }).click();
    await p.waitForTimeout(300);
    const shared = await p.evaluate(() => window.__shared);
    check(`[${vp.name}] share sheet gets the PDF file from a fresh tap`, shared.length === 1 && shared[0].files[0]?.name === "Summit-Exteriors-Proposal.pdf" && shared[0].files[0]?.type === "application/pdf" && shared[0].active !== false, JSON.stringify(shared[0]?.files));
    const msg = await p.locator('[role="dialog"]').innerText();
    check(`[${vp.name}] after sharing it never claims the email was sent`, /Built2Bid didn't send anything/.test(msg) && !/email sent|sent successfully/i.test(msg));
    await p.screenshot({ path: path.join(OUT, `send-share-done-${vp.name}.png`) });
    // Close and send again: same unchanged version, a second export call that the server treats as free
    await p.keyboard.press("Escape");
    await p.locator('header button[aria-label="Download PDF"]').click();
    await p.waitForTimeout(800);
    check(`[${vp.name}] switching to Download PDF reuses the export path`, calls.length === 2 && calls[1].deliver === "download");
    await ctx.close();
  }
  // 3b. Share canceled
  {
    const { ctx } = await ctxFor({ signedIn: true, viewport: vp.viewport, share: shareShim("cancel") });
    const p = await ctx.newPage();
    await openSend(p);
    await p.locator('header button[aria-label="Send via My Email"]').click();
    await p.getByRole("button", { name: "Share PDF to email app" }).click();
    await p.getByText("Sharing was canceled. Nothing was sent.").waitFor({ timeout: 4000 }).then(() => check(`[${vp.name}] canceling the share sheet says nothing was sent`, true)).catch(() => check(`[${vp.name}] canceling the share sheet says nothing was sent`, false));
    await ctx.close();
  }
  // 3c. No file sharing: download + mailto fallback
  {
    const { ctx } = await ctxFor({ signedIn: true, viewport: vp.viewport, share: noShareShim });
    const p = await ctx.newPage();
    await openSend(p);
    await p.locator('header button[aria-label="Send via My Email"]').click();
    await p.getByText("Two quick steps").waitFor({ timeout: 8000 });
    check(`[${vp.name}] without file sharing, no "attach automatically" option is offered`, (await p.getByText("Share PDF to email app").count()) === 0);
    const [dl] = await Promise.all([p.waitForEvent("download"), p.getByRole("button", { name: "Download PDF" }).last().click()]);
    check(`[${vp.name}] fallback downloads the PDF`, dl.suggestedFilename() === "Summit-Exteriors-Proposal.pdf");
    const href = await p.getByRole("link", { name: "Open email draft" }).getAttribute("href");
    const u = new URL(href);
    check(`[${vp.name}] email draft link has the recipient, subject and message`, u.protocol === "mailto:" && u.pathname === "pat@example.test" && u.searchParams.get("subject")?.startsWith("Your Estimate from Summit Exteriors LLC") && u.searchParams.get("body")?.startsWith("Hi Pat,\r\n"), href.slice(0, 90));
    await p.screenshot({ path: path.join(OUT, `send-fallback-${vp.name}.png`) });
    check(`[${vp.name}] fallback explains the PDF must be attached manually`, (await p.locator('[role="dialog"]').innerText()).includes("Email links can't attach files"));
    await ctx.close();
  }
}
// 3d. Export failure: clear error, retry, no false success
{
  const { ctx, calls } = await ctxFor({ signedIn: true, exportFail: true, share: shareShim("ok") });
  const p = await ctx.newPage();
  await openSend(p);
  await p.locator('header button[aria-label="Send via My Email"]').click();
  await p.getByText("No bid credit was used").waitFor({ timeout: 6000 });
  check("a failed PDF shows the error with Try again, and no share option", (await p.getByText("Share PDF to email app").count()) === 0 && (await p.getByRole("button", { name: "Try again" }).count()) === 1);
  await p.getByRole("button", { name: "Try again" }).click();
  await p.waitForTimeout(800);
  check("Try again makes one more request", calls.length === 2);
  await ctx.close();
}
// 3e. Anonymous Send: readiness/sign-in first, no export request
{
  const { ctx, calls } = await ctxFor();
  const p = await ctx.newPage();
  await p.goto(`${BASE}/start/decks`, { waitUntil: "networkidle" });
  await p.waitForURL(/builder\?draft=/);
  await p.locator('header button[aria-label="Send via My Email"]').click();
  await p.waitForSelector('[data-testid="export-missing"]');
  check("Send on an incomplete draft shows missing details and sends no request", calls.length === 0);
  await ctx.close();
}

// ---------- 4. Watch Demo reopens the same onboarding modal ----------
for (const vp of [{ name: "desktop", viewport: { width: 1280, height: 900 } }, { name: "m390", viewport: { width: 390, height: 844 } }]) {
  const { ctx } = await ctxFor({ viewport: vp.viewport });
  const p = await ctx.newPage();
  await p.goto(BASE, { waitUntil: "networkidle" });
  const btn = p.getByTestId("watch-demo");
  check(`[${vp.name}] homepage shows a Watch Demo button`, await btn.isVisible());
  await btn.click();
  const dlg = p.locator('[role="dialog"]');
  await dlg.first().waitFor({ timeout: 5000 });
  check(`[${vp.name}] Watch Demo opens the onboarding tour`, (await dlg.count()) === 1 && /Built2Bid/i.test(await dlg.first().innerText()));
  await p.screenshot({ path: path.join(OUT, `watch-demo-open-${vp.name}.png`) });
  await p.keyboard.press("Escape");
  await p.waitForTimeout(400);
  check(`[${vp.name}] Escape closes it`, (await p.locator('[role="dialog"]').count()) === 0);
  check(`[${vp.name}] replay leaves the saved onboarding status alone`, await p.evaluate(() => JSON.parse(localStorage.getItem("b2b:onboarding") ?? "{}").status === "dismissed"));
  check(`[${vp.name}] focus returns to the button`, await p.evaluate(() => document.activeElement?.getAttribute("data-testid") === "watch-demo"));
  check(`[${vp.name}] homepage still has exactly one H1`, (await p.locator("h1").count()) === 1);
  await p.screenshot({ path: path.join(OUT, `home-hero-${vp.name}.png`) });
  await ctx.close();
}
// Automatic popup still opens for a brand-new visitor
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(BASE, { waitUntil: "load" });
  const auto = await p.locator('[role="dialog"]').first().waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
  check("new visitors still get the onboarding popup automatically", auto);
  await ctx.close();
}

await browser.close();
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
