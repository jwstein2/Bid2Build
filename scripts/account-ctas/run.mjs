// Account-aware CTA regression walk: every account scenario x key pages x desktop/mobile.
// Needs scripts/ux-audit/mock-supabase.mjs on :54321 and `next start` on :3000 built against it.
// Usage: node scripts/account-ctas/run.mjs <outDir>
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.env.BASE ?? "http://localhost:3000";
const MOCK = process.env.MOCK ?? "http://localhost:54321";
const out = process.argv[2] ?? "account-cta-shots";
fs.mkdirSync(out, { recursive: true });

const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600 * 24 * 365 * 50, expires_at: 4102444800, user };
const cookieValue = `base64-${b64u(JSON.stringify(session))}`;
const authCookie = { name: "sb-localhost-auth-token", value: cookieValue, domain: "localhost", path: "/" };

const FREE_PROMO = /create a free bid|3 free bids to start|no sign-up until you download/i;
const scenarios = [
  { id: "signed-out", mock: "starter", auth: false, primary: "Create a Free Bid", secondary: "See How It Works", badge: null, promo: true },
  { id: "starter-credits", mock: "starter", primary: "Create New Bid", secondary: "View My Bids", badge: "2 free bids left" },
  { id: "monthly-credits", mock: "monthly", primary: "Create New Bid", secondary: "View My Bids", badge: "1 free bid left" },
  { id: "unlimited", mock: "unlimited", primary: "Create New Bid", secondary: "View My Bids", badge: null, billing: /Renews on/ },
  { id: "canceled-still-active", mock: "canceling", primary: "Create New Bid", secondary: "View My Bids", badge: null, billing: /Cancels on .* You keep Unlimited until then/ },
  { id: "expired-subscription", mock: "expired", primary: "View Plans", secondary: "View My Bids", badge: "No free bids left", billing: /Your Unlimited plan has ended/ },
  { id: "zero-credits", mock: "zero", primary: "View Plans", secondary: "View My Bids", badge: "No free bids left" },
];
const PAGES = [
  { id: "home", path: "/" },
  { id: "pricing", path: "/pricing" },
  { id: "trade", path: "/bids/roofing" },
  { id: "learn", path: "/learn/markup-vs-margin" },
  { id: "dashboard", path: "/dashboard", auth: true },
  { id: "billing", path: "/settings/billing", auth: true },
];
const VIEWPORTS = [{ id: "desktop", width: 1440, height: 900 }, { id: "m390", width: 390, height: 844 }];

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); if (!ok) console.log(`FAIL ${name} ${detail}`); };
const setScenario = (name, authDelayMs = 0) => fetch(`${MOCK}/__scenario?name=${name}&authDelayMs=${authDelayMs}`).then((r) => { if (!r.ok) throw new Error(`scenario ${name}`); });

const browser = await chromium.launch();
for (const sc of scenarios) {
  await setScenario(sc.mock);
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2 });
    if (sc.auth !== false) await ctx.addCookies([authCookie]);
    const page = await ctx.newPage();
    for (const pg of PAGES) {
      if (pg.auth && sc.auth === false) continue;
      const tag = `${sc.id}/${pg.id}/${vp.id}`;
      await page.goto(BASE + pg.path, { waitUntil: "networkidle" });
      const text = await page.locator("body").innerText();
      if (!pg.auth) {
        if (sc.promo) check(`${tag} shows the public offer`, FREE_PROMO.test(text));
        else check(`${tag} has no free-bid promo`, !FREE_PROMO.test(text), (text.match(FREE_PROMO) ?? [""])[0]);
        if (sc.mock === "unlimited" || sc.mock === "canceling") check(`${tag} shows no credit limits`, !/free bids? left|out of free bids/i.test(text));
        // Header primary CTA (desktop header or mobile menu).
        if (vp.id === "desktop") {
          const hdr = page.locator("header [data-cta]").last();
          check(`${tag} header CTA`, (await hdr.innerText()).trim() === sc.primary, await hdr.innerText());
          const badge = page.locator("header [data-testid=credit-badge]");
          check(`${tag} header badge`, sc.badge ? (await badge.innerText()) === sc.badge : (await badge.count()) === 0);
        } else {
          await page.getByRole("button", { name: "Open menu" }).click();
          const m = page.locator("nav[aria-label=Mobile] [data-cta]");
          check(`${tag} mobile menu CTA`, (await m.innerText()).trim() === sc.primary, await m.innerText());
          await page.getByRole("button", { name: "Close menu" }).click();
        }
      }
      if (pg.id === "home") {
        const hero = page.locator("section").first().locator("[data-cta]");
        const labels = (await hero.allInnerTexts()).map((s) => s.trim());
        check(`${tag} hero CTAs`, labels[0] === sc.primary && labels[1] === sc.secondary, labels.join(" | "));
        if (sc.auth !== false) check(`${tag} neutral tagline`, (await page.getByTestId("hero-tagline").innerText()) === "Professional estimates. Customer-ready proposals.");
      }
      if (pg.id === "trade") {
        const label = (await page.locator("main [data-cta]").first().innerText()).trim();
        check(`${tag} trade CTA`, label === sc.primary, label);
      }
      if (pg.id === "pricing" && sc.auth !== false) check(`${tag} marks exactly one current plan`, (await page.getByTestId("current-plan").count()) === 1);
      if (pg.id === "billing" && sc.billing) check(`${tag} subscription status`, sc.billing.test(text));
      await page.screenshot({ path: path.join(out, `${sc.id}__${pg.id}__${vp.id}.png`), fullPage: pg.id !== "home" && pg.id !== "trade" });
      if (pg.id === "home" && vp.id === "desktop") {
        await page.locator("[data-testid=plan-band-heading]").scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(out, `${sc.id}__home-band__${vp.id}.png`) });
      }
    }
    await ctx.close();
  }
}

