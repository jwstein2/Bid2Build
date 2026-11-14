// Browser walk for the trade-first New Bid flow, mobile calculators and the selected-items toolbar.
// Usage: build against the mock Supabase (scripts/ux-audit/mock-supabase.mjs on :54321), `next start`
// on :3000, then: node scripts/new-bid-mobile/walk.mjs <screenshotDir> [flow|calc|toolbar|empty]
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const out = process.argv[2] ?? "new-bid-shots";
const only = process.argv[3] ?? "";
fs.mkdirSync(out, { recursive: true });
const BASE = "http://localhost:3000";
const EST = "11111111-1111-4111-8111-111111111111";
const results = [];
const check = (n, ok, d = "") => { results.push({ n, ok, d }); console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? " — " + d : ""}`); };

const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600 * 24 * 365 * 50, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };

const VIEWPORTS = [
  { tag: "m320", width: 320, height: 640, mobile: true },
  { tag: "m375", width: 375, height: 667, mobile: true },
  { tag: "m390", width: 390, height: 844, mobile: true },
  { tag: "m430", width: 430, height: 932, mobile: true },
  { tag: "tablet", width: 820, height: 1180, mobile: true },
  { tag: "desktop", width: 1440, height: 900, mobile: false },
];
const ctxFor = (browser, vp, extra = {}) => browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile && vp.width < 768, hasTouch: vp.mobile, ...extra });
const currentStep = (page) => page.locator('nav[aria-label="Builder steps"] [aria-current="step"]').innerText().then((t) => t.replace(/^\d+\s*/, "").replace(/\(done\)/, "").trim());
const companyDone = (page) => page.locator('nav[aria-label="Builder steps"] li').first().innerText().then((t) => /done/.test(t));
const tap = async (page, loc) => { if ((await page.evaluate(() => "ontouchstart" in window))) await loc.tap(); else await loc.click(); };

async function flow(browser) {
  const vp = VIEWPORTS[2];
  // A. First-time visitor: trade chooser → Company
  {
    const ctx = await ctxFor(browser, vp); const page = await ctx.newPage();
    await page.goto(`${BASE}/bids`);
    check("A trade chooser asks 'What are you bidding today?'", await page.getByRole("heading", { name: "What are you bidding today?" }).isVisible());
    await page.getByRole("link", { name: /^Roofing/ }).first().click();
    await page.waitForURL(/builder\?draft=/);
    await page.waitForSelector('nav[aria-label="Builder steps"]');
    check("A first-time visitor lands on Company", (await currentStep(page)) === "Company", await currentStep(page));
    check("A Company not checked yet", !(await companyDone(page)));
    await page.screenshot({ path: `${out}/flow-new-visitor-company__${vp.tag}.png` });
    await page.fill("#b-name", "Summit Builders"); await page.fill("#b-contact", "Alex Rivera"); await page.fill("#b-email", "office@summit.test"); await page.fill("#b-phone", "555-010-2030");
    check("A Company still unchecked with address missing", !(await companyDone(page)));
    await page.fill("#b-addr", "120 Main St");
    check("A Company checked once all required fields are filled", await companyDone(page));
    await page.getByRole("button", { name: /Next: customer & project/ }).click();
    check("A Next goes to Customer & project", (await currentStep(page)) === "Customer & project");
    await page.reload(); await page.waitForSelector('nav[aria-label="Builder steps"]');
    check("A refresh resumes on Customer & project (not the trade chooser or Company)", (await currentStep(page)) === "Customer & project", await currentStep(page));
    check("A Roofing trade kept on the bid", /Roofing/.test(await page.locator("#est-title").inputValue()), await page.locator("#est-title").inputValue());
    await page.getByRole("button", { name: /Next: build the estimate/ }).click();
    check("A Next goes to Estimate", (await currentStep(page)) === "Estimate");
    // B. Same visitor (profile now saved on this device) starts another bid
    await page.goto(`${BASE}/bids`);
    await page.getByRole("link", { name: /^Decks/ }).first().click();
    await page.waitForURL(/builder\?draft=/); await page.waitForSelector('nav[aria-label="Builder steps"]');
    check("B returning visitor with a complete profile lands on Customer & project", (await currentStep(page)) === "Customer & project", await currentStep(page));
    check("B Company shows a check mark", await companyDone(page));
    check("B Decks trade on the new bid", /Deck/.test(await page.locator("#est-title").inputValue()));
    await page.screenshot({ path: `${out}/flow-returning-project__${vp.tag}.png` });
    await ctx.close();
  }
  // C. Partial profile (name only) → Company
  {
    const ctx = await ctxFor(browser, vp);
    await ctx.addInitScript(() => { try { localStorage.setItem("byb:business", JSON.stringify({ companyName: "Name Only LLC", primaryColor: "#0B2D4D", secondaryColor: "#00C2E0", logoLayout: "left", headerStyle: "solid" })); } catch {} });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/start/concrete`); await page.waitForURL(/builder\?draft=/); await page.waitForSelector('nav[aria-label="Builder steps"]');
    check("C incomplete profile (name only) lands on Company", (await currentStep(page)) === "Company", await currentStep(page));
    await ctx.close();
  }
  // D. Signed in, complete saved profile → Customer & project
  {
    const ctx = await ctxFor(browser, vp); await ctx.addCookies([authCookie]);
    const page = await ctx.newPage();
    await page.route("**/api/estimates/save", (r) => r.fulfill({ status: 503, body: "{}" })); // keep the draft local for this check
    await page.goto(`${BASE}/bids`);
    await page.getByRole("link", { name: /^Roofing/ }).first().click();
    await page.waitForURL(/builder\?draft=/); await page.waitForSelector('nav[aria-label="Builder steps"]');
    check("D signed-in contractor with a complete profile lands on Customer & project", (await currentStep(page)) === "Customer & project", await currentStep(page));
    check("D Company shows a check mark", await companyDone(page));
    await page.screenshot({ path: `${out}/flow-signed-in-project__${vp.tag}.png` });
    // E. Resuming a saved cloud bid
    await page.goto(`${BASE}/estimates/${EST}`); await page.waitForSelector('nav[aria-label="Builder steps"]');
    check("E saved bid with a customer resumes at Estimate", (await currentStep(page)) === "Estimate", await currentStep(page));
    await page.locator('nav[aria-label="Builder steps"] button', { hasText: "Scope" }).click();
    await page.goto(`${BASE}/estimates/${EST}`); await page.waitForSelector('nav[aria-label="Builder steps"]'); await page.waitForTimeout(400);
    check("E reopening the bid on this device returns to the last step (Scope)", /Scope/.test(await currentStep(page)), await currentStep(page));
    await page.goto(`${BASE}/estimates/${EST}?step=proposal`); await page.waitForSelector('nav[aria-label="Builder steps"]'); await page.waitForTimeout(300);
    check("E dashboard Preview link still opens Proposal", (await currentStep(page)) === "Proposal", await currentStep(page));
    await ctx.close();
  }
}

