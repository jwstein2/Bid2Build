// V8 batch 4 walk: T1 (one free bid left), T8 (proposal ready + referral), caps across exports,
// BLD-2 (save draft to email, visitors), T5 (annual nudge) and RET-1 (Before you go) on billing.
// Needs scripts/ux-audit/mock-supabase.mjs on :54321 and `next start` on :3000 built against it.
// The export and Stripe portal APIs are intercepted in the browser: nothing is charged or sent.
// Usage: node scripts/marketing/v8-offers-walk.mjs <outDir>
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const AXE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const BASE = process.env.BASE ?? "http://localhost:3000";
const MOCK = process.env.MOCK ?? "http://localhost:54321";
const out = process.argv[2] ?? "v8-offers-shots";
fs.mkdirSync(out, { recursive: true });
const EST = "11111111-1111-4111-8111-111111111111";

const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString(), created_at: new Date(Date.now() - 30 * 86400000).toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600 * 24 * 365 * 50, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF").toString("base64");
const noPopup = () => { try { localStorage.setItem("b2b:onboarding", JSON.stringify({ status: "dismissed", at: new Date().toISOString(), synced: true })); } catch { /* */ } };

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 300) }); console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` ${detail}`}`); };
const mock = (q) => fetch(`${MOCK}${q}`).then((r) => r.json());
async function axe(page, tag, selector) {
  await page.addScriptTag({ content: AXE });
  const r = await page.evaluate(async (sel) => (await window.axe.run(sel ? document.querySelector(sel) : document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.map((v) => `${v.id}(${v.nodes.length})`), selector);
  check(`${tag} axe wcag2a/aa violations = 0`, r.length === 0, r.join(", "));
}

const browser = await chromium.launch();
async function ctxFor({ signedIn = true, viewport = { width: 1280, height: 900 }, mobile = false, left = { starter: 1, monthly: 0 } } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, acceptDownloads: true, isMobile: mobile, hasTouch: mobile });
  if (signedIn) await ctx.addCookies([authCookie]);
  await ctx.addInitScript(noPopup);
  const calls = { export: 0, portal: [] };
  await ctx.route("**/api/estimates/save", (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }));
  await ctx.route("**/api/estimates/*/export", async (route) => {
    calls.export++;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ url: null, pdfBase64: PDF, filename: "Proposal.pdf", versionId: "v1", versionNumber: 1, charged: true, creditSource: "starter", credits: { ...left, unlimited: false, nextCycleAt: "2026-12-01" } }) });
  });
  await ctx.route("**/api/stripe/portal", async (route) => {
    calls.portal.push(JSON.parse(route.request().postData() || "{}"));
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ url: `${BASE}/settings/billing?portal=stub` }) });
  });
  return { ctx, calls };
}
const download = async (p) => { await p.locator('header button[aria-label="Download PDF"]').click(); await p.waitForTimeout(1500); };
const openBuilder = async (p) => { await p.goto(`${BASE}/estimates/${EST}`, { waitUntil: "networkidle" }); await p.waitForSelector('header button[aria-label="Download PDF"]'); await p.waitForTimeout(400); };

// 1. T1 after an export that leaves one free bid; caps hold on the next export.
await mock("/__scenario?name=starter"); await mock("/__offers?reset=1&referral=1&nobilling=1");
{
  const { ctx } = await ctxFor({ left: { starter: 1, monthly: 0 } });
  const p = await ctx.newPage(); await openBuilder(p);
  await download(p);
  const t1 = p.getByTestId("offer-t1");
  check("T1: one free bid left note appears after the export", await t1.isVisible());
  check("T1: copy names the price and keeps drafts free", /1 free bid left/.test(await t1.innerText()) && /\$19\.99\/month/.test(await t1.innerText()) && /drafts stay free/.test(await t1.innerText()));
  check("T1: not a modal (no dialog opened)", (await p.locator("[role=dialog]").count()) === 0);
  await axe(p, "T1 note", "[data-testid=offer-t1]");
  await t1.screenshot({ path: `${out}/t1-note__d1280.png` });
  await p.screenshot({ path: `${out}/t1-builder__d1280.png` });
  await t1.getByRole("button", { name: "Not now" }).click();
  check("T1: Not now hides it", !(await t1.isVisible()));
  await download(p);
  check("caps: no second offer right after (T1 capped, T8 waits 24h after a dismissal)", (await p.getByTestId("offer-t1").count()) === 0 && (await p.getByTestId("offer-t8").count()) === 0);
  const log = (await mock("/__offers")).offers;
  check("log: one shown + one dismissed, no bid data", log.length === 2 && log.every((r) => ["t1_credits_low"].includes(r.offer_id) && !("total" in r)), JSON.stringify(log));
  await ctx.close();
}

// 2. T8 after an export with 2+ bids left: celebration with referral link, then once ever.
await mock("/__offers?reset=1&referral=1");
{
  const { ctx } = await ctxFor({ viewport: { width: 390, height: 844 }, mobile: true, left: { starter: 2, monthly: 0 } });
  const p = await ctx.newPage(); await openBuilder(p);
  await download(p);
  const t8 = p.getByTestId("offer-t8");
  check("T8: proposal ready note with referral link", await t8.isVisible() && (await t8.locator("input").inputValue()).endsWith("/r/AB3DE7GH"));
  check("T8: copy says the referrer earns the month (no promise to the friend)", /When they start a paid plan, you get a month free/.test(await t8.innerText()));
  await t8.screenshot({ path: `${out}/t8-note__m390.png` });
  check("T8 at 390px: no horizontal scroll", await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await p.reload({ waitUntil: "networkidle" }); await p.waitForSelector('header button[aria-label="Download PDF"]');
  await download(p);
  check("T8: shows once ever (not on the next export)", (await p.getByTestId("offer-t8").count()) === 0);
  await ctx.close();
}

// 3. Company members never see offers.
await mock("/__scenario?name=enterprise_estimator"); await mock("/__offers?reset=1&referral=1");
{
  const { ctx } = await ctxFor({ left: { starter: 1, monthly: 0 } });
  const p = await ctx.newPage(); await openBuilder(p);
  await download(p);
  check("company member: no T1 or T8", (await p.getByTestId("offer-t1").count()) === 0 && (await p.getByTestId("offer-t8").count()) === 0);
  await ctx.close();
}

// 4. BLD-2 for visitors: appears after a priced line, opens the email dialog, dismissal sticks.
await mock("/__scenario?name=starter");
{
  const { ctx } = await ctxFor({ signedIn: false });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/tools/concrete-calculator`, { waitUntil: "networkidle" });
  await p.getByLabel("Length", { exact: true }).fill("10"); await p.getByLabel("Width", { exact: true }).fill("10"); await p.getByLabel("Thickness", { exact: true }).fill("4");
  await p.getByTestId("tool-send").click(); await p.waitForURL(/builder\?draft=/); await p.waitForTimeout(1500);
  const note = p.getByTestId("save-draft-note");
  check("BLD-2: hidden while no line has a price", (await note.count()) === 0);
  // Price the Ready-mix line (unit cost field for that row).
  const expand = p.getByRole("button", { name: "Expand all" }); if (await expand.count()) await expand.first().click();
  const cost = p.locator("input[aria-label*='Unit cost' i]").first();
  await cost.fill("150"); await cost.blur(); await p.waitForTimeout(600);
  check("BLD-2: appears once a line has a price", await note.isVisible());
  await note.screenshot({ path: `${out}/bld2-note__d1280.png` });
  await axe(p, "BLD-2 note", "[data-testid=save-draft-note]");
  await note.getByRole("button", { name: "Save to my email" }).click();
  const dlg = p.locator("[role=dialog]");
  check("BLD-2: opens the email dialog titled 'Save this bid to your email'", await dlg.isVisible() && /Save this bid to your email/.test(await dlg.innerText()));
  check("BLD-2: dialog says saving doesn't use a bid", /doesn't use a bid/.test(await dlg.innerText()));
  await p.screenshot({ path: `${out}/bld2-dialog__d1280.png` });
  await p.keyboard.press("Escape");
  await note.getByRole("button", { name: "Not now" }).click();
  await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(1200);
  check("BLD-2: Not now sticks on this device", (await p.getByTestId("save-draft-note").count()) === 0);
  await ctx.close();
}

