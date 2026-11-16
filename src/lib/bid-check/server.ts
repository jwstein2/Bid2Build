import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "../http/api";
import { requestTrialInvite } from "../trial/service";
import { buildResult } from "./result";
import { pathAnswers } from "./engine";
import type { Answers, Arrival } from "./types";

/**
 * Server side of the bid check: anonymous session rows (public.bid_check_sessions) and the 7-day pass
 * invite, which goes through the existing Facebook-trial service (same invite, same activation, same
 * one-per-email / one-per-account rules). No email address is ever written to the session row or to
 * any analytics event.
 */
export const EVENT_TYPES = ["start", "complete", "result", "deep", "sample", "free_bid"] as const;
export type SessionEvent = (typeof EVENT_TYPES)[number];

const STAMP: Record<SessionEvent, string | null> = {
  start: null, complete: "completed_at", result: "result_shown_at", deep: "deep_completed_at",
  sample: "sample_opened_at", free_bid: "free_bid_clicked_at",
};
const TEXT_KEYS: Record<string, number> = { "custom.describe": 80, feedback: 500 };

/** Strip anything that looks like contact details from free text. */
export function scrubText(s: string, max: number): string {
  return s
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[removed]")
    .replace(/(\+?\d[\d\s().-]{7,}\d)/g, "[removed]")
    .replace(/https?:\/\/\S+/gi, "[link]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Keep only well-formed answer keys/values; free text is capped and scrubbed. */
export function cleanAnswers(raw: unknown): Answers {
  const out: Answers = {};
  if (!raw || typeof raw !== "object") return out;
  let n = 0;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (n >= 40 || typeof v !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(k)) continue;
    if (k in TEXT_KEYS) { out[k] = scrubText(v, TEXT_KEYS[k]); n++; continue; }
    if (/^[a-z0-9][a-z0-9_+.-]{0,63}$/.test(v)) { out[k] = v; n++; }
  }
  // Only what's still on the path is ever stored (a switched-away trade leaves nothing behind).
  return pathAnswers(out);
}

export async function recordSessionEvent(db: SupabaseClient, o: { id: string; type: SessionEvent; answers?: Answers; arrival?: Arrival; device?: string | null }): Promise<void> {
  try {
    const answers = o.answers ? cleanAnswers(o.answers) : undefined;
    const result = answers ? buildResult(answers) : null;
    const summary = answers ? {
      answers,
      goal: answers.goal ?? null,
      trade: result?.templateSlug ?? null,
      pain: result ? result.key.split(":")[2] ?? null : null,
      result_key: result?.key ?? null,
      primary_cta: result?.primary ?? null,
    } : {};
    const { data: existing } = await db.from("bid_check_sessions").select("id").eq("id", o.id).maybeSingle();
    if (!existing) {
      const a = o.arrival;
      await db.from("bid_check_sessions").upsert({
        id: o.id, campaign: a?.campaign ?? null, source: a?.source ?? null, content: a?.content ?? null, trade_hint: a?.tradeHint ?? null,
        device: o.device ?? null, ...summary,
      }, { onConflict: "id", ignoreDuplicates: true });
    } else if (answers) {
      await db.from("bid_check_sessions").update(summary).eq("id", o.id);
    }
    const col = STAMP[o.type];
    // First time only: later repeats (refresh, back and forth) keep the original time.
    if (col) await db.from("bid_check_sessions").update({ [col]: new Date().toISOString() }).eq("id", o.id).is(col, null);
  } catch (e) {
    logError("bid_check.event", e, { type: o.type });
  }
}

export async function requestPassFromQuestionnaire(db: SupabaseClient, o: { sessionId: string | null; email: string; checkins: boolean }) {
  const r = await requestTrialInvite(db, { email: o.email, source: "questionnaire", checkins: o.checkins });
  if (o.sessionId) {
    // The row normally exists already (result shown); create it if that event never arrived.
    await db.from("bid_check_sessions").upsert({ id: o.sessionId }, { onConflict: "id", ignoreDuplicates: true });
    const { error } = await db.from("bid_check_sessions").update({ invite_id: r.inviteId }).eq("id", o.sessionId);
    if (!error) await db.from("bid_check_sessions").update({ invite_requested_at: new Date().toISOString() }).eq("id", o.sessionId).is("invite_requested_at", null);
  }
  return r;
}
