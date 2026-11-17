import type { Metadata } from "next";
import { Container } from "@/components/ui/misc";
import { plans, site } from "@/lib/site";

export const metadata: Metadata = { title: "Terms of Service", alternates: { canonical: "/terms" } };

export default function Terms() {
  return (
    <Container className="py-12">
      <div className="mx-auto max-w-2xl space-y-4 leading-relaxed text-ink-soft">
        <h1 className="text-4xl font-extrabold text-ink">Terms of Service</h1>
        <h2 className="pt-2 text-xl font-bold text-ink">The service</h2>
        <p>{site.name} helps you build estimates and proposals. You are responsible for your prices, quantities, scope, taxes, and the terms you offer your customers. Calculations are tools, not professional, legal, or tax advice.</p>
        <h2 className="pt-2 text-xl font-bold text-ink">Plans</h2>
        <p>The Free plan uses bid credits. One credit finalizes one new bid; editing, re-finalizing, or downloading a bid you already finalized does not use another credit. Each verified account receives {plans.starterCredits} one-time starter credits, which do not expire and are not replenished; starter credits are granted once per account and email address. Beginning in your second month, you also receive {plans.monthlyCredits} monthly credit per monthly cycle. Cycles start on your signup anniversary each month (or the last day of a shorter month), the monthly balance never exceeds {plans.monthlyCredits}, and an unused monthly credit expires when its cycle ends. A monthly credit is always used before a starter credit. Unlimited plans ({plans.monthlyPriceLabel}/month billed monthly, or {plans.annualPriceLabel}/year billed annually) renew automatically until cancelled; cancellation takes effect at the end of the paid period.</p>
        <h2 className="pt-2 text-xl font-bold text-ink">Cancellation, refunds and your data</h2>
        <p>There are no long-term contracts. You can cancel any paid plan or add-on at any time from your billing settings, and your access continues until the end of the period you already paid for. Subscriptions are non-refundable: we do not give full or partial refunds or credits for a monthly or annual period that has started, including when you cancel, remove an add-on, or remove licensed users or editor seats partway through a period. Removing users, seats or add-ons lowers the price from your next invoice. Where the law requires a refund, we will follow the law.</p>
        <p>You can export everything in your account at any time, on any plan, including after you cancel: download a complete copy of your data from Settings, Account, Download my data.</p>
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
