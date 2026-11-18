/**
 * Provider-neutral tax calculation (V6.9).
 *
 * The engine never invents a rate or a taxability rule. In order of preference:
 *   1. A provider decides jurisdictions, rates and per-line taxability for the address and date: Built2Bid's own
 *      engine (official state rate files + construction rules, builtin.ts) by default, an optional paid service
 *      (Avalara / TaxJar / Stripe Tax) if the owner switches one on, or the mock outside production.
 *   2. If the provider fails, the last VERIFIED rate on file for that jurisdiction (tax_jurisdiction_rates), marked
 *      stale for review.
 *   3. Otherwise the rate the contractor typed, applied to the lines they marked taxable (today's behavior),
 *      labelled "your rate, not verified" and flagged for review.
 * Exemptions remove tax only with a current certificate for the same state. Construction treatment the provider
 * can't settle is flagged, never guessed.
 */
import { D, round2, type Dec } from "@/lib/estimate/money";
import { authorityFor } from "../authorities";
import { STATE_ONLY } from "./seed-rates";
import type { CustomerExemption, ProviderJurisdiction, ReviewReason, TaxProvider, TaxRequest, TaxResult } from "./types";

export interface StoredRate { jurisdiction: ProviderJurisdiction; effectiveFrom: string; recordedAt: string; source: "provider" | "official" | "fixture" }

export interface EngineInput {
  request: TaxRequest;
  provider: TaxProvider | null;
  /** The rate the contractor entered on the bid (percent string). */
  companyRate: string;
  exemption?: CustomerExemption | null;
  /** Last verified rates on file for this address's jurisdictions (fallback when the provider is down). */
  storedRates?: StoredRate[];
  /** States with a tax rule change still waiting for review. */
  pendingRuleStates?: readonly string[];
  now?: Date;
  /** Older than this many days = stale (default 35: quarterly rate cycles + a month). */
  staleDays?: number;
}

const ZIP = /^\d{5}(-\d{4})?$/;
export const validAddress = (a: TaxRequest["address"]) => Boolean(a.state && authorityFor(a.state) && a.zip && ZIP.test(a.zip.trim()));

const dec = (s: string | number) => { try { return new D(s); } catch { return new D(0); } };
const fmt = (d: Dec) => round2(d).toFixed(2);
const rateFmt = (d: Dec) => d.toDecimalPlaces(5).toString();

