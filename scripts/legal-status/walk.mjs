// Legal Documentation Status walk: notice on every legal page, footer link, /legal, compact notices at
// sign-in and pricing, owner dashboard, no horizontal overflow, accessible names. Local only.
// Usage: mock Supabase on :54321 (MOCK_ADMIN=1 node scripts/ux-audit/mock-supabase.mjs), `next start` on :3000,
// then: node scripts/legal-status/walk.mjs [outDir]
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.env.BASE ?? "http://localhost:3000";
if (!/^http:\/\/(localhost|127\.0\.0\.1)/.test(BASE)) throw new Error("Local only");
const out = process.argv[2] ?? "legal-shots";
fs.mkdirSync(out, { recursive: true });

const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify({ access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 1e9, expires_at: 4102444800, user }))}`, domain: "localhost", path: "/" };

const LEGAL = ["/terms", "/privacy", "/cookies", "/referral-terms", "/trial-terms", "/academy-terms", "/esign-disclosure", "/security"];
const VIEWPORTS = { desktop: { width: 1440, height: 900 }, m390: { width: 390, height: 844 }, m320: { width: 320, height: 700 } };
let failures = 0;
const results = [];
const check = (ok, msg) => { results.push({ ok, msg }); console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`); if (!ok) failures++; };
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const browser = await chromium.launch();
for (const [vp, viewport] of Object.entries(VIEWPORTS)) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  for (const p of LEGAL) {
    await page.goto(BASE + p);
    const notices = page.getByTestId("legal-status-notice");
    check(await notices.count() === 1, `${vp} ${p}: exactly one status notice`);
    const text = (await notices.first().innerText()).replace(/\s+/g, " ");
    check(/Current Published Version/.test(text) && /Legal review pending/i.test(text), `${vp} ${p}: badge says Current Published Version · Legal review pending`);
    check(text.includes("pending review by independent legal counsel"), `${vp} ${p}: approved disclosure present`);
    check(await page.getByRole("region", { name: "Document status" }).count() === 1, `${vp} ${p}: notice is a labelled region`);
    const h1Box = await page.locator("h1").first().boundingBox(), nBox = await notices.first().boundingBox();
    check(h1Box && nBox && nBox.y > h1Box.y, `${vp} ${p}: notice sits below the title`);
    check(await overflow(page) <= 0, `${vp} ${p}: no horizontal overflow`);
    if (p === "/terms" || p === "/privacy") await page.screenshot({ path: path.join(out, `${p.slice(1)}__${vp}.png`), fullPage: false });
  }

  await page.goto(BASE + "/legal");
  check(await page.getByRole("heading", { level: 1, name: "Legal Document Status" }).isVisible(), `${vp} /legal: heading`);
  check(await page.locator('[data-testid^="legal-doc-"]').count() === 12, `${vp} /legal: 12 documents listed`);
  check(await page.getByText("Current Published Version — Legal Review Pending").first().isVisible(), `${vp} /legal: primary status line`);
  check(await overflow(page) <= 0, `${vp} /legal: no horizontal overflow`);
  await page.screenshot({ path: path.join(out, `legal__${vp}.png`), fullPage: vp === "desktop" });
  const footerLink = page.locator("footer").getByRole("link", { name: "Legal Document Status" });
  check(await footerLink.count() === 1, `${vp} footer: Legal Document Status link`);

  for (const p of ["/terms", "/privacy", "/cookies", "/esign-disclosure", "/security", "/legal", "/referral-terms", "/trial-terms", "/academy-terms"]) {
    const r = await page.request.get(BASE + p);
    check(r.status() === 200, `${vp} link ${p} returns 200`);
  }

  await page.goto(BASE + "/pricing");
  check(await page.getByTestId("legal-status-compact").count() === 1, `${vp} /pricing: one compact notice`);
  check(await page.getByTestId("pricing-no-contracts").isVisible(), `${vp} /pricing: cancellation/refund disclosure still shown`);
  check(await overflow(page) <= 0, `${vp} /pricing: no horizontal overflow`);
  await page.getByTestId("legal-status-compact").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(out, `pricing-compact__${vp}.png`) });

  await page.goto(BASE + "/login");
  const compact = page.getByTestId("legal-status-compact");
  await compact.first().waitFor({ timeout: 10000 }).catch(() => {});
  check(await compact.count() >= 1, `${vp} /login: compact notice shown`);
  check(await page.getByText(/By continuing you agree to the/).first().isVisible(), `${vp} /login: agreement statement unchanged and visible`);
  const btn = page.getByRole("button", { name: /continue|send|code/i }).first();
  check(await btn.isVisible(), `${vp} /login: sign-in button visible (not covered)`);
  check(await overflow(page) <= 0, `${vp} /login: no horizontal overflow`);
  await page.screenshot({ path: path.join(out, `login__${vp}.png`) });

  // Owner dashboard (mock admin).
  await ctx.addCookies([authCookie]);
  await page.goto(BASE + "/admin/legal");
  await page.getByRole("heading", { level: 1, name: "Legal documents" }).waitFor({ timeout: 15000 }).catch(() => {});
  check(await page.getByRole("heading", { level: 1, name: "Legal documents" }).isVisible(), `${vp} /admin/legal: heading`);
  const counts = (await page.getByTestId("legal-counts").innerText()).replace(/\s+/g, " ");
  check(/Documents identified 12/.test(counts) && /Pending review 12/.test(counts) && /Reviewed 0/.test(counts), `${vp} /admin/legal: 12 identified, 12 pending, 0 reviewed`);
  await page.screenshot({ path: path.join(out, `admin-legal__${vp}.png`), fullPage: vp === "desktop" });

  await page.goto(BASE + "/settings/billing");
  check(await page.getByTestId("legal-status-compact").count() <= 1, `${vp} /settings/billing: at most one compact notice`);

  check(errors.length === 0, `${vp}: no page errors${errors.length ? ` (${errors.slice(0, 2).join(" | ")})` : ""}`);
  await ctx.close();
}

// Print to PDF (how a visitor saves a legal page): notice is included.
{
  const page = await (await browser.newContext()).newPage();
  await page.goto(BASE + "/terms");
  await page.emulateMedia({ media: "print" });
  check(await page.getByTestId("legal-status-notice").isVisible(), "print: status notice prints with the Terms");
  await page.pdf({ path: path.join(out, "terms-print.pdf"), format: "Letter" });
  check(fs.statSync(path.join(out, "terms-print.pdf")).size > 10000, "print: Terms PDF renders");
}

await browser.close();
fs.writeFileSync(path.join(out, "results.json"), JSON.stringify(results, null, 2));
console.log(`\n${results.length - failures}/${results.length} checks passed`);
process.exit(failures ? 1 : 0);
