/**
 * V6.9 tax intelligence + connected banking: pure logic (engine, provider mappings, forecast, isolation).
 * Scenario numbers refer to the V6.9 spec's 40 required test scenarios; the database half is in
 * tests/db/tax-banking.test.ts. Everything here uses fixtures and mocked fetch: no network, no real provider.
 */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { TAX_AUTHORITIES, hasGeneralSalesTax } from "@/lib/tax-banking/authorities";
import { CAPABILITIES, WIDGETS, can, forecastStartsFromBank } from "@/lib/tax-banking/capabilities";
import { assertTestIsolation, bankProviderMode, liveCredentialsPresent, taxProviderMode } from "@/lib/tax-banking/isolation";
import { calculateTax, explainDifference, validAddress } from "@/lib/tax-banking/tax/engine";
import { avalaraProvider, mockProvider, resolveTaxProvider, stripeTaxProvider, taxjarProvider } from "@/lib/tax-banking/tax/providers";
import { detectChanges, upcomingCheckDates } from "@/lib/tax-banking/tax/sync";
import type { TaxRequest } from "@/lib/tax-banking/tax/types";
import { mockBankProvider, plaidProvider, resolveBankProvider } from "@/lib/tax-banking/bank/providers";
import { openToken, sealToken, MOCK_TOKEN_KEY } from "@/lib/tax-banking/bank/token-crypto";
import { buildForecast, customerLateness, detectTransfers, type ForecastInput } from "@/lib/tax-banking/forecast";

beforeAll(() => assertTestIsolation());   // scenario 40: fail closed if real credentials are present

const MIG = readFileSync("supabase/migrations/20261226001000_tax_banking.sql", "utf8");
const deck: TaxRequest["lines"] = [
  { ref: "mat", amount: "6000.00", classification: "materials", taxableHint: true },
  { ref: "lab", amount: "4000.00", classification: "labor_new_construction", taxableHint: false },
];
const req = (zip: string, state: string, date = "2026-11-18", extra: Partial<TaxRequest> = {}): TaxRequest =>
  ({ address: { line1: "1 Main St", city: "Fixture", state, zip }, transactionDate: date, lines: deck, contract: "lump_sum", ...extra });

describe("state authority registry", () => {
  it("covers all 50 states + DC once, official https homepages, and matches the SQL seed", () => {
    expect(TAX_AUTHORITIES).toHaveLength(51);
    expect(new Set(TAX_AUTHORITIES.map((a) => a.state)).size).toBe(51);
    for (const a of TAX_AUTHORITIES) {
      expect(a.website).toMatch(/^https:\/\/[a-z0-9.-]+\.(gov|com|us)\b/);
      expect(MIG).toContain(`('${a.state}', '${a.stateName.replace(/'/g, "''")}', '${a.authority.replace(/'/g, "''")}', '${a.website}', '${a.system}', ${a.sst}`);
    }
    expect(TAX_AUTHORITIES.find((a) => a.state === "MN")?.authority).toBe("Minnesota Department of Revenue");
    expect(TAX_AUTHORITIES.find((a) => a.state === "TN")?.authority).toBe("Tennessee Department of Revenue");
  });
  it("does not assume every state has a statewide sales tax", () => {
    for (const s of ["DE", "MT", "NH", "OR"]) expect(hasGeneralSalesTax(s)).toBe(false);
    expect(TAX_AUTHORITIES.find((a) => a.state === "AK")?.system).toBe("local_only");
    expect(TAX_AUTHORITIES.find((a) => a.state === "HI")?.system).toBe("gross_receipts");
  });
});

describe("capabilities", () => {
  it("TS capability map mirrors tb_capability_key() in SQL", () => {
    for (const [k, v] of Object.entries(CAPABILITIES)) expect(MIG).toContain(`when '${k}' then '${v.needs}'`);
  });
  it("scenario 39: bank data is accountant/bookkeeper-level; view-only and sales roles can't see balances", () => {
    expect(can(["view_company_financials", "view_project_financials"], "bank.view_balances")).toBe(false);
    expect(can(["reconcile"], "bank.view_balances")).toBe(true);
    expect(forecastStartsFromBank(["view_company_financials"])).toBe(false);
    expect(WIDGETS.map((w) => w.key)).toEqual(["tax_updates", "cash_position"]);
  });
});