export async function calculateTax(input: EngineInput): Promise<TaxResult> {
  const { request: req } = input;
  const now = input.now ?? new Date();
  const reasons = new Set<ReviewReason>();
  const state = (req.address.state ?? "").toUpperCase();
  const auth = authorityFor(state);
  const addressOk = validAddress(req.address);
  if (!addressOk && input.provider) reasons.add("invalid_address");   // without a tax service the address only matters to the rate the contractor typed
  if (input.pendingRuleStates?.includes(state)) reasons.add("rule_change_pending");

  let source: TaxResult["source"] = "company_rate";
  let providerName: string | null = null;
  let providerRef: string | null = null;
  let dataAsOf: string | null = null;
  let jurisdictions: ProviderJurisdiction[] | null = null;
  let lineTaxable = new Map<string, { taxable: boolean; needsReview?: boolean }>();
  let notes: string[] = [];
  let staleAfter: number | undefined;

  if (addressOk && input.provider) {
    try {
      const r = await input.provider.calculate(req);
      if (!r.addressValid) {
        reasons.add("invalid_address");
      } else {
        jurisdictions = r.jurisdictions;
        providerName = r.provider; providerRef = r.providerRef; dataAsOf = r.dataAsOf;
        source = r.provider === "mock" ? "mock" : "provider";
        lineTaxable = new Map(r.lines.map((l) => [l.ref, { taxable: l.taxable, needsReview: l.needsReview }]));
        if (r.lines.some((l) => l.needsReview)) reasons.add("construction_treatment_review");
        for (const x of r.reviewReasons ?? []) reasons.add(x);
        notes = r.notes ?? []; staleAfter = r.staleAfterDays;
        // A stored official/fixture rate for the same jurisdiction that disagrees = conflicting sources. (The built-in
        // engine reads those same stored rates, so the check only applies to outside providers.)
        if (r.provider !== "builtin") for (const j of r.jurisdictions) {
          const s = latestStored(input.storedRates, j.code, req.transactionDate);
          if (s && s.source !== "provider" && !dec(s.jurisdiction.rate).eq(dec(j.rate))) reasons.add("conflicting_sources");
        }
      }
    } catch (e) {
      // The built-in engine has no rate on file yet for this state: say so plainly (it's not an outage).
      reasons.add(e instanceof Error && e.message.startsWith("no_rate_data") ? "no_verified_rate" : "provider_unavailable");
    }
  }

  // Fallback 2: last verified stored rates (never fabricated).
  if (!jurisdictions && addressOk && input.provider && input.storedRates?.length) {
    // Only the statewide rate is safe to reuse without knowing which county/city the job is in.
    const codes = [...new Set(input.storedRates.filter((s) => s.jurisdiction.level === "state").map((s) => s.jurisdiction.code))];
    const picked = codes.map((c) => latestStored(input.storedRates, c, req.transactionDate)).filter((s): s is StoredRate => Boolean(s));
    if (picked.length) {
      jurisdictions = picked.map((p) => p.jurisdiction);
      source = "provider"; providerName = "last_verified"; dataAsOf = picked.map((p) => p.recordedAt).sort()[0];
      reasons.add("stale_rate");
      if (!STATE_ONLY.has(state) && auth?.system !== "none") reasons.add("local_rate_unverified");
    }
  }

  // Staleness of provider data (cached data from a provider sync).
  if (dataAsOf && (now.getTime() - new Date(dataAsOf).getTime()) / 864e5 > (staleAfter ?? input.staleDays ?? 35)) reasons.add("stale_rate");

  // Fallback 3: the contractor's own rate.
  if (!jurisdictions) {
    source = "company_rate";
    if (input.provider) reasons.add("no_verified_rate");
    reasons.add("unverified_company_rate");
    if (auth && auth.system === "none" && dec(input.companyRate).gt(0)) reasons.add("no_general_sales_tax");
    if (auth?.note && /contract treatment/i.test(auth.note)) reasons.add("construction_treatment_review");
    jurisdictions = [{ code: `company:${state || "XX"}`, name: "Your rate", level: "other", rate: dec(input.companyRate).toString(), taxType: "sales" }];
    lineTaxable = new Map(req.lines.map((l) => [l.ref, { taxable: l.taxableHint }]));
  }

  // Exemption: only with a current certificate for this state.
  const ex = input.exemption;
  let exempt = false;
  if (ex) {
    if (ex.state.toUpperCase() !== state) reasons.add("exemption_other_state");
    else if (!ex.certificateOnFile) reasons.add("exemption_missing_certificate");
    else if (ex.expiresOn && ex.expiresOn < req.transactionDate) reasons.add("exemption_expired");
    else {
      exempt = true;
      // The online certificate follows the Streamlined uniform form; non-member states may want their own form.
      if (ex.onlineForm && !auth?.sst) reasons.add("exemption_state_form");
    }
  }

  // Per-jurisdiction tax on the taxable base; total rounded once to the cent (same rule as the bid engine).
  const combined = jurisdictions.reduce((s, j) => s.plus(dec(j.rate)), new D(0));
  const lines = req.lines.map((l) => {
    const t = lineTaxable.get(l.ref);
    const taxable = !exempt && Boolean(t?.taxable);
    return { ref: l.ref, classification: l.classification, amount: fmt(dec(l.amount)), taxable, needsReview: t?.needsReview, tax: "0.00" };
  });
  const taxableBase = lines.filter((l) => l.taxable).reduce((s, l) => s.plus(dec(l.amount)), new D(0));
  const nontaxable = lines.filter((l) => !l.taxable).reduce((s, l) => s.plus(dec(l.amount)), new D(0));
  const totalTax = round2(taxableBase.times(combined).div(100));
  // Allocate the rounded total back to lines and jurisdictions by largest remainder, so parts always sum to the total.
  allocate(lines.filter((l) => l.taxable), totalTax, (l) => dec(l.amount), (l, v) => { l.tax = v; });
  const jr = jurisdictions.map((j) => ({ ...j, rate: rateFmt(dec(j.rate)), taxable: fmt(taxableBase), tax: "0.00" }));
  allocate(jr, totalTax, (j) => dec(j.rate), (j, v) => { j.tax = v; });

  const reviewReasons = [...reasons];
  const blocking: ReviewReason[] = ["unverified_company_rate"];   // informational only when no provider is configured at all
  const needsReview = reviewReasons.some((r) => !(blocking.includes(r) && !input.provider));
  return {
    status: needsReview ? "needs_review" : "calculated",
    source, provider: providerName, providerRef, transactionDate: req.transactionDate, address: req.address,
    taxableAmount: fmt(taxableBase), nontaxableAmount: fmt(nontaxable), taxAmount: fmt(totalTax), combinedRate: rateFmt(combined),
    jurisdictions: jr, lines,
    exemptions: ex ? [{ state: ex.state, reason: ex.reason, certificateRef: ex.certificateRef ?? null, applied: exempt }] : [],
    reviewReasons, dataAsOf, calculatedAt: now.toISOString(),
    notes, rulesVersion: providerName === "builtin" && providerRef ? providerRef.replace(/^builtin:/, "") : null,
  };
}

function latestStored(rates: StoredRate[] | undefined, code: string, date: string) {
  return (rates ?? []).filter((r) => r.jurisdiction.code === code && r.effectiveFrom <= date)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.recordedAt.localeCompare(a.recordedAt))[0] ?? null;
}

function allocate<T>(items: T[], total: Dec, weight: (t: T) => Dec, set: (t: T, v: string) => void) {
  const W = items.reduce((s, t) => s.plus(weight(t)), new D(0));
  if (!items.length || W.isZero()) { items.forEach((t) => set(t, "0.00")); return; }
  const cents = total.times(100).toNumber();
  const raw = items.map((t) => weight(t).div(W).times(cents));
  const floor = raw.map((r) => Math.floor(r.toNumber()));
  let left = Math.round(cents - floor.reduce((a, b) => a + b, 0));
  const order = raw.map((r, i) => ({ i, frac: r.minus(floor[i]).toNumber() })).sort((a, b) => b.frac - a.frac);
  for (const o of order) { if (left <= 0) break; floor[o.i] += 1; left -= 1; }
  items.forEach((t, i) => set(t, (floor[i] / 100).toFixed(2)));
}

/** Difference between an estimate's tax and the invoice-date calculation, explained for the reviewer. */
export function explainDifference(estimate: { rate: string; tax: string; date: string }, invoice: TaxResult) {
  const diff = dec(invoice.taxAmount).minus(dec(estimate.tax));
  if (diff.isZero() && dec(estimate.rate).eq(dec(invoice.combinedRate ?? "0"))) return null;
  return {
    difference: fmt(diff),
    message: `The bid used ${dec(estimate.rate).toString()}% on ${estimate.date}. For the invoice date ${invoice.transactionDate} the rate is ${invoice.combinedRate}% (${invoice.provider ?? invoice.source}). Review before issuing; the signed proposal is not changed.`,
  };
}
