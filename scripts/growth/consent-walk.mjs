// Browser walk for the ad-measurement consent banner + Pixel gating (growth PR 3).
// Needs a build with NEXT_PUBLIC_META_PIXEL_ID set, NEXT_PUBLIC_DEPLOY_CONTEXT=production and
// NEXT_PUBLIC_ALLOW_INDEXING=true, on :3000. Usage: node scripts/growth/consent-walk.mjs <dir>
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const out = process.argv[2] ?? "consent-shots"; fs.mkdirSync(out, { recursive: true });
const BASE = "http://localhost:3000";
const results = []; const check = (n, ok) => { results.push({ n, ok: Boolean(ok) }); console.log(`${ok ? "PASS" : "FAIL"} ${n}`); };
const browser = await chromium.launch();
const fresh = async (vp = { width: 390, height: 844 }) => {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => { try { localStorage.setItem("b2b:onboarding", JSON.stringify({ status: "dismissed", at: "2026-11-01" })); } catch { /* */ } });
  const fbReq = []; ctx.on("request", (r) => { if (/facebook\.(net|com)/.test(r.url())) fbReq.push(r.url()); });
  await ctx.route(/facebook\.(net|com)/, (r) => r.fulfill({ status: 200, contentType: "application/javascript", body: "" }));
  return { ctx, page: await ctx.newPage(), fbReq };
};
{ // 1. First visit: banner, no Meta requests.
  const { ctx, page, fbReq } = await fresh();
  await page.goto(`${BASE}/bids/decks`, { waitUntil: "networkidle" });
  check("banner shown on first visit", await page.getByTestId("ad-consent").isVisible());
  check("no Meta request before a choice", fbReq.length === 0);
  await page.screenshot({ path: `${out}/consent-banner__m390.png` });
  // 2. No thanks: remembered, nothing loads.
  await page.getByRole("button", { name: "No thanks" }).click();
  await page.reload({ waitUntil: "networkidle" });
  check("declined: banner gone after reload", (await page.getByTestId("ad-consent").count()) === 0);
  check("declined: still no Meta request", fbReq.length === 0);
  await ctx.close();
}
{ // 3. Allow: Pixel script requested.
  const { ctx, page, fbReq } = await fresh();
  await page.goto(`${BASE}/bids/painting`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Allow" }).click();
  await page.waitForTimeout(1500);
  check("allowed: Pixel script requested", fbReq.some((u) => u.includes("fbevents.js")));
  await page.reload({ waitUntil: "networkidle" });
  check("allowed: banner gone", (await page.getByTestId("ad-consent").count()) === 0);
  await ctx.close();
}
{ // 4. Excluded pages never show it.
  const { ctx, page, fbReq } = await fresh();
  await page.goto(`${BASE}/sign/not-a-real-token`, { waitUntil: "networkidle" });
  check("signing link: no banner", (await page.getByTestId("ad-consent").count()) === 0);
  check("signing link: no Meta request", fbReq.length === 0);
  await ctx.close();
}
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} checks passed`); process.exit(failed ? 1 : 0);