// F. Signed in without a saved company profile. Start the mock with MOCK_EMPTY_PROFILE=1 and pass "empty".
async function emptyProfile(browser) {
  const vp = VIEWPORTS[2];
  {
    const ctx = await ctxFor(browser, vp); await ctx.addCookies([authCookie]);
    const page = await ctx.newPage();
    await page.route("**/api/estimates/save", (r) => r.fulfill({ status: 503, body: "{}" }));
    await page.route("**/api/business", (r) => r.fulfill({ status: 200, body: "{}" }));
    await page.goto(`${BASE}/start/roofing`); await page.waitForURL(/builder\?draft=/); await page.waitForSelector('nav[aria-label="Builder steps"]');
    check("F signed-in account without a company profile lands on Company", (await currentStep(page)) === "Company", await currentStep(page));
    check("F Company not checked", !(await companyDone(page)));
    await page.screenshot({ path: `${out}/flow-signed-in-no-profile__${vp.tag}.png` });
    await ctx.close();
  }
}

async function openEstimate(page) {
  await page.goto(`${BASE}/estimates/${EST}?step=estimate`);
  await page.waitForSelector('nav[aria-label="Builder steps"]');
  const expand = page.getByRole("button", { name: "Expand all" });
  if (await expand.count()) await expand.click();
  await page.waitForTimeout(200);
}

