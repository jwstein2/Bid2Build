// V8 batch 5 walk: Saved Items for free accounts (cap, kept on upgrade, stacks still Unlimited) and the
// Enterprise -> Team display rename. Before the SQL runs (/__freeitems?off=1) free accounts keep today's lock.
// Needs scripts/ux-audit/mock-supabase.mjs on :54321 and `next start` on :3000 built against it.
// Usage: node scripts/marketing/v8-batch5-walk.mjs <outDir>
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const AXE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const BASE = process.env.BASE ?? "http://localhost:3000";
const MOCK = process.env.MOCK ?? "http://localhost:54321";
const out = process.argv[2] ?? "v8-batch5-shots";
fs.mkdirSync(out, { recursive: true });

const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString(), created_at: new Date(Date.now() - 30 * 86400000).toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600 * 24 * 365 * 50, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };
const noPopup = () => { try { localStorage.setItem("b2b:onboarding", JSON.stringify({ status: "dismissed", at: new Date().toISOString(), synced: true })); } catch { /* */ } };

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 300) }); console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` ${detail}`}`); };
const mock = (q) => fetch(`${MOCK}${q}`).then((r) => r.json());
async function axe(page, tag, selector) {
  await page.addScriptTag({ content: AXE });
  const r = await page.evaluate(async (sel) => (await window.axe.run(sel ? document.querySelector(sel) : document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.map((v) => `${v.id}(${v.nodes.length})`), selector);
  check(`${tag} axe wcag2a/aa violations = 0`, r.length === 0, r.join(", "));
}

const browser = await chromium.launch();
async function page({ signedIn = true, width = 1280 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
  if (signedIn) await ctx.addCookies([authCookie]);
  await ctx.addInitScript(noPopup);
  return { ctx, p: await ctx.newPage() };
}
const api = (p, body) => p.evaluate(async (b) => {
  const r = b ? await fetch("/api/library", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }) : await fetch("/api/library", { cache: "no-store" });
  return { status: r.status, body: await r.json().catch(() => null) };
}, body);
const item = (name) => ({ id: crypto.randomUUID(), name, costType: "labor", treatment: "marked_up", unit: "each", unitCost: "45", taxable: false });
const noOverflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// 1. Free account, SQL run: Saved Items work; stacks and favorites stay Unlimited.
await mock("/__scenario?name=starter"); await mock("/__freeitems");
{
  const { ctx, p } = await page();
  await p.goto(`${BASE}/dashboard/items`, { waitUntil: "networkidle" });
  check("free: Saved Items page opens (not locked)", await p.getByTestId("free-items-note").isVisible());
  const note = await p.getByTestId("free-items-note").innerText();
  check("free: says up to 250 and kept when you upgrade", /250/.test(note) && /stay with you when you upgrade to Unlimited/.test(note), note);
  check("free: New Saved Item available", await p.getByRole("button", { name: "New Saved Item" }).isVisible());
  check("free: stacks locked with Unlimited panel", await p.getByText(/Saved Stacks, favorites and supplier price lists are an Unlimited feature/).isVisible());
  check("free: no favorite stars", (await p.getByTestId("fav-toggle").count()) === 0);
  await p.screenshot({ path: `${out}/items-free__d1280.png`, fullPage: true });
  await axe(p, "free items page");
  const add = await api(p, { kind: "item", action: "add", payload: item("Drywall hang") });
  check("free: API saves an item", add.status === 200, JSON.stringify(add));
  const stack = await api(p, { kind: "stack", action: "add", payload: { id: crypto.randomUUID(), name: "Stack", trade: null, items: [{ ...item("Row"), quantity: "1" }] } });
  check("free: API refuses a stack (402) with kept-on-upgrade wording", stack.status === 402 && /stay with you when you upgrade/.test(stack.body?.error?.message ?? ""), JSON.stringify(stack));
  const fav = await api(p, { kind: "item", action: "favorite", payload: { id: add.status === 200 ? crypto.randomUUID() : crypto.randomUUID(), on: true } });
  check("free: API refuses favorites (402)", fav.status === 402, JSON.stringify(fav));
  const got = await api(p);
  check("free: library returns items with itemsAccess, no stacks", got.body?.itemsAccess === true && got.body?.access === false && Array.isArray(got.body?.items) && got.body.stacks.length === 0, JSON.stringify(got.body).slice(0, 200));
  await p.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  check("free: dashboard tile says Saved Items are free and kept", await p.getByTestId("items-free-tile").isVisible() && /stay with you when you upgrade/.test(await p.getByTestId("items-free-tile").innerText()));
  await ctx.close();
  const m = await page({ width: 390 });
  await m.p.goto(`${BASE}/dashboard/items`, { waitUntil: "networkidle" });
  const of = await noOverflow(m.p);
  check("free items page 390: no sideways scroll", of <= 0, `${of}px`);
  await m.p.screenshot({ path: `${out}/items-free__m390.png`, fullPage: true });
  await m.ctx.close();
}

// 2. Before the SQL runs: today's behaviour (locked, writes refused).
await mock("/__freeitems?off=1");
{
  const { ctx, p } = await page();
  await p.goto(`${BASE}/dashboard/items`, { waitUntil: "networkidle" });
  check("SQL not run: Saved Items stay locked for free", (await p.getByTestId("free-items-note").count()) === 0 && await p.getByText(/Saved Items & Pricing is an Unlimited feature/).isVisible());
  const add = await api(p, { kind: "item", action: "add", payload: item("Nope") });
  check("SQL not run: API refuses item (402)", add.status === 402, JSON.stringify(add));
  await ctx.close();
}
await mock("/__freeitems");

// 3. Unlimited: full library, no free note.
await mock("/__scenario?name=unlimited");
{
  const { ctx, p } = await page();
  await p.goto(`${BASE}/dashboard/items`, { waitUntil: "networkidle" });
  check("unlimited: full library with stacks, no free note", (await p.getByTestId("free-items-note").count()) === 0 && await p.getByRole("heading", { name: "Saved Stacks" }).isVisible());
  await ctx.close();
}

// 4. Team rename on public pages and billing.
await mock("/__scenario?name=starter");
{
  const { ctx, p } = await page({ signedIn: false });
  for (const path of ["/pricing", "/"]) {
    await p.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    const text = await p.locator("main").innerText();
    check(`${path}: no "Enterprise" shown`, !/\bEnterprise\b/.test(text), (text.match(/.{0,40}Enterprise.{0,40}/) ?? [""])[0]);
    if (path === "/pricing") {
      check("/pricing: Team card and Team section", (await p.getByRole("heading", { name: "Team", exact: true }).count()) >= 2);
      check("/pricing: Free card lists saved items kept on upgrade", /Save up to 250 of your own items, kept when you upgrade/.test(text));
      check("/pricing: comparison cell for free Saved Items", /Up to 250 items, kept when you upgrade/.test(text));
      check("/pricing: description says Team", /Team: \$49\.99/.test(await p.locator('meta[name="description"]').getAttribute("content")));
      await p.locator("#plans").screenshot({ path: `${out}/pricing-team__d1280.png` });
    }
  }
  await ctx.close();
}
await mock("/__scenario?name=enterprise_estimator");
{
  const { ctx, p } = await page();
  await p.goto(`${BASE}/settings/billing`, { waitUntil: "networkidle" });
  const text = await p.locator("main").innerText();
  check("company estimator billing says Team plan", /Team plan/.test(text) && !/\bEnterprise\b/.test(text), (text.match(/.{0,40}(Team|Enterprise).{0,40}/) ?? [""])[0]);
  await ctx.close();
}
await mock("/__scenario?name=starter");

await browser.close();
fs.writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
