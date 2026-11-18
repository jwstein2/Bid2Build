/** Provider-neutral tax types (V6.9). Money is a decimal string ("1234.56"), rates are percents ("7.875"). */

export interface TaxAddress { line1?: string | null; city?: string | null; state?: string | null; zip?: string | null }

/** Construction line classes. The provider decides taxability per jurisdiction; we never assume labor is taxable. */
export const LINE_CLASSES = ["materials", "labor_new_construction", "labor_repair", "installation", "service", "equipment_rental", "permit_fee", "other"] as const;
export type LineClass = (typeof LINE_CLASSES)[number];

export type ContractType = "lump_sum" | "time_and_materials" | "cost_plus" | "mixed";

export interface TaxLineInput {
  ref: string;
  amount: string;
  classification: LineClass;
  /** The contractor's own taxable checkbox: used only when no provider is active (the rate they typed). */
  taxableHint: boolean;
}

export interface TaxRequest {
  address: TaxAddress;
  transactionDate: string;               // YYYY-MM-DD: the legally relevant date (invoice date / agreement date)
  lines: TaxLineInput[];
  contract?: ContractType | null;
  workMix?: "residential" | "commercial" | null;
  /** New construction / capital improvement vs repair and remodeling (construction rules depend on it). */
  work?: "new_construction" | "repair" | null;
  customerId?: string | null;
}

/** What a provider returns for one jurisdiction. */
export interface ProviderJurisdiction {
  code: string;
  name: string;
  level: "state" | "county" | "city" | "special" | "other";
  rate: string;                           // percent
  taxType: "sales" | "use" | "gross_receipts" | "transaction_privilege" | "other";
}

export interface ProviderLine {
  ref: string;
  taxable: boolean;
  /** Provider flagged this line's construction treatment as needing a person's review (no reliable answer). */
  needsReview?: boolean;
  note?: string;
}

export interface ProviderResult {
  provider: string;
  providerRef: string | null;
  jurisdictions: ProviderJurisdiction[];
  lines: ProviderLine[];
  addressValid: boolean;
  dataAsOf: string;                       // ISO time the provider's rate data is current to
  /** Review reasons the provider itself raises (e.g. local rates not loaded yet). */
  reviewReasons?: ReviewReason[];
  /** Plain-language guidance shown with the calculation (construction rule notes). */
  notes?: string[];
  /** Override the engine's staleness window for this data (days). */
  staleAfterDays?: number;
}

export interface TaxProvider {
  name: string;
  calculate(req: TaxRequest): Promise<ProviderResult>;
  /** Combined rates for a jurisdiction on a date (used by the daily update job to detect changes). */
  ratesFor(address: TaxAddress, date: string): Promise<ProviderJurisdiction[]>;
}

export interface CustomerExemption { state: string; reason: string; certificateOnFile: boolean; expiresOn: string | null; certificateRef?: string | null; onlineForm?: boolean }

export type ReviewReason =
  | "invalid_address" | "provider_unavailable" | "stale_rate" | "no_verified_rate" | "conflicting_sources"
  | "construction_treatment_review" | "exemption_missing_certificate" | "exemption_expired" | "exemption_other_state"
  | "unverified_company_rate" | "no_general_sales_tax" | "rule_change_pending"
  | "local_rate_unverified" | "address_approximate" | "zip_spans_jurisdictions" | "exemption_state_form";

export const REVIEW_TEXT: Record<ReviewReason, string> = {
  invalid_address: "The project address couldn't be validated, so the local tax jurisdiction isn't known.",
  provider_unavailable: "The tax service didn't answer. Built2Bid did not substitute a guessed rate.",
  stale_rate: "Using the last verified rate on file. It may be out of date.",
  no_verified_rate: "No verified rate is available for this address. The rate you entered is shown instead.",
  conflicting_sources: "Two sources report different rates for this jurisdiction. Confirm with the official source before sending.",
  construction_treatment_review: "This state treats construction work differently depending on the contract and type of work. Review how this job should be taxed.",
  exemption_missing_certificate: "The customer is marked exempt but no exemption certificate is on file, so tax was not removed.",
  exemption_expired: "The customer's exemption certificate has expired, so tax was not removed.",
  exemption_other_state: "The customer's exemption certificate is for a different state, so tax was not removed.",
  unverified_company_rate: "This uses the rate you entered. It hasn't been checked by a tax service.",
  no_general_sales_tax: "This state has no general statewide sales tax. Check whether a local tax applies before using a rate.",
  rule_change_pending: "A tax rule change in this state is waiting for review.",
  local_rate_unverified: "Local (city, county or district) rates for this address aren't loaded yet, so only the state rate is included. Check the local rate with the official source before sending.",
  address_approximate: "The street address couldn't be matched exactly, so local taxes were found from the ZIP code. Check that the address is complete.",
  zip_spans_jurisdictions: "This ZIP code crosses city or district lines. Built2Bid used the most common area for it; confirm the job address is right.",
  exemption_state_form: "This state may require its own exemption form. The customer's signed Built2Bid certificate is on file; confirm the state accepts it.",
};

export interface TaxJurisdictionResult extends ProviderJurisdiction { taxable: string; tax: string }

export interface TaxResult {
  status: "calculated" | "needs_review" | "failed";
  source: "provider" | "company_rate" | "mock" | "contract";
  provider: string | null;
  providerRef: string | null;
  transactionDate: string;
  address: TaxAddress;
  taxableAmount: string;
  nontaxableAmount: string;
  taxAmount: string;
  combinedRate: string | null;
  jurisdictions: TaxJurisdictionResult[];
  lines: { ref: string; classification: LineClass; amount: string; taxable: boolean; tax: string; needsReview?: boolean }[];
  exemptions: { state: string; reason: string; certificateRef: string | null; applied: boolean }[];
  reviewReasons: ReviewReason[];
  dataAsOf: string | null;
  calculatedAt: string;
  /** Guidance from the construction rules (not legal advice). */
  notes?: string[];
  rulesVersion?: string | null;
}
