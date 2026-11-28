// Academy Advanced browser checks + screenshots against the mock Supabase (canned states, no real data, no Stripe):
//   MOCK_ADVANCED=1 npx tsx scripts/ux-audit/mock-supabase.mjs &
//   NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=x SUPABASE_SECRET_KEY=x \
//     ACADEMY_ADVANCED_ENABLED=on ACADEMY_ADVANCED_BILLING_ENABLED=on STRIPE_SECRET_KEY=sk_test_mock npm run build && (same env) npx next start -p 3000 &
//   node scripts/academy/advanced/shots.mjs <outDir>
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.env.BASE ?? "http://localhost:3000";
const MOCK = process.env.MOCK ?? "http://localhost:54321";
const out = process.argv[2] ?? "advanced-shots";
fs.mkdirSync(out, { recursive: true });
const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600 * 24 * 365 * 50, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); };
const state = (s) => fetch(`${MOCK}/__advanced?state=${s}`);
const VIEWPORTS = [{ id: "desktop", width: 1440, height: 900 }, { id: "m390", width: 390, height: 844 }];
const QUOTE = { id: "11111111-2222-4333-8444-555555555555", kind: "new", plan: "two_subjects", subjects: [{ slug: "ai-for-contractors", title: "AI for Contractors" }, { slug: "business-management", title: "Contractor Business Management" }],
  amount_cents: 1499, stage: 1, expires_at: new Date(Date.now() + 35 * 60_000).toISOString(), due_now_cents: null, credit_cents: null, notes: [] };

