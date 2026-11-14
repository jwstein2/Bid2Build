/** Canonical estimate data model shared by the editor, persistence, preview and PDF. */
import type { ProjectProfile } from "../market/trade-models";
import type { EstimateWorksheet } from "../calculators/types";

export type PricingMode = "markup" | "margin";

export type CostType =
  | "material"
  | "labor"
  /** One row covering both labor and materials (a classification only: no split pricing). */
  | "labor_material"
  | "equipment"
  | "subcontractor"
  | "overhead"
  | "contingency"
  | "permit"
  | "delivery"
  | "labor_burden"
  | "other";

/**
 * marked_up: an estimated direct cost; the pricing method (markup or margin) is applied.
 * pass_through: a separate customer-facing charge billed at cost (e.g. permit fees).
 */
export type ChargeTreatment = "marked_up" | "pass_through";

/** How a group is presented to the customer. */
export type GroupVisibility = "group_total" | "names_only" | "itemized";

/** Estimate-wide presentation. "by_group" lets each group choose its own visibility. */
export type EstimateDisplayMode = "by_group" | "project_total";

export interface PricingRule {
  mode: PricingMode;
  /** Percentage as a decimal string, e.g. "25" for 25%. */
  percent: string;
}

export interface LineItem {
  id: string;
  groupId: string;
  name: string;
  description?: string;
  category?: string;
  costType: CostType;
  treatment: ChargeTreatment;
  /** Decimal strings to avoid float drift. */
  quantity: string;
  unit: string;
  unitCost: string;
  taxable: boolean;
  /** Overrides the estimate pricing rule for this item only. */
  pricingOverride?: PricingRule | null;
  /** If false the item is excluded from the customer-facing item list (price still counts). */
  showOnProposal: boolean;
  notes?: string;
  sortOrder: number;
  /** Example/placeholder rows never count toward totals. */
  isExample?: boolean;
  /** Optional regional reference attached for display only. */
  favoriteId?: string | null;
}

export interface EstimateGroup {
  id: string;
  name: string;
  description?: string;
  /** null = use estimate default. */
  visibility: GroupVisibility | null;
  sortOrder: number;
  /** Override pricing for every item in the group (items may still override). */
  pricingOverride?: PricingRule | null;
  /**
   * Slug of the project trade this section belongs to (see lib/estimate/trades.ts). Missing on
   * sections saved before trade sections existed: those belong to the primary trade.
   */
  trade?: string | null;
}

export interface EstimateCustomer {
  name: string;
  email?: string;
  phone?: string;
  projectAddress?: string;
  notes?: string;
}

export interface Estimate {
  id: string;
  title: string;
  /** Primary trade slug plus any additional trades for mixed projects. */
  trades: string[];
  estimateNumber: string;
  estimateDate: string; // ISO date
  expirationDate: string; // ISO date
  status: "draft" | "finalized" | "archived";
  customer: EstimateCustomer;
  location: { zip?: string; city?: string; state?: string };
  pricing: PricingRule;
  /** Signed decimal string. Negative = discount. Applied to pre-tax price. */
  fixedAdjustment: string;
  adjustmentLabel?: string;
  /** Sales tax percentage applied to taxable items. */
  taxRate: string;
  /**
   * Round the final bid total (after tax) to the nearest whole dollar. The difference is shown as a
   * separate rounding line; line items, markup and tax are never changed. Missing/false = exact cents.
   * Persisted in estimates.proposal_config.roundTotal (no column).
   */
  roundTotal?: boolean;
  displayMode: EstimateDisplayMode;
  defaultGroupVisibility: GroupVisibility;
  groups: EstimateGroup[];
  items: LineItem[];
  /** Template version the estimate was started from (templates never mutate existing estimates). */
  templateRef?: { trade: string; version: number } | null;
  /** Saved customer this estimate was created for (optional). */
  customerId?: string | null;
  /**
   * Structured project facts for benchmarking (sector, work type, measurements, bid outcome).
   * Never shown to the customer and excluded from the version hash, so editing it never creates a new version.
   */
  projectProfile?: ProjectProfile | null;
  /**
   * Contractor working data: applied quantity-calculator inputs (by line item) and the minimum job
   * charge. Never shown to the customer and excluded from the version hash: only the quantities a
   * calculation was applied to are part of the bid. Persisted inside estimates.proposal_config.
   */
  worksheet?: EstimateWorksheet | null;
  updatedAt?: string;
}
