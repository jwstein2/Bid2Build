import type { BusinessProfile } from "../proposal/types";
import type { EstimateTotals } from "./engine";
import type { Estimate } from "./types";
import type { BuilderStep } from "./workflow";

/**
 * What a proposal needs before it can be finalized and downloaded (or shared). Drafts and previews
 * never need any of this. The builder (before calling the export API) and the export API (before
 * spending a bid credit) both run this same function, so they always agree.
 *
 * Required: the details that otherwise print as placeholders ("Your Company", "Customer",
 * "Project Proposal", no job site) plus a valid, priced estimate. Optional fields stay optional.
 */
export type ReadinessCode =
  | "company_name"
  | "customer_name"
  | "project_title"
  | "project_address"
  | "no_items"
  | "invalid_items"
  | "zero_total";

export interface ReadinessIssue {
  code: ReadinessCode;
  /** Builder step that holds the missing information. */
  step: BuilderStep;
  /** id of the input to focus, when there is one. */
  fieldId?: string;
  message: string;
}

const blank = (s?: string | null) => !s || !s.trim();

export function exportReadiness(
  estimate: Estimate,
  business: Pick<BusinessProfile, "companyName"> | null | undefined,
  totals: Pick<EstimateTotals, "issues" | "total">,
): ReadinessIssue[] {
  const out: ReadinessIssue[] = [];
  if (blank(business?.companyName)) out.push({ code: "company_name", step: "company", fieldId: "b-name", message: "Add your company name before downloading this proposal." });
  if (blank(estimate.customer.name)) out.push({ code: "customer_name", step: "project", fieldId: "c-name", message: "Add the customer's name before downloading this proposal." });
  if (blank(estimate.title)) out.push({ code: "project_title", step: "project", fieldId: "p-title", message: "Add a project title before downloading this proposal." });
  if (blank(estimate.customer.projectAddress)) out.push({ code: "project_address", step: "project", fieldId: "c-addr", message: "Add a project address before downloading this proposal." });
  const realItems = estimate.items.filter((i) => !i.isExample);
  if (realItems.length === 0) out.push({ code: "no_items", step: "estimate", message: "Add at least one line item before downloading this proposal." });
  else if (totals.issues.length) out.push({ code: "invalid_items", step: "estimate", message: "Fix the highlighted entries in your estimate before downloading this proposal." });
  else if (!totals.total.gt(0)) out.push({ code: "zero_total", step: "estimate", message: "Your estimate totals $0. Enter costs for your line items before downloading this proposal." });
  return out;
}

/** True when the Customer & project step has everything the proposal needs. */
export function isProjectComplete(estimate: Estimate): boolean {
  return !blank(estimate.customer.name) && !blank(estimate.title) && !blank(estimate.customer.projectAddress);
}

/** True when the estimate has at least one valid line item and a price above $0. */
export function isEstimateComplete(estimate: Estimate, totals: Pick<EstimateTotals, "issues" | "total">): boolean {
  return estimate.items.some((i) => !i.isExample) && totals.issues.length === 0 && totals.total.gt(0);
}
