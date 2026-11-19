"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSalesRep } from "@/lib/sales/server";
import { answeredCount, cleanAnswers, LAYOUTS, QUESTIONS } from "@/lib/sales/preferences";

function done(q: string): never {
  revalidatePath("/sales/preferences");
  revalidatePath("/sales");
  redirect(`/sales/preferences?${q}`);
}

const LAYOUT_SET = new Set<string>(LAYOUTS.map((l) => l.v));

/** Saves the survey and display choices. "Skip" keeps any earlier answers and just records the choice. */
export async function savePreferences(fd: FormData) {
  const { db } = await requireSalesRep();
  const intent = String(fd.get("intent") ?? "save");
  const { data: current } = await db.rpc("sales_my_preferences");
  const raw: Record<string, unknown> = {};
  for (const q of QUESTIONS) raw[q.id] = q.kind === "many" ? fd.getAll(q.id) : fd.get(q.id);
  const answers = intent === "skip" ? ((current as { answers?: Record<string, unknown> } | null)?.answers ?? {}) : cleanAnswers(raw);
  const n = answeredCount(cleanAnswers(answers as Record<string, unknown>));
  const status = intent === "skip" && n === 0 ? "skipped" : n === 0 ? "not_started" : n >= QUESTIONS.length - 4 ? "complete" : "partial";
  const layout = String(fd.get("layout") ?? "");
  const { error } = await db.rpc("sales_my_preferences_save", {
    p_answers: answers, p_status: status,
    p_public_recognition: fd.get("public_recognition") === "on", p_congrats_email: fd.get("congrats_email") === "on",
    p_share_interests: fd.get("share_interests") === "on", p_dashboard_layout: LAYOUT_SET.has(layout) ? layout : null,
    p_animations: fd.get("animations") === "on",
  });
  if (error) done("err=1");
  done(intent === "skip" ? "ok=skipped" : "ok=saved");
}

export async function clearPreferences() {
  const { db } = await requireSalesRep();
  const { error } = await db.rpc("sales_my_preferences_clear");
  if (error) done("err=1");
  done("ok=cleared");
}
