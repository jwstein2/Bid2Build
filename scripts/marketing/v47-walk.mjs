// V4.7 marketing walk: homepage pillars, pricing packaging, comparison table, PM upgrade paths,
// internal links, SEO tags, horizontal overflow and axe checks, with screenshots.
// Needs scripts/ux-audit/mock-supabase.mjs on :54321 and `next start` on :3000 built against it with
// NEXT_PUBLIC_PROJECT_SCHEDULING=on and NEXT_PUBLIC_ESIGNATURES=on (production's switches).
// No Stripe call is made: checkout buttons are never clicked through to Stripe.
// Usage: node scripts/marketing/v47-walk.mjs <outDir>
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const AXE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const BASE = process.env.BASE ?? "http://localhost:3000";
const MOCK = process.env.MOCK ?? "http://localhost:54321";
const out = process.argv[2] ?? "v47-shots";
fs.mkdirSync(out, { recursive: true });

const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600 * 24 * 365 * 50, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 300) }); console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` ${detail}`}`); };
const scenario = (name) => fetch(`${MOCK}/__scenario?name=${name}`).then((r) => { if (!r.ok) throw new Error(name); });
const pmState = (state) => fetch(`${MOCK}/__pm?state=${encodeURIComponent(state ? JSON.stringify(state) : "")}`);
const VIEWPORTS = [{ id: "desktop", width: 1440, height: 900 }, { id: "m390", width: 390, height: 844 }, { id: "m320", width: 320, height: 720 }];
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const dismissOverlays = async (page) => {
  for (const name of [/maybe later/i, /^close$/i, /^skip/i, /accept|decline|reject/i]) {
    const b = page.getByRole("button", { name }).first();
    if (await b.isVisible().catch(() => false)) await b.click().catch(() => {});
  }
};
async function axe(page, tag) {
  await page.addScriptTag({ content: AXE });
  const r = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.map((v) => `${v.id}(${v.nodes.length})`));
  check(`${tag} axe wcag2a/aa violations = 0`, r.length === 0, r.join(", "));
  if (r.length) {
    const nodes = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ["wcag2aa"] })).violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target.join(" ")} ${n.any.map((a) => a.message).join(";")}`)));
    console.log(nodes.join("\n"));
  }
}

const browser = await chromium.launch();
// The first-visit welcome tour would cover the page: mark it seen, as a returning visitor would.
const _newContext = browser.newContext.bind(browser);
browser.newContext = async (o) => {
  const c = await _newContext(o);
  await c.addInitScript(() => { try { localStorage.setItem("b2b:onboarding", JSON.stringify({ status: "completed", at: new Date().toISOString() })); } catch { /* private mode */ } });
  return c;
};

