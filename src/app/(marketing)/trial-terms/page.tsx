import type { Metadata } from "next";
import { LegalPage, H2, UL, A, LEGAL_UPDATED } from "@/components/legal/legal-page";
import { site } from "@/lib/site";
import { TRIAL_DAYS } from "@/lib/trial/config";

export const metadata: Metadata = { title: "Free Trial and Pass Terms", alternates: { canonical: "/trial-terms" } };

export default function TrialTerms() {
  return (
    <LegalPage title="Free Trial, Pass and Gift Terms" updated={LEGAL_UPDATED}>
      <p>These terms cover free trials and passes (such as the {TRIAL_DAYS}-day Unlimited pass from Facebook or the Bid Check), gift links, and complimentary access from Built2Bid L.L.C. They add to our <A href="/terms">Terms of Service</A>.</p>
      <H2>Trials and passes</H2>
      <UL>
        <li>One trial or pass per person and email address. It starts when you open your invite, sign in and tap Activate, and lasts the number of days shown in the invite.</li>
        <li>No card is needed and nothing is charged automatically. When it ends, your account returns to the Free plan unless you choose a paid plan.</li>
        <li>Your bids, customers and records stay in your account after it ends.</li>
        <li>If you agreed to check-in emails, we send at most the number we told you, each with an unsubscribe link. Reply STOP in Messenger to stop Messenger messages.</li>
      </UL>
      <H2>Gift links and complimentary access</H2>
      <UL>
        <li>A gift link or complimentary grant gives the plan and length shown when you claim it, to the verified email it was issued to.</li>
        <li>It may be paused, shortened or ended (for example when a partner program ends or for misuse). Paid plans you buy yourself are not affected.</li>
        <li>If you were gifted access through a creator partner, the creator can&apos;t see your account. They see only bids you choose to share for coaching, without your customers&apos; contact details, and you can stop sharing at any time.</li>
      </UL>
      <H2>For everyone</H2>
      <UL>
        <li>Trials, passes, gifts and complimentary access have no cash value and can&apos;t be transferred or resold.</li>
        <li>We may refuse or end them for fraud or abuse, including multiple accounts.</li>
        <li>We may change or end these offers at any time; anything already activated runs to its end unless it is being misused.</li>
      </UL>
      <p>Questions: <A href={`mailto:${site.supportEmail}`}>{site.supportEmail}</A></p>
    </LegalPage>
  );
}
