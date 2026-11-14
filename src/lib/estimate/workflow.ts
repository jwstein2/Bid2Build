import type { BusinessProfile } from "../proposal/types";
import type { Estimate } from "./types";

/**
 * Bid builder workflow: which step a bid opens on.
 *
 * Every brand-new bid starts at the trade chooser ("What are you bidding today?" on /bids), which
 * creates the draft with that trade through /start/[trade]. After that:
 *  - no complete company profile  → Step 1, Company
 *  - a complete company profile   → Step 2, Customer & project (Company shows a check mark)
 * A draft that is being resumed opens on the step the contractor was last on, when this device
 * remembers it; otherwise at the estimate once the bid has a customer or line items.
 */
export type BuilderStep = "company" | "project" | "estimate" | "scope" | "proposal";
export const BUILDER_STEPS: readonly BuilderStep[] = ["company", "project", "estimate", "scope", "proposal"];

export function isBuilderStep(v: unknown): v is BuilderStep {
  return typeof v === "string" && (BUILDER_STEPS as readonly string[]).includes(v);
}

/** The fields the company form marks as required. A profile is complete only when all are filled. */
export const REQUIRED_COMPANY_FIELDS = ["companyName", "contactName", "email", "phone", "address"] as const satisfies readonly (keyof BusinessProfile)[];

export function missingCompanyFields(b: Partial<BusinessProfile> | null | undefined): (typeof REQUIRED_COMPANY_FIELDS)[number][] {
  return REQUIRED_COMPANY_FIELDS.filter((k) => !String(b?.[k] ?? "").trim());
}

export function isCompanyComplete(b: Partial<BusinessProfile> | null | undefined): boolean {
  return missingCompanyFields(b).length === 0;
}

export function resolveStartStep(opts: {
  companyComplete: boolean;
  estimate: Pick<Estimate, "customer" | "items">;
  /** The step this device last showed for this bid, if any. */
  saved?: BuilderStep | null;
  /** A step the URL asks for (e.g. ?step=proposal from the dashboard). */
  requested?: BuilderStep | null;
}): BuilderStep {
  if (opts.requested) return opts.requested;
  if (opts.saved) return opts.saved;
  // A bid already under way resumes at the estimate rather than restarting the workflow.
  const started = Boolean(opts.estimate.customer.name?.trim()) || opts.estimate.items.some((i) => !i.isExample);
  if (started) return "estimate";
  return opts.companyComplete ? "project" : "company";
}
