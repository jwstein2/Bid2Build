// Browser walk for the one-time welcome popup + getting started tour.
// Usage: build against the mock Supabase (scripts/ux-audit/mock-supabase.mjs on :54321), `next start`
// on :3000, then: node scripts/onboarding/walk.mjs <screenshotDir>
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium, devices } = createRequire(import.meta.url)("playwright");
const out = process.argv[2] ?? "onboarding-shots";
fs.mkdirSync(out, { recursive: true });
const BASE = "http://localhost:3000";
const MOCK = "http://localhost:54321";
const results = [];
const check = (n, ok, d = "") => { results.push({ n, ok: Boolean(ok), d }); console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? " — " + d : ""}`); };

const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600 * 24 * 365 * 50, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };

const setStatus = (s) => fetch(`${MOCK}/__onboarding?status=${s}`).then((r) => r.json());
const getStatus = () => fetch(`${MOCK}/__onboarding`).then((r) => r.json());
const dialog = (page) => page.getByTestId("onboarding-dialog");
const title = (page) => page.getByTestId("onboarding-title").innerText();
const local = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("b2b:onboarding") ?? "null"));
const waitOpen = (page, ms = 6000) => dialog(page).waitFor({ state: "visible", timeout: ms }).then(() => true, () => false);
const staysClosed = async (page) => { await page.waitForTimeout(2600); return !(await dialog(page).isVisible()); };

const VIEWPORTS = [
  { tag: "m320", width: 320, height: 640, mobile: true },
  { tag: "m375", width: 375, height: 667, mobile: true },
  { tag: "m390", width: 390, height: 844, mobile: true },
  { tag: "m430", width: 430, height: 932, mobile: true },
  { tag: "landscape", width: 844, height: 390, mobile: true },
  { tag: "tablet", width: 820, height: 1180, mobile: true },
  { tag: "desktop", width: 1440, height: 900, mobile: false },
];
const ctxFor = (browser, vp, extra = {}) => browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile && vp.width < 900, hasTouch: vp.mobile, ...extra });
const desk = VIEWPORTS.at(-1);

const STEP_TITLES = ["Welcome to Built2Bid!", "What Are You Bidding Today?", "Your Company, Your Brand", "Who Are You Bidding For?", "Build Your Estimate in Minutes", "Make Every Bid Professional", "You're Ready to Bid!"];

async function anonymousFlow(browser) {
  // A. New visitor: popup, video, full tour, Create My First Bid → real trade chooser → Company.
  {
    const ctx = await ctxFor(browser, desk); const page = await ctx.newPage();
    const mp4 = [];
    page.on("request", (r) => { if (r.url().includes(".mp4")) mp4.push(r); });
    await page.goto(`${BASE}/`);
    check("A new visitor sees the welcome popup", await waitOpen(page));
    check("A heading is Welcome to Built2Bid!", (await title(page)) === STEP_TITLES[0]);
    check("A subheading shown", await page.getByText("Professional estimates. Faster bids. More jobs won.").isVisible());
    check("A shows Step 1 of 7", (await page.getByTestId("onboarding-step").innerText()) === "Step 1 of 7");
    check("A has Not Right Now + Take Tour + X", (await page.getByTestId("onboarding-not-now").isVisible()) && (await page.getByTestId("onboarding-take-tour").isVisible()) && (await page.getByTestId("onboarding-close").isVisible()));
    const v = page.getByTestId("onboarding-video");
    const attrs = await v.evaluate((el) => ({ controls: el.controls, playsInline: el.playsInline, preload: el.preload, poster: el.getAttribute("poster"), autoplay: el.autoplay, muted: el.muted, src: el.querySelector("source")?.getAttribute("src"), ratio: el.getBoundingClientRect().width / el.getBoundingClientRect().height }));
    check("A video: native controls, inline, no autoplay, poster", attrs.controls && attrs.playsInline && !attrs.autoplay && attrs.poster === "/media/meet-built2bid-poster.jpg", JSON.stringify(attrs));
    check("A video keeps 16:9", Math.abs(attrs.ratio - 16 / 9) < 0.02, attrs.ratio.toFixed(3));
    check("A video not downloaded before Play", mp4.length === 0 && attrs.preload === "none", `${mp4.length} mp4 requests`);
    await page.screenshot({ path: `${out}/a-welcome__desktop.png` });
    await page.getByTestId("onboarding-play").click();
    await page.waitForTimeout(2500);
    const pv = await v.evaluate((el) => ({ t: el.currentTime, paused: el.paused, w: el.videoWidth, err: el.error?.code ?? null }));
    check("A video plays after Play", pv.t > 0.5 && !pv.paused && pv.w === 1280 && pv.err === null, JSON.stringify(pv));
    const ranged = await Promise.all(mp4.map(async (r) => (await r.response())?.status()));
    check("A video streams with range requests (206)", ranged.includes(206), JSON.stringify(ranged));
    await page.screenshot({ path: `${out}/a-video-playing__desktop.png` });
    await page.getByTestId("onboarding-take-tour").click();
    check("A video pauses when leaving step 1", await v.evaluate((el) => el.paused));
    check("A Take Tour → step 2", (await title(page)) === STEP_TITLES[1]);
    for (let i = 2; i < 7; i++) {
      await page.getByTestId("onboarding-next").click();
      check(`A Next → step ${i + 1} ${STEP_TITLES[i]}`, (await title(page)) === STEP_TITLES[i] && (await page.getByTestId("onboarding-step").innerText()) === `Step ${i + 1} of 7`);
      check(`A step ${i + 1} still loads`, await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="onboarding-dialog"] img')].every((im) => im.complete && im.naturalWidth > 0), null, { timeout: 5000 }).then(() => true, () => false));
      if (i === 4) await page.screenshot({ path: `${out}/a-step5__desktop.png` });
    }
    await page.getByTestId("onboarding-back").click();
    await page.getByTestId("onboarding-back").click();
    check("A Back twice → step 5", (await title(page)) === STEP_TITLES[4]);
    await page.getByTestId("onboarding-next").click(); await page.getByTestId("onboarding-next").click();
    check("A Next again → step 7 (progress kept)", (await title(page)) === STEP_TITLES[6]);
    check("A step 7 final message", await page.getByText("You're ready to create your first professional estimate with Built2Bid. Let's get bidding!").isVisible());
    check("A step 7 has no Skip Tour", !(await page.getByTestId("onboarding-skip").isVisible()));
    await page.screenshot({ path: `${out}/a-step7__desktop.png` });
    check("A no bid created while touring", (await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("byb:draft:")).length)) === 0);
    await page.getByTestId("onboarding-create").click();
    await page.waitForURL(/\/bids$/);
    check("A Create My First Bid opens the trade chooser", await page.getByRole("heading", { name: "What are you bidding today?" }).isVisible());
    check("A completed stored locally", (await local(page))?.status === "completed");
    await page.getByRole("link", { name: /^Roofing/ }).first().click();
    await page.waitForURL(/builder\?draft=/); await page.waitForSelector('nav[aria-label="Builder steps"]');
    const cur = await page.locator('nav[aria-label="Builder steps"] [aria-current="step"]').innerText();
    check("A anonymous visitor without company → Company step", /Company/.test(cur), cur);
    await page.goto(`${BASE}/`);
    check("A not shown again after completing", await staysClosed(page));
    await ctx.close();
  }
  // B. Not Right Now; C. X; D. Esc; E. Skip Tour. Each: closes, stored, never again.
  for (const [tag, act] of [
    ["B Not Right Now", (p) => p.getByTestId("onboarding-not-now").click()],
    ["C close X", (p) => p.getByTestId("onboarding-close").click()],
    ["D Escape", (p) => p.keyboard.press("Escape")],
    ["E Skip Tour", async (p) => { await p.getByTestId("onboarding-take-tour").click(); await p.getByTestId("onboarding-next").click(); await p.getByTestId("onboarding-skip").click(); }],
  ]) {
    const ctx = await ctxFor(browser, desk); const page = await ctx.newPage();
    await page.goto(`${BASE}/bids`);
    check(`${tag}: popup shown on /bids`, await waitOpen(page));
    if (tag.startsWith("B")) {
      await page.mouse.click(10, 450);
      check("B clicking outside doesn't close it", await dialog(page).isVisible());
    }
    await act(page);
    check(`${tag}: closes`, !(await dialog(page).isVisible()));
    check(`${tag}: page usable after`, await page.getByRole("link", { name: /^Roofing/ }).first().isVisible());
    check(`${tag}: stored as dismissed`, (await local(page))?.status === "dismissed");
    await page.reload();
    check(`${tag}: not shown after reload`, await staysClosed(page));
    await page.goto(`${BASE}/`);
    check(`${tag}: not shown on another page`, await staysClosed(page));
    await ctx.close();
  }
  // F. Returning browser, ineligible pages, checkout/auth returns.
  {
    const ctx = await ctxFor(browser, desk); const page = await ctx.newPage();
    await page.goto(`${BASE}/login`);
    check("F not shown on /login", await staysClosed(page));
    await page.goto(`${BASE}/pricing?resume=monthly`);
    check("F not shown on a checkout return", await staysClosed(page));
    await page.evaluate(() => localStorage.setItem("b2b.checkoutIntent", JSON.stringify({ v: 1, id: "x", plan: "monthly", createdAt: Date.now(), status: "pending" })));
    await page.goto(`${BASE}/`);
    check("F not shown while a checkout is pending", await staysClosed(page));
    await page.evaluate(() => localStorage.removeItem("b2b.checkoutIntent"));
    await page.goto(`${BASE}/`);
    check("F shown once checkout is no longer pending", await waitOpen(page));
    await ctx.close();
  }
  {
    const ctx = await ctxFor(browser, desk); const page = await ctx.newPage();
    await page.goto(`${BASE}/terms`);
    await page.evaluate(() => localStorage.setItem("byb:drafts", "[]"));
    await page.goto(`${BASE}/`);
    check("F browser that already used Built2Bid isn't treated as new", await staysClosed(page));
    check("F marked existing locally", (await local(page))?.status === "existing");
    await ctx.close();
  }
}

async function accountFlow(browser) {
  // G. Existing account (grandfathered): no popup.
  {
    await setStatus("existing");
    const ctx = await ctxFor(browser, desk); await ctx.addCookies([authCookie]); const page = await ctx.newPage();
    await page.goto(`${BASE}/dashboard`);
    check("G existing account: no popup on dashboard", await staysClosed(page));
    check("G existing mirrored locally", (await local(page))?.status === "existing");
    await page.goto(`${BASE}/`);
    check("G existing account: no popup on home", await staysClosed(page));
    // L. Replay from Help. Never changes the account's status.
    await page.goto(`${BASE}/dashboard`);
    await page.getByTestId("replay-tour").click();
    check("L Watch Getting Started Tour opens the tour", await waitOpen(page, 4000));
    check("L replay starts at step 1 with video", (await title(page)) === STEP_TITLES[0] && (await page.getByTestId("onboarding-video").isVisible()));
    await page.getByTestId("onboarding-take-tour").click();
    for (let i = 2; i < 7; i++) await page.getByTestId("onboarding-next").click();
    await page.getByTestId("onboarding-create").click();
    await page.waitForURL(/\/bids$/);
    check("L replay Create My First Bid → trade chooser", await page.getByRole("heading", { name: "What are you bidding today?" }).isVisible());
    check("L replay didn't change account status", (await getStatus()).status === "existing");
    check("L replay didn't change local status", (await local(page))?.status === "existing");
    await page.getByRole("link", { name: /^Roofing/ }).first().click();
    await page.waitForURL(/builder\?draft=/); await page.waitForSelector('nav[aria-label="Builder steps"]');
    const cur = await page.locator('nav[aria-label="Builder steps"] [aria-current="step"]').innerText();
    const first = await page.locator('nav[aria-label="Builder steps"] li').first().innerText();
    check("L complete company → Customer & project, Company checked", /Customer/.test(cur) && /done/.test(first), `${cur} | ${first}`);
    await ctx.close();
  }
  // H. New account: popup on dashboard; Not Right Now saved to the account.
  {
    await setStatus("new");
    const ctx = await ctxFor(browser, desk); await ctx.addCookies([authCookie]); const page = await ctx.newPage();
    await page.goto(`${BASE}/dashboard`);
    check("H new account sees the popup on the dashboard", await waitOpen(page));
    await page.screenshot({ path: `${out}/h-dashboard-new-account__desktop.png` });
    await page.getByTestId("onboarding-not-now").click();
    await page.waitForTimeout(800);
    check("H dismissal saved to the account", (await getStatus()).status === "dismissed");
    check("H local marked synced", (await local(page))?.synced === true);
    await ctx.close();
    // Same account, fresh browser: account state wins.
    const ctx2 = await ctxFor(browser, desk); await ctx2.addCookies([authCookie]); const p2 = await ctx2.newPage();
    await p2.goto(`${BASE}/dashboard`);
    check("H not shown on another device after dismissing", await staysClosed(p2));
    await ctx2.close();
  }
  // I. New account completes the tour.
  {
    await setStatus("new");
    const ctx = await ctxFor(browser, desk); await ctx.addCookies([authCookie]); const page = await ctx.newPage();
    await page.goto(`${BASE}/dashboard`);
    await waitOpen(page);
    await page.getByTestId("onboarding-take-tour").click();
    for (let i = 2; i < 7; i++) await page.getByTestId("onboarding-next").click();
    await page.getByTestId("onboarding-create").click();
    await page.waitForURL(/\/bids$/); await page.waitForTimeout(800);
    check("I completion saved to the account", (await getStatus()).status === "completed");
    await ctx.close();
  }
  // J. Migration not applied: never auto-show to signed-in users.
  {
    await setStatus("missing");
    const ctx = await ctxFor(browser, desk); await ctx.addCookies([authCookie]); const page = await ctx.newPage();
    await page.goto(`${BASE}/dashboard`);
    check("J status unreadable (migration not applied): no popup", await staysClosed(page));
    await page.getByTestId("replay-tour").click();
    check("J replay still works", await waitOpen(page, 4000));
    await ctx.close();
  }
  // K. Visitor dismisses, then signs up in the same browser: not shown again, copied to the account.
  {
    await setStatus("new");
    const ctx = await ctxFor(browser, desk); const page = await ctx.newPage();
    await page.goto(`${BASE}/`);
    await waitOpen(page);
    await page.getByTestId("onboarding-not-now").click();
    await ctx.addCookies([authCookie]); // signs in
    await page.goto(`${BASE}/dashboard`);
    check("K not shown after signing up in the same browser", await staysClosed(page));
    check("K visitor's choice copied to the new account", (await getStatus()).status === "dismissed");
    await ctx.close();
  }
  await setStatus("existing");
}

async function layouts(browser) {
  for (const vp of VIEWPORTS) {
    const ctx = await ctxFor(browser, vp); const page = await ctx.newPage();
    await page.goto(`${BASE}/`);
    const opened = await waitOpen(page);
    check(`M ${vp.tag} popup opens`, opened);
    if (!opened) { await ctx.close(); continue; }
    for (const step of [0, 1, 4, 6]) {
      if (step > 0) {
        if (step === 1) await page.getByTestId("onboarding-take-tour").click();
        else while ((await page.getByTestId("onboarding-step").innerText()) !== `Step ${step + 1} of 7`) await page.getByTestId("onboarding-next").click();
      }
      const m = await page.evaluate(() => {
        const d = document.querySelector('[data-testid="onboarding-dialog"]').getBoundingClientRect();
        const vis = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight + 0.5 && r.left >= 0 && r.right <= innerWidth + 0.5; };
        const dlg = document.querySelector('[data-testid="onboarding-dialog"]');
        return {
          inside: d.left >= 0 && d.right <= innerWidth + 0.5 && d.top >= 0 && d.bottom <= innerHeight + 0.5,
          hscroll: document.documentElement.scrollWidth > innerWidth || dlg.scrollWidth > dlg.clientWidth + 1,
          primary: vis('[data-testid="onboarding-take-tour"]') ?? vis('[data-testid="onboarding-next"]') ?? vis('[data-testid="onboarding-create"]'),
          close: vis('[data-testid="onboarding-close"]'),
          video: (() => { const v = document.querySelector('[data-testid="onboarding-video"]'); const r = v.getBoundingClientRect(); return r.width ? r.right <= innerWidth + 0.5 : true; })(),
        };
      });
      await page.waitForTimeout(400);
      await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="onboarding-dialog"] img')].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 5000 }).catch(() => {});
      check(`M ${vp.tag} step ${step + 1}: fits, no horizontal scroll, controls reachable`, m.inside && !m.hscroll && m.primary && m.close && m.video, JSON.stringify(m));
      await page.screenshot({ path: `${out}/m-step${step + 1}__${vp.tag}.png` });
    }
    await ctx.close();
  }
  // Keyboard: focus starts in the dialog, Tab stays inside, Enter on Take Tour advances.
  {
    const ctx = await ctxFor(browser, desk); const page = await ctx.newPage();
    await page.goto(`${BASE}/`); await waitOpen(page);
    check("N focus starts on the heading", await page.evaluate(() => document.activeElement?.getAttribute("data-testid") === "onboarding-title"));
    let inside = true;
    for (let i = 0; i < 8; i++) { await page.keyboard.press("Tab"); inside &&= await page.evaluate(() => Boolean(document.activeElement?.closest('[data-testid="onboarding-dialog"]'))); }
    check("N Tab stays inside the dialog", inside);
    await page.getByTestId("onboarding-take-tour").focus(); await page.keyboard.press("Enter");
    check("N Enter on Take Tour advances and focuses the new heading", (await title(page)) === STEP_TITLES[1] && (await page.evaluate(() => document.activeElement?.getAttribute("data-testid") === "onboarding-title")));
    await ctx.close();
  }
  // Mobile replay from the account menu (iPhone emulation).
  {
    await setStatus("existing");
    const ctx = await browser.newContext({ ...devices["iPhone 13"] }); await ctx.addCookies([authCookie]); const page = await ctx.newPage();
    await page.goto(`${BASE}/dashboard`);
    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByTestId("replay-tour").click();
    check("O mobile: replay from the account menu", await waitOpen(page, 4000));
    await page.getByTestId("onboarding-play").tap();
    await page.waitForTimeout(2000);
    check("O mobile: video plays inline and dialog stays open", (await page.getByTestId("onboarding-video").evaluate((el) => el.currentTime > 0.3)) && (await dialog(page).isVisible()));
    await page.screenshot({ path: `${out}/o-mobile-replay-playing__iphone13.png` });
    await ctx.close();
  }
}

const browser = await chromium.launch();
try {
  await anonymousFlow(browser);
  await accountFlow(browser);
  await layouts(browser);
} finally {
  await browser.close();
  fs.writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2));
  const fails = results.filter((r) => !r.ok);
  console.log(`\n${results.length - fails.length}/${results.length} passed`);
  if (fails.length) process.exitCode = 1;
}
