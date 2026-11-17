/**
 * The profile rules engine: business configuration (+ an optional project override) -> what to show.
 * Pure and deterministic. The database only stores the configuration; nothing here is read by an
 * entitlement or permission check, and nothing here changes a recorded financial row.
 */
import type { CardKey, OnboardingStep, QuickAction, ReportKey } from "./catalog";
import { PRESETS, type CostType, type PaymentStructure, type PresetKey, type ProjectModel, presetForTrade } from "./presets";

export type Market = "residential" | "commercial" | "mixed";
export type Workflow = "residential" | "commercial" | "service";

export interface BusinessConfig {
  primaryTradeSlug: string | null;
  additionalTradeSlugs?: readonly string[];
  presetKey?: PresetKey | null;
  market?: Market;
  projectModel?: ProjectModel;
  paymentStructure?: PaymentStructure;
  laborModel?: "employees" | "subcontractors" | "both";
  usesInventory?: boolean;
  usesEquipment?: boolean;
}

/** public.fin_project_profiles: only the fields that are set override the company configuration. */
export interface ProjectOverride {
  primaryTradeSlug?: string | null;
  market?: Market | null;
  projectModel?: Exclude<ProjectModel, "mixed"> | null;
  paymentStructure?: Exclude<PaymentStructure, "mixed"> | null;
  workflow?: Workflow | null;
}

export interface CostCodeSuggestion { code: string; tradeSlug: string | null; costType: CostType }

export interface ResolvedProfile {
  presetKey: PresetKey;
  presets: PresetKey[];
  trades: string[];
  market: Market;
  projectModel: ProjectModel;
  paymentStructure: PaymentStructure;
  cards: CardKey[];
  quickActions: QuickAction[];
  reports: ReportKey[];
  costCodeSuggestions: CostCodeSuggestion[];
  onboardingSteps: OnboardingStep[];
}

const uniq = <T,>(xs: readonly T[]): T[] => [...new Set(xs)];

export function resolveProfile(config: BusinessConfig): ResolvedProfile {
  const trades = uniq([config.primaryTradeSlug, ...(config.additionalTradeSlugs ?? [])].filter((t): t is string => Boolean(t)));
  const primary: PresetKey = config.presetKey ?? presetForTrade(config.primaryTradeSlug);
  // Multi-trade: the primary preset first, then each additional trade's preset (deduped, order kept).
  const presets = uniq([primary, ...trades.slice(config.primaryTradeSlug ? 1 : 0).map(presetForTrade)]);
  const base = PRESETS[primary];
  const market = config.market ?? (primary === "commercial" ? "commercial" : "residential");
  const projectModel = config.projectModel ?? base.defaultProjectModel;
  const paymentStructure = config.paymentStructure ?? base.defaultPaymentStructure;

  let cards = uniq(presets.flatMap((k) => PRESETS[k].cards));
  let quickActions = uniq(presets.flatMap((k) => PRESETS[k].quickActions));
  let reports = uniq(presets.flatMap((k) => PRESETS[k].reports));
  let onboarding = uniq(presets.flatMap((k) => PRESETS[k].onboarding));

  // Modifiers from the rest of the configuration (additive, deterministic order).
  if (market !== "residential") { cards = uniq([...cards, "retainage_placeholder", "progress_billing_placeholder"]); onboarding = uniq([...onboarding, "set_up_retainage_placeholder"]); }
  if (projectModel === "time_materials" || projectModel === "cost_plus" || projectModel === "mixed" || paymentStructure === "time_materials") {
    cards = uniq([...cards, "tm_unbilled"]); quickActions = uniq([...quickActions, "log_time_materials"]); reports = uniq([...reports, "tm_billing"]);
  }
  if (projectModel === "service_call") { cards = uniq([...cards, "service_calls_unbilled"]); quickActions = uniq([...quickActions, "bill_service_call"]); }
  if (paymentStructure === "progress_sov") cards = uniq([...cards, "progress_billing_placeholder"]);
  if (config.laborModel === "subcontractors" || config.laborModel === "both") {
    cards = uniq([...cards, "subcontractor_costs", "open_commitments"]); quickActions = uniq([...quickActions, "record_bill", "create_commitment"]);
    if (config.laborModel === "subcontractors") onboarding = uniq([...onboarding, "add_vendors", "set_up_commitments"]);
  }
  if (config.usesInventory) { cards = uniq([...cards, "inventory_usage"]); onboarding = uniq([...onboarding, "set_up_inventory"]); }
  if (config.usesEquipment) { cards = uniq([...cards, "equipment_costs"]); onboarding = uniq([...onboarding, "set_up_equipment"]); }
  onboarding = uniq([...onboarding, "set_invoice_defaults", "invite_bookkeeper", "invite_accountant"]);

  // Cost code suggestions: trade x cost type (same "<trade>:<cost_type>" codes the database seeds), each
  // trade with its preset's emphasis first, then the general codes.
  const costCodeSuggestions: CostCodeSuggestion[] = [];
  const seen = new Set<string>();
  for (const t of trades) for (const ct of PRESETS[presetForTrade(t)].costTypes) {
    const code = `${t}:${ct}`;
    if (!seen.has(code)) { seen.add(code); costCodeSuggestions.push({ code, tradeSlug: t, costType: ct }); }
  }
  for (const ct of ["overhead", "other"] as const) costCodeSuggestions.push({ code: `general:${ct}`, tradeSlug: null, costType: ct });

  return { presetKey: primary, presets, trades, market, projectModel, paymentStructure, cards, quickActions, reports, costCodeSuggestions, onboardingSteps: onboarding };
}

/** A project's effective profile: the company configuration with the project's override applied. */
export function resolveProjectProfile(company: BusinessConfig, override?: ProjectOverride | null): ResolvedProfile {
  if (!override) return resolveProfile(company);
  const primary = override.primaryTradeSlug ?? company.primaryTradeSlug;
  const workflowMarket: Market | undefined = override.workflow === "commercial" ? "commercial" : override.workflow === "residential" ? "residential" : undefined;
  return resolveProfile({
    ...company,
    primaryTradeSlug: primary,
    // An overridden trade picks its own preset; additional company trades don't apply to a single job.
    presetKey: override.primaryTradeSlug ? null : company.presetKey,
    additionalTradeSlugs: override.primaryTradeSlug ? [] : company.additionalTradeSlugs,
    market: override.market ?? workflowMarket ?? company.market,
    projectModel: override.projectModel ?? (override.workflow === "service" ? "service_call" : company.projectModel),
    paymentStructure: override.paymentStructure ?? company.paymentStructure,
  });
}
