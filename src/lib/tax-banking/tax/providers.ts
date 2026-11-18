/**
 * Tax provider adapters (V6.9). Only the mock runs today. The Avalara, TaxJar and Stripe Tax adapters are written
 * against their public REST APIs so switching one on is configuration, not a rewrite, but they are unreachable until
 * the owner approves a provider (TAX_PROVIDER + TAX_PROVIDER_LIVE=true + credentials; see isolation.ts). Every
 * adapter maps its answer into the same ProviderResult, and tests exercise each mapping with a mocked fetch.
 */
import { fixtureArea, fixtureRates, fixtureTaxable, FIXTURE_VERSION } from "./fixtures";
import type { LineClass, ProviderJurisdiction, ProviderResult, TaxAddress, TaxProvider, TaxRequest } from "./types";
import { taxProviderMode, type TaxProviderName } from "../isolation";

type Fetch = typeof fetch;

export class ProviderUnavailable extends Error {
  constructor(public provider: string, public status?: number) { super(`${provider}_unavailable${status ? `_${status}` : ""}`); }
}

// --- Mock ------------------------------------------------------------------------------------------------------
export function mockProvider(opts: { failing?: boolean; asOf?: string } = {}): TaxProvider {
  return {
    name: "mock",
    async calculate(req) {
      if (opts.failing) throw new ProviderUnavailable("mock", 503);
      const area = fixtureArea(req.address.zip);
      const rates = fixtureRates(req.address.zip, req.transactionDate);
      const valid = Boolean(area && rates && area.state === (req.address.state ?? "").toUpperCase());
      return {
        provider: "mock", providerRef: `mock:${FIXTURE_VERSION}:${req.address.zip ?? ""}`, addressValid: valid,
        jurisdictions: valid ? rates! : [],
        lines: req.lines.map((l) => ({ ref: l.ref, ...fixtureTaxable(area?.state ?? "", l.classification, req.contract) })),
        dataAsOf: opts.asOf ?? new Date().toISOString(),
      };
    },
    async ratesFor(address, date) {
      if (opts.failing) throw new ProviderUnavailable("mock", 503);
      return fixtureRates(address.zip, date) ?? [];
    },
  };
}

// --- Construction tax codes per provider (provider-specific product classes) -----------------------------------
// Placeholders the owner/CPA confirms with the chosen provider before go-live; the adapter sends them, the provider decides.
export const AVALARA_TAX_CODES: Record<LineClass, string> = {
  materials: "P0000000", labor_new_construction: "S0000000", labor_repair: "S0000000", installation: "S0000000",
  service: "S0000000", equipment_rental: "P0000000", permit_fee: "OF400000", other: "P0000000",
};

const level = (t: string | undefined): ProviderJurisdiction["level"] => {
  const s = (t ?? "").toLowerCase();
  return s.startsWith("sta") ? "state" : s.startsWith("cou") || s === "cty" || s === "cnt" ? "county" : s.startsWith("cit") ? "city" : s.startsWith("spe") || s === "stj" ? "special" : "other";
};
const pct = (fraction: number | string | undefined) => (Number(fraction ?? 0) * 100).toFixed(5).replace(/\.?0+$/, "") || "0";

