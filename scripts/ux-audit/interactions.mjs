// Interaction checks for the UX fixes, run against `next start` + mock Supabase (see capture.mjs).
// Usage: node scripts/ux-audit/interactions.mjs <screenshotDir>
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const BASE = process.env.BASE ?? "http://localhost:3000";
const out = process.argv[2] ?? "ux-interactions";
fs.mkdirSync(out, { recursive: true });
const EST = "11111111-1111-4111-8111-111111111111";
const b64u = (s) => Buffer.from(s).toString("base64url");
const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const jwt = `${b64u('{"alg":"HS256"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800 }))}.sig`;
const cookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify({ access_token: jwt, refresh_token: "m", token_type: "bearer", expires_in: 1e9, expires_at: 4102444800, user }))}`, domain: "localhost", path: "/" };

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
const browser = await chromium.launch();

for (const vp of [{ width: 375, height: 800, tag: "mobile" }, { width: 1440, height: 900, tag: "desktop" }]) {
  const ctx = await browser.newContext({ viewport: vp, isMobile: vp.width < 768, hasTouch: vp.width < 768 });
  await ctx.addCookies([cookie]);
  const page = await ctx.newPage();
  const T = (n) => `[${vp.tag}] ${n}`;

  // Navigation order
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  if (vp.width < 768) await page.getByRole("button", { name: "Menu" }).click();
  const labels = await page.locator("#account-nav a").allInnerTexts();
  check(T("Company profile is directly below Bids"), labels[0]?.trim() === "Bids" && labels[1]?.trim() === "Company profile", labels.slice(0, 3).join(" | "));
  if (vp.width < 768) await page.screenshot({ path: `${out}/nav-menu-open__${vp.tag}.png` });

  // Accordion
  await page.goto(`${BASE}/estimates/${EST}`, { waitUntil: "networkidle" });
  await page.evaluate(() => sessionStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  const toggles = page.locator("section[aria-label^='Section'] header button[aria-controls^='gp-']");
  const expanded = await toggles.evaluateAll((els) => els.map((e) => e.getAttribute("aria-expanded")));
  check(T("Only the first section starts expanded"), expanded[0] === "true" && expanded.slice(1).every((x) => x === "false"), expanded.join(","));
  const total0 = await page.locator("text=Proposal total").first().locator("xpath=..").innerText();

  // Edit a quantity, collapse, expand: value persists, totals unchanged by collapsing
  const qty = page.getByLabel("Quantity").first();
  await qty.fill("19");
  const totalEdited = await page.locator("text=Proposal total").first().locator("xpath=..").innerText();
  await toggles.nth(0).click();
  const totalCollapsed = await page.locator("text=Proposal total").first().locator("xpath=..").innerText();
  await toggles.nth(0).click();
  check(T("Value persists after collapse/expand"), (await page.getByLabel("Quantity").first().inputValue()) === "19");
  check(T("Collapsing does not change totals"), totalEdited === totalCollapsed, `${totalEdited.replace(/\s+/g, " ")}`);
  await qty.fill("18");
  const totalRestored = await page.locator("text=Proposal total").first().locator("xpath=..").innerText();
  check(T("Totals return to original after restoring value"), totalRestored === total0);

  // Independent expansion
  await toggles.nth(2).click();
  const exp2 = await toggles.evaluateAll((els) => els.map((e) => e.getAttribute("aria-expanded")));
  check(T("Multiple sections can be open at once"), exp2[0] === "true" && exp2[2] === "true", exp2.join(","));
  await toggles.nth(2).click();

  // Suggestions persist after picking
  const first = page.locator("section").first();
  const rows0 = await first.getByLabel("Item name").count();
  const chipsBefore = await first.getByRole("button", { name: /^Add .* to this section$/ }).allInnerTexts();
  await first.getByRole("button", { name: /^Add .* to this section$/ }).first().click();
  const rows1 = await first.getByLabel("Item name").count();
  const chipsAfter = await first.getByRole("button", { name: /^Add .* to this section$/ }).count();
  check(T("Picking a suggestion adds one row"), rows1 === rows0 + 1, `${rows0} -> ${rows1}`);
  check(T("Other suggestions stay visible after a pick"), chipsAfter >= 1 && chipsAfter === chipsBefore.length - 1, `${chipsBefore.length} -> ${chipsAfter}`);
  await first.getByRole("button", { name: /^Add .* to this section$/ }).first().click();
  check(T("A second suggestion can be picked right away"), (await first.getByLabel("Item name").count()) === rows0 + 2);
  const addedChip = first.getByRole("button", { name: /already in this section/ }).first();
  check(T("Picked suggestions are marked Added"), (await addedChip.count()) > 0);
  await addedChip.click();
  check(T("Clicking an Added suggestion does not duplicate"), (await first.getByLabel("Item name").count()) === rows0 + 2);
  await page.screenshot({ path: `${out}/suggestions-after-two-picks__${vp.tag}.png`, fullPage: false });
  await first.screenshot({ path: `${out}/section-with-suggestions__${vp.tag}.png` });

  // Picker stays open for multiple picks
  await first.getByRole("button", { name: "Suggested & saved items" }).click();
  const pickable = page.getByRole("button", { name: /^Add (?!custom)/ }).filter({ hasNot: page.locator("[aria-label*='to this section']") });
  const before = await first.getByLabel("Item name").count();
  const picker = page.locator("div.absolute.z-30");
  await picker.getByRole("button", { name: /^Add / }).first().click();
  await picker.getByRole("button", { name: /^Add / }).first().click();
  check(T("Suggested & saved items picker stays open for several picks"), await picker.isVisible() && (await first.getByLabel("Item name").count()) === before + 2);
  await page.screenshot({ path: `${out}/picker-multi-select__${vp.tag}.png` });
  check(T("Picker shows added items with a check"), (await picker.getByRole("button", { name: /already added/ }).count()) >= 2);
  await picker.getByRole("button", { name: "Done" }).click();
  void pickable;

  // Overflow after interactions
  const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(T("No horizontal page scroll after interactions"), ov <= 1, `excess ${ov}px`);

  // Proposal preview opens and fits
  await page.getByRole("button", { name: /Preview/ }).first().click();
  await page.waitForTimeout(500);
  const dlg = page.getByRole("dialog");
  const box = await dlg.boundingBox();
  check(T("Proposal preview dialog fits the screen width"), Boolean(box) && box.x >= 0 && box.x + box.width <= vp.width + 1, box ? `${Math.round(box.x)}..${Math.round(box.x + box.width)}` : "no dialog");
  await page.screenshot({ path: `${out}/proposal-preview__${vp.tag}.png` });
  await ctx.close();
}

// Anonymous journey: trade selection -> builder (company step) -> estimate step
{
  const ctx = await browser.newContext({ viewport: { width: 320, height: 700 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/bids`, { waitUntil: "networkidle" });
  await page.getByRole("link", { name: /Siding/ }).first().click();
  await page.waitForURL(/builder\?draft=/, { timeout: 20000 });
  await page.waitForLoadState("networkidle");
  check("[anon 320] Trade pick opens the builder", page.url().includes("/builder?draft="));
  await page.getByRole("button", { name: /Estimate/ }).first().click();
  const t = await page.locator("section[aria-label^='Section'] header button[aria-controls^='gp-']").evaluateAll((els) => els.map((e) => e.getAttribute("aria-expanded")));
  check("[anon 320] New bid: only first section expanded", t[0] === "true" && t.slice(1).every((x) => x === "false"), t.join(","));
  const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("[anon 320] No horizontal scroll on new estimate", ov <= 1, `excess ${ov}px`);
  await page.screenshot({ path: `${out}/new-siding-estimate__320.png`, fullPage: true });
  await ctx.close();
}

fs.writeFileSync(`${out}/interaction-results.json`, JSON.stringify(results, null, 2));
await browser.close();
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
