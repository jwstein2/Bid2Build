// Browser walk for the priority trade landing pages (growth PR 2). Signed out, desktop + 390px.
// Usage: `next start` on :3000 (any build), then: node scripts/growth/landing-walk.mjs <screenshotDir>
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const out = process.argv[2] ?? "landing-shots";
fs.mkdirSync(out, { recursive: true });
const BASE = process.env.BASE ?? "http://localhost:3000";
const TRADES = ["decks", "general-contracting", "painting", "roofing", "concrete", "kitchens", "bathrooms", "flooring", "electrical", "siding", "drywall"];
const results = [];
const check = (n, ok, d = "") => { results.push({ n, ok: Boolean(ok) }); if (!ok) console.log(`FAIL ${n} ${d}`); };
const browser = await chromium.launch();
for (const vp of [{ tag: "desktop", width: 1440, height: 900 }, { tag: "m390", width: 390, height: 844 }]) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => { try { localStorage.setItem("b2b:onboarding", JSON.stringify({ status: "dismissed", at: "2026-11-01" })); } catch { /* */ } });
  const page = await ctx.newPage();
  for (const slug of TRADES) {
    const tag = `${slug}/${vp.tag}`;
    const res = await page.goto(`${BASE}/bids/${slug}`, { waitUntil: "networkidle" });
    check(`${tag} 200`, res?.status() === 200);
    const cta = page.locator('main a[data-cta="create"]').first();
    check(`${tag} primary CTA starts this trade`, (await cta.getAttribute("href")) === `/start/${slug}`);
    check(`${tag} landing sections`, await page.getByTestId("trade-landing").isVisible());
    const img = page.getByTestId("sample-proposal");
    await img.scrollIntoViewIfNeeded();
    check(`${tag} sample proposal loads`, await img.evaluate((el) => el.complete && el.naturalWidth > 0));
    check(`${tag} canonical unchanged`, (await page.locator('link[rel="canonical"]').getAttribute("href"))?.endsWith(`/bids/${slug}`));
    check(`${tag} no horizontal scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    if (["decks", "painting"].includes(slug)) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `${out}/${slug}__hero__${vp.tag}.png` });
      await page.getByTestId("trade-landing").screenshot({ path: `${out}/${slug}__sections__${vp.tag}.png` });
    }
  }
  // Clicking the CTA opens a ready draft in the builder without signing up.
  await page.goto(`${BASE}/bids/decks`, { waitUntil: "networkidle" });
  await page.locator('main a[data-cta="create"]').first().click();
  await page.waitForURL(/\/builder\?draft=/, { timeout: 15000 }).catch(() => {});
  check(`decks/${vp.tag} CTA opens the builder with a draft`, /\/builder\?draft=/.test(page.url()), page.url());
  await ctx.close();
}
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
fs.writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2));
process.exit(failed ? 1 : 0);
