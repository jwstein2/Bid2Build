import { z } from "zod";
import { generateExclusions, generateScope } from "@/lib/ai/proposal-text";
import { aiSettings, isAiConfigured } from "@/lib/ai/provider";
import { hasBidContent, INPUT_LIMITS, type GenerationInput } from "@/lib/proposal/text-sections";
import { createAdminClient, getUser } from "@/lib/supabase/server";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Generate a Scope of Work or Exclusions & Clarifications draft.
 *
 * Privacy: the browser sends only the cost-free GenerationInput (built by buildGenerationInput):
 * no costs, prices, markup, margin, tax or customer contact details. This strict schema rejects
 * anything else. Nothing here stores the input or the generated text; only counts, tokens and
 * cost are logged for limits and admin analytics.
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
const body = z.strictObject({ estimateId: z.string().uuid().nullable().optional(), input: inputSchema });

/** Per-instance backstop for the per-user daily limit when the usage table isn't reachable. */
const dayCounts = new Map<string, { day: string; n: number }>();
function memoryCount(userId: string): number {
  const day = new Date().toISOString().slice(0, 10);
  const c = dayCounts.get(userId);
  if (!c || c.day !== day) { dayCounts.set(userId, { day, n: 1 }); return 1; }
  c.n++;
  return c.n;
}

export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("ai-text", 12, 60_000))) return fail(429, "rate_limited", "You're generating very quickly. Please wait a minute and try again.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in to use AI writing.");
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "invalid", "Invalid request.");
  const { input, estimateId } = parsed.data;
  if (!hasBidContent(input as GenerationInput)) return fail(422, "empty_estimate", "Add some line items first so there's something to describe.");

  const settings = aiSettings();
  let useAi = isAiConfigured();
  let limitNotice: string | undefined;
  let db: ReturnType<typeof createAdminClient> | null = null;
  try { db = createAdminClient(); } catch { db = null; }

  if (useAi) {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
    let today = memoryCount(user.id);
    let monthSpend = 0;
    if (db) {
      const [{ count, error: e1 }, { data: spend, error: e2 }] = await Promise.all([
        db.from("ai_generations").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("engine", "ai").gte("created_at", since),
        db.rpc("ai_generation_spend_since", { p_since: monthStart }),
      ]);
      if (!e1 && typeof count === "number") today = Math.max(today, count + 1);
      if (!e2 && spend !== null) monthSpend = Number(spend) || 0;
    }
    if (today > settings.dailyLimitPerUser) {
      useAi = false;
      limitNotice = "You've reached today's AI writing limit, so this was drafted from your line items. AI writing resets in 24 hours.";
    } else if (settings.monthlyBudgetUsd > 0 && monthSpend >= settings.monthlyBudgetUsd) {
      useAi = false;
    }
  }

  const gi = input as GenerationInput;
  const outcome = gi.kind === "scope" ? await generateScope(gi, { useAi }) : await generateExclusions(gi, { useAi });
  if (limitNotice) outcome.notice = limitNotice;

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
