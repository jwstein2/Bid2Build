import "server-only";
import { cache } from "react";
import { getUser } from "@/lib/supabase/server";
import { logError } from "@/lib/http/api";
import { academyDb } from "../server";
import { CATEGORIES, DECKS } from "./seed/study";
import type { CategoryInfo, DeckInfo, ExamInfo, StudyMode, StudyRow } from "./study";

/** Study read layer. Runs as the visitor: RLS returns approved items that aren't flagged for review. */

export const studyDecks: DeckInfo[] = DECKS.map((d) => ({ slug: d.slug, title: d.title, about: d.about, state: d.state ?? null }));
export const studyCategories: CategoryInfo[] = CATEGORIES.map((c) => ({ slug: c.slug, title: c.title, decks: c.decks, trades: c.trades ?? [] }));

type ItemRow = { id: string; key: string; kind: "flashcard" | "question"; deck: string; trades: string[]; state_code: string | null; difficulty: StudyRow["difficulty"]; prompt: string; answer: string;
  options: string[] | null; correct: number | null; explanation: string | null; section_id: string | null; citation: string | null; basis: string };

export const loadStudyItems = cache(async (): Promise<StudyRow[]> => {
  const db = await academyDb();
  if (!db) return [];
  const { data, error } = await db.from("academy_kb_items")
    .select("id, key, kind, deck, trades, state_code, difficulty, prompt, answer, options, correct, explanation, section_id, citation, basis")
    .eq("status", "approved").eq("needs_review", false).order("sort_order").limit(2000);
  if (error) { logError("academy.kb.study.items", error); return []; }
  return (data as ItemRow[]).map((r) => ({ id: r.id, key: r.key, kind: r.kind, deck: r.deck, trades: r.trades ?? [], state: r.state_code, difficulty: r.difficulty, prompt: r.prompt, answer: r.answer,
    options: r.options, correct: r.correct, explanation: r.explanation, sectionId: r.section_id, citation: r.citation, regulatory: r.basis === "regulatory" }));
});

export const loadExams = cache(async (): Promise<ExamInfo[]> => {
  const db = await academyDb();
  if (!db) return [];
  const { data, error } = await db.from("academy_kb_exams")
    .select("slug, title, summary, state_code, license_kind, decks, default_count, minutes, book_policy, book_policy_source_url, official_info_url")
    .eq("status", "published").order("sort_order");
  if (error) { logError("academy.kb.study.exams", error); return []; }
  return (data as { slug: string; title: string; summary: string; state_code: string | null; license_kind: string; decks: string[]; default_count: number; minutes: number | null;
    book_policy: ExamInfo["bookPolicy"]; book_policy_source_url: string | null; official_info_url: string | null }[]).map((e) => ({
    slug: e.slug, title: e.title, summary: e.summary, state: e.state_code, kind: e.license_kind, decks: e.decks, count: e.default_count, minutes: e.minutes,
    bookPolicy: e.book_policy, bookPolicySource: e.book_policy_source_url, officialUrl: e.official_info_url }));
});

export interface LearnerState {
  signedIn: boolean;
  /** Item ids whose last answer was wrong (for "review missed"). */
  missed: string[];
  /** Item ids the learner has answered right at least twice in a row (Leitner box 3+). */
  known: string[];
  resume: { id: string; mode: StudyMode; exam: string | null; itemIds: string[]; answers: Record<string, number | boolean>; position: number; timeLimit: number | null; startedAt: string } | null;
  history: { id: string; mode: StudyMode; exam: string | null; correct: number; total: number; finishedAt: string }[];
}

export async function loadLearner(): Promise<LearnerState> {
  const empty: LearnerState = { signedIn: false, missed: [], known: [], resume: null, history: [] };
  const user = await getUser();
  const db = await academyDb();
  if (!user || !db) return empty;
  const since = new Date(Date.now() - 14 * 864e5).toISOString();
  const [prog, open, done] = await Promise.all([
    db.from("academy_kb_item_progress").select("item_id, box, last_correct").eq("user_id", user.id).limit(5000),
    db.from("academy_kb_attempts").select("id, mode, exam_slug, item_ids, answers, position, time_limit_seconds, started_at").eq("user_id", user.id).is("finished_at", null)
      .in("mode", ["flashcards", "quiz", "exam"]).gte("started_at", since).order("started_at", { ascending: false }).limit(1),
    db.from("academy_kb_attempts").select("id, mode, exam_slug, item_ids, correct, finished_at").eq("user_id", user.id).not("finished_at", "is", null)
      .in("mode", ["quiz", "exam"]).order("finished_at", { ascending: false }).limit(10),
  ]);
  if (prog.error || open.error || done.error) logError("academy.kb.study.learner", prog.error ?? open.error ?? done.error);
  const p = (prog.data ?? []) as { item_id: string; box: number; last_correct: boolean | null }[];
  const o = ((open.data ?? []) as { id: string; mode: StudyMode; exam_slug: string | null; item_ids: string[]; answers: Record<string, number | boolean> | null; position: number; time_limit_seconds: number | null; started_at: string }[])[0];
  const d = (done.data ?? []) as { id: string; mode: StudyMode; exam_slug: string | null; item_ids: string[]; correct: number; finished_at: string }[];
  return {
    signedIn: true,
    missed: p.filter((r) => r.last_correct === false).map((r) => r.item_id),
    known: p.filter((r) => r.box >= 3).map((r) => r.item_id),
    resume: o ? { id: o.id, mode: o.mode, exam: o.exam_slug, itemIds: o.item_ids, answers: o.answers ?? {}, position: o.position, timeLimit: o.time_limit_seconds, startedAt: o.started_at } : null,
    history: d.map((r) => ({ id: r.id, mode: r.mode, exam: r.exam_slug, correct: r.correct, total: r.item_ids.length, finishedAt: r.finished_at })),
  };
}