async function calc(browser) {
  for (const vp of VIEWPORTS) {
    const T = (n) => `[${vp.tag}] calc: ${n}`;
    const ctx = await ctxFor(browser, vp); await ctx.addCookies([authCookie]);
    const page = await ctx.newPage();
    await page.route("**/api/estimates/save", (r) => r.fulfill({ status: 200, body: "{}" }));
    const errors = []; page.on("pageerror", (e) => errors.push(e.message));
    await openEstimate(page);
    const trigger = page.locator('button[aria-label^="Calculate quantity for Vinyl siding panels"]').first();
    await trigger.scrollIntoViewIfNeeded();
    await tap(page, trigger);
    const dlg = page.getByRole("dialog");
    await dlg.waitFor();
    // Pick a plain area calculator when offered so the walk is the same everywhere.
    const fields = dlg.locator("input[data-calc-field]");
    check(T("opens with no red errors before typing"), (await dlg.locator('[aria-invalid="true"]').count()) === 0 && (await dlg.locator(".text-danger").count()) === 0);
    const box = await dlg.boundingBox();
    check(T("sheet/popover fully on screen"), box && box.y >= 0 && box.y + box.height <= vp.height + 1 && box.x >= 0 && box.x + box.width <= vp.width + 1, JSON.stringify(box));
    if (vp.mobile && vp.width < 768) check(T("measurement fields use 16px (no iOS focus zoom)"), (await fields.first().evaluate((e) => getComputedStyle(e).fontSize)) === "16px");
    const useBtn = dlg.getByRole("button", { name: /^Use|Already applied/ });
    const ub = await useBtn.boundingBox();
    check(T("Use button visible without scrolling"), ub && ub.y + ub.height <= vp.height + 1);
    await page.screenshot({ path: `${out}/calc-open__${vp.tag}.png` });
    // Every calculator type offered for this item opens clean too.
    const tabs = dlg.getByRole("tab");
    for (let t = (await tabs.count()) - 1; t >= 0; t--) {
      const name = await tabs.nth(t).innerText();
      await tap(page, tabs.nth(t));
      check(T(`"${name}" tab opens with no red errors`), (await dlg.locator('[aria-invalid="true"]').count()) === 0 && (await dlg.locator(".text-danger").count()) === 0);
    }
    // Type first field; others must not turn red.
    const n = await fields.count();
    await tap(page, fields.nth(0));
    check(T("first measurement field takes a tap"), await fields.nth(0).evaluate((e) => e === document.activeElement));
    await page.keyboard.type("40");
    check(T("still no red errors while filling in"), (await dlg.locator('[aria-invalid="true"]').count()) === 0);
    if (vp.mobile) {
      // Tap above the sheet while typing: closes the keyboard, keeps the calculator.
      if (vp.mobile) await page.touchscreen.tap(Math.round(vp.width / 2), 8); else await page.mouse.click(Math.round(vp.width / 2), 8);
      await page.waitForTimeout(150);
      check(T("tap outside while typing keeps the calculator open"), await dlg.isVisible());
    }
    for (let i = 1; i < n; i++) {
      const f = fields.nth(i);
      if (!(await f.isVisible())) continue;
      if ((await f.inputValue()) !== "") continue;
      const label = await page.locator(`label[for="${await f.getAttribute("id")}"]`).innerText();
      if (/optional/i.test(label)) continue;
      await f.scrollIntoViewIfNeeded(); await tap(page, f);
      check(T(`"${label.trim()}" takes a tap`), await f.evaluate((e) => e === document.activeElement));
      await page.keyboard.type("10");
    }
    await page.waitForTimeout(100);
    const resultText = await dlg.locator('[id$="-calc-result"]').innerText();
    check(T("calculates a result"), /Result/i.test(resultText) && !/Enter the measurements/.test(resultText), resultText.split("\n").slice(0, 2).join(" "));
    await page.screenshot({ path: `${out}/calc-filled__${vp.tag}.png` });
    // Accidental close (Escape) then reopen: typed values survive.
    const typed = await fields.nth(0).inputValue();
    await page.keyboard.press("Escape"); await page.waitForTimeout(150);
    if (await dlg.isVisible()) await page.keyboard.press("Escape");
    await dlg.waitFor({ state: "hidden" });
    await tap(page, trigger); await dlg.waitFor();
    check(T("reopening keeps measurements typed but not applied"), (await dlg.locator("input[data-calc-field]").nth(0).inputValue()) === typed, typed);
    // Apply.
    const btn = dlg.getByRole("button", { name: /^Use / });
    await tap(page, btn);
    const replace = dlg.getByRole("button", { name: /Replace quantity/ });
    if (await replace.isVisible().catch(() => false)) await tap(page, replace);
    await dlg.waitFor({ state: "hidden" });
    const row = page.locator("tr", { has: page.locator('input[value="Vinyl siding panels"]') }).first();
    const qty = await row.locator('input[aria-label="Quantity"]').inputValue();
    check(T("result lands in the line item's quantity"), qty !== "20" && Number(qty) > 0, `qty ${qty}`);
    // Empty form: pressing Use points at the missing entries instead of doing nothing.
    const trig2 = page.locator('button[aria-label^="Calculate quantity for"]').filter({ hasNot: page.locator(".bg-teal") }).last();
    await trig2.scrollIntoViewIfNeeded(); await tap(page, trig2); await dlg.waitFor();
    const b2 = dlg.getByRole("button", { name: /^Use result$/ });
    if (await b2.count()) {
      check(T("Use is pressable on a blank form"), await b2.isEnabled());
      await tap(page, b2);
      check(T("pressing Use on a blank form then shows what's missing"), (await dlg.locator('[aria-invalid="true"]').count()) > 0);
      if (vp.tag === "m390") await page.screenshot({ path: `${out}/calc-blank-use__${vp.tag}.png` });
    }
    check(T("no page errors"), errors.length === 0, errors.join(" | "));
    await ctx.close();
  }
}

