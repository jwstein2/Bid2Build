/**
 * The 13 business presets (public.fin_business_config.preset_key). A preset is presentation only: which
 * cards, quick actions, reports, cost codes to suggest and onboarding steps to show first.
 */
import type { CardKey, OnboardingStep, QuickAction, ReportKey } from "./catalog";

export const PRESET_KEYS = [
  "general_contractor", "residential_remodeler", "deck", "roofing_siding", "electrical", "plumbing", "hvac", "concrete", "painting",
  "exterior_cleaning", "drywall", "commercial", "custom",
] as const;
export type PresetKey = (typeof PRESET_KEYS)[number];
export const PRESET_VERSION = 1;

export type CostType = "material" | "labor" | "labor_material" | "equipment" | "subcontractor" | "overhead" | "contingency" | "permit" | "delivery" | "labor_burden" | "other";
export type ProjectModel = "fixed_price" | "time_materials" | "cost_plus" | "service_call" | "mixed";
export type PaymentStructure = "deposit_progress_final" | "milestones" | "progress_sov" | "on_completion" | "time_materials" | "cost_plus" | "mixed";

export interface Preset {
  key: PresetKey;
  label: string;
  cards: readonly CardKey[];
  quickActions: readonly QuickAction[];
  reports: readonly ReportKey[];
  /** Cost types to suggest first for this kind of work (codes are trade x cost type). */
  costTypes: readonly CostType[];
  onboarding: readonly OnboardingStep[];
  defaultProjectModel: ProjectModel;
  defaultPaymentStructure: PaymentStructure;
}

const CORE_CARDS: readonly CardKey[] = ["ar_aging", "milestones_ready", "deposits_outstanding", "job_profitability", "budget_vs_actual"];
const CORE_ACTIONS: readonly QuickAction[] = ["create_invoice", "invoice_milestone", "record_payment", "record_expense"];
const CORE_REPORTS: readonly ReportKey[] = ["profit_loss", "ar_aging", "job_profitability", "budget_vs_actual", "payments_received"];
const CORE_STEPS: readonly OnboardingStep[] = ["confirm_trades", "choose_payment_structure", "review_cost_codes", "connect_first_job"];

const p = (key: PresetKey, label: string, x: Partial<Omit<Preset, "key" | "label">>): Preset => ({
  key, label,
  cards: [...CORE_CARDS, ...(x.cards ?? [])],
  quickActions: [...CORE_ACTIONS, ...(x.quickActions ?? [])],
  reports: [...CORE_REPORTS, ...(x.reports ?? [])],
  costTypes: x.costTypes ?? ["material", "labor", "subcontractor", "permit"],
  onboarding: [...CORE_STEPS, ...(x.onboarding ?? [])],
  defaultProjectModel: x.defaultProjectModel ?? "fixed_price",
  defaultPaymentStructure: x.defaultPaymentStructure ?? "deposit_progress_final",
});

