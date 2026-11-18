"use client";
import { useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import type { QuizQuestion } from "@/lib/academy/types";

/** Self-check quiz. Answers are checked in the browser; nothing is graded or stored except the optional score on completion. */
export function Quiz({ questions, scoreField }: { questions: QuizQuestion[]; scoreField?: string }) {
  const [picked, setPicked] = useState<(number | null)[]>(() => questions.map(() => null));
  const [checked, setChecked] = useState(false);
  const correct = picked.filter((p, i) => p === questions[i].answer).length;
  const score = Math.round((correct / Math.max(questions.length, 1)) * 100);
  return (
    <div data-testid="lesson-quiz">
      <ol className="space-y-4">
        {questions.map((q, qi) => (
          <li key={qi}>
            <fieldset>
              <legend className="font-semibold">{qi + 1}. {q.q}</legend>
              <div className="mt-2 space-y-1.5">
                {q.options.map((o, oi) => {
                  const isRight = checked && oi === q.answer;
                  const isWrong = checked && picked[qi] === oi && oi !== q.answer;
                  return (
                    <label key={oi} className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm ${isRight ? "border-ok bg-ok-tint" : isWrong ? "border-danger bg-danger-tint" : "border-line hover:bg-paper"}`}>
                      <input type="radio" name={`q${qi}`} className="mt-0.5" checked={picked[qi] === oi} disabled={checked}
                        onChange={() => setPicked((p) => p.map((v, i) => (i === qi ? oi : v)))} />
                      <span className="flex-1">{o}</span>
                      {isRight && <CheckCircle2 className="h-4 w-4 text-ok" aria-label="Correct answer" />}
                      {isWrong && <XCircle className="h-4 w-4 text-danger" aria-label="Your answer" />}
                    </label>
                  );
                })}
              </div>
              {checked && <p className="mt-2 text-sm text-ink-soft">{q.explain}</p>}
            </fieldset>
          </li>
        ))}
      </ol>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {!checked ? (
          <button type="button" className={buttonClass("secondary", "sm")} disabled={picked.some((p) => p === null)} onClick={() => setChecked(true)}>Check answers</button>
        ) : (
          <>
            <p className="text-sm font-semibold" role="status">{correct} of {questions.length} correct</p>
            <button type="button" className={buttonClass("ghost", "sm")} onClick={() => { setChecked(false); setPicked(questions.map(() => null)); }}>Try again</button>
          </>
        )}
      </div>
      {scoreField && checked && <input type="hidden" name={scoreField} value={score} form="complete-lesson" />}
    </div>
  );
}
