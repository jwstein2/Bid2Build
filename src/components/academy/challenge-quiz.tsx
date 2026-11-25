"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Award, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, Notice } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import { CHALLENGE_MIN_POOL, CHALLENGE_PASS, CHALLENGE_QUESTIONS, type ChallengeAttempt, type ChallengeResult } from "@/lib/academy/rewards";
import { startChallengeQuiz, submitChallengeQuiz } from "@/app/(marketing)/academy/challenge/actions";

const SPARKS = [12, 28, 46, 64, 82];

/**
 * The 20-question challenge quiz. No answer is shown until the whole quiz is submitted; grading happens on the server.
 * A started quiz survives a reload (the server resumes it) for up to 60 minutes.
 */
export function ChallengeQuiz({ topics, resume, signedIn, trainingsDone }: {
  topics: { slug: string; title: string; pool: number }[]; resume: boolean; signedIn: boolean; trainingsDone: number;
}) {
  const router = useRouter();
  const ready = topics.filter((t) => t.pool >= CHALLENGE_MIN_POOL);
  const [topic, setTopic] = useState(ready[0]?.slug ?? "");
  const [attempt, setAttempt] = useState<ChallengeAttempt | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<ChallengeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const begin = (slug: string) => start(async () => {
    setError(null);
    const r = await startChallengeQuiz(slug);
    if (!r.ok) { setError(r.error); return; }
    setAttempt(r.attempt); setAnswers({}); setResult(null);
  });

  // Resume an open quiz after a reload.
  useEffect(() => { if (resume && !attempt && topic) begin(topic); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => start(async () => {
    if (!attempt) return;
    setError(null);
    const r = await submitChallengeQuiz(attempt.attempt_id, answers);
    if (!r.ok) { setError(r.error); return; }
    setResult(r.result);
    router.refresh();
  });

  if (!signedIn) return <Notice tone="neutral" title="Sign in to take the challenge quiz">Quiz results count toward the challenge only when they are saved to your account.</Notice>;

  if (result && attempt) {
    const byId = new Map(attempt.questions.map((q) => [q.id, q]));
    const earned = result.claim?.state === "qualified";
    return (
      <div className="space-y-4" data-testid="challenge-result">
        <Card className={cn("relative overflow-hidden p-5", result.passed && "win-pop border-accent/40")} role="status" aria-live="polite">
          {result.passed && SPARKS.map((x, i) => <span key={x} aria-hidden className="win-spark" style={{ left: `${x}%`, bottom: 8, animationDelay: `${i * 0.12}s` }} />)}
          <p className="text-2xl font-extrabold">{result.correct}/{result.total} correct</p>
          {result.expired ? <p className="mt-1 text-ink-soft">The 60-minute limit passed before this quiz was submitted, so it can&apos;t count. Start a new one when you&apos;re ready.</p>
            : result.passed ? <p className="mt-1 text-ink-soft">You passed. That&apos;s this month&apos;s quiz done.</p>
            : <p className="mt-1 text-ink-soft">You need {result.pass_correct} correct to pass. Review the answers below, then try again with a new set of questions.</p>}
          {earned && (
            <p className="mt-3 flex items-center gap-2 font-semibold text-ink"><Award className="h-5 w-5 text-accent" aria-hidden /> Congratulations! You earned 1 free month of Individual Unlimited.</p>
          )}
          {!result.passed || trainingsDone >= 4 || earned ? null : <p className="mt-2 text-sm text-ink-soft">Finish {4 - trainingsDone} more training{4 - trainingsDone === 1 ? "" : "s"} this month to complete the challenge.</p>}
        </Card>
        <ol className="space-y-3">
          {result.review.map((r, i) => {
            const q = byId.get(r.id);
            if (!q) return null;
            const ok = r.picked === r.correct;
            return (
              <li key={r.id}>
                <Card className="p-4">
                  <p className="flex gap-2 text-sm font-semibold">{ok ? <CheckCircle2 className="h-4 w-4 shrink-0 text-ok" aria-label="Correct" /> : <XCircle className="h-4 w-4 shrink-0 text-danger" aria-label="Incorrect" />}{i + 1}. {q.prompt}</p>
                  <p className="mt-1 text-sm">Answer: <span className="font-semibold">{q.options[r.correct]}</span>{!ok && r.picked != null && <span className="text-muted"> · You chose: {q.options[r.picked]}</span>}</p>
                  {r.explanation && <p className="mt-1 text-sm text-ink-soft">{r.explanation}</p>}
                  {r.citation && <p className="mt-1 text-xs text-muted">Source: {r.citation}</p>}
                </Card>
              </li>
            );
          })}
        </ol>
        <Button variant="secondary" onClick={() => { setAttempt(null); setResult(null); }}>Back to the challenge</Button>
      </div>
    );
  }

  if (attempt) {
    const answered = Object.keys(answers).length;
    return (
      <div className="space-y-3" data-testid="challenge-quiz">
        <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface/95 px-3 py-2 text-sm backdrop-blur">
          <span><span className="font-semibold">{answered}/{attempt.questions.length}</span> answered · pass with {CHALLENGE_PASS} correct</span>
          <span className="text-muted">Submit by {new Date(attempt.expires_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
        </div>
        <ol className="space-y-3">
          {attempt.questions.map((q, i) => (
            <li key={q.id}>
              <Card className="p-4">
                <fieldset>
                  <legend className="text-sm font-semibold">{i + 1}. {q.prompt}</legend>
                  <div className="mt-2 grid gap-1.5">
                    {q.options.map((o, k) => (
                      <label key={k} className={cn("flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm", answers[q.id] === k ? "border-navy bg-brand-tint" : "border-line hover:border-line-strong")}>
                        <input type="radio" name={q.id} className="mt-0.5" checked={answers[q.id] === k} onChange={() => setAnswers((a) => ({ ...a, [q.id]: k }))} />
                        <span>{o}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              </Card>
            </li>
          ))}
        </ol>
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex flex-wrap items-center gap-3">
          <Button loading={pending} onClick={submit} disabled={pending} data-testid="challenge-submit">{pending ? "Grading…" : "Submit quiz"}</Button>
          {answered < attempt.questions.length && <span className="text-sm text-muted">{attempt.questions.length - answered} unanswered (they count as wrong)</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {ready.length === 0 ? <Notice tone="neutral" title="Quiz topics are on the way">Challenge quizzes need at least {CHALLENGE_MIN_POOL} questions in a topic. Check back soon.</Notice> : (
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm font-semibold">Quiz topic
            <select className="mt-1 block w-64 max-w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm" value={topic} onChange={(e) => setTopic(e.target.value)} data-testid="challenge-topic">
              {ready.map((t) => <option key={t.slug} value={t.slug}>{t.title}</option>)}
            </select>
          </label>
          <Button loading={pending} onClick={() => begin(topic)} disabled={pending || !topic} data-testid="challenge-start">{pending ? "Loading…" : `Start ${CHALLENGE_QUESTIONS}-question quiz`}</Button>
        </div>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
      <p className="text-xs text-muted">Questions are drawn at random from the topic, so each try is different. Up to 5 tries a day; 60 minutes per quiz.</p>
    </div>
  );
}
