// Browser walk for the dashboard first-bid prompt and activation checklist (growth PR 1).
// Usage: mock Supabase (scripts/ux-audit/mock-supabase.mjs) on :54321, `next start` on :3000 built
// against it, then: node scripts/growth/activation-walk.mjs <screenshotDir>. Restart the mock between runs.
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const out = process.argv[2] ?? "activation-shots";
fs.mkdirSync(out, { recursive: true });
const BASE = "http://localhost:3000", MOCK = "http://localhost:54321";
const results = [];
const check = (n, ok, d = "") => { results.push({ n, ok: Boolean(ok) }); console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? " — " + d : ""}`); };
const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600 * 24 * 365 * 50, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };
const VIEWPORTS = [{ tag: "desktop", width: 1440, height: 900 }, { tag: "m390", width: 390, height: 844 }];

const browser = await chromium.launch();
async function shoot(state, fn) {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2 });
    await ctx.addCookies([authCookie]);
    // Keep the welcome popup out of the way: this account already saw it.
    await ctx.addInitScript(() => { try { localStorage.setItem("b2b:onboarding", JSON.stringify({ status: "completed", at: "2026-11-01", synced: true })); } catch { /* */ } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
    await fn(page, vp.tag);
    const scroll = (await page.getByTestId(state === "existing" ? "activation-checklist" : state === "new" ? "first-bid-start" : "activation-checklist").count()) ? (state === "new" ? "first-bid-start" : "activation-checklist") : null;
    if (scroll) await page.getByTestId(scroll).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${out}/${state}__${vp.tag}.png`, fullPage: vp.tag !== "desktop" ? false : false });
    await ctx.close();
  }
}

// 1. Existing customer with an exported bid and a company name: nothing new appears.
await shoot("existing", async (page, tag) => {
  check(`existing/${tag}: no first-bid prompt`, (await page.getByTestId("first-bid-start").count()) === 0);
  check(`existing/${tag}: no checklist once a bid is delivered`, (await page.getByTestId("activation-checklist").count()) === 0);
});

// 2. Brand-new account: one question, trade chips open a ready estimate.
await fetch(`${MOCK}/__activation?state=new`);
await shoot("new", async (page, tag) => {
  const card = page.getByTestId("first-bid-start");
  check(`new/${tag}: first-bid prompt shown`, await card.isVisible());
  check(`new/${tag}: asks what type of work`, /What type of work are you bidding\?/.test(await card.innerText()));
  const deck = card.getByRole("link", { name: /Decks/ });
  check(`new/${tag}: decks chip goes to /start/decks`, (await deck.getAttribute("href")) === "/start/decks");
  check(`new/${tag}: no checklist before the first bid`, (await page.getByTestId("activation-checklist").count()) === 0);
});

// 3. One priced draft, not exported: the checklist shows progress and the next step.
await fetch(`${MOCK}/__activation?state=partial`);
await shoot("partial", async (page, tag) => {
  const list = page.getByTestId("activation-checklist");
  check(`partial/${tag}: checklist shown`, await list.isVisible());
  const done = await list.locator("li[data-done=true]").count();
  check(`partial/${tag}: company, project and items done (3 of 5)`, done === 3, `done=${done}`);
  check(`partial/${tag}: next step links to the proposal preview`, (await list.getByRole("link", { name: "Preview" }).getAttribute("href"))?.endsWith("?step=proposal"));
});

// 4. Dismiss hides it and survives a reload (stored on the account).
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([authCookie]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Hide the first bid checklist" }).click();
  await page.waitForTimeout(500);
  check("dismiss: hidden right away", (await page.getByTestId("activation-checklist").count()) === 0);
  await page.reload({ waitUntil: "networkidle" });
  check("dismiss: stays hidden after reload", (await page.getByTestId("activation-checklist").count()) === 0);
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
fs.writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2));
process.exit(failed ? 1 : 0);
