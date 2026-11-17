// Browser walk for growth PR 5 (/admin/marketing creatives, Creator Partners, payback; /admin/operations lifecycle tools).
// Local build against the mock Supabase with the fake command-center seed (NOT production):
//   MOCK_COMMAND_CENTER=1 MOCK_ADMIN=1 node scripts/ux-audit/mock-supabase.mjs &
//   (build + `next start` against the mock on :54321)
//   node scripts/growth/dashboard-walk.mjs <screenshotDir>
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const dir = process.argv[2] ?? "growth-dashboard-shots";
fs.mkdirSync(dir, { recursive: true });
const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };
const out = []; const check = (n, c) => out.push(`${c ? "✓" : "✗"} ${n}`);
const A = "http://localhost:3000";
const browser = await chromium.launch();
const errors = [];
async function open(path, vp = { width: 1440, height: 1000 }) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
  await ctx.addCookies([authCookie]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  const res = await page.goto(`${A}${path}`, { waitUntil: "load" });
  await page.waitForTimeout(1200);
  return { ctx, page, status: res?.status() };
}

for (const [name, vp] of [["desktop", { width: 1440, height: 1000 }], ["m390", { width: 390, height: 844 }]]) {
  const { ctx, page, status } = await open("/admin/marketing?range=90d", vp);
  check(`${name}: marketing loads`, status === 200);
  const body = await page.locator("main").innerText();
  check(`${name}: channel table has 7-day activated + payback`, /7-day activated/i.test(body) && /Payback/i.test(body));
  check(`${name}: Creator Partners channel row`, /Creator Partners/.test(body));
  const creatives = page.locator("#creatives");
  check(`${name}: creative section`, (await creatives.count()) > 0);
  check(`${name}: creatives listed`, /a-overtime-v1/.test(body) && /b-homeowner-v2/.test(body));
  check(`${name}: creator row`, /deckguy/.test(body) && /Complimentary \(not paid\)/i.test(body));
  check(`${name}: trade conversion section`, /Trade-level conversion/i.test(body));
  check(`${name}: no horizontal page scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.locator("#creatives").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${dir}/marketing-creatives__${name}.png`, fullPage: false });
  await page.locator("#creators").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${dir}/marketing-creators__${name}.png`, fullPage: false });
  await ctx.close();
}
{
  const { ctx, page, status } = await open("/admin/marketing?range=90d&creative=a-overtime-v1");
  check("creative filter applies", status === 200 && (await page.getByText("Filtered funnel").count()) > 0);
  await ctx.close();
}
{
  const { ctx, page, status } = await open("/admin/marketing?range=90d&trade=roofing&plan=paid");
  check("trade + plan filters apply", status === 200 && (await page.getByText("Filtered funnel").count()) > 0);
  await page.locator("#trades").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${dir}/marketing-trades__desktop.png` });
  await ctx.close();
}
{
  const { ctx, page, status } = await open("/admin/operations");
  check("operations loads", status === 200);
  const t = await page.locator("main").innerText();
  check("lifecycle row + tools", /Lifecycle emails sent \(30 days\)/.test(t) && /Preview lifecycle emails due now/.test(t) && /Send me the 5 samples/.test(t));
  check("integrations list lifecycle (off)", /Lifecycle emails A–E/.test(t));
  await page.getByText("Background email").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${dir}/operations-email__desktop.png` });
  await ctx.close();
}
await browser.close();
check("no page errors", errors.length === 0);
console.log(out.join("\n"));
if (errors.length) console.log(errors.slice(0, 5).join("\n"));
process.exitCode = out.some((l) => l.startsWith("✗")) ? 1 : 0;
