// Browser walk for the premium Saved Items & Pricing Library, the Labor / Material type and final-bid rounding.
// Needs scripts/ux-audit/mock-supabase.mjs on :54321 and `next start` on :3000 built against it.
// Usage: node scripts/saved-items/walk.mjs <outDir>
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.env.BASE ?? "http://localhost:3000";
const MOCK = process.env.MOCK ?? "http://localhost:54321";
const out = process.argv[2] ?? "saved-items-shots";
fs.mkdirSync(out, { recursive: true });
const EST = "11111111-1111-4111-8111-111111111111";

const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600 * 24 * 365 * 50, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
const setScenario = (name) => fetch(`${MOCK}/__scenario?name=${name}`).then((r) => { if (!r.ok) throw new Error(`scenario ${name}`); });
const VIEWPORTS = [
  { id: "desktop", width: 1440, height: 900 },
  { id: "tablet", width: 820, height: 1180 },
  { id: "m430", width: 430, height: 932 },
  { id: "m390", width: 390, height: 844 },
  { id: "m375", width: 375, height: 812 },
  { id: "m320", width: 320, height: 640 },
];
const shot = (page, name, full = false) => page.screenshot({ path: `${out}/${name}.png`, fullPage: full });
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

async function openEstimateStep(page) {
  await page.goto(`${BASE}/estimates/${EST}`, { waitUntil: "networkidle" });
  const step = page.locator('nav[aria-label="Builder steps"] button', { hasText: "Estimate" }).first();
  if (await step.count()) await step.click();
  await page.waitForSelector("text=Suggested & Saved Items", { timeout: 15000 });
}

const browser = await chromium.launch();

