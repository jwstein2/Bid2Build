import { isFinancialsEnabled } from "@/lib/env";
import type { Metadata } from "next";
import { Container } from "@/components/ui/misc";
import Link from "next/link";
import { site } from "@/lib/site";

export const metadata: Metadata = { title: "Privacy Policy", alternates: { canonical: "/privacy" } };

export default function Privacy() {
  return (
    <Container className="py-12">
      <div className="mx-auto max-w-2xl space-y-4 leading-relaxed text-ink-soft">
        <h1 className="text-4xl font-extrabold text-ink">Privacy Policy</h1>
        <h2 className="pt-2 text-xl font-bold text-ink">What we collect</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Account: your email address and sign-in records.</li>
          <li>Business profile: company details and logo you enter or import.</li>
          <li>Bids: estimates, customers, and proposals you create. Drafts made before signing in stay in your browser until you create an account.</li>
          <li>Billing: handled by Stripe. We store your subscription status, not your card number.</li>
          <li>Product analytics: page and feature events (for example, “trade selected”). We do not put bid contents, prices, or customer details in analytics.</li>
          <li>Website analytics: we use Google Analytics to understand how visitors find and use our website (pages viewed, approximate location, device and browser, and how you arrived). Google Analytics sets cookies to do this. It is not loaded on proposal signing links or sign-in links. You can opt out with Google’s <a className="underline" href="https://tools.google.com/dlpage/gaoptout" rel="noopener noreferrer" target="_blank">browser add-on</a> or by blocking cookies.</li>
        </ul>
        <h2 className="pt-2 text-xl font-bold text-ink">How we use it</h2>
        <p>To run the service, generate your proposals, enforce plan limits, provide support, and keep the service secure. We do not sell your data. Your internal costs and margins are never shown on customer-facing proposals.</p>
        <h2 className="pt-2 text-xl font-bold text-ink">Marketing email</h2>
        <p>We only send product news if you opt in, separately from creating an account. You can opt out at any time in Account settings.</p>
        <h2 className="pt-2 text-xl font-bold text-ink">Your customers&apos; information</h2>
        <p>When a contractor uses {site.name} to email their customers (follow-ups and project updates), we process those customers&apos; names, email addresses and project details on the contractor&apos;s behalf, only to send the emails they approve. We keep a record of each email, delivery result, reply and opt-out so unsubscribes are always honored. Recipients can unsubscribe from any follow-up with one click, and we never sell or reuse this information for our own marketing.</p>
        <h2 className="pt-2 text-xl font-bold text-ink">Website import</h2>
        <p>If you ask us to import branding from a website, we fetch that public page once, extract details for you to review, and record only the host name and outcome.</p>
        <h2 className="pt-2 text-xl font-bold text-ink">Your choices</h2>
        <p>You can export your data or delete your account from Account settings. Deleting your account removes your bids, customers, logos, and generated documents. To prevent repeat free-credit signups, we keep a one-way hash of your email address (not the address itself).</p>
        {isFinancialsEnabled() && <p>If you used Financials to issue invoices, record payments or track job costs, we keep those financial records read-only for 7 years after your last financial activity, because tax and business-record rules require them. In that case deleting your account closes it instead: you can&apos;t sign in, your subscription is canceled, and the records are deleted when the 7 years end. You can ask for a copy at any time.</p>}
        <h2 className="pt-2 text-xl font-bold text-ink">Connected bank accounts</h2>
        <p>Connecting a bank is optional. It happens only after you click Connect Business Bank Account and approve Plaid&apos;s consent screen. Plaid gives us read-only access to balances and transactions. We use that data only to show your balances and transactions, forecast cash, and match bank activity to your jobs and invoices. It is never sold, never shared for advertising, and never used to move money. We never see your bank sign-in. You can disconnect a bank at any time; we then remove the Plaid connection and stop all updates. Reconciled bank lines are kept with your bookkeeping records as described below.</p>
        <h2 className="pt-2 text-xl font-bold text-ink">How long we keep data</h2>
        <p>Account data is deleted when you delete your account, unless a legal hold applies. Bookkeeping records (invoices, payments and reconciled bank lines) are kept for 7 years for tax and audit needs, then deleted. Backups roll off on our database provider&apos;s schedule. We review these rules against privacy laws, such as the CCPA, at least once a year.</p>
        <h2 className="pt-2 text-xl font-bold text-ink">Privacy requests</h2>
        <p>You can also ask us to export or delete your data by emailing <a className="underline" href="mailto:privacy@built2bid.org">privacy@built2bid.org</a>. We complete requests within 30 days.</p>
        <h2 className="pt-2 text-xl font-bold text-ink">Service providers</h2>
        <p>Supabase (database, authentication, file storage), Stripe (payments), Resend (email delivery), Google Analytics (website analytics), and our hosting provider process data on our behalf. Plaid (optional, read-only bank connections) also processes data if you connect a bank. See <Link className="underline" href="/security">Security</Link> for how we protect your data.</p>
        <h2 className="pt-2 text-xl font-bold text-ink">Contact</h2>
        <p>Questions: <a className="underline" href={`mailto:${site.supportEmail}`}>{site.supportEmail}</a></p>
      </div>
    </Container>
  );
}
