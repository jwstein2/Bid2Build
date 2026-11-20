import type { Metadata } from "next";
import { LegalPage, H2, UL, A } from "@/components/legal/legal-page";
import { PROGRAM } from "@/lib/affiliates/content";

export const metadata: Metadata = { title: "Affiliate Program Terms", alternates: { canonical: "/affiliates/terms" } };

/** Plain-language summary of the affiliate rules enforced in 20270210001000_affiliate_hub.sql. The signed agreement governs. */
export default function AffiliateTerms() {
  return (
    <LegalPage title="Affiliate Program Terms (summary)" updated="November 20, 2026">
      <p className="rounded-lg border border-line bg-warn-tint px-4 py-3 text-sm text-ink"><strong>Legal review pending.</strong> This summary and the full Affiliate Agreement are drafts awaiting attorney review and may change before final. Approved affiliates accept the full agreement during setup; if this summary and the agreement differ, the agreement controls.</p>
      <H2>Commissions</H2>
      <UL>
        <li>{PROGRAM.annual}</li>
        <li>Each commission equals one month of the referred customer&apos;s eligible subscription value: what they actually paid before tax, net of refunds and discounts, at the list value per month. Annual plans count as the annual price divided by 12.</li>
        <li>Year 1 is created by the customer&apos;s first paid subscription invoice. Each later year is created when the customer has a paid subscription covering that anniversary. At most 10 annual commissions per customer.</li>
        <li>The term starts at the first payment and never restarts after upgrades, billing changes, cancellation or reactivation. A missed anniversary isn&apos;t earned; a later one can still be.</li>
        <li>Each commission is held for 30 days, then re-checked and becomes payable. A refund or chargeback during the hold cancels or reduces it. Refunds after a payout are reviewed under the agreement.</li>
        <li>{PROGRAM.noGuarantee}</li>
      </UL>
      <H2>Attribution</H2>
      <UL>
        <li>A customer is attributed to you when they open your link and create a new Built2Bid account within 90 days. Existing accounts and existing customers don&apos;t count.</li>
        <li>One referrer per customer. If a Built2Bid sales representative was recorded first, that customer belongs to them. Disputes are reviewed by Built2Bid and the decision is recorded.</li>
        <li>No self-referrals, fake accounts, cookie stuffing, hidden links, incentivized sign-ups without approval, or paid ads on the Built2Bid name.</li>
      </UL>
      <H2>Promotion rules</H2>
      <UL>
        <li>Clearly disclose that you earn a commission, in the content itself and before the link (FTC Endorsement Guides).</li>
        <li>Only make truthful claims. No fake reviews or testimonials, no income or savings promises, and don&apos;t present yourself as Built2Bid staff.</li>
        <li>No spam: follow CAN-SPAM, TCPA and each platform&apos;s rules.</li>
      </UL>
      <H2>Payouts and taxes</H2>
      <UL>
        <li>Paid by ACH to a U.S. bank account connected through our payment provider. A W-9 is required. First release: U.S. affiliates only. Payable balances under $25 roll over.</li>
        <li>You&apos;re an independent contractor and responsible for your own taxes. We may issue a Form 1099 when required.</li>
      </UL>
      <H2>Ending the agreement</H2>
      <UL>
        <li>Either side may end the agreement. Commissions already earned are handled under the agreement. Whether future anniversaries continue after a termination without cause is set in the agreement (pending legal review); material misconduct can end future and unpaid commissions after review.</li>
      </UL>
      <p>Questions: <A href="mailto:partners@built2bid.org">partners@built2bid.org</A></p>
    </LegalPage>
  );
}