// ---------------------------------------------------------------- Premium (Unlimited) account
await setScenario("unlimited");
for (const vp of VIEWPORTS) {
  const T = (n) => `[unlimited/${vp.id}] ${n}`;
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.id === "desktop" || vp.id === "m390" ? 2 : 1, hasTouch: vp.width < 768, isMobile: vp.width < 768 });
  await ctx.addCookies([authCookie]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await fetch(`${MOCK}/__reset_library`);

  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  const tile = page.locator("main").getByRole("link", { name: /^Saved Items & Pricing/ });
  check(T("dashboard tile is unlocked and links to the library"), (await tile.count()) === 1 && (await tile.getAttribute("href")) === "/dashboard/items");
  if (vp.id === "desktop" || vp.id === "m390") { await tile.scrollIntoViewIfNeeded(); await shot(page, `premium__dashboard-tile__${vp.id}`); }

  await page.goto(`${BASE}/dashboard/items`, { waitUntil: "networkidle" });
  await page.waitForSelector("text=Saved Stacks");
  const body = await page.locator("main").innerText();
  check(T("library groups items by trade and category"), /Framing[\s\S]*Framing Labor[\s\S]*\$8\.00 \/ SF/.test(body) && /Siding/.test(body) && /General/.test(body));
  check(T("library page has no horizontal scroll"), await noHScroll(page));
  if (vp.id === "desktop" || vp.id === "m390" || vp.id === "m320") await shot(page, `premium__library__${vp.id}`, true);

  if (vp.id === "desktop" || vp.id === "m390") {
    // Create, edit, delete
    await page.getByRole("button", { name: "New Saved Item" }).click();
    await page.getByLabel("Item name").fill("Complete Framing");
    await page.getByLabel("Trade").selectOption("framing");
    await page.getByLabel("Category").fill("Complete Framing");
    await page.getByLabel("Type").selectOption("labor_material");
    await page.getByLabel("Unit", { exact: true }).selectOption("square foot");
    await page.getByLabel(/Default rate/).fill("18");
    if (vp.id === "m390") await shot(page, `premium__new-item-form__${vp.id}`, true);
    await page.getByRole("button", { name: "Save Item" }).click();
    await page.waitForSelector("text=Saved “Complete Framing”.");
    check(T("new saved item shows $18.00 / SF under Framing"), /Complete Framing[\s\S]*\$18\.00 \/ SF/.test(await page.locator("main").innerText()));
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector("text=Saved Stacks");
    check(T("saved item persists after reload"), (await page.getByText("Complete Framing", { exact: true }).count()) >= 1);
    await page.getByRole("button", { name: "Edit Complete Framing" }).click();
    await page.getByLabel(/Default rate/).fill("20");
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.waitForSelector("text=Updated “Complete Framing”.");
    check(T("edited rate shows $20.00 / SF"), /Complete Framing[\s\S]*\$20\.00 \/ SF/.test(await page.locator("main").innerText()));
    await page.getByRole("button", { name: "Delete Framing Materials" }).click();
    if (vp.id === "m390") await shot(page, `premium__delete-confirm__${vp.id}`);
    await page.getByRole("group", { name: "Confirm deleting Framing Materials" }).getByRole("button", { name: "Delete" }).click();
    await page.waitForSelector("text=Deleted “Framing Materials”.");
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector("text=Saved Stacks");
    check(T("deleted item is gone after reload"), (await page.getByText("Framing Materials", { exact: true }).count()) === 0);
  }

  // Builder
  await openEstimateStep(page);
  const types = await page.locator('select[aria-label="Cost type"]').first().locator("option").allInnerTexts();
  check(T("row Type dropdown offers Labor / Material and keeps the others"), types.includes("Labor / Material") && types.includes("Labor") && types.includes("Material") && types.includes("Subcontractor"), types.join(", "));
  await page.getByRole("button", { name: "Suggested & Saved Items" }).first().click();
  const picker = await page.locator("div.absolute.z-30").first().innerText();
  check(T("picker separates Saved Items and Suggested Items"), /SAVED ITEMS/i.test(picker) && /SUGGESTED ITEMS/i.test(picker) && !/assembl|favorites/i.test(picker));
  check(T("picker lists the matching-trade saved item first"), /SAVED ITEMS\s*\n?[\s\S]*?Remove existing siding/i.test(picker));
  check(T("picker fits the viewport"), await page.locator("div.absolute.z-30").first().evaluate((el) => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth + 1; }));
  if (vp.id !== "tablet") await shot(page, `premium__picker__${vp.id}`);

  if (vp.id === "desktop" || vp.id === "m390") {
    const rowsBefore = await page.locator('input[aria-label="Item name"]').count();
    await page.getByRole("button", { name: "Add Complete Framing" }).click();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    const names = await page.locator('input[aria-label="Item name"]').evaluateAll((els) => els.map((e) => e.value));
    const idx = names.indexOf("Complete Framing");
    const cost = idx >= 0 ? await page.locator('input[aria-label="Internal unit cost"]').nth(idx).inputValue() : "";
    const type = idx >= 0 ? await page.locator('select[aria-label="Cost type"]').nth(idx).inputValue() : "";
    check(T("adding Complete Framing fills the current saved rate ($20) and type"), names.length === rowsBefore + 1 && cost === "20" && type === "labor_material", `cost=${cost} type=${type}`);

    // Labor / Material on Tear Off, then Save Item
    await page.locator('select[aria-label="Cost type"]').first().selectOption("labor_material");
    await page.getByRole("button", { name: /Actions for Remove existing siding/ }).click();
    const saveItem = page.getByRole("menuitem", { name: /Save Item/ });
    check(T("row menu says Save Item"), (await saveItem.count()) === 1);
    if (vp.id === "m390") await shot(page, `premium__row-menu__${vp.id}`);
    await saveItem.click();
    await page.waitForSelector("text=/Updated “Remove existing siding” in Saved Items|Saved “Remove existing siding” to Saved Items/");
    check(T("Save Item confirms in a toast"), true);

    // Save Stack from selected rows
    await page.getByRole("checkbox", { name: "Select Remove existing siding" }).check();
    await page.getByRole("checkbox", { name: "Select House wrap" }).check();
    const bulk = page.getByRole("button", { name: "Save Stack" });
    check(T("selection toolbar offers Save Stack (not Save as assembly)"), (await bulk.count()) === 1 && (await page.getByText(/save as assembly/i).count()) === 0);
    await bulk.click();
    await page.getByLabel("Stack name").fill("Tear-off package");
    if (vp.id === "m390") await shot(page, `premium__save-stack-dialog__${vp.id}`);
    await page.getByRole("dialog").getByRole("button", { name: "Save Stack" }).click();
    await page.waitForSelector("text=Saved stack “Tear-off package” (2 items).");
    await page.getByRole("button", { name: "Suggested & Saved Items" }).first().click();
    const picker2 = await page.locator("div.absolute.z-30").first().innerText();
    check(T("new stack appears under Saved Stacks in the picker"), /SAVED STACKS[\s\S]*Tear-off package[\s\S]*2 items/i.test(picker2));
    const before2 = await page.locator('input[aria-label="Item name"]').count();
    await page.getByRole("button", { name: /Tear-off package/ }).click();
    check(T("reusing the stack adds both rows"), (await page.locator('input[aria-label="Item name"]').count()) === before2 + 2);

    // Edit a saved item from the picker
    await page.getByRole("button", { name: "Suggested & Saved Items" }).first().click();
    await page.getByRole("button", { name: "Edit saved item Dumpster rental (20 yd)" }).click();
    await page.getByLabel(/Default rate/).fill("475");
    if (vp.id === "m390") await shot(page, `premium__picker-edit-dialog__${vp.id}`);
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.waitForSelector("text=Updated “Dumpster rental (20 yd)”.");
    check(T("edit from the picker saves the new rate"), true);

    // Rounding
    const summary = page.locator('aside[aria-label="Pricing"]');
    await summary.getByLabel(/Round final bid total/).check();
    const sText = await summary.innerText();
    const finalBid = (sText.match(/Final bid\s*\n?\s*(\$[\d,]+\.\d\d)/) ?? [])[1] ?? "";
    check(T("rounding shows calculated total, adjustment and a whole-dollar final bid"), /Calculated total/.test(sText) && /Rounding adjustment/.test(sText) && /\.00$/.test(finalBid), finalBid);
    await summary.getByText("Project summary").scrollIntoViewIfNeeded();
    await shot(page, `premium__rounding-on__${vp.id}`);
    await summary.getByLabel(/Round final bid total/).uncheck();
    check(T("rounding off returns to Proposal total"), /Proposal total/.test(await summary.innerText()) && !/Rounding adjustment/.test(await summary.innerText()));
  }
  check(T("selection toolbar and page have no horizontal scroll"), await noHScroll(page));
  check(T("no page errors"), errors.length === 0, errors.join(" | "));
  await ctx.close();
}

