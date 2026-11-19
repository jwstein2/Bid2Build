import "server-only";
import { aiSettings } from "./provider";
import { createAdminClient } from "@/lib/supabase/server";
import { logError } from "@/lib/http/api";

/**
 * The per-user daily AI limit and the monthly AI budget, shared by the AI features that log to
 * public.ai_generations ("Draft with AI", "Generate My Price Library"). The limit counts every AI
 * generation of the user in the last 24 hours; the budget is the spend across all users this month.
 */
type Admin = ReturnType<typeof createAdminClient>;

const dayCounts = new Map<string, { day: string; n: number }>();
function memoryCount(userId: string): number {
  const day = new Date().toISOString().slice(0, 10);
  const c = dayCounts.get(userId);
  if (!c || c.day !== day) { dayCounts.set(userId, { day, n: 1 }); return 1; }
  return ++c.n;
}

export function adminOrNull(): Admin | null {
  try { return createAdminClient(); } catch { return null; }
}

export type BudgetCheck = { ok: true } | { ok: false; reason: "daily_limit" | "monthly_budget" };

export async function checkAiBudget(db: Admin | null, userId: string): Promise<BudgetCheck> {
  const settings = aiSettings();
  let today = memoryCount(userId);
  let monthSpend = 0;
  if (db) {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
    const [{ count, error: e1 }, { data: spend, error: e2 }] = await Promise.all([
      db.from("ai_generations").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("engine", "ai").gte("created_at", since),
      db.rpc("ai_generation_spend_since", { p_since: monthStart }),
    ]);
    if (!e1 && typeof count === "number") today = Math.max(today, count + 1);
    if (!e2 && spend !== null) monthSpend = Number(spend) || 0;
  }
  if (today > settings.dailyLimitPerUser) return { ok: false, reason: "daily_limit" };
  if (settings.monthlyBudgetUsd > 0 && monthSpend >= settings.monthlyBudgetUsd) return { ok: false, reason: "monthly_budget" };
  return { ok: true };
}

/** Logs counts, tokens and cost only (never the prompt or the output). Missing table/kind is ignored. */
export async function logAiGeneration(db: Admin | null, row: {
  userId: string; kind: string; trade?: string | null; estimateId?: string | null; status: "ok" | "failed";
  usage?: { model: string; inputTokens: number; outputTokens: number; costUsd: number };
}, context: Record<string, string | number | boolean | undefined> = {}): Promise<void> {
  if (!db) return;
  const { error } = await db.from("ai_generations").insert({
    user_id: row.userId,
    estimate_id: row.estimateId ?? null,
    kind: row.kind,
    trade: row.trade ?? null,
    style: null,
    engine: "ai",
    status: row.status,
    model: row.usage?.model ?? null,
    input_tokens: row.usage?.inputTokens ?? 0,
    output_tokens: row.usage?.outputTokens ?? 0,
    cost_usd: Number((row.usage?.costUsd ?? 0).toFixed(6)),
  });
  // 23514: the SQL that allows this kind hasn't run yet. The feature still works; it just isn't logged.
  if (error && !["42P01", "PGRST205", "23514"].includes(error.code)) logError(`ai.${row.kind}.log`, error, { user: row.userId, ...context });
}
