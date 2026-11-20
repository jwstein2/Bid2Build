// Team pricing "Build Your Team" walk: licensed users + schedule editors counters, totals, limits, info
// toggles, mobile overflow, and that checkout receives both counts. Same setup as pricing-walk.mjs
// (next start on :3000 with mock Supabase, dummy sk_test_ key, STRIPE_PRICE_* incl. STRIPE_PRICE_PM_EDITOR,
// NEXT_PUBLIC_PROJECT_SCHEDULING=on). Stripe is never contacted. Usage: node scripts/enterprise/team-builder-walk.mjs <shotDir>
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const dir = process.argv[2] ?? "team-builder-shots";
fs.mkdirSync(dir, { recursive: true });
const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };
const out = [];
const check = (n, c, extra = "") => out.push(`${c ? "✓" : "✗"} ${n}${extra ? ` (${extra})` : ""}`);

const CASES = [[3, 1, "$49.99"], [4, 1, "$69.98"], [5, 3, "$93.95"], [6, 1, "$107.96"], [10, 10, "$197.83"], [11, 1, "$195.91"]];
const browser = await chromium.launch();

async function setTo(card, which, target) {
  const input = card.getByRole("spinbutton", { name: which === "users" ? "Licensed users" : "Schedule editors", exact: true });
  const more = card.getByRole("button", { name: which === "users" ? "More users" : "More schedule editors" });
  const less = card.getByRole("button", { name: which === "users" ? "Fewer users" : "Fewer schedule editors" });
  for (let i = 0; i < 40; i++) {
    const v = Number(await input.inputValue());
    if (v === target) return;
    await (v < target ? more : less).click();
  }
}

for (const [label, vp, scale] of [["desktop", { width: 1440, height: 900 }, 2], ["m430", { width: 430, height: 932 }, 2], ["m390", { width: 390, height: 844 }, 2], ["m360", { width: 360, height: 780 }, 2], ["m320", { width: 320, height: 640 }, 2]]) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: scale });
  await ctx.addInitScript(() => { try { localStorage.setItem("b2b:onboarding", JSON.stringify({ done: true })); } catch {} });
  const page = await ctx.newPage();
  await page.goto("http://localhost:3000/pricing#enterprise", { waitUntil: "networkidle" });
  await page.addStyleTag({ content: "header{position:static!important}" }); // keep the sticky header out of element shots
  const card = page.getByTestId("enterprise-plan");
  const total = card.getByTestId("enterprise-total");
  const users = card.getByRole("spinbutton", { name: "Licensed users", exact: true });
  const editors = card.getByRole("spinbutton", { name: "Schedule editors", exact: true });
  check(`${label}: starts at 3 users / 1 editor / $49.99`, (await users.inputValue()) === "3" && (await editors.inputValue()) === "1" && (await total.innerText()).includes("$49.99"));
  check(`${label}: users minus disabled at 3`, await card.getByRole("button", { name: "Fewer users" }).isDisabled());
  check(`${label}: editors minus disabled at 1`, await card.getByRole("button", { name: "Fewer schedule editors" }).isDisabled());
  check(`${label}: editors plus disabled when editors = users`, await (async () => { await setTo(card, "editors", 3); return card.getByRole("button", { name: "More schedule editors" }).isDisabled(); })());
  await setTo(card, "editors", 1);
  for (const [u, e, want] of CASES) {
    await setTo(card, "users", u); await setTo(card, "editors", e);
    const got = await total.innerText();
    check(`${label}: ${u} users, ${e} editors = ${want}`, got.includes(want), got);
  }
  // Lowering users below editors pulls editors down.
  await setTo(card, "users", 6); await setTo(card, "editors", 6); await setTo(card, "users", 4);
  check(`${label}: users 6→4 with 6 editors drops editors to 4`, (await editors.inputValue()) === "4");
  // Typed value above max is clamped.
  await editors.fill("9");
  check(`${label}: typing 9 editors with 4 users clamps to 4`, (await editors.inputValue()) === "4");
  await setTo(card, "users", 5); await setTo(card, "editors", 3);
  check(`${label}: spec example lines`, (await card.getByTestId("team-line-users").innerText()).includes("2 × $19.99") && (await card.getByTestId("team-line-users").innerText()).includes("$39.98") && (await card.getByTestId("team-line-editors").innerText()).includes("2 × $1.99") && (await card.getByTestId("team-line-editors").innerText()).includes("$3.98"));
  await users.fill("200");
  const [tb, qb] = [await total.boundingBox(), await card.getByTestId("enterprise-quote").boundingBox()];
  check(`${label}: total fits inside the breakdown at 200 users`, tb.x + tb.width <= qb.x + qb.width + 0.5, `${(await total.innerText())}`);
  await users.fill("5"); await setTo(card, "editors", 3);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`${label}: no horizontal overflow`, overflow <= 0, `${overflow}px`);
  const tap = await card.getByRole("button", { name: "More schedule editors" }).boundingBox();
  check(`${label}: plus/minus at least 44px`, tap.width >= 44 && tap.height >= 44, `${tap.width}x${tap.height}`);
  await card.getByTestId("team-builder").screenshot({ path: `${dir}/${label}-builder.png` });
  // Info toggles.
  for (const q of ["What is a licensed user?", "What is a schedule editor?"]) {
    const b = card.getByRole("button", { name: q });
    await b.click();
    check(`${label}: "${q}" opens`, (await b.getAttribute("aria-expanded")) === "true");
  }
  await card.getByText("Do I need to purchase both?").click();
  check(`${label}: "Do I need to purchase both?" opens`, await card.getByText("Additional team members require a user license.").isVisible());
  await card.getByTestId("team-builder").screenshot({ path: `${dir}/${label}-builder-info.png` });
  if (label === "desktop" || label === "m390") await card.screenshot({ path: `${dir}/${label}-full-card.png` });
  await ctx.close();
}

