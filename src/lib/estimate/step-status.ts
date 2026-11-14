import type { BusinessProfile, ProposalConfig } from "../proposal/types";
import type { EstimateTotals } from "./engine";
import { exportReadiness, isEstimateComplete, isProjectComplete } from "./readiness";
import type { Estimate } from "./types";
import { BUILDER_STEPS, isCompanyComplete, type BuilderStep } from "./workflow";

/**
 * Builder step indicators.
 *  - complete:        everything this step needs is filled in (green check)
 *  - needs_attention: a required step that was opened but is still missing something (amber "!")
 *  - visited:         an optional step that was opened (no check, no warning)
 *  - todo:            not opened yet (step number)
 * Opening a step never marks it complete, and an estimate with invalid or unpriced items never shows a check.
 * Steps can still be visited in any order.
 */
export type StepStatus = "complete" | "needs_attention" | "visited" | "todo";

const REQUIRED: ReadonlySet<BuilderStep> = new Set(["company", "project", "estimate"]);

export function stepStatuses(input: {
  estimate: Estimate;
  business: Partial<BusinessProfile> | null | undefined;
  config: Pick<ProposalConfig, "scopeOfWork" | "exclusionList">;
  totals: Pick<EstimateTotals, "issues" | "total">;
  visited: ReadonlySet<BuilderStep>;
  /** The current version has been finalized (downloaded). */
  finalized: boolean;
}): Record<BuilderStep, StepStatus> {
  const { estimate, business, config, totals, visited, finalized } = input;
  const done: Record<BuilderStep, boolean> = {
    company: isCompanyComplete(business),
    project: isProjectComplete(estimate),
    estimate: isEstimateComplete(estimate, totals),
    scope: Boolean(config.scopeOfWork?.trim()) || Boolean(config.exclusionList?.items?.some((i) => i.status === "approved")),
    proposal: finalized && exportReadiness(estimate, { companyName: business?.companyName ?? "" }, totals).length === 0,
  };
  const out = {} as Record<BuilderStep, StepStatus>;
  for (const s of BUILDER_STEPS) {
    out[s] = done[s] ? "complete" : !visited.has(s) ? "todo" : REQUIRED.has(s) ? "needs_attention" : "visited";
  }
  return out;
}
