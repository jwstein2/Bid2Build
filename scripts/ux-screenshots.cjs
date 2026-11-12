// Full-page screenshots of every reachable route + builder states at 1440/768/390.
// Usage: node scripts/ux-screenshots.cjs <baseUrl> <outDir>   (needs the `playwright` package)
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const [base, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const VPS = { desktop: { width: 1440, height: 900 }, tablet: { width: 768, height: 1024 }, mobile: { width: 390, height: 844 } };
const pages = [
  ['home', '/'], ['trades', '/bids'], ['trade-roofing', '/bids/roofing'], ['trade-kitchen', '/bids/kitchens'],
  ['pricing', '/pricing'], ['learn', '/learn'], ['learn-article', '/learn/markup-vs-margin'],
  ['login', '/login'], ['privacy', '/privacy'], ['terms', '/terms'], ['not-found', '/this-page-does-not-exist'],
  ['dashboard-blocked', '/dashboard'], ['admin-blocked', '/admin'],
];
const manifest = [];
(async () => {
  const browser = await chromium.launch();
  for (const [vpName, vp] of Object.entries(VPS)) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const shot = async (name, note) => {
      const f = `${name}--${vpName}.png`;
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(out, f), fullPage: true });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      manifest.push({ name, vp: vpName, file: f, url: page.url().replace(base, ''), note: note || '', hOverflow: overflow });
    };
    for (const [name, p] of pages) {
      const r = await page.goto(base + p, { waitUntil: 'networkidle' }).catch(e => null);
      await shot(name, r ? `HTTP ${r.status()}` : 'nav error');
    }
    // Builder flow: fresh visitor
    await page.goto(base + '/start/roofing', { waitUntil: 'networkidle' });
    await page.waitForURL(/builder/, { timeout: 15000 }); await page.waitForLoadState('networkidle');
    await shot('builder-1-company', 'first-run anonymous');
    const tab = async (label) => { await page.getByRole('navigation', { name: 'Builder steps' }).getByRole('button', { name: new RegExp(label) }).click(); };
    await tab('Customer'); await shot('builder-2-project');
    await tab('Estimate'); await shot('builder-3-estimate');
    await tab('Proposal'); await shot('builder-4-proposal');
    await tab('Estimate');
    await page.getByRole('button', { name: /^Preview|Preview My Bid/ }).first().click(); await page.waitForTimeout(400);
    await shot('builder-5-preview-modal');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /Download PDF/ }).first().click(); await page.waitForTimeout(400);
    await shot('builder-6-auth-gate', 'export requires account');
    await page.keyboard.press('Escape');
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 1));
  console.log(manifest.filter(m => m.hOverflow).map(m => 'OVERFLOW ' + m.file).join('\n') || 'no overflow');
  console.log(manifest.length, 'shots');
})().catch(e => { console.error(e); process.exit(1); });
