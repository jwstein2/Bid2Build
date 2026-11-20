import type { Metadata } from "next";
import { LegalPage, H2, UL, A, LEGAL_UPDATED } from "@/components/legal/legal-page";
import { site } from "@/lib/site";
import { REFERRAL_NEW_ACCOUNT_DAYS, REFERRAL_REWARD_DAYS } from "@/lib/growth/referral";

export const metadata: Metadata = { title: "Referral Program Terms", alternates: { canonical: "/referral-terms" } };

/** Mirrors the rules enforced in supabase/migrations/20261115003000_referrals.sql. Keep them in step. */
export default function ReferralTerms() {
  return (
    <LegalPage title="Referral Program Terms" updated={LEGAL_UPDATED} docKey="referral-terms">
      <p>&quot;Refer a contractor, get a month free&quot; is run by Built2Bid L.L.C. These terms add to our <A href="/terms">Terms of Service</A>.</p>
      <H2>How it works</H2>
      <UL>
        <li>Share your personal referral link from your dashboard.</li>
        <li>A referral counts when someone visits through your link and creates a new {site.name} account within 90 days of that visit.</li>
        <li>When that account pays its first paid invoice, you earn one free month:
          <UL>
            <li>if you have an active, renewing paid plan, a credit worth one month of your plan on your next bill; or</li>
            <li>otherwise, {REFERRAL_REWARD_DAYS} days of complimentary Unlimited, starting when any paid period you have ends.</li>
          </UL>
        </li>
      </UL>
      <H2>Who qualifies</H2>
      <UL>
        <li>The referred account must be brand new (created within {REFERRAL_NEW_ACCOUNT_DAYS} days of the referral) and must never have had a paid subscription.</li>
        <li>You can&apos;t refer yourself, including through another email address you control.</li>
        <li>Internal, test and demo accounts don&apos;t earn or count.</li>
        <li>Each referred account earns one reward, once.</li>
        <li>You can earn up to 12 rewards in any 365 days.</li>
      </UL>
      <H2>Other terms</H2>
      <UL>
        <li>Rewards have no cash value, can&apos;t be transferred, and are not paid out if your account is closed. Credits apply only to future {site.name} invoices.</li>
        <li>Don&apos;t send spam or post your link where the rules don&apos;t allow it. Be honest about your relationship with {site.name} when you recommend it.</li>
        <li>We may withhold or reverse rewards for fraud, abuse or a breach of these terms, and may change or end the program at any time; rewards already earned are honored.</li>
        <li>You are responsible for any taxes on rewards.</li>
      </UL>
      <p>Questions: <A href={`mailto:${site.supportEmail}`}>{site.supportEmail}</A></p>
    </LegalPage>
  );
}