describe("tax engine (mock provider, fixture data)", () => {
  const p = mockProvider();
  it("scenarios 4 + 7: two jurisdictions in one state get different rates; materials taxed, labor not", async () => {
    const a = await calculateTax({ request: req("55901", "MN"), provider: p, companyRate: "0" });
    const b = await calculateTax({ request: req("55401", "MN"), provider: p, companyRate: "0" });
    expect(a.combinedRate).toBe("7.875");
    expect(b.combinedRate).toBe("8.025");
    expect(a.taxableAmount).toBe("6000.00");
    expect(a.nontaxableAmount).toBe("4000.00");
    expect(a.taxAmount).toBe("472.50");
    expect(a.status).toBe("calculated");
    expect(a.jurisdictions.reduce((s, j) => s + Number(j.tax), 0).toFixed(2)).toBe("472.50");
  });
  it("scenarios 1 + 5: a Minnesota rate change with a future effective date applies only from that date", async () => {
    const before = await calculateTax({ request: req("55901", "MN", "2026-12-31"), provider: p, companyRate: "0" });
    const after = await calculateTax({ request: req("55901", "MN", "2027-01-01"), provider: p, companyRate: "0" });
    expect(before.combinedRate).toBe("7.875");
    expect(after.combinedRate).toBe("8");
  });
  it("scenario 2: a Tennessee local rate update applies to transactions on or after its date", async () => {
    expect((await calculateTax({ request: req("37201", "TN", "2026-09-30"), provider: p, companyRate: "0" })).combinedRate).toBe("9.25");
    expect((await calculateTax({ request: req("37201", "TN", "2026-10-01"), provider: p, companyRate: "0" })).combinedRate).toBe("9.75");
  });
  it("scenario 3: one company serving several states gets each state's own treatment", async () => {
    const mn = await calculateTax({ request: req("55901", "MN"), provider: p, companyRate: "0" });
    const or = await calculateTax({ request: req("97001", "OR"), provider: p, companyRate: "0" });
    expect(Number(mn.taxAmount)).toBeGreaterThan(0);
    expect(or.taxAmount).toBe("0.00");
    expect(or.jurisdictions).toHaveLength(0);
  });
  it("scenario 8: construction treatment the provider can't settle is flagged for review, not guessed", async () => {
    const tx = await calculateTax({ request: req("75001", "TX"), provider: p, companyRate: "0" });
    expect(tx.status).toBe("needs_review");
    expect(tx.reviewReasons).toContain("construction_treatment_review");
    expect(tx.lines.find((l) => l.ref === "lab")?.taxable).toBe(false);
    const tm = await calculateTax({ request: req("75001", "TX", "2026-11-18", { contract: "time_and_materials" }), provider: p, companyRate: "0" });
    expect(tm.reviewReasons).not.toContain("construction_treatment_review");
  });
  it("scenario 9: an exempt customer with a current certificate pays no tax", async () => {
    const r = await calculateTax({ request: req("55901", "MN"), provider: p, companyRate: "0", exemption: { state: "MN", reason: "nonprofit", certificateOnFile: true, expiresOn: "2027-12-31", certificateRef: "…4411" } });
    expect(r.taxAmount).toBe("0.00");
    expect(r.exemptions[0]).toMatchObject({ applied: true });
  });
  it("scenario 10: missing / expired / other-state certificates do not remove tax", async () => {
    const miss = await calculateTax({ request: req("55901", "MN"), provider: p, companyRate: "0", exemption: { state: "MN", reason: "resale", certificateOnFile: false, expiresOn: null } });
    expect(miss.taxAmount).toBe("472.50");
    expect(miss.reviewReasons).toContain("exemption_missing_certificate");
    const old = await calculateTax({ request: req("55901", "MN"), provider: p, companyRate: "0", exemption: { state: "MN", reason: "resale", certificateOnFile: true, expiresOn: "2025-01-01" } });
    expect(old.reviewReasons).toContain("exemption_expired");
    const wi = await calculateTax({ request: req("55901", "MN"), provider: p, companyRate: "0", exemption: { state: "WI", reason: "resale", certificateOnFile: true, expiresOn: null } });
    expect(wi.reviewReasons).toContain("exemption_other_state");
  });
  it("scenario 11: provider unavailable never fabricates a rate (company rate, flagged)", async () => {
    const r = await calculateTax({ request: req("55901", "MN"), provider: mockProvider({ failing: true }), companyRate: "7.5" });
    expect(r.source).toBe("company_rate");
    expect(r.combinedRate).toBe("7.5");
    expect(r.reviewReasons).toEqual(expect.arrayContaining(["provider_unavailable", "no_verified_rate"]));
    expect(r.status).toBe("needs_review");
    // with no company rate either, tax is $0 and flagged rather than invented
    const z = await calculateTax({ request: req("55901", "MN"), provider: mockProvider({ failing: true }), companyRate: "0" });
    expect(z.taxAmount).toBe("0.00");
  });
  it("scenario 12: provider down uses the last verified stored rate, marked stale", async () => {
    const r = await calculateTax({ request: req("55901", "MN"), provider: mockProvider({ failing: true }), companyRate: "0",
      storedRates: [{ jurisdiction: { code: "MN", name: "Minnesota", level: "state", rate: "6.875", taxType: "sales" }, effectiveFrom: "2020-01-01", recordedAt: "2026-08-01T00:00:00Z", source: "provider" }] });
    expect(r.reviewReasons).toContain("stale_rate");
    expect(r.combinedRate).toBe("6.875");
    const old = await calculateTax({ request: req("55901", "MN"), provider: mockProvider({ asOf: "2026-08-01T00:00:00Z" }), companyRate: "0", now: new Date("2026-11-18T00:00:00Z") });
    expect(old.reviewReasons).toContain("stale_rate");
  });
  it("scenario 13: conflicting official/fixture rate vs provider is flagged", async () => {
    const r = await calculateTax({ request: req("55901", "MN"), provider: p, companyRate: "0",
      storedRates: [{ jurisdiction: { code: "MN", name: "Minnesota", level: "state", rate: "6.5", taxType: "sales" }, effectiveFrom: "2020-01-01", recordedAt: "2026-11-01T00:00:00Z", source: "official" }] });
    expect(r.reviewReasons).toContain("conflicting_sources");
  });
  it("scenario 14: an invalid project address is flagged and the provider isn't trusted for it", async () => {
    expect(validAddress({ state: "MN", zip: "559" })).toBe(false);
    expect(validAddress({ state: "ZZ", zip: "55901" })).toBe(false);
    const r = await calculateTax({ request: req("abc", "MN"), provider: p, companyRate: "7" });
    expect(r.reviewReasons).toContain("invalid_address");
    const wrongState = await calculateTax({ request: req("55901", "TN"), provider: p, companyRate: "7" });
    expect(wrongState.reviewReasons).toContain("invalid_address");
  });
  it("scenario 15: precision: rounding once to the cent, parts always add up", async () => {
    const r = await calculateTax({ request: { ...req("55401", "MN"), lines: [{ ref: "a", amount: "333.33", classification: "materials", taxableHint: true }, { ref: "b", amount: "0.01", classification: "materials", taxableHint: true }] }, provider: p, companyRate: "0" });
    expect(r.taxAmount).toBe("26.75");   // 333.34 × 8.025% = 26.7505 → 26.75
    expect(r.lines.reduce((s, l) => s + Math.round(Number(l.tax) * 100), 0)).toBe(2675);
    expect(r.jurisdictions.reduce((s, j) => s + Math.round(Number(j.tax) * 100), 0)).toBe(2675);
  });
  it("no provider configured: today's behavior (contractor rate on their taxable lines), labelled unverified", async () => {
    const r = await calculateTax({ request: req("55901", "MN"), provider: null, companyRate: "8.1" });
    expect(r.source).toBe("company_rate");
    expect(r.taxAmount).toBe("486.00");
    expect(r.status).toBe("calculated");
    expect(r.reviewReasons).toContain("unverified_company_rate");
    const de = await calculateTax({ request: req("19901", "DE"), provider: null, companyRate: "6" });
    expect(de.reviewReasons).toContain("no_general_sales_tax");
  });
  it("estimate vs invoice differences are explained, never silently applied", async () => {
    const inv = await calculateTax({ request: req("55901", "MN", "2027-01-15"), provider: p, companyRate: "0" });
    const d = explainDifference({ rate: "7.875", tax: "472.50", date: "2026-11-18" }, inv);
    expect(d?.difference).toBe("7.50");
    expect(d?.message).toMatch(/signed proposal is not changed/);
  });
});

