import { z } from "zod";
import { isAiConfigured, AiUnavailableError } from "@/lib/ai/provider";
import { adminOrNull, checkAiBudget, logAiGeneration } from "@/lib/ai/budget";
import { AI_DRAFT_VERSION, DRAFT_INPUT_LIMITS, draftBid } from "@/lib/ai-draft/draft";
import { LABOR_DATA, TRADE_DEFAULT_LABOR, laborWagesFor, type LaborTrade } from "@/lib/ai-draft/labor-rates";
import type { DraftResponse } from "@/lib/ai-draft/resolve";
import { getTrade } from "@/lib/trades/catalog";
import { resolveGeo } from "@/lib/market/geo";
import { getUser } from "@/lib/supabase/server";
import { fail, json, rateLimit, sameOrigin } from "@/lib/http/api";

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
  const db = adminOrNull();
  const budget = await checkAiBudget(db, user.id);
  if (!budget.ok) return budget.reason === "daily_limit"
    ? fail(429, "daily_limit", "You've reached today's AI limit. It resets in 24 hours.")
    : fail(503, "ai_unavailable", "AI drafting is paused for the rest of the month. Please try again later.");

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

  await logAiGeneration(db, { userId: user.id, kind: "bid_draft", trade, estimateId: estimateId ?? null, status, usage }, { generator: AI_DRAFT_VERSION });

  if (!response) return fail(502, "draft_failed", "The AI couldn't draft this job. Try adding sizes or a little more detail.");
  return json(response);
}
