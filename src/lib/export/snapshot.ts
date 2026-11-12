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
  return { schema: 1, estimate: { ...est, items: est.items.filter((i) => !i.isExample) }, business: biz, proposalConfig: config };
}

export function contentHash(snapshot: unknown): string {
  return createHash("sha256").update(stableStringify(snapshot)).digest("hex");
}
