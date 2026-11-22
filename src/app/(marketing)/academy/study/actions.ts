"use server";
import { createClient, getUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { logError } from "@/lib/http/api";

/**
 * Study progress for signed-in learners. Every action is best-effort: a failure is logged and the study session keeps
 * working locally, so learners never see an error. Anonymous learners keep progress in their own browser.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MODES = ["flashcards", "quiz", "exam"] as const;

async function db() {
  if (!isSupabaseConfigured() || !(await getUser())) return null;
  return createClient();
}

/** Records flashcard/quiz answers for "review missed" and mastery (Leitner boxes). At most 100 per call. */
export async function recordAnswers(pairs: { itemId: string; correct: boolean }[]): Promise<boolean> {
  const list = (Array.isArray(pairs) ? pairs : []).filter((p) => p && typeof p.itemId === "string" && UUID.test(p.itemId)).slice(0, 100);
  if (!list.length) return false;
  const c = await db();
  if (!c) return false;
  for (const p of list) {
    const { error } = await c.rpc("academy_kb_answer", { p_item_id: p.itemId, p_correct: Boolean(p.correct) });
    if (error) { logError("academy.kb.study.answer", error); return false; }
  }
  return true;
}

export async function startAttempt(input: { mode: string; itemIds: string[]; filters?: Record<string, string | number | boolean | null>; exam?: string | null; timeLimit?: number | null }): Promise<string | null> {
  const mode = MODES.find((m) => m === input.mode);
  const ids = Array.isArray(input.itemIds) ? input.itemIds.filter((i) => typeof i === "string" && UUID.test(i)).slice(0, 100) : [];
  if (!mode || ids.length === 0) return null;
  const c = await db();
  if (!c) return null;
  const filters = Object.fromEntries(Object.entries(input.filters ?? {}).slice(0, 12).map(([k, v]) => [k.slice(0, 40), typeof v === "string" ? v.slice(0, 80) : v]));
  const limit = input.timeLimit && Number.isFinite(input.timeLimit) ? Math.max(60, Math.min(Math.floor(input.timeLimit), 8 * 3600)) : null;
  const exam = typeof input.exam === "string" && /^[a-z0-9-]{3,80}$/.test(input.exam) ? input.exam : null;
  const { data, error } = await c.rpc("academy_kb_start", { p_mode: mode, p_item_ids: ids, p_filters: filters, p_exam: exam, p_time_limit: limit });
  if (error) { if (!/rate_limited/.test(error.message)) logError("academy.kb.study.start", error); return null; }
  return typeof data === "string" ? data : null;
}

export async function saveAttempt(attemptId: string, answers: Record<string, number | boolean>, position: number, finish: boolean): Promise<{ correct: number; total: number } | null> {
  if (!UUID.test(attemptId)) return null;
  const clean: Record<string, number | boolean> = {};
  for (const [k, v] of Object.entries(answers ?? {}).slice(0, 100)) if (UUID.test(k) && (typeof v === "boolean" || (Number.isInteger(v) && v >= 0 && v < 10))) clean[k] = v;
  const c = await db();
  if (!c) return null;
  const { data, error } = await c.rpc("academy_kb_save", { p_attempt: attemptId, p_answers: clean, p_position: Math.max(0, Math.floor(position) || 0), p_finish: Boolean(finish) });
  if (error) { logError("academy.kb.study.save", error); return null; }
  const d = data as { correct?: number; total?: number } | null;
  return d ? { correct: d.correct ?? 0, total: d.total ?? 0 } : null;
}
