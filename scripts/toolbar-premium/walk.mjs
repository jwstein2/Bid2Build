// Browser walk for Duplicate Selected, contextual Remove Override, Save Item / Save Stack naming and the
// Unlimited (diamond) indicators + upgrade screens for Saved Items & Pricing and Proposal Templates.
// Needs scripts/ux-audit/mock-supabase.mjs on :54321 and `next start` on :3000 built against it.
// Usage: node scripts/toolbar-premium/walk.mjs <outDir>
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.env.BASE ?? "http://localhost:3000";
const MOCK = process.env.MOCK ?? "http://localhost:54321";
const out = process.argv[2] ?? "toolbar-premium-shots";
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
  { id: "m390", width: 390, height: 844 },
  { id: "m320", width: 320, height: 640 },
];
const shot = (page, name, full = false) => page.screenshot({ path: `${out}/${name}.png`, fullPage: full });
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
/** The selection toolbar fits inside the viewport (no clipped buttons). */
const toolbarFits = (page) => page.evaluate(() => {
  const bar = document.querySelector('[role="toolbar"][aria-label^="Edit "]');
  if (!bar) return false;
  return [...bar.querySelectorAll("button, select, input")].every((el) => { const r = el.getBoundingClientRect(); return r.left >= -1 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1 && r.top >= 0; });
});
const names = (page) => page.locator('input[aria-label="Item name"]').evaluateAll((els) => els.map((e) => e.value));

async function openEstimateStep(page) {
  await page.goto(`${BASE}/estimates/${EST}`, { waitUntil: "networkidle" });
  const step = page.locator('nav[aria-label="Builder steps"] button', { hasText: "Estimate" }).first();
  if (await step.count()) await step.click();
  await page.waitForSelector("text=Suggested & Saved Items", { timeout: 15000 });
}
const select = (page, name) => page.getByRole("checkbox", { name: `Select ${name}` }).check();
const bar = (page) => page.getByRole("toolbar", { name: /^Edit \d+ selected/ });

const browser = await chromium.launch();
const ctxFor = async (vp) => {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.id === "desktop" || vp.id === "m390" ? 2 : 1, hasTouch: vp.width < 768, isMobile: vp.width < 768 });
  await ctx.addCookies([authCookie]);
  return ctx;
};

