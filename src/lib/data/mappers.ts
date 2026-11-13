import type { Estimate, EstimateGroup, LineItem, PricingRule } from "../estimate/types";
import type { EstimateWorksheet } from "../calculators/types";
import { worksheetSchema } from "../estimate/schema";
import type { ProjectProfile } from "../market/trade-models";
import { normalizeExclusions, normalizeScope } from "../proposal/text-sections";
import { defaultBusinessProfile, defaultProposalConfig, type BusinessProfile, type ProposalConfig } from "../proposal/types";

/* eslint-disable @typescript-eslint/no-explicit-any */
const num = (v: unknown) => (v === null || v === undefined ? "" : String(Number(v)));
const rule = (mode: string | null, pct: unknown): PricingRule | null => (mode ? { mode: mode as PricingRule["mode"], percent: num(pct) } : null);

export function rowsToEstimate(e: any, groups: any[], items: any[]): Estimate {
  return {
    id: e.id,
    title: e.title ?? "",
    trades: e.trades ?? [],
    estimateNumber: e.estimate_number ?? "",
    estimateDate: e.estimate_date,
    expirationDate: e.expiration_date ?? "",
    status: e.status,
    customer: {
      name: e.customer_name ?? "",
      email: e.customer_email ?? undefined,
      phone: e.customer_phone ?? undefined,
      projectAddress: e.project_address ?? undefined,
      notes: e.customer_notes ?? undefined,
    },
    location: { zip: e.location_zip ?? undefined, city: e.location_city ?? undefined, state: e.location_state ?? undefined },
    pricing: { mode: e.pricing_mode, percent: num(e.pricing_percent) },
    fixedAdjustment: num(e.fixed_adjustment),
    adjustmentLabel: e.adjustment_label ?? undefined,
    taxRate: num(e.tax_rate),
    displayMode: e.display_mode,
    defaultGroupVisibility: e.default_group_visibility,
    templateRef: e.template_trade ? { trade: e.template_trade, version: e.template_version ?? 1 } : null,
    customerId: e.customer_id ?? null,
    updatedAt: e.updated_at,
    groups: groups.map(
      (g): EstimateGroup => ({
        id: g.id, name: g.name ?? "", description: g.description ?? undefined, visibility: g.visibility ?? null,
        sortOrder: g.sort_order ?? 0, pricingOverride: rule(g.pricing_mode, g.pricing_percent),
      }),
    ),
    items: items.map(
      (i): LineItem => ({
        id: i.id, groupId: i.group_id, name: i.name ?? "", description: i.description ?? undefined, category: i.category ?? undefined,
        costType: i.cost_type, treatment: i.treatment, quantity: num(i.quantity), unit: i.unit, unitCost: num(i.unit_cost),
        taxable: i.taxable, pricingOverride: rule(i.pricing_mode, i.pricing_percent), showOnProposal: i.show_on_proposal,
        notes: i.notes ?? undefined, sortOrder: i.sort_order ?? 0,
      }),
    ),
  };
}

export function rowToProjectProfile(r: any | null): ProjectProfile | null {
  if (!r) return null;
  return {
    sector: r.sector ?? undefined,
    workType: r.work_type ?? undefined,
    projectType: r.project_type ?? undefined,
    measurements: r.measurements && typeof r.measurements === "object" ? r.measurements : undefined,
    outcome: r.outcome ?? undefined,
  };
}

export function proposalConfigFrom(raw: unknown): ProposalConfig {
  const d = defaultProposalConfig();
  if (!raw || typeof raw !== "object") return d;
  // The worksheet is stored alongside the proposal settings but belongs to the estimate.
  const { worksheet: _w, ...r } = raw as Partial<ProposalConfig> & { worksheet?: unknown };
  void _w;
  const exclusionList = normalizeExclusions(r.exclusionList, typeof r.exclusions === "string" ? r.exclusions : "");
  return {
    ...d, ...r,
    show: { ...d.show, ...(r.show ?? {}) },
    paymentSchedule: r.paymentSchedule ?? d.paymentSchedule,
    scope: normalizeScope(r.scope),
    exclusionList,
    // Legacy text is carried into exclusionList once; clearing it avoids showing it twice.
    exclusions: "",
  };
}