const browser = await chromium.launch();
for (const vp of VIEWPORTS) {
  for (const dark of [false, true]) {
    if (dark && vp.id === "m390") continue;
    const tag = `${vp.id}${dark ? "-dark" : ""}`;
    const mk = async (signedIn) => {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, colorScheme: dark ? "dark" : "light" });
      if (signedIn) await ctx.addCookies([authCookie]);
      return ctx;
    };
    const shot = async (page, name) => page.screenshot({ path: `${out}/${tag}-${name}.png`, fullPage: true });
    const noOverflow = async (page, name) => {
      const w = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(`${tag} ${name}: no horizontal scroll`, w <= 1, `overflow ${w}px`);
    };

    // Visitor: section in Classroom, hub, subject page, free preview lesson, locked lesson.
    await state("visitor");
    const anon = await mk(false);
    let p = await anon.newPage();
    await p.goto(`${BASE}/academy/classroom`, { waitUntil: "networkidle" });
    const sec = p.getByTestId("advanced-section");
    check(`${tag} classroom shows Advanced Learning`, await sec.count() > 0);
    if (await sec.count()) {
      const order = await p.evaluate(() => { const a = document.querySelector('[data-testid="advanced-section"]'); const t = [...document.querySelectorAll("h2")].find((h) => /Browse by trade/i.test(h.textContent ?? "")); return a && t ? Boolean(a.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING) : null; });
      check(`${tag} Advanced Learning sits before the trade directory`, order === true, String(order));
      await sec.screenshot({ path: `${out}/${tag}-classroom-section.png` });
    }
    await p.goto(`${BASE}/academy/advanced`, { waitUntil: "networkidle" });
    check(`${tag} hub lists two open subjects`, (await p.locator('[data-testid="subject-card"][data-status="open"]').count()) === 2);
    check(`${tag} hub lists upcoming subjects`, (await p.locator('[data-testid="subject-card"][data-status="upcoming"]').count()) >= 8);
    await noOverflow(p, "hub"); await shot(p, "hub");
    await p.goto(`${BASE}/academy/advanced/ai-for-contractors`, { waitUntil: "networkidle" });
    check(`${tag} visitor sees three options`, (await p.locator('[data-testid^="plan-"]:not([data-testid="plan-picker"]):not([data-testid="plan-confirm"])').count()) === 3);
    check(`${tag} Learn + expand is recommended`, (await p.getByTestId("plan-two_subjects").getByText("Recommended").count()) === 1);
    check(`${tag} visitor is asked to sign in`, (await p.getByText("Sign in to choose").count()) === 3);
    const pageText = await p.textContent("body");
    check(`${tag} prices are stage 1`, ["$9.99", "$14.99", "$29.99"].every((x) => pageText.includes(x)));
    await noOverflow(p, "subject"); await shot(p, "subject-visitor");
    await p.goto(`${BASE}/academy/courses/advanced-ai-for-contractors/understanding-ai-in-construction`, { waitUntil: "networkidle" });
    check(`${tag} free preview lesson opens`, (await p.getByText("What you'll learn").count()) > 0);
    await shot(p, "lesson-preview");
    await p.goto(`${BASE}/academy/courses/advanced-ai-for-contractors/writing-better-ai-prompts`, { waitUntil: "networkidle" });
    const locked = await p.textContent("body");
    check(`${tag} paid lesson is locked with the offer`, (await p.getByTestId("plan-picker").count()) === 1 && !locked.includes("### "), "");
    await shot(p, "lesson-locked");
    await anon.close();

    // Signed-in free member: choose → review and confirm (quote API intercepted; no Stripe).
    await state("free");
    const ctx = await mk(true);
    p = await ctx.newPage();
    await p.route("**/api/academy/advanced/quote", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ quote: QUOTE }) }));
    await p.goto(`${BASE}/academy/advanced/ai-for-contractors`, { waitUntil: "networkidle" });
    check(`${tag} member sees Choose buttons`, (await p.getByTestId("choose-two_subjects").count()) === 1);
    await shot(p, "subject-member");
    await p.getByTestId("choose-two_subjects").click();
    await p.getByTestId("plan-confirm").waitFor();
    check(`${tag} confirm shows quoted price`, (await p.getByTestId("quote-amount").textContent()).includes("$14.99"));
    check(`${tag} confirm states non-refundable months and founding rate`, /aren.t refunded/.test(await p.textContent("body")) && /Founding-member rate/.test(await p.textContent("body")));
    await noOverflow(p, "confirm"); await shot(p, "confirm");

    // One-subject member opening the other subject: upgrade options only.
    await state("one");
    await p.goto(`${BASE}/academy/advanced/ai-for-contractors`, { waitUntil: "networkidle" });
    check(`${tag} one-subject member sees upgrade to two + All Access`, (await p.getByTestId("choose-two_subjects").count()) === 1 && (await p.getByTestId("choose-one_subject").count()) === 0 && (await p.getByTestId("choose-all_access").count()) === 1);
    await shot(p, "subject-upgrade");

    // All Access member: membership page + lesson opens.
    await state("aa");
    await p.goto(`${BASE}/academy/advanced/membership`, { waitUntil: "networkidle" });
    check(`${tag} membership page shows All Access`, /All Access/.test(await p.textContent("body")));
    await noOverflow(p, "membership"); await shot(p, "membership");
    await p.goto(`${BASE}/academy/courses/advanced-ai-for-contractors/writing-better-ai-prompts`, { waitUntil: "networkidle" });
    check(`${tag} All Access opens paid lessons`, (await p.getByTestId("plan-picker").count()) === 0);
    await shot(p, "lesson-member");

    // Academy admin dashboard.
    await state("staff");
    await p.goto(`${BASE}/academy/manage/advanced`, { waitUntil: "networkidle" });
    check(`${tag} admin dashboard renders`, (await p.getByTestId("adv-admin").count()) === 1);
    check(`${tag} admin sees stage recommendation`, (await p.getByTestId("stage-recommendation").count()) === 1);
    await noOverflow(p, "admin"); await shot(p, "admin");
    await ctx.close();
  }
}
await browser.close();
const failed = results.filter((r) => !r.ok);
fs.writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
