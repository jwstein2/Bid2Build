import { openGraphFor } from "@/lib/seo/open-graph";
import type { Metadata } from "next";
import { CalendarRange, Check, Clock, Gem, Minus } from "lucide-react";
import Link from "next/link";
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
import {
  GROUP_TITLES, MARKETING_FEATURES, PM_PRODUCT_NAME, PRICES, cellFor, cellLabel, featureStatus, pmMarketedLive,
  type Cell, type CompareGroup,
} from "@/lib/marketing/catalog";

const pageTitle = "Pricing";
const pageDescription = `Free: ${plans.starterCredits} bids to start, plus ${plans.monthlyCredits} free bid every month. Unlimited: ${MONTHLY.price}/month or ${ANNUAL.price}/year. ${PM_PRODUCT_NAME} scheduling add-on: ${PRICES.pmMonthly}/month. Enterprise: ${PRICES.enterpriseBase}/month for ${PRICES.enterpriseIncludedUsers} users.`;

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDescription,
  alternates: { canonical: "/pricing" },
  openGraph: openGraphFor({ title: `${pageTitle} | ${site.name}`, description: pageDescription, path: "/pricing" }),
};

/** Plan basics that aren't features: allowances and limits. */
const BASICS: [string, string, string, string][] = [
  ["Finalized bids", `${plans.starterCredits} to start + ${plans.monthlyCredits} every month`, "Unlimited", "Unlimited for every user"],
  ["Licensed users", "1", "1", `${PRICES.enterpriseIncludedUsers} included, more at volume pricing`],
  ["Draft editing, previews and re-downloads", "Unlimited", "Unlimited", "Unlimited"],
  ["Archived bids", "Unlimited", "Unlimited*", "Unlimited*"],
];

const GROUP_ORDER: CompareGroup[] = ["estimating", "sales", "customers", "projects", "communications", "team"];

const UNLIMITED_FEATURES = ["Unlimited estimates and bids", "Everything in Free", "Saved Items & Pricing", "Proposal Templates", "Internal Estimate Reports", "Full proposal customization"];

/** Free card list: only what every account really gets on this deploy. */
function freeFeatures(): string[] {
  const esign = MARKETING_FEATURES.find((f) => f.id === "esign");
  return [
    `${plans.starterCredits} starter bids that never expire`,
    `Plus ${plans.monthlyCredits} free bid every month`,
    "Every trade, with calculators",
    esign && featureStatus(esign) === "live" ? "Sales pipeline and e-signatures" : "Sales pipeline",
    "Customer directory",
    "Branding and PDF exports",
  ];
}

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
        <div id="plans" className="mx-auto mt-10 grid max-w-5xl scroll-mt-20 gap-5 md:grid-cols-3">
          <Plan name="Free" current={status.kind === "free" || status.kind === "no_credits"} price="$0" per="forever" billing="No credit card required." features={freeFeatures()}>
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
      <PmAddonSection status={status} entMode={entMode} />
      <Suspense><EnterprisePlan signedIn={Boolean(user)} mode={entMode} supportEmail={site.supportEmail}
        extraFeatures={pmMarketedLive() ? [`${PM_PRODUCT_NAME}: ${PRICES.pmIncludedEnterpriseEditors} schedule editor included; extra editors ${PRICES.pmEditor}/month each (for licensed users)`] : []} /></Suspense>

      <ComparisonTable />
      <div className="mx-auto mt-8 max-w-3xl space-y-3 text-sm text-ink-soft">
        <p><b>What counts as a bid?</b> One credit is used when you finalize a new bid. Editing, re-finalizing, or re-downloading a bid you already finalized is free, and drafts and previews never use credits.</p>
        <p><b>How do free credits work?</b> Every verified account gets {plans.starterCredits} starter credits that never expire. From your second month, you also get {plans.monthlyCredits} free monthly bid on your signup anniversary each month. Monthly credits don&apos;t roll over, and they&apos;re always used before starter credits.</p>
        <p><b>Is {PM_PRODUCT_NAME} a separate plan?</b> No. It&apos;s an add-on to Unlimited ({PRICES.pmMonthly}/month, or {PRICES.pmAnnual}/year on annual plans) and includes one schedule editor: you. Enterprise includes one editor for a licensed user; each extra editor is {PRICES.pmEditor}/month and doesn&apos;t include a user license.</p>
        <p>*Unlimited archived bids are subject to reasonable storage and fair-use policies. Prices in USD; applicable taxes may be added at checkout.</p>
      </div>
    </Container>
  );
}

