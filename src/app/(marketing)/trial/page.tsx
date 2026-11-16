import type { Metadata } from "next";
import { Container, Notice } from "@/components/ui/misc";
import { trialConfig, TRIAL_DAYS } from "@/lib/trial/config";
import { ClaimForm } from "./claim-form";

export const metadata: Metadata = {
  title: `${TRIAL_DAYS} free days of Unlimited`,
  description: `Get a Built2Bid invite for ${TRIAL_DAYS} free days of Unlimited bids. No card needed.`,
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

/**
 * Branded claim page for the Facebook "comment BID" campaign. Messenger (or ManyChat, without its
 * paid webhook feature) links here; the person enters an email and gets the same invite email as the
 * direct Messenger route.
 */
export default function TrialClaimPage() {
  const enabled = trialConfig().enabled;
  return (
    <Container className="max-w-md py-16">
      <h1 className="text-3xl font-extrabold">Get {TRIAL_DAYS} free days of Built2Bid Unlimited</h1>
      <p className="mt-2 text-ink-soft">
        Enter your email and we&apos;ll send you an invite. Your {TRIAL_DAYS} days start when you open it, sign in and tap Activate.
      </p>
      <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-ink-soft">
        <li>Unlimited bids, Saved Items &amp; Pricing, and Proposal Templates</li>
        <li>No card needed, and nothing is charged automatically</li>
        <li>When the week ends your bids and customers stay right where they are</li>
      </ul>
      {enabled ? <ClaimForm /> : <Notice tone="warn" className="mt-6">Invites are paused right now. Please check back soon.</Notice>}
    </Container>
  );
}
