/**
 * Public marketing catalog (V4.7): what the homepage pillars and the pricing comparison may say
 * Built2Bid does, which plan it needs and whether it is live. One list, so the homepage, pricing
 * table and upgrade copy can't drift apart.
 *
 * Rules (tests/marketing-catalog.test.ts):
 * - A feature is advertised as available only when `release` is "live" AND its production flag is on
 *   (`gate`). Otherwise every surface shows it as Coming Soon. Code existing in a branch is not
 *   "live": a person flips `release` in a reviewed PR after the feature is deployed and verified.
 * - Prices are never typed here. They come from the billing modules Stripe is checked against.
 * - `registry` links to src/lib/features/registry.ts when the feature has an in-app entry, so the
 *   entitlement here can be checked against the one the app enforces.
 * Nothing in this file is generated; marketing claims are written and reviewed by people.
 */
import { MONTHLY, ANNUAL, formatUsd } from "@/lib/billing/plans";
import { FREE_SAVED_ITEMS_LIMIT } from "@/lib/library/saved-items";
import { PM_ADDON_ANNUAL_CENTS, PM_ADDON_CENTS, PM_EDITOR_CENTS, PM_INCLUDED_ENTERPRISE_EDITORS } from "@/lib/pm/billing";
import { ENTERPRISE_BASE_CENTS, ENTERPRISE_INCLUDED_USERS } from "@/lib/enterprise/pricing";
import { isEsignEnabled } from "@/lib/esign/config";
import type { FeatureId } from "@/lib/features/registry";

/** The one public name for the scheduling add-on (matches the live Stripe product name). */
export const PM_PRODUCT_NAME = "Project Command Center";

export const PRICES = {
  unlimitedMonthly: MONTHLY.price,
  unlimitedAnnual: ANNUAL.price,
  pmMonthly: formatUsd(PM_ADDON_CENTS),
  pmAnnual: formatUsd(PM_ADDON_ANNUAL_CENTS),
  pmEditor: formatUsd(PM_EDITOR_CENTS),
  pmIncludedEnterpriseEditors: PM_INCLUDED_ENTERPRISE_EDITORS,
  enterpriseBase: formatUsd(ENTERPRISE_BASE_CENTS),
  enterpriseIncludedUsers: ENTERPRISE_INCLUDED_USERS,
} as const;

export type Pillar = "win" | "run" | "grow";
/** Who gets it: every account, Unlimited, the PM add-on (or an Enterprise PM editor seat), or Enterprise only. */
export type Tier = "core" | "unlimited" | "pm" | "enterprise";
export type CompareGroup = "estimating" | "sales" | "customers" | "projects" | "communications" | "team";
/** A comparison cell. Strings are short explanations shown as written. */
export type Cell = "included" | "addon" | "enterprise" | "soon" | "no" | { text: string };
/** Production switch a live feature also needs before it is marketed as available. */
export type Gate = "pm" | "esign";

export interface MarketingFeature {
  id: string;
  name: string;
  /** One plain sentence. Must stay true for every plan that shows it as included. */
  description: string;
  pillar: Pillar;
  group: CompareGroup;
  tier: Tier;
  release: "live" | "coming_soon";
  gate?: Gate;
  registry?: FeatureId;
  /** Where the feature lives in the app, for signed-in links and walkthroughs. */
  destination: string;
  /** Where a locked account goes to get it. */
  upgrade: string;
  /** Show on the homepage pillar list. */
  home?: boolean;
  /** Short explanation shown under the name in the comparison table (advanced features). */
  hint?: string;
  /** Overrides the cells the tier would produce. */
  cells?: Partial<Record<"free" | "unlimited" | "enterprise", Cell>>;
}

export const PILLARS: Record<Pillar, { title: string; kicker: string; lead: string }> = {
  win: {
    title: "Win the Job",
    kicker: "Estimates, proposals and signatures",
    lead: "Build a clear estimate for your trade, send a proposal your customer can sign online, and see every bid from draft to approved.",
  },
  run: {
    title: "Run the Job",
    kicker: `${PM_PRODUCT_NAME} add-on`,
    lead: "Turn a won bid into a schedule built from the estimate, then assign your crew and subs and track real progress on a timeline and company calendar.",
  },
  grow: {
    title: "Grow the Business",
    kicker: "Customers, numbers and your team",
    lead: "Keep customers informed with progress updates you approve, know your numbers on every job, and bring your whole team into one account.",
  },
};

export const GROUP_TITLES: Record<CompareGroup, string> = {
  estimating: "Estimating",
  sales: "Sales & Proposals",
  customers: "Customer Management",
  projects: "Project Management",
  communications: "Customer Communications",
  team: "Team & Company Controls",
};

