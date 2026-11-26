import "server-only";
/**
 * Tax details for a bid / invoice (V6.9 "View Tax Details"). Builds the provider-neutral request from records the
 * caller can already read (RLS), runs the engine, and optionally saves a calculation snapshot. It never changes the
 * bid's tax rate, a signed proposal, or an issued invoice.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";
import { loadEstimate } from "@/lib/data/server";
import { computeEstimate } from "@/lib/estimate/engine";
import { calculateTax, explainDifference, type StoredRate } from "./engine";
import { resolveTaxProvider } from "./providers";
import type { CustomerExemption, LineClass, TaxResult } from "./types";
import { primaryProfile } from "@/lib/market/trade-models";

type Db = SupabaseClient;
type Row = Record<string, unknown>;

export type WorkKind = "new_construction" | "repair";

export function classify(costType: string, work: WorkKind): LineClass {
  switch (costType) {
    case "material": case "delivery": return "materials";
    case "equipment": return "equipment_rental";
    case "permit": return "permit_fee";
    case "labor": case "labor_burden": case "subcontractor": return work === "repair" ? "labor_repair" : "labor_new_construction";
    default: return "other";
  }
}

/** Parse "123 Main St, Rochester, MN 55901" style addresses when the separate location fields are empty. */
export function addressFrom(e: { customer?: { projectAddress?: string }; projectAddress?: string; location?: { zip?: string; city?: string; state?: string } }) {
  const raw = e.customer?.projectAddress ?? e.projectAddress ?? "";
  const m = raw.match(/,\s*([^,]+?)\s*,?\s+([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/);
  return {
    line1: raw.split(",")[0]?.trim() || null,
    city: e.location?.city || m?.[1] || null,
    state: (e.location?.state || m?.[2] || "").toUpperCase().slice(0, 2) || null,
    zip: e.location?.zip || m?.[3] || null,
  };
}

async function exemptionFor(db: Db, customerId: string | null): Promise<CustomerExemption | null> {
  if (!customerId) return null;
  const { data } = await db.from("fin_tax_exemptions").select("state, reason, certificate_ref, document_id, certificate_id, expires_on").eq("customer_id", customerId).eq("status", "active")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;
  const r = data as Row;
  // A certificate counts as "on file" when the customer signed one online, or a reference or document was recorded.
  return { state: String(r.state), reason: String(r.reason), certificateOnFile: Boolean(r.certificate_id || r.document_id || r.certificate_ref), expiresOn: (r.expires_on as string | null) ?? null,
    certificateRef: (r.certificate_ref as string | null) ?? null, onlineForm: Boolean(r.certificate_id) };
}

async function storedRatesFor(db: Db, state: string | null): Promise<StoredRate[]> {
  if (!state) return [];
  // Statewide rates only (the fallback can't know the county/city); seed rates aren't "verified" history.
  const { data } = await db.from("tax_jurisdiction_rates").select("jurisdiction_code, jurisdiction_name, level, rate, effective_from, source, recorded_at").eq("state", state).eq("level", "state").neq("source", "seed").limit(50);
  return ((data ?? []) as Row[]).map((r) => ({ jurisdiction: { code: String(r.jurisdiction_code), name: String(r.jurisdiction_name), level: r.level as StoredRate["jurisdiction"]["level"], rate: String(r.rate), taxType: "sales" },
    effectiveFrom: String(r.effective_from), recordedAt: String(r.recorded_at), source: r.source as StoredRate["source"] }));
}

async function pendingRuleStates(db: Db): Promise<string[]> {
  const { data } = await db.from("tax_change_events").select("state").eq("status", "needs_review").neq("kind", "rate").limit(200);
  return [...new Set(((data ?? []) as Row[]).map((r) => String(r.state)))];
}

/** The built-in engine reads public rate tables with the caller's client and caches geocodes with the service role. */
export function taxProviderFor(db: Db, opts: { sandbox?: boolean } = {}) {
  let cache: Db | null = null;
  try { cache = createAdminClient(); } catch { cache = null; }
  return resolveTaxProvider(process.env, { sandbox: opts.sandbox, builtin: { db, cache } });
}

async function profileFor(db: Db) {
  // The caller's tax setup (RLS shows only books they belong to): work mix + usual contract feed the construction rules.
  const { data } = await db.from("fin_tax_profiles").select("work_mix, default_contract").limit(1).maybeSingle();
  const r = (data ?? null) as Row | null;
  const mix = r?.work_mix === "residential" || r?.work_mix === "commercial" ? (r.work_mix as "residential" | "commercial") : null;
  const contract = (r?.default_contract as "lump_sum" | "time_and_materials" | "cost_plus" | "mixed" | null) ?? null;
  return { workMix: mix, contract };
}

export async function estimateTax(db: Db, estimateId: string, opts: { work?: WorkKind; date?: string; sandbox?: boolean } = {}) {
  const loaded = await loadEstimate(db, estimateId);
  if (!loaded) return null;
  const { estimate, customerId } = loaded;
  const totals = computeEstimate(estimate);
  const workType = primaryProfile(estimate.projectProfile, estimate.trades)?.workType;
  const work: WorkKind = opts.work ?? (workType === "new_construction" || workType === "addition" ? "new_construction" : "repair");
  const address = addressFrom(estimate);
  const lines = estimate.items.filter((i) => totals.items[i.id]?.valid !== false).map((i) => ({
    ref: i.id, amount: totals.items[i.id]?.extendedPrice.toFixed(2) ?? "0.00", classification: classify(i.costType, work), taxableHint: i.taxable,
  }));
  const provider = taxProviderFor(db, { sandbox: opts.sandbox });
  const prof = await profileFor(db).catch(() => ({ workMix: null, contract: null }));
  const result = await calculateTax({
    request: { address, transactionDate: opts.date ?? new Date().toISOString().slice(0, 10), lines, contract: prof.contract ?? "lump_sum", workMix: prof.workMix, work, customerId },
    provider, companyRate: estimate.taxRate ?? "0", exemption: await exemptionFor(db, customerId).catch(() => null),
    storedRates: await storedRatesFor(db, address.state).catch(() => []), pendingRuleStates: await pendingRuleStates(db).catch(() => []),
  });
  const names = new Map(estimate.items.map((i) => [i.id, i.name || "Item"]));
  const { data: versions } = await db.from("estimate_versions").select("id, version_number, tax, subtotal, total, created_at").eq("estimate_id", estimateId).order("version_number", { ascending: false }).limit(1);
  const signed = ((versions ?? []) as Row[])[0] ?? null;
  return {
    result, work, providerConfigured: Boolean(provider), names: Object.fromEntries(names), bidRate: String(estimate.taxRate ?? "0"), bidTax: totals.tax.toFixed(2),
    difference: explainDifference({ rate: String(estimate.taxRate ?? "0"), tax: totals.tax.toFixed(2), date: estimate.estimateDate ?? "" }, result),
    latestVersion: signed ? { number: Number(signed.version_number), tax: String(signed.tax), createdAt: String(signed.created_at) } : null,
  };
}

export async function saveEstimateCalc(db: Db, estimateId: string, r: TaxResult) {
  const { data, error } = await db.rpc("tax_calc_record", { p: { subjectType: "estimate", subjectId: estimateId, ...toSnapshot(r) }, p_lock: false });
  if (error) throw new Error(error.message);
  return data as string;
}

export const toSnapshot = (r: TaxResult) => ({
  status: r.status, transactionDate: r.transactionDate, address: r.address, taxableAmount: r.taxableAmount, nontaxableAmount: r.nontaxableAmount, taxAmount: r.taxAmount,
  combinedRate: r.combinedRate, jurisdictions: r.jurisdictions, lines: r.lines, exemptions: r.exemptions, reviewReasons: r.reviewReasons, source: r.source, provider: r.provider,
  providerRef: r.providerRef, dataAsOf: r.dataAsOf,
});

/**
 * When an invoice is issued: lock a snapshot of the tax as issued (the invoice's own amounts, never recalculated),
 * and if a tax service is configured, compare with the rate for the invoice date and flag a difference for review.
 */
export async function snapshotIssuedInvoice(db: Db, invoiceId: string, opts: { sandbox?: boolean } = {}) {
  const { data: inv } = await db.from("fin_invoices").select("id, job_id, issue_date, subtotal, tax, tax_rate, total").eq("id", invoiceId).maybeSingle();
  if (!inv) return null;
  const i = inv as Row;
  const { data: lines } = await db.from("fin_invoice_lines").select("line_no, amount, taxable").eq("invoice_id", invoiceId);
  const L = (lines ?? []) as Row[];
  const taxable = L.filter((l) => l.taxable).reduce((s, l) => s + Math.round(Number(l.amount) * 100), 0) / 100;
  const nontaxable = L.filter((l) => !l.taxable).reduce((s, l) => s + Math.round(Number(l.amount) * 100), 0) / 100;
  const reasons: string[] = [];
  let note: string | null = null;
  const provider = taxProviderFor(db, { sandbox: opts.sandbox });
  if (provider && Number(i.tax) > 0) {
    // Compare the contract rate with the rate in force on the invoice date for the job's address.
    const { data: job } = await db.from("fin_jobs").select("estimate_id").eq("id", String(i.job_id)).maybeSingle();
    const est = job ? await loadEstimate(db, String((job as Row).estimate_id)).catch(() => null) : null;
    if (est) {
      const addr = addressFrom(est.estimate);
      const r = await calculateTax({ request: { address: addr, transactionDate: String(i.issue_date), lines: [{ ref: "t", amount: taxable.toFixed(2), classification: "materials", taxableHint: true }] }, provider, companyRate: String(i.tax_rate) });
      if (r.combinedRate && Number(r.combinedRate) !== Number(i.tax_rate)) {
        reasons.push("rate_changed_since_contract");
        note = `Invoiced at the contract rate ${Number(i.tax_rate)}%. The rate for ${i.issue_date} at this address is ${r.combinedRate}%. Review whether a correction is needed.`;
      }
    }
  }
  const { data, error } = await db.rpc("tax_calc_record", { p: {
    subjectType: "invoice", subjectId: invoiceId, status: reasons.length ? "needs_review" : "calculated", transactionDate: i.issue_date,
    taxableAmount: taxable.toFixed(2), nontaxableAmount: nontaxable.toFixed(2), taxAmount: String(i.tax), combinedRate: String(i.tax_rate), source: "contract",
    jurisdictions: [{ name: "Contract rate", level: "other", rate: String(i.tax_rate), taxType: "sales", taxable: taxable.toFixed(2), tax: String(i.tax) }],
    reviewReasons: reasons }, p_lock: true });
  if (error) throw new Error(error.message);
  return { id: data as string, note };
}
