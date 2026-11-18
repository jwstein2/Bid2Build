// V6.7 Team & Access browser walk. Local build against the mock Supabase (test data only, NOT production):
//   NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=mock SUPABASE_SECRET_KEY=mock \
//   NEXT_PUBLIC_PROJECT_SCHEDULING=on NEXT_PUBLIC_FINANCIALS=on npm run build && npx next start
//   node scripts/ux-audit/mock-supabase.mjs &
//   node scripts/workspace-access/walk.mjs <screenshotDir>
// Saves are intercepted (nothing is written anywhere); the walk checks what the editor would send.
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const dir = process.argv[2] ?? "workspace-access-shots";
fs.mkdirSync(dir, { recursive: true });
const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };
const out = []; const check = (n, c) => { out.push(`${c ? "✓" : "✗"} ${n}`); };
const scenario = (n) => fetch(`http://localhost:54321/__scenario?name=${n}`);
const dismiss = async (page) => { const b = page.getByRole("button", { name: "Maybe Later" }); if (await b.isVisible({ timeout: 4000 }).catch(() => false)) await b.click(); };
const noScroll = async (page, vp, label) => { const sw = await page.evaluate(() => document.documentElement.scrollWidth); check(`${label}: no horizontal scroll (${sw})`, sw <= vp.width); };
const browser = await chromium.launch();

