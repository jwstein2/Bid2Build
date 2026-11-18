// Customer Hub + Company navigation browser walk, against a REAL database (migration, trigger, RLS):
//   scripts/test-db.sh start
//   export RADAR_PG_URL=$(node scripts/customer-hub/setup-db.mjs)
//   PG_REST_AS_USER=00000000-0000-4000-8000-000000000001 \
//   PG_REST_PREFIXES=customer,estimate,signing_requests,signatures,project_schedules,can_edit_customer,save_estimate,schedule_get \
//     node scripts/ux-audit/mock-supabase.mjs &
//   export NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=x SUPABASE_SECRET_KEY=x \
//     NEXT_PUBLIC_PROJECT_SCHEDULING=on NEXT_PUBLIC_ESIGNATURES=on
//   npm run build && npx next start -p 3000 &
//   node scripts/customer-hub/walk.mjs <screenshotDir>
// PART=empty runs only the empty-account checks (start the mock against `setup-db.mjs --empty`).
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");
const { Client } = require("pg");

const out = process.argv[2] ?? "customer-hub-shots";
fs.mkdirSync(out, { recursive: true });
const BASE = "http://localhost:3000";
const MOCK = "http://localhost:54321";
const PART = process.env.PART ?? "main";
const db = new Client({ connectionString: process.env.RADAR_PG_URL }); await db.connect();
const results = [];
const check = (n, ok, d = "") => { results.push({ n, ok: Boolean(ok), d }); console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? " — " + d : ""}`); };
const q = async (sql, p = []) => (await db.query(sql, p)).rows;

const browser = await chromium.launch();
const errors = [];
const PHONE = { ...devices["iPhone 13"] };
const DESKTOP = { viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 };

async function newPage(kind, theme = "light") {
  const ctx = await browser.newContext(kind === "phone" ? PHONE : DESKTOP);
  const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
  const b64u = (s) => Buffer.from(s).toString("base64url");
  const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
  const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600 * 24 * 365 * 50, expires_at: 4102444800, user };
  await ctx.addCookies([{ name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" }]);
  await ctx.addInitScript((m) => {
    localStorage.setItem("b2b-theme", JSON.stringify({ mode: m, at: Date.now() }));
    localStorage.setItem("b2b:onboarding", JSON.stringify({ status: "completed" }));
  }, theme);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${page.url()}: ${e}`));
  return page;
}
async function go(page, path) {
  await page.goto(BASE + path, { waitUntil: "load" });
  await page.waitForTimeout(500);
  // "Your New Features Are Ready" can appear a moment after load.
  const later = page.getByRole("button", { name: "Maybe Later" });
  if (await later.isVisible({ timeout: 2500 }).catch(() => false)) await later.click();
}
const settle = async (page) => { await page.waitForLoadState("load"); await page.waitForTimeout(700); };
const shot = (page, name, full = true) => page.screenshot({ path: `${out}/${name}.png`, fullPage: full });
const scenario = (name) => fetch(`${MOCK}/__scenario?name=${name}`);
const rowNames = (page) => page.getByTestId("customer-row-name").allInnerTexts();

