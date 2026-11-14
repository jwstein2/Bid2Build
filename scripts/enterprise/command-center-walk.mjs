// Enterprise browser walk. Needs `next start` on :3000 built against scripts/ux-audit/mock-supabase.mjs, with
// SUPABASE_SECRET_KEY=mock and dummy STRIPE_SECRET_KEY=sk_test_* + STRIPE_PRICE_* (Enterprise ones included). Stripe is never contacted.
// Usage: node scripts/enterprise/<file> <screenshotDir>
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };
await import("node:fs").then((fs) => fs.mkdirSync(process.argv[2] ?? "enterprise-shots", { recursive: true }));
const out = []; const check = (n, c) => out.push(`${c ? "✓" : "✗"} ${n}`);
const scenario = (n) => fetch(`http://localhost:54321/__scenario?name=${n}`);
const browser = await chromium.launch();
const dir = process.argv[2] ?? "enterprise-shots";
for (const [label, vp] of [["desktop", { width: 1280, height: 900 }], ["m390", { width: 390, height: 844 }], ["m320", { width: 320, height: 720 }]]) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 });
  await ctx.addCookies([authCookie]);
  const calls = [];
  await ctx.route("**/api/company/pipeline", async (r) => {
    const b = JSON.parse(r.request().postData()); calls.push(b);
    if (b.action === "stage" && b.stage === "sent") return r.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: { code: "approval_required", message: "This bid needs approval before it can be marked Sent." } }) });
    return r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
  });
  const page = await ctx.newPage();
  const noScroll = async (n) => { const sw = await page.evaluate(() => document.documentElement.scrollWidth); check(`${label}: ${n} no horizontal scroll (${sw})`, sw <= vp.width); };
  await scenario("enterprise_owner");

  // Overview
  await page.goto("http://localhost:3000/company");
  const kpis = await page.getByTestId("kpis").textContent();
  check(`${label}: overview KPIs (win rate, won value, margin)`, kpis.includes("100%") && kpis.includes("$4,200") && kpis.includes("29.8%"));
  check(`${label}: awaiting review notice`, (await page.textContent("body")).includes("1 bid waiting for review"));
  check(`${label}: seven stage bars`, (await page.getByTestId("stage-bars").locator("li").count()) === 7);
  check(`${label}: team table lists members`, (await page.getByTestId("team-table").textContent()).includes("Casey Estimator"));
  check(`${label}: owner sees approval toggle`, (await page.getByTestId("approval-toggle").count()) === 1);
  await noScroll("overview");
  await page.screenshot({ path: `${dir}/company-overview-${label}.png`, fullPage: true });
  await page.getByTestId("approval-toggle").check();
  await page.waitForTimeout(300);
  check(`${label}: approval toggle posts rule`, calls.at(-1)?.action === "approval_rule" && calls.at(-1)?.required === true);
  if (vp.width < 1024) await page.getByRole("button", { name: "Menu" }).click();
  check(`${label}: nav has Overview + Bids & Pipeline`, (await page.getByRole("link", { name: "Overview" }).first().isVisible()) && (await page.getByRole("link", { name: "Bids & Pipeline" }).first().isVisible()));
  check(`${label}: only Overview marked current`, (await page.locator('a[aria-current="page"]').count()) === 1);
  if (vp.width < 1024) await page.getByRole("button", { name: "Close" }).first().click();

  // Pipeline
  await page.goto("http://localhost:3000/company/pipeline?stage=won&range=all");
  check(`${label}: pipeline rows`, (await page.getByTestId("pipeline-row").count()) === 3);
  check(`${label}: stage filter kept in form`, (await page.locator("#pf-stage").inputValue()) === "won");
  check(`${label}: csv link carries filters`, (await page.getByTestId("csv-export").getAttribute("href")).includes("stage=won") && (await page.getByTestId("csv-export").getAttribute("href")).includes("range=all"));
  check(`${label}: margin shown for owner`, (await page.textContent("body")).includes("31.5% margin"));
  await noScroll("pipeline");
  await page.screenshot({ path: `${dir}/company-pipeline-${label}.png`, fullPage: true });
  const first = page.getByTestId("pipeline-row").first();
  await first.locator("select").selectOption("approved");
  await first.getByLabel("Note (optional)").fill("Nice work");
  await first.getByRole("button", { name: "Save" }).click();
  await first.getByRole("status").waitFor();
  check(`${label}: stage change posted with note`, calls.at(-1)?.stage === "approved" && calls.at(-1)?.note === "Nice work" && calls.at(-1)?.estimateId?.endsWith("0001"));
  const third = page.getByTestId("pipeline-row").nth(2);
  await third.locator("select").selectOption("sent");
  await third.getByRole("button", { name: "Save" }).click();
  await third.getByRole("alert").waitFor();
  check(`${label}: approval-required error shown`, (await third.getByRole("alert").textContent()).includes("needs approval"));
  await third.locator("select").selectOption("lost");
  check(`${label}: lost asks why`, await third.getByLabel(/Why was it lost/).isVisible());

  // CSV endpoint returns a file
  const res = await page.request.get("http://localhost:3000/api/company/pipeline/export?range=all");
  const body = await res.text();
  check(`${label}: csv download`, res.status() === 200 && res.headers()["content-type"].startsWith("text/csv") && body.startsWith("Bid #,Title") && body.includes("Hillside re-side"));

  // Review page
  await page.goto("http://localhost:3000/company/bids/77777777-7777-4777-8777-000000000001");
  check(`${label}: review shows totals + margin`, (await page.getByTestId("review-totals").textContent()).includes("31.5%"));
  check(`${label}: review history with note`, (await page.getByTestId("review-history").textContent()).includes("Ready when you are"));
  check(`${label}: teammate bid has no editor link`, (await page.getByRole("link", { name: "Open in editor" }).count()) === 0);
  await noScroll("review");
  await page.screenshot({ path: `${dir}/company-review-${label}.png`, fullPage: true });

  // Estimator: no analytics, own bids only, no margin
  await scenario("enterprise_estimator");
  await page.goto("http://localhost:3000/company");
  check(`${label}: estimator overview explains access`, (await page.textContent("body")).includes("Analytics aren't part of your access"));
  await page.goto("http://localhost:3000/company/pipeline");
  const est = await page.textContent("body");
  check(`${label}: estimator pipeline without margin or estimator filter`, !est.includes("% margin") && (await page.locator("#pf-user").count()) === 0);
  await ctx.close();
}
await scenario("starter");
await browser.close();
console.log(out.join("\n"));
process.exit(out.some((l) => l.startsWith("✗")) ? 1 : 0);
