"use client";
import { useState } from "react";
import { submitQuiz, type QuizResult } from "@/app/sales/(portal)/academy-actions";

interface Q { q: string; options: string[] }

/** Topic quiz. Answers are graded on the server; explanations show after submitting. */
export function AcademyQuiz({ topicId, questions }: { topicId: string; questions: Q[] }) {
  const [answers, setAnswers] = useState<(number | null)[]>(questions.map(() => null));
  const [result, setResult] = useState<QuizResult | null>(null);
  const [busy, setBusy] = useState(false);
  const done = result?.ok === true;
  const submit = async () => {
    setBusy(true);
    setResult(await submitQuiz(topicId, answers));
    setBusy(false);
  };
  return (
    <div className="space-y-4">
      {questions.map((q, i) => (
        <fieldset key={i} className="rounded-lg border border-line p-4">
          <legend className="px-1 text-sm font-semibold">{i + 1}. {q.q}</legend>
          <div className="mt-2 grid gap-1.5">
            {q.options.map((o, j) => (
              <label key={j} className="flex min-h-11 items-center gap-2 rounded-md px-2 text-sm hover:bg-paper">
                <input type="radio" name={`q${i}`} checked={answers[i] === j} disabled={done} onChange={() => setAnswers((a) => a.map((x, k) => (k === i ? j : x)))} /> {o}
              </label>
            ))}
          </div>
          {done && result.ok && (
            <p className={`mt-2 text-sm ${result.correct[i] ? "text-ok" : "text-danger"}`}>{result.correct[i] ? "Correct. " : "Not quite. "}{result.explain[i]}</p>
          )}
        </fieldset>
      ))}
      {result && !result.ok && <p role="alert" className="text-sm text-danger">{result.message}</p>}
      {done && result.ok ? (
        <div className="flex flex-wrap items-center gap-3" aria-live="polite">
          <p className="font-bold">{result.score} of {result.total}: {result.passed ? "passed!" : "not passed yet. Review the lesson and try again."}</p>
          <button type="button" onClick={() => { setResult(null); setAnswers(questions.map(() => null)); }} className="min-h-11 rounded-lg border border-line bg-white px-4 text-sm font-semibold">Retake</button>
        </div>
      ) : (
        <button type="button" onClick={submit} disabled={busy || answers.some((a) => a == null)} className="min-h-11 rounded-lg bg-ink px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Grading…" : "Submit answers"}</button>
      )}
    </div>
  );
}
