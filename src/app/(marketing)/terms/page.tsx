import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { LegalPage, H2, UL, LEGAL_UPDATED } from "@/components/legal/legal-page";
import { plans, site } from "@/lib/site";

const L = ({ href, children }: { href: string; children: ReactNode }) => <Link className="underline" href={href}>{children}</Link>;

export const metadata: Metadata = { title: "Terms of Service", alternates: { canonical: "/terms" } };

/**
 * Terms of Service. The 2026-11-19 revision (legal review) adds liability, disputes, e-signature, AI,
 * Team, auto-renewal and records sections. Draft for the owner's attorney: do not merge or publish until
 * the owner approves (see /mnt/project-files/legal-review/).
 */
export default function Terms() {
  return (
    <LegalPage title="Terms of Service" updated={LEGAL_UPDATED}>
      <p>These terms are an agreement between you and Built2Bid L.L.C., a Minnesota limited liability company (&quot;{site.name}&quot;, &quot;we&quot;, &quot;us&quot;). They cover your use of built2bid.org and the {site.name} apps (the &quot;service&quot;). By creating an account or using the service, you agree to them. If you use the service for a company, you agree for that company and confirm you may do so. The service is for businesses and people working in a trade; you must be at least 18.</p>

      <H2>1. The service</H2>
      <p>{site.name} helps you build estimates and proposals, collect signatures, schedule and manage projects, keep business records and communicate with your customers. You are responsible for your prices, quantities, scope, taxes, licenses, and the terms you offer your customers. Calculators, price suggestions, tax rates and AI drafts are tools, not professional, legal, tax or engineering advice.</p>

      <H2>2. Accounts and Team workspaces</H2>
      <p>Keep your sign-in secure and tell us right away at <a className="underline" href={`mailto:${site.supportEmail}`}>{site.supportEmail}</a> if you think someone else has used it. You are responsible for activity under your account. On Team plans, the company that owns the workspace controls it: its owner and admins add and remove users, decide who can see what, and own the company&apos;s records. The company is responsible for its users following these terms, and a user&apos;s access ends when the company removes it.</p>

      <H2>3. Plans, billing and automatic renewal</H2>
      <p>The Free plan uses bid credits. One credit finalizes one new bid; editing, re-finalizing, or downloading a bid you already finalized does not use another credit. Each verified account receives {plans.starterCredits} one-time starter credits, which do not expire and are not replenished; starter credits are granted once per account and email address. Beginning in your second month, you also receive {plans.monthlyCredits} monthly credit per monthly cycle. Cycles start on your signup anniversary each month (or the last day of a shorter month), the monthly balance never exceeds {plans.monthlyCredits}, and an unused monthly credit expires when its cycle ends. A monthly credit is always used before a starter credit.</p>
      <p><strong>Paid plans renew automatically.</strong> Unlimited is {plans.monthlyPriceLabel} per month billed monthly, or {plans.annualPriceLabel} per year billed annually. Team, add-ons and extra seats are priced on the <L href="/pricing">pricing page</L>. Each plan renews at the end of its period, at the then-current price plus any sales tax, and is charged to your saved payment method until you cancel. We email a reminder before each annual renewal and at least 7 days before any renewal, and we give at least 30 days&apos; notice of a price increase. If a payment fails we will retry it and may suspend paid features until it is paid.</p>

      <H2>4. Cancellation, refunds and your data</H2>
      <p>There are no long-term contracts. You can cancel any paid plan or add-on at any time online from Settings, Billing, and your access continues until the end of the period you already paid for. Subscriptions are non-refundable: we do not give full or partial refunds or credits for a monthly or annual period that has started, including when you cancel, remove an add-on, or remove licensed users or editor seats partway through a period. Removing users, seats or add-ons lowers the price from your next invoice. If you switch between monthly and annual billing, the billing page shows any proration before you confirm. Where the law requires a refund, we will follow the law.</p>
      <p>You can export everything in your account at any time, on any plan, including after you cancel: download a complete copy of your data from Settings, Account, Download my data.</p>

      <H2>5. Free plans, trials, gifts and programs</H2>
      <p>Free plans, trials, complimentary access, gift links and rewards have no cash value, can&apos;t be transferred or resold, and may be changed or ended at any time; your bids and records stay in your account when they end. The <L href="/referral-terms">referral program terms</L> and <L href="/trial-terms">free trial terms</L> also apply when you use those programs.</p>

      <H2>6. Your content</H2>
      <p>You own your bids, customer lists and business information (&quot;your content&quot;). You give us permission to host, copy, process and display your content only to provide, secure and support the service for you, and as described in our <L href="/privacy">Privacy Policy</L>. We use your content in aggregate market statistics only if you turn on market data sharing in Settings. Only upload logos, photos and content you have the right to use. Financial records you issue are kept read-only for 7 years as described in the Privacy Policy.</p>

      <H2 id="esignatures">7. Electronic signatures</H2>
      <p>The service lets you send proposals for your customers to sign electronically. We provide the signing tool; the contract is between you and your customer, and we are not a party to it. You are responsible for:</p>
      <UL>
        <li>The contents of what you send, including anything your state or local law requires in a home improvement or construction contract (for example your license number, required notices, payment terms and warranty language).</li>
        <li>Giving any required notice of cancellation rights (such as the federal three-day cancellation rule for sales made at a customer&apos;s home) and any lien or preliminary notices, in the form the law requires.</li>
        <li>Not using electronic signatures for documents the law requires on paper or that are excluded from e-signature laws, such as wills, court papers, notices of utility shutoff, eviction or foreclosure, and product recall or safety notices.</li>
        <li>Deciding whether link-based signing is enough for your transaction, and keeping your own copies of signed documents.</li>
      </UL>
      <p>Each signer agrees to our <L href="/esign-disclosure">electronic signature disclosure</L> before signing. We record an audit trail and a fingerprint of each signed document, but we can&apos;t guarantee that a signature will be enforceable in every situation or confirm a signer&apos;s identity beyond possession of the private link.</p>

      <H2>8. Estimates, tax suggestions and AI features</H2>
      <p>Some features use automated tools and artificial intelligence (for example AI bid drafts, proposal wording and price library suggestions) and official rate files for sales tax. Outputs can be incomplete or wrong. Review every number and every word before you send or rely on it; you are responsible for what you send to customers, charge, collect and file. Content you enter into an AI feature is sent to our AI provider only to generate your result, and is not used to train its models. As between you and us, you own the outputs you choose to use.</p>

      <H2>9. Customer emails you send</H2>
      <p>If you use Project Command Center to send follow-ups or project updates to your customers, you are the sender and we send them on your behalf. You agree to email only people you have a real business relationship with or who asked you for a quote, never to upload purchased or scraped lists, to keep your business name and postal address accurate, and to follow the email laws that apply to you (such as CAN-SPAM and CASL). Every follow-up includes an unsubscribe link, and opt-outs, bounces and complaints are honored across your account. Nothing sends until someone on your team approves it unless you deliberately turn on automatic sending for a project. We may limit or pause sending to protect deliverability or recipients, and your account owner can turn customer emails off for your whole company at any time.</p>

      <H2>10. Employee, subcontractor and customer records</H2>
      <p>If you store information about your employees, subcontractors or customers (such as Social Security or taxpayer numbers, W-9s, certificates, time records, locations or contact details), you confirm you have a lawful reason and any notice or consent the law requires, and you control who on your team can see it. We process that information on your behalf to provide the service. Team customers can request our data processing terms at <a className="underline" href="mailto:privacy@built2bid.org">privacy@built2bid.org</a>.</p>

      <H2>11. Acceptable use</H2>
      <p>Do not:</p>
      <UL>
        <li>Break the law, infringe anyone&apos;s rights, or send deceptive, harassing or unsolicited messages through the service.</li>
        <li>Try to access other accounts or data, probe or break our security, or get around plan limits or rate limits.</li>
        <li>Copy, resell, scrape or reverse engineer the service, or use it to build a competing product.</li>
        <li>Upload malware or content you don&apos;t have the right to use, or use the website importer on sites you are not authorized to represent.</li>
        <li>Create accounts to collect extra free credits, referral rewards or trials.</li>
      </UL>

      <H2>12. Academy and community</H2>
      <p>The Contractor Academy and its community are covered by the <L href="/academy-terms">Academy terms and community rules</L>.</p>

      <H2>13. Third-party services</H2>
      <p>Payments are processed by Stripe, bank connections by Plaid, and some features use other providers listed in our Privacy Policy. Their own terms apply to their services. Links to other sites and embedded videos are provided for convenience; we are not responsible for them.</p>

      <H2>14. Our service and feedback</H2>
      <p>We own the service, its software, design and content (other than your content). We give you a limited, non-transferable right to use it under these terms while your account is active. If you send us ideas or feedback, we may use them without owing you anything.</p>

      <H2>15. Suspension and termination</H2>
      <p>You can stop using the service and delete your account at any time. We may suspend or end access to protect the service, other users or the public, for non-payment, or if you seriously or repeatedly break these terms. Where reasonable we will tell you first and let you export your data. Sections 6 and 14 through 20 continue after your account ends.</p>

      <H2>16. Disclaimers</H2>
      <p>We work hard to keep the service accurate and available, but it is provided &quot;as is&quot; and &quot;as available&quot;. To the extent the law allows, we disclaim all warranties, express or implied, including merchantability, fitness for a particular purpose, title and non-infringement, and we don&apos;t promise the service will be uninterrupted or error-free, or that any calculation, rate, AI output or signature will be correct, complete or enforceable.</p>

      <H2>17. Limitation of liability</H2>
      <p>To the extent the law allows: (a) neither party is liable for indirect, incidental, special, consequential or punitive damages, or for lost profits, revenue, jobs or data; and (b) our total liability for all claims about the service is limited to the greater of the amount you paid us in the 12 months before the event giving rise to the claim, or $100. These limits do not apply to liability that can&apos;t be limited by law, such as for fraud, gross negligence or willful misconduct.</p>

      <H2>18. Indemnity</H2>
      <p>If you use the service for a business, you will defend and pay for claims against us brought by third parties (including your customers, employees and subcontractors) that arise from your content, your contracts and messages, or your breach of these terms or the law, including reasonable attorney&apos;s fees.</p>

      <H2>19. Disputes and governing law</H2>
      <p>Minnesota law governs these terms, without regard to conflict-of-law rules. Before filing a claim, each party will try to resolve the dispute informally by writing to the other (for us, <a className="underline" href={`mailto:${site.supportEmail}`}>{site.supportEmail}</a>) and allowing 30 days. After that, any claim must be brought in the state or federal courts located in Minnesota, and both parties consent to their jurisdiction, except that either party may bring an individual claim in small claims court. Claims must be brought within one year after they arise, where the law allows.</p>

      <H2>20. Changes and general terms</H2>
      <p>We may update these terms. For material changes we will give at least 30 days&apos; notice by email or in the app before they take effect; continuing to use the service after that means you accept them. These terms, the pages they link to and any order form are the whole agreement between us. If a part is unenforceable, the rest still applies. Not enforcing a part is not a waiver. You may not transfer these terms without our consent; we may transfer them with our business. Neither party is responsible for delays caused by events beyond its reasonable control.</p>

      <H2>Contact</H2>
      <p>Built2Bid L.L.C., Minnesota · <a className="underline" href={`mailto:${site.supportEmail}`}>{site.supportEmail}</a></p>
    </LegalPage>
  );
}
