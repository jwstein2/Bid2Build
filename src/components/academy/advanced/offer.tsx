import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { PlanPicker } from "./plan-picker";
import { advancedState, displayStage, getSubject, loadMyAccess, myMemberships } from "@/lib/academy/advanced/server";
import { ADV_PLANS, pickerOptions, recommendedPlan, stagePrice, type AdvPlan } from "@/lib/academy/advanced/plans";

/**
 * The paid-access prompt for one subject: the three-option picker, or a plain "you're in" line for people who
 * already have the subject (All Access members never see upgrade prompts).
 */
export async function AdvancedOffer({ subject: slug, className }: { subject: string; className?: string }) {
  const [state, access, subject, stage] = await Promise.all([advancedState(), loadMyAccess(), getSubject(slug, { includeDraft: true }), displayStage()]);
  if (!subject) return null;
  const members = state.user ? await myMemberships(state.user.id) : [];
  const liveM = members.find((m) => ["active", "trialing", "past_due"].includes(m.status) && (!m.current_period_end || new Date(m.current_period_end) > new Date()) && m.mode === (state.mode ?? "test"));
  const partnerSubject = subject.recommended_next ? await getSubject(subject.recommended_next) : null;
  const partner = partnerSubject?.purchasable ? { slug: partnerSubject.slug, title: partnerSubject.title, reason: subject.recommend_reason } : null;
  const opts = pickerOptions({ ...access, plan: liveM?.plan ?? null, subjects: liveM && liveM.plan !== "all_access" ? [...new Set([...liveM.subjects, ...access.subjects])] : access.subjects }, slug, partner?.slug ?? null);
  if (opts.enter) {
    return (
      <p className={`flex items-center gap-2 rounded-xl border border-ok/30 bg-ok-tint px-4 py-3 text-sm font-semibold text-ok ${className ?? ""}`} data-testid="has-access">
        <CheckCircle2 className="h-4 w-4" aria-hidden /> {access.staff && !access.plan ? "Staff preview: every lesson is open to you." : "You have this subject. Every lesson is open."}
      </p>
    );
  }
  if (!subject.purchasable) {
    return <p className={`rounded-xl border border-line bg-paper px-4 py-3 text-sm text-ink-soft ${className ?? ""}`} data-testid="not-purchasable">{subject.title} isn&apos;t open for enrollment yet. Free preview lessons are available below.</p>;
  }
  const owned = liveM?.plan === "one_subject" ? liveM.subjects[0] : null;
  const ownedTitle = owned ? (await getSubject(owned, { includeDraft: true }))?.title ?? null : null;
  const prices = Object.fromEntries(ADV_PLANS.map((pl) => [pl, stagePrice(stage, pl)])) as Record<AdvPlan, number>;
  const enrollmentClosed = !opts.upgrade && state.settings && !state.settings.enrollment_open;
  return (
    <>
      {enrollmentClosed && <p className={`mb-3 rounded-xl border border-line bg-paper px-4 py-3 text-sm text-ink-soft ${className ?? ""}`}>New memberships are paused for a short while. Free preview lessons are still open.</p>}
      <PlanPicker subject={{ slug, title: subject.title }} partner={partner} plans={opts.plans} recommended={recommendedPlan(opts.plans)} prices={prices}
        signedIn={Boolean(state.user)} billing={state.billing && !enrollmentClosed} upgrade={opts.upgrade} currentPlan={liveM?.plan ?? null} ownedSubjectTitle={ownedTitle} className={className} />
      <p className="mt-2 text-xs text-muted">Already a member? <Link href="/academy/advanced/membership" className="underline">Manage your membership</Link>.</p>
    </>
  );
}