// Signed in: checkout receives the calculator's users AND editors.
for (const [label, vp] of [["desktop", { width: 1280, height: 900 }], ["m390", { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
  await ctx.addCookies([authCookie]);
  await ctx.addInitScript(() => { try { localStorage.setItem("b2b:onboarding", JSON.stringify({ done: true })); } catch {} });
  let sent = null;
  await ctx.route("**/api/stripe/enterprise-checkout", async (r) => { sent = JSON.parse(r.request().postData()); r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ url: "https://checkout.stripe.test/x", plan: "enterprise" }) }); });
  await ctx.route("https://checkout.stripe.test/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<h1 id=stripe>Mock Stripe</h1>" }));
  const page = await ctx.newPage();
  await page.goto("http://localhost:3000/pricing#enterprise", { waitUntil: "networkidle" });
  const card = page.getByTestId("enterprise-plan");
  await setTo(card, "users", 5); await setTo(card, "editors", 3);
  const cta = card.getByRole("button", { name: /Get Team|Continue to checkout/ });
  if (!(await cta.count())) { check(`${label} signed-in: checkout button present`, false, (await card.innerText()).slice(-400)); await ctx.close(); continue; }
  await cta.click();
  await card.getByLabel("Company name").fill("Walk Roofing");
  const cont = card.getByRole("button", { name: /Continue to checkout/ });
  check(`${label} signed-in: checkout button shows $93.95`, (await cont.innerText()).includes("$93.95"), await cont.innerText());
  await page.addStyleTag({ content: "header{position:static!important}" });
  if (label === "m390") await card.getByTestId("team-builder").screenshot({ path: `${dir}/${label}-checkout-step.png` });
  await cont.click();
  await page.waitForURL("https://checkout.stripe.test/**");
  check(`${label} signed-in: checkout got users=5 editors=3`, sent?.users === 5 && sent?.editors === 3, JSON.stringify(sent));
  await ctx.close();
}

// Signed out: the counts survive the verify-email return URL.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto("http://localhost:3000/pricing?plan=enterprise&users=7&editors=4&checkout=cancelled#enterprise", { waitUntil: "networkidle" });
  const card = page.getByTestId("enterprise-plan");
  check("return URL restores 7 users / 4 editors", (await card.getByRole("spinbutton", { name: "Licensed users", exact: true }).inputValue()) === "7" && (await card.getByRole("spinbutton", { name: "Schedule editors", exact: true }).inputValue()) === "4");
  check("return URL total = $131.92", (await card.getByTestId("enterprise-total").innerText()).includes("$131.92"));
  await ctx.close();
}
await browser.close();
console.log(out.join("\n"));
const failed = out.filter((l) => l.startsWith("✗")).length;
console.log(`\n${out.length - failed}/${out.length} checks passed`);
process.exit(failed ? 1 : 0);
