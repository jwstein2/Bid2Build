const { chromium } = require("playwright");
// Browser walk-through of trade sync (anonymous draft flow). Usage: next start on :3000, then
// node scripts/trade-sync/walk.cjs <screenshotDir>
const out = process.argv[2] ?? "trade-sync-shots";
require("node:fs").mkdirSync(out, { recursive: true });
const BASE = "http://localhost:3000";
const results = [];
const check = (n, ok, d = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? " — " + d : ""}`); };
(async () => {
  const browser = await chromium.launch();
  for (const vp of [{ width: 1440, height: 900, tag: "desktop" }, { width: 820, height: 1180, tag: "tablet" }, { width: 390, height: 844, tag: "mobile" }]) {
    const ctx = await browser.newContext({ viewport: vp, isMobile: vp.width < 768, hasTouch: vp.width < 768 });
    await ctx.addInitScript(() => { try { localStorage.setItem("byb:business", JSON.stringify({ companyName: "Summit Builders", primaryColor: "#0B2D4D", secondaryColor: "#00C2E0", logoLayout: "left", headerStyle: "solid", logoUrl: null })); } catch {} });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const T = (n) => `[${vp.tag}] ${n}`;
    await page.goto(`${BASE}/start/decks`);
    await page.waitForURL(/builder\?draft=/);
    await page.waitForSelector("text=Add a trade to this project", { timeout: 15000 }).catch(() => {});
    const draftUrl = page.url();
    // Single-trade: no trade wrapper
    check(T("single-trade estimate has no trade header"), (await page.locator('section[aria-label$=" trade"]').count()) === 0);
    // Add trades from the Customer & project step
    await page.getByRole("button", { name: /Customer & project/ }).first().click();
    for (const t of ["Concrete", "Roofing", "Siding"]) await page.getByLabel("Add a trade to this project").selectOption({ label: t });
    const chips = await page.locator('ol[aria-labelledby="trades-label"] > li').allInnerTexts();
    check(T("project trade list shows 4 trades in order"), chips.slice(0, 4).map((c) => c.replace(/^\d+\.\s*/, "").trim()).join("|").startsWith("Decks"), chips.slice(0, 4).join(" | ").replace(/\n/g, " "));
    if (vp.tag === "desktop") await page.screenshot({ path: `${out}/project-trades__${vp.tag}.png`, fullPage: false, clip: { x: 0, y: 0, width: vp.width, height: vp.height } });
    await page.getByRole("button", { name: /^\d?\s*Estimate$/ }).first().click().catch(async () => { await page.locator('nav[aria-label="Builder steps"] button', { hasText: "Estimate" }).click(); });
    await page.waitForTimeout(300);
    const tradeHeads = await page.locator('section[aria-label$=" trade"] h2').allInnerTexts();
    check(T("estimate shows a section per trade in order"), tradeHeads.length === 4 && /Decks/.test(tradeHeads[0]) && /Concrete/.test(tradeHeads[1]) && /Roofing/.test(tradeHeads[2]) && /Siding/.test(tradeHeads[3]), tradeHeads.join(" | "));
    const expanded = await page.locator('section[aria-label$=" trade"] > header button[aria-controls^="trade-"]').evaluateAll((els) => els.map((e) => e.getAttribute("aria-expanded")));
    check(T("first trade open, later trades collapsed (the first newly added trade also opens)"), expanded[0] === "true" && expanded[2] === "false" && expanded[3] === "false", expanded.join());
    // Open Roofing: its template sections populate
    await page.getByRole("button", { name: "Expand Roofing trade" }).click();
    const roofing = page.locator('section[aria-label="Roofing trade"]');
    const roofSections = await roofing.locator('section[aria-label^="Section "] input[id^="g-"]').evaluateAll((els) => els.map((e) => e.value));
    check(T("roofing sections populated from the roofing template"), roofSections.length >= 3, roofSections.join(" | "));
    // Add a priced line item in the first roofing section
    const firstRoofSection = roofing.locator('section[aria-label^="Section "]').first();
    const toggle = firstRoofSection.locator("header button[aria-expanded]").first();
    if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
    await firstRoofSection.getByRole("button", { name: "Add line item" }).click();
    await firstRoofSection.getByLabel("Item name").last().fill("Architectural shingles");
    await firstRoofSection.getByLabel("Quantity").last().fill("30");
    await firstRoofSection.getByLabel("Unit cost").last().fill("100");
    await page.waitForTimeout(400);
    const roofHeader = await roofing.locator("> header").innerText();
    check(T("roofing trade subtotal = $3,750.00"), roofHeader.includes("$3,750.00"), roofHeader.replace(/\n/g, " "));
    if (vp.tag !== "tablet") await page.screenshot({ path: `${out}/estimate-trades__${vp.tag}.png`, fullPage: true });
    // Persistence: reload
    await page.waitForTimeout(800);
    await page.goto(draftUrl);
    await page.waitForSelector('section[aria-label$=" trade"]', { timeout: 15000 });
    const afterHeads = await page.locator('section[aria-label$=" trade"] h2').allInnerTexts();
    const roofAfter = await page.locator('section[aria-label="Roofing trade"] > header').innerText();
    check(T("trades, sections and pricing persist after reload"), afterHeads.length === 4 && roofAfter.includes("$3,750.00"), afterHeads.join(" | "));
    // Remove Roofing: needs confirmation
    await page.getByRole("button", { name: "Trade actions for Roofing" }).click();
    await page.getByRole("menuitem", { name: "Remove trade" }).click();
    const dlg = page.getByRole("dialog");
    check(T("removing a trade with work asks first"), await dlg.isVisible(), (await dlg.innerText()).split("\n").slice(0, 3).join(" / "));
    if (vp.tag !== "tablet") await page.screenshot({ path: `${out}/remove-confirm__${vp.tag}.png` });
    await dlg.getByRole("button", { name: "Cancel" }).click();
    check(T("cancel keeps the trade"), (await page.locator('section[aria-label="Roofing trade"]').count()) === 1);
    // Empty trade (Concrete) removes without dialog, undo available
    await page.getByRole("button", { name: "Trade actions for Concrete" }).click();
    await page.getByRole("menuitem", { name: "Remove trade" }).click();
    await page.waitForTimeout(200);
    check(T("empty trade removed without a dialog, undo offered"), (await page.getByRole("dialog").count()) === 0 && (await page.locator('section[aria-label="Concrete trade"]').count()) === 0 && (await page.getByText("Removed Concrete and its sections").count()) === 1);
    await page.getByRole("button", { name: "Undo" }).click();
    await page.waitForTimeout(200);
    const undoHeads = await page.locator('section[aria-label$=" trade"] h2').allInnerTexts();
    check(T("undo puts the trade back in place"), /Concrete/.test(undoHeads[1] ?? ""), undoHeads.join(" | "));
    // Confirm removal of Roofing
    await page.getByRole("button", { name: "Trade actions for Roofing" }).click();
    await page.getByRole("menuitem", { name: "Remove trade" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Remove trade and its sections" }).click();
    await page.waitForTimeout(300);
    const total = await page.evaluate(() => document.body.innerText.match(/Proposal total\s*\$[\d,.]+/)?.[0] ?? "");
    check(T("removing roofing drops its price from the total"), /\$0\.00/.test(total), total);
    // Add a trade from the estimate
    await page.getByLabel("Add a trade to this project").selectOption({ label: "Gutters" });
    await page.waitForTimeout(200);
    const finalHeads = await page.locator('section[aria-label$=" trade"] h2').allInnerTexts();
    check(T("adding a trade in the estimate adds it to the project too"), /Gutters/.test(finalHeads[finalHeads.length - 1] ?? ""), finalHeads.join(" | "));
    await page.locator('nav[aria-label="Builder steps"] button', { hasText: "Customer & project" }).click();
    const chips2 = (await page.locator('ol[aria-labelledby="trades-label"] > li').allInnerTexts()).slice(0, -1);
    check(T("project trade list matches the estimate"), chips2.some((c) => /Gutters/.test(c)) && !chips2.some((c) => /Roofing/.test(c)), chips2.join(" | ").replace(/\n/g, " "));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(T("no horizontal overflow"), overflow <= 0, String(overflow));
    check(T("no page errors"), errors.length === 0, errors.join("; "));
    await ctx.close();
  }
  await browser.close();
  console.log(`${results.filter(Boolean).length}/${results.length} passed`);
})();