describe("tax update detection", () => {
  it("checks today and the next three quarter starts", () => {
    expect(upcomingCheckDates(new Date("2026-11-18T08:00:00Z"))).toEqual(["2026-11-18", "2027-01-01", "2027-04-01", "2027-07-01"]);
  });
  it("only differing rates become changes; first sighting is a baseline", () => {
    const area = { state: "MN", zip: "55901" };
    const rates = [{ code: "MN", name: "Minnesota", level: "state" as const, rate: "7.000", taxType: "sales" as const }, { code: "MN-CO-A", name: "County A", level: "county" as const, rate: "0.5", taxType: "sales" as const }];
    const ch = detectChanges(area, "2027-01-01", rates, new Map([["MN", "6.875"], ["MN-CO-A", "0.50000"]]));
    expect(ch).toHaveLength(1);
    expect(ch[0]).toMatchObject({ jurisdictionCode: "MN", oldRate: "6.875", newRate: "7.000", effectiveDate: "2027-01-01", kind: "rate" });
    expect(detectChanges(area, "2026-11-18", rates, new Map())[0].oldRate).toBeNull();
  });
});

describe("provider adapters (mocked fetch, never called live)", () => {
  const fake = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  it("Avalara maps jurisdictions, rates and per-line taxability", async () => {
    let sent: { type?: string; commit?: boolean } = {};
    const f = (async (_u: string, init: RequestInit) => { sent = JSON.parse(String(init.body)); return new Response(JSON.stringify({ code: "SO-1", lines: [
      { lineNumber: "mat", isItemTaxable: true, details: [{ jurisCode: "27", jurisName: "MINNESOTA", jurisType: "STA", rate: 0.06875 }, { jurisCode: "109", jurisName: "OLMSTED", jurisType: "CTY", rate: 0.005 }] },
      { lineNumber: "lab", isItemTaxable: false, details: [] }] }), { status: 201 }); }) as unknown as typeof fetch;
    const r = await avalaraProvider({ accountId: "x", licenseKey: "y", companyCode: "C" }, f).calculate(req("55901", "MN"));
    expect(sent).toMatchObject({ type: "SalesOrder", commit: false });   // quote only: nothing is recorded with the provider
    expect(r.jurisdictions.map((j) => [j.level, j.rate])).toEqual([["state", "6.875"], ["county", "0.5"]]);
    expect(r.lines).toEqual([{ ref: "mat", taxable: true }, { ref: "lab", taxable: false }]);
    await expect(avalaraProvider({ accountId: "x", licenseKey: "y", companyCode: "C" }, fake(503, {})).calculate(req("55901", "MN"))).rejects.toThrow(/avalara_unavailable/);
  });
  it("TaxJar maps the breakdown; a 400 means an invalid address", async () => {
    const r = await taxjarProvider({ apiKey: "k", from: { state: "MN", zip: "55901" } }, fake(200, { tax: { jurisdictions: { state: "MN", county: "OLMSTED" },
      breakdown: { state_tax_rate: 0.06875, county_tax_rate: 0.005, line_items: [{ id: "mat", tax_collectable: 412.5 }, { id: "lab", tax_collectable: 0 }] } } })).calculate(req("55901", "MN"));
    expect(r.jurisdictions.map((j) => j.rate)).toEqual(["6.875", "0.5"]);
    expect(r.lines.find((l) => l.ref === "lab")?.taxable).toBe(false);
    expect((await taxjarProvider({ apiKey: "k", from: {} }, fake(400, {})).calculate(req("55901", "MN"))).addressValid).toBe(false);
  });
  it("TaxJar is told the job site is the nexus (one platform account calculates for many contractors)", async () => {
    let sent: { nexus_addresses?: { state?: string; zip?: string }[]; from_state?: string; to_zip?: string } = {};
    const f = (async (_u: string, init: RequestInit) => { sent = JSON.parse(String(init.body)); return new Response(JSON.stringify({ tax: { breakdown: { state_tax_rate: 0.07 } } }), { status: 200 }); }) as unknown as typeof fetch;
    await taxjarProvider({ apiKey: "k", from: {} }, f).calculate(req("37203", "TN"));
    expect(sent.nexus_addresses?.[0]).toMatchObject({ state: "TN", zip: "37203" });
    expect(sent.from_state).toBe("TN");
  });
  it("Stripe Tax maps tax_breakdown", async () => {
    const r = await stripeTaxProvider({ secretKey: "sk_test_x" }, fake(200, { id: "taxcalc_1", tax_breakdown: [{ amount: 100, tax_rate_details: { display_name: "Sales Tax", percentage_decimal: "6.875", state: "MN", jurisdiction_level: "state" } }],
      line_items: { data: [{ reference: "mat", amount_tax: 41250 }, { reference: "lab", amount_tax: 0 }] } })).calculate(req("55901", "MN"));
    expect(r.jurisdictions[0]).toMatchObject({ rate: "6.875", level: "state" });
    expect(r.providerRef).toBe("taxcalc_1");
  });
});

