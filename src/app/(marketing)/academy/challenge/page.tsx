import type { Metadata } from "next";
import Link from "next/link";
import { Award, CheckCircle2 } from "lucide-react";
import { Badge, Card, Container, Notice } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { ChallengeCard } from "@/components/academy/challenge-card";
import { ChallengeQuiz } from "@/components/academy/challenge-quiz";
import { listCourses, loadMe } from "@/lib/academy/server";
import { createClient } from "@/lib/supabase/server";
import { deliverMyReward, loadChallenge } from "@/lib/academy/rewards-server";
import {
  CHALLENGE_PASS, CHALLENGE_QUESTIONS, CHALLENGE_REWARD_VALUE, CHALLENGE_TRAININGS, daysLeftInMonth, monthLabel, quizLabel, rewardHeadline, rewardPhase, shortDate,
} from "@/lib/academy/rewards";

export const metadata: Metadata = {
  title: "Monthly Academy Challenge: Earn a Free Month",
  description: "Complete four Academy trainings and pass one 20-question quiz with at least 80% in the same month to earn one free month of Built2Bid Individual Unlimited.",
  alternates: { canonical: "/academy/challenge" },
};
export const dynamic = "force-dynamic";

export default async function ChallengePage() {
  const [{ user, me }, first, courses] = await Promise.all([loadMe(), loadChallenge(), listCourses({})]);
  let status = first;
  // A reward earned but not yet delivered (e.g. a hiccup during the quiz) is delivered on the next visit.
  if (user && status?.reward && ["pending", "applying"].includes(status.reward.status)) {
    if ((await deliverMyReward(user.id)) !== "none") status = await loadChallenge();
  }
  const available = courses.filter((c) => c.status === "published" && (c.lesson_count ?? 0) > 0);
  let completedIds = new Set<string>();
  if (user && status) {
    const { data } = await (await createClient()).from("academy_course_completions").select("course_id");
    completedIds = new Set(((data ?? []) as { course_id: string }[]).map((r) => r.course_id));
  }
  const thisMonth = new Set(status?.month.trainings.map((t) => t.course_id) ?? []);
  const phase = status ? rewardPhase(status) : "available";
  const earned = phase.startsWith("earned") || phase === "claimed";

  return (
    <Container className="py-8">
      <section className="max-w-3xl">
        <p className="text-sm font-semibold text-brand">Monthly Academy Challenge</p>
        <h1 className="mt-1 font-display text-3xl font-extrabold">{earned ? "You earned your free month" : "Learn More. Build Better. Earn a Free Month."}</h1>
        {earned ? (
          <p className="mt-2 text-ink-soft">Earned: Lifetime Reward Claimed. Keep learning: your trainings, quiz scores and milestones are still tracked here every month.</p>
        ) : (
          <p className="mt-2 text-ink-soft">Complete {CHALLENGE_TRAININGS} Academy trainings and pass one {CHALLENGE_QUESTIONS}-question quiz with at least 80% accuracy in the same month to earn one free month of Built2Bid Individual Unlimited.</p>
        )}
        <p className="mt-1 text-sm text-muted">One free month per account, lifetime. <a href="#terms" className="underline">Terms apply.</a></p>
      </section>

      {!user ? (
        <Card className="mt-6 max-w-3xl p-5">
          <p className="font-semibold">Sign in to start the challenge</p>
          <p className="mt-1 text-sm text-ink-soft">Your trainings and quiz must be saved to your Built2Bid account to count.</p>
          <div className="mt-3 flex flex-wrap gap-2"><ButtonLink href="/login?next=/academy/challenge">Sign in or create a free account</ButtonLink></div>
        </Card>
      ) : !status ? (
        <Notice className="mt-6 max-w-3xl" tone="neutral" title="The challenge is being set up">Check back shortly.</Notice>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-6">
            {!me.member && (
              <Notice tone="neutral" title="Join the Academy to track trainings">Marking lessons complete needs a free Academy profile. <Link href="/academy/join" className="font-semibold text-brand hover:underline">Join the Academy</Link></Notice>
            )}
            {status.excluded && !status.reward && (
              <Notice tone="neutral" title="This account can't earn the reward">Staff, test, demo and practice accounts can use the challenge, but the free month is for customer accounts.</Notice>
            )}
            {status.email_used && <Notice tone="neutral" title="Reward already earned">The free month was already earned with this email address on another account. You can still track your progress here.</Notice>}

            <section aria-labelledby="trainings-h">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="trainings-h" className="text-lg font-bold">1. Complete {CHALLENGE_TRAININGS} trainings</h2>
                <span className="text-sm text-muted">{Math.min(status.month.trainings_done, 4)}/{CHALLENGE_TRAININGS} in {monthLabel(status.month.month)}</span>
              </div>
              <p className="mt-1 text-sm text-ink-soft">A training counts when you mark every lesson in the course complete. Each course counts once, ever: courses finished in an earlier month don&apos;t carry over.</p>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2" data-testid="challenge-courses">
                {available.map((c) => {
                  const now = thisMonth.has(c.id);
                  const before = !now && completedIds.has(c.id);
                  return (
                    <li key={c.id}>
                      <Link href={`/academy/courses/${c.slug}`} className="flex items-start gap-3 rounded-xl border border-line bg-surface p-3 shadow-card hover:border-line-strong">
                        <CheckCircle2 className={now ? "mt-0.5 h-4 w-4 shrink-0 text-accent" : "mt-0.5 h-4 w-4 shrink-0 text-line-strong"} aria-hidden />
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold">{c.title}</span>
                          <span className="block text-xs text-muted">{c.lesson_count} lesson{c.lesson_count === 1 ? "" : "s"}{now ? " · Counted this month" : before ? " · Completed earlier (doesn't count again)" : ""}</span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              {available.length < CHALLENGE_TRAININGS + 2 && <p className="mt-2 text-xs text-muted">New courses are released every Monday in the <Link href="/academy/classroom" className="underline">Classroom</Link>.</p>}
            </section>

            <section aria-labelledby="quiz-h">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="quiz-h" className="text-lg font-bold">2. Pass one {CHALLENGE_QUESTIONS}-question quiz</h2>
                <span className="text-sm text-muted">{quizLabel[status.month.quiz_status]}{status.month.quiz_latest ? ` · latest ${status.month.quiz_latest.correct}/20 on ${shortDate(status.month.quiz_latest.finished_at)}` : ""}</span>
              </div>
              <p className="mt-1 mb-3 text-sm text-ink-soft">Pick any topic. You need {CHALLENGE_PASS} of {CHALLENGE_QUESTIONS} correct (80%). Answers are checked when you submit.</p>
              {status.month.quiz_status === "passed" && status.month.quiz_pass ? (
                <Card className="p-4"><p className="flex items-center gap-2 font-semibold"><CheckCircle2 className="h-5 w-5 text-accent" aria-hidden /> Passed with {status.month.quiz_pass.correct}/20 on {shortDate(status.month.quiz_pass.finished_at)}</p>
                  <p className="mt-1 text-sm text-ink-soft">Want more practice? The <Link href="/academy/study" className="underline">Study</Link> tab has flashcards and practice exams.</p></Card>
              ) : (
                <ChallengeQuiz topics={status.topics} resume={Boolean(status.month.open_attempt)} signedIn trainingsDone={status.month.trainings_done} />
              )}
            </section>

            <section aria-labelledby="history-h">
              <h2 id="history-h" className="text-lg font-bold">Your Academy history</h2>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Card className="p-3"><p className="text-xs text-muted">Trainings completed</p><p className="text-xl font-extrabold">{status.total_trainings}</p></Card>
                <Card className="p-3"><p className="text-xs text-muted">Course progress</p><p className="text-xl font-extrabold">{status.total_trainings}/{status.available_trainings}</p></Card>
                <Card className="p-3"><p className="text-xs text-muted">Quizzes passed</p><p className="text-xl font-extrabold">{status.quizzes_passed}</p></Card>
                <Card className="p-3"><p className="text-xs text-muted">This month</p><p className="text-xl font-extrabold">{status.month.trainings.length}</p></Card>
              </div>
              {status.history.length > 0 && (
                <ul className="mt-3 space-y-1 text-sm">{status.history.map((h) => <li key={h.month}>{monthLabel(h.month)}: {h.trainings} training{h.trainings === 1 ? "" : "s"} completed</li>)}</ul>
              )}
              {status.milestones.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-2" aria-label="Milestones">
                  {status.milestones.map((m) => <li key={m.badge}><Badge tone={m.badge.startsWith("challenge:") ? "accent" : "neutral"}><Award className="mr-1 inline h-3 w-3" aria-hidden />{m.label}</Badge></li>)}
                </ul>
              )}
            </section>
          </div>

          <aside className="space-y-4">
            <ChallengeCard status={status} showLink={false} />
            {!earned && <p className="text-sm text-muted">{daysLeftInMonth()} day{daysLeftInMonth() === 1 ? "" : "s"} left this month (months follow UTC).</p>}
            <Card className="p-4" data-testid="reward-history">
              <p className="font-semibold">Reward history</p>
              {status.reward ? (
                <ul className="mt-2 space-y-1 text-sm">
                  <li>{rewardHeadline(phase)}</li>
                  <li className="text-muted">Earned {shortDate(status.reward.qualified_at)} ({monthLabel(status.reward.month)})</li>
                  {status.reward.action === "comp_days" && status.reward.activates_at && <li className="text-muted">Individual Unlimited from {shortDate(status.reward.activates_at)} to {shortDate(status.reward.expires_at)}</li>}
                  {status.reward.action === "stripe_credit" && status.reward.status === "applied" && <li className="text-muted">{CHALLENGE_REWARD_VALUE} credit added to your next bill</li>}
                  {status.reward.status === "review" && <li className="text-muted">We&apos;re applying this to your plan by hand and will email you when it&apos;s done.</li>}
                </ul>
              ) : <p className="mt-1 text-sm text-muted">No reward yet.</p>}
            </Card>
          </aside>
        </div>
      )}

      <section id="terms" className="mt-10 max-w-3xl scroll-mt-20 text-sm text-ink-soft">
        <h2 className="text-base font-bold text-ink">Challenge terms</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Complete 4 different Academy courses (every lesson marked complete) and pass one {CHALLENGE_QUESTIONS}-question challenge quiz with at least {CHALLENGE_PASS} correct, all in the same calendar month (UTC), while signed in to your own account.</li>
          <li>The reward is one month of Built2Bid Individual Unlimited (valued at {CHALLENGE_REWARD_VALUE}). Limit one free month per account and per person, for life. You can keep taking part every month, but only one free month is ever given.</li>
          <li>Free accounts receive 30 days of Individual Unlimited, with no card and no charge. If you already pay monthly, the free month is applied as a credit toward a future monthly bill. Annual and Enterprise accounts are handled by our team, who will apply a fair equivalent where the billing system supports it.</li>
          <li>The free month does not include the Project Command Center add-on, Enterprise seats or any other paid add-on, and add-ons keep billing as usual. It has no cash value, can&apos;t be transferred, combined or exchanged, and is never paid out as a refund.</li>
          <li>Each course counts once: repeating a course, or courses finished in an earlier month, don&apos;t count again. Quizzes are graded on our servers. Up to 5 quiz tries a day.</li>
          <li>Staff, test, demo and practice accounts are not eligible. We may review, withhold or reverse a reward earned through automation, shared accounts or other abuse. Built2Bid may change or end the challenge for future months; a free month already earned is honored.</li>
        </ul>
      </section>
    </Container>
  );
}
