/**
 * Study engine (flashcards, quizzes, practice exams). Pure functions shared by the page and the client: picking
 * questions, scoring and study recommendations. Everything runs on pre-written, approved items: no AI and no
 * per-question cost.
 */
export type StudyMode = "flashcards" | "quiz" | "exam";
export type Difficulty = "easy" | "medium" | "hard";

export interface StudyRow {
  id: string; key: string; kind: "flashcard" | "question"; deck: string; trades: string[]; state: string | null; difficulty: Difficulty;
  prompt: string; answer: string; options: string[] | null; correct: number | null; explanation: string | null;
  sectionId: string | null; citation: string | null; regulatory: boolean;
}
export interface DeckInfo { slug: string; title: string; about: string; state: string | null }
export interface CategoryInfo { slug: string; title: string; decks: string[]; trades: string[] }
export interface ExamInfo {
  slug: string; title: string; summary: string; state: string | null; kind: string; decks: string[]; count: number; minutes: number | null;
  bookPolicy: "open_book" | "closed_book" | "unverified"; bookPolicySource: string | null; officialUrl: string | null;
}

export interface Filters { category?: string | null; deck?: string | null; state?: string | null; trade?: string | null; difficulty?: Difficulty | null; missedOnly?: boolean }

export const QUIZ_SIZES = [5, 10, 20, 25, 50] as const;
export const MAX_SESSION = 100;
export const SECONDS_PER_QUESTION = 72;

/** Items that apply where the learner is: federal/general items always; state items only for that state. */
export function inState(row: Pick<StudyRow, "state">, state: string | null | undefined) {
  return !row.state || row.state === state;
}

export function filterItems(rows: StudyRow[], f: Filters, categories: CategoryInfo[], missed?: Set<string>): StudyRow[] {
  const cat = f.category ? categories.find((c) => c.slug === f.category) : null;
  return rows.filter((r) => {
    if (!inState(r, f.state)) return false;
    if (f.deck && r.deck !== f.deck) return false;
    if (cat) {
      if (!cat.decks.includes(r.deck)) return false;
      // Trade-scoped categories (Roofing, Decks...) keep items tagged for that trade or untagged general items.
      if (cat.trades.length && r.trades.length && !r.trades.some((t) => cat.trades.includes(t))) return false;
    }
    if (f.difficulty && r.difficulty !== f.difficulty) return false;
    if (f.missedOnly && !missed?.has(r.id)) return false;
    return true;
  });
}

/** Seeded Fisher-Yates (mulberry32) so a session can be rebuilt and tests are deterministic. */
export function shuffle<T>(xs: T[], seed: number): T[] {
  const out = [...xs];
  let a = seed >>> 0;
  const rnd = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

export const clampCount = (n: number, pool: number) => Math.max(0, Math.min(Math.floor(Number.isFinite(n) ? n : 0), pool, MAX_SESSION));

/**
 * Picks `count` multiple-choice questions, spread across decks so one topic can't crowd out the rest, and puts
 * missed/unseen items first when progress is known.
 */
export function pickQuestions(pool: StudyRow[], count: number, seed: number, missed?: Set<string>): StudyRow[] {
  const qs = pool.filter((r) => r.kind === "question");
  const n = clampCount(count, qs.length);
  const byDeck = new Map<string, StudyRow[]>();
  for (const r of shuffle(qs, seed)) {
    const list = byDeck.get(r.deck) ?? [];
    list.push(r);
    byDeck.set(r.deck, list);
  }
  for (const [k, list] of byDeck) byDeck.set(k, [...list.filter((r) => missed?.has(r.id)), ...list.filter((r) => !missed?.has(r.id))]);
  const decks = shuffle([...byDeck.keys()], seed + 1);
  const out: StudyRow[] = [];
  while (out.length < n) {
    let added = false;
    for (const d of decks) {
      const next = byDeck.get(d)!.shift();
      if (next) { out.push(next); added = true; if (out.length === n) break; }
    }
    if (!added) break;
  }
  return shuffle(out, seed + 2);
}

export type Answers = Record<string, number | boolean>;

export function isRight(row: StudyRow, a: number | boolean | undefined) {
  return row.kind === "question" ? typeof a === "number" && a === row.correct : a === true;
}

export function score(rows: StudyRow[], answers: Answers) {
  const right = rows.filter((r) => isRight(r, answers[r.id])).length;
  const answered = rows.filter((r) => answers[r.id] !== undefined).length;
  return { right, answered, total: rows.length, percent: rows.length ? Math.round((right / rows.length) * 100) : 0 };
}

/** Topics to study next: decks where the learner missed the most, worst first. */
export function recommendations(rows: StudyRow[], answers: Answers, decks: DeckInfo[]) {
  const tally = new Map<string, { missed: number; total: number }>();
  for (const r of rows) {
    const t = tally.get(r.deck) ?? { missed: 0, total: 0 };
    t.total += 1;
    if (!isRight(r, answers[r.id])) t.missed += 1;
    tally.set(r.deck, t);
  }
  return [...tally.entries()]
    .filter(([, t]) => t.missed > 0)
    .sort((a, b) => b[1].missed / b[1].total - a[1].missed / a[1].total || b[1].missed - a[1].missed)
    .map(([slug, t]) => ({ slug, title: decks.find((d) => d.slug === slug)?.title ?? slug, missed: t.missed, total: t.total }));
}

/** Pool for a practice exam: its decks, limited to the exam's state (state items only if the exam is for that state). */
export function examPool(rows: StudyRow[], exam: Pick<ExamInfo, "decks" | "state">) {
  return rows.filter((r) => r.kind === "question" && exam.decks.includes(r.deck) && (!r.state || r.state === exam.state));
}

/**
 * "Find the section" practice: turns a regulatory question into "which section would you look up?" with the cited
 * section and three other sections from the same body of rules. Returns null when there aren't enough distinct
 * citations to make honest distractors.
 */
export function sectionQuestion(row: StudyRow, all: StudyRow[], seed: number): { options: string[]; correct: number } | null {
  if (!row.regulatory || !row.citation) return null;
  const family = (c: string) => (c.startsWith("Minn. R.") ? "mn" : c.split(" CFR ")[0]);
  const others = [...new Set(all.filter((r) => r.citation && r.citation !== row.citation && family(r.citation) === family(row.citation!)).map((r) => r.citation!))];
  if (others.length < 3) return null;
  const options = shuffle([row.citation, ...shuffle(others, seed).slice(0, 3)], seed + 7);
  return { options, correct: options.indexOf(row.citation) };
}

export const formatClock = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, s) % 60).padStart(2, "0")}`;
