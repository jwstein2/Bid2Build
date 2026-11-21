import { z } from "zod";
import { AiUnavailableError } from "@/lib/ai/provider";
import { adminOrNull, logAiGeneration } from "@/lib/ai/budget";
import { BUSY_MESSAGE, QUOTA_BIDS_MESSAGE, QUOTA_MESSAGE, SAMPLE_NOTICE, beginGuarded, finishGuarded, inputHash, latestGuarded, preflightAi } from "@/lib/ai/guard";
import { sampleDraft } from "@/lib/ai-draft/sample";
import { AI_DRAFT_VERSION, DRAFT_INPUT_LIMITS, draftBid } from "@/lib/ai-draft/draft";
import { LABOR_DATA, TRADE_DEFAULT_LABOR, laborWagesFor, type LaborTrade } from "@/lib/ai-draft/labor-rates";
import type { DraftResponse } from "@/lib/ai-draft/resolve";
import { getTrade } from "@/lib/trades/catalog";
import { resolveGeo } from "@/lib/market/geo";
import { createClient, getUser } from "@/lib/supabase/server";
import { fail, json, rateLimit, sameOrigin } from "@/lib/http/api";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * "Draft with AI": a starting-point list of line items for one trade of a bid.
 *
 * Privacy: the browser sends only the trade, the job description the contractor typed, the project
 * ZIP/state (the AI sees the state only), and existing section names. No prices, customer details
 * or address. A successful draft (its lines and the description) is kept in the person's own
 * ai_generation_results row so closing the dialog can't lose it (Will meeting 2026-11-21); counts,
 * tokens and cost are logged (ai_generations, kind 'bid_draft') for limits, budgets and admin costs.
 * The response carries local labor wages; prices are chosen in the browser by lib/ai-draft/resolve.ts
 * so the contractor's Saved Items never leave their account.
 */
const body = z.strictObject({
  estimateId: z.string().uuid().nullable().optional(),
  trade: z.string().max(60),
  description: z.string().trim().min(10).max(DRAFT_INPUT_LIMITS.description),
  location: z.strictObject({ zip: z.string().max(10).optional(), state: z.string().max(40).optional() }).optional(),
  existingSections: z.array(z.string().max(DRAFT_INPUT_LIMITS.sectionName)).max(DRAFT_INPUT_LIMITS.sections).optional(),
  /** Draft again: a fresh draft for paying accounts; others get their saved draft for the same description. */
  fresh: z.boolean().optional(),
});

/** Labor wages for the crews a draft uses (public BLS data; free, computed on every response). */
function withLabor(trade: string, location: { zip?: string; state?: string }, out: { lines: DraftResponse["lines"]; assumptions: string[]; questions: string[] }): DraftResponse {
  const crews = new Set<LaborTrade>(out.lines.flatMap((l) => (l.laborTrade ? [l.laborTrade] : [])));
  crews.add(TRADE_DEFAULT_LABOR[trade] ?? "handyman");
  const labor = laborWagesFor(location, [...crews]);
  return {
    trade, lines: out.lines, assumptions: out.assumptions, questions: out.questions,
    labor: { state: labor.state, period: LABOR_DATA.period, source: LABOR_DATA.source, wages: labor.wages },
  };
}

/** What is kept per bid in ai_generation_results: the AI's lines only (prices are chosen in the browser). */
interface SavedDraft { trade: string; description?: string; lines: DraftResponse["lines"]; assumptions: string[]; questions: string[] }

/**
 * The latest saved draft for this bid (Will meeting 2026-11-21, item B): closing the dialog never loses a
 * paid draft. RLS returns only the signed-in person's own rows. 404 when there is none.
 */
export async function GET(req: Request) {
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const estimateId = new URL(req.url).searchParams.get("estimateId") ?? "";
  if (!z.string().uuid().safeParse(estimateId).success) return fail(400, "invalid", "Invalid request.");
  const hit = await latestGuarded<SavedDraft>(await createClient(), { action: "bid_draft", estimateId });
  if (!hit?.result?.lines?.length) return fail(404, "not_found", "No saved draft.");
  return json({ ...withLabor(hit.result.trade, {}, hit.result), description: hit.result.description ?? "", savedAt: hit.createdAt });
}

export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("ai-draft", 6, 60_000))) return fail(429, "rate_limited", "You're drafting very quickly. Please wait a minute and try again.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in to draft with AI.");
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "invalid", "Describe the job in at least a few words (up to 2,000 characters).");
  const { trade, description, location = {}, existingSections = [], estimateId, fresh } = parsed.data;
  if (!getTrade(trade)) return fail(400, "invalid_trade", "Pick a trade for this draft.");

  const db = adminOrNull();
  // One guard for every paid generation (lib/ai/guard.ts).
  const pre = await preflightAi(db, user);
  if (!pre.ok) {
    if (pre.reason === "sample") return json({ ...withLabor(trade, location, sampleDraft(trade)), notice: SAMPLE_NOTICE, sample: true });
    if (pre.reason === "daily_limit") return fail(429, "daily_limit", "You've reached today's AI limit. It resets in 24 hours.");
    if (pre.reason === "off") return fail(503, "ai_unavailable", "AI drafting isn't available right now. Please try again later.");
    return fail(503, "ai_unavailable", "AI drafting is paused for now to stay within this month's AI budget. Please try again later.");
  }

  const state = resolveGeo(location).state;
  const key = { userId: user.id, action: "bid_draft", estimateId: estimateId ?? null, style: trade } as const;
  const g = await beginGuarded<SavedDraft>(db, { ...key, inputHash: inputHash(AI_DRAFT_VERSION, { trade, description: description.trim(), state, existingSections }), fresh });
  if (g.decision === "cached") return json({ ...withLabor(trade, location, g.result), cached: true });
  if (g.decision === "busy") return fail(429, "ai_busy", BUSY_MESSAGE);
  if (g.decision === "quota") return fail(429, "ai_quota", QUOTA_MESSAGE);
  if (g.decision === "quota_bids") return fail(429, "ai_quota_bids", QUOTA_BIDS_MESSAGE);

  let status: "ok" | "failed" = "ok";
  let usage: { model: string; inputTokens: number; outputTokens: number; costUsd: number } | undefined;
  let response: DraftResponse | null = null;
  let saved: SavedDraft | null = null;
  try {
    const out = await draftBid({ trade, description, state, existingSections });
    usage = out.usage;
    saved = { trade, description: description.trim(), lines: out.lines, assumptions: out.assumptions, questions: out.questions };
    response = withLabor(trade, location, out);
  } catch (e) {
    status = "failed";
    if (e instanceof AiUnavailableError && e.usage) usage = { ...e.usage, costUsd: 0 };
  }
  // A failed or empty draft never uses up an allowance; a good one is kept so closing the dialog can't lose it.
  await finishGuarded(db, g.id, key, saved ? { ok: true, engine: "ai", result: saved, costUsd: usage?.costUsd ?? 0 } : { ok: false, costUsd: usage?.costUsd ?? 0 });
  await logAiGeneration(db, { userId: user.id, kind: "bid_draft", trade, estimateId: estimateId ?? null, status, usage }, { generator: AI_DRAFT_VERSION });

  if (!response) return fail(502, "draft_failed", "The AI couldn't draft this job. Try adding sizes or a little more detail.");
  return json(response);
}
