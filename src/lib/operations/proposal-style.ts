/**
 * Enterprise Bid Style (V4.4): resolves how ONE bid's proposal is presented.
 *
 *   platform rules  >  company locks  >  company template  >  the bid's own choices (only where allowed)  >  platform defaults
 *
 * Only presentation is resolved here (template, colors, logo layout, header style, which contact
 * details and columns show, display grouping). Quantities, costs, prices, tax and totals are never
 * read or written, so a style can never change what the customer pays.
 *
 * Unsent drafts rule: an unsent bid always previews and generates with the company style as it is at
 * that moment. Once a version is generated (sent, approved or signed), its resolved style is frozen in
 * the version snapshot and later company changes never touch it.
 */
import { TEMPLATES } from "@/lib/proposal/templates";
import { defaultBusinessProfile, defaultProposalConfig, type BusinessProfile, type ProposalConfig, type ProposalTemplateId } from "@/lib/proposal/types";
import type { Estimate, EstimateDisplayMode, GroupVisibility } from "@/lib/estimate/types";

export const SHOW_KEYS = ["phone", "email", "address", "website", "license", "itemDescriptions", "itemPrices", "groupPrices", "quantities", "notes"] as const;
export type ShowKey = (typeof SHOW_KEYS)[number];

/** Mirrors public.proposal_style_keys() in 20261119004000_proposal_style_policy.sql. */
export const STYLE_KEYS = [
  "template", "primaryColor", "secondaryColor", "logoLayout", "headerStyle", "companyBranding",
  ...SHOW_KEYS.map((k) => `show.${k}` as const),
  "displayMode", "defaultGroupVisibility",
] as const;
export type StyleKey = (typeof STYLE_KEYS)[number];

export const STYLE_KEY_LABELS: Record<StyleKey, string> = {
  template: "Proposal template", primaryColor: "Primary color", secondaryColor: "Accent color", logoLayout: "Logo layout",
  headerStyle: "Header style", companyBranding: "Company branding (name, logo, contact)",
  "show.phone": "Phone", "show.email": "Email", "show.address": "Address", "show.website": "Website", "show.license": "License number",
  "show.itemDescriptions": "Item descriptions", "show.itemPrices": "Line item prices", "show.groupPrices": "Section prices",
  "show.quantities": "Quantities", "show.notes": "Line notes",
  displayMode: "Price display (by section or project total)", defaultGroupVisibility: "Default section detail",
};

export interface CompanyStyle {
  template?: ProposalTemplateId;
  primaryColor?: string;
  secondaryColor?: string;
  logoLayout?: BusinessProfile["logoLayout"];
  headerStyle?: BusinessProfile["headerStyle"];
  /** Use the company owner's business profile (name, logo, contact details) on every company bid. */
  companyBranding?: boolean;
  show?: Partial<Record<ShowKey, boolean>>;
  displayMode?: EstimateDisplayMode;
  defaultGroupVisibility?: GroupVisibility;
}

/** What proposal_style_policy(estimate) returns. */
export interface StylePolicy {
  managed: boolean;
  companyId?: string;
  companyOwnerId?: string | null;
  style?: CompanyStyle | null;
  locked?: string[];
  allowCustomization?: boolean;
  /** The caller may customize this bid (policy on + "Customize individual bid style"). */
  canCustomize?: boolean;
  /** The caller manages company templates (and may reset any company bid). */
  canOverride?: boolean;
  revision?: number;
  updatedAt?: string | null;
}

export type StyleSource = "locked" | "company" | "bid" | "default";

export interface ResolvedStyle {
  config: ProposalConfig;
  business: BusinessProfile;
  estimate: Estimate;
  sources: Record<StyleKey, StyleSource>;
  /** True when the bid's own choices are honored (unmanaged, or customization allowed). */
  bidChoicesApply: boolean;
  /** Frozen into generated versions so a document always shows which company style it used. */
  stamp: { managed: boolean; revision: number | null; companyId: string | null };
}

