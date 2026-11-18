// V6.9 walk seed (TEST DATA ONLY, local throwaway database from scripts/financials/setup-db.mjs):
// tax setup + rate/rule changes + alerts, a PRACTICE (mock) bank connection with a feed, and cash-plan entries.
//   export RADAR_PG_URL=$(node scripts/financials/setup-db.mjs) && node scripts/tax-banking/seed.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Client } = require("pg");
const ME = "00000000-0000-4000-8000-000000000001";
const c = new Client({ connectionString: process.env.RADAR_PG_URL }); await c.connect();
const as = async (u, sql, args = []) => {
  await c.query("begin"); await c.query("set local role authenticated"); await c.query("select set_config('request.jwt.claim.sub', $1, true)", [u]);
  try { const r = await c.query(sql, args); await c.query("commit"); return r.rows[0]; } catch (e) { await c.query("rollback"); throw e; }
};
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const book = (await c.query("select id from public.fin_books where sandbox_of is null order by created_at limit 1")).rows[0].id;

await as(ME, "select public.fin_tax_profile_save($1, $2)", [book, { primaryState: "MN", serviceStates: ["WI", "IA"], businessType: "general_contractor", workMix: "residential", defaultContract: "lump_sum",
  registrations: [{ state: "MN", registered: true }], address: { line1: "120 Main St", city: "Rochester", state: "MN", zip: "55901" } }]);
await c.query("insert into public.tax_sync_runs (kind, provider, status, started_at, finished_at, api_calls) values ('rates', 'mock', 'ok', now() - interval '5 hours', now() - interval '5 hours', 12)");
const rec = (p) => c.query("select public.tax_change_record($1) as r", [{ source: "provider", provider: "mock", verified: true, sourcesAgree: true, ...p }]).then((x) => x.rows[0].r);
const a = await rec({ state: "MN", jurisdictionCode: "MN-OLMSTED", jurisdictionName: "Olmsted County", level: "county", kind: "rate", oldRate: "0.500", newRate: "0.750", effectiveDate: day(43), summary: "Olmsted County sales tax rises from 0.5% to 0.75%", sourceUrl: "https://www.revenue.state.mn.us/" });
const b = await rec({ state: "WI", jurisdictionCode: "WI", jurisdictionName: "Wisconsin", level: "state", kind: "taxability", effectiveDate: day(20), summary: "Wisconsin updates guidance on materials used in real property construction", sourceUrl: "https://www.revenue.wi.gov/", verified: false });
for (const x of [a, b]) await c.query("select public.tax_fanout_alerts($1)", [x.id ?? x.changeId ?? x]);
await c.query("update public.tax_authorities set source_status = 'reachable', last_checked_at = now() - interval '5 hours' where state in ('MN', 'WI', 'IA', 'TN', 'TX')");

const r = (await as(ME, "select public.fin_bank_connection_create($1, $2) as r", [book, { provider: "mock", itemRef: "mock-item-walk", institutionName: "Sandbox Community Bank (mock)", sandbox: true,
  accounts: [{ ref: "mock-chk", name: "Business Checking", mask: "4821", kind: "checking" }, { ref: "mock-sav", name: "Business Savings", mask: "9034", kind: "savings" }] }])).r;
const now = new Date().toISOString();
await c.query("select public.fin_bank_feed_ingest($1, $2)", [r.connectionId, { status: "active",
  balances: [{ ref: "mock-chk", current: "42500.00", available: "41250.00", asOf: now }, { ref: "mock-sav", current: "8000.00", available: "8000.00", asOf: now }],
  transactions: [
    { ref: "mock-chk", txnRef: "w1", date: day(-9), description: "Deposit Sam Ortiz", amount: "6250.00" },
    { ref: "mock-chk", txnRef: "w2", date: day(-6), description: "Check 1001 Lumber Yard", amount: "-980.00", checkNumber: "1001" },
    { ref: "mock-chk", txnRef: "w3", date: day(-3), description: "Online transfer to savings", amount: "-1000.00" },
    { ref: "mock-sav", txnRef: "w4", date: day(-3), description: "Online transfer from checking", amount: "1000.00" }] }]);
const chk = r.accounts[0].accountId;
// The spec's example: 42,500 − 6,000 payroll − 2,500 supplier + 15,000 deposit − 3,000 sub = 46,000.
for (const p of [
  { kind: "payroll", label: "Biweekly payroll", amount: "6000.00", expectedOn: day(4), recurrence: "biweekly", certainty: "scheduled", accountId: chk },
  { kind: "supplier_payment", label: "ABC Supply statement", amount: "2500.00", expectedOn: day(7), certainty: "scheduled" },
  { kind: "expected_deposit", label: "Rivera deck: 2nd payment", amount: "15000.00", expectedOn: day(12), certainty: "expected" },
  { kind: "sub_payment", label: "Bright Line Electric draw", amount: "3000.00", expectedOn: day(16), certainty: "scheduled" },
  { kind: "recurring_expense", label: "Shop rent", amount: "1800.00", expectedOn: day(9), recurrence: "monthly", certainty: "scheduled" },
]) await as(ME, "select public.fin_cash_event_save($1, $2)", [book, p]);
console.log(JSON.stringify({ book, connection: r.connectionId }));
await c.end();
