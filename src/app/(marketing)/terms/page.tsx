import type { Metadata } from "next";
import { Container, Notice } from "@/components/ui/misc";
import { plans, site } from "@/lib/site";

export const metadata: Metadata = { title: "Terms of Service", alternates: { canonical: "/terms" } };

export default function Terms() {
  return (
    <Container className="py-12">
      <div className="mx-auto max-w-2xl space-y-4 leading-relaxed text-ink-soft">
        <h1 className="text-4xl font-extrabold text-ink">Terms of Service</h1>
        <Notice tone="warn" title="Draft for legal review">Placeholder terms. They must be replaced or approved by counsel before public launch.</Notice>
        <h2 className="pt-2 text-xl font-bold text-ink">The service</h2>
        <p>{site.name} helps you build estimates and proposals. You are responsible for your prices, quantities, scope, taxes, and the terms you offer your customers. Calculations are tools, not professional, legal, or tax advice.</p>
        <h2 className="pt-2 text-xl font-bold text-ink">Plans</h2>
        <p>The Free plan includes {plans.freeMonthlyExports} finalized proposal exports per calendar month, resetting at 00:00 UTC on the first day of each month. Downloading an unchanged proposal again does not use another export. Unlimited plans ({plans.monthlyPriceLabel}/month or {plans.annualPriceLabel}/year) renew automatically until cancelled; cancellation takes effect at the end of the paid period.</p>
        <h2 className="pt-2 text-xl font-bold text-ink">Your content</h2>
        <p>You own your bids and business information. You give us permission to store and process it only to provide the service. Only upload logos and content you have the right to use.</p>
        <h2 className="pt-2 text-xl font-bold text-ink">Acceptable use</h2>
        <p>Do not misuse the service, attempt to access other accounts, or use the website importer on sites you are not authorized to represent.</p>
        <h2 className="pt-2 text-xl font-bold text-ink">Contact</h2>
        <p><a className="underline" href={`mailto:${site.supportEmail}`}>{site.supportEmail}</a></p>
      </div>
    </Container>
  );
}
