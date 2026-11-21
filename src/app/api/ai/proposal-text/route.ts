import { z } from "zod";
import { AI_EXCLUSIONS_VERSION, AI_SCOPE_VERSION, generateExclusions, generateScope } from "@/lib/ai/proposal-text";
import { adminOrNull } from "@/lib/ai/budget";
import { BUSY_MESSAGE, QUOTA_BIDS_MESSAGE, QUOTA_MESSAGE, SAMPLE_NOTICE, beginGuarded, finishGuarded, inputHash, preflightAi } from "@/lib/ai/guard";
import { hasBidContent, INPUT_LIMITS, type ExclusionItem, type GenerationInput } from "@/lib/proposal/text-sections";
import { getUser } from "@/lib/supabase/server";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Generate a Scope of Work or Exclusions & Clarifications draft.
 *
 * Privacy: the browser sends only the cost-free GenerationInput (built by buildGenerationInput):
 * no costs, prices, markup, margin, tax or customer contact details. This strict schema rejects
 * anything else. The input is never stored (only its SHA-256 hash); counts, tokens and cost are
 * logged for limits and admin analytics. A successful AI result (the generated text only) is
 * kept in the person's own ai_generation_results row so asking again with the same input, or switching
 * back to an already-generated style, returns it without a paid call (Will meeting 2026-11-21).
 */
const s = (n: number) => z.string().max(n);
const item = z.strictObject({ name: s(INPUT_LIMITS.name), description: s(INPUT_LIMITS.description).optional(), quantity: s(24), unit: s(40), kind: s(30) });
const inputSchema = z.strictObject({
  kind: z.enum(["scope", "exclusions"]),
  style: z.enum(["simple", "professional", "detailed"]),
  trades: z.array(s(80)).max(20),
  tradeSlugs: z.array(s(60)).max(20),
  projectTitle: s(300),
  notes: s(INPUT_LIMITS.notes).optional(),
  groups: z.array(z.strictObject({ name: s(INPUT_LIMITS.name), description: s(INPUT_LIMITS.description).optional(), items: z.array(item).max(INPUT_LIMITS.itemsPerGroup) })).max(INPUT_LIMITS.groups),
  scope: s(INPUT_LIMITS.scope).optional(),
  existing: z.array(z.strictObject({ category: s(40), text: s(400) })).max(INPUT_LIMITS.existing).optional(),
});
/** `fresh`: Regenerate. Honoured for paying accounts only; everyone else gets their saved result back. */
const body = z.strictObject({ estimateId: z.string().uuid().nullable().optional(), input: inputSchema, fresh: z.boolean().optional() });

/** What is kept per bid/action/style in ai_generation_results (the person's own generated text). */
interface SavedText { generator: string; scope?: string; items?: ExclusionItem[] }

export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("ai-text", 12, 60_000))) return fail(429, "rate_limited", "You're generating very quickly. Please wait a minute and try again.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in to use AI writing.");
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "invalid", "Invalid request.");
  const { input, estimateId, fresh } = parsed.data;
  if (!hasBidContent(input as GenerationInput)) return fail(422, "empty_estimate", "Add some line items first so there's something to describe.");

  const gi = input as GenerationInput;
  const db = adminOrNull();
  // One guard for every paid generation (lib/ai/guard.ts): Practice/Demo, kill switch, limits, budgets.
  const pre = await preflightAi(db, user);
  if (!pre.ok && pre.reason === "sample") {
    // Practice / Demo: the built-in rules draft is the prebuilt sample. No provider call, nothing logged as AI.
    const outcome = gi.kind === "scope" ? await generateScope(gi, { useAi: false }) : await generateExclusions(gi, { useAi: false });
    return json({ kind: gi.kind, engine: outcome.engine, generator: outcome.generator, status: "sample", scope: outcome.scope, items: outcome.items, dropped: 0, notice: SAMPLE_NOTICE, sample: true });
  }
  const useAi = pre.ok;
  const limitNotice = !pre.ok && pre.reason === "daily_limit" ? "You've reached today's AI writing limit, so this was drafted from your line items. AI writing resets in 24 hours." : undefined;

  const version = gi.kind === "scope" ? AI_SCOPE_VERSION : AI_EXCLUSIONS_VERSION;
  const key = { userId: user.id, action: gi.kind, estimateId: estimateId ?? null, style: gi.style } as const;
  let guardId: string | null = null;
  if (useAi) {
    const g = await beginGuarded<SavedText>(db, { ...key, inputHash: inputHash(version, gi), fresh });
    if (g.decision === "cached") return json({ kind: gi.kind, engine: "ai", generator: g.result.generator, status: "ok", scope: g.result.scope, items: g.result.items, dropped: 0, cached: true });
    if (g.decision === "busy") return fail(429, "ai_busy", BUSY_MESSAGE);
    if (g.decision === "quota") return fail(429, "ai_quota", QUOTA_MESSAGE, { latest: g.latest });
    if (g.decision === "quota_bids") return fail(429, "ai_quota_bids", QUOTA_BIDS_MESSAGE);
    guardId = g.id;
  }

  const outcome = gi.kind === "scope" ? await generateScope(gi, { useAi }) : await generateExclusions(gi, { useAi });
  if (limitNotice) outcome.notice = limitNotice;
  if (useAi) {
    // Only a real AI result is kept (and counts toward a free allowance); rules fallbacks and failures don't.
    const ok = outcome.engine === "ai" && outcome.status === "ok";
    await finishGuarded(db, guardId, key, ok
      ? { ok: true, engine: "ai", result: { generator: outcome.generator, scope: outcome.scope, items: outcome.items } satisfies SavedText, costUsd: outcome.usage?.costUsd ?? 0 }
      : { ok: false, costUsd: outcome.usage?.costUsd ?? 0 });
  }

  if (db) {
    const { error } = await db.from("ai_generations").insert({
      user_id: user.id,
      estimate_id: estimateId ?? null,
      kind: gi.kind,
      trade: gi.tradeSlugs[0] ?? null,
      style: gi.style,
      engine: outcome.engine,
      status: limitNotice ? "limited" : outcome.status,
      model: outcome.usage?.model ?? null,
      input_tokens: outcome.usage?.inputTokens ?? 0,
      output_tokens: outcome.usage?.outputTokens ?? 0,
      cost_usd: Number((outcome.usage?.costUsd ?? 0).toFixed(6)),
    });
    if (error && !["42P01", "PGRST205"].includes(error.code)) logError("ai.log", error, { user: user.id });
  }

  return json({
    kind: gi.kind,
    engine: outcome.engine,
    generator: outcome.generator,
    status: outcome.status,
    scope: outcome.scope,
    items: outcome.items,
    dropped: outcome.dropped ?? 0,
    notice: outcome.notice,
  });
}
