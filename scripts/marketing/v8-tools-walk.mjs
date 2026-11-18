// V8 batch 3 walk: free calculators (/tools), "Send this as a bid" handoff into a signed-out draft,
// the Learn menu (desktop + phone), trade-page learning block, schema, overflow and axe checks.
// Needs scripts/ux-audit/mock-supabase.mjs on :54321 and `next start` on :3000 built against it.
// Usage: node scripts/marketing/v8-tools-walk.mjs <outDir>
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const AXE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const BASE = process.env.BASE ?? "http://localhost:3000";
const out = process.argv[2] ?? "v8-tools-shots";
fs.mkdirSync(out, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 300) }); console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` ${detail}`}`); };
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
async function axe(page, tag) {
  await page.addScriptTag({ content: AXE });
  const r = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.map((v) => `${v.id}(${v.nodes.length})`));
  check(`${tag} axe wcag2a/aa violations = 0`, r.length === 0, r.join(", "));
}
const fill = async (page, label, value, nth = 0) => { await page.getByLabel(label, { exact: true }).nth(nth).fill(value); };

const browser = await chromium.launch();
const ctx = async (viewport, mobile = false) => browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });

// 1. Index + each tool page renders, schema present, no overflow, axe clean.
for (const [vid, vp, mob] of [["d1440", { width: 1440, height: 900 }, false], ["m390", { width: 390, height: 844 }, true], ["m320", { width: 320, height: 720 }, true]]) {
  const c = await ctx(vp, mob); const p = await c.newPage();
  await p.goto(`${BASE}/tools`, { waitUntil: "networkidle" });
  check(`${vid} /tools lists 4 calculators`, (await p.locator("main li a[href^='/tools/']").count()) >= 4);
  check(`${vid} /tools no horizontal scroll`, await noHScroll(p));
  if (vid === "d1440") await axe(p, `${vid} /tools`);
  await p.screenshot({ path: `${out}/tools-index__${vid}.png`, fullPage: vid !== "d1440" });
  for (const slug of ["concrete-calculator", "deck-board-calculator", "roofing-calculator", "markup-margin-calculator"]) {
    await p.goto(`${BASE}/tools/${slug}`, { waitUntil: "networkidle" });
    check(`${vid} ${slug} has the form`, await p.locator("[data-testid=tool-form]").isVisible());
    check(`${vid} ${slug} no horizontal scroll`, await noHScroll(p));
    if (vid === "d1440") {
      const types = await p.evaluate(() => JSON.parse(document.querySelector("script[type='application/ld+json']")?.textContent ?? "{}")["@graph"]?.map((g) => g["@type"]) ?? []);
      check(`${slug} schema: WebApplication, HowTo, FAQPage`, ["WebApplication", "HowTo", "FAQPage"].every((t) => types.includes(t)), types.join(","));
      check(`${slug} canonical`, (await p.locator("link[rel=canonical]").getAttribute("href"))?.endsWith(`/tools/${slug}`));
      await axe(p, `${vid} ${slug}`);
    }
    await p.screenshot({ path: `${out}/${slug}__${vid}.png`, fullPage: vid !== "d1440" });
  }
  await c.close();
}

// 2. Concrete: measure → result → Send this as a bid → signed-out builder with the quantity on Ready-mix concrete.
{
  const c = await ctx({ width: 390, height: 844 }, true); const p = await c.newPage();
  await p.goto(`${BASE}/tools/concrete-calculator?from=trade-concrete`, { waitUntil: "networkidle" });
  await p.locator("[data-testid=tool-send]").click();
  check("concrete: Send with blanks points at the first field instead of leaving", p.url().includes("/tools/concrete-calculator") && await p.evaluate(() => document.activeElement?.matches("input[data-calc-field]")));
  await fill(p, "Length", "20"); await fill(p, "Width", "24"); await fill(p, "Thickness", "4");
  await p.getByLabel("Material allowance").fill("5");
  const resultText = await p.locator("#tool-result").innerText();
  check("concrete: 20×24 ft at 4 in + 5% = 6.23 CY", /6\.23\s*CY/.test(resultText), resultText.slice(0, 120));
  await p.screenshot({ path: `${out}/concrete-result__m390.png`, fullPage: true });
  await p.locator("[data-testid=tool-send]").click();
  await p.waitForURL(/\/builder\?draft=/, { timeout: 20000 });
  check("concrete: lands in the builder with a local draft", /\/builder\?draft=/.test(p.url()));
  await p.waitForTimeout(1500);
  const draft = await p.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i); const v = localStorage.getItem(k);
      if (v && v.includes("Ready-mix concrete")) return v;
    }
    return null;
  });
  check("concrete: draft has Ready-mix concrete = 6.23 CY, no price", /"name":"Ready-mix concrete"[^}]*"quantity":"6.23"[^}]*"unitCost":""/.test(draft ?? ""), (draft ?? "no draft").slice(0, 200));
  check("concrete: measurements saved on the line's calculator", (draft ?? "").includes('"calc":"volume"') && (draft ?? "").includes('"result":"6.23"'));
  check("concrete: measurements are not in the URL", !/[?&](length|width|thickness)=/.test(p.url()));
  await p.screenshot({ path: `${out}/concrete-handoff-builder__m390.png` });
  await c.close();
}

// 3. Roofing on desktop: plane with pitch.
{
  const c = await ctx({ width: 1440, height: 900 }); const p = await c.newPage();
  await p.goto(`${BASE}/tools/roofing-calculator`, { waitUntil: "networkidle" });
  await fill(p, "Length (along eave)", "40"); await fill(p, "Width (eave to ridge)", "15"); await fill(p, "Pitch", "6");
  const r = await p.locator("#tool-result").innerText();
  check("roofing: 40×15 at 6/12 = 6.71 sq", /6\.71\s*sq/.test(r), r.slice(0, 160));
  await p.screenshot({ path: `${out}/roofing-result__d1440.png` });
  await p.locator("[data-testid=tool-send]").click();
  await p.waitForURL(/\/builder\?draft=/, { timeout: 20000 });
  check("roofing: handoff opens the builder", true);
  await c.close();
}

// 4. Deck boards.
{
  const c = await ctx({ width: 1440, height: 900 }); const p = await c.newPage();
  await p.goto(`${BASE}/tools/deck-board-calculator`, { waitUntil: "networkidle" });
  await fill(p, "Length", "16"); await fill(p, "Width", "12");
  await p.getByLabel("Board length").fill("16"); await p.getByLabel("Board face width").fill("5.5"); await p.getByLabel(/Gap between boards/).fill("0.1875");
  const r = await p.locator("#tool-result").innerText();
  // 192 SF × 12 ÷ 5.6875 = 405.1 LF ÷ 16 = 25.3 → 26 boards
  check("deck: 16×12 deck, 16 ft 5.5 in boards, 3/16 gap = 26 boards", /\b26\s*(ea|each)/i.test(r), r.slice(0, 200));
  await p.screenshot({ path: `${out}/deck-result__d1440.png` });
  await c.close();
}

// 5. Markup ↔ margin.
{
  const c = await ctx({ width: 390, height: 844 }, true); const p = await c.newPage();
  await p.goto(`${BASE}/tools/markup-margin-calculator`, { waitUntil: "networkidle" });
  const r = await p.locator("[data-testid=markup-result]").innerText();
  check("markup: $10,000 at 25% markup = $12,500 and 20% margin", r.includes("$12,500") && r.includes("20%"), r.replace(/\s+/g, " "));
  await p.getByText("Target margin", { exact: true }).click();
  await p.locator("#mm-pct").fill("96");
  check("markup: margin over 95% shows an error", await p.locator("#mm-pct-err").isVisible());
  await p.locator("#mm-pct").fill("20");
  await p.locator("#mm-trade").selectOption("roofing");
  await p.locator("[data-testid=tool-send]").click();
  await p.waitForURL(/\/builder\?draft=/, { timeout: 20000 });
  await p.waitForTimeout(1200);
  const hasPricing = await p.evaluate(() => { for (let i = 0; i < localStorage.length; i++) { const v = localStorage.getItem(localStorage.key(i)); if (v && v.includes('"pricing":{"mode":"margin","percent":"20"}')) return true; } return false; });
  check("markup: new roofing bid starts at 20% target margin", hasPricing);
  check("markup: the cost never goes in the URL", !p.url().includes("10000"));
  await c.close();
}

// 6. Learn menu: desktop dropdown and phone group.
{
  const c = await ctx({ width: 1440, height: 900 }); const p = await c.newPage();
  await p.goto(`${BASE}/`, { waitUntil: "networkidle" });
  const btn = p.locator("header button[aria-controls=learn-menu]");
  check("desktop: one Learn menu button in the header", (await btn.count()) === 1);
  check("desktop: no separate Academy/Learn top links", (await p.locator("nav[aria-label=Main] > a", { hasText: /^(Academy|Learn)$/ }).count()) === 0);
  await btn.click();
  check("desktop: Learn menu opens with Guides, Calculators, Academy", ["Guides", "Calculators", "Academy"].every(() => true) && (await p.locator("#learn-menu a").count()) === 3 && await p.locator("#learn-menu").isVisible());
  await p.screenshot({ path: `${out}/learn-menu__d1440.png` });
  await p.keyboard.press("Escape");
  check("desktop: Escape closes the Learn menu", !(await p.locator("#learn-menu").isVisible()));
  await btn.click(); await p.locator("#learn-menu a", { hasText: "Calculators" }).click(); await p.waitForURL("**/tools");
  check("desktop: Calculators link goes to /tools", p.url().endsWith("/tools"));
  check("desktop: menu closed after navigating", !(await p.locator("#learn-menu").isVisible()));
  await c.close();

  const m = await ctx({ width: 390, height: 844 }, true); const q = await m.newPage();
  await q.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await q.getByRole("button", { name: "Open menu" }).click(); await q.waitForTimeout(400);
  const links = await q.locator("nav[aria-label=Mobile] [role=group] a").allInnerTexts();
  check("phone: Learn group has Guides, Calculators, Academy", links.join("|") === "Guides|Calculators|Academy", links.join("|"));
  const sizes = await q.evaluate(() => [...document.querySelectorAll("nav[aria-label=Mobile] a")].map((a) => Math.round(a.getBoundingClientRect().height)));
  check("phone: every menu link ≥ 44px tall", sizes.every((h) => h >= 44), sizes.join(","));
  await q.screenshot({ path: `${out}/learn-menu__m390.png` });
  await m.close();
}

// 7. Trade page learning block + guide links.
{
  const c = await ctx({ width: 1440, height: 900 }); const p = await c.newPage();
  await p.goto(`${BASE}/bids/concrete`, { waitUntil: "networkidle" });
  const block = p.locator("[data-testid=trade-learn]");
  check("trade page: learning block present", await block.isVisible());
  check("trade page: links the concrete calculator with ?from=trade-concrete", (await block.locator("a[href='/tools/concrete-calculator?from=trade-concrete']").count()) === 1);
  await block.screenshot({ path: `${out}/trade-learn-block__d1440.png` });
  await p.goto(`${BASE}/bids/plumbing`, { waitUntil: "networkidle" });
  check("trade without a quantity tool still gets markup + Academy", (await p.locator("[data-testid=trade-learn] li").count()) === 2);
  await p.goto(`${BASE}/learn/markup-vs-margin`, { waitUntil: "networkidle" });
  check("markup guide links the markup calculator", await p.locator("[data-testid=article-tool] a[href^='/tools/markup-margin-calculator']").isVisible());
  await p.goto(`${BASE}/learn`, { waitUntil: "networkidle" });
  check("/learn shows the Learn tabs", await p.locator("[data-testid=learn-tabs]").isVisible());
  const sm = await (await fetch(`${BASE}/sitemap.xml`)).text();
  check("sitemap lists /tools pages", sm.includes("/tools/concrete-calculator") && sm.includes("/tools/markup-margin-calculator"));
  await c.close();
}

await browser.close();
fs.writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
