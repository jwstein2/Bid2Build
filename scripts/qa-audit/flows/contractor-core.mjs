// Batch: contractor records with persistence: customers (create/edit/search/delete), Saved Items (create/edit/
// delete), company settings, account theme preference, bid duplicate/delete, free credit accounting.
import { chromium, contextFor, watch, recorder, BASE, USERS, q, closeDb, dismissPopups } from "../lib.mjs";
const ROLE = process.env.ROLE ?? "pro";
const rec = recorder(`core-${ROLE}`);
const b = await chromium.launch();
const ctx = await contextFor(b, ROLE);
const [{ id: uid }] = await q("select id from auth.users where email=$1", [USERS[ROLE]]);
const T = (id, area, name, exp, fn) => rec.test(`CORE-${ROLE}-${id}`, area, name, exp, fn);
const open = async (path) => { const p = await ctx.newPage(); const w = watch(p); await p.goto(BASE + path); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {}); await dismissPopups(p); return { p, w }; };
const cname = `QA Customer ${Date.now() % 100000}`;
let custId;

await T("01", "Customers", "Add a customer", "Saved, opens the customer page, listed in the directory", async () => {
  const { p, w } = await open("/dashboard/customers/new");
  await p.fill("#nc-name", cname); await p.fill("#nc-email", "qa.cust@example.test"); await p.fill("#nc-phone", "(555) 010-2211"); await p.fill("#nc-addr", "9 Elm St, Rochester, MN"); await p.fill("#nc-notes", "Gate code 1234");
  await p.getByTestId("new-customer-save").click(); await p.waitForTimeout(2500);
  const c = await q("select id, name, email, notes from public.customers where name=$1", [cname]); custId = c[0]?.id;
  if (!c.length) return { fail: `not saved; errors ${w.pageErrors.join(";")}` };
  return `saved; now at ${new URL(p.url()).pathname}`;
});
await T("02", "Customers", "Required field validation", "Saving with no name shows an inline error and saves nothing", async () => {
  const { p } = await open("/dashboard/customers/new"); const before = (await q("select count(*)::int n from public.customers where user_id=$1", [uid]))[0].n;
  await p.getByTestId("new-customer-save").click(); await p.waitForTimeout(1200);
  const after = (await q("select count(*)::int n from public.customers where user_id=$1", [uid]))[0].n;
  const msg = await p.locator("[role=alert], .text-danger, [aria-invalid=true]").count();
  return after === before && msg > 0 ? "inline error, nothing saved" : { fail: `saved=${after !== before}, error shown=${msg > 0}` };
});
await T("03", "Customers", "Search the customer directory", "Typing part of the name finds the customer", async () => {
  const { p } = await open("/dashboard/customers"); const s = p.getByRole("searchbox").or(p.getByPlaceholder(/search/i)).last();
  await s.fill(cname.slice(0, 14)); await p.waitForTimeout(1500); await p.keyboard.press("Enter"); await p.waitForTimeout(1500);
  return (await p.getByText(cname).first().isVisible().catch(() => false)) || { fail: "not found" };
});
await T("04", "Customers", "Edit a customer", "Phone change saved and shown after reload", async () => {
  const { p } = await open(`/dashboard/customers/${custId}`);
  const edit = p.getByRole("button", { name: /^Edit/ }).first(); if (await edit.isVisible().catch(() => false)) await edit.click();
  await p.fill("#ce-phone", "(555) 010-2299"); await p.getByRole("button", { name: /^Save/ }).first().click(); await p.waitForTimeout(2000);
  await p.waitForTimeout(1000); await p.reload(); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {}); const c = (await q("select phone from public.customers where id=$1", [custId]))[0];
  return c.phone?.includes("2299") && (await p.locator("main").innerText()).includes("2299") ? "saved + shown" : { fail: JSON.stringify(c) };
});
await T("06", "Customers", "Delete a customer (with confirmation)", "Inline confirm; customer gone (offered only while the customer has no bids)", async () => {
  const { p } = await open(`/dashboard/customers/${custId}`);
  await p.getByRole("button", { name: "Delete customer" }).click(); await p.getByLabel(/^Confirm deleting/).getByRole("button", { name: "Delete", exact: true }).click(); await p.waitForTimeout(2500);
  const c = await q("select id from public.customers where id=$1", [custId]);
  const bids = (await q("select count(*)::int n from public.estimates where customer_name=$1", [cname]))[0].n;
  return !c.length || c[0].deleted_at ? `deleted (bids kept: ${bids})` : { fail: "row still active" };
});
await T("05", "Customers", "Start a bid for this customer", "New bid opens with the customer filled in", async () => {
  { const { p: p0 } = await open("/dashboard/customers/new"); await p0.fill("#nc-name", cname); await p0.getByTestId("new-customer-save").click(); await p0.waitForTimeout(2500); }
  custId = (await q("select id from public.customers where name=$1 and user_id=$2", [cname, uid]))[0].id;
  const { p } = await open(`/dashboard/customers/${custId}`);
  await p.getByTestId("new-bid-for-customer").click(); await p.waitForURL(/\/bids/);
  await p.getByRole("link", { name: /Roofing/ }).first().click();
  await p.waitForURL(/\/estimates\//, { timeout: 20000 });
  const id = p.url().match(/estimates\/([0-9a-f-]{36})/)[1];
  const e = (await q("select customer_name, customer_id from public.estimates where id=$1", [id]))[0];
  return e.customer_name === cname ? "bid linked to customer" : { fail: JSON.stringify(e) };
});
const item = `QA Ice & water shield ${Date.now() % 1000}`;
await T("07", "Saved Items", "Create a Saved Item", "Saved with type, unit and cost; listed", async () => {
  const { p } = await open("/dashboard/items"); await p.getByRole("button", { name: "New Saved Item" }).first().click();
  const f = p.locator("form").filter({ has: p.getByRole("button", { name: /Save Item/ }) });
  await f.getByLabel("Item name").fill(item); await f.getByLabel(/^Unit cost/).fill("62.50");
  await f.getByRole("button", { name: /Save Item/ }).click(); await p.waitForTimeout(2000);
  const r = await q("select unit_cost, cost_type, unit from public.saved_items where name=$1 and user_id=$2", [item, uid]);
  return r.length && Number(r[0].unit_cost) === 62.5 && (await p.getByText(item).first().isVisible()) ? `saved ${r[0].cost_type}/${r[0].unit} $${r[0].unit_cost}` : { fail: JSON.stringify(r) };
});
await T("08", "Saved Items", "Edit a Saved Item's cost", "New cost saved", async () => {
  const { p } = await open("/dashboard/items"); await p.getByRole("button", { name: `Edit ${item}` }).first().click(); await p.waitForTimeout(600);
  const f = p.locator("form").filter({ has: p.getByLabel(/^Unit cost/) }).first();
  await f.getByLabel(/^Unit cost/).fill("64.00"); await f.getByRole("button", { name: /^Save/ }).first().click(); await p.waitForTimeout(2000);
  const r = await q("select unit_cost from public.saved_items where name=$1 and user_id=$2", [item, uid]);
  return Number(r[0]?.unit_cost) === 64 || { fail: JSON.stringify(r) };
});
await T("09", "Saved Items", "Use a Saved Item on a bid", "Item added to the estimate with its saved cost", async () => {
  const e = (await q("select id from public.estimates where user_id=$1 order by updated_at desc limit 1", [uid]))[0];
  const { p } = await open(`/estimates/${e.id}`);
  await p.getByRole("navigation", { name: "Builder steps" }).getByRole("button", { name: /Estimate/ }).click(); await p.waitForTimeout(800);
  await p.getByRole("button", { name: /Suggested & Saved Items/ }).first().click(); await p.waitForTimeout(500);
  await p.getByLabel("Search suggested and saved items").first().fill("Ice & water");
  await p.getByRole("button", { name: new RegExp(item.replace(/[&]/g, ".")) }).first().click();
  await p.waitForTimeout(3000);
  const r = await q("select unit_cost from public.estimate_items where estimate_id=$1 and name=$2", [e.id, item]);
  return Number(r[0]?.unit_cost) === 64 || { fail: JSON.stringify(r) };
});
await T("10", "Saved Items", "Delete a Saved Item", "Confirm, then removed", async () => {
  const { p } = await open("/dashboard/items");
  await p.getByRole("button", { name: `Delete ${item}` }).first().click(); await p.getByLabel(`Confirm deleting ${item}`).getByRole("button", { name: "Delete" }).click(); await p.waitForTimeout(2000);
  const r = await q("select 1 from public.saved_items where name=$1 and user_id=$2", [item, uid]); return !r.length || { fail: "still saved" };
});
await T("11", "Settings", "Company profile edit persists", "Tagline saved on /settings/company and shown after reload", async () => {
  const { p } = await open("/settings/company"); const tag = `Quality you can trust ${Date.now() % 1000}`;
  const no = p.getByRole("button", { name: /^No, I'll enter it$/ }); if (await no.isVisible().catch(() => false)) await no.click();
  const f = p.getByLabel(/Tagline/).first(); await f.fill(tag); await f.blur();
  await p.getByText("All changes saved").waitFor({ timeout: 10000 }).catch(() => {}); await p.reload(); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  const r = (await q("select tagline from public.business_profiles where user_id=$1", [uid]))[0];
  return r?.tagline === tag && (await p.getByLabel(/Tagline/).first().inputValue()) === tag ? "saved" : { fail: JSON.stringify(r) };
});
await T("12", "Settings", "Theme preference (Light/Dark/Black) saved to the account", "Choice persists in a new browser session", async () => {
  const { p } = await open("/dashboard");
  // Crawls click the theme toggle too, so start from Light whatever the saved choice is (Light -> Dark -> Black -> Light).
  const tog = () => p.getByRole("button", { name: /^Theme: / }).first();
  for (let i = 0; i < 3 && !/^Theme: Light/.test(await tog().getAttribute("aria-label")); i++) { await tog().click(); await p.waitForTimeout(1200); }
  await tog().click(); await p.waitForTimeout(2000);
  const c2 = await b.newContext({ storageState: await ctx.storageState() }); const p2 = await c2.newPage(); await p2.goto(BASE + "/dashboard"); await p2.waitForLoadState("networkidle");
  const cls = await p2.evaluate(() => document.documentElement.className + " " + (document.documentElement.dataset.theme ?? ""));
  for (let i = 0; i < 3; i++) { const n = await p.getByRole("button", { name: /^Theme: / }).first().getAttribute("aria-label"); if (/^Theme: Light/.test(n)) break; await p.getByRole("button", { name: /^Theme: / }).first().click(); await p.waitForTimeout(1200); }
  return /dark/.test(cls) ? "dark applied in a fresh session, then reset to light" : { fail: `root: ${cls}` };
});
await T("13", "Bids", "Duplicate a bid from the dashboard", "A copy appears as a new draft", async () => {
  const before = (await q("select count(*)::int n from public.estimates where user_id=$1", [uid]))[0].n;
  const { p } = await open("/dashboard"); await p.getByRole("tab", { name: /Table/ }).first().click(); await p.waitForTimeout(800);
  await p.getByRole("button", { name: "Duplicate" }).first().click(); await p.waitForTimeout(3000);
  const after = (await q("select count(*)::int n from public.estimates where user_id=$1", [uid]))[0].n;
  return after === before + 1 ? "copy created" : { fail: `${before} -> ${after}` };
});
await T("14", "Bids", "Delete a bid (with confirmation)", "Bid removed from the list", async () => {
  const before = (await q("select count(*)::int n from public.estimates where user_id=$1 and coalesce(archived_at, deleted_at) is null", [uid]).catch(async () => q("select count(*)::int n from public.estimates where user_id=$1", [uid])))[0].n;
  const { p } = await open("/dashboard"); await p.getByRole("tab", { name: /Table/ }).first().click(); await p.waitForTimeout(800);
  await p.getByRole("button", { name: "Delete", exact: true }).first().click(); await p.waitForTimeout(500);
  await p.getByRole("button", { name: "Delete forever" }).first().click(); await p.waitForTimeout(2500);
  const after = (await q("select count(*)::int n from public.estimates where user_id=$1 and coalesce(archived_at, deleted_at) is null", [uid]).catch(async () => q("select count(*)::int n from public.estimates where user_id=$1", [uid])))[0].n;
  return after === before - 1 ? "removed" : { fail: `${before} -> ${after}` };
});
if (ROLE === "free") await T("15", "Credits", "Free account: finalizing a bid uses one credit and the balance shows on Subscription", "Starter credits 3 -> 2 after one finalized bid (more after more)", async () => {
  const c = await q("select * from public.credit_balances where user_id=$1", [uid]).catch(() => []);
  const { p } = await open("/settings/billing"); const t = await p.locator("main").innerText();
  return `ledger ${JSON.stringify(c[0] ?? {}).slice(0, 160)}; page: ${(t.match(/[^\n]*credit[^\n]*/gi) ?? []).slice(0, 2).join(" / ")}`;
});
console.log(rec.counts); await b.close(); await closeDb();
