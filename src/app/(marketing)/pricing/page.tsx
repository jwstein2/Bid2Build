import type { Metadata } from "next";
import { Check, Minus } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/misc";
import { CheckoutButton } from "@/components/billing/checkout-button";
import { CheckoutFlowProvider } from "@/components/billing/checkout-flow";
import { createClient, getUser } from "@/lib/supabase/server";
import { loadCreditStatus } from "@/lib/credits/server";
import { plans } from "@/lib/site";
import { ANNUAL, ANNUAL_MONTHLY_EQUIVALENT, ANNUAL_SAVINGS_PERCENT, MONTHLY } from "@/lib/billing/plans";

export const metadata: Metadata = {
  title: "Pricing",
  description: `Free: ${plans.starterCredits} bids to start, plus ${plans.monthlyCredits} free bid every month. Unlimited: ${MONTHLY.price}/month billed monthly, or ${ANNUAL.price}/year billed annually.`,
  alternates: { canonical: "/pricing" },
};

const rows: [string, boolean | string, boolean | string][] = [
  ["Finalized bids", `${plans.starterCredits} to start + ${plans.monthlyCredits} every month`, "Unlimited"],
  ["Updates and re-downloads of finalized bids", "Free", "Free"],
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

const UNLIMITED_FEATURES = ["Unlimited bid exports", "Everything in Free", "Reusable templates", "Full proposal customization"];

export default async function PricingPage() {
  const user = await getUser();
  const credits = user ? await loadCreditStatus(await createClient()) : null;
  const subscribed = Boolean(credits?.unlimited);
  const manage = <ButtonLink href="/settings/billing" variant="secondary" size="lg" className="w-full">Manage subscription</ButtonLink>;
  return (
    <Container className="py-14">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-4xl font-extrabold">Simple pricing for every contractor</h1>
        <p className="mt-3 text-lg text-ink-soft">Start with {plans.starterCredits} free bids, then get {plans.monthlyCredits} free bid every month. Upgrade when you are bidding regularly.</p>
      </div>
      <CheckoutFlowProvider signedIn={Boolean(user)} subscribed={subscribed} userEmail={user?.email ?? null}>
        <div className="mx-auto mt-10 grid max-w-5xl gap-5 md:grid-cols-3">
          <Plan name="Free" price="$0" per="forever" billing="No credit card required." features={[`${plans.starterCredits} starter bids that never expire`, `Plus ${plans.monthlyCredits} free bid every month`, "Unlimited drafts and previews", "Every trade", "Branding and PDF exports"]}>
            <ButtonLink href="/bids" variant="secondary" size="lg" className="w-full">Create a free bid</ButtonLink>
          </Plan>
          <Plan name={MONTHLY.name} price={MONTHLY.price} per="/month" billing="Billed monthly. Cancel anytime." features={UNLIMITED_FEATURES}>
            {subscribed ? manage : <CheckoutButton plan="monthly" signedIn={Boolean(user)} label="Choose Monthly" variant="primary" />}
          </Plan>
          <Plan name={ANNUAL.name} price={ANNUAL.price} per="/year" billing="Billed annually" highlight
            note={<>Equivalent to {ANNUAL_MONTHLY_EQUIVALENT}/month. Save approximately {ANNUAL_SAVINGS_PERCENT}% compared with monthly billing.</>}
            features={UNLIMITED_FEATURES}>
            {subscribed ? manage : <CheckoutButton plan="annual" signedIn={Boolean(user)} label="Choose Annual" />}
          </Plan>
        </div>
        <p className="mx-auto mt-5 max-w-2xl text-center text-sm text-ink-soft">Unlimited Monthly and Unlimited Annual include exactly the same features. Only the billing schedule is different.{subscribed && " You're on Unlimited."}</p>
      </CheckoutFlowProvider>

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
        <p><b>What counts as a bid?</b> One credit is used when you finalize a new bid. Editing, re-finalizing, or re-downloading a bid you already finalized is free, and drafts and previews never use credits.</p>
        <p><b>How do free credits work?</b> Every verified account gets {plans.starterCredits} starter credits that never expire. From your second month, you also get {plans.monthlyCredits} free monthly bid on your signup anniversary each month. Monthly credits don&apos;t roll over, and they&apos;re always used before starter credits.</p>
        <p>*Unlimited archived bids are subject to reasonable storage and fair-use policies. Prices in USD; applicable taxes may be added at checkout.</p>
      </div>
    </Container>
  );
}

function Plan({ name, price, per, billing, note, features, highlight, children }: { name: string; price: string; per: string; billing: string; note?: React.ReactNode; features: string[]; highlight?: boolean; children: React.ReactNode }) {
  return (
    <div className={`relative flex flex-col rounded-2xl border bg-surface p-6 ${highlight ? "border-accent shadow-lg ring-2 ring-accent/30" : "border-line"}`}>
      {highlight && <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-accent px-3 py-1 text-xs font-bold text-navy">Recommended</span>}
      <h2 className="font-display text-lg font-bold">{name}</h2>
      <p className="mt-3 whitespace-nowrap"><span className="font-display text-4xl font-extrabold">{price}</span><span className={`font-semibold text-muted ${per.startsWith("/") ? "" : "ml-1.5"}`}>{per}</span></p>
      <p className="mt-1 text-sm font-semibold text-ink">{billing}</p>
      {note && <p className="mt-1 text-sm text-ink-soft">{note}</p>}
      <ul className="mt-5 flex-1 space-y-2 text-sm">{features.map((f) => <li key={f} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden />{f}</li>)}</ul>
      <div className="mt-6">{children}</div>
    </div>
  );
}
