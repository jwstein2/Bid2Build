import "server-only";
import { createHash } from "node:crypto";
import { aiSettings, isAiConfigured } from "./provider";
import { logError } from "@/lib/http/api";
import type { createAdminClient } from "@/lib/supabase/server";

/**
 * The one server-side guard every paid AI generation goes through (Will meeting 2026-11-21, items C2/J).
 *
 *   preflightAi()   kill switch, Practice/Demo sessions (never a paid call: callers return a prebuilt
 *                   sample), per-user daily limit, company-wide daily and monthly spend ceilings.
 *   beginGuarded()  per bid/action/style: saved-result reuse (no paid call, no allowance used),
 *                   double-click/parallel-tab lock, and the optional free-account allowance.
 *   finishGuarded() stores a successful AI result; failures are marked failed and never use an allowance.
 *
 * The UI hiding a button is never the control: these run on the server before any provider call.
 * Everything degrades safely: if the SQL (20270219002000) hasn't run yet, beginGuarded answers "go"
 * without a lock and the older daily/monthly limits still apply.
 */
type Admin = ReturnType<typeof createAdminClient>;

export type GuardAction = "scope" | "exclusions" | "bid_draft" | "library" | "guide_help" | "photo_labels";
/** Actions whose results are kept per bid (resume, reuse and the free allowance). */
export type PerBidAction = "scope" | "exclusions" | "bid_draft";

export interface GuardSettings {
  /** AI_FREE_QUOTA=on: free accounts get one successful AI result per action and style per bid. Off by default. */
  freeQuota: boolean;
  /** Free accounts: AI on at most this many different bids per calendar month (only with freeQuota). */
  freeBidsPerMonth: number;
  /** Company-wide spend ceiling per UTC day (USD). 0 = no daily ceiling. */
  dailyBudgetUsd: number;
}

export function guardSettings(): GuardSettings {
  const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
  return {
    freeQuota: process.env.AI_FREE_QUOTA === "on",
    freeBidsPerMonth: Math.floor(num(process.env.AI_FREE_BIDS_PER_MONTH, 4)),
    dailyBudgetUsd: num(process.env.AI_DAILY_BUDGET_USD, 5),
  };
}

export const SAMPLE_NOTICE = "Simulation — no real transaction. Practice Mode shows a prebuilt sample here, so no AI is used and nothing is charged. Create or switch to your own account to generate for a real job.";
export const QUOTA_MESSAGE = "You've used the free AI generation for this section. You can edit your existing result, or upgrade for additional generations.";
export const QUOTA_BIDS_MESSAGE = "You've used free AI writing on this month's free bids. You can still write or edit by hand, or upgrade for unlimited AI generations.";
export const BUSY_MESSAGE = "Already generating this one. It will appear in a moment.";

export type Preflight =
  | { ok: true }
  | { ok: false; reason: "off" | "sample" | "daily_limit" | "monthly_budget" | "daily_budget" };

interface PreflightUser { id: string; demo?: unknown }

const memDay = new Map<string, { day: string; n: number }>();
function memoryCount(userId: string): number {
  const day = new Date().toISOString().slice(0, 10);
  const c = memDay.get(userId);
  if (!c || c.day !== day) { memDay.set(userId, { day, n: 1 }); return 1; }
  return ++c.n;
}

let alertedMonth = "";
/** One error-level log (Sentry alert) per instance per month once spend passes 80% of the ceiling. */
function budgetAlert(spend: number, budget: number) {
  const month = new Date().toISOString().slice(0, 7);
  if (budget > 0 && spend >= budget * 0.8 && alertedMonth !== month) {
    alertedMonth = month;
    logError("ai.budget.80pct", new Error(`AI spend $${spend.toFixed(2)} of $${budget.toFixed(2)} monthly ceiling`));
  }
}

/**
 * Checks that run before ANY paid call. `countKinds` narrows the per-user daily count (Ask Built2Bid has
 * its own smaller cap); by default every AI generation of the user in 24 h counts, failed ones included,
 * so forcing chargeable failures can't be repeated without limit.
 */