for (const [label, vp] of [["desktop", { width: 1366, height: 900 }], ["m390", { width: 390, height: 844 }], ["m320", { width: 320, height: 720 }]]) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 });
  await ctx.addCookies([authCookie]);
  const saves = [];
  await ctx.route("**/api/company/access", async (r) => {
    if (r.request().method() !== "POST") return r.continue();
    const b = JSON.parse(r.request().postData() ?? "{}"); saves.push(b);
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  const page = await ctx.newPage();

  // 1. Owner: Team & Access, Manage Access for Casey.
  await scenario("enterprise_owner");
  await page.goto("http://localhost:3000/company/users");
  await dismiss(page);
  check(`${label}: page titled Team & Access`, (await page.locator("h1").first().textContent()).includes("Team & Access"));
  check(`${label}: owner sees company access policy`, await page.getByTestId("access-policy").isVisible());
  const casey = page.getByTestId("member-row").filter({ hasText: "Casey Estimator" });
  await casey.getByTestId("manage-access").click();
  const ed = page.getByTestId("access-editor");
  await ed.waitFor();
  check(`${label}: editor shows four workspaces + admin`, (await ed.locator("[data-testid^=access-ws-]").count()) === 5);
  await ed.getByRole("button", { name: /Grow the Business/ }).first().click();
  check(`${label}: custom analytics grant shows as View`, (await ed.getByTestId("access-level-analytics").inputValue()) === "view");
  if (label === "desktop") await page.screenshot({ path: `${dir}/01-manage-access-${label}.png`, fullPage: true });
  // Apply the Sales Representative template.
  await ed.getByTestId("access-template").selectOption("sales_rep");
  check(`${label}: Sales rep template: Financials disabled`, (await ed.getByTestId("access-ws-financials").textContent()).includes("Disabled"));
  await ed.getByRole("button", { name: /Run the Job/ }).first().click();
  check(`${label}: Sales rep template: Projects view only`, (await ed.getByTestId("access-level-schedule").inputValue()) === "view");
  // Turn Run the Job off, then keep Project photos: Projects comes back with it, labelled as kept.
  await ed.getByTestId("access-master-run").click();
  check(`${label}: Run the Job off → Disabled`, (await ed.getByTestId("access-ws-run").textContent()).includes("Disabled"));
  await ed.getByTestId("access-level-photos").selectOption("create");
  check(`${label}: keeping Photos raises Projects to View`, (await ed.getByTestId("access-level-schedule").inputValue()) === "view");
  check(`${label}: Run shows Limited · 2 kept`, /Limited · 2 kept/.test(await ed.getByTestId("access-ws-run").textContent()));
  // Schedule edit needs an editor seat: option says so; choosing it explains it's inactive.
  await ed.getByTestId("access-level-schedule").selectOption("edit");
  check(`${label}: editor-seat explanation shown`, (await ed.getByTestId("access-why-schedule").textContent()).includes("scheduling editor seat"));
  await ed.getByTestId("access-level-schedule").selectOption("view");
  // Search narrows the list.
  await ed.getByTestId("access-search").fill("invoice");
  check(`${label}: search finds Invoices`, await ed.getByTestId("access-row-invoices").isVisible() && !(await ed.getByTestId("access-row-bids").isVisible().catch(() => false)));
  await ed.getByTestId("access-search").fill("");
  // Preview Employee Experience.
  await ed.getByTestId("access-preview-toggle").click();
  const pv = ed.getByTestId("access-preview");
  const pvText = await pv.textContent();
  check(`${label}: preview lists Win the Job + Other access`, pvText.includes("Win the Job") && pvText.includes("Other access") && pvText.includes("Run the Job: Projects & schedules, Project photos"));
  check(`${label}: preview has no Financials`, !/Menu[\s\S]*Know Your Numbers|Financials \(/.test(pvText) && pvText.includes("No bank balance"));
  check(`${label}: preview quick actions include Create New Bid, not invoices`, pvText.includes("Create New Bid") && !pvText.includes("Create Invoice"));
  await pv.screenshot({ path: `${dir}/02-preview-${label}.png` });
  // Review + save with a reason.
  await ed.getByTestId("access-review-btn").click();
  const rv = ed.getByTestId("access-review");
  check(`${label}: review lists the template changes`, (await rv.textContent()).includes("Financials"));
  await ed.getByTestId("access-reason").fill("Moved to sales");
  await rv.screenshot({ path: `${dir}/03-review-${label}.png` });
  await ed.getByTestId("access-save").click();
  await ed.getByTestId("access-msg").waitFor();
  const sent = saves.at(-1);
  check(`${label}: save sends role, profile and reason`, sent?.action === "save" && sent.role === "estimator" && sent.profile?.workspaces?.run === false && sent.profile?.workspaces?.financials === false && sent.reason === "Moved to sales");
  check(`${label}: save revokes run perms but keeps photos + view`, sent.revoked.includes("create_schedules") && !sent.revoked.includes("upload_photos") && !sent.revoked.includes("view_schedules"));
  check(`${label}: save keeps the analytics grant out (sales template has none)`, !sent.granted.includes("view_analytics"));
  // History.
  await ed.getByTestId("access-history-toggle").click();
  await ed.getByTestId("access-history").waitFor();
  check(`${label}: history shows reason`, (await ed.getByTestId("access-history").textContent()).includes("Moved to sales"));
  await noScroll(page, vp, `${label} editor`);
  await page.screenshot({ path: `${dir}/04-editor-after-save-${label}.png`, fullPage: true });
  // Owner row: no Manage Access (owner can't be changed).
  const ownerRow = page.getByTestId("member-row").filter({ hasText: "(you)" });
  check(`${label}: owner row has no Manage Access`, (await ownerRow.getByTestId("manage-access").count()) === 0);
  // Policy card.
  await page.getByTestId("access-policy").getByRole("button").first().click();
  await page.getByTestId("policy-deny-costs").check();
  await page.getByTestId("policy-save").click();
  await page.waitForTimeout(400);
  check(`${label}: policy save sends view_costs + view_margin restricted`, saves.at(-1)?.action === "policy" && saves.at(-1).denied.includes("view_costs") && saves.at(-1).denied.includes("view_margin"));
  if (label !== "m320") await page.getByTestId("access-policy").screenshot({ path: `${dir}/05-policy-${label}.png` });

  // 2. Limited sales rep: menu, Other access, direct URL guards.
  await scenario("enterprise_limited");
  await page.goto("http://localhost:3000/dashboard");
  await dismiss(page);
  if (vp.width < 768) await page.getByRole("button", { name: "Menu" }).click();
  const nav = page.locator("#account-nav");
  const navText = await nav.textContent();
  check(`${label}: limited nav keeps Bids + Customers`, navText.includes("My bids") && navText.includes("Customers"));
  check(`${label}: limited nav hides Financials`, !navText.includes("Know Your Numbers") && (await nav.getByRole("link", { name: "Financials", exact: true }).count()) === 0);
  check(`${label}: limited nav shows Other access entry`, await page.getByTestId("nav-other-heading").isVisible() && navText.includes("Run the Job: Projects & schedules, Project photos"));
  check(`${label}: limited nav has no top-level Projects`, (await nav.getByRole("link", { name: "Projects", exact: true }).count()) === 0);
  await page.screenshot({ path: `${dir}/06-limited-nav-${label}.png`, fullPage: vp.width >= 768 });
  await page.goto("http://localhost:3000/financials");
  await page.waitForURL(/no-access/, { timeout: 10000 }).catch(() => {});
  await page.getByTestId("no-access").waitFor({ timeout: 10000 }).catch(() => {});
  check(`${label}: /financials blocked for limited rep`, page.url().includes("/no-access") && await page.getByTestId("no-access").isVisible());
  if (label !== "m320") await page.screenshot({ path: `${dir}/07-no-access-${label}.png` });
  await page.goto("http://localhost:3000/projects/team");
  await page.waitForURL(/no-access/, { timeout: 10000 }).catch(() => {});
  check(`${label}: /projects/team blocked (Run off, team not kept)`, page.url().includes("/no-access?feature=team_directory"));
  // The access API answers with their own access only.
  const me = await page.evaluate(() => fetch("/api/access/me").then((r) => r.json()));
  check(`${label}: /api/access/me: run off with exceptions`, me.access?.workspaces?.run?.exceptions?.includes("photos") && me.access.workspaces.financials.state === "off");

  // 3. Default estimator (no profile, no financial seat): Financials still offered (the page explains the seat),
  //    no "Other access". (The mock estimator has no "View project schedules", so Projects is hidden for them.)
  await scenario("enterprise_estimator");
  await page.goto("http://localhost:3000/dashboard");
  await dismiss(page);
  if (vp.width < 768) await page.getByRole("button", { name: "Menu" }).click();
  const n2 = await page.locator("#account-nav").textContent();
  check(`${label}: default estimator keeps Bids + Financials links, no Other access`, n2.includes("My bids") && n2.includes("Financials") && !n2.includes("Other access"));
  check(`${label}: estimator without View schedules has no Projects link`, !/\bProjects\b/.test(n2));
  await ctx.close();
}
await browser.close();
fs.writeFileSync(`${dir}/results.txt`, out.join("\n") + "\n");
console.log(out.join("\n"));
const failed = out.filter((l) => l.startsWith("✗")).length;
console.log(`\n${out.length - failed}/${out.length} checks passed`);
process.exit(failed ? 1 : 0);