async function toolbar(browser) {
  for (const vp of VIEWPORTS) {
    const T = (n) => `[${vp.tag}] toolbar: ${n}`;
    const ctx = await ctxFor(browser, vp); await ctx.addCookies([authCookie]);
    const page = await ctx.newPage();
    await page.route("**/api/estimates/save", (r) => r.fulfill({ status: 200, body: "{}" }));
    await openEstimate(page);
    const boxes = page.locator('input[type="checkbox"][aria-label^="Select "]');
    for (const i of [0, 2]) { await boxes.nth(i).evaluate((e) => e.scrollIntoView({ block: "center" })); await tap(page, boxes.nth(i)); }
    const bar = page.getByRole("toolbar", { name: /selected/ });
    await bar.waitFor();
    const fits = async (label) => {
      const header = await page.locator("header.sticky").first().boundingBox();
      const b = await bar.boundingBox();
      const controls = await bar.locator("button, select, input").evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, name: e.getAttribute("aria-label") || e.textContent.trim() }; }));
      const clipped = controls.filter((c) => c.l < 0 || c.r > innerWidthOf(vp) + 0.5);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(T(`${label}: whole bar on screen, below the sticky header`), b.x >= 0 && b.x + b.width <= vp.width + 0.5 && b.y >= header.y + header.height - 0.5 && b.y + b.height <= vp.height, `bar y=${Math.round(b.y)} h=${Math.round(b.height)} header bottom=${Math.round(header.y + header.height)}`);
      check(T(`${label}: every control reachable, no horizontal overflow`), clipped.length === 0 && overflow <= 0, clipped.map((c) => c.name).join(", ") || `overflow ${overflow}px`);
    };
    await bar.scrollIntoViewIfNeeded();
    await fits("at rest");
    await page.screenshot({ path: `${out}/toolbar__${vp.tag}.png` });
    await page.mouse.wheel(0, 500); await page.waitForTimeout(250);
    if ((await page.evaluate(() => window.scrollY)) > 0) {
      await fits("scrolled (sticky)");
      await page.screenshot({ path: `${out}/toolbar-scrolled__${vp.tag}.png` });
    }
    check(T("shows 2 selected"), /2 selected/.test(await bar.innerText()));
    await bar.locator("#bulk-mode").selectOption("margin");
    await bar.locator("#bulk-pct").fill("30");
    await tap(page, bar.getByRole("button", { name: /^Apply/ }));
    await page.waitForTimeout(150);
    const badges = await page.locator("text=30% margin").count();
    check(T("margin override applies to both selected items"), badges === 2, `${badges} badges`);
    await ctx.close();
  }
}
function innerWidthOf(vp) { return vp.width; }

(async () => {
  const browser = await chromium.launch();
  try {
    if (only === "empty") await emptyProfile(browser);
    if (!only || only === "flow") await flow(browser);
    if (!only || only === "calc") await calc(browser);
    if (!only || only === "toolbar") await toolbar(browser);
  } finally {
    await browser.close();
  }
  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})();