// ---------- Homepage, signed out ----------
await scenario("starter");
for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.id === "desktop" ? 1 : 2 });
  const page = await ctx.newPage();
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  const tag = `home/signed-out/${vp.id}`;
  check(`${tag} headline`, (await page.locator("h1").innerText()).replace(/\s+/g, " ").includes("Professional estimates for your trade, ready to send."));
  const hero = (await page.locator("section").first().locator("[data-cta]").allInnerTexts()).map((s) => s.trim());
  check(`${tag} hero CTAs`, hero[0] === "Start Your 3 Free Bids" && hero[1] === "See a sample proposal", hero.join(" | "));
  for (const p of ["win", "run", "grow"]) {
    check(`${tag} pillar link ${p}`, await page.getByTestId(`pillar-link-${p}`).isVisible());
    check(`${tag} pillar section ${p}`, (await page.locator(`[data-pillar=${p}]`).count()) === 1);
  }
  const titles = await page.locator("[data-pillar] h3").allInnerTexts();
  check(`${tag} pillar order`, titles.join("|") === "Win the Job|Run the Job|Grow the Business", titles.join("|"));
  const note = await page.getByTestId("pm-price-note").innerText();
  check(`${tag} PM price note`, /\$4\.99\/month/.test(note) && /\$49\.99\/year/.test(note) && /Enterprise includes 1 schedule editor/.test(note), note);
  // V8: customer communications are live (released 2026-11-18) and listed with the add-on badge.
  for (const id of ["nurture", "scheduled_updates"]) {
    const badge = await page.locator(`[data-pillar] [data-feature-id=${id}] [data-status]`).innerText().catch(() => "");
    check(`${tag} ${id} listed as Project Command Center`, badge.trim() === "Project Command Center", badge);
  }
  check(`${tag} no Coming soon badges on the homepage`, (await page.locator("[data-pillar] [data-status]").allInnerTexts()).every((b) => b.trim() !== "Coming soon"));
  const runBadges = await page.locator("[data-pillar=run] [data-feature-id] [data-status]").allInnerTexts();
  check(`${tag} run pillar badges say Project Command Center`, runBadges.length >= 5 && runBadges.every((b) => b.trim() === "Project Command Center"), runBadges.join(","));
  const coreBadge = await page.locator("[data-feature-id=pipeline] [data-status]").innerText();
  check(`${tag} pipeline marked Included free`, coreBadge.trim() === "Included free", coreBadge);
  check(`${tag} no horizontal scroll`, await noHScroll(page));
  // Images: lazy, so scroll each into view and confirm they decoded.
  for (const img of await page.locator("[data-pillar] img").all()) await img.scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  const imgs = await page.locator("[data-pillar] img").evaluateAll((els) => els.map((e) => ({ ok: e.complete && e.naturalWidth > 0, alt: e.alt.length, loading: e.loading })));
  check(`${tag} 3 screenshots load with alt text`, imgs.length === 3 && imgs.every((i) => i.ok && i.alt > 40), JSON.stringify(imgs));
  check(`${tag} screenshots lazy-load`, imgs.every((i) => i.loading === "lazy"), JSON.stringify(imgs));
  const bodyText = await page.locator("body").innerText();
  check(`${tag} no outdated 'no project-management' claim`, !/project-management bloat/i.test(bodyText));
  check(`${tag} never claims reply monitoring`, !/reply monitoring active/i.test(bodyText));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(out, `home-hero__${vp.id}.png`) });
  await page.screenshot({ path: path.join(out, `home-full__${vp.id}.png`), fullPage: true });
  for (const p of ["win", "run", "grow"]) {
    await page.locator(`[data-pillar=${p}]`).scrollIntoViewIfNeeded();
    if (vp.id !== "m320") await page.locator(`[data-pillar=${p}]`).screenshot({ path: path.join(out, `home-pillar-${p}__${vp.id}.png`) });
  }
  if (vp.id === "desktop") await axe(page, tag);
  // V8: the secondary CTA shows the sample proposal; the pillar link still reaches Run the Job.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator("section").first().locator("[data-cta=sample]").click();
  await page.waitForTimeout(600);
  check(`${tag} See a sample proposal jumps to #sample-proposal`, new URL(page.url()).hash === "#sample-proposal" && await page.locator("#sample-proposal").isVisible(), page.url());
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByTestId("pillar-link-run").click();
  await page.waitForTimeout(600);
  check(`${tag} Run the Job pillar link jumps to #run-the-job`, new URL(page.url()).hash === "#run-the-job" && await page.locator("#run-the-job").isVisible(), page.url());
  // Primary CTA opens the trade picker for a new bid.
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.locator("section").first().locator("[data-cta=create]").click();
  await page.waitForURL((u) => u.pathname === "/bids", { timeout: 10000 }).catch(() => {});
  check(`${tag} Start Your 3 Free Bids -> /bids`, new URL(page.url()).pathname === "/bids", page.url());
  await ctx.close();
}

