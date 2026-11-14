import type { Metadata } from "next";
import { Check, Minus } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/misc";
import { CheckoutButton } from "@/components/billing/checkout-button";
import { CheckoutFlowProvider } from "@/components/billing/checkout-flow";
import { getAccountContext } from "@/lib/account/server";
import { CTA_LABELS, creditBadge, type AccountStatus } from "@/lib/account/status";
import { formatCycleDate } from "@/lib/credits/status";
import { plans } from "@/lib/site";
import { ANNUAL, ANNUAL_MONTHLY_EQUIVALENT, ANNUAL_SAVINGS_PERCENT, MONTHLY } from "@/lib/billing/plans";
import { Suspense } from "react";
import { EnterprisePlan } from "@/components/billing/enterprise-plan";
import { isEnterpriseConfigured } from "@/lib/env";
import { site } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Pricing",
  description: `Free: ${plans.starterCredits} bids to start, plus ${plans.monthlyCredits} free bid every month. Unlimited: ${MONTHLY.price}/month billed monthly, or ${ANNUAL.price}/year billed annually.`,
  alternates: { canonical: "/pricing" },
};

const rows: [string, boolean | string, boolean | string, boolean | string][] = [
  ["Finalized bids", `${plans.starterCredits} to start + ${plans.monthlyCredits} every month`, "Unlimited", "Unlimited for every user"],
  ["Licensed users", "1", "1", "3 included, more at volume pricing"],
  ["Updates and re-downloads of finalized bids", "Free", "Free", "Free"],
  ["Draft editing and previews", "Unlimited", "Unlimited", "Unlimited"],
  ["Every trade category", true, true, true],
  ["Markup, margin, tax, and profit tools", true, true, true],
  ["Editable branding and logo", true, true, true],
  ["Customer visibility modes", true, true, true],
  ["Saved business settings and customers", true, true, true],
  ["Saved Items & Pricing", false, true, true],
  ["Reusable proposal templates", false, true, true],
  ["Full proposal customization", "Core options", true, true],
  ["Company dashboard, team management and permissions", false, false, true],
  ["Company sales pipeline and analytics", false, false, true],
  ["Centralized billing and license management", false, false, true],
  ["Archived bids", "Unlimited", "Unlimited*", "Unlimited*"],
];

const UNLIMITED_FEATURES = ["Unlimited bid exports", "Everything in Free", "Reusable templates", "Full proposal customization"];

