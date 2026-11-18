import { isFinancialsEnabled } from "@/lib/env";
import type { Metadata } from "next";
import { Container } from "@/components/ui/misc";
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
        <h2 className="pt-2 text-xl font-bold text-ink">Service providers</h2>
        <p>Supabase (database, authentication, file storage), Stripe (payments), Resend (email delivery), Google Analytics (website analytics), and our hosting provider process data on our behalf.</p>
        <h2 className="pt-2 text-xl font-bold text-ink">Contact</h2>
        <p>Questions: <a className="underline" href={`mailto:${site.supportEmail}`}>{site.supportEmail}</a></p>
      </div>
    </Container>
  );
}