const pmUpgrade = "/pricing#project-command-center";

export const MARKETING_FEATURES: readonly MarketingFeature[] = [
  // Win the Job: estimating
  { id: "trade_templates", name: "Trade-specific estimate builders", description: "Start from sections made for roofing, decks, painting, concrete, remodeling and 30+ more trades, or a blank estimate.", pillar: "win", group: "estimating", tier: "core", release: "live", destination: "/bids", upgrade: "/bids", home: true },
  { id: "calculators", name: "Quantity calculators", description: "Work out squares, boards, gallons, yards and labor hours right inside the line item.", pillar: "win", group: "estimating", tier: "core", release: "live", destination: "/bids", upgrade: "/bids", home: true },
  { id: "pricing_tools", name: "Materials, labor, markup and margin", description: "Enter your own costs and price with markup or target margin while price, tax and profit update live.", pillar: "win", group: "estimating", tier: "core", release: "live", destination: "/bids", upgrade: "/bids" },
  { id: "scope_exclusions", name: "Professional scopes and exclusions", description: "Spell out what is and isn't included so the customer knows exactly what they are buying.", pillar: "win", group: "estimating", tier: "core", release: "live", destination: "/bids", upgrade: "/bids" },
  { id: "saved_items", name: "Saved Items & Pricing", description: "Save your labor rates, material costs and common items, then add them to any bid in a tap.", pillar: "win", group: "estimating", tier: "unlimited", release: "live", registry: "library", destination: "/dashboard/items", upgrade: "/pricing", home: true, cells: { free: { text: `Up to ${FREE_SAVED_ITEMS_LIMIT} items, kept when you upgrade` } } },
  { id: "sub_quotes", name: "Subcontractor quotes", description: "Record sub quotes on any line and see the effect on your margin. Never shown to customers.", pillar: "win", group: "estimating", tier: "core", release: "live", registry: "sub_quotes", destination: "/dashboard?view=table", upgrade: "/bids", hint: "Compare original and revised sub bids per line item." },

  // Win the Job: sales & proposals
  { id: "proposals", name: "Customer-ready branded proposals", description: "Choose what the customer sees, preview it, and download a branded PDF or email it from your own address.", pillar: "win", group: "sales", tier: "core", release: "live", destination: "/bids", upgrade: "/bids", home: true },
  { id: "templates", name: "Proposal Templates", description: "Set up your proposal layout and default wording once and reuse it on every bid.", pillar: "win", group: "sales", tier: "unlimited", release: "live", registry: "templates", destination: "/dashboard/templates", upgrade: "/pricing" },
  { id: "esign", name: "E-signatures", description: "Send a secure signing link. The signed PDF and its audit trail are saved with the bid.", pillar: "win", group: "sales", tier: "core", release: "live", gate: "esign", destination: "/dashboard", upgrade: "/bids", home: true },
  { id: "pipeline", name: "Sales pipeline", description: "See every bid as a card from Draft to Won, with the next step for each one.", pillar: "win", group: "sales", tier: "core", release: "live", registry: "pipeline", destination: "/dashboard?view=pipeline", upgrade: "/bids", home: true },
  { id: "versions", name: "Proposal versions and approval history", description: "Every finalized version and signature is kept, so you can see what the customer approved and when.", pillar: "win", group: "sales", tier: "core", release: "live", destination: "/dashboard", upgrade: "/bids" },
  { id: "change_orders", name: "Change orders", description: "Separate, signable change orders on approved bids, with a running contract total.", pillar: "win", group: "sales", tier: "core", release: "live", registry: "change_orders", destination: "/projects", upgrade: "/bids", home: true, hint: "Created from an approved bid; the contract total updates only when it's approved." },

  // Customers
  { id: "customer_directory", name: "Customer directory", description: "Save customers once and reuse their details on every bid.", pillar: "grow", group: "customers", tier: "core", release: "live", destination: "/dashboard/customers", upgrade: "/bids" },
  { id: "analytics", name: "Sales analytics", description: "Bids sent, won and lost, win rate and average job size for any date range.", pillar: "grow", group: "customers", tier: "core", release: "live", registry: "analytics", destination: "/dashboard?view=analytics", upgrade: "/bids", home: true },
  { id: "internal_report", name: "Internal Estimate Report", description: "A private PDF of costs, markup, margin and profit by section. Never shown to customers.", pillar: "grow", group: "customers", tier: "unlimited", release: "live", registry: "internal_report", destination: "/dashboard?view=table", upgrade: "/pricing", home: true, hint: "For you and your team only." },

  // Run the Job: Project Command Center
  { id: "schedule_now", name: "Schedule Now from a won bid", description: "Build a job schedule from the estimate's sections in a few steps, next to your company calendar.", pillar: "run", group: "projects", tier: "pm", release: "live", gate: "pm", registry: "project_scheduling", destination: "/projects", upgrade: pmUpgrade, home: true },
  { id: "gantt", name: "Gantt timeline", description: "Drag tasks to change dates and see what else moves before you save.", pillar: "run", group: "projects", tier: "pm", release: "live", gate: "pm", destination: "/projects", upgrade: pmUpgrade, home: true },
  { id: "calendar", name: "Company calendar and workload", description: "Every scheduled job by month, week or day, with possible crew overlaps flagged.", pillar: "run", group: "projects", tier: "pm", release: "live", gate: "pm", destination: "/projects", upgrade: pmUpgrade, home: true },
  { id: "assignments", name: "Staff and subcontractor assignments", description: "Keep a directory of staff, crews and subs and assign them to sections and tasks.", pillar: "run", group: "projects", tier: "pm", release: "live", gate: "pm", destination: "/projects/team", upgrade: pmUpgrade, home: true },
  { id: "progress", name: "Progress tracking", description: "Record status and percent complete per task. Progress is what you enter, not days passed.", pillar: "run", group: "projects", tier: "pm", release: "live", gate: "pm", destination: "/projects", upgrade: pmUpgrade, home: true },
  { id: "project_ops", name: "Project review, trade scopes and photos", description: "Review newly approved jobs, build trade scopes for your subs and keep job photos together.", pillar: "run", group: "projects", tier: "pm", release: "live", gate: "pm", registry: "project_operations", destination: "/projects", upgrade: pmUpgrade },

  // Communications
  { id: "customer_updates", name: "Customer progress updates", description: "Preview and publish a progress report from your schedule, then share it as a secure link and PDF from your own email.", pillar: "grow", group: "communications", tier: "pm", release: "live", gate: "pm", destination: "/projects", upgrade: pmUpgrade, home: true, hint: "Built only from progress you've recorded. You review every update before it's shared." },
  { id: "scheduled_updates", name: "Scheduled weekly and milestone update emails", description: "Weekly or section-completion progress emails, with review-before-send or approved automatic sending.", pillar: "grow", group: "communications", tier: "pm", release: "live", gate: "pm", destination: "/projects", upgrade: pmUpgrade, home: true },
  { id: "nurture", name: "Customer follow-ups", description: "Optional six-month check-ins with past customers, reviewed by you before sending and stopped when they opt out.", pillar: "grow", group: "communications", tier: "pm", release: "live", gate: "pm", destination: "/dashboard/customers", upgrade: pmUpgrade, home: true },

  // Team & Enterprise
  { id: "team", name: "Multi-user company account", description: `${PRICES.enterpriseIncludedUsers} licensed users included, each with their own login and unlimited bidding.`, pillar: "grow", group: "team", tier: "enterprise", release: "live", destination: "/company", upgrade: "/pricing#enterprise", home: true, cells: { free: { text: "1 user" }, unlimited: { text: "1 user" }, enterprise: { text: `${PRICES.enterpriseIncludedUsers} included, more at volume pricing` } } },
  { id: "permissions", name: "Roles and permissions", description: "Owner, manager, estimator and viewer roles, with permissions you can grant or remove per person.", pillar: "grow", group: "team", tier: "enterprise", release: "live", destination: "/company/users", upgrade: "/pricing#enterprise" },
  { id: "company_dashboard", name: "Company dashboard and team pipeline", description: "Company-wide bids, pipeline and performance, filtered by person, with permission controls.", pillar: "grow", group: "team", tier: "enterprise", release: "live", destination: "/company", upgrade: "/pricing#enterprise" },
  { id: "bid_style", name: "Company-wide bid style", description: "One proposal look for the whole company, with locks on what your team may change.", pillar: "grow", group: "team", tier: "enterprise", release: "live", destination: "/company/proposal-style", upgrade: "/pricing#enterprise" },
  { id: "shared_company", name: "Shared customers, saved pricing and billing", description: "Company customers, saved pricing and one bill for every licensed user.", pillar: "grow", group: "team", tier: "enterprise", release: "live", destination: "/company", upgrade: "/pricing#enterprise" },
  { id: "pm_editors", name: `${PM_PRODUCT_NAME} editors`, description: `Team includes ${PRICES.pmIncludedEnterpriseEditors} schedule editor for one licensed user. Each extra editor is ${PRICES.pmEditor}/month and needs a licensed user.`, pillar: "run", group: "team", tier: "enterprise", release: "live", gate: "pm", destination: "/company/billing", upgrade: "/pricing#enterprise", hint: "An editor seat is not a user license. It lets a licensed user edit schedules.",
    cells: { free: "no", unlimited: { text: `You, with the add-on` }, enterprise: { text: `1 included, extra ${PRICES.pmEditor}/mo each` } } },
] as const;

