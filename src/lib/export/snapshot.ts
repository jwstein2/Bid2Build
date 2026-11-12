import { createHash } from "node:crypto";
import type { Estimate } from "../estimate/types";
import type { BusinessProfile, ProposalConfig } from "../proposal/types";

/** Deterministic JSON (sorted keys) so equal content always hashes equally. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`;
}

/**
 * The inputs that define a finalized proposal version. Workflow-only fields (status, timestamps)
 * are excluded so re-downloading an unchanged estimate maps to the same version.
 */
export function versionSnapshot(estimate: Estimate, business: BusinessProfile & { logoPath?: string | null }, config: ProposalConfig) {
  const { status: _s, updatedAt: _u, customerId: _c, ...est } = estimate;
  void _c;
  void _s; void _u;
  const { logoUrl: _l, ...biz } = business;
  void _l;
  // Revision history is editing state, not part of what was approved: keep it out of the frozen
  // version (and its hash) so the snapshot holds exactly the scope/exclusions that were exported.
  const proposalConfig = {
    ...config,
    scope: config.scope ? { ...config.scope, history: [] } : config.scope,
    exclusionList: config.exclusionList ? { ...config.exclusionList, history: [] } : config.exclusionList,
  };
  return { schema: 1, estimate: { ...est, items: est.items.filter((i) => !i.isExample) }, business: biz, proposalConfig };
}

export function contentHash(snapshot: unknown): string {
  return createHash("sha256").update(stableStringify(snapshot)).digest("hex");
}
