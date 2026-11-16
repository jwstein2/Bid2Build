// Capture a real screenshot of the Built2Bid estimate builder for every trade, used in the
// per-page share images (src/app/(marketing)/bids/[trade]/opengraph-image.tsx).
// Usage: node scripts/og/capture-trades.mjs [baseUrl] [slug ...]
//   baseUrl defaults to https://built2bid.org. Opens /start/<slug> signed out (a local draft, nothing
//   is saved to the database), switches to the Estimate step and saves a JPEG crop to
//   src/assets/og/trades/<slug>.jpg. Re-run after a trade template changes.
import { createRequire } from "node:module";
import sharp from "sharp";
// Playwright is not a project dependency; it resolves from the global install (NODE_PATH).
const { chromium } = createRequire(import.meta.url)("playwright");
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../..", import.meta.url).pathname;
const out = join(root, "src/assets/og/trades");
mkdirSync(out, { recursive: true });
const base = (process.argv[2] || "https://built2bid.org").replace(/\/$/, "");
let slugs = process.argv.slice(3);
if (!slugs.length) {
  const xml = await (await fetch(`${base}/sitemap.xml`)).text();
  slugs = [...xml.matchAll(/\/bids\/([a-z0-9-]+)<\/loc>/g)].map((m) => m[1]);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1200, height: 700 }, deviceScaleFactor: 1.5 });
// Skip third-party calls (analytics, error reporting) so captures do not count as visits.
await context.route(/googletagmanager|google-analytics|sentry\.io/, (r) => r.abort());
// Mark the welcome tour as seen so its popup does not cover the builder.
await context.addInitScript(() => { try { localStorage.setItem("b2b:onboarding", JSON.stringify({ status: "dismissed", at: new Date().toISOString(), synced: true })); } catch {} });
let failed = 0;
for (const slug of slugs) {
  const page = await context.newPage();
  try {
    await page.goto(`${base}/start/${slug}`, { waitUntil: "networkidle" });
    await page.waitForURL(/\/builder/, { timeout: 15000 });
    await page.locator('button:has-text("Estimate")').first().click();
    await page.waitForTimeout(800);
    await page.keyboard.press("Escape");
    await page.evaluate(() => document.activeElement?.blur?.());
    const png = await page.screenshot({ clip: { x: 0, y: 0, width: 712, height: 600 } });
    await sharp(png).jpeg({ quality: 72, mozjpeg: true }).toFile(join(out, `${slug}.jpg`));
    console.log("ok", slug);
  } catch (e) {
    failed++;
    console.error("FAILED", slug, e.message.split("\n")[0]);
  } finally {
    await page.close();
  }
}
await browser.close();
if (failed) process.exit(1);
