// Academy monthly challenge screenshots against the mock Supabase (canned learner states, no real data):
//   MOCK_ADMIN=1 node scripts/ux-audit/mock-supabase.mjs &
//   NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=x SUPABASE_SECRET_KEY=x npm run build && npx next start -p 3000 &
//   node scripts/academy/challenge-shots.mjs <outDir>
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.env.BASE ?? "http://localhost:3000";
const MOCK = process.env.MOCK ?? "http://localhost:54321";
const out = process.argv[2] ?? "challenge-shots";
fs.mkdirSync(out, { recursive: true });
const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600 * 24 * 365 * 50, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); };
const state = (s) => fetch(`${MOCK}/__challenge?state=${s}`);
const VIEWPORTS = [{ id: "desktop", width: 1440, height: 900 }, { id: "m390", width: 390, height: 844 }];

const browser = await chromium.launch();
for (const vp of VIEWPORTS) {
  for (const dark of [false, true]) {
    if (dark && vp.id === "m390") continue;
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, colorScheme: dark ? "dark" : "light" });
    const anon = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2 });
    await ctx.addCookies([authCookie]);
    const page = await ctx.newPage();
    const tag = `${vp.id}${dark ? "-dark" : ""}`;
    const shot = async (name, p = page) => {
      const w = await p.evaluate(() => document.documentElement.scrollWidth);
      check(`${name}/${tag} no horizontal scroll`, w <= vp.width + 1, `scrollWidth ${w}`);
      await p.screenshot({ path: `${out}/${name}__${tag}.png`, fullPage: true });
    };

    if (!dark) {
      const a = await anon.newPage();
      await a.goto(`${BASE}/academy/challenge`, { waitUntil: "networkidle" });
      check(`signed-out/${tag} shows offer`, /Learn More\. Build Better\. Earn a Free Month\./.test(await a.locator("body").innerText()));
      await shot("challenge-signed-out", a);
    }

    for (const s of ["fresh", "progress", "earned"]) {
      await state(s);
      await page.goto(`${BASE}/academy/challenge`, { waitUntil: "networkidle" });
      const text = await page.locator("body").innerText();
      if (s === "earned") {
        check(`earned/${tag} says lifetime reward claimed`, /Earned: Lifetime Reward Claimed|free month is active/.test(text));
        check(`earned/${tag} does not offer another month`, !/Reward: 1 Free Month of Individual Unlimited/.test(text));
      } else {
        check(`${s}/${tag} offers the reward`, /Reward: 1 Free Month of Individual Unlimited/.test(text));
        check(`${s}/${tag} shows trainings counter`, new RegExp(`Trainings completed: ${s === "fresh" ? 0 : 2}/4`).test(text));
      }
      await shot(`challenge-${s}`);
    }

    // Quiz flow (progress state).
    await state("progress");
    await page.goto(`${BASE}/academy/challenge`, { waitUntil: "networkidle" });
    const topics = await page.locator('[data-testid="challenge-topic"] option').allInnerTexts();
    check(`quiz/${tag} only offers topics with 25+ questions`, !topics.includes("HVAC") && !topics.includes("Roofing") && topics.includes("Jobsite Safety (OSHA and EPA)"), topics.join(", "));
    await page.getByTestId("challenge-start").click();
    await page.getByTestId("challenge-quiz").waitFor();
    for (let i = 0; i < 20; i++) await page.locator('[data-testid="challenge-quiz"] fieldset').nth(i).locator("input").first().check();
    await shot("challenge-quiz");
    await page.getByTestId("challenge-submit").click();
    await page.getByTestId("challenge-result").waitFor();
    check(`quiz/${tag} shows congratulations`, /Congratulations! You earned 1 free month/.test(await page.locator("body").innerText()));
    await page.waitForTimeout(600);
    await shot("challenge-result");

    await state("progress");
    await page.goto(`${BASE}/academy/classroom`, { waitUntil: "networkidle" });
    check(`classroom/${tag} shows the compact card`, await page.getByTestId("challenge-card").isVisible());
    await page.getByTestId("challenge-card").screenshot({ path: `${out}/classroom-card__${tag}.png` });

    await state("earned");
    await page.goto(`${BASE}/settings/billing`, { waitUntil: "networkidle" });
    const billing = page.getByTestId("billing-academy-reward");
    check(`billing/${tag} shows reward history`, await billing.isVisible());
    if (await billing.isVisible()) await billing.screenshot({ path: `${out}/billing-reward__${tag}.png` });

    await page.goto(`${BASE}/admin/academy-rewards`, { waitUntil: "networkidle" });
    check(`admin/${tag} renders`, /Academy rewards/.test(await page.locator("h1").first().innerText().catch(() => "")));
    await shot("admin-academy-rewards");
    await ctx.close(); await anon.close();
  }
}
await browser.close();
fs.writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
