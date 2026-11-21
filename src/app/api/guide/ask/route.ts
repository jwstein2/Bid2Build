import { z } from "zod/v4";
import { createAdminClient, getUser } from "@/lib/supabase/server";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";
import { AiUnavailableError, generateStructured } from "@/lib/ai/provider";
import { preflightAi } from "@/lib/ai/guard";
import { GUIDE_AI_CACHE_MS, GUIDE_AI_DAILY_LIMIT, GUIDE_AI_MAX_QUESTION, GUIDE_AI_SYSTEM, isGuideAiEnabled } from "@/lib/guide/ai";
import { helpIndex, searchHelp, terms } from "@/lib/guide/help";
import { GUEST_CONTEXT, isPageKey, type GuideContext } from "@/lib/features/page-guides";

export const runtime = "nodejs";
export const maxDuration = 20;

const Body = z.object({
  question: z.string().trim().min(3).max(GUIDE_AI_MAX_QUESTION),
  page: z.string().max(64).optional(),
  ctx: z.object({
    unlimited: z.boolean(), admin: z.boolean(), pm: z.object({ view: z.boolean(), edit: z.boolean() }),
    company: z.object({ role: z.string().max(40), owner: z.boolean(), permissions: z.array(z.string().max(40)).max(40) }).nullable(),
  }).optional(),
});
const Answer = z.object({ answer: z.string().max(700) });

// Small per-instance cache: identical questions with the same plan/role don't pay twice.
const cache = new Map<string, { at: number; answer: string; sources: string[] }>();

/**
 * Ask Built2Bid (optional, Haiku by default). The plan/role context only narrows which help notes are
 * used (it can't unlock anything: the notes are public product copy). Demo and practice logins get the
 * matching help notes without a paid answer; usage is logged in ai_generations with kind 'guide_help'.
 */
export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!isGuideAiEnabled()) return fail(503, "ai_off", "Ask Built2Bid isn't turned on. Search help instead.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Ask a short question (up to 300 characters).");
  if (!(await rateLimit(`guide-ask:${user.id}`, 5, 60_000))) return fail(429, "rate_limited", "Please wait a minute and try again.");
  const ctx: GuideContext = p.data.ctx ? { ...GUEST_CONTEXT, ...p.data.ctx, signedIn: true } : { ...GUEST_CONTEXT, signedIn: true };
  const ws = user.demo ? (user.demo.kind === "practice" ? "practice" : "demo") : "real";
  const page = p.data.page && isPageKey(p.data.page) ? p.data.page : null;
  const notes = searchHelp(helpIndex(ctx, ws), p.data.question, 6, page);
  const sources = notes.map((n) => n.id);
  if (!notes.length) return json({ answer: null, sources: [], fallback: true });

  const key = `${terms(p.data.question).sort().join(" ")}|${sources.join(",")}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < GUIDE_AI_CACHE_MS) return json({ answer: hit.answer, sources: hit.sources, cached: true });

  const db = createAdminClient();
  // One guard for every paid generation (lib/ai/guard.ts). Practice/Demo sessions get the matching help
  // notes without a paid answer, same as when the daily limit or a budget is reached.
  const pre = await preflightAi(db, user, { dailyLimit: GUIDE_AI_DAILY_LIMIT, countKind: "guide_help" });
  if (!pre.ok) return json({ answer: null, sources, fallback: true, reason: pre.reason === "daily_limit" ? "daily_limit" : pre.reason === "sample" ? "practice" : "budget" });

  await db.from("guide_events").insert({ user_id: user.id, event: "ai_asked", page, workspace: ws }).then(() => {}, () => {});
  const helpNotes = notes.map((n, i) => `${i + 1}. [${n.source}] ${n.title}: ${n.body}`).join("\n");
  let status: "ok" | "failed" = "ok";
  let usage: { model: string; inputTokens: number; outputTokens: number; costUsd: number } | null = null;
  let answer: string | null = null;
  try {
    const r = await generateStructured({ system: GUIDE_AI_SYSTEM, user: `HELP NOTES:\n${helpNotes}\n\nQUESTION: ${p.data.question}`, schema: Answer, maxTokens: 400 });
    usage = r; answer = r.data.answer.trim();
  } catch (e) {
    status = "failed";
    if (e instanceof AiUnavailableError && e.usage) usage = { ...e.usage, costUsd: 0 };
  }
  const { error } = await db.from("ai_generations").insert({
    user_id: user.id, kind: "guide_help", engine: "ai", status, model: usage?.model ?? null,
    input_tokens: usage?.inputTokens ?? 0, output_tokens: usage?.outputTokens ?? 0, cost_usd: Number((usage?.costUsd ?? 0).toFixed(6)),
  });
  if (error && !["42P01", "PGRST205", "23514"].includes(error.code)) logError("guide.ask.log", error);
  if (!answer) return json({ answer: null, sources, fallback: true });
  if (cache.size > 500) cache.clear();
  cache.set(key, { at: Date.now(), answer, sources });
  return json({ answer, sources });
}
