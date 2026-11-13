// UX audit capture: screenshots + horizontal-overflow detection across viewports.
// Usage: node scripts/ux-audit/capture.mjs <outDir> [routeFilter]
// Needs `next start` on :3000 built against the mock Supabase (scripts/ux-audit/mock-supabase.mjs on :54321).
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE ?? "http://localhost:3000";
const out = process.argv[2] ?? "ux-shots";
const filter = process.argv[3] ? new RegExp(process.argv[3]) : null;
const WIDTHS = (process.env.WIDTHS ?? "320,375,390,430,768,1024,1440").split(",").map(Number);
const LANDSCAPE = [[667, 375], [844, 390]];
const EST = "11111111-1111-4111-8111-111111111111";

const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600 * 24 * 365 * 50, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };

const ROUTES = [
  { id: "home", path: "/", auth: false },
  { id: "trades", path: "/bids", auth: false },
  { id: "trade-siding", path: "/bids/siding", auth: false },
  { id: "pricing", path: "/pricing", auth: false },
  { id: "learn", path: "/learn", auth: false },
  { id: "learn-article", path: "/learn/markup-vs-margin", auth: false },
  { id: "login", path: "/login", auth: false },
  { id: "privacy", path: "/privacy", auth: false },
  { id: "terms", path: "/terms", auth: false },
  { id: "not-found", path: "/nope-404", auth: false },
  { id: "builder-anon-company", path: "/start/siding", auth: false },
  { id: "dashboard", path: "/dashboard", auth: true },
  { id: "customers", path: "/dashboard/customers", auth: true },
  { id: "items", path: "/dashboard/items", auth: true },
  { id: "templates", path: "/dashboard/templates", auth: true },
  { id: "company", path: "/settings/company", auth: true },
  { id: "billing", path: "/settings/billing", auth: true },
  { id: "pricing-data", path: "/settings/pricing", auth: true },
  { id: "account", path: "/settings/account", auth: true },
  { id: "estimate", path: `/estimates/${EST}`, auth: true },
  { id: "estimate-proposal", path: `/estimates/${EST}?step=proposal`, auth: true },
  { id: "admin", path: "/admin", auth: true },
];

const overflowProbe = () => {
  const vw = document.documentElement.clientWidth;
  const scrollW = document.documentElement.scrollWidth;
  const offenders = [];
  const clipped = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const s = getComputedStyle(p); if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) return true; } return false; };
  for (const el of document.body.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.right <= vw + 1 || clipped(el)) continue;
    if (getComputedStyle(el).position === "fixed") continue;
    const kids = [...el.children].some((c) => c.getBoundingClientRect().right > vw + 1);
    if (kids) continue;
    offenders.push({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 90), text: (el.textContent ?? "").trim().slice(0, 50), right: Math.round(r.right) });
  }
  // touch targets: visible interactive elements smaller than 24px (WCAG 2.2 minimum) and 44px (recommended)
  const small = [];
  for (const el of document.querySelectorAll("a,button,input,select,textarea,[role=button]")) {
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    if (el.closest("p,li") && el.tagName === "A" && !el.className) continue; // inline text links
    if (r.height < 24 || r.width < 24) small.push({ tag: el.tagName.toLowerCase(), label: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40), w: Math.round(r.width), h: Math.round(r.height) });
  }
  return { vw, scrollW, overflow: scrollW > vw + 1, offenders: offenders.slice(0, 8), small: small.slice(0, 12) };
};

const browser = await chromium.launch();
fs.mkdirSync(out, { recursive: true });
const report = [];
const viewports = [...WIDTHS.map((w) => [w, w < 768 ? 800 : 900]), ...(process.env.NO_LANDSCAPE ? [] : LANDSCAPE)];
for (const r of ROUTES) {
  if (filter && !filter.test(r.id)) continue;
  for (const [w, h] of viewports) {
    const landscape = LANDSCAPE.some(([a, b]) => a === w && b === h);
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: w < 768 || landscape, isMobile: w < 768 || landscape });
    if (r.auth) await ctx.addCookies([authCookie]);
    const page = await ctx.newPage();
    let status = 0;
    try {
      const resp = await page.goto(BASE + r.path, { waitUntil: "networkidle", timeout: 30000 });
      status = resp?.status() ?? 0;
      await page.waitForTimeout(400);
    } catch { status = -1; }
    const probe = await page.evaluate(overflowProbe).catch(() => ({ overflow: null }));
    const file = `${r.id}__${w}x${h}${landscape ? "-landscape" : ""}.jpg`;
    await page.screenshot({ path: path.join(out, file), fullPage: !landscape, type: "jpeg", quality: 60 }).catch(() => {});
    report.push({ route: r.path, id: r.id, auth: r.auth, viewport: `${w}x${h}`, landscape, status, finalUrl: page.url().replace(BASE, ""), file, ...probe });
    process.stdout.write(`${r.id} ${w}x${h} ${status} overflow=${probe.overflow}${probe.overflow ? ` (${probe.scrollW}>${probe.vw})` : ""}\n`);
    await ctx.close();
  }
}
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
await browser.close();
