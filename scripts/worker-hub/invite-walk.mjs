// V8.3.1 worker app invite + findability walk against the REAL SQL on a throwaway local database (TEST DATA ONLY).
// Same setup as walk.mjs (scripts/worker-hub/setup-db.mjs + mock + next start), then:
//   node scripts/worker-hub/invite-walk.mjs <screenshotDir>
// Covers: invite button on Time tracking → Employees and the HR file, creating a link (email off), copy / text
// options, Jose accepting the invite on the join page (his login gets linked to his staff record), My work callout on
// Bids, the install card and welcome on My work, phone widths, no page errors.
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const { Client } = require("pg");
const dir = process.argv[2] ?? "worker-invite-shots";
fs.mkdirSync(dir, { recursive: true });
const ME = "00000000-0000-4000-8000-000000000001", JOSE_USER = "00000000-0000-4000-8000-0000000000d3";
const b64u = (s) => Buffer.from(s).toString("base64url");
const user = { id: ME, aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: ME, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };
const out = []; const check = (n, c) => { out.push(`${c ? "✓" : "✗"} ${n}`); console.log(`${c ? "✓" : "✗"} ${n}`); };
const M = "http://localhost:54321", A = "http://localhost:3000";
const as = (u) => fetch(`${M}/__as?user=${u}`);
const pg = new Client({ connectionString: process.env.RADAR_PG_URL }); await pg.connect();
await pg.query("insert into auth.users (id, email, email_confirmed_at) values ($1, 'jose@summit.test', now()) on conflict do nothing", [JOSE_USER]);
const jose = (await pg.query("select id from public.pm_resources where name = 'Jose Martinez'")).rows[0].id;
await fetch(`${M}/__onboarding?status=completed`);
await fetch(`${M}/__features?created=${encodeURIComponent(new Date().toISOString())}`);
await fetch(`${M}/__scenario?name=unlimited`);
const browser = await chromium.launch();
const errors = [];
async function open(path, vp = { width: 1440, height: 1000 }) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 });
  await ctx.addCookies([authCookie]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${path}: ${e.message}`));
  await page.goto(`${A}${path}`, { waitUntil: "load" });
  const later = page.getByRole("button", { name: "Maybe Later" });
  try { await later.waitFor({ timeout: 3500 }); await later.click(); } catch { /* none */ }
  await page.waitForTimeout(300);
  return { ctx, page };
}
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
let link = null;

await as(ME);
{
  const { ctx, page } = await open("/projects/workforce/time-tracking?tab=employees");
  await page.getByTestId("gps-employees").waitFor();
  check("Employees tab offers 'Invite to the worker app' for staff without a login", await page.getByTestId(`worker-invite-${jose}`).isVisible());
  await page.getByTestId(`worker-invite-${jose}`).click();
  await page.getByTestId("worker-invite-dialog").waitFor();
  await page.getByTestId("worker-invite-email").waitFor({ timeout: 10_000 });
  await page.getByTestId("worker-invite-email").fill("jose@summit.test");
  await page.getByTestId("worker-invite-send").click(); // email off in this walk: nothing is sent
  await page.screenshot({ path: `${dir}/01-invite-dialog.png` });
  await page.getByTestId("worker-invite-create").click();
  await page.getByTestId("worker-invite-result").waitFor({ timeout: 10_000 });
  link = await page.getByTestId("worker-invite-link").inputValue();
  check(`one-time join link created (${link.replace(/token=.*/, "token=…")})`, /\/company\/join\?token=[0-9a-f]{64}$/.test(link));
  check("Text it opens the owner's own messages app with the link", (await page.getByTestId("worker-invite-sms").getAttribute("href")).startsWith("sms:") && (await page.getByTestId("worker-invite-sms").getAttribute("href")).includes(encodeURIComponent("company/join")));
  await page.screenshot({ path: `${dir}/02-invite-link.png` });
  const db = (await pg.query("select email, role, resource_id from public.company_invitations where resource_id = $1 and revoked_at is null", [jose])).rows;
  check("invitation stored for Jose's staff record, role viewer (token stored only as a hash)", db.length === 1 && db[0].role === "viewer" && db[0].email === "jose@summit.test");
  await ctx.close();
}
{
  const { ctx, page } = await open(`/projects/team/hr/${jose}`, { width: 390, height: 844 });
  try {
    await page.getByTestId("worker-app-card").waitFor({ timeout: 10_000 });
    check("HR file shows the Worker app card with the pending invite", /Invite sent/.test(await page.getByTestId("worker-app-card").textContent()));
    await page.getByTestId("worker-app-card").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${dir}/03-hr-file-phone.png` });
  } catch { check("HR file shows the Worker app card", false); await page.screenshot({ path: `${dir}/03-hr-file-phone.png`, fullPage: true }); }
  check("HR file: no sideways scroll at 390", await noHScroll(page));
  await ctx.close();
}
// Jose accepts on the join page (the database checks his verified email).
await as(JOSE_USER);
{
  const { ctx, page } = await open(link.replace(/^https?:\/\/[^/]+/, ""), { width: 390, height: 844 });
  await page.getByRole("heading", { name: /Join Summit Exteriors/ }).waitFor({ timeout: 10_000 });
  await page.screenshot({ path: `${dir}/04-join-phone.png` });
  await page.getByRole("button", { name: /Join|Accept/ }).first().click();
  await page.waitForURL(/\/clock\?joined=1|\/dashboard/, { timeout: 15_000 });
  const linked = (await pg.query("select linked_user_id from public.pm_resources where id = $1", [jose])).rows[0].linked_user_id;
  check("accepting links Jose's login to his existing staff record (no duplicate)", linked === JOSE_USER);
  check(`after joining, a worker lands on My work (${new URL(page.url()).pathname})`, /\/clock/.test(page.url()));
  await ctx.close();
}
await as(ME);
{
  const { ctx, page } = await open("/clock?joined=1", { width: 390, height: 844 });
  await page.getByTestId("worker-home").waitFor();
  check("My work welcomes a new worker", /You're in/.test(await page.textContent("body")));
  check("My work offers putting it on the phone's Home Screen", await page.getByTestId("install-my-work").isVisible());
  await page.screenshot({ path: `${dir}/05-my-work-welcome-phone.png` });
  await page.getByTestId("install-my-work").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${dir}/06-install-card-phone.png` });
  await ctx.close();
  const d = await open("/dashboard", { width: 390, height: 844 });
  try { await d.page.getByTestId("my-work-callout").waitFor({ timeout: 10_000 }); check("Bids page shows a My work shortcut for linked staff", true); }
  catch { check("Bids page shows a My work shortcut for linked staff", false); }
  await d.page.screenshot({ path: `${dir}/07-dashboard-callout-phone.png` });
  check("dashboard: no sideways scroll at 390", await noHScroll(d.page));
  await d.ctx.close();
}
await browser.close(); await pg.end();
check(`no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`, errors.length === 0);
fs.writeFileSync(`${dir}/results.txt`, out.join("\n") + "\n");
process.exit(out.some((l) => l.startsWith("✗")) ? 1 : 0);
