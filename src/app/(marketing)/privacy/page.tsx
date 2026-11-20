import { isFinancialsEnabled } from "@/lib/env";
import type { Metadata } from "next";
import Link from "next/link";
import { AnalyticsOptOut } from "@/components/analytics/analytics-opt-out";
import { LegalPage, H2, UL, LEGAL_UPDATED } from "@/components/legal/legal-page";
import { site } from "@/lib/site";

export const metadata: Metadata = { title: "Privacy Policy", alternates: { canonical: "/privacy" } };

/**
 * Privacy Policy. The 2026-11-19 revision (legal review) brings it in line with what the product does:
 * every service provider, e-signature records, team/HR records, sales prospects, the Academy, market data
 * sharing, ad measurement and account emails. Published 2026-11-19 (PR #175); independent legal review pending.
 * Review status is shown by LegalPage from src/lib/legal/registry.ts; don't add status wording here.
 */
export default function Privacy() {
  return (
    <LegalPage title="Privacy Policy" updated={LEGAL_UPDATED} docKey="privacy">
      <p>This policy explains what Built2Bid L.L.C. (&quot;{site.name}&quot;, &quot;we&quot;) collects, why, who we share it with and the choices you have. It covers built2bid.org, the {site.name} apps, signing and update links, and the Contractor Academy.</p>

      <H2>What we collect</H2>
      <UL>
        <li>Account: your name, email address, optional phone number and sign-in records.</li>
        <li>Business profile: company details and logo you enter or import.</li>
        <li>Your work: bids, customers, proposals, projects, schedules, photos, invoices and other records you create. Drafts made before signing in stay in your browser until you create an account.</li>
        <li>Billing: handled by Stripe. We store your subscription status, not your card number.</li>
        <li>Product analytics: page and feature events (for example, &quot;trade selected&quot;). We do not put bid contents, prices, or customer details in analytics.</li>
        <li id="analytics" className="scroll-mt-24">Website analytics: we use Google Analytics to understand how visitors find and use our website (pages viewed, approximate location, device and browser, and how you arrived). Google Analytics sets cookies to do this. It is not loaded on proposal signing links or sign-in links. You can turn it off for this browser here, or use Google&apos;s <a className="underline" href="https://tools.google.com/dlpage/gaoptout" rel="noopener noreferrer" target="_blank">browser add-on</a>, or block cookies.<AnalyticsOptOut /></li>
        <li>Ad measurement: only if you say yes in our ad banner, the Meta pixel measures which of our ads brought you to us. See the <Link className="underline" href="/cookies">cookie policy</Link>.</li>
        <li>Support and security: messages you send us, and logs of requests and errors (IP address, browser, time) that we use to keep the service working and secure.</li>
      </UL>

      <H2>How we use it</H2>
      <p>To run the service, generate your proposals, enforce plan limits, provide support, prevent abuse and keep the service secure. We do not sell your personal information, and we don&apos;t share it for cross-context behavioral advertising except the consented ad measurement described above. Your internal costs and margins are never shown on customer-facing proposals.</p>

      <H2>AI features</H2>
      <p>When you use an AI feature (such as an AI bid draft, proposal wording or a price library suggestion), the text you enter and the relevant parts of your bid are sent to our AI provider, Anthropic, to produce the result. Anthropic processes it for us and does not use it to train its models. You review every AI result before using it.</p>

      <H2>Email and text messages</H2>
      <p>We send account emails you can&apos;t opt out of while you have an account (sign-in codes, receipts, billing and security notices). We also send a short series of getting-started emails to new accounts, each with a one-click unsubscribe. Product news, offers and upgrade emails go only to people who opt in, separately from creating an account. You can opt out at any time in Account settings or from any email. If you add a phone number, we text it only one-time sign-in or confirmation codes; message and data rates may apply.</p>

      <H2>Your customers&apos; information</H2>
      <p>When you use {site.name} for your customers (proposals, signing links, project updates, follow-up emails, invoices), we process their names, contact details and project details on your behalf, only to provide those features. We keep a record of each email, delivery result, reply and opt-out so unsubscribes are always honored. Recipients can unsubscribe from any follow-up with one click, and we never sell or reuse this information for our own marketing.</p>

      <H2>Electronic signatures</H2>
      <p>When someone opens, downloads or signs a proposal through a signing link, we record the time, IP address and browser, and for a signature the signer&apos;s name, email, signature, the consent and acceptance wording and a fingerprint of the document. These records belong to the contractor&apos;s account and are kept with it as evidence of the signature; signed proposals can&apos;t be edited or deleted by the contractor. See the <Link className="underline" href="/esign-disclosure">electronic signature disclosure</Link>.</p>

      <H2>Team, employee and subcontractor records</H2>
      <p>Contractors can keep records about their team and subcontractors, such as contact details, W-9s, insurance certificates, time records and HR files. Social Security and taxpayer numbers are encrypted before they are stored, only the last four digits are shown, and every view is logged. If an employee chooses to include their location when clocking in or out, it is saved only at that moment and cleared after 90 days. We process these records on the contractor&apos;s behalf; questions about them should go to that contractor.</p>

      <H2>Market data sharing (optional)</H2>
      <p>If you turn it on in Settings, de-identified line items from your finalized proposals are used in aggregate pricing statistics. No customer or business names, contact details or addresses are included, statistics need at least 20 businesses, and turning sharing off removes what you contributed.</p>

      <H2>Contractor Academy</H2>
      <p>If you join the Academy, your display name, profile, posts, comments, points and recent activity are visible to other members as your privacy settings allow. Posts in public areas can be seen by anyone.</p>

      <H2>Business contact information we collect for sales</H2>
      <p>We research contractor businesses that might benefit from {site.name} using public sources, such as state contractor license records and business websites, and keep the business name, owner name, business email and phone, trade and the source of each fact. We use it only to contact the business about {site.name}. To stop contact, reply to any message or email <a className="underline" href="mailto:privacy@built2bid.org">privacy@built2bid.org</a>; we keep your details on a do-not-contact list so you aren&apos;t contacted again.</p>

      <H2>Website import</H2>
      <p>If you ask us to import branding from a website, we fetch that public page once, extract details for you to review, and record only the host name and outcome.</p>

      <H2>Connected bank accounts</H2>
      <p>Connecting a bank is optional. It happens only after you click Connect Business Bank Account and approve Plaid&apos;s consent screen. Plaid gives us read-only access to balances and transactions. We use that data only to show your balances and transactions, forecast cash, and match bank activity to your jobs and invoices. It is never sold, never shared for advertising, and never used to move money. We never see your bank sign-in. You can disconnect a bank at any time; we then remove the Plaid connection and stop all updates. Reconciled bank lines are kept with your bookkeeping records as described below. Plaid&apos;s handling of your data is described in the <a className="underline" href="https://plaid.com/legal/#end-user-privacy-policy" rel="noopener noreferrer" target="_blank">Plaid End User Privacy Policy</a>.</p>

      <H2>Your choices</H2>
      <p>You can export your data or delete your account from Account settings. Deleting your account removes your bids, customers, logos, signature records and generated documents. To prevent repeat free-credit signups, we keep a one-way hash of your email address (not the address itself).</p>
      {isFinancialsEnabled() && <p>If you used Financials to issue invoices, record payments or track job costs, we keep those financial records read-only for 7 years after your last financial activity, because tax and business-record rules require them. In that case deleting your account closes it instead: you can&apos;t sign in, your subscription is canceled, and the records are deleted when the 7 years end. You can ask for a copy at any time.</p>}

      <H2>How long we keep data</H2>
      <p>Account data is deleted when you delete your account, unless a legal hold applies. Bookkeeping records (invoices, payments and reconciled bank lines) are kept for 7 years for tax and audit needs, then deleted. Time-clock locations are cleared after 90 days. Contributed market data is removed after 10 years or when you stop sharing. Sales prospect records are reviewed and removed when no longer useful, except the do-not-contact list. Backups roll off on our database provider&apos;s schedule. We review these rules against privacy laws at least once a year.</p>

      <H2>Your privacy rights</H2>
      <p>Depending on where you live (for example California, Minnesota and other states with privacy laws), you may have the right to know what personal information we have, get a copy, correct it, delete it, and opt out of targeted advertising or &quot;sharing&quot;. We honor Global Privacy Control signals as an opt-out of ad measurement. We won&apos;t treat you differently for using these rights. To make a request, email <a className="underline" href="mailto:privacy@built2bid.org">privacy@built2bid.org</a>; we may need to confirm your identity, and an authorized agent may ask for you. We complete requests within 30 days, or tell you if we need more time as the law allows. If we deny a request, you can appeal by replying to our answer. If your information is in a contractor&apos;s account (for example as their customer or employee), we will pass your request to that contractor.</p>

      <H2>Service providers</H2>
      <p>These companies process data on our behalf, under contracts that limit how they can use it:</p>
      <UL>
        <li>Supabase: database, sign-in and file storage</li>
        <li>Netlify: hosting and scheduled jobs</li>
        <li>Stripe: payments, billing and sales tax</li>
        <li>Resend: email delivery</li>
        <li>Anthropic: AI features</li>
        <li>Sentry: error monitoring</li>
        <li>Google: website analytics (Google Analytics), company email (Google Workspace) and, when used, address autofill (Google Maps)</li>
        <li>Meta: ad measurement, only with your consent</li>
        <li>Plaid: optional, read-only bank connections</li>
        <li>Twilio: text message codes, if you sign in by phone</li>
        <li>YouTube: embedded training videos (loaded only when you press play)</li>
        <li>U.S. Census Bureau geocoder: matching job addresses to tax jurisdictions</li>
      </UL>
      <p>We may also disclose information if the law requires it, to protect people or the service, or as part of a sale or merger of our business. See <Link className="underline" href="/security">Security</Link> for how we protect your data.</p>

      <H2>Children</H2>
      <p>{site.name} is for adults working in a trade. We don&apos;t knowingly collect information from children under 16.</p>

      <H2>Where data is stored</H2>
      <p>We and our providers store and process data in the United States.</p>

      <H2>Changes</H2>
      <p>We will post changes here and update the date above. For material changes we will also notify account holders by email or in the app.</p>

      <H2>Contact</H2>
      <p>Built2Bid L.L.C., Minnesota · Privacy questions: <a className="underline" href="mailto:privacy@built2bid.org">privacy@built2bid.org</a> · Support: <a className="underline" href={`mailto:${site.supportEmail}`}>{site.supportEmail}</a></p>
    </LegalPage>
  );
}