export type FeatureStatus = "live" | "coming_soon";

/** Production switches. Read at call time so builds and tests see the deploy's own values. */
export function gateOpen(gate: Gate | undefined, env: Record<string, string | undefined> = process.env): boolean {
  if (!gate) return true;
  if (gate === "pm") return env.NEXT_PUBLIC_PROJECT_SCHEDULING === "on";
  return isEsignEnabled({ NEXT_PUBLIC_ESIGNATURES: env.NEXT_PUBLIC_ESIGNATURES });
}

/** Live only when released AND switched on in this deploy. */
export function featureStatus(f: MarketingFeature, env?: Record<string, string | undefined>): FeatureStatus {
  return f.release === "live" && gateOpen(f.gate, env) ? "live" : "coming_soon";
}

/** The comparison cell for a plan column. Coming Soon features never show as included. */
export function cellFor(f: MarketingFeature, plan: "free" | "unlimited" | "enterprise", env?: Record<string, string | undefined>): Cell {
  if (featureStatus(f, env) === "coming_soon") return "soon";
  const override = f.cells?.[plan];
  if (override) return override;
  switch (f.tier) {
    case "core": return "included";
    case "unlimited": return plan === "free" ? "no" : "included";
    case "pm": return plan === "free" ? "no" : plan === "unlimited" ? "addon" : "enterprise";
    case "enterprise": return plan === "enterprise" ? "included" : "no";
  }
}