export function rowToBusiness(r: any | null): BusinessProfile & { logoPath?: string | null } {
  const d = defaultBusinessProfile();
  if (!r) return d;
  return {
    companyName: r.company_name ?? "",
    contactName: r.contact_name ?? undefined,
    email: r.email ?? undefined,
    phone: r.phone ?? undefined,
    address: r.address ?? undefined,
    website: r.website ?? undefined,
    licenseNumber: r.license_number ?? undefined,
    description: r.description ?? undefined,
    tagline: r.tagline ?? undefined,
    primaryColor: r.primary_color ?? d.primaryColor,
    secondaryColor: r.secondary_color ?? d.secondaryColor,
    logoLayout: r.logo_layout ?? d.logoLayout,
    headerStyle: r.header_style ?? d.headerStyle,
    logoUrl: null,
    logoPath: r.logo_path ?? null,
  };
}

export function businessToRow(b: BusinessProfile & { logoPath?: string | null }, userId: string) {
  const s = (v?: string | null) => (v && v.trim() ? v.trim() : null);
  return {
    user_id: userId,
    company_name: b.companyName.trim(),
    contact_name: s(b.contactName),
    email: s(b.email),
    phone: s(b.phone),
    address: s(b.address),
    website: s(b.website),
    license_number: s(b.licenseNumber),
    description: s(b.description),
    tagline: s(b.tagline),
    primary_color: b.primaryColor,
    secondary_color: b.secondaryColor,
    logo_layout: b.logoLayout,
    header_style: b.headerStyle,
    ...(b.logoPath !== undefined ? { logo_path: b.logoPath } : {}),
  };
}

/** Read the estimate worksheet (calculator inputs, minimum charge) back out of a stored proposal_config. */
export function worksheetFrom(rawConfig: unknown): EstimateWorksheet | null {
  if (!rawConfig || typeof rawConfig !== "object") return null;
  const parsed = worksheetSchema.safeParse((rawConfig as { worksheet?: unknown }).worksheet);
  return parsed.success && parsed.data ? (parsed.data as EstimateWorksheet) : null;
}

/**
 * The worksheet to persist: calculations only for line items that still exist, plus each section's
 * trade (estimate_groups has no trade column); null when empty.
 */
export function worksheetToStore(estimate: Pick<Estimate, "items" | "worksheet"> & { groups?: EstimateGroup[] }): EstimateWorksheet | null {
  const w = estimate.worksheet ?? {};
  const ids = new Set(estimate.items.filter((i) => !i.isExample).map((i) => i.id));
  const calcs = Object.fromEntries(Object.entries(w.calcs ?? {}).filter(([id]) => ids.has(id)));
  const sectionTrades = Object.fromEntries((estimate.groups ?? []).filter((g) => g.trade).map((g) => [g.id, g.trade as string]));
  const out: EstimateWorksheet = {};
  if (Object.keys(calcs).length) out.calcs = calcs;
  if (w.minimumCharge && w.minimumCharge.trim()) out.minimumCharge = w.minimumCharge.trim();
  if (Object.keys(sectionTrades).length) out.sectionTrades = sectionTrades;
  return Object.keys(out).length ? out : null;
}

/**
 * Puts stored section trades back on the sections and keeps them out of the in-memory worksheet,
 * so EstimateGroup.trade stays the only place the editor reads a section's trade from.
 */
export function applySectionTrades(estimate: Estimate, worksheet: EstimateWorksheet | null): Estimate {
  const map = worksheet?.sectionTrades ?? {};
  const { sectionTrades: _st, ...rest } = worksheet ?? {};
  void _st;
  const groups = estimate.groups.map((g) => (map[g.id] ? { ...g, trade: map[g.id] } : g));
  return { ...estimate, groups, worksheet: worksheet && Object.keys(rest).length ? rest : null };
}