// ---------- Pricing, by account ----------
const PRICING = [
  { id: "signed-out", mock: "starter", auth: false, pmAction: "pm-plans" },
  { id: "free", mock: "starter", auth: true, pmAction: "pm-plans" },
  { id: "unlimited", mock: "unlimited", auth: true, pmAction: "pm-unlock" },
];
for (const sc of PRICING) {
  await scenario(sc.mock);
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.id === "desktop" ? 1 : 2 });
    if (sc.auth) await ctx.addCookies([authCookie]);
    const page = await ctx.newPage();
    await page.goto(BASE + "/pricing", { waitUntil: "networkidle" });
    await dismissOverlays(page);
    const tag = `pricing/${sc.id}/${vp.id}`;
    // Monthly and Annual share one Unlimited card with a switch (V8 MKT-4): the other schedule's price is one tap away.
    const text = await page.locator("main").textContent();
    for (const price of ["$19.99", "$149", "+$4.99", "+$49.99/year", "$49.99", "$1.99/month"]) check(`${tag} shows ${price}`, text.includes(price));
    check(`${tag} Enterprise still Contact us`, await page.getByRole("link", { name: "Contact us about Enterprise" }).isVisible());
    const pm = page.getByTestId("pm-addon-plan");
    check(`${tag} PCC section`, (await pm.locator("h2").innerText()) === "Project Command Center");
    const action = pm.locator(`[data-cta=${sc.pmAction}]`);
    check(`${tag} PCC action ${sc.pmAction}`, await action.isVisible());
    const href = await action.getAttribute("href");
    check(`${tag} PCC action href`, sc.pmAction === "pm-unlock" ? href === "/settings/billing#project-command-center" : href === "#plans", href);
    // V8: customer communications are live, so the PCC card lists no coming-soon items.
    check(`${tag} PCC lists no coming-soon items`, (await pm.locator("[data-status=soon]").count()) === 0);
    const groups = await page.locator("tr[data-group]").count();
    check(`${tag} comparison has 6 groups`, groups === 6, groups);
    for (const id of ["nurture", "scheduled_updates"]) {
      const cells = await page.locator(`tr[data-feature-id=${id}] td`).allInnerTexts();
      check(`${tag} ${id} row is a PCC add-on (live)`, cells.length === 3 && cells[1].trim().startsWith("Add-on") && !cells.some((c) => c.trim() === "Coming soon"), cells.join("|"));
    }
    const gantt = (await page.locator("tr[data-feature-id=gantt] td").allInnerTexts()).map((s) => s.trim());
    check(`${tag} Gantt row = Not included | Add-on | Included for 1 editor`, gantt.join("|") === "Not included|Add-on, $4.99/mo|Included for 1 editor", gantt.join("|"));
    const tmpl = (await page.locator("tr[data-feature-id=templates] td").allInnerTexts()).map((s) => s.trim());
    check(`${tag} Templates row`, tmpl.join("|") === "Not included|Included|Included", tmpl.join("|"));
    const editors = (await page.locator("tr[data-feature-id=pm_editors] td").allInnerTexts()).map((s) => s.trim());
    check(`${tag} PM editor seats row`, editors[2] === "1 included, extra $1.99/mo each", editors.join("|"));
    check(`${tag} no page-level horizontal scroll`, await noHScroll(page));
    await page.screenshot({ path: path.join(out, `pricing-full__${sc.id}__${vp.id}.png`), fullPage: true });
    if (sc.id === "signed-out") {
      await pm.scrollIntoViewIfNeeded();
      await pm.screenshot({ path: path.join(out, `pricing-pcc__${vp.id}.png`) });
      await page.getByRole("region", { name: "Plan comparison" }).screenshot({ path: path.join(out, `pricing-compare__${vp.id}.png`) });
      if (vp.id === "desktop") await axe(page, tag);
      // "Start with Unlimited" scrolls to the plan cards; it never opens checkout.
      await pm.locator("[data-cta=pm-plans]").click();
      await page.waitForTimeout(500);
      check(`${tag} Start with Unlimited -> #plans`, new URL(page.url()).hash === "#plans" && await page.locator("#plans").isVisible(), page.url());
    }
    await ctx.close();
  }
}