const HEX = /^#[0-9a-f]{6}$/i;
const TEMPLATE_IDS = new Set(TEMPLATES.map((t) => t.id));
const LAYOUTS = new Set(["left", "center", "stacked"]);
const HEADERS = new Set(["solid", "line", "minimal"]);
const MODES = new Set(["by_group", "project_total"]);
const VIS = new Set(["group_total", "names_only", "itemized"]);

/** Platform rules: anything malformed is dropped (falls through to the next level). */
export function sanitizeCompanyStyle(input: unknown): CompanyStyle {
  const s = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out: CompanyStyle = {};
  if (typeof s.template === "string" && TEMPLATE_IDS.has(s.template as ProposalTemplateId)) out.template = s.template as ProposalTemplateId;
  if (typeof s.primaryColor === "string" && HEX.test(s.primaryColor)) out.primaryColor = s.primaryColor.toLowerCase();
  if (typeof s.secondaryColor === "string" && HEX.test(s.secondaryColor)) out.secondaryColor = s.secondaryColor.toLowerCase();
  if (typeof s.logoLayout === "string" && LAYOUTS.has(s.logoLayout)) out.logoLayout = s.logoLayout as CompanyStyle["logoLayout"];
  if (typeof s.headerStyle === "string" && HEADERS.has(s.headerStyle)) out.headerStyle = s.headerStyle as CompanyStyle["headerStyle"];
  if (typeof s.companyBranding === "boolean") out.companyBranding = s.companyBranding;
  if (typeof s.displayMode === "string" && MODES.has(s.displayMode)) out.displayMode = s.displayMode as EstimateDisplayMode;
  if (typeof s.defaultGroupVisibility === "string" && VIS.has(s.defaultGroupVisibility)) out.defaultGroupVisibility = s.defaultGroupVisibility as GroupVisibility;
  if (s.show && typeof s.show === "object") {
    const show: Partial<Record<ShowKey, boolean>> = {};
    for (const k of SHOW_KEYS) { const v = (s.show as Record<string, unknown>)[k]; if (typeof v === "boolean") show[k] = v; }
    if (Object.keys(show).length) out.show = show;
  }
  return out;
}

export const sanitizeLocks = (locked: unknown): StyleKey[] =>
  Array.isArray(locked) ? [...new Set(locked.filter((k): k is StyleKey => typeof k === "string" && (STYLE_KEYS as readonly string[]).includes(k)))].sort() : [];

type Vals = {
  template: ProposalTemplateId; primaryColor: string; secondaryColor: string; logoLayout: BusinessProfile["logoLayout"]; headerStyle: BusinessProfile["headerStyle"];
  companyBranding: boolean; displayMode: EstimateDisplayMode; defaultGroupVisibility: GroupVisibility;
} & Record<`show.${ShowKey}`, boolean>;

function read(src: { config?: Partial<ProposalConfig>; business?: Partial<BusinessProfile>; estimate?: Partial<Estimate>; style?: CompanyStyle }, k: StyleKey): unknown {
  if (src.style) {
    if (k.startsWith("show.")) return src.style.show?.[k.slice(5) as ShowKey];
    return (src.style as Record<string, unknown>)[k];
  }
  if (k === "template") return src.config?.template;
  if (k.startsWith("show.")) return src.config?.show?.[k.slice(5) as ShowKey];
  if (k === "displayMode" || k === "defaultGroupVisibility") return src.estimate?.[k];
  if (k === "companyBranding") return undefined;
  return (src.business as Record<string, unknown> | undefined)?.[k];
}

/**
 * Resolve the presentation for one bid. `ownerBusiness` is the company owner's business profile
 * (used when company branding is on); `business` is the bid author's own profile.
 */