if (PART === "empty") {
  const p = await newPage("desktop");
  await go(p, "/dashboard/customers");
  check("E1 empty account shows the true empty state", await p.getByTestId("customers-empty").isVisible());
  check("E2 no 'No saved customers yet' text", !(await p.getByText("No saved customers yet").count()));
  const first = p.getByRole("link", { name: "Create Your First Customer" });
  const bid = p.getByRole("link", { name: "Create a New Bid" });
  check("E3 both empty-state actions present", (await first.count()) === 1 && (await bid.count()) === 1);
  await shot(p, "empty-desktop");
  await first.click(); await p.waitForURL(/customers\/new/);
  check("E4 Create Your First Customer opens the form", await p.getByTestId("new-customer-form").isVisible());
  await go(p, "/dashboard/customers");
  await p.getByRole("link", { name: "Create a New Bid" }).click(); await p.waitForURL(/\/bids$/);
  check("E5 Create a New Bid opens the trade picker", p.url().endsWith("/bids"));
} else {
  // ---------------------------------------------------------------------------
  // 1-5. Company navigation, per plan
  // ---------------------------------------------------------------------------
  for (const [sc, label] of [["starter", "Free"], ["unlimited", "Standard Unlimited"], ["enterprise_owner", "Enterprise owner"], ["enterprise_estimator", "Enterprise estimator"]]) {
    await scenario(sc);
    const p = await newPage("desktop");
    await go(p, "/dashboard");
    const nav = p.locator("#account-nav");
    const heading = nav.getByTestId("nav-company-heading");
    const profile = nav.getByTestId("nav-company-profile");
    const texts = await nav.locator("a, p").allInnerTexts();
    const iHead = texts.findIndex((t) => t.startsWith("COMPANY") || t.toLowerCase().startsWith("company"));
    const iProfile = texts.findIndex((t) => t.trim() === "Company profile");
    const iCustomers = texts.findIndex((t) => t.trim() === "Customers");
    check(`N1 ${label}: Company section shows Company profile as its first entry`, (await heading.isVisible()) && (await profile.isVisible()) && iProfile === iHead + 1, texts.slice(iHead, iHead + 7).join(" | "));
    check(`N2 ${label}: Company profile no longer in the general list (after Customers)`, iProfile > iCustomers && (await nav.getByRole("link", { name: "Company profile" }).count()) === 1);
    const ent = ["Overview", "Team & Access", "Proposal & Bid Style", "Billing & Licenses"];
    const shown = [];
    for (const e of ent) if (await nav.getByRole("link", { name: e, exact: true }).count()) shown.push(e);
    if (sc === "starter" || sc === "unlimited") check(`N3 ${label}: no Enterprise controls rendered`, shown.length === 0, shown.join(", "));
    if (sc === "enterprise_owner") check(`N3 ${label}: Enterprise controls follow permissions (all)`, shown.length === 4, shown.join(", "));
    if (sc === "enterprise_estimator") check(`N3 ${label}: estimator sees no Overview / Style / Billing`, !shown.includes("Overview") && !shown.includes("Billing & Licenses") && !shown.includes("Proposal & Bid Style"), shown.join(", "));
    await profile.click(); await p.waitForURL(/settings\/company/);
    check(`N4 ${label}: Company profile opens the existing profile page`, (await p.locator("h1, h2").first().innerText()).length > 0 && p.url().includes("/settings/company"));
    check(`N5 ${label}: Company profile marked current`, (await nav.getByTestId("nav-company-profile").getAttribute("aria-current")) === "page");
    await p.locator("aside").screenshot({ path: `${out}/nav-${sc}.png` });
    await p.context().close();
  }
  await scenario("starter");
  {
    const p = await newPage("phone");
    await go(p, "/dashboard");
    await p.getByRole("button", { name: /Menu/ }).click();
    check("N6 phone: menu shows Company section with Company profile", await p.getByTestId("nav-company-profile").isVisible());
    await shot(p, "nav-phone-menu", false);
    await p.getByTestId("nav-company-profile").click(); await p.waitForURL(/settings\/company/); await p.waitForTimeout(800);
    check("N7 phone: Company profile opens and menu closes", !(await p.getByTestId("nav-company-profile").isVisible()));
    await p.context().close();
  }

  // ---------------------------------------------------------------------------
  // 6-17. Customer Hub
  // ---------------------------------------------------------------------------
  const versionsBefore = await q("select id, content_hash, total from public.estimate_versions order by id");
  const bidTextBefore = await q("select id, customer_name, customer_email, customer_phone, project_address from public.estimates order by id");
  const p = await newPage("desktop");
  await go(p, "/dashboard/customers");
  await shot(p, "customers-desktop");
  const names = await rowNames(p);
  check("C1 existing bid customers appear automatically", ["Pat Johnson", "Morgan Lee", "Sam Ortiz-Washington", "Chris Rivera"].every((n) => names.includes(n)), names.join(", "));
  check("C2 'No saved customers yet' is gone; new description shown", !(await p.getByText("No saved customers yet").count()) && (await p.getByText("Manage your customers, estimates, projects, and communication history in one place.").count()) === 1);
  check("C3 customer with two bids is ONE record", names.filter((n) => n === "Pat Johnson").length === 1);
  const patRow = p.locator("[data-testid=customer-row]", { hasText: "Pat Johnson" });
  check("C4 row shows bid count and relationship", /2 bids/.test(await patRow.innerText()) && /Active project/.test(await patRow.innerText()), (await patRow.innerText()).replace(/\n/g, " | "));
  check("C5 same-name customers without matching contact stay separate and are flagged", names.filter((n) => n === "John Smith").length === 2 && (await p.locator("[data-testid=customer-row]", { hasText: "John Smith" }).first().getByText("Possible duplicate").count()) === 1);
  check("C6 tenant isolation: another account's customer never listed", !names.includes("Secret Customer"));
  const metric = async (id) => Number((await p.getByTestId(id).locator(".metric-value").innerText()).trim());
  const m = { total: await metric("metric-total"), open: await metric("metric-open"), projects: await metric("metric-projects"), attention: await metric("metric-attention") };
  check("C7 metrics match the data", m.total === 6 && m.open === 3 && m.projects === 1 && m.attention === 2, JSON.stringify(m));
  for (const [id, n, f] of [["metric-open", m.open, "open"], ["metric-projects", m.projects, "projects"], ["metric-attention", m.attention, "attention"], ["metric-total", m.total, null]]) {
    await p.getByTestId(id).click();
    await p.waitForURL(f ? new RegExp(`focus=${f}`) : /customers$/);
    await settle(p);
    const rows = await p.locator("[data-testid=customer-row]").count();
    check(`C8 ${id} opens matching filtered records`, rows === n, `${rows} rows, card ${n}`);
    if (f === "attention") await shot(p, "customers-attention");
  }
  const search = p.getByTestId("customer-search");
  for (const [term, expect] of [["lakeview", ["John Smith"]], ["7788", ["Chris Rivera"]], ["B-1004", ["Pat Johnson"]], ["pat@example", ["Pat Johnson"]]]) {
    await search.fill(term);
    await p.waitForURL(new RegExp(`q=${encodeURIComponent(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    await settle(p);
    const got = await rowNames(p);
    check(`C9 search "${term}"`, JSON.stringify(got) === JSON.stringify(expect), got.join(", "));
  }
  await search.fill("nobody-here"); await p.waitForURL(/q=nobody/); await settle(p);
  check("C10 no-match search shows an accurate empty state", await p.getByTestId("customers-filter-empty").isVisible());
  await p.getByRole("button", { name: "Clear search" }).click(); await p.waitForURL(/customers$/); await settle(p);
  await p.getByTestId("customer-sort").selectOption("name"); await p.waitForURL(/sort=name/); await settle(p);
  const sorted = await rowNames(p);
  check("C11 sort by name", sorted[0] === "Chris Rivera" && sorted.at(-1) === "Sam Ortiz-Washington", sorted.join(", "));
  await p.getByTestId("customer-focus").selectOption("lost"); await p.waitForURL(/focus=lost/); await settle(p);
  check("C12 status filter (Lost / declined)", JSON.stringify(await rowNames(p)) === JSON.stringify(["John Smith"]));
  await p.getByTestId("customer-focus").selectOption("duplicates"); await p.waitForURL(/focus=duplicates/); await settle(p);
  check("C13 possible-duplicates filter", (await rowNames(p)).filter((n) => n === "John Smith").length === 2);

  // Detail
  const [pat] = await q("select id from public.customers where name = 'Pat Johnson'");
  await go(p, "/dashboard/customers");
  await p.locator("[data-testid=customer-row]", { hasText: "Pat Johnson" }).click();
  await p.waitForURL(new RegExp(`/dashboard/customers/${pat.id}$`));
  check("C14 clicking the whole row opens the right customer", (await p.getByTestId("customer-name").innerText()) === "Pat Johnson");
  await shot(p, "customer-detail-overview");
  await p.getByTestId("customer-detail-tabs").getByRole("link", { name: /^Bids/ }).click(); await p.waitForURL(/tab=bids/);
  const bidLinks = p.getByTestId("customer-bid-link");
  check("C15 Bids tab lists both linked bids", (await bidLinks.count()) === 2, (await bidLinks.allInnerTexts()).join(", "));
  await shot(p, "customer-detail-bids");
  const [siding] = await q("select id from public.estimates where title like 'Siding%'");
  const sidingLink = p.getByTestId("customer-bid-link").filter({ hasText: "Siding" });
  check("C16 bid link points at the right estimate", (await sidingLink.getAttribute("href")) === `/estimates/${siding.id}`);
  await sidingLink.click(); await p.waitForURL(new RegExp(`/estimates/${siding.id}`));
  await settle(p);
  check("C17 bid link opens that estimate", p.url().includes(siding.id) && !(await p.getByText("404").count()));
  await go(p, `/dashboard/customers/${pat.id}?tab=projects`);
  const [proj] = await q("select id from public.project_schedules limit 1");
  const projLink = p.getByTestId("customer-project-link");
  check("C18 project link points at the right project", (await projLink.getAttribute("href")) === `/projects/${proj.id}`);
  await shot(p, "customer-detail-projects");
  await go(p, `/dashboard/customers/${pat.id}?tab=activity`);
  check("C19 Activity tab lists recorded events", (await p.getByTestId("customer-activity").locator("li").count()) >= 3);
  await shot(p, "customer-detail-activity");

  // Edit contact (persists to the shared record; bids keep their text)
  await go(p, `/dashboard/customers/${pat.id}`);
  await p.getByTestId("customer-edit").click();
  await p.locator("#ce-phone").fill("(555) 999-0000");
  await p.getByText("Business", { exact: true }).click();
  await p.locator("#ce-company").fill("Johnson Holdings LLC");
  await shot(p, "customer-edit-form");
  await p.getByTestId("customer-save").click();
  await p.getByText("Saved. Future bids use these details").waitFor();
  await p.reload({ waitUntil: "load" });
  const [after] = await q("select phone, company_name, customer_type, source from public.customers where id = $1", [pat.id]);
  check("C20 contact edit persists (reload + database)", (await p.getByTestId("customer-contact").innerText()).includes("(555) 999-0000") && after.phone === "(555) 999-0000" && after.company_name === "Johnson Holdings LLC" && after.source === "manual", JSON.stringify(after));

  // Merge two John Smith records the contractor confirms are the same
  const [js] = await q("select id from public.customers where name = 'John Smith' and project_address = '12 Elm St'");
  await go(p, `/dashboard/customers/${js.id}`);
  check("C21 duplicates offered for review (not merged automatically)", await p.getByTestId("customer-duplicates").isVisible());
  await shot(p, "customer-duplicates");
  await p.getByTestId("merge-start").click();
  await p.getByTestId("merge-confirm").click();
  await p.getByText("Merged.").waitFor({ timeout: 10000 }).catch(() => {});
  await settle(p);
  const smiths = await q("select c.id, count(e.id)::int n from public.customers c left join public.estimates e on e.customer_id = c.id where c.name = 'John Smith' group by c.id");
  check("C22 merge keeps one record with both bids", smiths.length === 1 && smiths[0].n === 2, JSON.stringify(smiths));

  // Historical data untouched
  const versionsAfter = await q("select id, content_hash, total from public.estimate_versions order by id");
  const bidTextAfter = await q("select id, customer_name, customer_email, customer_phone, project_address from public.estimates order by id");
  check("C23 proposal versions unchanged", JSON.stringify(versionsBefore) === JSON.stringify(versionsAfter));
  check("C24 bids keep their original customer text after edits/merge", JSON.stringify(bidTextBefore) === JSON.stringify(bidTextAfter));

  // Tenant isolation on the detail route
  const [secret] = await q("select id from public.customers where name = 'Secret Customer'");
  const r = await p.goto(`${BASE}/dashboard/customers/${secret.id}`);
  check("C25 another account's customer page is not found", r.status() === 404);

  // New customer, then a bid for them
  await go(p, "/dashboard/customers/new");
  await p.locator("#nc-name").fill("Taylor Brooks");
  await p.locator("#nc-email").fill("taylor@example.test");
  await p.getByTestId("new-customer-save").click();
  await p.waitForURL(/\/dashboard\/customers\/[0-9a-f-]{36}$/);
  check("C26 new customer saved and opened", (await p.getByTestId("customer-name").innerText()) === "Taylor Brooks");
  await p.getByTestId("new-bid-for-customer").click(); await p.waitForURL(/\/bids$/);
  await p.locator("a[href='/start/decks']").first().click();
  await p.waitForURL(/\/builder\?draft=/, { timeout: 20000 });
  await settle(p);
  await p.getByText("Saved", { exact: true }).waitFor({ timeout: 15000 }).catch(() => {});
  const header = await p.locator("header, main").first().innerText();
  const [linkedBid] = await q("select e.customer_id = c.id as linked from public.estimates e join public.customers c on c.name = 'Taylor Brooks' where e.customer_name = 'Taylor Brooks'");
  check("C27 'New bid for this customer' starts the bid with the customer filled in and linked to the existing record", header.includes("Taylor Brooks") && linkedBid?.linked === true, JSON.stringify(linkedBid ?? null));
  check("C28 builder says no separate save is needed", !(await p.getByRole("button", { name: "Save to my customers" }).count()));
  await shot(p, "builder-customer-step", false);

  // Dups / counts after everything
  const dupCheck = await q("select lower(name) n, coalesce(company_id::text, user_id::text) s, lower(coalesce(email,'')) e, count(*)::int c from public.customers where email is not null group by 1,2,3 having count(*) > 1");
  check("C29 no duplicate records with the same name + email", dupCheck.length === 0, JSON.stringify(dupCheck));

  // Mobile + themes
  for (const [kind, theme] of [["phone", "light"], ["phone", "dark"], ["desktop", "dark"], ["desktop", "black"]]) {
    const x = await newPage(kind, theme);
    await go(x, "/dashboard/customers");
    const overflow = await x.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`T1 ${kind} ${theme}: directory renders without sideways scroll`, (await x.locator("[data-testid=customer-row]").count()) >= 5 && overflow <= 1, `overflow ${overflow}px`);
    await shot(x, `customers-${kind}-${theme}`);
    await go(x, `/dashboard/customers/${pat.id}`);
    const o2 = await x.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`T2 ${kind} ${theme}: customer detail renders without sideways scroll`, o2 <= 1, `overflow ${o2}px`);
    await shot(x, `customer-detail-${kind}-${theme}`);
    await x.context().close();
  }

  // Existing workflows: dashboard still lists bids
  await go(p, "/dashboard");
  check("C30 Bids dashboard still works", (await p.getByText("Siding replacement – Johnson residence").count()) > 0);
}

check("X no page errors", errors.length === 0, errors.slice(0, 3).join(" || "));
fs.writeFileSync(`${out}/results-${PART}.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close(); await db.end();
process.exit(failed.length ? 1 : 0);
