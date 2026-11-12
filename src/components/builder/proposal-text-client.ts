"use client";
import { ruleExclusions, ruleScope, RULES_EXCLUSIONS_VERSION, RULES_SCOPE_VERSION } from "@/lib/proposal/generate-rules";
import type { ExclusionItem, GenerationInput } from "@/lib/proposal/text-sections";

export interface GenerationResult {
  engine: "ai" | "rules";
  generator: string;
  scope?: string;
  items?: ExclusionItem[];
  dropped?: number;
  notice?: string;
}

export class GenerationError extends Error {}

/**
 * Ask the server to draft text. If the visitor isn't signed in, the server is unreachable, or the
 * AI service is down, draft locally with the built-in rules so the contractor is never stuck.
 */
export async function requestGeneration(input: GenerationInput, opts: { signedIn: boolean; estimateId?: string | null }): Promise<GenerationResult> {
  if (opts.signedIn) {
    try {
      const r = await fetch("/api/ai/proposal-text", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ estimateId: opts.estimateId ?? null, input }),
      });
      const data = await r.json().catch(() => null);
      if (r.ok && data) return data as GenerationResult;
      if (r.status === 422 || r.status === 429) throw new GenerationError(data?.error?.message ?? "Couldn't generate right now.");
    } catch (e) {
      if (e instanceof GenerationError) throw e;
      /* network problem: fall through to local drafting */
    }
  }
  const notice = opts.signedIn
    ? "AI writing isn't reachable right now, so this was drafted from your line items. Review and edit it before sending."
    : "Drafted from your line items. Create a free account to use AI writing.";
  return input.kind === "scope"
    ? { engine: "rules", generator: RULES_SCOPE_VERSION, scope: ruleScope(input), notice }
    : { engine: "rules", generator: RULES_EXCLUSIONS_VERSION, items: ruleExclusions(input), notice };
}
