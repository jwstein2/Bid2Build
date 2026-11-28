// Repeatable website-to-desktop update test (V10.1).
// 1. DEPLOY_ID=build-A npm run build && cp -r .next <BUILD_A>
// 2. make a visible change, DEPLOY_ID=build-B npm run build && cp -r .next <BUILD_B>
// 3. BUILD_A=<BUILD_A> BUILD_B=<BUILD_B> node docs/desktop/update-sync-test.mjs   (needs Playwright)
// The step "version B interface" expects the B build's login heading to contain "(version B)".
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Requires the `playwright` package (pre-installed in Claude Code cloud sessions; otherwise `npm i -D playwright`).
const { chromium } = createRequire(import.meta.url)('playwright');
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BUILDS = { A: process.env.BUILD_A, B: process.env.BUILD_B };
if (!BUILDS.A || !BUILDS.B) { console.error('Set BUILD_A and BUILD_B to copies of two .next builds.'); process.exit(2); }
// Private, randomly named working folder for screenshots and the browser profile.
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'b2b-desktop-test-'));
const URL = 'http://localhost:3100';
let server;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
async function startServer(build) {
  fs.rmSync(path.join(REPO, '.next'), { recursive: true, force: true });
  fs.cpSync(BUILDS[build], path.join(REPO, '.next'), { recursive: true });
  server = spawn('npx', ['next', 'start', '-p', '3100'], { cwd: REPO, stdio: 'ignore', detached: true });
  for (let i = 0; i < 60; i++) { try { const r = await fetch(URL + '/api/version'); if (r.ok) { log('server', build, await r.text()); return; } } catch {} await new Promise(r => setTimeout(r, 1000)); }
  throw new Error('server did not start');
}
function stopServer() { try { process.kill(-server.pid, 'SIGTERM'); } catch {} }
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); log(ok ? 'PASS' : 'FAIL', name, detail); };

(async () => {
  await startServer('A');
  // Headers
  const login = await fetch(URL + '/login');
  check('HTML is never cached (Cache-Control)', /no-store|no-cache/.test(login.headers.get('cache-control') || ''), login.headers.get('cache-control'));
  const sw = await fetch(URL + '/sw.js');
  check('sw.js served no-cache', /no-cache/.test(sw.headers.get('cache-control') || ''), sw.headers.get('cache-control'));
  const ver = await fetch(URL + '/api/version');
  check('/api/version no-store', /no-store/.test(ver.headers.get('cache-control') || ''), ver.headers.get('cache-control'));
  const man = await (await fetch(URL + '/manifest.webmanifest')).json();
  check('manifest name/display/start_url', man.name === 'Built2Bid' && man.display === 'standalone', `${man.name} ${man.display} ${man.start_url}`);

  const ctx = await chromium.launchPersistentContext(`${OUT}/profile`, { viewport: { width: 1280, height: 800 } });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(URL + '/login');
  const cdp = await ctx.newCDPSession(page);
  const inst = await cdp.send('Page.getInstallabilityErrors');
  check('Chromium installability: no errors', inst.installabilityErrors.length === 0, JSON.stringify(inst.installabilityErrors));
  const am = await cdp.send('Page.getAppManifest');
  check('Chromium parsed manifest without errors', (am.errors || []).length === 0, JSON.stringify(am.errors));
  await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller !== null || false, null, { timeout: 15000 }).catch(() => {});
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) { await page.reload(); }
  const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
  check('service worker registered and controlling', controlled);
  const caches = await page.evaluate(async () => { const out = {}; for (const n of await caches.keys()) { const c = await caches.open(n); out[n] = (await c.keys()).map(r => new URL(r.url).pathname); } return out; });
  check('only the offline page is cached', JSON.stringify(caches) === JSON.stringify({ 'b2b-offline-v1': ['/offline.html'] }), JSON.stringify(caches));
  const h1A = await page.textContent('h1');
  check('version A login heading', h1A.trim() === 'Welcome back to Built2Bid', h1A);
  await page.screenshot({ path: `${OUT}/01-login-A.png` });

  // Unsaved work: a text field with typing in progress.
  await page.evaluate(() => { const i = document.createElement('input'); i.id = 'draft-note'; i.style.cssText = 'position:fixed;top:8px;left:8px;z-index:99'; document.body.appendChild(i); });
  await page.fill('#draft-note', 'Unsaved customer note');
  await page.focus('#draft-note');

  // Deploy version B while the window stays open.
  stopServer();
  await new Promise(r => setTimeout(r, 1500));
  await startServer('B');
  log('waiting for the open window to notice the new release (first check at 20s)…');
  const banner = await page.waitForSelector('[data-testid="update-banner"]', { timeout: 40000 }).catch(() => null);
  check('open window detects new production build', !!banner, banner ? await banner.innerText() : 'no banner');
  await page.focus('#draft-note');
  await page.screenshot({ path: `${OUT}/02-update-banner.png` });
  await page.click('[data-testid="update-refresh"]');
  const confirm = await page.waitForSelector('[data-testid="update-refresh-anyway"]', { timeout: 3000 }).catch(() => null);
  check('Refresh asks to save first when there is unsaved work', !!confirm);
  const stillThere = await page.inputValue('#draft-note').catch(() => null);
  check('unsaved text not discarded by the prompt', stillThere === 'Unsaved customer note', String(stillThere));
  await page.screenshot({ path: `${OUT}/03-save-first.png` });
  await page.click('[data-testid="update-not-yet"]');
  await page.click('[data-testid="update-refresh"]');
  await page.click('[data-testid="update-refresh-anyway"]');
  await page.waitForLoadState('load');
  const h1B = await page.textContent('h1');
  check('after refresh: version B interface without reinstalling', h1B.includes('(version B)'), h1B);
  await page.waitForTimeout(23000);
  check('no update banner once current', !(await page.$('[data-testid="update-banner"]')));

  // Offline: in-page banner and cold launch.
  await ctx.setOffline(true);
  await page.waitForSelector('[data-testid="offline-banner"]', { timeout: 5000 }).catch(() => {});
  check('in-app offline banner', !!(await page.$('[data-testid="offline-banner"]')));
  await page.screenshot({ path: `${OUT}/04-offline-banner.png` });
  await page.goto(URL + '/dashboard').catch(() => {});
  const offlineText = await page.textContent('body').catch(() => '');
  check('launch while offline shows the Built2Bid offline page', offlineText.includes("You're offline. Connect to the internet to continue using Built2Bid."));
  await page.screenshot({ path: `${OUT}/05-offline-page.png` });
  await ctx.setOffline(false);
  await ctx.close();

  // "Weeks later": app closed, two more deploys (B -> A-as-C), then launched again from the same profile.
  stopServer();
  await new Promise(r => setTimeout(r, 1500));
  await startServer('A');
  const ctx2 = await chromium.launchPersistentContext(`${OUT}/profile`, { viewport: { width: 1280, height: 800 } });
  const p2 = ctx2.pages()[0] || await ctx2.newPage();
  await p2.goto(URL + '/login');
  const h1C = await p2.textContent('h1');
  check('relaunch after later deploys loads the current release immediately', h1C.trim() === 'Welcome back to Built2Bid', h1C);
  const v = await p2.evaluate(async () => (await (await fetch('/api/version')).json()).build);
  check('relaunched client and server agree on build', v === 'build-A', v);
  await ctx2.close();
  stopServer();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  console.log(`screenshots in ${OUT}`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); stopServer(); process.exit(2); });