// --- Avalara AvaTax (POST /api/v2/transactions/create, type SalesOrder: quote only, never committed) -------------
export function avalaraProvider(cfg: { accountId: string; licenseKey: string; companyCode: string; baseUrl?: string }, f: Fetch = fetch): TaxProvider {
  const base = cfg.baseUrl ?? "https://rest.avatax.com";
  const auth = `Basic ${Buffer.from(`${cfg.accountId}:${cfg.licenseKey}`).toString("base64")}`;
  const addr = (a: TaxAddress) => ({ line1: a.line1 ?? "", city: a.city ?? "", region: a.state ?? "", postalCode: a.zip ?? "", country: "US" });
  async function create(req: TaxRequest) {
    const r = await f(`${base}/api/v2/transactions/create`, {
      method: "POST", headers: { authorization: auth, "content-type": "application/json" },
      body: JSON.stringify({ type: "SalesOrder", companyCode: cfg.companyCode, date: req.transactionDate, customerCode: req.customerId ?? "built2bid", commit: false,
        addresses: { singleLocation: addr(req.address) },
        lines: req.lines.map((l) => ({ number: l.ref, amount: Number(l.amount), taxCode: AVALARA_TAX_CODES[l.classification], description: l.classification })) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new ProviderUnavailable("avalara", r.status);
    return r.json() as Promise<{ id?: number; code?: string; lines?: { lineNumber: string; isItemTaxable?: boolean; tax?: number; details?: { jurisCode: string; jurisName: string; jurisType: string; rate: number; taxType?: string }[] }[]; messages?: { summary?: string; severity?: string }[] }>;
  }
  return {
    name: "avalara",
    async calculate(req): Promise<ProviderResult> {
      const t = await create(req);
      const juris = new Map<string, ProviderJurisdiction>();
      for (const l of t.lines ?? []) for (const d of l.details ?? []) juris.set(d.jurisCode, { code: d.jurisCode, name: d.jurisName, level: level(d.jurisType), rate: pct(d.rate), taxType: /use/i.test(d.taxType ?? "") ? "use" : "sales" });
      const bad = (t.messages ?? []).some((m) => /address/i.test(m.summary ?? "") && /error/i.test(m.severity ?? ""));
      return { provider: "avalara", providerRef: t.code ?? String(t.id ?? ""), addressValid: !bad, jurisdictions: [...juris.values()],
        lines: (t.lines ?? []).map((l) => ({ ref: l.lineNumber, taxable: Boolean(l.isItemTaxable) })), dataAsOf: new Date().toISOString() };
    },
    async ratesFor(address, date) {
      const r = await this.calculate({ address, transactionDate: date, lines: [{ ref: "1", amount: "100", classification: "materials", taxableHint: true }] });
      return r.jurisdictions;
    },
  };
}

// --- TaxJar (POST /v2/taxes) ---------------------------------------------------------------------------------
export function taxjarProvider(cfg: { apiKey: string; from: TaxAddress; baseUrl?: string }, f: Fetch = fetch): TaxProvider {
  const base = cfg.baseUrl ?? "https://api.taxjar.com";
  return {
    name: "taxjar",
    async calculate(req): Promise<ProviderResult> {
      const amount = req.lines.reduce((s, l) => s + Number(l.amount), 0);
      const r = await f(`${base}/v2/taxes`, {
        method: "POST", headers: { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json" },
        // Construction is taxed where the job is. Built2Bid calculates for many contractors from one TaxJar account, so the
        // job site is sent as the nexus address (otherwise TaxJar uses the account's own nexus list and returns $0 elsewhere).
        // Whether the contractor is actually registered there is their tax setup's question, not TaxJar's.
        body: JSON.stringify({ from_country: "US", from_state: cfg.from.state || req.address.state, from_zip: cfg.from.zip || req.address.zip, to_country: "US", to_state: req.address.state, to_zip: req.address.zip,
          to_city: req.address.city, to_street: req.address.line1, amount, shipping: 0,
          nexus_addresses: [{ id: "job-site", country: "US", state: req.address.state, zip: req.address.zip, city: req.address.city, street: req.address.line1 }],
          line_items: req.lines.map((l) => ({ id: l.ref, quantity: 1, unit_price: Number(l.amount), product_tax_code: l.classification === "materials" ? undefined : "19000" })) }),
        signal: AbortSignal.timeout(10_000),
      });
      if (r.status === 400 || r.status === 404) return { provider: "taxjar", providerRef: null, addressValid: false, jurisdictions: [], lines: req.lines.map((l) => ({ ref: l.ref, taxable: false })), dataAsOf: new Date().toISOString() };
      if (!r.ok) throw new ProviderUnavailable("taxjar", r.status);
      const { tax } = await r.json() as { tax: { jurisdictions?: { state?: string; county?: string; city?: string }; breakdown?: { state_tax_rate?: number; county_tax_rate?: number; city_tax_rate?: number; special_district_tax_rate?: number; line_items?: { id: string; tax_collectable: number }[] } } };
      const b = tax.breakdown ?? {};
      const js: ProviderJurisdiction[] = [];
      const st = (req.address.state ?? "").toUpperCase();
      if (b.state_tax_rate) js.push({ code: st, name: tax.jurisdictions?.state ?? st, level: "state", rate: pct(b.state_tax_rate), taxType: "sales" });
      if (b.county_tax_rate) js.push({ code: `${st}-CO-${tax.jurisdictions?.county ?? ""}`, name: tax.jurisdictions?.county ?? "County", level: "county", rate: pct(b.county_tax_rate), taxType: "sales" });
      if (b.city_tax_rate) js.push({ code: `${st}-CI-${tax.jurisdictions?.city ?? ""}`, name: tax.jurisdictions?.city ?? "City", level: "city", rate: pct(b.city_tax_rate), taxType: "sales" });
      if (b.special_district_tax_rate) js.push({ code: `${st}-SP-${req.address.zip ?? ""}`, name: "Special district", level: "special", rate: pct(b.special_district_tax_rate), taxType: "sales" });
      const items = new Map((b.line_items ?? []).map((x) => [x.id, x.tax_collectable]));
      return { provider: "taxjar", providerRef: null, addressValid: true, jurisdictions: js, lines: req.lines.map((l) => ({ ref: l.ref, taxable: (items.get(l.ref) ?? 0) > 0 })), dataAsOf: new Date().toISOString() };
    },
    async ratesFor(address, date) {
      return (await this.calculate({ address, transactionDate: date, lines: [{ ref: "1", amount: "100", classification: "materials", taxableHint: true }] })).jurisdictions;
    },
  };
}

// --- Stripe Tax (POST /v1/tax/calculations) ----------------------------------------------------------------------
// Note: Stripe Tax calculates for the registrations on the Stripe account that calls it. Built2Bid's Stripe account
// is the SaaS platform, not each contractor, so this only suits contractors once Stripe Connect accounts exist.
export function stripeTaxProvider(cfg: { secretKey: string; baseUrl?: string }, f: Fetch = fetch): TaxProvider {
  const base = cfg.baseUrl ?? "https://api.stripe.com";
  return {
    name: "stripe_tax",
    async calculate(req): Promise<ProviderResult> {
      const form = new URLSearchParams({ currency: "usd", "customer_details[address][country]": "US", "customer_details[address][postal_code]": req.address.zip ?? "",
        "customer_details[address][state]": req.address.state ?? "", "customer_details[address][city]": req.address.city ?? "", "customer_details[address][line1]": req.address.line1 ?? "",
        "customer_details[address_source]": "shipping", tax_date: String(Math.floor(new Date(`${req.transactionDate}T12:00:00Z`).getTime() / 1000)) });
      req.lines.forEach((l, i) => { form.set(`line_items[${i}][amount]`, String(Math.round(Number(l.amount) * 100))); form.set(`line_items[${i}][reference]`, l.ref); });
      const r = await f(`${base}/v1/tax/calculations`, { method: "POST", headers: { authorization: `Bearer ${cfg.secretKey}`, "content-type": "application/x-www-form-urlencoded" }, body: form, signal: AbortSignal.timeout(10_000) });
      if (r.status === 400) return { provider: "stripe_tax", providerRef: null, addressValid: false, jurisdictions: [], lines: req.lines.map((l) => ({ ref: l.ref, taxable: false })), dataAsOf: new Date().toISOString() };
      if (!r.ok) throw new ProviderUnavailable("stripe_tax", r.status);
      const c = await r.json() as { id: string; tax_breakdown?: { amount: number; tax_rate_details?: { display_name?: string; percentage_decimal?: string; state?: string; tax_type?: string; jurisdiction_level?: string } }[]; line_items?: { data?: { reference: string; amount_tax: number }[] } };
      const js = (c.tax_breakdown ?? []).filter((b) => b.tax_rate_details?.percentage_decimal).map((b, i) => ({ code: `${b.tax_rate_details?.state ?? ""}-${b.tax_rate_details?.jurisdiction_level ?? i}`, name: b.tax_rate_details?.display_name ?? "Tax",
        level: level(b.tax_rate_details?.jurisdiction_level), rate: b.tax_rate_details!.percentage_decimal!, taxType: "sales" as const }));
      const items = new Map((c.line_items?.data ?? []).map((x) => [x.reference, x.amount_tax]));
      return { provider: "stripe_tax", providerRef: c.id, addressValid: true, jurisdictions: js, lines: req.lines.map((l) => ({ ref: l.ref, taxable: (items.get(l.ref) ?? 0) > 0 })), dataAsOf: new Date().toISOString() };
    },
    async ratesFor(address, date) {
      return (await this.calculate({ address, transactionDate: date, lines: [{ ref: "1", amount: "100", classification: "materials", taxableHint: true }] })).jurisdictions;
    },
  };
}

/** The provider for this deploy, or null when none is approved (the engine then uses the contractor's own rate). */
export function resolveTaxProvider(env: Record<string, string | undefined> = process.env, opts: { sandbox?: boolean } = {}): TaxProvider | null {
  const mode: TaxProviderName = taxProviderMode(env, opts);
  switch (mode) {
    case "mock": return mockProvider();
    case "avalara": return avalaraProvider({ accountId: env.AVALARA_ACCOUNT_ID!, licenseKey: env.AVALARA_LICENSE_KEY!, companyCode: env.AVALARA_COMPANY_CODE ?? "DEFAULT" });
    case "taxjar": return taxjarProvider({ apiKey: env.TAXJAR_API_KEY!, from: { state: env.TAXJAR_FROM_STATE, zip: env.TAXJAR_FROM_ZIP } });
    case "stripe_tax": return stripeTaxProvider({ secretKey: env.STRIPE_TAX_CALC_KEY! });
    default: return null;
  }
}
