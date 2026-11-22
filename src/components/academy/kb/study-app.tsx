"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { BookOpen, Check, Clock, Layers, ListChecks, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  type Answers, type CategoryInfo, type DeckInfo, type Difficulty, type ExamInfo, type StudyMode, type StudyRow,
  QUIZ_SIZES, SECONDS_PER_QUESTION, clampCount, examPool, filterItems, formatClock, isRight, pickQuestions, recommendations, score, sectionQuestion, shuffle,
} from "@/lib/academy/kb/study";
import type { LearnerState } from "@/lib/academy/kb/study-server";
import { recordAnswers, saveAttempt, startAttempt } from "@/app/(marketing)/academy/study/actions";

type ExamStyle = "study" | "timed" | "open_book" | "find_section";
interface Session {
  mode: StudyMode; ids: string[]; answers: Answers; position: number; attemptId: string | null; deadline: number | null;
  feedback: boolean; exam: string | null; style: ExamStyle | null; derived: Record<string, { options: string[]; correct: number }> | null; label: string; done: boolean;
  /** Item ids already sent to progress tracking. */
  recorded: string[];
}
interface HistoryRow { mode: StudyMode; exam: string | null; label: string; correct: number; total: number; finishedAt: string }

const SESSION_KEY = "b2b_study_session_v1";
const MISSED_KEY = "b2b_study_missed_v1";
const HISTORY_KEY = "b2b_study_history_v1";
const LOCAL_EVENT = "b2b-study-local";

// ---- browser storage (best effort; private windows may refuse) ---------------------------------------------------
const readLocal = (k: string): string | null => { try { return window.localStorage.getItem(k); } catch { return null; } };
const writeLocal = (k: string, v: string | null) => {
  try { if (v === null) window.localStorage.removeItem(k); else window.localStorage.setItem(k, v); } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(LOCAL_EVENT));
};
const subscribe = (cb: () => void) => { window.addEventListener("storage", cb); window.addEventListener(LOCAL_EVENT, cb); return () => { window.removeEventListener("storage", cb); window.removeEventListener(LOCAL_EVENT, cb); }; };
function useLocal(key: string) { return useSyncExternalStore(subscribe, () => readLocal(key), () => null); }
function parse<T>(raw: string | null, fallback: T): T { if (!raw) return fallback; try { return JSON.parse(raw) as T; } catch { return fallback; } }

const btn = "inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-semibold";
const primary = `${btn} bg-navy text-white hover:opacity-95 disabled:opacity-50`;
const ghost = `${btn} border border-line-strong bg-surface hover:border-navy`;
const input = "mt-1 w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm";

interface Props {
  items: StudyRow[]; decks: DeckInfo[]; categories: CategoryInfo[]; exams: ExamInfo[]; learner: LearnerState;
  state: string | null; stateLabel: string | null; trade: string | null; codesQuery: string; initialMode: StudyMode; initialExam: string | null;
}

