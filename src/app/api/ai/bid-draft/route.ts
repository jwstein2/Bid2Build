import { z } from "zod";
import { aiSettings, isAiConfigured, AiUnavailableError } from "@/lib/ai/provider";
import { AI_DRAFT_VERSION, DRAFT_INPUT_LIMITS, draftBid } from "@/lib/ai-draft/draft";
import { LABOR_DATA, TRADE_DEFAULT_LABOR, laborWagesFor, type LaborTrade } from "@/lib/ai-draft/labor-rates";
import type { DraftResponse } from "@/lib/ai-draft/resolve";
import { getTrade } from "@/lib/trades/catalog";
import { resolveGeo } from "@/lib/market/geo";
import { createAdminClient, getUser } from "@/lib/supabase/server";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * "Draft with AI": a starting-point list of line items for one trade of a bid.
 *
 * Privacy: the browser sends only the trade, the job description the contractor typed, the project
 * ZIP/state (the AI sees the state only), and existing section names. No prices, customer details
 * or address. Nothing here stores the description or the draft; only counts, tokens and cost are
 * logged (ai_generations, kind 'bid_draft') for the daily limit, the monthly budget and admin costs.
 * The response carries local labor wages; prices are chosen in the browser by lib/ai-draft/resolve.ts
 * so the contractor's Saved Items never leave their account.
 */
const body = z.strictObject({
  estimateId: z.string().uuid().nullable().optional(),
  trade: z.string().max(60),
  description: z.string().trim().min(10).max(DRAFT_INPUT_LIMITS.description),
  location: z.strictObject({ zip: z.string().max(10).optional(), state: z.string().max(40).optional() }).optional(),
  existingSections: z.array(z.string().max(DRAFT_INPUT_LIMITS.sectionName)).max(DRAFT_INPUT_LIMITS.sections).optional(),
});

const dayCounts = new Map<string, { day: string; n: number }>();
function memoryCount(userId: string): number {
  const day = new Date().toISOString().slice(0, 10);
  const c = dayCounts.get(userId);
  if (!c || c.day !== day) { dayCounts.set(userId, { day, n: 1 }); return 1; }
  return ++c.n;
}

export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("ai-draft", 6, 60_000))) return fail(429, "rate_limited", "You're drafting very quickly. Please wait a minute and try again.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in to draft with AI.");
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "invalid", "Describe the job in at least a few words (up to 2,000 characters).");
  const { trade, description, location = {}, existingSections = [], estimateId } = parsed.data;
  if (!getTrade(trade)) return fail(400, "invalid_trade", "Pick a trade for this draft.");

  if (!isAiConfigured()) return fail(503, "ai_unavailable", "AI drafting isn't available right now. Please try again later.");
  const settings = aiSettings();
  let db: ReturnType<typeof createAdminClient> | null = null;
  try { db = createAdminClient(); } catch { db = null; }

  let today = memoryCount(user.id);
  let monthSpend = 0;
  if (db) {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
    const [{ count, error: e1 }, { data: spend, error: e2 }] = await Promise.all([
      db.from("ai_generations").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("engine", "ai").gte("created_at", since),
      db.rpc("ai_generation_spend_since", { p_since: monthStart }),
    ]);
    if (!e1 && typeof count === "number") today = Math.max(today, count + 1);
    if (!e2 && spend !== null) monthSpend = Number(spend) || 0;
  }
  if (today > settings.dailyLimitPerUser) return fail(429, "daily_limit", "You've reached today's AI limit. It resets in 24 hours.");
  if (settings.monthlyBudgetUsd > 0 && monthSpend >= settings.monthlyBudgetUsd) return fail(503, "ai_unavailable", "AI drafting is paused for the rest of the month. Please try again later.");

  const state = resolveGeo(location).state;
  let status: "ok" | "failed" = "ok";
  let usage: { model: string; inputTokens: number; outputTokens: number; costUsd: number } | undefined;
  let response: DraftResponse | null = null;
  try {
    const out = await draftBid({ trade, description, state, existingSections });
    usage = out.usage;
    const crews = new Set<LaborTrade>(out.lines.flatMap((l) => (l.laborTrade ? [l.laborTrade] : [])));
    crews.add(TRADE_DEFAULT_LABOR[trade] ?? "handyman");
    const labor = laborWagesFor(location, [...crews]);
    response = {
      trade,
      lines: out.lines,
      assumptions: out.assumptions,
      questions: out.questions,
      labor: { state: labor.state, period: LABOR_DATA.period, source: LABOR_DATA.source, wages: labor.wages },
    };
  } catch (e) {
    status = "failed";
    if (e instanceof AiUnavailableError && e.usage) usage = { ...e.usage, costUsd: 0 };
  }

  if (db) {
    const { error } = await db.from("ai_generations").insert({
      user_id: user.id,
      estimate_id: estimateId ?? null,
      kind: "bid_draft",
      trade,
      style: null,
      engine: "ai",
      status,
      model: usage?.model ?? null,
      input_tokens: usage?.inputTokens ?? 0,
      output_tokens: usage?.outputTokens ?? 0,
      cost_usd: Number((usage?.costUsd ?? 0).toFixed(6)),
    });
    // 23514: run-ai-bid-draft.sql (adds the 'bid_draft' kind) hasn't been applied yet. The draft still works.
    if (error && !["42P01", "PGRST205", "23514"].includes(error.code)) logError("ai.bid_draft.log", error, { user: user.id, generator: AI_DRAFT_VERSION });
  }

  if (!response) return fail(502, "draft_failed", "The AI couldn't draft this job. Try adding sizes or a little more detail.");
  return json(response);
}
