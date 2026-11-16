"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { track } from "@/lib/analytics/track";
import { answered, deepPath, hintSelections, mainComplete, mainPath, MAIN_LENGTH, setAnswer } from "@/lib/bid-check/engine";
import { buildResult } from "@/lib/bid-check/result";
import type { Answers, Arrival, Question } from "@/lib/bid-check/types";
import { ResultView } from "./result-view";
import { sendEvent } from "./events";

type View = { k: "main"; pos: number } | { k: "deep"; pos: number } | { k: "result" };
interface Saved { sid: string; answers: Answers; view: View; sent: string[] }

const KEY = "b2b_bid_check";
const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : "00000000-0000-4000-8000-" + Math.random().toString(16).slice(2, 14).padEnd(12, "0"));

function load(): Saved | null {
  try { const s = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as Saved | null; return s?.sid ? s : null; } catch { return null; }
}
function save(s: Saved) {
  try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode: this visit only */ }
}

export function BidCheck({ arrival, invitesOpen, signedIn }: { arrival: Arrival; invitesOpen: boolean; signedIn: boolean }) {
  const [state, setState] = useState<Saved | null>(null);
  const hints = useMemo(() => hintSelections(arrival.tradeHint), [arrival.tradeHint]);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Restore this tab's run (refresh keeps answers), or start a new one.
  useEffect(() => {
    const s = load();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of browser-only state
    setState(s ?? { sid: newId(), answers: {}, view: { k: "main", pos: 0 }, sent: [] });
  }, []);
  useEffect(() => { if (state) save(state); }, [state]);

  const view = state?.view;
  const viewKey = view ? `${view.k}:${"pos" in view ? view.pos : -1}` : "";
  useEffect(() => { if (viewKey) { headingRef.current?.focus({ preventScroll: true }); window.scrollTo({ top: 0 }); } }, [viewKey]);

  const result = useMemo(() => (state ? buildResult(state.answers) : null), [state]);

  // Result shown: once per run.
  useEffect(() => {
    if (!state || state.view.k !== "result" || !result || state.sent.includes("result")) return;
    sendEvent(state.sid, "result", state.answers);
    track("bid_check_result", { goal: result.goal, trade: result.templateSlug, cta: result.primary });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- remember the event was sent
    setState((s) => (s ? { ...s, sent: [...s.sent, "result"] } : s));
  }, [state, result]);

  if (!state) return <p className="py-16 text-center text-ink-soft" aria-busy="true">Loading…</p>;

  const { answers } = state;
  const main = mainPath(answers);
  const deep = deepPath(answers);

  function once(name: string, fn: () => void, s: Saved): Saved {
    if (s.sent.includes(name)) return s;
    fn();
    return { ...s, sent: [...s.sent, name] };
  }

  // Computed from the current state (not inside a state updater) so events fire exactly once per tap.
  function answer(q: Question, value: string) {
    const prev = state!;
    let s: Saved = { ...prev, answers: setAnswer(prev.answers, q.id, value) };
    s = once("start", () => { sendEvent(s.sid, "start", s.answers, arrival); track("bid_check_start", { trade: arrival.tradeHint ?? undefined, campaign: arrival.campaign ?? undefined }); }, s);
    const v = prev.view;
    if (v.k === "main") {
      const nextMain = mainPath(s.answers);
      if (v.pos + 1 < nextMain.length) s = { ...s, view: { k: "main", pos: v.pos + 1 } };
      else if (mainComplete(s.answers)) {
        s = once("complete", () => { sendEvent(s.sid, "complete", s.answers); const r = buildResult(s.answers); track("bid_check_complete", { goal: r?.goal, trade: r?.templateSlug }); }, s);
        s = { ...s, view: { k: "result" } };
      }
    } else if (v.k === "deep") {
      const nextDeep = deepPath(s.answers);
      if (v.pos + 1 < nextDeep.length) s = { ...s, view: { k: "deep", pos: v.pos + 1 } };
      else { sendEvent(s.sid, "deep", s.answers); s = { ...s, view: { k: "result" } }; }
    }
    setState(s);
  }

  function back() {
    setState((prev) => {
      if (!prev) return prev;
      const v = prev.view;
      if (v.k === "main") return v.pos > 0 ? { ...prev, view: { k: "main", pos: v.pos - 1 } } : prev;
      if (v.k === "deep") return v.pos > 0 ? { ...prev, view: { k: "deep", pos: v.pos - 1 } } : { ...prev, view: { k: "result" } };
      return { ...prev, view: { k: "main", pos: Math.min(MAIN_LENGTH, mainPath(prev.answers).length) - 1 } };
    });
  }

  function restart() {
    setState({ sid: newId(), answers: {}, view: { k: "main", pos: 0 }, sent: [] });
  }

  if (state.view.k === "result" && result) {
    return (
      <ResultView
        result={result} answers={answers} sid={state.sid} invitesOpen={invitesOpen} signedIn={signedIn}
        bonusCount={deep.filter((q) => !answered(q, answers)).length}
        bonusDone={deep.every((q) => answered(q, answers) || q.optional)}
        onBonus={() => setState((s) => (s ? { ...s, view: { k: "deep", pos: Math.max(0, deepPath(s.answers).findIndex((q) => !answered(q, s.answers))) } } : s))}
        onEdit={back}
        onRestart={restart}
        headingRef={headingRef}
      />
    );
  }

  const isDeep = state.view.k === "deep";
  const path = isDeep ? deep : main;
  const pos = state.view.k === "result" ? 0 : Math.min(state.view.pos, path.length - 1);
  const q = path[pos];
  if (!q) return null;
  const total = isDeep ? deep.length : MAIN_LENGTH;
  const selected = answers[q.id] ?? hints[q.id];
  const fromLink = answers[q.id] === undefined && hints[q.id] !== undefined;

  return (
    <section aria-labelledby="bc-q" className="mx-auto w-full max-w-xl">
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={back} disabled={!isDeep && pos === 0}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-ink-soft hover:bg-black/5 hover:text-ink disabled:invisible">
          <ArrowLeft className="h-4 w-4" aria-hidden />{isDeep && pos === 0 ? "Back to my result" : "Back"}
        </button>
        <p className="text-sm font-semibold text-muted" data-testid="bc-progress">{isDeep ? `Bonus question ${pos + 1} of ${total}` : `Question ${pos + 1} of ${total}`}</p>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/10" role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={pos}>
        <div className={cn("h-full rounded-full transition-all", isDeep ? "bg-brand" : "bg-accent")} style={{ width: `${(pos / total) * 100}%` }} />
      </div>

      <h1 id="bc-q" ref={headingRef} tabIndex={-1} className="mt-6 font-display text-2xl font-extrabold leading-tight text-ink outline-none sm:text-3xl" data-testid="bc-question" data-qid={q.id}>{q.prompt}</h1>
      {q.help && <p className="mt-2 text-ink-soft">{q.help}</p>}
      {fromLink && <p className="mt-2 text-sm text-muted" data-testid="bc-preselected">We picked this from the post you came from. Tap another to change it.</p>}

      {q.kind === "single" ? (
        <ul className="mt-5 grid gap-2.5" role="list">
          {q.options.map((o) => {
            const on = selected === o.value;
            return (
              <li key={o.value}>
                <button type="button" onClick={() => answer(q, o.value)} aria-pressed={on} data-testid="bc-option" data-value={o.value}
                  className={cn(
                    "flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border-2 bg-surface px-4 py-3 text-left text-base font-semibold text-ink transition-colors",
                    on ? "border-accent bg-accent-tint" : "border-line hover:border-brand/50",
                  )}>
                  <span>{o.label}{o.hint && <span className="mt-0.5 block text-sm font-normal text-ink-soft">{o.hint}</span>}</span>
                  {on ? <Check className="h-5 w-5 shrink-0 text-accent-ink" aria-hidden /> : <ArrowRight className="h-4 w-4 shrink-0 text-muted" aria-hidden />}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <TextAnswer key={q.id} q={q} initial={answers[q.id] ?? ""} onSubmit={(v) => answer(q, v)} />
      )}

      {q.kind === "single" && selected !== undefined && (
        <div className="mt-5 flex justify-end">
          <button type="button" onClick={() => answer(q, selected)} className="inline-flex min-h-12 items-center gap-2 rounded-lg bg-accent px-5 font-display font-semibold text-navy hover:bg-accent-hover" data-testid="bc-continue">
            Continue <ArrowRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}
      {isDeep && (
        <p className="mt-6 text-center text-sm text-muted">Bonus questions are optional. <button type="button" className="font-semibold underline" onClick={() => setState((s) => (s ? { ...s, view: { k: "result" } } : s))}>Skip to my result</button></p>
      )}
    </section>
  );
}

function TextAnswer({ q, initial, onSubmit }: { q: Question; initial: string; onSubmit: (v: string) => void }) {
  const [v, setV] = useState(initial);
  const ok = q.optional || v.trim().length > 0;
  return (
    <form className="mt-5" onSubmit={(e) => { e.preventDefault(); if (ok) onSubmit(v.trim()); }}>
      <label htmlFor="bc-text" className="sr-only">{q.prompt}</label>
      <textarea id="bc-text" value={v} onChange={(e) => setV(e.target.value)} rows={q.optional ? 4 : 2} maxLength={q.optional ? 500 : 80}
        placeholder={q.placeholder} className="field w-full rounded-xl border-2 border-line bg-surface px-4 py-3 text-base text-ink" data-testid="bc-text" />
      <div className="mt-4 flex justify-end">
        <button type="submit" disabled={!ok} className="inline-flex min-h-12 items-center gap-2 rounded-lg bg-accent px-5 font-display font-semibold text-navy hover:bg-accent-hover disabled:opacity-50" data-testid="bc-continue">
          {q.optional && !v.trim() ? "Skip" : "Continue"} <ArrowRight className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </form>
  );
}
