import type { Metadata } from "next";
import { Container, Notice } from "@/components/ui/misc";
import { site } from "@/lib/site";

export const metadata: Metadata = { title: "Privacy Policy", alternates: { canonical: "/privacy" } };

export default function Privacy() {
  return (
    <Container className="py-12">
      <div className="mx-auto max-w-2xl space-y-4 leading-relaxed text-ink-soft">
        <h1 className="text-4xl font-extrabold text-ink">Privacy Policy</h1>
        <Notice tone="warn" title="Draft for legal review">This is a working draft describing how the product currently handles data. It must be reviewed by counsel before public launch.</Notice>
        <h2 className="pt-2 text-xl font-bold text-ink">What we collect</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Account: your email address and sign-in records.</li>
          <li>Business profile: company details and logo you enter or import.</li>
          <li>Bids: estimates, customers, and proposals you create. Drafts made before signing in stay in your browser until you create an account.</li>
          <li>Billing: handled by Stripe. We store your subscription status, not your card number.</li>
          <li>Product analytics: page and feature events (for example, “trade selected”). We do not put bid contents, prices, or customer details in analytics.</li>
        </ul>
        <h2 className="pt-2 text-xl font-bold text-ink">How we use it</h2>
        <p>To run the service, generate your proposals, enforce plan limits, provide support, and keep the service secure. We do not sell your data. Your internal costs and margins are never shown on customer-facing proposals.</p>
        <h2 className="pt-2 text-xl font-bold text-ink">Marketing email</h2>
        <p>We only send product news if you opt in, separately from creating an account. You can opt out at any time in Account settings.</p>
        <h2 className="pt-2 text-xl font-bold text-ink">Website import</h2>
        <p>If you ask us to import branding from a website, we fetch that public page once, extract details for you to review, and record only the host name and outcome.</p>
        <h2 className="pt-2 text-xl font-bold text-ink">Your choices</h2>
        <p>You can export your data or delete your account from Account settings. Deleting your account removes your bids, customers, logos, and generated documents. To prevent repeat free-credit signups, we keep a one-way hash of your email address (not the address itself).</p>
        <h2 className="pt-2 text-xl font-bold text-ink">Service providers</h2>
        <p>Supabase (database, authentication, file storage), Stripe (payments), and our hosting provider process data on our behalf.</p>
        <h2 className="pt-2 text-xl font-bold text-ink">Contact</h2>
        <p>Questions: <a className="underline" href={`mailto:${site.supportEmail}`}>{site.supportEmail}</a></p>
      </div>
    </Container>
  );
}
