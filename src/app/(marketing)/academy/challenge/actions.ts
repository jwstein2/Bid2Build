"use server";
import { revalidatePath } from "next/cache";
import { createClient, getUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { logError } from "@/lib/http/api";
import { challengeError, type ChallengeAttempt, type ChallengeResult } from "@/lib/academy/rewards";
import { deliverMyReward } from "@/lib/academy/rewards-server";

/**
 * Challenge quiz actions. Both run as the signed-in learner: the database picks the questions, grades the answers and
 * records eligibility. The browser never sees the answer key before submitting.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function db() {
  if (!isSupabaseConfigured()) return null;
  const user = await getUser();
  if (!user) return null;
  return { user, db: await createClient() };
}

export async function startChallengeQuiz(topic: string): Promise<{ ok: true; attempt: ChallengeAttempt } | { ok: false; error: string }> {
  if (typeof topic !== "string" || !/^[a-z0-9-]{2,60}$/.test(topic)) return { ok: false, error: challengeError("bad_topic") };
  const s = await db();
  if (!s) return { ok: false, error: challengeError("not_authenticated") };
  const { data, error } = await s.db.rpc("academy_challenge_quiz_start", { p_topic: topic });
  if (error || !data) {
    if (error && !/rate_limited|topic_too_small|bad_topic/.test(error.message)) logError("academy.challenge.start", error);
    return { ok: false, error: challengeError(error?.message) };
  }
  return { ok: true, attempt: data as ChallengeAttempt };
}

export async function submitChallengeQuiz(attemptId: string, answers: Record<string, number>): Promise<{ ok: true; result: ChallengeResult } | { ok: false; error: string }> {
  if (typeof attemptId !== "string" || !UUID.test(attemptId)) return { ok: false, error: challengeError("not_found") };
  const clean: Record<string, number> = {};
  for (const [k, v] of Object.entries(answers ?? {}).slice(0, 20)) if (UUID.test(k) && Number.isInteger(v) && v >= 0 && v < 10) clean[k] = v;
  const s = await db();
  if (!s) return { ok: false, error: challengeError("not_authenticated") };
  const { data, error } = await s.db.rpc("academy_challenge_quiz_submit", { p_attempt: attemptId, p_answers: clean });
  if (error || !data) {
    if (error && !/already_submitted|not_found/.test(error.message)) logError("academy.challenge.submit", error);
    return { ok: false, error: challengeError(error?.message) };
  }
  const result = data as ChallengeResult;
  if (result.claim?.state === "qualified" || result.claim?.state === "claimed") await deliverMyReward(s.user.id);
  revalidatePath("/academy/challenge");
  return { ok: true, result };
}