// 5. T5 + RET-1 on billing for an eligible monthly subscriber.
await mock("/__scenario?name=unlimited"); await mock("/__offers?reset=1&nudge=1");
{
  const { ctx, calls } = await ctxFor({});
  const p = await ctx.newPage();
  await p.goto(`${BASE}/settings/billing`, { waitUntil: "networkidle" }); await p.waitForTimeout(800);
  const t5 = p.getByTestId("offer-t5");
  check("T5: annual nudge shows with real savings", await t5.isVisible() && /saves \$90\.88 a year/.test(await t5.innerText()), await t5.innerText().catch(() => "missing"));
  await t5.screenshot({ path: `${out}/t5-nudge__d1280.png` });
  await axe(p, "billing page with offers");
  await t5.getByRole("button", { name: "Switch to annual" }).click(); await p.waitForURL(/portal=stub/);
  check("T5: Switch to annual opens Stripe's plan change (intent annual)", calls.portal.at(-1)?.intent === "annual");
  await p.goto(`${BASE}/settings/billing`, { waitUntil: "networkidle" }); await p.waitForTimeout(800);
  check("T5: capped after being shown", (await p.getByTestId("offer-t5").count()) === 0);
  await p.getByTestId("cancel-start").click();
  const step = p.getByTestId("cancel-step");
  check("RET-1: Before you go opens inline with reasons, export link and annual option", await step.isVisible() && (await step.locator("input[type=radio]").count()) === 7 && await step.getByRole("link", { name: "Export all your data" }).isVisible() && await step.getByRole("button", { name: /Switch to annual instead/ }).isVisible());
  await step.screenshot({ path: `${out}/ret1-step__d1280.png` });
  await step.getByLabel("My work is seasonal or slow").check();
  await step.getByTestId("cancel-continue").click(); await p.waitForURL(/portal=stub/);
  check("RET-1: Continue opens Stripe's cancel page (intent cancel)", calls.portal.at(-1)?.intent === "cancel");
  await p.waitForTimeout(500);
  const log = (await mock("/__offers")).offers;
  check("RET-1: reason recorded as a code", log.some((r) => r.offer_id === "ret1_cancel" && r.action === "answered" && r.detail === "seasonal"), JSON.stringify(log.map((r) => [r.offer_id, r.action, r.detail])));
  await p.goto(`${BASE}/settings/billing`, { waitUntil: "networkidle" });
  await p.getByTestId("cancel-start").click();
  await p.getByTestId("cancel-continue").click(); await p.waitForURL(/portal=stub/);
  check("RET-1: never blocks: continue works with no reason", calls.portal.at(-1)?.intent === "cancel");
  await ctx.close();

  const m = await ctxFor({ viewport: { width: 390, height: 844 }, mobile: true });
  const q = await m.ctx.newPage();
  await q.goto(`${BASE}/settings/billing`, { waitUntil: "networkidle" });
  await q.getByTestId("cancel-start").click();
  check("RET-1 at 390px: no horizontal scroll", await q.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await q.getByTestId("cancel-step").screenshot({ path: `${out}/ret1-step__m390.png` });
  await m.ctx.close();
}

// 6. No nudge or cancel step for a canceling or free account.
await mock("/__scenario?name=canceling"); await mock("/__offers?reset=1&nudge=1");
{
  const { ctx } = await ctxFor({});
  const p = await ctx.newPage(); await p.goto(`${BASE}/settings/billing`, { waitUntil: "networkidle" }); await p.waitForTimeout(800);
  check("canceling subscriber: no nudge, no second cancel step", (await p.getByTestId("offer-t5").count()) === 0 && (await p.getByTestId("cancel-start").count()) === 0);
  await ctx.close();
}
await mock("/__scenario?name=starter"); await mock("/__offers?reset=1&nobilling=1");

await browser.close();
fs.writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
