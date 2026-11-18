// Demo Mode outside the signed-in layout: the DEMO MODE bar shows on the trade picker, start page and
// estimate builder, and a stale hint without a demo session shows nothing. Mock Supabase (see walk.mjs).
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const dir = process.argv[2] ?? "demo-shots";
fs.mkdirSync(dir, { recursive: true });
const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user };
const cookies = (hint) => [{ name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" }, ...(hint ? [{ name: "b2b-demo-hint", value: "owner_demo", domain: "localhost", path: "/" }] : [])];
const M = "http://localhost:54321", A = "http://localhost:3000";
const results = [];
const check = (n, ok, d = "") => { results.push({ n, ok: Boolean(ok) }); console.log(`${ok ? "✓" : "✗"} ${n}${d && !ok ? ` — ${d}` : ""}`); };
await fetch(`${M}/__onboarding?status=completed`);
await fetch(`${M}/__scenario?name=unlimited`);
const browser = await chromium.launch();
async function visit(path, { demo, hint, name }) {
  await fetch(`${M}/__demo${demo ? "?kind=owner_demo" : ""}`);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
  await ctx.addCookies(cookies(hint));
  const page = await ctx.newPage();
  await page.goto(`${A}${path}`, { waitUntil: "load" });
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(500);
  const n = await page.getByTestId("demo-banner").count();
  if (name) await page.screenshot({ path: `${dir}/${name}.png` });
  const hintLeft = (await ctx.cookies()).some((c) => c.name === "b2b-demo-hint");
  await ctx.close();
  return { n, hintLeft };
}
for (const [path, name] of [["/bids", "20-demo-trade-picker"], ["/start/decks", null], ["/estimates/11111111-1111-4111-8111-111111111111", "21-demo-builder"]]) {
  const r = await visit(path, { demo: true, hint: true, name });
  check(`DEMO MODE bar on ${path}`, r.n === 1, `${r.n} bars`);
}
const dash = await visit("/dashboard", { demo: true, hint: true });
check("exactly one bar inside the signed-in app", dash.n === 1, `${dash.n}`);
const stale = await visit("/estimates/11111111-1111-4111-8111-111111111111", { demo: false, hint: true });
check("stale hint without a demo session shows no bar and is cleared", stale.n === 0 && !stale.hintLeft, JSON.stringify(stale));
await browser.close();
await fetch(`${M}/__demo`);
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
