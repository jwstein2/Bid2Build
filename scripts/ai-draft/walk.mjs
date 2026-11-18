// Browser walk for "Draft with AI" in the bid builder. The AI call is intercepted with a canned draft.
// Needs scripts/ux-audit/mock-supabase.mjs on :54321 and `next start` on :3000 built against it.
// Usage: node scripts/ai-draft/walk.mjs <outDir>
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.env.BASE ?? "http://localhost:3000";
const MOCK = process.env.MOCK ?? "http://localhost:54321";
const out = process.argv[2] ?? "ai-draft-shots";
fs.mkdirSync(out, { recursive: true });
const EST = "11111111-1111-4111-8111-111111111111";

const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600 * 24 * 365 * 50, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };

const L = (section, name, costType, quantity, unit, ballparkUnitCost, laborTrade = null, basis = "") => ({ section, name, description: "", costType, quantity, unit, laborTrade, ballparkUnitCost, basis });
const DRAFT = {
  trade: "siding",
  lines: [
    L("Tear-off & prep", "Remove existing siding", "labor_material", 18, "square", 65, null, "1,800 sq ft wall area"),
    L("Siding", "Vinyl siding, mid-range", "material", 20, "square", 120, null, "1,800 sq ft + 10% waste"),
    L("Siding", "House wrap", "material", 2, "roll", 180),
    L("Siding", "Siding installer labor", "labor", 48, "hour", null, "carpenter", "about 2.7 hrs per square"),
    L("Trim", "J-channel and corner posts", "material", 1, "lump sum", null),
    L("Disposal", "Dumpster rental (20 yd)", "equipment", 1, "each", 500),
  ],
  assumptions: ["Two-story house with about 1,800 sq ft of wall area"],
  questions: ["Keep the existing window trim?"],
  labor: { state: null, period: "May 2025", source: "BLS OEWS", wages: [{ trade: "carpenter", soc: "47-2031", wage: 28.51, area: "US" }] },
};

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
const shot = (page, name, full = false) => page.screenshot({ path: `${out}/${name}.png`, fullPage: full });
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

const browser = await chromium.launch();
await fetch(`${MOCK}/__scenario?name=unlimited`).catch(() => {});
for (const vp of [{ id: "desktop", width: 1440, height: 900 }, { id: "m390", width: 390, height: 844 }]) {
  const T = (n) => `[${vp.id}] ${n}`;
  await fetch(`${MOCK}/__reset_library`).catch(() => {});
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: vp.width < 768, isMobile: vp.width < 768 });
  await ctx.addCookies([authCookie]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let sent = null;
  await page.route("**/api/ai/bid-draft", async (r) => { sent = r.request().postDataJSON(); await r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(DRAFT) }); });

  await page.goto(`${BASE}/estimates/${EST}`, { waitUntil: "networkidle" });
  const step = page.locator('nav[aria-label="Builder steps"] button', { hasText: "Estimate" }).first();
  if (await step.count()) await step.click();
  const btn = page.getByRole("button", { name: "Draft with AI" });
  await btn.waitFor({ timeout: 15000 });
  check(T("Draft with AI button shows in the builder"), await btn.isEnabled());
  await btn.scrollIntoViewIfNeeded();
  await shot(page, `01-button__${vp.id}`);
  const wrapRows = () => page.locator("main").evaluate((m) => (m.innerText.match(/^House wrap$/gm) ?? []).length);
  const before = await wrapRows();

  await btn.click();
  await page.getByLabel("Describe the job").fill("Two-story house, replace all siding with mid-range vinyl, about 1,800 sq ft of walls. Remove old siding and haul away.");
  await shot(page, `02-form__${vp.id}`);
  await page.getByRole("button", { name: /^Draft/ }).last().click();
  await page.getByText("Fill gaps with AI ballpark prices").waitFor();
  check(T("request sends no prices or customer details"), sent && !JSON.stringify(sent).includes("Johnson") && !JSON.stringify(sent).includes("Oak Lane") && sent.trade === "siding", JSON.stringify(sent));
  const dlg = page.getByRole("dialog");
  const text = await dlg.innerText();
  check(T("saved item price is used for tear-off"), /Remove existing siding[\s\S]*Your price/.test(text));
  check(T("labor priced from the BLS wage"), /Local labor/.test(text) && /BLS/.test(text));
  check(T("AI guesses are labelled"), /AI guess — verify/.test(text));
  check(T("lines with no price say so"), /No price/.test(text));
  check(T("dialog has no horizontal scroll"), await noHScroll(page));
  await shot(page, `03-review__${vp.id}`);
  await dlg.evaluate((d) => { const s = d.querySelector("[class*=overflow-y]") ?? d; s.scrollTop = s.scrollHeight; });
  await shot(page, `04-review-bottom__${vp.id}`);

  await page.getByLabel("Include House wrap").uncheck();
  await page.getByRole("button", { name: /^Add \d+ items?/ }).click();
  await page.getByRole("button", { name: "Undo" }).waitFor();
  const body = await page.locator("main").innerText();
  check(T("drafted rows land in the bid"), /Vinyl siding, mid-range/.test(body) || (await page.locator('input[value="Vinyl siding, mid-range"]').count()) > 0);
  check(T("unticked row is not added"), (await wrapRows()) === before);
  await shot(page, `05-applied__${vp.id}`);
  await page.getByRole("button", { name: "Undo" }).click();
  await page.waitForTimeout(300);
  check(T("Undo removes the drafted rows"), (await page.locator('input[value="Vinyl siding, mid-range"]').count()) === 0);
  check(T("no page errors"), errors.length === 0, errors.join(" | "));
  await ctx.close();
}
await browser.close();
fs.writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