// ---------------------------------------------------------------- Free account
await setScenario("starter");
for (const vp of VIEWPORTS.filter((v) => ["desktop", "m390", "m320"].includes(v.id))) {
  const T = (n) => `[free/${vp.id}] ${n}`;
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.id === "m320" ? 1 : 2, hasTouch: vp.width < 768, isMobile: vp.width < 768 });
  await ctx.addCookies([authCookie]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  const tile = page.locator("main").getByRole("link", { name: "Saved Items & Pricing (Unlimited feature)" });
  const tileText = (await tile.count()) ? await tile.innerText() : "";
  check(T("dashboard tile is locked with the Unlimited message and an upgrade action"), /Save your labor rates, material costs, and frequently used estimating items\. Included with Unlimited\./.test(tileText) && /Unlimited plans/.test(tileText));
  await tile.scrollIntoViewIfNeeded();
  await shot(page, `free__dashboard-tile__${vp.id}`);

  await page.goto(`${BASE}/dashboard/items`, { waitUntil: "networkidle" });
  await page.waitForSelector("text=is an Unlimited feature");
  const t = await page.locator("main").innerText();
  check(T("library page is locked, keeps data and offers checkout"), /kept safe/.test(t) && (await page.getByRole("button", { name: /Upgrade to Unlimited/ }).count()) === 1 && !/Dumpster rental/.test(t));
  await shot(page, `free__library-locked__${vp.id}`, true);

  await openEstimateStep(page);
  await page.getByRole("button", { name: "Suggested & Saved Items" }).first().click();
  const picker = await page.locator("div.absolute.z-30").first().innerText();
  check(T("picker shows Saved Items as Premium and still offers Suggested Items"), /SAVED ITEMS · PREMIUM/i.test(picker) && /SUGGESTED ITEMS/i.test(picker) && !/Dumpster/.test(picker));
  await shot(page, `free__picker__${vp.id}`);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: /Actions for Remove existing siding/ }).click();
  await page.getByRole("menuitem", { name: /Save Item/ }).click();
  const dlg = page.getByRole("dialog");
  check(T("Save Item on a free account opens the upgrade dialog"), (await dlg.count()) === 1 && /Unlimited/.test(await dlg.innerText()));
  await shot(page, `free__save-item-upsell__${vp.id}`);
  check(T("no page errors"), errors.length === 0, errors.join(" | "));
  await ctx.close();
}

await browser.close();
fs.writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