export const PRESETS: Record<PresetKey, Preset> = {
  general_contractor: p("general_contractor", "General contractor", {
    cards: ["open_commitments", "subcontractor_costs", "change_orders_billing", "bills_to_approve", "progress_billing_placeholder"],
    quickActions: ["record_bill", "create_commitment", "bill_change_order"], reports: ["commitments", "change_order_log", "cost_by_code", "vendor_spend", "wip_placeholder"],
    costTypes: ["subcontractor", "material", "labor", "permit", "equipment", "overhead"], onboarding: ["add_vendors", "set_up_commitments"],
    defaultPaymentStructure: "milestones",
  }),
  residential_remodeler: p("residential_remodeler", "Residential remodeler", {
    cards: ["change_orders_billing", "material_costs", "subcontractor_costs", "open_commitments"],
    quickActions: ["bill_change_order", "snap_receipt", "record_bill"], reports: ["change_order_log", "material_spend", "cost_by_code"],
    costTypes: ["material", "labor", "subcontractor", "permit", "delivery"], onboarding: ["add_vendors"],
  }),
  deck: p("deck", "Deck & porch builder", {
    cards: ["material_costs", "labor_costs", "change_orders_billing"], quickActions: ["snap_receipt", "bill_change_order"], reports: ["material_spend"],
    costTypes: ["material", "labor", "delivery", "permit", "equipment"],
  }),
  roofing_siding: p("roofing_siding", "Roofing & siding", {
    cards: ["material_costs", "labor_costs", "subcontractor_costs", "permit_costs"], quickActions: ["snap_receipt", "record_bill"], reports: ["material_spend", "cost_by_code"],
    costTypes: ["material", "labor", "subcontractor", "delivery", "permit", "equipment"], defaultPaymentStructure: "deposit_progress_final",
  }),
  electrical: p("electrical", "Electrical", {
    cards: ["labor_costs", "material_costs", "service_calls_unbilled", "tm_unbilled"], quickActions: ["bill_service_call", "log_time_materials"],
    reports: ["tm_billing", "material_spend"], costTypes: ["labor", "material", "permit", "labor_burden"], onboarding: ["set_up_inventory"], defaultProjectModel: "mixed",
  }),
  plumbing: p("plumbing", "Plumbing", {
    cards: ["labor_costs", "material_costs", "service_calls_unbilled", "tm_unbilled"], quickActions: ["bill_service_call", "log_time_materials"],
    reports: ["tm_billing", "material_spend"], costTypes: ["labor", "material", "permit", "labor_burden"], onboarding: ["set_up_inventory"], defaultProjectModel: "mixed",
  }),
  hvac: p("hvac", "HVAC", {
    cards: ["equipment_costs", "labor_costs", "service_calls_unbilled", "inventory_usage"], quickActions: ["bill_service_call", "log_time_materials"],
    reports: ["tm_billing", "material_spend"], costTypes: ["equipment", "labor", "material", "permit"], onboarding: ["set_up_inventory", "set_up_equipment"], defaultProjectModel: "mixed",
  }),
  concrete: p("concrete", "Concrete & flatwork", {
    cards: ["material_costs", "equipment_costs", "labor_costs", "crew_utilization_placeholder"], quickActions: ["snap_receipt", "record_bill"], reports: ["material_spend", "cost_by_code"],
    costTypes: ["material", "equipment", "labor", "delivery"], onboarding: ["set_up_equipment"],
  }),
  painting: p("painting", "Painting", {
    cards: ["labor_costs", "material_costs", "crew_utilization_placeholder"], quickActions: ["snap_receipt"], reports: ["material_spend"],
    costTypes: ["labor", "material", "equipment"],
  }),
  exterior_cleaning: p("exterior_cleaning", "Cleaning & washing", {
    cards: ["service_calls_unbilled", "payments_received", "labor_costs"], quickActions: ["bill_service_call", "snap_receipt"], reports: ["payments_received"],
    costTypes: ["labor", "material", "equipment"], onboarding: ["set_up_equipment"], defaultProjectModel: "service_call", defaultPaymentStructure: "on_completion",
  }),
  drywall: p("drywall", "Drywall", {
    cards: ["labor_costs", "material_costs", "subcontractor_costs"], quickActions: ["snap_receipt", "record_bill"], reports: ["material_spend", "cost_by_code"],
    costTypes: ["labor", "material", "subcontractor", "delivery"],
  }),
  commercial: p("commercial", "Commercial contractor", {
    cards: ["open_commitments", "subcontractor_costs", "change_orders_billing", "bills_to_approve", "retainage_placeholder", "progress_billing_placeholder"],
    quickActions: ["record_bill", "create_commitment", "bill_change_order"], reports: ["commitments", "change_order_log", "wip_placeholder", "vendor_spend", "cost_by_code"],
    costTypes: ["subcontractor", "labor", "material", "equipment", "overhead", "labor_burden"], onboarding: ["add_vendors", "set_up_commitments", "set_up_retainage_placeholder"],
    defaultPaymentStructure: "progress_sov",
  }),
  custom: p("custom", "Custom", {}),
};

/** Trade slug (src/lib/trades/data.ts) -> preset. Unknown or general trades fall back to the general contractor preset. */
export const TRADE_PRESET: Record<string, PresetKey> = {
  roofing: "roofing_siding", siding: "roofing_siding", gutters: "roofing_siding", "windows-doors": "residential_remodeler",
  decks: "deck", fencing: "deck", "pole-barns": "general_contractor", garages: "general_contractor",
  concrete: "concrete", foundations: "concrete", masonry: "concrete", "asphalt-paving": "concrete", excavation: "concrete",
  kitchens: "residential_remodeler", bathrooms: "residential_remodeler", "interior-remodeling": "residential_remodeler", "exterior-remodeling": "residential_remodeler",
  basements: "residential_remodeler", additions: "residential_remodeler", flooring: "residential_remodeler", tile: "residential_remodeler",
  "finish-carpentry": "residential_remodeler", "cabinets-countertops": "residential_remodeler", framing: "general_contractor", insulation: "drywall",
  demolition: "general_contractor", landscaping: "general_contractor", "tree-removal": "general_contractor", "tree-trimming": "general_contractor", handyman: "residential_remodeler",
  drywall: "drywall", painting: "painting", electrical: "electrical", plumbing: "plumbing", hvac: "hvac",
  "pressure-washing": "exterior_cleaning", "soft-washing": "exterior_cleaning", cleaning: "exterior_cleaning",
  "commercial-remodeling": "commercial", "general-contracting": "general_contractor", other: "custom",
};

export const presetForTrade = (slug: string | null | undefined): PresetKey => (slug ? TRADE_PRESET[slug] ?? "general_contractor" : "custom");