/** True when any Project Command Center feature is marketed as live on this deploy. */
export function pmMarketedLive(env?: Record<string, string | undefined>): boolean {
  return MARKETING_FEATURES.some((f) => f.tier === "pm" && featureStatus(f, env) === "live");
}

export function featuresFor(pillar: Pillar, opts: { homeOnly?: boolean } = {}): MarketingFeature[] {
  return MARKETING_FEATURES.filter((f) => f.pillar === pillar && (!opts.homeOnly || f.home));
}

/** Label shown next to a feature on the homepage. */
export function tierBadge(f: MarketingFeature, env?: Record<string, string | undefined>): { label: string; tone: "core" | "premium" | "soon" } {
  if (featureStatus(f, env) === "coming_soon") return { label: "Coming soon", tone: "soon" };
  switch (f.tier) {
    case "core": return { label: "Included free", tone: "core" };
    case "unlimited": return { label: "Unlimited", tone: "premium" };
    case "pm": return { label: PM_PRODUCT_NAME, tone: "premium" };
    case "enterprise": return { label: "Team", tone: "premium" };
  }
}

/** Plain words for a cell, for screen readers and the mobile legend. */
export function cellLabel(c: Cell): string {
  if (typeof c === "object") return c.text;
  return {
    included: "Included",
    addon: `Add-on, ${PRICES.pmMonthly}/mo`,
    enterprise: `Included for ${PRICES.pmIncludedEnterpriseEditors} editor`,
    soon: "Coming soon",
    no: "Not included",
  }[c];
}

/** Upgrade copy for a person who opens Project Command Center without it. */
export function pmUpgradeCopy(kind: "free" | "unlimited" | "company"): { title: string; body: string; href: string; cta: string } {
  if (kind === "company") return { title: `${PM_PRODUCT_NAME} needs an editor seat`, body: "Ask your company admin to assign you a schedule editor seat.", href: "/company", cta: "" };
  if (kind === "free") {
    return {
      title: `${PM_PRODUCT_NAME} is an add-on for Unlimited`,
      body: `Schedule jobs, manage subcontractors, track progress and keep customers informed. Start Unlimited (${PRICES.unlimitedMonthly}/month or ${PRICES.unlimitedAnnual}/year), then add ${PM_PRODUCT_NAME} for ${PRICES.pmMonthly}/month.`,
      href: pmUpgrade,
      cta: "See plans",
    };
  }
  return {
    title: `Unlock ${PM_PRODUCT_NAME}`,
    body: `Schedule jobs, manage subcontractors, track progress and keep customers informed. ${PRICES.pmMonthly}/month added to your Unlimited plan (${PRICES.pmAnnual}/year on annual plans).`,
    href: "/settings/billing#project-command-center",
    cta: `Unlock ${PM_PRODUCT_NAME}`,
  };
}