export function resolveProposalStyle(input: {
  policy: StylePolicy | null | undefined;
  estimate: Estimate;
  business: BusinessProfile;
  config: ProposalConfig;
  ownerBusiness?: BusinessProfile | null;
}): ResolvedStyle {
  const { estimate, config } = input;
  const policy = input.policy?.managed ? input.policy : null;
  const company = sanitizeCompanyStyle(policy?.style);
  const locks = new Set(sanitizeLocks(policy?.locked));
  const bidChoicesApply = !policy || Boolean(policy.allowCustomization && (policy.canCustomize || policy.canOverride));
  const branded = Boolean(policy && company.companyBranding === true && input.ownerBusiness);
  const base: BusinessProfile = branded ? { ...input.ownerBusiness! } : { ...input.business };

  const platformConfig = defaultProposalConfig();
  const platformBusiness = defaultBusinessProfile();
  const platform = (k: StyleKey): unknown => {
    if (k === "primaryColor" || k === "secondaryColor" || k === "logoLayout" || k === "headerStyle") return base[k] ?? platformBusiness[k];
    if (k === "companyBranding") return false;
    if (k === "displayMode") return "by_group";
    if (k === "defaultGroupVisibility") return "itemized";
    return read({ config: platformConfig }, k);
  };
  const bidStyle = sanitizeCompanyStyle((config as unknown as { style?: unknown }).style);
  // Under a managed policy only the keys this bid deliberately changed count as the bid's choices.
  const overrides = new Set(config.styleOverrides ?? []);

  const vals = {} as Record<StyleKey, unknown>;
  const sources = {} as Record<StyleKey, StyleSource>;
  for (const k of STYLE_KEYS) {
    const companyVal = read({ style: company }, k);
    const raw = k === "primaryColor" || k === "secondaryColor" || k === "logoLayout" || k === "headerStyle"
      ? read({ style: bidStyle }, k) ?? (policy ? undefined : base[k])
      : read({ config, estimate }, k);
    const bidVal = !policy || overrides.has(k) ? raw : undefined;
    let v: unknown; let src: StyleSource;
    if (!policy) { v = bidVal; src = "bid"; }
    else if (locks.has(k)) { v = companyVal; src = "locked"; }
    else if (bidChoicesApply && bidVal !== undefined) { v = bidVal; src = "bid"; }
    else { v = companyVal; src = "company"; }
    if (v === undefined || v === null) { v = platform(k); src = policy ? "default" : "bid"; }
    // Platform rules always apply last: malformed values fall back to the platform default.
    const ok = sanitizeCompanyStyle(k.startsWith("show.") ? { show: { [k.slice(5)]: v } } : { [k]: v });
    if (read({ style: ok }, k) === undefined) { v = platform(k); src = "default"; }
    vals[k] = v; sources[k] = src;
  }
  const r = vals as unknown as Vals;
  const show = { ...config.show };
  for (const k of SHOW_KEYS) show[k] = r[`show.${k}`];
  const groups = locks.has("defaultGroupVisibility") ? estimate.groups.map((g) => ({ ...g, visibility: null })) : estimate.groups;

  return {
    config: { ...config, template: r.template, show },
    business: { ...base, primaryColor: r.primaryColor, secondaryColor: r.secondaryColor, logoLayout: r.logoLayout, headerStyle: r.headerStyle },
    estimate: { ...estimate, displayMode: r.displayMode, defaultGroupVisibility: r.defaultGroupVisibility, groups },
    sources,
    bidChoicesApply,
    stamp: { managed: Boolean(policy), revision: policy?.revision ?? null, companyId: policy?.companyId ?? null },
  };
}

/** Whether the bid editor may change a given key on this bid. */
export function canEditStyleKey(policy: StylePolicy | null | undefined, k: StyleKey): boolean {
  if (!policy?.managed) return true;
  if (sanitizeLocks(policy.locked).includes(k)) return false;
  return Boolean(policy.allowCustomization && (policy.canCustomize || policy.canOverride));
}
