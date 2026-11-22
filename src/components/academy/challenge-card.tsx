import Link from "next/link";
import { Award, CheckCircle2, Circle, GraduationCap } from "lucide-react";
import { Card } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import {
  CHALLENGE_TRAININGS, challengePercent, monthLabel, quizLabel, rewardHeadline, rewardPhase, shortDate, type ChallengeStatus,
} from "@/lib/academy/rewards";

/** The progress bar with four training dots and one quiz dot. */
export function ChallengeProgress({ status, className }: { status: ChallengeStatus; className?: string }) {
  const m = status.month;
  const pct = challengePercent(m);
  return (
    <div className={className}>
      <div className="h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Monthly challenge progress">
        <div className="h-full rounded-full bg-accent transition-[width] duration-(--motion-slow)" style={{ width: `${pct}%` }} />
      </div>
      <ol className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted" aria-label="Challenge steps">
        {Array.from({ length: CHALLENGE_TRAININGS }, (_, i) => {
          const done = i < m.trainings_done;
          return (
            <li key={i} className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5", done ? "border-accent/40 bg-accent/10 text-ink" : "border-line")}>
              {done ? <CheckCircle2 className="h-3.5 w-3.5 text-accent" aria-hidden /> : <Circle className="h-3.5 w-3.5" aria-hidden />}
              <span>Training {i + 1}<span className="sr-only">{done ? " done" : " not done"}</span></span>
            </li>
          );
        })}
        <li className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5", m.quiz_status === "passed" ? "border-accent/40 bg-accent/10 text-ink" : "border-line")}>
          {m.quiz_status === "passed" ? <CheckCircle2 className="h-3.5 w-3.5 text-accent" aria-hidden /> : <Circle className="h-3.5 w-3.5" aria-hidden />}
          <span>Quiz<span className="sr-only">{m.quiz_status === "passed" ? " passed" : " not passed"}</span></span>
        </li>
      </ol>
    </div>
  );
}

/** "Your Monthly Academy Challenge": compact card for the Classroom, the Academy profile and Billing. */
export function ChallengeCard({ status, className, showLink = true }: { status: ChallengeStatus; className?: string; showLink?: boolean }) {
  const m = status.month;
  const phase = rewardPhase(status);
  const earned = phase.startsWith("earned") || phase === "claimed";
  const r = status.reward;
  return (
    <Card className={cn("p-4", className)} data-testid="challenge-card">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-navy text-cyan" aria-hidden>{earned ? <Award className="h-4 w-4" /> : <GraduationCap className="h-4 w-4" />}</span>
        <div className="min-w-0 flex-1">
          <p className="font-bold">Your Monthly Academy Challenge</p>
          <p className="text-xs text-muted">{monthLabel(m.month)}</p>
        </div>
      </div>
      <ul className="mt-3 space-y-1 text-sm">
        <li>Trainings completed: <span className="font-semibold">{Math.min(m.trainings_done, CHALLENGE_TRAININGS)}/{CHALLENGE_TRAININGS}</span></li>
        <li>Quiz completed: <span className="font-semibold">{m.quiz_status === "passed" ? 1 : 0}/1</span>
          {m.quiz_status !== "not_started" && <span className="text-muted"> · {quizLabel[m.quiz_status]}{m.quiz_latest ? ` (${m.quiz_latest.correct}/20)` : ""}</span>}</li>
        <li className={cn(earned && "font-semibold text-ink")}>{rewardHeadline(phase)}</li>
        {r?.action === "comp_days" && r.activates_at && r.expires_at && (
          <li className="text-xs text-muted">Free month: {shortDate(r.activates_at)} to {shortDate(r.expires_at)}</li>
        )}
        {r?.action === "stripe_credit" && r.status === "applied" && (
          <li className="text-xs text-muted">Credited to your next bill on {shortDate(r.applied_at)}</li>
        )}
      </ul>
      <ChallengeProgress status={status} className="mt-3" />
      {showLink && <Link href="/academy/challenge" className="mt-3 inline-block text-sm font-semibold text-brand hover:underline">{earned ? "See your Academy progress" : "Open the challenge"}</Link>}
    </Card>
  );
}
