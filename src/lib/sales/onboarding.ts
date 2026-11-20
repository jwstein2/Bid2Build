/**
 * Rep onboarding checklist on My Sales Hub (V8.9). Every step is worked out from records the hub already
 * reads, so it stays correct on every visit and device (not just the first one). Nothing here blocks the
 * hub: every section stays open while steps are unfinished.
 */
export interface OnboardingInput {
  /** Link visits so far (the referral link has been shared and used). */
  visits: number;
  /** Sales Academy: every topic passed. Null when the Academy isn't available. */
  certified: boolean | null;
  /** Preferences survey state; null when that feature isn't on. */
  prefsStatus: string | null;
  /** Calls + follow-ups + meetings logged, all time. */
  touches: number;
  /** Paid accounts from the rep's link, all time. */
  paidAccounts: number;
}

export interface OnboardingStep { id: string; label: string; detail: string; href: string; done: boolean }

export function onboardingSteps(i: OnboardingInput): OnboardingStep[] {
  const steps: (OnboardingStep | null)[] = [
    { id: "joined", label: "Join the sales team", detail: "Your account is linked to your Sales Hub.", href: "/sales", done: true },
    { id: "pay", label: "Learn how you get paid", detail: "Commissions, the 30-day hold and milestone boxes.", href: "/sales/how-you-get-paid", done: i.paidAccounts > 0 || i.certified === true },
    i.certified === null ? null : { id: "academy", label: "Get certified in Sales Academy", detail: "Short lessons and quizzes. Passing them certifies you to sell.", href: "/sales/academy", done: i.certified },
    i.prefsStatus === null ? null : { id: "prefs", label: "Set your preferences", detail: "Optional. How we celebrate wins with you.", href: "/sales/preferences", done: i.prefsStatus !== "not_started" },
    { id: "share", label: "Share your referral link", detail: "Done when someone first visits through it.", href: "#referral-link", done: i.visits > 0 },
    { id: "lead", label: "Work your first lead", detail: "Log a call, follow-up or meeting on a lead.", href: "/sales/leads", done: i.touches > 0 },
  ];
  return steps.filter((s): s is OnboardingStep => s !== null);
}

export const onboardingComplete = (steps: OnboardingStep[]) => steps.every((s) => s.done);