for (const scenario of ["unlimited", "starter"]) {
  await setScenario(scenario);
  const plan = scenario === "unlimited" ? "unlimited" : "free";
  for (const vp of VIEWPORTS) {
    const T = (n) => `[${plan}/${vp.id}] ${n}`;
    const ctx = await ctxFor(vp);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await fetch(`${MOCK}/__reset_library`);

    // ---- Sidebar diamonds
    await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
    if (vp.width < 768) await page.getByRole("button", { name: /Menu/ }).click();
    const nav = page.getByRole("navigation", { name: "Account" });
    const navItems = nav.getByRole("link", { name: "Saved Items & Pricing (Unlimited feature)" });
    const navTpl = nav.getByRole("link", { name: "Proposal Templates (Unlimited feature)" });
    check(T("sidebar marks both features with the Unlimited diamond"), (await navItems.count()) === 1 && (await navTpl.count()) === 1 && (await nav.locator('[title="Unlimited feature"]').count()) === 2);
    if (vp.id !== "tablet") await shot(page, `${plan}__sidebar__${vp.id}`);
    if (vp.width < 768) await page.getByRole("button", { name: /Close/ }).click();

    // ---- Dashboard cards
    const main = page.locator("main");
    const libTile = main.getByRole("link", { name: /^Saved Items & Pricing/ });
    const tplTile = main.getByRole("link", { name: /^Proposal Templates/ });
    const libText = await libTile.innerText();
    const tplText = await tplTile.innerText();
    check(T("dashboard cards show the diamond"), (await libTile.locator('[title="Unlimited feature"]').count()) === 1 && (await tplTile.locator('[title="Unlimited feature"]').count()) === 1);
    if (plan === "free") {
      check(T("free cards explain what is included with Unlimited"),
        libText.includes("Save your labor rates, material costs, and frequently used estimating items. Included with Unlimited.") &&
        tplText.includes("Customize and reuse professional proposal layouts. Included with Unlimited."));
    } else {
      check(T("unlimited cards link straight to the features"), (await libTile.getAttribute("href")) === "/dashboard/items" && (await tplTile.getAttribute("href")) === "/dashboard/templates" && !/Included with Unlimited/.test(libText + tplText));
    }
    await libTile.scrollIntoViewIfNeeded();
    if (vp.id !== "tablet") await shot(page, `${plan}__dashboard-cards__${vp.id}`);
    check(T("dashboard has no horizontal scroll"), await noHScroll(page));

    // ---- Feature pages
    await page.goto(`${BASE}/dashboard/templates`, { waitUntil: "networkidle" });
    const tplMain = await main.innerText();
    if (plan === "free") {
      check(T("templates page shows the upgrade options, Not now, and keeps save locked"),
        /Proposal Templates is an Unlimited feature/.test(tplMain) && (await page.getByRole("button", { name: /Upgrade to Unlimited · \$19\.99\/month/ }).count()) === 1 &&
        (await page.getByRole("button", { name: /Go Annual · \$149\/year/ }).count()) === 1 && (await page.getByRole("link", { name: "Not now" }).count()) === 1 &&
        (await page.getByRole("button", { name: "Save as my defaults" }).isDisabled()));
    } else {
      check(T("templates page works for Unlimited"), !/is an Unlimited feature/.test(tplMain) && (await page.getByRole("button", { name: "Save as my defaults" }).isEnabled()));
    }
    if (vp.id !== "tablet") await shot(page, `${plan}__templates__${vp.id}`);
    await page.goto(`${BASE}/dashboard/items`, { waitUntil: "networkidle" });
    if (plan === "free") {
      await page.waitForSelector("text=Saved Items & Pricing is an Unlimited feature");
      check(T("Saved Items page shows the upgrade options and Not now"), (await page.getByRole("button", { name: /Upgrade to Unlimited/ }).count()) === 1 && (await page.getByRole("link", { name: "Not now" }).count()) === 1 && !/Dumpster rental/.test(await main.innerText()));
      if (vp.id !== "tablet") await shot(page, `${plan}__items__${vp.id}`);
    } else {
      await page.waitForSelector("text=Dumpster rental (20 yd)");
      check(T("Saved Items page lists saved items for Unlimited"), true);
    }

    // ---- Selection toolbar
    await openEstimateStep(page);
    const before = await names(page);
    await select(page, "Remove existing siding");
    const b1 = bar(page);
    check(T("toolbar has Duplicate Selected, Save Item for one row, no Use estimate pricing"),
      (await b1.getByRole("button", { name: /Duplicate/ }).count()) === 1 && (await b1.getByRole("button", { name: "Save Item" }).count()) === 1 &&
      (await page.getByText(/Use estimate pricing/i).count()) === 0);
    check(T("Remove Override hidden when no selected row has an override"), (await b1.getByRole("button", { name: "More pricing options" }).count()) === 0);
    check(T("toolbar fits on screen (one row selected)"), await toolbarFits(page));
    if (vp.id !== "tablet") await shot(page, `${plan}__toolbar-one__${vp.id}`);

    // Save Item with one row: Unlimited saves, free gets the upgrade dialog
    await b1.getByRole("button", { name: "Save Item" }).click();
    if (plan === "free") {
      const dlg = page.getByRole("dialog");
      await dlg.waitFor();
      const t = await dlg.innerText();
      check(T("Save Item on free opens the Unlimited upgrade dialog with Not now"), /Unlimited/.test(t) && /\$19\.99/.test(t) && /\$149/.test(t) && (await dlg.getByRole("button", { name: "Not now" }).count()) === 1);
      if (vp.id !== "tablet") await shot(page, `${plan}__save-item-upsell__${vp.id}`);
      await dlg.getByRole("button", { name: "Not now" }).click();
      check(T("Not now closes the dialog and keeps the selection"), (await page.getByRole("dialog").count()) === 0 && (await bar(page).count()) === 1);
    } else {
      await page.waitForSelector("text=/in Saved Items|to Saved Items/");
      check(T("Save Item on Unlimited saves the row"), true);
      await select(page, "Remove existing siding");
    }

    // Add a second row and apply an override so Remove Override appears
    await select(page, "House wrap");
    const b2 = bar(page);
    check(T("two rows selected: Save Stack"), (await b2.getByRole("button", { name: "Save Stack" }).count()) === 1 && (await b2.getByRole("button", { name: "Save Item" }).count()) === 0);
    await page.locator("#bulk-pct").fill("15");
    await b2.getByRole("button", { name: /Apply/ }).click();
    const more = b2.getByRole("button", { name: "More pricing options" });
    check(T("Remove Override appears once a selected row has an override"), (await more.count()) === 1);
    check(T("toolbar fits on screen (two rows, override menu)"), await toolbarFits(page));
    if (vp.id !== "tablet") await shot(page, `${plan}__toolbar-two-override__${vp.id}`);
    await more.click();
    const removeItem = page.getByRole("menuitem", { name: /Remove Override/ });
    if (vp.id !== "tablet") await shot(page, `${plan}__remove-override-menu__${vp.id}`);
    await removeItem.click();
    await page.waitForSelector("text=Pricing override removed.");
    check(T("Remove Override confirms and the menu disappears"), (await bar(page).getByRole("button", { name: "More pricing options" }).count()) === 0 && (await page.getByText(/15% markup/).count()) === 0);

    // Save Stack on free goes to the upgrade dialog too
    if (plan === "free") {
      await bar(page).getByRole("button", { name: "Save Stack" }).click();
      check(T("Save Stack on free opens the upgrade dialog"), (await page.getByRole("dialog").count()) === 1);
      await page.getByRole("dialog").getByRole("button", { name: "Not now" }).click();
    }

    // Duplicate the two selected rows (re-apply an override first, to check it's kept on the copies)
    await page.locator("#bulk-pct").fill("20");
    await bar(page).getByRole("button", { name: /Apply/ }).click();
    await bar(page).getByRole("button", { name: /Duplicate/ }).click();
    await page.waitForSelector("text=2 items duplicated.");
    const after = await names(page);
    const idx = after.indexOf("Remove existing siding");
    check(T("Duplicate Selected inserts each copy directly below its original"),
      after.length === before.length + 2 && after[idx + 1] === "Remove existing siding" && after[after.indexOf("House wrap") + 1] === "House wrap", after.join(", "));
    check(T("selection clears after duplicating"), (await bar(page).count()) === 0);
    check(T("copies keep the pricing override"), (await page.getByText("20% markup", { exact: true }).count()) === 4);
    if (vp.id !== "tablet") await shot(page, `${plan}__after-duplicate__${vp.id}`);

    // A copy is independent: renaming it leaves the original alone
    const inputs = page.locator('input[aria-label="Item name"]');
    await inputs.nth(idx + 1).fill("Remove existing siding (rear)");
    const after2 = await names(page);
    check(T("editing a copy does not change its original"), after2[idx] === "Remove existing siding" && after2[idx + 1] === "Remove existing siding (rear)");

    check(T("estimate page has no horizontal scroll"), await noHScroll(page));
    check(T("no page errors"), errors.length === 0, errors.join(" | "));
    await ctx.close();
  }
}

await browser.close();
fs.writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
