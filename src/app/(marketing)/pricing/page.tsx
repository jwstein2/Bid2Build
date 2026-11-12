import type { Metadata } from "next";
import { Check, Minus } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Container, Notice } from "@/components/ui/misc";
import { CheckoutButton } from "@/components/billing/checkout-button";
import { getUser } from "@/lib/supabase/server";
import { plans } from "@/lib/site";

export const metadata: Metadata = {
  title: "Pricing",
  description: `Free: ${plans.freeMonthlyExports} finalized bids per month. Unlimited: ${plans.monthlyPriceLabel}/month or ${plans.annualPriceLabel}/year.`,
  alternates: { canonical: "/pricing" },
};

const rows: [string, boolean | string, boolean | string][] = [
  ["Finalized PDF exports", `${plans.freeMonthlyExports} per month`, "Unlimited"],
  ["Draft editing and previews", "Unlimited", "Unlimited"],
  ["Every trade category", true, true],
  ["Markup, margin, tax, and profit tools", true, true],
  ["Editable branding and logo", true, true],
  ["Customer visibility modes", true, true],
  ["Saved business settings and customers", true, true],
  ["Reusable proposal templates", false, true],
  ["Full proposal customization", "Core options", true],
  ["Archived bids", "Unlimited", "Unlimited*"],
];

export default async function PricingPage({ searchParams }: PageProps<"/pricing">) {
  const sp = await searchParams;
  const user = await getUser();
  return (
    <Container className="py-14">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-4xl font-extrabold">Simple pricing for every contractor</h1>
        <p className="mt-3 text-lg text-ink-soft">Start free. Upgrade only when you are bidding more than {plans.freeMonthlyExports} jobs a month. Both paid plans include exactly the same features.</p>
      </div>
      {sp.checkout === "cancelled" && <Notice tone="neutral" className="mx-auto mt-6 max-w-xl">Checkout was cancelled. You have not been charged.</Notice>}
      <div className="mx-auto mt-10 grid max-w-5xl gap-5 md:grid-cols-3">
        <Plan name="Free" price="$0" period="forever" blurb="For occasional bids." features={[`${plans.freeMonthlyExports} finalized bid exports every month`, "Unlimited drafts and previews", "Every trade", "Branding and PDF exports", "No credit card required"]}>
          <ButtonLink href="/bids" variant="secondary" size="lg" className="w-full">Start Your Bid</ButtonLink>
        </Plan>
        <Plan name="Unlimited Monthly" price={plans.monthlyPriceLabel} period="per month" blurb="Flexible, cancel anytime." features={["Unlimited bid exports", "Everything in Free", "Reusable templates", "Full proposal customization"]}>
          <CheckoutButton plan="monthly" signedIn={Boolean(user)} label="Choose Monthly" variant="primary" />
        </Plan>
        <Plan name="Unlimited Annual" price={plans.annualPriceLabel} period="per year" blurb={`Just ${plans.annualMonthlyEquivalent}/month, save 38%.`} highlight features={["Unlimited bid exports", "Everything in Free", "Reusable templates", "Full proposal customization", "Billed once a year"]}>
          <CheckoutButton plan="annual" signedIn={Boolean(user)} label="Choose Annual" />
        </Plan>
      </div>

      <div className="mx-auto mt-14 max-w-3xl overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full text-sm">
          <caption className="sr-only">Plan comparison</caption>
          <thead><tr className="border-b border-line text-left"><th className="p-3">Feature</th><th className="p-3">Free</th><th className="p-3">Unlimited (monthly or annual)</th></tr></thead>
          <tbody>
            {rows.map(([f, a, b]) => (
              <tr key={f} className="border-b border-line last:border-0">
                <td className="p-3 font-medium">{f}</td>
                {[a, b].map((v, i) => <td key={i} className="p-3">{v === true ? <Check className="h-4 w-4 text-ok" aria-label="Included" /> : v === false ? <Minus className="h-4 w-4 text-muted" aria-label="Not included" /> : v}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mx-auto mt-8 max-w-3xl space-y-3 text-sm text-ink-soft">
        <p><b>What counts as a bid?</b> One credit is used the first time a new finalized proposal version is exported. Re-downloading the same version is free. Editing drafts and previewing never use credits.</p>
        <p><b>When does my free allowance reset?</b> At 00:00 UTC on the first day of each month.</p>
        <p>*Unlimited archived bids are subject to reasonable storage and fair-use policies. Prices in USD; applicable taxes may be added at checkout.</p>
      </div>
    </Container>
  );
}

function Plan({ name, price, period, blurb, features, highlight, children }: { name: string; price: string; period: string; blurb: string; features: string[]; highlight?: boolean; children: React.ReactNode }) {
  return (
    <div className={`relative flex flex-col rounded-2xl border bg-surface p-6 ${highlight ? "border-accent shadow-lg ring-2 ring-accent/30" : "border-line"}`}>
      {highlight && <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-accent px-3 py-1 text-xs font-bold text-white">Recommended</span>}
      <h2 className="font-display text-lg font-bold">{name}</h2>
      <p className="mt-3"><span className="font-display text-4xl font-extrabold">{price}</span> <span className="text-muted">{period}</span></p>
      <p className="mt-1 text-sm text-muted">{blurb}</p>
      <ul className="mt-5 flex-1 space-y-2 text-sm">{features.map((f) => <li key={f} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden />{f}</li>)}</ul>
      <div className="mt-6">{children}</div>
    </div>
  );
}