describe("isolation (scenario 40)", () => {
  it("paid providers never run without the owner's live switch, and never in tests", () => {
    expect(taxProviderMode({ TAX_PROVIDER: "avalara", AVALARA_ACCOUNT_ID: "a", AVALARA_LICENSE_KEY: "b" })).toBe("none");
    expect(taxProviderMode({ TAX_PROVIDER: "avalara", TAX_PROVIDER_LIVE: "true", AVALARA_ACCOUNT_ID: "a", AVALARA_LICENSE_KEY: "b", VITEST: "true" })).toBe("none");
    expect(taxProviderMode({ TAX_PROVIDER: "avalara", TAX_PROVIDER_LIVE: "true", AVALARA_ACCOUNT_ID: "a", AVALARA_LICENSE_KEY: "b" })).toBe("avalara");
    expect(bankProviderMode({ BANK_PROVIDER: "plaid", PLAID_CLIENT_ID: "a", PLAID_SECRET: "b", BANK_TOKEN_KEY: "c" })).toBe("none");
    expect(resolveTaxProvider({})).toBeNull();
    expect(resolveBankProvider({})).toBeNull();
  });
  it("mocks never run in a production deploy, except inside a practice (sandbox) book", () => {
    expect(taxProviderMode({ TAX_PROVIDER: "mock", CONTEXT: "production" })).toBe("none");
    expect(taxProviderMode({ TAX_PROVIDER: "mock", CONTEXT: "deploy-preview" })).toBe("mock");
    expect(bankProviderMode({ BANK_PROVIDER: "mock", CONTEXT: "production" })).toBe("none");
    expect(bankProviderMode({ CONTEXT: "production" }, { sandbox: true })).toBe("mock");
  });
  it("assertTestIsolation fails closed on real credentials", () => {
    expect(liveCredentialsPresent({ STRIPE_SECRET_KEY: "sk_test_123" })).toEqual([]);
    expect(() => assertTestIsolation({ STRIPE_SECRET_KEY: "sk_live_123" })).toThrow(/STRIPE_SECRET_KEY/);
    expect(() => assertTestIsolation({ PLAID_SECRET: "abc" })).toThrow(/PLAID_SECRET/);
    expect(() => assertTestIsolation({ BANK_PROVIDER_LIVE: "true" })).toThrow();
  });
});

