// V8.9 sales invite onboarding + V8.10 workspace switching, in a real browser against a REAL database.
//   scripts/test-db.sh start
//   export RADAR_PG_URL=$(node scripts/sales-invite/setup-db.mjs)
//   PG_REST_PREFIXES=sales_,admin_sales_,my_workspaces,set_my_workspace node scripts/ux-audit/mock-supabase.mjs &
//   NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=x SUPABASE_SECRET_KEY=x npm run build && npx next start -p 3000 &
//   node scripts/sales-invite/walk.mjs <screenshotDir>
// /__as flips the database user: empty = service role (the public invite page lookup), ME = the rep's session.
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");
const { Client } = require("pg");

const out = process.argv[2] ?? "sales-invite-shots";
fs.mkdirSync(out, { recursive: true });
const BASE = "http://localhost:3000", MOCK = "http://localhost:54321";
const ME = "00000000-0000-4000-8000-000000000001";
const TOKENS = { main: "J".repeat(43), expired: "E".repeat(43), revoked: "R".repeat(43) };
const db = new Client({ connectionString: process.env.RADAR_PG_URL }); await db.connect();
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const results = [];
const check = (n, ok, d = "") => { results.push({ n, ok: Boolean(ok), d }); console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? " — " + d : ""}`); };
const as = (user) => fetch(`${MOCK}/__as?user=${user}`);

const browser = await chromium.launch();
const errors = [];
async function newPage(kind, signedIn) {
  const ctx = await browser.newContext(kind === "phone" ? { ...devices["iPhone 13"] } : { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  if (signedIn) {
    const user = { id: ME, aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
    const b64u = (s) => Buffer.from(s).toString("base64url");
    const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: ME, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
    const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600 * 24 * 365 * 50, expires_at: 4102444800, user };
    await ctx.addCookies([{ name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" }]);
  }
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${page.url()}: ${e}`));
  return page;
}
const go = async (p, path) => { await p.goto(BASE + path, { waitUntil: "load" }); await p.waitForTimeout(500); };
const shot = (p, name) => p.screenshot({ path: `${out}/${name}.png`, fullPage: true });
const path = (p) => new URL(p.url()).pathname + new URL(p.url()).search;

// 1. Brand-new rep: invite link -> create account with the emailed code -> My Sales Hub with onboarding.
for (const kind of ["desktop", "phone"]) {
  if (kind === "phone") await q("update public.sales_reps set user_id = null, status = 'invited', activated_at = null where email = 'ux-test@built2bid.test'; update public.sales_rep_invites set accepted_at = null, accepted_by = null, accepted_email = null; delete from public.account_preferences");
  await as("");
  const p = await newPage(kind, false);
  await go(p, `/sales/invite/${TOKENS.main}`);
  check(`N1 ${kind}: invite page says they're joining the sales team`, await p.getByRole("heading", { name: /Welcome to the team, Josiah/ }).isVisible());
  const cookies = await p.context().cookies();
  check(`N2 ${kind}: invite remembered in an httpOnly cookie`, cookies.some((c) => c.name === "b2b_sales_join" && c.httpOnly && c.value === TOKENS.main));
  await shot(p, `01-invite-signed-out-${kind}`);
  await p.getByTestId("sales-sign-in").click();
  await p.getByLabel(/email/i).first().fill("ux-test@built2bid.test");
  await p.getByRole("button", { name: /send|code|continue/i }).first().click();
  await p.getByLabel(/code/i).first().waitFor();
  await shot(p, `02-enter-code-${kind}`);
  await as(ME);
  await p.getByLabel(/code/i).first().fill("123456");
  await p.getByRole("button", { name: /verify/i }).click();
  await p.waitForURL(/\/sales\?welcome=1/, { timeout: 20000 });
  check(`N3 ${kind}: lands on My Sales Hub with onboarding`, await p.getByTestId("sales-onboarding").isVisible(), path(p));
  check(`N4 ${kind}: referral link near the top`, (await p.getByLabel("Your referral link").inputValue()).endsWith(`/s/${(await q("select code from public.sales_reps where email = 'ux-test@built2bid.test'"))[0].code}`));
  const top = await p.getByTestId("referral-link").boundingBox();
  check(`N5 ${kind}: referral card is above the fold`, top && top.y < (kind === "phone" ? 900 : 700), JSON.stringify(top));
  const rep = (await q("select status, user_id from public.sales_reps where email = 'ux-test@built2bid.test'"))[0];
  check(`N6 ${kind}: rep record active and linked`, rep.status === "active" && rep.user_id === ME);
  check(`N7 ${kind}: invite cookie cleared`, !(await p.context().cookies()).some((c) => c.name === "b2b_sales_join"));
  await shot(p, `03-sales-hub-welcome-${kind}`);
  if (kind === "phone") check("N8 phone: no horizontal scroll", (await p.evaluate(() => document.documentElement.scrollWidth)) <= 391);
  if (kind === "desktop") {
    // 5. Clicking the original invite again. (The mock runs every query as one user: the public lookup is service role.)
    await as("");
    await go(p, `/sales/invite/${TOKENS.main}`);
    await as(ME);
    check("R1 re-click: says already joined", await p.getByRole("heading", { name: "You've already joined" }).isVisible());
    await shot(p, "04-invite-again");
    await p.getByRole("link", { name: "Open my Sales Hub" }).click();
    await p.waitForURL(/\/sales$/);
    check("R2 re-click: opens My Sales Hub", path(p) === "/sales");
    // 4. Signing in again later with no destination: /auth/landing picks the Sales Hub.
    await go(p, "/auth/landing");
    check("R3 next sign-in lands on My Sales Hub (sales-only account)", path(p) === "/sales", path(p));
    // Normal /login while signed in goes the same way.
    await go(p, "/login");
    check("R4 /login while signed in -> Sales Hub", path(p) === "/sales", path(p));
    // Public site header shows the Sales Hub, not My Bids.
    await go(p, "/pricing");
    check("R5 site header offers Sales Hub to a sales-only account", await p.locator("header").getByRole("link", { name: "Sales Hub" }).isVisible());
    check("S1 pricing shows Individual Unlimited", await p.getByText("Individual Unlimited", { exact: true }).first().isVisible());
    await shot(p, "05-pricing-individual-unlimited");
    // No switch to the contractor dashboard for a sales-only rep.
    await go(p, "/sales");
    check("W1 sales-only rep: no Switch to Contractor Dashboard", (await p.getByTestId("switch-workspace").count()) === 0);
  }
  await p.context().close();
}

