// Browser walk for Complimentary Access (admin page, recipient claim page, billing page).
// Real SQL: the mock Supabase forwards the complimentary-access RPCs to a throwaway Postgres database.
//   scripts/test-db.sh start
//   COMP_PG_URL=$(node scripts/complimentary/setup-db.mjs) MOCK_ADMIN=1 node scripts/ux-audit/mock-supabase.mjs &
//   build + `next start` on :3000 with NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 and any SUPABASE_SECRET_KEY
//   COMP_PG_URL=... node scripts/complimentary/walk.mjs <screenshotDir>
import { createRequire } from "node:module";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const { Client } = require("pg");

const out = process.argv[2] ?? "complimentary-shots";
fs.mkdirSync(out, { recursive: true });
const BASE = "http://localhost:3000";
const MOCK = "http://localhost:54321";
const db = new Client({ connectionString: process.env.COMP_PG_URL }); await db.connect();
const results = [];
const check = (n, ok, d = "") => { results.push({ n, ok: Boolean(ok), d }); console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? " — " + d : ""}`); };

const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600 * 24 * 365 * 50, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addCookies([authCookie]);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const row = (email) => page.locator("table tbody tr", { hasText: email });
const dialog = () => page.getByRole("dialog");
const shot = (name) => page.screenshot({ path: `${out}/${name}.png`, fullPage: true });

async function grant({ email, plan = "unlimited", days = "30", custom, extra = 0, approve = true, send = true }) {
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("radio", { name: plan === "unlimited" ? /Unlimited \(individual\)/ : /Enterprise \(company\)/ }).check();
  await page.locator(`label:has(input[name=duration][value="${days}"])`).click();
  if (custom) await page.getByLabel("Custom number of days").fill(String(custom));
  if (plan === "enterprise") await page.getByLabel("Additional complimentary seats").fill(String(extra));
  if (extra > 0 && approve) await page.getByText(/I authorize \d+ extra free seat/).click();
  const box = page.getByLabel(/Send invitation email/);
  if ((await box.isChecked()) !== send) await box.click();
  await page.getByRole("button", { name: "Grant access…" }).click();
  await dialog().waitFor();
}

// ---------------------------------------------------------------- admin page
await page.goto(`${BASE}/admin/complimentary`);
check("admin nav links Complimentary Access", await page.getByRole("link", { name: "Complimentary Access" }).isVisible());
check("page heading", await page.getByRole("heading", { name: "Complimentary Access", level: 1 }).isVisible());
check("empty state", await page.getByText("No complimentary grants yet").isVisible());
check("summary metrics rendered", (await page.getByText("Pending invitations").count()) > 0 && (await page.getByText("Converted to paid").count()) > 0);
check("duration presets 7/14/30/60/90/custom", (await page.locator("input[name=duration]").evaluateAll((els) => els.map((e) => e.value))).join(",") === "7,14,30,60,90,custom");
await shot("01-empty__desktop");

// A. existing verified account, Unlimited, 14 days → active now
await grant({ email: "Existing@Demo.test", days: "14" });
check("A confirm dialog summarizes the grant", (await dialog().innerText()).includes("existing@demo.test") && (await dialog().innerText()).includes("14 days") && (await dialog().innerText()).includes("Stripe is not touched"));
await shot("02-confirm__desktop");
await dialog().getByRole("button", { name: "Grant access" }).click();
await page.getByText("already has a verified account").waitFor();
check("A success says active now", true);
await page.reload();
check("A row is Active with 14 days left", (await row("existing@demo.test").innerText()).includes("Active") && (await row("existing@demo.test").innerText()).includes("14 days left"), await row("existing@demo.test").innerText());
check("A row shows company name", (await row("existing@demo.test").innerText()).includes("Summit Roofing"));
check("A granting admin shown", (await row("existing@demo.test").innerText()).includes("ux-test@built2bid.test"));
const stripeRows = (await db.query("select (select count(*) from public.subscriptions)::int s, (select count(*) from public.billing_customers)::int b")).rows[0];
check("A no Stripe rows created (only the seeded payer)", stripeRows.s === 1 && stripeRows.b === 1, JSON.stringify(stripeRows));

// B. new recipient, Enterprise, custom 45 days, 2 extra seats (needs explicit approval)
await page.getByLabel("Email address").fill("newco@demo.test");
await page.getByRole("radio", { name: /Enterprise \(company\)/ }).check();
await page.locator('label:has(input[name=duration][value="custom"])').click();
await page.getByLabel("Custom number of days").fill("45");
await page.getByLabel("Additional complimentary seats").fill("2");
check("B grant disabled until extra seats are authorized", await page.getByRole("button", { name: "Grant access…" }).isDisabled());
await page.getByText(/I authorize 2 extra free seats/).click();
check("B enabled after authorization", await page.getByRole("button", { name: "Grant access…" }).isEnabled());
await page.getByRole("button", { name: "Grant access…" }).click();
await dialog().waitFor();
check("B confirm shows 5 licensed users", (await dialog().innerText()).includes("5 (2 extra authorized)"));
await dialog().getByRole("button", { name: "Grant access" }).click();
await page.getByText("Invitation sent to newco@demo.test").waitFor();
const link = await page.getByLabel("Invitation link").inputValue();
check("B invitation link shown once", /\/complimentary\?token=[A-Za-z0-9_-]{43}$/.test(link), link);
const invites = await (await fetch(`${MOCK}/__invites`)).json();
const inv = invites.at(-1);
const redirect = new URL(inv?.redirect_to ?? inv?.redirectTo ?? new URL(`${MOCK}/x`).toString());
check("B Supabase invite email requested for the recipient", inv?.email === "newco@demo.test", JSON.stringify(inv));
check("B invite returns through /auth/callback to the claim page", redirect.pathname === "/auth/callback" && (redirect.searchParams.get("next") ?? "").startsWith("/complimentary?token="), redirect.toString());
await shot("03-invited__desktop");
const tokenB = new URL(link).searchParams.get("token");
const dbB = (await db.query("select * from public.complimentary_grants where email = 'newco@demo.test'")).rows[0];
check("B stored only the token hash", dbB.invite_token_hash === createHash("sha256").update(tokenB).digest("hex") && !JSON.stringify(dbB).includes(tokenB));
check("B pending, clock not started, 3 + 2 seats", dbB.status === "pending" && dbB.starts_at === null && dbB.included_seats === 3 && dbB.extra_seats === 2 && dbB.duration_days === 45);
await page.reload();
check("B row says 45 days after accepting", (await row("newco@demo.test").innerText()).includes("45 days after accepting"));
check("B row shows 5 seats (+2 extra)", (await row("newco@demo.test").innerText()).includes("+2 extra"));

// C. duplicate grant refused
await grant({ email: "existing@demo.test", days: "7" });
await dialog().getByRole("button", { name: "Grant access" }).click();
await page.getByText("already has an open complimentary grant").waitFor({ timeout: 8000 }).then(() => check("C duplicate refused with a clear message", true), () => check("C duplicate refused with a clear message", false));

// D. existing paid subscriber: comp layered on top
await grant({ email: "payer@demo.test", days: "30" });
await dialog().getByRole("button", { name: "Grant access" }).click();
await page.getByText("already has a verified account").waitFor();
await page.reload();
check("D paid subscriber marked Already paying", (await row("payer@demo.test").innerText()).includes("Already paying"));
const payerSub = (await db.query("select status, plan, stripe_customer_id from public.subscriptions")).rows[0];
check("D Stripe subscription untouched", payerSub.status === "active" && payerSub.plan === "annual" && payerSub.stripe_customer_id === "cus_payer");

// E. extend existing +7 → 21 days left
await row("existing@demo.test").getByRole("button", { name: /^Extend/ }).click();
await dialog().getByRole("button", { name: "+7 days" }).click();
await dialog().getByRole("button", { name: "Extend", exact: true }).click();
await dialog().getByText(/Extended to/).waitFor();
await dialog().getByRole("button", { name: "Close" }).first().click();
await page.waitForTimeout(500);
check("E extended to 21 days left", (await row("existing@demo.test").innerText()).includes("21 days left"), await row("existing@demo.test").innerText());

// F. pause / resume
await row("existing@demo.test").getByRole("button", { name: /^Pause/ }).click();
await shot("04-pause-dialog__desktop");
await dialog().getByRole("button", { name: "Pause access" }).click();
await dialog().getByText(/Paused\. Access is off now/).waitFor();
await page.keyboard.press("Escape");
await page.waitForTimeout(500);
check("F paused", (await row("existing@demo.test").innerText()).includes("Paused"));
const pausedEnt = (await db.query("select public.has_unlimited(id) v from auth.users where email = 'existing@demo.test'")).rows[0].v;
check("F paused grant gives no access (database)", pausedEnt === false);
await row("existing@demo.test").getByRole("button", { name: /^Resume/ }).click();
await dialog().getByRole("button", { name: "Resume access" }).click();
await dialog().getByText(/Resumed/).waitFor();
await page.keyboard.press("Escape");
await page.waitForTimeout(500);
check("F resumed to Active", (await row("existing@demo.test").innerText()).includes("Active"));

// G. resend is throttled right after sending, then works
await row("newco@demo.test").getByRole("button", { name: /^Resend invitation/ }).click();
await dialog().getByRole("button", { name: "Resend invitation" }).click();
await dialog().getByText("Wait a minute before resending").waitFor({ timeout: 8000 }).then(() => check("G resend throttled for a minute", true), () => check("G resend throttled for a minute", false));
await page.keyboard.press("Escape");
await db.query("update public.complimentary_grants set invite_sent_at = now() - interval '5 minutes' where email = 'newco@demo.test'");
await row("newco@demo.test").getByRole("button", { name: /^Resend invitation/ }).click();
await dialog().getByRole("button", { name: "Resend invitation" }).click();
await dialog().getByText(/New invitation sent/).waitFor();
const link2 = await dialog().getByLabel("Invitation link").inputValue();
check("G resend issues a different link", link2 !== link);
await page.keyboard.press("Escape");

// H. seats dialog needs owner authorization
await row("newco@demo.test").getByRole("button", { name: /^Seats/ }).click();
await dialog().getByLabel("Extra seats").fill("4");
check("H save disabled until authorized", await dialog().getByRole("button", { name: "Save seats" }).isDisabled());
await dialog().getByText("I authorize this seat count").click();
await dialog().getByRole("button", { name: "Save seats" }).click();
await dialog().getByText("7 licensed users in total").waitFor().then(() => check("H seats updated to 3 + 4", true), () => check("H seats updated to 3 + 4", false));
await page.keyboard.press("Escape");

// I. recipient claim page: wrong account (old token, then new token)
const claimPage = await ctx.newPage();
await claimPage.goto(link);
check("I old (rotated) link is invalid", await claimPage.getByText("isn't valid").isVisible());
await claimPage.goto(link2);
check("I another account can't use the invite", await claimPage.getByText("was sent to n***@demo.test").isVisible());
await claimPage.screenshot({ path: `${out}/05-claim-mismatch__desktop.png` });

// J. recipient claim page: right account → active
const tok = randomBytes(32).toString("base64url");
await db.query("insert into public.complimentary_grants (email, plan, duration_days, granted_by, invite_token_hash, invite_expires_at) values ('ux-test@built2bid.test', 'unlimited', 30, '00000000-0000-4000-8000-000000000001', $1, now() + interval '30 days')", [createHash("sha256").update(tok).digest("hex")]);
await claimPage.goto(`${BASE}/complimentary?token=${tok}`);
check("J invited user sees access active", await claimPage.getByRole("heading", { name: "You're all set" }).isVisible());
check("J says no charge when it ends", await claimPage.getByText("you won't be charged when it ends").isVisible());
await claimPage.screenshot({ path: `${out}/06-claim-success__desktop.png` });
await claimPage.goto(`${BASE}/complimentary?token=${tok}`);
check("J reopening the used link still shows access (owner)", await claimPage.getByRole("heading", { name: "You're all set" }).isVisible());

// K. billing page for a complimentary-only user
await claimPage.goto(`${BASE}/settings/billing`);
check("K billing shows Complimentary Unlimited", await claimPage.getByText("Complimentary Unlimited").first().isVisible());
check("K billing explains no charge", await claimPage.getByText(/nothing is charged when it ends/).isVisible());
check("K billing still offers subscribe", await claimPage.getByRole("button", { name: /Choose Monthly/ }).isVisible() && await claimPage.getByText("Subscribing starts billing today").isVisible());
check("K no fake paid plan name", !(await claimPage.getByText("Renews on").count()));
await claimPage.screenshot({ path: `${out}/07-billing-comp__desktop.png`, fullPage: true });
await db.query("update public.complimentary_grants set starts_at = now() - interval '31 days', expires_at = now() - interval '1 hour' where email = 'ux-test@built2bid.test'");
await claimPage.goto(`${BASE}/settings/billing`);
check("K expired: falls back to Free", (await claimPage.getByText("Free", { exact: true }).count()) > 0);
check("K expired: notice + upgrade offered", await claimPage.getByText("Your complimentary access has ended").isVisible() && await claimPage.getByRole("button", { name: /Choose Annual/ }).isVisible());
await claimPage.screenshot({ path: `${out}/08-billing-ended__desktop.png`, fullPage: true });
await claimPage.close();

// L. revoke + details + filters
await page.reload();
await row("newco@demo.test").getByRole("button", { name: /^Revoke/ }).click();
check("L revoke dialog explains consequences", (await dialog().innerText()).includes("not affected"));
await dialog().getByLabel(/Reason/).fill("Prospect declined");
await dialog().getByRole("button", { name: "Revoke access" }).click();
await dialog().getByText(/Revoked\./).waitFor();
await page.keyboard.press("Escape");
await page.waitForTimeout(500);
check("L revoked", (await row("newco@demo.test").innerText()).includes("Revoked"));
await row("existing@demo.test").getByRole("button", { name: /^Details/ }).click();
await dialog().getByText("History").waitFor();
const hist = await dialog().innerText();
check("L details history lists grant/activate/extend/pause/resume", ["grant", "activate", "extend", "pause", "resume"].every((w) => hist.includes(w)), hist.replace(/\s+/g, " ").slice(0, 300));
await shot("09-details__desktop");
await page.keyboard.press("Escape");

await page.goto(`${BASE}/admin/complimentary?plan=enterprise`);
check("M plan filter", (await page.locator("table tbody tr").count()) === 1 && (await row("newco@demo.test").count()) === 1);
await page.goto(`${BASE}/admin/complimentary?state=active`);
const activeRows = await page.locator("table tbody tr").allInnerTexts();
check("M status filter", activeRows.length > 0 && activeRows.every((t) => t.includes("Active")), String(activeRows.length));
await page.goto(`${BASE}/admin/complimentary?q=summit`);
check("M search by company", (await page.locator("table tbody tr").count()) === 1);
await page.goto(`${BASE}/admin/complimentary?from=2099-01-01`);
check("M date filter", await page.getByText("No grants match these filters.").isVisible());
await page.goto(`${BASE}/admin/complimentary`);
const metricText = await page.locator("section[aria-label=Summary]").innerText();
check("M metrics count enterprise + revoked", /Enterprise grants\s+1\b/.test(metricText) && metricText.includes("1 revoked"), metricText.replace(/\s+/g, " "));
await shot("10-table__desktop");

const audit = (await db.query("select action from public.audit_logs where target_type = 'complimentary_grant' order by id")).rows.map((r) => r.action);
check("N audit log has every admin action", ["comp.grant", "comp.activate", "comp.invite_sent", "comp.extend", "comp.pause", "comp.resume", "comp.invite_rotate", "comp.extra_seats", "comp.revoke"].every((a) => audit.includes(a)), audit.join(","));

// Mobile
for (const vp of [{ tag: "m390", width: 390, height: 844 }, { tag: "m320", width: 320, height: 640 }]) {
  const m = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: true, hasTouch: true });
  await m.addCookies([authCookie]);
  const p = await m.newPage();
  await p.goto(`${BASE}/admin/complimentary`);
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`${vp.tag} no horizontal scroll`, overflow <= 0, String(overflow));
  check(`${vp.tag} grants shown as cards`, await p.locator("ul li", { hasText: "existing@demo.test" }).first().isVisible());
  await p.screenshot({ path: `${out}/11-admin__${vp.tag}.png`, fullPage: true });
  await p.locator("ul li", { hasText: "existing@demo.test" }).getByRole("button", { name: /^Extend/ }).click();
  const box = await p.getByRole("dialog").boundingBox();
  check(`${vp.tag} dialog fits the screen`, box && box.x >= 0 && box.x + box.width <= vp.width, JSON.stringify(box));
  await p.screenshot({ path: `${out}/12-extend__${vp.tag}.png` });
  await m.close();
}

check("no client-side errors", errors.length === 0, errors.join(" | "));
await browser.close(); await db.end();
fs.writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
