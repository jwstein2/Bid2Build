// Platform audit crawler: discovers pages by following links from seed routes, then for each page
//   1. loads it at 1440 / 768 / 390 (Light) and 1440 / 390 (Dark) and records status, redirects, console
//      errors, failed requests, horizontal overflow, small touch targets and axe violations, with screenshots;
//   2. checks every internal link target (HTTP status, as this role);
//   3. clicks every button / tab / menu trigger / select as a user would, with a before and after
//      screenshot, and records what happened (navigation, dialog, state change, request, error, nothing).
// Runs against `next start` + the mock Supabase (scripts/ux-audit/mock-supabase.mjs). NOT production.
//   ROLE=contractor node scripts/platform-audit/crawl.mjs <outDir>
// Env: ROLE (label), AUTH=0 for signed out, SEEDS=comma list, MAX_PAGES, CLICK=0 to skip clicks, SKIP_THEMES=1.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const AXE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const BASE = process.env.BASE ?? "http://localhost:3000";
const ROLE = process.env.ROLE ?? "contractor";
const OUT = path.resolve(process.argv[2] ?? `audit-${ROLE}`);
const AUTH = process.env.AUTH !== "0";
const MAX_PAGES = Number(process.env.MAX_PAGES ?? 80);
const MAX_CLICKS = Number(process.env.MAX_CLICKS ?? 40);
const CLICK = process.env.CLICK !== "0";
const SEEDS = (process.env.SEEDS ?? "/dashboard").split(",").filter(Boolean);
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null; // only crawl paths matching
const DENY = /\/(auth\/callback|auth\/signout|logout|api\/)/;
// Never clicked even on the mock: ends the session or would send/delete if pointed at a real backend.
const SKIP = /sign ?out|log ?out|delete|remove|revoke|deactivate|archive|send|e-?mail (it|proposal|update)|publish|disconnect|discard|cancel (subscription|plan|grant)|reset|pay now|transfer/i;

for (const d of ["pages", "clicks"]) fs.mkdirSync(path.join(OUT, d), { recursive: true });

const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600 * 24 * 365 * 50, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };

const slug = (s) => s.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 60) || "home";
const pattern = (p) => p.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id").replace(/\/[A-Za-z0-9_-]{24,}(?=\/|$)/g, "/:token");
const norm = (href) => { try { const u = new URL(href, BASE); if (u.origin !== new URL(BASE).origin) return null; return u.pathname + u.search; } catch { return null; } };