// ---------- In-app PM upgrade prompts ----------
await pmState({ scope: "individual", companyId: null, editorLimit: 0, editorsAssigned: 0, canEdit: false, source: null, editUntil: null, addon: false, addonUntil: null, extraEditors: 0 });
for (const [mock, kind, href] of [["starter", "free", "/pricing#project-command-center"], ["unlimited", "unlimited", "/settings/billing#project-command-center"]]) {
  await scenario(mock);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([authCookie]);
  const page = await ctx.newPage();
  await page.goto(BASE + "/projects", { waitUntil: "networkidle" });
  await dismissOverlays(page);
  const lock = page.getByTestId("pm-lock");
  check(`projects/${mock} lock kind`, (await lock.getAttribute("data-kind")) === kind, await lock.getAttribute("data-kind"));
  const link = lock.locator("a");
  check(`projects/${mock} lock link`, (await link.getAttribute("href")) === href, await link.getAttribute("href"));
  const t = await lock.innerText();
  check(`projects/${mock} lock copy`, kind === "free" ? /Start Unlimited/.test(t) && /\$19\.99\/month/.test(t) : /Unlock Project Command Center/.test(t) && /\$4\.99\/month/.test(t), t);
  await lock.screenshot({ path: path.join(out, `projects-lock__${kind}.png`) });
  if (kind === "unlimited") {
    await page.goto(BASE + "/settings/billing#project-command-center", { waitUntil: "networkidle" });
    await dismissOverlays(page);
    check("billing has #project-command-center anchor with the add-on card", await page.locator("#project-command-center [data-testid=pm-addon]").isVisible());
    await page.locator("#project-command-center").screenshot({ path: path.join(out, "billing-pcc__unlimited.png") });
  }
  await ctx.close();
}
await pmState(null);

// ---------- Internal links and anchors on public pages ----------
await scenario("starter");
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const seen = new Map();
  for (const p of ["/", "/pricing", "/bids/roofing"]) {
    await page.goto(BASE + p, { waitUntil: "networkidle" });
    const links = await page.locator("a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    for (const h of links) {
      if (!h || h.startsWith("mailto:") || h.startsWith("http")) continue;
      const url = new URL(h, BASE + p);
      if (url.hash && url.pathname === new URL(BASE + p).pathname) {
        check(`${p} anchor ${url.hash} exists`, await page.locator(url.hash).count() === 1);
        continue;
      }
      if (seen.has(url.pathname)) continue;
      const r = await fetch(BASE + url.pathname, { redirect: "manual" });
      seen.set(url.pathname, r.status);
      check(`${p} link ${url.pathname} -> ${r.status}`, r.status < 400);
    }
  }
  // Cross-page anchors used by the new copy.
  for (const [pg, hash] of [["/", "#run-the-job"], ["/", "#how-it-works"], ["/pricing", "#project-command-center"], ["/pricing", "#plans"], ["/pricing", "#enterprise"]]) {
    await page.goto(BASE + pg, { waitUntil: "networkidle" });
    check(`anchor ${pg}${hash} exists`, (await page.locator(hash).count()) === 1);
  }
  await ctx.close();
}

// ---------- SEO tags ----------
for (const p of ["/", "/pricing", "/bids/roofing"]) {
  const html = await (await fetch(BASE + p)).text();
  const meta = (n) => (html.match(new RegExp(`<meta[^>]+(?:name|property)="${n}"[^>]+content="([^"]*)"`)) ?? [])[1] ?? "";
  const title = (html.match(/<title>([^<]*)<\/title>/) ?? [])[1] ?? "";
  const canon = (html.match(/<link rel="canonical" href="([^"]+)"/) ?? [])[1] ?? "";
  check(`${p} title`, title.length > 10, title);
  check(`${p} description (${meta("description").length} chars)`, meta("description").length > 50, meta("description"));
  check(`${p} og:image`, meta("og:image").length > 0);
  check(`${p} canonical`, p === "/" || canon.endsWith(p), canon);
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => { try { JSON.parse(m[1]); return true; } catch { return false; } });
  check(`${p} JSON-LD parses`, ld.every(Boolean), ld.join(","));
  if (p === "/") check("/ description mentions scheduling", /schedul/i.test(meta("description")), meta("description"));
  if (p === "/pricing") check("/pricing description has PCC + Enterprise", /Project Command Center/.test(meta("description")) && /Enterprise: \$49\.99/.test(meta("description")), meta("description"));
}

await browser.close();
const failed = results.filter((r) => !r.ok);
fs.writeFileSync(path.join(out, "results.json"), JSON.stringify({ passed: results.length - failed.length, failed: failed.length, results }, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
