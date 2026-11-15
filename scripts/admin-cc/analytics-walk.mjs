// Browser walk for V4 Phase 10 owner analytics (Revenue by product, pipeline / report / scheduling adoption).
// Local build against the mock Supabase with the clearly fake command-center seed (NOT production):
//   MOCK_COMMAND_CENTER=1 MOCK_ADMIN=1 node scripts/ux-audit/mock-supabase.mjs &
//   (build + `next start` against the mock on :54321)
//   node scripts/admin-cc/analytics-walk.mjs <screenshotDir>
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const dir = process.argv[2] ?? "admin-analytics-shots";
fs.mkdirSync(dir, { recursive: true });
const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };
const out = []; const check = (n, c) => out.push(`${c ? "✓" : "✗"} ${n}`);
const A = "http://localhost:3000";
const dollars = (s) => (String(s).match(/\$[\d,]+(\.\d+)?/g) ?? []).map((x) => Number(x.replace(/[$,]/g, "")));

const browser = await chromium.launch();
const errors = [];
async function open(path, vp = { width: 1440, height: 1000 }) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 });
  await ctx.addCookies([authCookie]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  const res = await page.goto(`${A}${path}`, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  return { ctx, page, status: res?.status() };
}

{
  const { ctx, page, status } = await open("/admin/revenue?range=30d");
  check("revenue page loads", status === 200);
  const panel = page.locator("#by-product");
  await panel.scrollIntoViewIfNeeded();
  const text = await panel.innerText();
  check("split shows core, add-on, editor and total rows", /Core subscriptions/.test(text) && /Project scheduling add-on/.test(text) && /Enterprise scheduling editors/.test(text) && /Total recurring revenue/.test(text));
  const total = dollars(await page.getByTestId("total-mrr").innerText())[0];
  const kpi = await page.locator(".cc-panel", { hasText: "MRR (list price)" }).first().innerText();
  check("total recurring revenue equals the headline MRR", dollars(kpi)[0] === total);
  check("headline notes the scheduling add-ons it includes", /incl\. \$[\d,.]+ scheduling add-ons/.test(kpi));
  check("seeded add-ons: 2 add-on subs and 2 editor seats", /\b2\b/.test(text) && /2 seats/.test(text));
  check("add-on cancellations shown separately", /Add-ons ending at period end/.test(text));
  await panel.screenshot({ path: `${dir}/01-revenue-by-product.png` });
  await page.screenshot({ path: `${dir}/02-revenue-page.png`, fullPage: true });
  await ctx.close();
}
{
  const { ctx, page, status } = await open("/admin/usage?range=30d");
  check("usage page loads", status === 200);
  const sec = page.getByTestId("product-adoption");
  await sec.scrollIntoViewIfNeeded();
  const t = await sec.textContent(); // innerText applies the labels' uppercase styling
  check("adoption KPIs: pipeline, reports, scheduling, updates", /Accounts using the pipeline/.test(t) && /Internal reports generated/.test(t) && /Premium report adoption/.test(t) && /Scheduled projects/.test(t) && /Customer updates published/.test(t) && /Scheduling subscriptions/.test(t));
  const body = await page.locator("body").innerText();
  check("bids-by-stage table shown", /Bids by stage, now/.test(body) && /Won/.test(body));
  check("no dollar amounts in the adoption KPIs", !/\$\d/.test(t));
  await page.locator("#v4").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${dir}/03-usage-adoption.png` });
  await ctx.close();
}
{
  const { ctx, page } = await open("/admin/revenue?range=30d", { width: 390, height: 844 });
  check("revenue fits a phone (no sideways scroll)", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.locator("#by-product").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${dir}/04-revenue-mobile.png` });
  await ctx.close();
}
check("no page errors", errors.length === 0);
await browser.close();
console.log(out.join("\n"));
if (errors.length) console.log(errors.slice(0, 5).join("\n"));
process.exit(out.some((l) => l.startsWith("✗")) ? 1 : 0);