// CTA destinations: click through on desktop and mobile.
for (const [mock, auth, expectPath] of [["starter", false, "/bids"], ["starter", true, "/bids"], ["unlimited", true, "/bids"], ["zero", true, "/pricing"]]) {
  await setScenario(mock);
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    if (auth) await ctx.addCookies([authCookie]);
    const page = await ctx.newPage();
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await page.locator("section").first().locator("[data-cta]").first().click();
    await page.waitForURL((u) => u.pathname === expectPath, { timeout: 10000 }).catch(() => {});
    check(`click hero primary (${auth ? mock : "signed-out"}, ${vp.id}) -> ${expectPath}`, new URL(page.url()).pathname === expectPath, page.url());
    if (auth) {
      await page.goto(BASE + "/", { waitUntil: "networkidle" });
      await page.locator("section").first().locator("[data-cta]").nth(1).click();
      await page.waitForURL((u) => u.pathname === "/dashboard", { timeout: 10000 }).catch(() => {});
      check(`click hero secondary (${mock}, ${vp.id}) -> /dashboard`, new URL(page.url()).pathname === "/dashboard", page.url());
    }
    await ctx.close();
  }
}

// Auth loading + refresh: slow Supabase auth (2s). The first HTML byte stream must already carry the right CTAs.
await setScenario("starter", 2000);
for (const pth of ["/", "/pricing", "/bids/roofing"]) {
  const t0 = Date.now();
  // Visible markup only: <head> meta descriptions and JSON-LD stay public SEO copy by design.
  const raw = await (await fetch(BASE + pth, { headers: { cookie: `${authCookie.name}=${cookieValue}` } })).text();
  const html = raw.slice(raw.indexOf("<body")).replace(/<script[\s\S]*?<\/script>/g, "");
  check(`slow auth ${pth}: server HTML has no free-bid promo (${Date.now() - t0}ms)`, !/Create a Free Bid|3 free bids to start/.test(html));
  check(`slow auth ${pth}: server HTML has member CTA`, html.includes("Create New Bid"));
}
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addCookies([authCookie]);
  const page = await ctx.newPage();
  const seen = new Set();
  // Sample visible text from first paint until load, across a load and two refreshes.
  page.on("domcontentloaded", async () => { try { seen.add(await page.locator("body").innerText()); } catch { /* navigating */ } });
  for (let i = 0; i < 3; i++) await (i ? page.reload({ waitUntil: "networkidle" }) : page.goto(BASE + "/", { waitUntil: "networkidle" }));
  seen.add(await page.locator("body").innerText());
  check("slow auth + refresh: never painted free-bid promo", [...seen].every((t) => !FREE_PROMO.test(t)), `${seen.size} samples`);
  await ctx.close();
}
await setScenario("starter", 0);
// Signed-out with a slow auth server still gets the public offer (no session = no auth call needed).
{
  const html = await (await fetch(BASE + "/")).text();
  check("signed-out server HTML keeps the public offer", html.includes("Create a Free Bid") && html.includes("3 free bids to start"));
}

await browser.close();
fs.writeFileSync(path.join(out, "results.json"), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