export function StudyApp({ items, decks, categories, exams, learner, state, stateLabel, trade, codesQuery, initialMode, initialExam }: Props) {
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const [mode, setMode] = useState<StudyMode>(initialMode);
  const [session, setSession] = useState<Session | null>(null);

  const localSessionRaw = useLocal(SESSION_KEY);
  const localMissedRaw = useLocal(MISSED_KEY);
  const localHistoryRaw = useLocal(HISTORY_KEY);
  const localSession = useMemo(() => parse<Session | null>(localSessionRaw, null), [localSessionRaw]);
  const localMissed = useMemo(() => parse<Record<string, boolean>>(localMissedRaw, {}), [localMissedRaw]);
  const missed = useMemo(() => new Set([...learner.missed, ...Object.entries(localMissed).filter(([, v]) => v).map(([k]) => k)].filter((id) => byId.has(id))), [learner.missed, localMissed, byId]);
  const history = useMemo<HistoryRow[]>(() => {
    const local = parse<HistoryRow[]>(localHistoryRaw, []);
    const server = learner.history.map((h) => ({ mode: h.mode, exam: h.exam, label: h.exam ? (exams.find((e) => e.slug === h.exam)?.title ?? "Practice exam") : "Quiz", correct: h.correct, total: h.total, finishedAt: h.finishedAt }));
    const seen = new Set(server.map((h) => h.finishedAt.slice(0, 16)));
    return [...server, ...local.filter((h) => !seen.has(h.finishedAt.slice(0, 16)))].sort((a, b) => b.finishedAt.localeCompare(a.finishedAt)).slice(0, 10);
  }, [localHistoryRaw, learner.history, exams]);

  // Persist the running session so a refresh or a closed tab can resume it.
  useEffect(() => {
    if (session && !session.done) writeLocal(SESSION_KEY, JSON.stringify(session));
  }, [session]);

  const resumable = useMemo<Session | null>(() => {
    if (session) return null;
    if (localSession && !localSession.done && localSession.ids.every((id) => byId.has(id))) return localSession;
    const r = learner.resume;
    if (r && r.itemIds.every((id) => byId.has(id))) {
      const exam = r.exam ? exams.find((e) => e.slug === r.exam) : null;
      return { mode: r.mode, ids: r.itemIds, answers: r.answers, position: r.position, attemptId: r.id, deadline: r.timeLimit ? new Date(r.startedAt).getTime() + r.timeLimit * 1000 : null,
        feedback: r.mode !== "exam", exam: r.exam, style: r.mode === "exam" ? (r.timeLimit ? "timed" : "study") : null, derived: null, label: exam?.title ?? (r.mode === "quiz" ? "Quiz" : "Flashcards"), done: false, recorded: Object.keys(r.answers) };
    }
    return null;
  }, [session, localSession, learner.resume, byId, exams]);

  const begin = useCallback(async (s: Omit<Session, "attemptId" | "position" | "answers" | "done" | "recorded">, filters: Record<string, string | number | boolean | null>) => {
    const fresh: Session = { ...s, attemptId: null, position: 0, answers: {}, done: false, recorded: [] };
    setSession(fresh);
    setMode(s.mode);
    if (learner.signedIn && s.style !== "find_section") {
      const id = await startAttempt({ mode: s.mode, itemIds: s.ids, filters, exam: s.exam, timeLimit: s.deadline ? Math.round((s.deadline - Date.now()) / 1000) : null });
      if (id) setSession((cur) => (cur && cur.ids === fresh.ids ? { ...cur, attemptId: id } : cur));
    }
  }, [learner.signedIn]);

  const track = useCallback((pairs: { id: string; right: boolean }[]) => {
    if (!pairs.length) return;
    if (learner.signedIn) void recordAnswers(pairs.map((p) => ({ itemId: p.id, correct: p.right })));
    const next = { ...parse<Record<string, boolean>>(readLocal(MISSED_KEY), {}) };
    for (const p of pairs) { if (p.right) delete next[p.id]; else next[p.id] = true; }
    const keys = Object.keys(next);
    writeLocal(MISSED_KEY, JSON.stringify(keys.length > 1000 ? Object.fromEntries(keys.slice(-1000).map((k) => [k, true])) : next));
  }, [learner.signedIn]);

  const finish = useCallback((s: Session) => {
    const rows = s.ids.map((id) => byId.get(id)!).filter(Boolean);
    const sc = s.derived ? { right: rows.filter((r) => s.answers[r.id] === s.derived![r.id]?.correct).length, total: rows.length } : { right: score(rows, s.answers).right, total: rows.length };
    if (!s.derived) track(rows.filter((r) => s.answers[r.id] !== undefined && !s.recorded.includes(r.id)).map((r) => ({ id: r.id, right: isRight(r, s.answers[r.id]) })));
    if (s.attemptId) void saveAttempt(s.attemptId, s.answers, s.ids.length, true);
    if (s.mode !== "flashcards") {
      const row: HistoryRow = { mode: s.mode, exam: s.exam, label: s.label, correct: sc.right, total: sc.total, finishedAt: new Date().toISOString() };
      if (!learner.signedIn || s.derived) writeLocal(HISTORY_KEY, JSON.stringify([row, ...parse<HistoryRow[]>(readLocal(HISTORY_KEY), [])].slice(0, 20)));
    }
    writeLocal(SESSION_KEY, null);
    setSession({ ...s, done: true, recorded: s.ids });
  }, [byId, track, learner.signedIn]);

  const answer = useCallback((s: Session, id: string, value: number | boolean) => {
    const answers = { ...s.answers, [id]: value };
    let recorded = s.recorded;
    if (s.feedback && !s.derived) {
      const row = byId.get(id);
      if (row && !recorded.includes(id)) { track([{ id, right: isRight(row, value) }]); recorded = [...recorded, id]; }
    }
    const next = { ...s, answers, recorded };
    setSession(next);
    if (s.attemptId && s.feedback) void saveAttempt(s.attemptId, answers, s.position, false);
    return next;
  }, [byId, track]);

  const move = useCallback((s: Session, position: number) => {
    const next = { ...s, position: Math.max(0, Math.min(position, s.ids.length - 1)) };
    setSession(next);
    if (s.attemptId && !s.feedback && position % 5 === 0) void saveAttempt(s.attemptId, s.answers, next.position, false);
  }, []);

  const quit = () => { if (session && !session.done && session.attemptId) void saveAttempt(session.attemptId, session.answers, session.position, false); setSession(null); };
  const discard = () => { writeLocal(SESSION_KEY, null); setSession(null); };

  return (
    <div className="mt-6" data-testid="study-app">
      {!session && (
        <div role="tablist" aria-label="Study mode" className="flex gap-1 overflow-x-auto rounded-full border border-line bg-surface p-1">
          {([["flashcards", "Flashcards", Layers], ["quiz", "Quiz", ListChecks], ["exam", "Practice exam", BookOpen]] as const).map(([m, label, Icon]) => (
            <button key={m} role="tab" type="button" aria-selected={mode === m} onClick={() => setMode(m)}
              className={cn("flex min-h-11 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 text-sm font-semibold", mode === m ? "bg-navy text-white" : "text-ink-soft hover:text-navy")}>
              <Icon className="h-4 w-4" aria-hidden />{label}
            </button>
          ))}
        </div>
      )}

      {resumable && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand/40 bg-brand-tint p-4" data-testid="study-resume">
          <p className="text-sm"><span className="font-semibold">Pick up where you left off:</span> {resumable.label}, {Object.keys(resumable.answers).length} of {resumable.ids.length} answered.</p>
          <div className="flex gap-2">
            <button type="button" className={primary} onClick={() => { setMode(resumable.mode); setSession(resumable); }}>Resume</button>
            <button type="button" className={ghost} onClick={discard}>Start over</button>
          </div>
        </div>
      )}

      {!session && mode === "flashcards" && (
        <FlashcardSetup items={items} decks={decks} categories={categories} state={state} trade={trade} missed={missed} known={new Set(learner.known)}
          onStart={(ids, label, f) => begin({ mode: "flashcards", ids, deadline: null, feedback: true, exam: null, style: null, derived: null, label }, f)} />
      )}
      {!session && mode === "quiz" && (
        <QuizSetup items={items} categories={categories} state={state} stateLabel={stateLabel} trade={trade} missed={missed}
          onStart={(ids, label, minutes, f) => begin({ mode: "quiz", ids, deadline: minutes ? Date.now() + minutes * 60_000 : null, feedback: true, exam: null, style: null, derived: null, label }, f)} />
      )}
      {!session && mode === "exam" && (
        <ExamSetup items={items} exams={exams} state={state} initialExam={initialExam}
          onStart={(exam, style, ids) => {
            const derived = style === "find_section" ? Object.fromEntries(ids.map((id, i) => [id, sectionQuestion(byId.get(id)!, items, i + 11)!])) : null;
            void begin({ mode: "exam", ids, deadline: style === "timed" && exam.minutes ? Date.now() + Math.round((exam.minutes * ids.length) / exam.count) * 60_000 : null,
              feedback: style === "study" || style === "find_section", exam: exam.slug, style, derived, label: style === "find_section" ? `${exam.title}: find the section` : exam.title }, { exam: exam.slug, style });
          }} />
      )}

      {session && !session.done && session.mode === "flashcards" && <FlashcardRun s={session} byId={byId} onAnswer={answer} onMove={move} onFinish={finish} onQuit={quit} />}
      {session && !session.done && session.mode !== "flashcards" && <QuestionRun s={session} byId={byId} codesQuery={codesQuery} onAnswer={answer} onMove={move} onFinish={finish} onQuit={quit} />}
      {session?.done && (
        <Results s={session} byId={byId} decks={decks} signedIn={learner.signedIn}
          onClose={() => setSession(null)}
          onRetry={(ids) => void begin({ ...session, ids: shuffle(ids, Date.now() % 100000), deadline: null, feedback: true, style: session.style === "find_section" ? "find_section" : session.style ? "study" : null,
            derived: session.derived ? Object.fromEntries(ids.map((id) => [id, session.derived![id]])) : null, label: `${session.label}: missed questions` }, { retry: true })}
          onDeck={(deck) => { const ids = shuffle(items.filter((i) => i.deck === deck && (!i.state || i.state === state)).map((i) => i.id), Date.now() % 100000).slice(0, 30);
            if (ids.length) void begin({ mode: "flashcards", ids, deadline: null, feedback: true, exam: null, style: null, derived: null, label: `Flashcards: ${decks.find((d) => d.slug === deck)?.title ?? deck}` }, { deck }); }} />
      )}

      {!session && history.length > 0 && (
        <section className="mt-8" data-testid="study-history">
          <h2 className="text-sm font-bold tracking-wide text-muted uppercase">Your recent scores</h2>
          <ul className="mt-2 divide-y divide-line rounded-xl border border-line bg-surface">
            {history.map((h) => (
              <li key={`${h.finishedAt}-${h.label}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0 truncate">{h.label}</span>
                <span className="shrink-0 tabular-nums text-ink-soft">{h.correct}/{h.total} · {new Date(h.finishedAt).toLocaleDateString()}</span>
              </li>
            ))}
          </ul>
          {!learner.signedIn && <p className="mt-2 text-xs text-muted">Saved in this browser only. <Link href="/login?next=/academy/study" className="text-brand hover:underline">Sign in</Link> to keep your progress on every device.</p>}
        </section>
      )}
    </div>
  );
}

// ---- Flashcards -----------------------------------------------------------------------------------------------------
function FlashcardSetup({ items, decks, categories, state, trade, missed, known, onStart }: {
  items: StudyRow[]; decks: DeckInfo[]; categories: CategoryInfo[]; state: string | null; trade: string | null; missed: Set<string>; known: Set<string>;
  onStart: (ids: string[], label: string, filters: Record<string, string | number | boolean | null>) => void;
}) {
  const [deck, setDeck] = useState("");
  const [difficulty, setDifficulty] = useState<"" | Difficulty>("");
  const [qty, setQty] = useState(20);
  const [which, setWhich] = useState<"all" | "missed" | "new">("all");
  const tradeDecks = useMemo(() => new Set(trade ? decks.filter((d) => items.some((i) => i.deck === d.slug && i.trades.includes(trade))).map((d) => d.slug) : []), [decks, items, trade]);
  const visibleDecks = decks.filter((d) => !d.state || d.state === state);
  const pool = useMemo(() => filterItems(items, { deck: deck || null, state, difficulty: difficulty || null }, categories)
    .filter((i) => (which === "missed" ? missed.has(i.id) : which === "new" ? !known.has(i.id) : true)), [items, deck, state, difficulty, categories, which, missed, known]);
  const n = clampCount(qty, pool.length);
  return (
    <section className="mt-4 rounded-xl border border-line bg-surface p-4 sm:p-5" aria-labelledby="fc-h">
      <h2 id="fc-h" className="text-lg font-bold">Flashcards</h2>
      <p className="text-sm text-ink-soft">Flip a card, then mark whether you knew it. Cards you miss come back first next time.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs font-semibold text-muted">Topic
          <select className={input} value={deck} onChange={(e) => setDeck(e.target.value)} data-testid="fc-deck">
            <option value="">All topics</option>
            {visibleDecks.map((d) => <option key={d.slug} value={d.slug}>{d.title}{tradeDecks.has(d.slug) ? " ★" : ""}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-muted">Difficulty
          <select className={input} value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty | "")}>
            <option value="">Any</option><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option>
          </select>
        </label>
        <label className="text-xs font-semibold text-muted">How many
          <select className={input} value={qty} onChange={(e) => setQty(Number(e.target.value))}>
            {[10, 20, 30, 50, 100].map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-muted">Cards
          <select className={input} value={which} onChange={(e) => setWhich(e.target.value as typeof which)}>
            <option value="all">All cards</option>
            <option value="missed">Review missed ({missed.size})</option>
            <option value="new">Not mastered yet</option>
          </select>
        </label>
      </div>
      {trade && tradeDecks.size > 0 && <p className="mt-2 text-xs text-muted">★ has cards for your trade.</p>}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" className={primary} disabled={n === 0} data-testid="fc-start"
          onClick={() => {
            const ordered = [...shuffle(pool.filter((i) => missed.has(i.id)), Date.now() % 9973), ...shuffle(pool.filter((i) => !missed.has(i.id)), Date.now() % 7919)];
            onStart(ordered.slice(0, n).map((i) => i.id), deck ? `Flashcards: ${decks.find((d) => d.slug === deck)?.title}` : "Flashcards", { deck: deck || null, difficulty: difficulty || null, which });
          }}>Start {n} card{n === 1 ? "" : "s"}</button>
        {n === 0 && <span className="text-sm text-ink-soft">{which === "missed" ? "No missed cards here. Nice work." : "No cards match. Try another topic."}</span>}
      </div>
    </section>
  );
}

function FlashcardRun({ s, byId, onAnswer, onMove, onFinish, onQuit }: {
  s: Session; byId: Map<string, StudyRow>; onAnswer: (s: Session, id: string, v: boolean) => Session; onMove: (s: Session, p: number) => void; onFinish: (s: Session) => void; onQuit: () => void;
}) {
  const [flippedId, setFlippedId] = useState<string | null>(null);
  const row = byId.get(s.ids[s.position])!;
  const flipped = flippedId === row.id;
  const mark = (right: boolean) => {
    const next = onAnswer(s, row.id, right);
    setFlippedId(null);
    if (s.position + 1 >= s.ids.length) onFinish(next); else onMove(next, s.position + 1);
  };
  return (
    <section className="mt-4" aria-label="Flashcard" data-testid="fc-run">
      <RunHeader s={s} onQuit={onQuit} />
      <button type="button" onClick={() => setFlippedId(flipped ? null : row.id)} aria-pressed={flipped} data-testid="fc-card"
        className="mt-3 flex min-h-64 w-full flex-col justify-center rounded-2xl border border-line-strong bg-surface p-6 text-left shadow-sm transition hover:border-navy">
        <span className="text-xs font-semibold tracking-wide text-muted uppercase">{flipped ? "Answer" : "Question"} · tap to flip</span>
        {!flipped ? <span className="mt-3 text-lg font-semibold sm:text-xl">{row.prompt}</span> : (
          <span className="mt-3 block">
            <span className="block text-sm text-muted">{row.prompt}</span>
            <span className="mt-2 block text-lg font-semibold sm:text-xl">{row.answer}</span>
            {row.explanation && <span className="mt-3 block text-sm text-ink-soft">{row.explanation}</span>}
            {row.citation && <span className="mt-3 block text-xs font-semibold text-muted">Source: {row.citation}</span>}
          </span>
        )}
      </button>
      {flipped && row.sectionId && <p className="mt-2 text-right text-xs"><Link className="text-brand hover:underline" href={`/academy/codes/section/${row.sectionId}`} target="_blank">Read the official text</Link></p>}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <button type="button" className={`${ghost} border-danger/50 text-danger`} onClick={() => mark(false)} disabled={!flipped} data-testid="fc-missed"><X className="h-4 w-4" aria-hidden />Missed it</button>
        <button type="button" className={`${primary}`} onClick={() => mark(true)} disabled={!flipped} data-testid="fc-got"><Check className="h-4 w-4" aria-hidden />Got it</button>
      </div>
      {!flipped && <p className="mt-2 text-center text-xs text-muted">Flip the card to mark it.</p>}
    </section>
  );
}

// ---- Quiz -------------------------------------------------------------------------------------------------------------
function QuizSetup({ items, categories, state, stateLabel, trade, missed, onStart }: {
  items: StudyRow[]; categories: CategoryInfo[]; state: string | null; stateLabel: string | null; trade: string | null; missed: Set<string>;
  onStart: (ids: string[], label: string, minutes: number | null, filters: Record<string, string | number | boolean | null>) => void;
}) {
  const tradeCat = trade ? categories.find((c) => c.trades.includes(trade))?.slug ?? "" : "";
  const [category, setCategory] = useState(tradeCat);
  const [difficulty, setDifficulty] = useState<"" | Difficulty>("");
  const [size, setSize] = useState<number | "custom">(10);
  const [custom, setCustom] = useState(15);
  const [timed, setTimed] = useState(false);
  const [missedOnly, setMissedOnly] = useState(false);
  const pool = useMemo(() => filterItems(items, { category: category || null, state, difficulty: difficulty || null, missedOnly }, categories, missed).filter((i) => i.kind === "question"),
    [items, category, state, difficulty, missedOnly, categories, missed]);
  const want = size === "custom" ? custom : size;
  const n = clampCount(want, pool.length);
  const cats = categories.filter((c) => c.slug !== "state-specific" || items.some((i) => i.state && i.state === state));
  return (
    <section className="mt-4 rounded-xl border border-line bg-surface p-4 sm:p-5" aria-labelledby="qz-h">
      <h2 id="qz-h" className="text-lg font-bold">Quiz</h2>
      <p className="text-sm text-ink-soft">One question at a time. You&apos;ll see right away whether you got it, why, and where the rule comes from.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs font-semibold text-muted">Category
          <select className={input} value={category} onChange={(e) => setCategory(e.target.value)} data-testid="qz-category">
            <option value="">Everything</option>
            {cats.map((c) => <option key={c.slug} value={c.slug}>{c.slug === "state-specific" && stateLabel ? `${stateLabel} rules` : c.title}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-muted">Difficulty
          <select className={input} value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty | "")}>
            <option value="">Any</option><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option>
          </select>
        </label>
        <div className="text-xs font-semibold text-muted sm:col-span-2">Questions
          <div className="mt-1 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Number of questions">
            {[...QUIZ_SIZES, "custom" as const].map((v) => (
              <button key={v} type="button" role="radio" aria-checked={size === v} onClick={() => setSize(v)} data-testid={`qz-size-${v}`}
                className={cn("min-h-11 min-w-11 rounded-md border px-3 text-sm font-semibold", size === v ? "border-navy bg-navy text-white" : "border-line-strong bg-surface text-ink")}>{v === "custom" ? "Custom" : v}</button>
            ))}
            {size === "custom" && <input type="number" min={1} max={100} value={custom} onChange={(e) => setCustom(Number(e.target.value))} aria-label="Custom number of questions" className="w-20 rounded-md border border-line-strong bg-surface px-2 text-sm" />}
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={timed} onChange={(e) => setTimed(e.target.checked)} /> Timed ({formatClock(Math.round((n * SECONDS_PER_QUESTION) / 60) * 60).replace(/:00$/, "")} min)</label>
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={missedOnly} onChange={(e) => setMissedOnly(e.target.checked)} /> Only questions I missed ({[...missed].filter((id) => items.some((i) => i.id === id && i.kind === "question")).length})</label>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" className={primary} disabled={n === 0} data-testid="qz-start"
          onClick={() => onStart(pickQuestions(pool, n, Date.now() % 100000, missed).map((i) => i.id), category ? `Quiz: ${cats.find((c) => c.slug === category)?.title}` : "Quiz", timed ? Math.max(1, Math.round((n * SECONDS_PER_QUESTION) / 60)) : null,
            { category: category || null, difficulty: difficulty || null, count: n, timed, state })}>Start {n}-question quiz</button>
        {n > 0 && n < want && <span className="text-sm text-ink-soft">Only {n} approved question{n === 1 ? "" : "s"} match these choices right now.</span>}
        {n === 0 && <span className="text-sm text-ink-soft">No questions match. Try another category.</span>}
      </div>
    </section>
  );
}

// ---- Practice exams -------------------------------------------------------------------------------------------------
function ExamSetup({ items, exams, state, initialExam, onStart }: {
  items: StudyRow[]; exams: ExamInfo[]; state: string | null; initialExam: string | null; onStart: (exam: ExamInfo, style: ExamStyle, ids: string[]) => void;
}) {
  const sorted = useMemo(() => [...exams].sort((a, b) => Number(b.state === state && !!state) - Number(a.state === state && !!state)), [exams, state]);
  const [slug, setSlug] = useState(initialExam && exams.some((e) => e.slug === initialExam) ? initialExam : (sorted[0]?.slug ?? ""));
  const [style, setStyle] = useState<ExamStyle>("study");
  const exam = exams.find((e) => e.slug === slug) ?? null;
  const pool = useMemo(() => (exam ? examPool(items, exam) : []), [exam, items]);
  const sectionPool = useMemo(() => pool.filter((r, i) => sectionQuestion(r, items, i) !== null), [pool, items]);
  const usable = style === "find_section" ? sectionPool : pool;
  const n = exam ? clampCount(exam.count, usable.length) : 0;
  if (!exams.length) return <p className="mt-4 rounded-xl border border-line bg-surface p-4 text-sm text-ink-soft">Practice exams are being added. Try a quiz in the meantime.</p>;
  const STYLES: { key: ExamStyle; title: string; note: string }[] = [
    { key: "study", title: "Study mode", note: "Untimed. See the answer and explanation after each question." },
    { key: "timed", title: "Timed practice", note: `Exam-style: ${exam?.minutes ?? "-"} minutes, no hints until you finish.` },
    { key: "open_book", title: "Open-book navigation", note: "Untimed, no hints. Look rules up in the code library as you go." },
    { key: "find_section", title: "Find the section", note: "Pick which code section answers each question." },
  ];
  return (
    <section className="mt-4 grid gap-4 lg:grid-cols-[1fr_22rem]" aria-labelledby="ex-h">
      <div className="rounded-xl border border-line bg-surface p-4 sm:p-5">
        <h2 id="ex-h" className="text-lg font-bold">Practice exams</h2>
        <ul className="mt-3 grid gap-2" role="radiogroup" aria-label="Practice exam">
          {sorted.map((e) => (
            <li key={e.slug}>
              <button type="button" role="radio" aria-checked={slug === e.slug} onClick={() => setSlug(e.slug)} data-testid={`ex-${e.slug}`}
                className={cn("w-full rounded-lg border p-3 text-left", slug === e.slug ? "border-navy bg-brand-tint" : "border-line hover:border-line-strong")}>
                <span className="block font-semibold">{e.title}</span>
                <span className="mt-0.5 block text-xs text-muted">{e.count} questions{e.minutes ? ` · ${e.minutes} min timed` : ""}{e.state ? ` · ${e.state}` : ""}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      {exam && (
        <div className="rounded-xl border border-line bg-surface p-4 sm:p-5">
          <p className="text-sm text-ink-soft">{exam.summary}</p>
          <fieldset className="mt-4">
            <legend className="text-xs font-semibold text-muted">How do you want to practice?</legend>
            <div className="mt-2 grid gap-2">
              {STYLES.map((st) => (
                <label key={st.key} className={cn("flex cursor-pointer gap-2 rounded-lg border p-2.5 text-sm", style === st.key ? "border-navy" : "border-line")}>
                  <input type="radio" name="exam-style" checked={style === st.key} onChange={() => setStyle(st.key)} className="mt-1" />
                  <span><span className="font-semibold">{st.title}</span><span className="block text-xs text-muted">{st.note}</span></span>
                </label>
              ))}
            </div>
          </fieldset>
          <p className="mt-3 text-xs text-muted">
            {exam.bookPolicy === "unverified" ? "We haven't verified whether the real exam is open-book or closed-book. Check with the official exam provider." :
              <>The official exam provider lists this exam as {exam.bookPolicy === "open_book" ? "open-book" : "closed-book"}{exam.bookPolicySource && <> (<a href={exam.bookPolicySource} className="text-brand hover:underline" target="_blank" rel="noopener noreferrer">source</a>)</>}.</>}
            {exam.officialUrl && <> <a href={exam.officialUrl} className="text-brand hover:underline" target="_blank" rel="noopener noreferrer">Official rules</a>.</>}
          </p>
          <button type="button" className={`${primary} mt-4 w-full`} disabled={n === 0} data-testid="ex-start"
            onClick={() => onStart(exam, style, pickQuestions(usable, n, Date.now() % 100000).map((r) => r.id))}>Start {n}-question practice exam</button>
          {n > 0 && n < exam.count && <p className="mt-2 text-xs text-ink-soft">{n} approved questions are available for this mode right now, so the exam is shorter than {exam.count}.</p>}
          <p className="mt-3 text-xs text-muted" data-testid="ex-not-official">Practice only. This is not an official exam, Built2Bid is not an accredited testing provider, and practice scores don&apos;t predict or guarantee a passing result.</p>
        </div>
      )}
    </section>
  );
}

// ---- Shared question runner (quiz + exam) ---------------------------------------------------------------------------
function RunHeader({ s, onQuit, remaining }: { s: Session; onQuit: () => void; remaining?: number | null }) {
  const answered = Object.keys(s.answers).length;
  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="min-w-0 truncate font-semibold">{s.label}</span>
        <span className="flex shrink-0 items-center gap-3">
          {remaining !== undefined && remaining !== null && <span className={cn("flex items-center gap-1 tabular-nums", remaining < 60 && "font-bold text-danger")} aria-live="off" data-testid="run-clock"><Clock className="h-4 w-4" aria-hidden />{formatClock(remaining)}</span>}
          <button type="button" onClick={onQuit} className="text-xs font-semibold text-muted hover:text-ink">Save &amp; exit</button>
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line" aria-hidden><div className="h-full bg-navy transition-all" style={{ width: `${(answered / s.ids.length) * 100}%` }} /></div>
      <p className="mt-1 text-xs text-muted">{s.position + 1} of {s.ids.length} · {answered} answered</p>
    </div>
  );
}

function QuestionRun({ s, byId, codesQuery, onAnswer, onMove, onFinish, onQuit }: {
  s: Session; byId: Map<string, StudyRow>; codesQuery: string; onAnswer: (s: Session, id: string, v: number) => Session; onMove: (s: Session, p: number) => void; onFinish: (s: Session) => void; onQuit: () => void;
}) {
  const row = byId.get(s.ids[s.position])!;
  const d = s.derived?.[row.id];
  const options = d ? d.options : row.options ?? [];
  const correct = d ? d.correct : row.correct;
  const chosen = s.answers[row.id] as number | undefined;
  const locked = s.feedback && chosen !== undefined;
  const last = s.position + 1 >= s.ids.length;
  const [now, setNow] = useState(() => Date.now());
  const sRef = useRef(s);
  useEffect(() => { sRef.current = s; }, [s]);
  useEffect(() => {
    if (!s.deadline) return;
    const t = window.setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (sRef.current.deadline && n >= sRef.current.deadline) { window.clearInterval(t); onFinish(sRef.current); }
    }, 1000);
    return () => window.clearInterval(t);
  }, [s.deadline, onFinish]);
  const remaining = s.deadline ? Math.max(0, Math.round((s.deadline - now) / 1000)) : null;
  const unanswered = s.ids.length - Object.keys(s.answers).length;

  return (
    <section className="mt-4" aria-label="Question" data-testid="qz-run">
      <RunHeader s={s} onQuit={onQuit} remaining={remaining} />
      <div className="mt-3 rounded-2xl border border-line-strong bg-surface p-4 sm:p-6">
        <p className="text-base font-semibold sm:text-lg" data-testid="qz-prompt">{d ? <><span className="block text-xs font-semibold tracking-wide text-muted uppercase">Which section would you look up?</span>{row.prompt}</> : row.prompt}</p>
        <ul className="mt-4 grid gap-2">
          {options.map((o, i) => {
            const isChosen = chosen === i;
            const showRight = locked && i === correct;
            const showWrong = locked && isChosen && i !== correct;
            return (
              <li key={o}>
                <button type="button" disabled={locked} onClick={() => onAnswer(s, row.id, i)} aria-pressed={isChosen} data-testid="qz-option"
                  className={cn("flex min-h-12 w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition",
                    showRight ? "border-ok bg-ok/10" : showWrong ? "border-danger bg-danger/10" : isChosen ? "border-navy bg-brand-tint" : "border-line hover:border-line-strong")}>
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line-strong text-xs font-bold">{showRight ? <Check className="h-3.5 w-3.5" aria-label="Correct" /> : showWrong ? <X className="h-3.5 w-3.5" aria-label="Your answer" /> : String.fromCharCode(65 + i)}</span>
                  <span>{o}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {locked && (
          <div className={cn("mt-4 rounded-lg p-3 text-sm", chosen === correct ? "bg-ok/10" : "bg-danger/10")} aria-live="polite" data-testid="qz-feedback">
            <p className="font-bold">{chosen === correct ? "Correct." : `Not quite. The answer is ${options[correct ?? 0]}.`}</p>
            {row.explanation && <p className="mt-1 text-ink-soft">{row.explanation}</p>}
            {row.citation && <p className="mt-2 text-xs font-semibold text-muted">Source: {row.sectionId ? <Link href={`/academy/codes/section/${row.sectionId}`} target="_blank" className="text-brand hover:underline">{row.citation}</Link> : row.citation}</p>}
          </div>
        )}
        {s.style === "open_book" && <p className="mt-3 text-xs"><Link href={`/academy/codes${codesQuery}`} target="_blank" className="font-semibold text-brand hover:underline">Open the code library in a new tab</Link> <span className="text-muted">and find the rule yourself.</span></p>}
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <button type="button" className={ghost} disabled={s.position === 0 || s.feedback} onClick={() => onMove(s, s.position - 1)} hidden={s.feedback}>Back</button>
        <span className="flex-1" />
        {!last && <button type="button" className={primary} disabled={s.feedback && !locked} onClick={() => onMove(s, s.position + 1)} data-testid="qz-next">{s.feedback ? "Next question" : chosen === undefined ? "Skip" : "Next"}</button>}
        {last && <button type="button" className={primary} disabled={s.feedback && !locked} onClick={() => onFinish(s)} data-testid="qz-finish">See my score</button>}
      </div>
      {!s.feedback && !last && unanswered < s.ids.length && <p className="mt-3 text-right"><button type="button" onClick={() => onFinish(s)} className="text-xs font-semibold text-muted hover:text-ink">Finish now ({unanswered} unanswered)</button></p>}
    </section>
  );
}

// ---- Results ----------------------------------------------------------------------------------------------------------
function Results({ s, byId, decks, signedIn, onClose, onRetry, onDeck }: {
  s: Session; byId: Map<string, StudyRow>; decks: DeckInfo[]; signedIn: boolean; onClose: () => void; onRetry: (ids: string[]) => void; onDeck: (deck: string) => void;
}) {
  const rows = s.ids.map((id) => byId.get(id)!).filter(Boolean);
  const right = (r: StudyRow) => (s.derived ? s.answers[r.id] === s.derived[r.id]?.correct : isRight(r, s.answers[r.id]));
  const nRight = rows.filter(right).length;
  const wrong = rows.filter((r) => !right(r));
  const recs = recommendations(rows, Object.fromEntries(rows.map((r) => [r.id, right(r) ? (r.kind === "question" ? r.correct! : true) : -1])), decks).slice(0, 4);
  const pct = rows.length ? Math.round((nRight / rows.length) * 100) : 0;
  return (
    <section className="mt-4" aria-labelledby="res-h" data-testid="study-results">
      <div className="rounded-2xl border border-line-strong bg-surface p-5 text-center">
        <h2 id="res-h" className="text-sm font-bold tracking-wide text-muted uppercase">{s.label}</h2>
        <p className="mt-2 font-display text-4xl font-extrabold" data-testid="res-score">{nRight} / {rows.length}</p>
        <p className="text-sm text-ink-soft">{s.mode === "flashcards" ? `You knew ${pct}% of these cards.` : `${pct}% correct.`} {signedIn ? "Saved to your progress." : "Saved in this browser."}</p>
        {s.mode === "exam" && <p className="mt-2 text-xs text-muted">Practice only. Not an official exam, and practice scores don&apos;t predict or guarantee a passing result.</p>}
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {wrong.length > 0 && <button type="button" className={primary} onClick={() => onRetry(wrong.map((r) => r.id))} data-testid="res-retry"><RotateCcw className="h-4 w-4" aria-hidden />Retry {wrong.length} missed</button>}
          <button type="button" className={ghost} onClick={onClose}>Done</button>
        </div>
      </div>
      {recs.length > 0 && (
        <div className="mt-4 rounded-xl border border-line bg-surface p-4">
          <h3 className="font-bold">Study next</h3>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {recs.map((r) => (
              <li key={r.slug} className="flex items-center justify-between gap-2 rounded-lg border border-line p-2.5 text-sm">
                <span><span className="font-semibold">{r.title}</span><span className="block text-xs text-muted">Missed {r.missed} of {r.total}</span></span>
                <button type="button" className="shrink-0 text-xs font-semibold text-brand hover:underline" onClick={() => onDeck(r.slug)}>Flashcards</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {s.mode !== "flashcards" && (
        <div className="mt-4">
          <h3 className="font-bold">Review</h3>
          <ol className="mt-2 grid gap-2">
            {[...wrong, ...rows.filter(right)].map((r) => {
              const d = s.derived?.[r.id];
              const opts = d ? d.options : r.options ?? [];
              const corr = d ? d.correct : r.correct ?? 0;
              const mine = s.answers[r.id] as number | undefined;
              return (
                <li key={r.id} className={cn("rounded-lg border p-3 text-sm", right(r) ? "border-line" : "border-danger/40")}>
                  <p className="font-semibold">{right(r) ? "✓" : "✗"} {r.prompt}</p>
                  <p className="mt-1">Answer: <span className="font-semibold">{opts[corr]}</span>{!right(r) && <span className="text-ink-soft"> · You chose: {mine === undefined ? "no answer" : opts[mine]}</span>}</p>
                  {r.explanation && <p className="mt-1 text-ink-soft">{r.explanation}</p>}
                  {r.citation && <p className="mt-1 text-xs font-semibold text-muted">Source: {r.sectionId ? <Link href={`/academy/codes/section/${r.sectionId}`} className="text-brand hover:underline">{r.citation}</Link> : r.citation}</p>}
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </section>
  );
}