export async function preflightAi(db: Admin | null, user: PreflightUser, opts: { dailyLimit?: number; countKind?: string } = {}): Promise<Preflight> {
  if (user.demo) return { ok: false, reason: "sample" };
  if (!isAiConfigured()) return { ok: false, reason: "off" };
  const s = aiSettings();
  const g = guardSettings();
  let today = memoryCount(`${opts.countKind ?? "all"}:${user.id}`);
  let monthSpend = 0;
  let daySpend = 0;
  if (db) {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
    let q = db.from("ai_generations").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("engine", "ai").gte("created_at", since);
    if (opts.countKind) q = q.eq("kind", opts.countKind);
    const [{ count, error: e1 }, { data: m, error: e2 }, { data: d, error: e3 }] = await Promise.all([
      q,
      db.rpc("ai_generation_spend_since", { p_since: monthStart }),
      g.dailyBudgetUsd > 0 ? db.rpc("ai_generation_spend_since", { p_since: dayStart }) : Promise.resolve({ data: 0, error: null }),
    ]);
    if (!e1 && typeof count === "number") today = Math.max(today, count + 1);
    if (!e2 && m !== null) monthSpend = Number(m) || 0;
    if (!e3 && d !== null) daySpend = Number(d) || 0;
  }
  budgetAlert(monthSpend, s.monthlyBudgetUsd);
  if (today > (opts.dailyLimit ?? s.dailyLimitPerUser)) return { ok: false, reason: "daily_limit" };
  if (s.monthlyBudgetUsd > 0 && monthSpend >= s.monthlyBudgetUsd) return { ok: false, reason: "monthly_budget" };
  if (g.dailyBudgetUsd > 0 && daySpend >= g.dailyBudgetUsd) return { ok: false, reason: "daily_budget" };
  return { ok: true };
}

/** Stable SHA-256 of a generation's input (only the hash is stored, never the prompt). */
export function inputHash(version: string, input: unknown): string {
  return createHash("sha256").update(JSON.stringify({ v: version, input })).digest("hex");
}

export type GuardDecision<R = unknown> =
  | { decision: "go"; id: string | null; paid: boolean | null }
  | { decision: "cached"; id: string; result: R }
  | { decision: "busy" }
  | { decision: "quota"; latest: R | null }
  | { decision: "quota_bids" };

const MISSING = ["42883", "PGRST202", "42P01", "PGRST205"];

/** Per-instance lock used only while the SQL isn't applied (or the database is unreachable). */
const memLocks = new Map<string, number>();

export async function beginGuarded<R = unknown>(db: Admin | null, k: {
  userId: string; action: PerBidAction; estimateId: string | null; style?: string; inputHash: string; fresh?: boolean;
}): Promise<GuardDecision<R>> {
  const g = guardSettings();
  const lockKey = `${k.userId}|${k.action}|${k.estimateId ?? "-"}|${k.style ?? ""}`;
  const memFallback = (): GuardDecision<R> => {
    const at = memLocks.get(lockKey);
    if (at && Date.now() - at < 90_000) return { decision: "busy" };
    memLocks.set(lockKey, Date.now());
    if (memLocks.size > 5000) memLocks.clear();
    return { decision: "go", id: null, paid: null };
  };
  if (!db) return memFallback();
  const { data, error } = await db.rpc("ai_guard_begin", {
    p_user: k.userId, p_action: k.action, p_estimate: k.estimateId, p_style: k.style ?? "", p_input_hash: k.inputHash,
    p_enforce_free: g.freeQuota, p_free_bids_per_month: g.freeBidsPerMonth, p_fresh: Boolean(k.fresh),
  });
  if (error) {
    if (!MISSING.includes(error.code)) logError("ai.guard.begin", error, { user: k.userId, action: k.action });
    return memFallback();
  }
  const d = (data ?? {}) as Record<string, unknown>;
  switch (d.decision) {
    case "cached": return { decision: "cached", id: String(d.id), result: d.result as R };
    case "busy": return { decision: "busy" };
    case "quota": return { decision: "quota", latest: ((d.latest as { result?: R } | null)?.result ?? null) as R | null };
    case "quota_bids": return { decision: "quota_bids" };
    default: return { decision: "go", id: typeof d.id === "string" ? d.id : null, paid: typeof d.paid === "boolean" ? d.paid : null };
  }
}

export async function finishGuarded(db: Admin | null, id: string | null, k: { userId: string; action: PerBidAction; estimateId: string | null; style?: string }, out:
  { ok: true; engine: "ai"; result: unknown; costUsd: number } | { ok: false; costUsd?: number }): Promise<void> {
  memLocks.delete(`${k.userId}|${k.action}|${k.estimateId ?? "-"}|${k.style ?? ""}`);
  if (!db || !id) return;
  const { error } = await db.rpc("ai_guard_finish", {
    p_id: id, p_status: out.ok ? "ok" : "failed", p_engine: out.ok ? out.engine : null,
    p_result: out.ok ? out.result : null, p_cost: Number((out.costUsd ?? 0).toFixed(6)),
  });
  if (error && !MISSING.includes(error.code)) logError("ai.guard.finish", error, { user: k.userId, action: k.action });
}

/** Latest successful AI result the signed-in person has for this bid/action (RLS: own rows only). */
export async function latestGuarded<R = unknown>(supabase: { from: Admin["from"] }, k: { action: PerBidAction; estimateId: string }): Promise<{ result: R; createdAt: string } | null> {
  const { data, error } = await supabase.from("ai_generation_results").select("result, created_at")
    .eq("action", k.action).eq("estimate_id", k.estimateId).eq("status", "ok").not("result", "is", null)
    .order("created_at", { ascending: false }).limit(1);
  if (error || !data?.length) return null;
  return { result: data[0].result as R, createdAt: String(data[0].created_at) };
}