function Plan({ name, current, price, per, billing, note, features, highlight, children }: { name: string; current?: boolean; price: string; per: string; billing: string; note?: React.ReactNode; features: string[]; highlight?: boolean; children: React.ReactNode }) {
  return (
    <div className={`relative flex flex-col rounded-2xl border bg-surface p-6 ${highlight ? "border-accent shadow-lg ring-2 ring-accent/30" : "border-line"}`}>
      {highlight && <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-accent px-3 py-1 text-xs font-bold text-navy">Best value</span>}
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

/** Project Command Center add-on: what it adds, its price, and the right next step for this account. */
function PmAddonSection({ status, entMode }: { status: AccountStatus; entMode: "open" | "contact" | "member" | "owner" }) {
  const live = pmMarketedLive();
  const included = MARKETING_FEATURES.filter((f) => f.tier === "pm" && featureStatus(f) === "live");
  const soon = MARKETING_FEATURES.filter((f) => f.tier === "pm" && featureStatus(f) === "coming_soon");
  let action: React.ReactNode;
  if (!live) action = <p className="text-sm text-ink-soft" data-testid="pm-coming-soon">Coming soon as an add-on for Unlimited.</p>;
  else if (entMode === "owner") action = <ButtonLink href="/company/billing" variant="secondary" size="lg" className="w-full" data-cta="pm-manage">Manage editor seats</ButtonLink>;
  else if (entMode === "member") action = <p className="text-sm text-ink-soft">Your company admin assigns schedule editor seats.</p>;
  else if (status.kind === "unlimited") action = <ButtonLink href="/settings/billing#project-command-center" size="lg" className="w-full" data-cta="pm-unlock">Unlock {PM_PRODUCT_NAME}</ButtonLink>;
  else action = (
    <>
      <ButtonLink href="#plans" variant="secondary" size="lg" className="w-full" data-cta="pm-plans">Start with Unlimited</ButtonLink>
      <p className="mt-2 text-xs text-ink-soft">{PM_PRODUCT_NAME} is added to an Unlimited plan from Subscription after you subscribe.</p>
    </>
  );
  return (
    <section id="project-command-center" aria-labelledby="pcc-h" className="mx-auto mt-10 max-w-5xl scroll-mt-20 rounded-2xl border border-accent-ink/40 bg-surface p-4 shadow-sm ring-1 ring-accent/30 sm:p-6 md:p-8" data-testid="pm-addon-plan">
      <div className="grid gap-8 md:grid-cols-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-accent-ink"><CalendarRange className="h-4 w-4" aria-hidden /> Add-on for Unlimited</p>
          <h2 id="pcc-h" className="mt-1 font-display text-2xl font-extrabold">{PM_PRODUCT_NAME}</h2>
          <p className="mt-3 whitespace-nowrap"><span className="font-display text-4xl font-extrabold">+{PRICES.pmMonthly}</span><span className="font-semibold text-muted">/month</span></p>
          <p className="mt-1 text-sm font-semibold text-ink">Or +{PRICES.pmAnnual}/year on annual plans. Includes one schedule editor.</p>
          <p className="mt-2 text-sm text-ink-soft">Schedule jobs, manage subcontractors, track progress and keep customers informed. Progress reports use what your team records, never days passed.</p>
          <div className="mt-5">{action}</div>
        </div>
        <div className="min-w-0">
          <ul className="space-y-2 text-sm">
            {included.map((f) => <li key={f.id} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden /><span><b className="font-semibold">{f.name}.</b> <span className="text-ink-soft">{f.description}</span></span></li>)}
            {soon.map((f) => <li key={f.id} className="flex gap-2 text-ink-soft" data-status="soon"><Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden /><span><b className="font-semibold">{f.name}</b> <span className="ml-1 rounded-full border border-dashed border-line px-1.5 py-0.5 text-[11px] font-semibold text-muted">Coming soon</span></span></li>)}
          </ul>
          <p className="mt-4 text-xs text-ink-soft">On Enterprise: {PRICES.pmIncludedEnterpriseEditors} editor included; extra editors are {PRICES.pmEditor}/month each and need a licensed user. <Link href="#enterprise" className="font-semibold text-accent-ink underline">See Enterprise</Link></p>
        </div>
      </div>
    </section>
  );
}

const CELL_ICON = { included: Check, addon: Gem, enterprise: Check, soon: Clock, no: Minus } as const;

function CellView({ c }: { c: Cell | string }) {
  if (typeof c === "string" && !(c in CELL_ICON)) return <span>{c}</span>;
  if (typeof c === "object") return <span>{c.text}</span>;
  const k = c as keyof typeof CELL_ICON;
  const Icon = CELL_ICON[k];
  const tone = k === "no" ? "text-muted" : k === "soon" ? "text-muted" : k === "addon" ? "text-accent-ink" : "text-ok";
  return <span className={`inline-flex items-center gap-1.5 ${k === "no" || k === "soon" ? "text-ink-soft" : ""}`} data-cell={k}><Icon className={`h-4 w-4 shrink-0 ${tone}`} aria-hidden />{cellLabel(k)}</span>;
}

/** Grouped comparison built from the marketing catalog. Every cell says what it means in words. */
function ComparisonTable() {
  const th = "sticky left-0 z-10 w-36 bg-surface p-3 text-left font-medium shadow-[1px_0_0_var(--color-line)] sm:w-auto";
  return (
    <div className="mx-auto mt-14 max-w-5xl">
      <h2 className="text-2xl font-extrabold">Compare plans</h2>
      <p className="mt-1 text-sm text-ink-soft">Coming soon means it&apos;s in development and not part of any plan yet.</p>
      <p className="mt-1 text-xs text-muted sm:hidden" aria-hidden>Swipe the table sideways to see Unlimited and Enterprise.</p>
      <div className="mt-4 overflow-x-auto rounded-xl border border-line bg-surface" role="region" aria-label="Plan comparison" tabIndex={0}>
        <table className="w-full min-w-[600px] text-sm">
          <caption className="sr-only">Plan comparison</caption>
          <thead><tr className="border-b border-line text-left"><th scope="col" className={`${th} font-bold`}>Feature</th><th scope="col" className="p-3">Free</th><th scope="col" className="p-3">Unlimited<span className="block text-xs font-normal text-muted">monthly or annual</span></th><th scope="col" className="p-3">Enterprise</th></tr></thead>
          <tbody>
            <tr className="border-b border-line bg-paper"><th scope="colgroup" colSpan={4} className="p-3 text-left text-xs font-bold uppercase tracking-wide text-accent-ink">Plan basics</th></tr>
            {BASICS.map(([f, a, b, c]) => (
              <tr key={f} className="border-b border-line"><th scope="row" className={th}>{f}</th><td className="p-3">{a}</td><td className="p-3">{b}</td><td className="p-3">{c}</td></tr>
            ))}
            {GROUP_ORDER.map((g) => (
              <GroupRows key={g} group={g} th={th} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GroupRows({ group, th }: { group: CompareGroup; th: string }) {
  const list = MARKETING_FEATURES.filter((f) => f.group === group);
  return (
    <>
      <tr className="border-b border-line bg-paper" data-group={group}><th scope="colgroup" colSpan={4} className="p-3 text-left text-xs font-bold uppercase tracking-wide text-accent-ink">{GROUP_TITLES[group]}</th></tr>
      {list.map((f) => (
        <tr key={f.id} className="border-b border-line" data-feature-id={f.id}>
          <th scope="row" className={th}>
            {f.name}
            {f.hint && <span className="block text-xs font-normal text-muted">{f.hint}</span>}
          </th>
          {(["free", "unlimited", "enterprise"] as const).map((p) => <td key={p} className="p-3"><CellView c={cellFor(f, p)} /></td>)}
        </tr>
      ))}
    </>
  );
}
