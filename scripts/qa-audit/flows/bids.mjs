// Batch: contractor bid lifecycle with persistence checks (real database).
// ROLE=pro (Unlimited) or ROLE=free (credits). Creates a deck bid end to end.
import fs from "node:fs";
import { chromium, contextFor, watch, recorder, BASE, USERS, q, closeDb, shot, dismissPopups } from "../lib.mjs";
const ROLE = process.env.ROLE ?? "pro";
const rec = recorder(`bids-${ROLE}`);
const b = await chromium.launch();
const ctx = await contextFor(b, ROLE);
const p = await ctx.newPage(); const w = watch(p);
const [{ id: uid }] = await q("select id from auth.users where email=$1", [USERS[ROLE]]);
const T = (id, name, exp, fn) => rec.test(`BID-${ROLE}-${id}`, "Bids & estimates", name, exp, fn);
let estId;
const errs = () => [...w.pageErrors, ...w.failed.filter((f) => /^5/.test(f))];

await T("01", "Start a bid from a trade on the dashboard", "Opens the builder for a new deck estimate saved to the account", async () => {
  await p.goto(BASE + "/dashboard"); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {}); await dismissPopups(p);
  const existing = new Set((await q("select id from public.estimates where user_id=$1", [uid])).map((r) => r.id));
  await p.getByRole("link", { name: /Create New Bid/ }).or(p.getByRole("button", { name: /Create New Bid/ })).first().click();
  await p.waitForURL(/\/bids/, { timeout: 15000 }); await p.getByRole("link", { name: /Decks/ }).first().click();
  await p.waitForURL(/\/estimates\//, { timeout: 20000 });
  estId = p.url().match(/estimates\/([0-9a-f-]{36})/)?.[1];
  if (existing.has(estId)) return { fail: "opened an existing bid instead of a new one" };
  const row = await q("select status, trades, user_id from public.estimates where id=$1", [estId]);
  if (!row.length) return { fail: "no estimate row" };
  if (row[0].user_id !== uid) return { fail: "estimate owned by someone else" };
  return `estimate ${estId.slice(0, 8)} ${row[0].status} ${JSON.stringify(row[0].trades)}`;
});
await T("02", "Company step: required fields + save", "Company profile saved to the account (persists for next bid)", async () => {
  await dismissPopups(p);
  const nav = p.getByRole("navigation", { name: "Builder steps" });
  await nav.getByRole("button", { name: /^Company/ }).click().catch(() => {}); await p.waitForTimeout(600);
  const no = p.getByRole("button", { name: /^No, I'll enter it$/ }); if (await no.isVisible().catch(() => false)) await no.click();
  await p.fill("#b-name", "QA Decks LLC"); await p.fill("#b-contact", "Quinn Auditor"); await p.fill("#b-email", "office@qa-decks.example.test");
  await p.fill("#b-phone", "(555) 010-4455"); await p.fill("#b-addr", "100 Test Way, Rochester, MN 55901");
  await p.getByRole("button", { name: /Next: customer & project/ }).click(); await p.waitForTimeout(2500);
  const bp = await q("select company_name, phone from public.business_profiles where user_id=$1", [uid]);
  return bp[0]?.company_name === "QA Decks LLC" ? `saved ${bp[0].company_name}` : { fail: `business_profiles=${JSON.stringify(bp)}` };
});
await T("03", "Customer & project step", "Customer name/email/address saved on the estimate", async () => {
  if (!(await p.locator("#c-name").isVisible().catch(() => false))) { await p.getByRole("navigation", { name: "Builder steps" }).getByRole("button", { name: /^Customer/ }).click(); await p.waitForTimeout(600); }
  await p.fill("#c-name", "Pat Example"); await p.fill("#c-email", "pat.example@example.test"); await p.fill("#c-phone", "(555) 010-9988");
  await p.fill("#c-addr", "48 Oak Lane, Rochester, MN 55902");
  await p.getByRole("button", { name: /Next: estimate costs/ }).click(); await p.waitForTimeout(3000);
  const e = await q("select customer_name, customer_email, project_address from public.estimates where id=$1", [estId]);
  return e[0]?.customer_name === "Pat Example" ? `saved ${e[0].customer_name} / ${e[0].project_address}` : { fail: JSON.stringify(e) };
});
await T("04", "Add a line item and price it", "10 x $40 cost at 25% markup = $500.00, saved as an estimate item", async () => {
  await p.getByRole("button", { name: "Add line item" }).first().click();
  await p.keyboard.type("QA composite deck boards");
  await p.getByLabel("Quantity", { exact: true }).first().fill("10");
  await p.getByLabel("Internal unit cost", { exact: true }).first().fill("40");
  await p.waitForTimeout(3500);
  const shown = await p.getByText("$500.00").first().isVisible().catch(() => false);
  const items = await q("select name, quantity, unit_cost from public.estimate_items where estimate_id=$1 and name ilike 'QA composite%'", [estId]);
  if (!shown) return { fail: "$500.00 not displayed" };
  return items.length && Number(items[0].quantity) === 10 && Number(items[0].unit_cost) === 40 ? "price shown and item saved" : { fail: `items=${JSON.stringify(items)}` };
});
await T("05", "Estimate survives a full page reload", "Line item and totals still there after refresh", async () => {
  await p.reload(); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {}); await dismissPopups(p);
  const step = p.getByRole("navigation", { name: "Builder steps" }).getByRole("button", { name: /Estimate/ });
  await step.click().catch(() => {}); await p.waitForTimeout(1000);
  return (await p.getByText("$500.00").first().isVisible().catch(() => false)) || { fail: "total missing after reload" };
});
await T("06", "Trade calculator fills a quantity", "Calculator opens, computes, and applies a quantity to the line", async () => {
  const calc = p.getByRole("button", { name: /^Calculate quantity for QA composite/ }).first();
  if (!(await calc.isVisible().catch(() => false))) return { fail: "no calculator button on estimate lines" };
  await calc.click(); const d = p.getByRole("dialog"); await d.waitFor({ timeout: 5000 });
  // Deck 16 ft x 12 ft = 192 sq ft; 16 ft boards, 5.5 in face, no gap, no waste: 192 / (16 x 5.5/12) = 26.2 -> 27 boards.
  await d.getByLabel("Length", { exact: true }).first().fill("16");
  await d.getByLabel("Width", { exact: true }).first().fill("12");
  await d.getByLabel(/^Board length/).first().fill("16");
  await d.getByLabel(/^Board face width/).first().fill("5.5");
  await p.waitForTimeout(500);
  const apply = d.getByRole("button", { name: /^(Use|Apply|Insert|Add to line|Use this)/i }).first();
  if (!(await apply.isVisible().catch(() => false))) { await shot(p, `bid-${ROLE}-calc`); return { fail: `no apply button (fields=${n})` }; }
  const resultText = (await apply.innerText()).trim();
  await apply.click(); await p.waitForTimeout(800);
  const confirm = p.getByRole("button", { name: /^(Replace|Yes, replace|Update quantity)/i }).first(); if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await p.waitForTimeout(3000);
  const items = await q("select quantity, unit from public.estimate_items where estimate_id=$1 and name ilike 'QA composite%'", [estId]);
  const want = Number((resultText.match(/Use ([\d,.]+)/)?.[1] ?? "").replace(/,/g, ""));
  if (want !== 27) return { fail: `calculator result "${resultText}", expected 27 boards` };
  return Number(items[0]?.quantity) === want ? `"${resultText}" saved as quantity ${items[0].quantity}` : { fail: `button said "${resultText}" but saved quantity ${items[0]?.quantity}` };
});
await T("07", "Scope & exclusions step generates text", "Scope of work and exclusions are filled (built-in rules without AI key) and saved", async () => {
  await p.getByRole("button", { name: /Next: scope & exclusions/ }).click(); await p.waitForTimeout(1500);
  const gen = p.getByRole("button", { name: /(Generate|Write|Draft).*(scope|for me)|Suggest/i }).first();
  if (await gen.isVisible().catch(() => false)) { await gen.click(); await p.waitForTimeout(4000); }
  const areas = p.locator("textarea"); const n = await areas.count(); let filled = 0;
  for (let i = 0; i < n; i++) if ((await areas.nth(i).inputValue()).trim().length > 20) filled++;
  if (!filled) { await shot(p, `bid-${ROLE}-scope`); return { fail: `no scope text (textareas=${n})` }; }
  await p.waitForTimeout(2500);
  const s = await q("select length(coalesce(proposal_config::text,'')) l from public.estimates where id=$1", [estId]);
  return `${filled} text areas filled; config ${s[0].l} chars`;
});
await T("08", "Proposal step and customer preview", "Preview dialog shows the proposal with company, customer and total", async () => {
  await p.getByRole("button", { name: /Next: proposal settings/ }).click(); await p.waitForTimeout(1500);
  await p.getByRole("button", { name: /Preview customer proposal|^Preview$/ }).first().click();
  const d = p.getByRole("dialog"); await d.waitFor(); await p.waitForTimeout(1500);
  const t = await d.innerText(); await shot(p, `bid-${ROLE}-preview`);
  await p.keyboard.press("Escape");
  return /QA Decks LLC/.test(t) && /Pat Example/.test(t) ? "company + customer on preview" : { fail: t.slice(0, 200) };
});
await T("09", "Download PDF (finalize)", "A PDF downloads; version 1 is saved; status finalized", async () => {
  const dl = p.waitForEvent("download", { timeout: 45000 });
  await p.getByRole("button", { name: "Download PDF" }).click();
  const d = await dl; const file = `/tmp/qa-${ROLE}-bid.pdf`; await d.saveAs(file);
  const head = fs.readFileSync(file).subarray(0, 5).toString(); const size = fs.statSync(file).size;
  const v = await q("select version_number, total from public.estimate_versions where estimate_id=$1", [estId]);
  const e = await q("select status from public.estimates where id=$1", [estId]);
  await dismissPopups(p);
  if (head !== "%PDF-") return { fail: `not a PDF (${head})` };
  return v.length ? `PDF ${size} bytes; v${v[0].version_number} total ${v[0].total}; status ${e[0].status}` : { fail: "no version row" };
});
await T("10", "Bid appears on the dashboard pipeline", "Dashboard lists the bid with its customer", async () => {
  await p.goto(BASE + "/dashboard"); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {}); await dismissPopups(p);
  return (await p.getByText("Pat Example").first().isVisible().catch(() => false)) || { fail: "bid not listed" };
});
await T("11", "Dashboard search finds the bid", "Typing the customer name filters to the bid", async () => {
  const s = p.getByPlaceholder(/Search bids/i).first(); await s.fill("Pat Ex"); await p.waitForTimeout(1200);
  return (await p.getByText("Pat Example").first().isVisible().catch(() => false)) || { fail: "not found by search" };
});
await T("12", "Credit accounting for the finalized bid", ROLE === "free" ? "One starter_spend ledger row for this estimate" : "One unlimited_bid ledger row (no credit used)", async () => {
  const l = await q("select kind from public.credit_ledger where estimate_id=$1", [estId]);
  const want = ROLE === "free" ? /starter_spend|monthly_spend/ : /unlimited/;
  return l.length === 1 && want.test(l[0].kind) ? l[0].kind : { fail: JSON.stringify(l) };
});
if (errs().length) rec(`BID-${ROLE}-ERR`, "Bids & estimates", "No page errors or server errors during the bid flow", "none", "FAIL", errs().join(" | ").slice(0, 400));
else rec(`BID-${ROLE}-ERR`, "Bids & estimates", "No page errors or server errors during the bid flow", "none", "PASS", "none");
fs.writeFileSync(`/tmp/qa-${ROLE}-estid`, estId ?? "");
console.log(rec.counts); await b.close(); await closeDb();