describe("bank providers + token sealing", () => {
  it("scenario 21: mock link → exchange gives masked accounts only (no account/routing numbers)", async () => {
    const m = mockBankProvider({ today: "2026-11-18" });
    const ex = await m.exchange("mock-public:two_accounts");
    expect(ex.accounts.map((a) => a.mask)).toEqual(["4821", "9034"]);
    expect(JSON.stringify(ex.accounts)).not.toMatch(/routing|account_number/i);
  });
  it("scenarios 23–27: balances, timestamps, failure states", async () => {
    const m = mockBankProvider({ today: "2026-11-18" });
    const ok = await m.sync("mock-access:ok:1");
    expect(ok.balances[0]).toMatchObject({ current: "42500.00", available: "41250.00", asOf: "2026-11-18T13:00:00.000Z" });
    expect((await m.sync("mock-access:expired:1")).status).toBe("needs_reauth");
    expect((await m.sync("mock-access:institution_down:1")).status).toBe("institution_down");
    expect((await m.sync("mock-access:no_balance:1")).balances).toEqual([]);
  });
  it("Plaid adapter: positive = money out is flipped, pending skipped, errors mapped", async () => {
    const calls: string[] = [];
    const f = (async (u: string) => {
      calls.push(new URL(u).pathname);
      if (u.endsWith("/accounts/balance/get") || u.endsWith("/accounts/get")) return new Response(JSON.stringify({ accounts: [{ account_id: "A", balances: { current: 100.5, available: 90, iso_currency_code: "USD" } }] }), { status: 200 });
      return new Response(JSON.stringify({ added: [{ account_id: "A", transaction_id: "t1", date: "2026-11-10", name: "Home Depot", amount: 50.25, pending: false }, { account_id: "A", transaction_id: "t2", date: "2026-11-11", name: "Pending", amount: 9, pending: true }], has_more: false, next_cursor: "c1" }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await plaidProvider({ clientId: "c", secret: "s", env: "sandbox" }, f).sync("access-sandbox-x");
    expect(r.transactions).toEqual([{ ref: "A", txnRef: "t1", date: "2026-11-10", description: "Home Depot", amount: "-50.25", checkNumber: null }]);
    expect(r.balances[0]).toMatchObject({ current: "100.50", available: "90.00" });
    expect(calls).not.toContain("/auth/get");   // never requests account + routing numbers
    expect(calls).toContain("/accounts/get");          // daily sync: cached balance, no Balance charge
    expect(calls).not.toContain("/accounts/balance/get");
    calls.length = 0;
    await plaidProvider({ clientId: "c", secret: "s", env: "sandbox" }, f).sync("access-sandbox-x", null, { liveBalance: true });
    expect(calls).toContain("/accounts/balance/get");  // manual refresh: real-time, billed
    const err = (async () => new Response(JSON.stringify({ error_code: "ITEM_LOGIN_REQUIRED" }), { status: 400 })) as unknown as typeof fetch;
    expect((await plaidProvider({ clientId: "c", secret: "s", env: "sandbox" }, err).sync("x")).status).toBe("needs_reauth");
  });
  it("access tokens are sealed with AES-GCM and tamper-evident", () => {
    const s = sealToken("access-sandbox-123", MOCK_TOKEN_KEY);
    expect(s).not.toContain("access-sandbox-123");
    expect(openToken(s, MOCK_TOKEN_KEY)).toBe("access-sandbox-123");
    const bad = s.slice(0, -4) + (s.endsWith("AAAA") ? "BBBB" : "AAAA");
    expect(() => openToken(bad, MOCK_TOKEN_KEY)).toThrow();
    expect(() => sealToken("x", undefined)).toThrow(/bank_token_key_missing/);
  });
});

describe("cash-flow forecast", () => {
  const base: ForecastInput = {
    today: "2026-11-18", horizonDays: 30, includeBankBalance: true,
    accounts: [{ id: "chk", name: "Checking", current: "42500.00", available: "41250.00", asOf: new Date().toISOString(), status: "active", included: true }],
    invoices: [], milestones: [], bills: [], checks: [], depositsInTransit: [], planned: [],
  };
  const pl = (id: string, kind: string, amount: string, on: string, extra: Partial<ForecastInput["planned"][number]> = {}) =>
    ({ id, kind, label: kind, amount, direction: (["expected_deposit", "other_inflow"].includes(kind) ? "in" : "out") as "in" | "out", expectedOn: on, recurrence: "none" as const, recurUntil: null,
       certainty: (kind === "expected_deposit" ? "expected" : "scheduled") as "scheduled" | "expected", accountId: null, toAccountId: null, invoiceId: null, ...extra });

  it("scenarios 19 + 29: the spec example: 42,500 − 6,000 − 2,500 + 15,000 − 3,000 = 46,000 (expected); confirmed stays the bank balance", () => {
    const f = buildForecast({ ...base, planned: [pl("p", "payroll", "6000.00", "2026-11-21")], bills: [{ id: "b", label: "Lumber Yard", balance: "2500.00", dueDate: "2026-11-25" }],
      invoices: [{ id: "i", number: "INV-7", balance: "15000.00", dueDate: "2026-11-28", customerId: "c1" }],
      checks: [], customerLateness: { c1: 0 } , depositsInTransit: [] , milestones: [] ,
    } as ForecastInput);
    const f2 = buildForecast({ ...base, planned: [pl("p", "payroll", "6000.00", "2026-11-21"), pl("o", "recurring_expense", "3000.00", "2026-12-01")],
      bills: [{ id: "b", label: "Lumber Yard", balance: "2500.00", dueDate: "2026-11-25" }],
      invoices: [{ id: "i", number: "INV-7", balance: "15000.00", dueDate: "2026-11-28", customerId: "c1" }], customerLateness: { c1: 0 } });
    expect(f.end.confirmed).toBe("42500.00");
    expect(f2.end.expected).toBe("46000.00");
    expect(f2.end.confirmed).toBe("42500.00");
    expect(f2.opening).toBe("42500.00");
  });
  it("scenario 30: an overdue invoice is never scheduled or confirmed, only expected", () => {
    const f = buildForecast({ ...base, invoices: [{ id: "i", number: "INV-1", balance: "5000.00", dueDate: "2026-10-01", customerId: null }] });
    expect(f.end.scheduled).toBe("42500.00");
    expect(f.end.expected).toBe("47500.00");
    expect(f.events[0].certainty).toBe("expected");
    expect(f.events[0].note).toMatch(/Overdue/);
  });
  it("scenario 31: expected collection date follows the customer's payment history", () => {
    const late = customerLateness([{ customerId: "c1", dueDate: "2026-09-01", paidOn: "2026-09-11" }, { customerId: "c1", dueDate: "2026-10-01", paidOn: "2026-10-21" }]);
    expect(late.c1).toBe(15);
    const f = buildForecast({ ...base, invoices: [{ id: "i", number: "INV-2", balance: "1000.00", dueDate: "2026-11-20", customerId: "c1" }], customerLateness: late });
    expect(f.events[0].date).toBe("2026-12-05");
    expect(f.scheduledEvents[0].date).toBe("2026-11-20");
  });
  it("scenarios 32–34: payroll (recurring), supplier/sub bills and outstanding checks reduce the scheduled balance", () => {
    const f = buildForecast({ ...base, planned: [pl("p", "payroll", "1000.00", "2026-11-20", { recurrence: "weekly" })],
      bills: [{ id: "b1", label: "Supplier", balance: "500.00", dueDate: "2026-11-30" }, { id: "b2", label: "Sub", balance: "700.00", dueDate: null, vendorKind: "subcontractor" }],
      checks: [{ id: "c", label: "Check 1002", amount: "300.00", date: "2026-11-15", kind: "bill_payment" }] });
    // 5 payroll runs (11/20, 27, 12/4, 11, 18) + 500 + 700 (due in 30 days) + 300
    expect(f.end.scheduled).toBe((42500 - 5000 - 500 - 700 - 300).toFixed(2));
    expect(f.events.filter((e) => e.category === "payroll")).toHaveLength(5);
  });
  it("scenario 35: transfers between two selected accounts net to zero; one account sees its own leg", () => {
    const two = [{ ...base.accounts[0] }, { id: "sav", name: "Savings", current: "8000.00", available: "8000.00", asOf: new Date().toISOString(), status: "active", included: true }];
    const t = pl("t", "transfer", "1000.00", "2026-11-25", { accountId: "chk", toAccountId: "sav" });
    const both = buildForecast({ ...base, accounts: two, planned: [t] });
    expect(both.opening).toBe("50500.00");
    expect(both.end.scheduled).toBe("50500.00");
    const one = buildForecast({ ...base, accounts: [two[0], { ...two[1], included: false }], planned: [t] });
    expect(one.end.scheduled).toBe("41500.00");
    expect(detectTransfers([{ id: "a", accountId: "chk", date: "2026-11-15", amount: "-1000.00" }, { id: "b", accountId: "sav", date: "2026-11-16", amount: "1000.00" }, { id: "c", accountId: "chk", date: "2026-11-16", amount: "1000.00" }])).toEqual([["a", "b"]]);
  });
  it("no double count: an expected deposit linked to an invoice replaces it; payments already in the balance are skipped", () => {
    const f = buildForecast({ ...base, invoices: [{ id: "i", number: "INV-3", balance: "2000.00", dueDate: "2026-11-25", customerId: null }],
      planned: [pl("d", "expected_deposit", "2000.00", "2026-11-27", { invoiceId: "i" })],
      depositsInTransit: [{ id: "old", label: "Check from Pat", amount: "900.00", receivedOn: "2026-11-01" }, { id: "new", label: "Check from Lee", amount: "400.00", receivedOn: "2026-11-19" }] });
    expect(f.events.filter((e) => e.label.includes("INV-3"))).toHaveLength(0);
    expect(f.end.expected).toBe("44900.00");
  });
  it("viewer without bank access starts from $0 (net change), never sees the balance", () => {
    const f = buildForecast({ ...base, includeBankBalance: false, planned: [pl("p", "payroll", "100.00", "2026-11-20")] });
    expect(f.opening).toBeNull();
    expect(f.end.scheduled).toBe("-100.00");
  });
  it("scenario 26 + stale data: a missing or old bank balance is reported, not invented", () => {
    const f = buildForecast({ ...base, accounts: [{ ...base.accounts[0], current: null, available: null, asOf: null }] });
    expect(f.opening).toBeNull();
    expect(f.missingBalances).toEqual(["Checking"]);
    const s = buildForecast({ ...base, accounts: [{ ...base.accounts[0], asOf: "2026-11-01T00:00:00Z" }] });
    expect(s.stale).toBe(true);
    const e = buildForecast({ ...base, accounts: [{ ...base.accounts[0], status: "needs_reauth" }] });
    expect(e.stale).toBe(true);
  });
  it("a won bid with no invoice adds nothing; milestones are expected only", () => {
    const f = buildForecast({ ...base, milestones: [{ id: "m", label: "Framing", amount: "8000.00", expectedOn: "2026-12-05" }] });
    expect(f.end.scheduled).toBe("42500.00");
    expect(f.end.expected).toBe("50500.00");
  });
});

describe("bid address for tax", () => {
  it("reads the project address the builder stores on the customer, and the separate location fields win", async () => {
    const { addressFrom } = await import("@/lib/tax-banking/tax/estimate-tax");
    expect(addressFrom({ customer: { projectAddress: "88 Elm St, Rochester, MN 55901" }, location: {} })).toEqual({ line1: "88 Elm St", city: "Rochester", state: "MN", zip: "55901" });
    expect(addressFrom({ customer: { projectAddress: "88 Elm St" }, location: { city: "Austin", state: "tx", zip: "78701" } })).toEqual({ line1: "88 Elm St", city: "Austin", state: "TX", zip: "78701" });
  });
});