// 2. Expired and revoked invites.
await as("");
{
  const p = await newPage("desktop", false);
  await go(p, `/sales/invite/${TOKENS.expired}`);
  check("X1 expired invite explained", await p.getByRole("heading", { name: "This invite has expired" }).isVisible());
  await shot(p, "06-invite-expired");
  await go(p, `/sales/invite/${TOKENS.revoked}`);
  check("X2 revoked invite explained", await p.getByRole("heading", { name: "This invite link was replaced" }).isVisible());
  await shot(p, "07-invite-revoked");
  await p.context().close();
}

// 3. Dual workspace: the rep also uses the contractor app (a bid) -> switch links both ways.
await q("insert into public.estimates (user_id, title) values ($1, 'Deck bid')", [ME]);
await as(ME);
{
  const p = await newPage("desktop", true);
  await go(p, "/sales");
  const sw = p.getByTestId("switch-workspace");
  check("W2 Sales Hub shows Switch to Contractor Dashboard", (await sw.count()) === 1 && (await sw.textContent())?.includes("Switch to Contractor Dashboard"));
  await shot(p, "08-sales-hub-switch");
  await sw.click();
  await p.waitForURL(/\/dashboard/);
  check("W3 one click to the contractor dashboard, no sign-in", path(p).startsWith("/dashboard"), path(p));
  const back = p.getByTestId("switch-workspace");
  check("W4 contractor menu shows Switch to Sales Hub", (await back.count()) === 1 && (await back.textContent())?.includes("Switch to Sales Hub"));
  await back.scrollIntoViewIfNeeded();
  await shot(p, "09-contractor-switch");
  check("W5 last workspace remembered", (await q("select last_workspace from public.account_preferences where user_id = $1", [ME]))[0]?.last_workspace === "contractor");
  await back.click();
  await p.waitForURL(/\/sales$/);
  check("W6 back to My Sales Hub in one click", path(p) === "/sales");
  await go(p, "/settings/account");
  check("P1 account settings: landing preference", await p.getByTestId("landing-pref").isVisible());
  await p.getByTestId("landing-pref").scrollIntoViewIfNeeded();
  await shot(p, "10-landing-preference");
  // 7. Role revoked: menu link is stale -> /switch falls back, Sales Hub closes.
  await q("update public.sales_reps set status = 'suspended' where user_id = $1", [ME]);
  await go(p, "/switch?to=sales");
  check("V1 switch after revocation falls back to the contractor dashboard", path(p).startsWith("/dashboard"), path(p));
  check("V2 no Switch to Sales Hub after revocation", (await p.getByTestId("switch-workspace").count()) === 0);
  await go(p, "/sales");
  check("V3 Sales Hub closed after revocation", await p.getByRole("heading", { name: /access is paused/ }).isVisible());
  await go(p, "/sales/admin");
  check("V4 admin hub stays closed (no admin sections)", (await p.getByRole("link", { name: "Commission approvals" }).count()) === 0 && await p.getByRole("heading", { name: /access is paused|could not be found|404/i }).first().isVisible());
  await p.context().close();
}

const failed = results.filter((r) => !r.ok);
fs.writeFileSync(`${out}/results.json`, JSON.stringify({ results, errors }, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} passed; page errors: ${errors.length}`);
for (const e of errors.slice(0, 10)) console.log("  ", e);
await browser.close(); await db.end();
process.exit(failed.length ? 1 : 0);