export default async function PricingPage() {
  const { user, status, plan } = await getAccountContext();
  const subscribed = status.kind === "unlimited";
  let entMode: "open" | "contact" | "member" | "owner" = isEnterpriseConfigured() ? "open" : "contact";
  if (user) {
    // Tolerates the Enterprise migration not being applied yet (no company => null).
    const { data: co } = await (await createClient()).rpc("my_company");
    if (co) entMode = (co as { isOwner?: boolean }).isOwner ? "owner" : "member";
  }
  const manage = <ButtonLink href="/settings/billing" variant="secondary" size="lg" className="w-full">Manage subscription</ButtonLink>;
  return (
    <Container className="py-14">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-4xl font-extrabold">Simple pricing for every contractor</h1>
        <p className="mt-3 text-lg text-ink-soft" data-testid="pricing-intro">{pricingIntro(status)}</p>
      </div>
      <CheckoutFlowProvider signedIn={Boolean(user)} subscribed={subscribed} userEmail={user?.email ?? null} userPhone={user?.phone ?? null}>
        <div className="mx-auto mt-10 grid max-w-5xl gap-5 md:grid-cols-3">
          <Plan name="Free" current={status.kind === "free" || status.kind === "no_credits"} price="$0" per="forever" billing="No credit card required." features={[`${plans.starterCredits} starter bids that never expire`, `Plus ${plans.monthlyCredits} free bid every month`, "Unlimited drafts and previews", "Every trade", "Branding and PDF exports"]}>
            <FreePlanAction status={status} />
          </Plan>
          <Plan name={MONTHLY.name} current={subscribed && plan !== "annual"} price={MONTHLY.price} per="/month" billing="Billed monthly. Cancel anytime." features={UNLIMITED_FEATURES}>
            {subscribed ? manage : <CheckoutButton plan="monthly" signedIn={Boolean(user)} label="Choose Monthly" variant="primary" />}
          </Plan>
          <Plan name={ANNUAL.name} current={subscribed && plan === "annual"} price={ANNUAL.price} per="/year" billing="Billed annually" highlight
            note={<>Equivalent to {ANNUAL_MONTHLY_EQUIVALENT}/month. Save approximately {ANNUAL_SAVINGS_PERCENT}% compared with monthly billing.</>}
            features={UNLIMITED_FEATURES}>
            {subscribed ? manage : <CheckoutButton plan="annual" signedIn={Boolean(user)} label="Choose Annual" />}
          </Plan>
        </div>
        <p className="mx-auto mt-5 max-w-2xl text-center text-sm text-ink-soft">Unlimited Monthly and Unlimited Annual include exactly the same features. Only the billing schedule is different.{subscribed && " You're on Unlimited."}</p>
      </CheckoutFlowProvider>
      <Suspense><EnterprisePlan signedIn={Boolean(user)} mode={entMode} supportEmail={site.supportEmail} /></Suspense>

      <div className="mx-auto mt-14 max-w-4xl overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full text-sm">
          <caption className="sr-only">Plan comparison</caption>
          <thead><tr className="border-b border-line text-left"><th className="p-3">Feature</th><th className="p-3">Free</th><th className="p-3">Unlimited (monthly or annual)</th><th className="p-3">Enterprise</th></tr></thead>
          <tbody>
            {rows.map(([f, a, b, c]) => (
              <tr key={f} className="border-b border-line last:border-0">
                <td className="p-3 font-medium">{f}</td>
                {[a, b, c].map((v, i) => <td key={i} className="p-3">{v === true ? <Check className="h-4 w-4 text-ok" aria-label="Included" /> : v === false ? <Minus className="h-4 w-4 text-muted" aria-label="Not included" /> : v}</td>)}
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

function Plan({ name, current, price, per, billing, note, features, highlight, children }: { name: string; current?: boolean; price: string; per: string; billing: string; note?: React.ReactNode; features: string[]; highlight?: boolean; children: React.ReactNode }) {
  return (
    <div className={`relative flex flex-col rounded-2xl border bg-surface p-6 ${highlight ? "border-accent shadow-lg ring-2 ring-accent/30" : "border-line"}`}>
      {highlight && <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-accent px-3 py-1 text-xs font-bold text-navy">Recommended</span>}
      <h2 className="flex items-center justify-between gap-2 font-display text-lg font-bold">{name}{current && <span className="shrink-0 whitespace-nowrap rounded-full bg-ok/10 px-2 py-0.5 text-xs font-semibold text-ok" data-testid="current-plan">Your plan</span>}</h2>
      <p className="mt-3 whitespace-nowrap"><span className="font-display text-4xl font-extrabold">{price}</span><span className={`font-semibold text-muted ${per.startsWith("/") ? "" : "ml-1.5"}`}>{per}</span></p>
      <p className="mt-1 text-sm font-semibold text-ink">{billing}</p>
      {note && <p className="mt-1 text-sm text-ink-soft">{note}</p>}
      <ul className="mt-5 flex-1 space-y-2 text-sm">{features.map((f) => <li key={f} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden />{f}</li>)}</ul>
      <div className="mt-6">{children}</div>
    </div>
  );
}

function pricingIntro(s: AccountStatus): string {
  switch (s.kind) {
    case "signed_out": return `Start with ${plans.starterCredits} free bids, then get ${plans.monthlyCredits} free bid every month. Upgrade when you are bidding regularly.`;
    case "free": return `You're on the Free plan${s.creditsLeft !== null ? ` with ${creditBadge(s)}` : ""}. Upgrade when you are bidding regularly.`;
    case "no_credits": return `You've used your free bids${s.nextCycleAt ? `. Your next one arrives ${formatCycleDate(s.nextCycleAt, { month: "long", day: "numeric" })}` : ""}. Go Unlimited to finalize as many bids as you need.`;
    case "unlimited": return "You're on Unlimited. Change plans, update your card, or cancel any time from Manage subscription.";
  }
}

/** Free card button: sign-up offer for visitors, plan-appropriate action for customers. */
function FreePlanAction({ status }: { status: AccountStatus }) {
  if (status.kind === "signed_out") return <ButtonLink href="/bids" variant="secondary" size="lg" className="w-full" data-cta="create">{CTA_LABELS.createFree}</ButtonLink>;
  if (status.kind === "free") return <ButtonLink href="/bids" variant="secondary" size="lg" className="w-full" data-cta="create">{CTA_LABELS.createNew}</ButtonLink>;
  return <ButtonLink href="/dashboard" variant="secondary" size="lg" className="w-full" data-cta="bids">{CTA_LABELS.bids}</ButtonLink>;
}
