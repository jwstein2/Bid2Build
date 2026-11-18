// Browser walk for the Internal Estimate Report. Local build against the mock Supabase (fixture data, not production).
//   node scripts/ux-audit/mock-supabase.mjs &               -> free account:  node scripts/internal-report/walk.mjs <dir> free
//   MOCK_UNLIMITED=1 node scripts/ux-audit/mock-supabase.mjs & -> Unlimited:  node scripts/internal-report/walk.mjs <dir> paid
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const [dir = "ir-shots", mode = "paid"] = process.argv.slice(2);
fs.mkdirSync(dir, { recursive: true });
const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };
const EST = "11111111-1111-4111-8111-111111111111";
const out = []; const check = (n, c) => out.push(`${c ? "✓" : "✗"} ${n}`);
await fetch("http://localhost:54321/__onboarding?status=completed");
const browser = await chromium.launch();
for (const [label, vp] of [["desktop", { width: 1440, height: 900 }], ["m390", { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 });
  await ctx.addCookies([authCookie]);
  const page = await ctx.newPage();
  await page.goto(`http://localhost:3000/estimates/${EST}?step=estimate`, { waitUntil: "networkidle" });
  const btn = page.getByTestId("internal-report-open");
  // V8: on phones the report sits behind the header's "More" button.
  if (!(await btn.isVisible()) && (await page.getByTestId("builder-more").isVisible())) await page.getByTestId("builder-more").click();
  check(`${mode} ${label}: Internal report action on the estimate page`, await btn.isVisible());
  check(`${mode} ${label}: diamond ${mode === "free" ? "shown" : "hidden"}`, ((await btn.getAttribute("aria-label")).includes("Unlimited feature")) === (mode === "free")
    && (await btn.locator('[title="Unlimited feature"]').count()) === (mode === "free" ? 1 : 0));
  await btn.screenshot({ path: `${dir}/internal-report-button-${label}.png` });
  await btn.click();
  const dlg = page.getByTestId("internal-report-dialog");
  await dlg.waitFor();
  await page.waitForTimeout(500);
  if (mode === "free") {
    check(`free ${label}: upgrade explanation + Upgrade action, no report actions`, (await dlg.textContent()).includes("Internal Estimate Report is an Unlimited feature") && (await page.getByTestId("internal-report-download").count()) === 0);
    const r = await page.request.get(`http://localhost:3000/api/estimates/${EST}/internal-report?download=1`);
    check(`free ${label}: server refuses the PDF (402)`, r.status() === 402 && !(r.headers()["content-type"] ?? "").includes("pdf"));
    await page.screenshot({ path: `${dir}/internal-report-locked-${label}.png` });
  } else {
    check(`paid ${label}: Preview, Download, Send via My Email`, (await page.getByTestId("internal-report-preview").isVisible()) && (await page.getByTestId("internal-report-download").isVisible()) && (await page.getByTestId("internal-report-send").isVisible()));
    await page.screenshot({ path: `${dir}/internal-report-actions-${label}.png` });
    const r = await page.request.get(`http://localhost:3000/api/estimates/${EST}/internal-report?download=1`);
    const buf = await r.body();
    check(`paid ${label}: PDF downloads privately`, r.status() === 200 && r.headers()["content-type"] === "application/pdf" && buf.subarray(0, 5).toString() === "%PDF-" && /no-store/.test(r.headers()["cache-control"]));
    if (label === "desktop") fs.writeFileSync(`${dir}/internal-report-sample.pdf`, buf);
    await page.getByTestId("internal-report-send").click();
    const to = page.getByLabel(/Send to/);
    check(`paid ${label}: recipient starts empty (never the customer)`, (await to.inputValue()) === "");
    await to.fill("pat@example.test");
    check(`paid ${label}: outside-company warning requires confirmation`, (await page.getByTestId("outside-warning").isVisible()) && (await page.getByRole("button", { name: "Gmail" }).isDisabled()));
    await page.screenshot({ path: `${dir}/internal-report-send-warning-${label}.png` });
    await to.fill("crew@summit.test");
    check(`paid ${label}: same-domain teammate needs no extra confirmation`, (await page.getByTestId("outside-warning").count()) === 0 && !(await page.getByRole("button", { name: "Gmail" }).isDisabled()));
  }
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  check(`${mode} ${label}: no horizontal scroll (${sw})`, sw <= vp.width);
  await ctx.close();
}
await browser.close();
console.log(out.join("\n"));
const failed = out.filter((l) => l.startsWith("✗")).length;
console.log(`\n${out.length - failed}/${out.length} checks passed`);
process.exit(failed ? 1 : 0);