const probe = () => {
  const vw = document.documentElement.clientWidth, sw = document.documentElement.scrollWidth;
  const offenders = [];
  if (sw > vw + 1) {
    const clipped = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(p).overflowX)) return true; return false; };
    for (const el of document.body.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (!r.width || r.right <= vw + 1 || clipped(el) || getComputedStyle(el).position === "fixed") continue;
      if ([...el.children].some((c) => c.getBoundingClientRect().right > vw + 1)) continue;
      offenders.push(`${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 40)}" right=${Math.round(r.right)}`);
      if (offenders.length > 5) break;
    }
  }
  const small = [];
  for (const el of document.querySelectorAll("a,button,input:not([type=hidden]),select,[role=button],[role=tab]")) {
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    if (el.tagName === "A" && el.closest("p,li,td") && !el.className) continue;
    if (r.height < 24 || r.width < 24) small.push(`${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  return { vw, sw, overflow: sw > vw + 1, offenders, small: small.slice(0, 10), smallCount: small.length, title: document.title, h1: document.querySelector("h1")?.textContent?.trim().slice(0, 80) ?? null };
};

const browser = await chromium.launch();
async function newCtx(vp, theme) {
  const mobile = vp.width < 768;
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  if (AUTH) await ctx.addCookies([authCookie]);
  await ctx.addInitScript((t) => { try { localStorage.setItem("b2b-theme", JSON.stringify({ mode: t, at: Date.now() })); localStorage.setItem("b2b-welcome-dismissed", "1"); } catch {} }, theme);
  return ctx;
}
function watch(page) {
  const log = { console: [], failed: [], requests: [] };
  page.on("console", (m) => { if (m.type() === "error") log.console.push(m.text().slice(0, 300)); });
  page.on("pageerror", (e) => log.console.push(`pageerror: ${e.message.slice(0, 300)}`));
  page.on("requestfailed", (r) => { if (!/_next\/static|favicon|google|stripe\.com|sentry|_rsc=/.test(r.url()) && r.failure()?.errorText !== "net::ERR_ABORTED") log.failed.push(`${r.method()} ${r.url().replace(BASE, "")} ${r.failure()?.errorText}`); });
  page.on("response", (r) => {
    const u = r.url(); if (!u.startsWith(BASE) || /_next\/static/.test(u)) return;
    if (r.status() >= 400) log.failed.push(`${r.request().method()} ${u.replace(BASE, "")} → ${r.status()}`);
    if (r.request().method() !== "GET") log.requests.push(`${r.request().method()} ${u.replace(BASE, "")} → ${r.status()}`);
  });
  return log;
}

// ---------------- Phase 1: discover + page sweep ----------------
const queue = [...SEEDS]; const seen = new Set(); const pages = []; const linkTargets = new Map(); const external = new Map();
const VIEWS = [
  { tag: "1440-light", vp: { width: 1440, height: 900 }, theme: "light", primary: true },
  { tag: "768-light", vp: { width: 768, height: 1000 }, theme: "light" },
  { tag: "390-light", vp: { width: 390, height: 844 }, theme: "light" },
  ...(process.env.SKIP_THEMES ? [] : [{ tag: "1440-dark", vp: { width: 1440, height: 900 }, theme: "dark" }, { tag: "390-dark", vp: { width: 390, height: 844 }, theme: "dark" }]),
];
const ctxs = {}; for (const v of VIEWS) ctxs[v.tag] = await newCtx(v.vp, v.theme);

while (queue.length && pages.length < MAX_PAGES) {
  const p = queue.shift(); const pat = pattern(p.split("?")[0]) + (p.includes("?") ? "?" + p.split("?")[1].split("&").map((kv) => kv.split("=")[0]).sort().join("&") : "");
  if (seen.has(pat) || DENY.test(p)) continue; seen.add(pat);
  if (ONLY && !ONLY.test(p)) continue;
  const rec = { path: p, pattern: pat, id: slug(p), views: {} };
  await Promise.all(VIEWS.map(async (v) => {
    const page = await ctxs[v.tag].newPage(); const log = watch(page);
    let status = 0;
    try { const r = await page.goto(BASE + p, { waitUntil: "load", timeout: 30000 }); status = r?.status() ?? 0; await page.waitForLoadState("networkidle", { timeout: 2500 }).catch(() => {}); await page.waitForTimeout(300); } catch (e) { status = -1; log.console.push(`goto: ${e.message.slice(0, 120)}`); }
    const pr = await page.evaluate(probe).catch(() => ({}));
    let axe = null;
    if (v.tag === "1440-light" || v.tag === "1440-dark") {
      axe = await page.evaluate(async (src) => { if (!window.axe) eval(src); const r = await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa"], resultTypes: ["violations"] }); return r.violations.map((x) => ({ id: x.id, impact: x.impact, n: x.nodes.length, help: x.help, sample: x.nodes.slice(0, 2).map((n) => n.target.join(" ")) })); }, AXE).catch((e) => [{ id: "axe-error", help: e.message.slice(0, 100) }]);
    }
    const file = `pages/${rec.id}__${v.tag}.jpg`;
    await page.screenshot({ path: path.join(OUT, file), fullPage: true, type: "jpeg", quality: 55 }).catch(() => {});
    rec.views[v.tag] = { status, finalUrl: page.url().replace(BASE, ""), file, console: log.console, failed: log.failed, ...pr, axe };
    if (v.primary) {
      const links = await page.$$eval("a[href]", (as) => as.filter((a) => a.offsetParent !== null || a.getClientRects().length).map((a) => ({ href: a.getAttribute("href"), text: (a.getAttribute("aria-label") || a.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60) }))).catch(() => []);
      rec.links = links;
      for (const l of links) {
        const n = norm(l.href);
        if (!n) { if (/^https?:/.test(l.href)) external.set(l.href, l.text); continue; }
        if (n.startsWith("/#") || l.href.startsWith("#")) continue;
        if (!linkTargets.has(n.split("#")[0])) linkTargets.set(n.split("#")[0], { from: p, text: l.text });
        queue.push(n.split("#")[0]);
      }
    }
    await page.close();
  }));
  pages.push(rec);
  const v = rec.views["1440-light"];
  console.log(`[page] ${p} ${v.status} → ${v.finalUrl} console=${v.console.length} failed=${v.failed.length} axe=${v.axe?.length ?? "-"}`);
}

// ---------------- Phase 2: link targets ----------------
const linkCtx = await newCtx({ width: 1280, height: 800 }, "light");
const links = [];
for (const [href, info] of linkTargets) {
  if (DENY.test(href)) continue;
  let status = 0, final = "";
  try { const r = await linkCtx.request.get(BASE + href, { maxRedirects: 0, timeout: 20000 }); status = r.status(); final = r.headers().location ?? ""; } catch (e) { status = -1; final = e.message.slice(0, 80); }
  links.push({ href, status, location: final.replace(BASE, ""), from: info.from, text: info.text });
}

// ---------------- Phase 3: click-through ----------------
const clicks = [];
if (CLICK) {
  const ctx = await newCtx({ width: 1280, height: 800 }, "light");
  const SEL = "button:not([disabled]), [role=tab], [role=button]:not(a), select:not([disabled]), summary, input[type=checkbox]:not([disabled]), [role=switch], [role=combobox]";
  for (const rec of pages) {
    const v = rec.views["1440-light"];
    if (v.status >= 400 || v.status <= 0 || pattern(v.finalUrl.split("?")[0]) !== pattern(rec.path.split("?")[0])) continue; // redirected/blocked pages: no clicks
    let page = await ctx.newPage(); let log = watch(page);
    const load = async () => { await page.goto(BASE + rec.path, { waitUntil: "load", timeout: 30000 }).catch(() => {}); await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {}); await page.waitForTimeout(300); };
    await load();
    const list = await page.$$eval(SEL, (els) => els.map((el, i) => {
      const r = el.getBoundingClientRect(); const st = getComputedStyle(el);
      const label = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("title") || el.getAttribute("name") || "").trim().replace(/\s+/g, " ").slice(0, 60);
      return { i, label, tag: el.tagName.toLowerCase(), role: el.getAttribute("role"), type: el.getAttribute("type"), visible: r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none", inNav: Boolean(el.closest("header,nav,#account-nav,footer")) };
    })).catch(() => []);
    // Shared chrome (header/nav/footer) is clicked once per role, on the first page only.
    const targets = list.filter((x) => x.visible && (rec === pages[0] || !x.inNav)).slice(0, MAX_CLICKS);
    let n = 0;
    for (const t of targets) {
      n++;
      const name = `${rec.id}__${String(n).padStart(2, "0")}-${slug(t.label || t.tag).slice(0, 30)}`;
      const row = { page: rec.path, element: t.label || `(${t.tag} without label)`, tag: t.tag, role: t.role };
      if (SKIP.test(t.label)) { clicks.push({ ...row, result: "skipped", note: "Destructive / outbound action: not clicked; checked in code instead." }); continue; }
      if (page.url().replace(BASE, "") !== rec.path || await page.locator("[role=dialog]:visible, [role=menu]:visible, [role=alertdialog]:visible").count()) { await page.keyboard.press("Escape").catch(() => {}); await page.waitForTimeout(300); if (page.url().replace(BASE, "") !== rec.path || await page.locator("[role=dialog]:visible, [role=menu]:visible").count()) await load(); }
      const el = page.locator(SEL).nth(t.i);
      const label = await el.evaluate((e) => (e.getAttribute("aria-label") || e.textContent || e.getAttribute("title") || e.getAttribute("name") || "").trim().replace(/\s+/g, " ").slice(0, 60)).catch(() => null);
      if (label === null || label !== t.label) { await load(); }
      const el2 = page.locator(SEL).nth(t.i);
      if (!(await el2.isVisible().catch(() => false))) { clicks.push({ ...row, result: "not-reachable", note: "Element hidden after reload (inside a collapsed area or rendered conditionally)." }); continue; }
      const c0 = log.console.length, f0 = log.failed.length, r0 = log.requests.length;
      const before = await page.evaluate(() => ({ url: location.pathname + location.search, len: document.body.innerText.length, dialogs: document.querySelectorAll("[role=dialog],[role=menu],[role=listbox],[role=alertdialog]").length })).catch(() => ({}));
      const aria0 = await el2.evaluate((e) => [e.getAttribute("aria-expanded"), e.getAttribute("aria-selected"), e.getAttribute("aria-pressed"), e.getAttribute("aria-checked"), e.checked ?? null, e.value ?? null].join("|")).catch(() => "");
      await el2.scrollIntoViewIfNeeded().catch(() => {});
      await el2.evaluate((e) => { e.style.outline = "3px solid #ff2d55"; e.style.outlineOffset = "2px"; }).catch(() => {});
      await page.screenshot({ path: path.join(OUT, `clicks/${name}__before.jpg`), type: "jpeg", quality: 45 }).catch(() => {});
      await el2.evaluate((e) => { e.style.outline = ""; e.style.outlineOffset = ""; }).catch(() => {});
      let err = null;
      try {
        if (t.tag === "select") {
          const opts = await el2.evaluate((s) => [...s.options].filter((o) => !o.disabled).map((o) => o.value));
          const cur = await el2.inputValue(); const next = opts.find((o) => o !== cur);
          if (next !== undefined) await el2.selectOption(next); else err = "only one option";
        } else await el2.click({ timeout: 4000 });
      } catch (e) { err = e.message.split("\n")[0].slice(0, 140); }
      await page.waitForTimeout(900);
      await page.waitForLoadState("networkidle", { timeout: 1500 }).catch(() => {});
      const after = await page.evaluate(() => ({ url: location.pathname + location.search, len: document.body.innerText.length, dialogs: document.querySelectorAll("[role=dialog],[role=menu],[role=listbox],[role=alertdialog]").length, toast: [...document.querySelectorAll("[role=status],[role=alert]")].map((x) => x.textContent.trim()).filter(Boolean).join(" | ").slice(0, 160) })).catch(() => ({}));
      const aria1 = await page.locator(SEL).nth(t.i).evaluate((e) => [e.getAttribute("aria-expanded"), e.getAttribute("aria-selected"), e.getAttribute("aria-pressed"), e.getAttribute("aria-checked"), e.checked ?? null, e.value ?? null].join("|")).catch(() => "gone");
      await page.screenshot({ path: path.join(OUT, `clicks/${name}__after.jpg`), type: "jpeg", quality: 45 }).catch(() => {});
      const consoleNew = log.console.slice(c0), failedNew = log.failed.slice(f0), reqNew = log.requests.slice(r0);
      const effects = [];
      if (after.url && after.url !== before.url) effects.push(`navigated to ${after.url}`);
      if (after.dialogs > before.dialogs) effects.push("opened dialog/menu");
      if (aria1 !== aria0) effects.push("control state changed");
      if (reqNew.length) effects.push(`requests: ${reqNew.join(", ").slice(0, 160)}`);
      if (after.toast) effects.push(`message: ${after.toast}`);
      if (Math.abs((after.len ?? 0) - (before.len ?? 0)) > 15 && !effects.length) effects.push("page content changed");
      const serverErr = failedNew.some((f) => /→ 5\d\d/.test(f));
      const result = err ? "error" : serverErr || consoleNew.some((c) => c.startsWith("pageerror")) ? "fail" : effects.length ? "pass" : "no-visible-effect";
      clicks.push({ ...row, result, effects, error: err, console: consoleNew, failed: failedNew, before: `clicks/${name}__before.jpg`, after: `clicks/${name}__after.jpg` });
    }
    await page.close();
    console.log(`[clicks] ${rec.path} ${targets.length} controls`);
  }
}

fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ role: ROLE, auth: AUTH, generatedAt: new Date().toISOString(), pages, links, external: [...external].map(([href, text]) => ({ href, text })), clicks }, null, 2));
await browser.close();
const tally = clicks.reduce((m, c) => ({ ...m, [c.result]: (m[c.result] ?? 0) + 1 }), {});
console.log(`\n${ROLE}: ${pages.length} pages, ${links.length} link targets (${links.filter((l) => l.status >= 400 || l.status < 0).length} broken), clicks ${JSON.stringify(tally)}`);
