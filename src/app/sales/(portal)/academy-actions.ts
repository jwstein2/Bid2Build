"use server";
import { z } from "zod";
import { requireSalesRep } from "@/lib/sales/server";
import { createAdminClient } from "@/lib/supabase/server";
import { gradeQuiz, topicById } from "@/lib/sales/academy";
import { scriptsEnabled, writeStarterScript, type ScriptKind } from "@/lib/sales/script";

export type QuizResult = { ok: true; score: number; total: number; passed: boolean; correct: boolean[]; explain: string[] } | { ok: false; message: string };

/** Grade a topic quiz on the server and record it (service role only, so results can't be faked). */
export async function submitQuiz(topicId: string, answers: (number | null)[]): Promise<QuizResult> {
  const topic = topicById(topicId);
  if (!topic || !Array.isArray(answers) || answers.length !== topic.quiz.length) return { ok: false, message: "That quiz wasn't found." };
  const { rep } = await requireSalesRep();
  const g = gradeQuiz(topic, answers.map((a) => (Number.isInteger(a) ? a : null)));
  const { error } = await createAdminClient().rpc("sales_academy_record", { p_rep: rep.id, p_topic: topic.id, p_score: g.score, p_total: g.total, p_passed: g.passed });
  if (error) return { ok: false, message: "Your answers were graded but couldn't be saved. Try again in a minute." };
  return { ok: true, ...g, explain: topic.quiz.map((q) => q.explain) };
}

export type ScriptResult = { ok: true; text: string; remaining: number } | { ok: false; message: string };

/** Draft a starter script for one of the rep's leads (Haiku), within the monthly AI cap. */
export async function draftScript(leadId: string, kind: ScriptKind): Promise<ScriptResult> {
  if (!z.string().uuid().safeParse(leadId).success || !["cold_call", "intro"].includes(kind)) return { ok: false, message: "That lead wasn't found." };
  if (!scriptsEnabled()) return { ok: false, message: "Script drafting is turned off right now." };
  const { rep, db } = await requireSalesRep();
  const { data, error } = await db.rpc("sales_crm_lead", { p_id: leadId }); // only leads this rep can see
  if (error || !data) return { ok: false, message: "That lead wasn't found." };
  const lead = (data as { lead: { do_not_contact?: boolean; company_name: string; contact_name: string | null; city: string | null; state: string | null; trades: string[] | null; business_started: string | null; sales_brief: string | null } }).lead;
  if (lead.do_not_contact) return { ok: false, message: "This business asked not to be contacted." };
  const reserve = await createAdminClient().rpc("sales_ai_reserve", { p_rep: rep.id, p_kind: "script", p_lead: leadId });
  if (reserve.error) return { ok: false, message: /ai_cap_reached/.test(reserve.error.message ?? "") ? "You've used this month's AI drafts. They reset on the 1st." : "Couldn't start the draft. Try again." };
  const text = await writeStarterScript(lead, rep.full_name.split(" ")[0] || "your rep", kind);
  if (!text) return { ok: false, message: "The draft didn't come through. Try again." };
  return { ok: true, text, remaining: Number(reserve.data ?? 0) };
}
