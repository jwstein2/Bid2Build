import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/misc";
import { TradePicker } from "@/components/marketing/trade-picker";
import { ProposalSample } from "@/components/marketing/proposal-sample";
import { SampleProposal } from "@/components/marketing/sample-proposal";
import { PILLAR_ANCHOR, PILLAR_ICON, PILLAR_ORDER, PillarSections } from "@/components/marketing/pillars";
import { PILLARS, PM_PRODUCT_NAME, PRICES, pmMarketedLive } from "@/lib/marketing/catalog";
import { pickerTrades } from "@/lib/trades/picker";
import { plans, site } from "@/lib/site";
import { AccountCtas } from "@/components/account/account-ctas";
import { ReplayTourButton } from "@/components/onboarding/replay-tour-button";
import { getAccountStatus } from "@/lib/account/server";
import { accountCtas, creditBadge, MEMBER_TAGLINE, type AccountStatus } from "@/lib/account/status";

const faqs: { q: string; a: string; visitorOnly?: boolean; freePlanOnly?: boolean; pmOnly?: boolean }[] = [
  { visitorOnly: true, q: "Is it really free?", a: `Yes. Every verified account gets ${plans.starterCredits} free bids to start, plus ${plans.monthlyCredits} free bid every month from your second month on. Drafts and previews are unlimited, with every trade and your branding. No credit card required.` },
  { visitorOnly: true, q: "Do I need to sign up before I can try it?", a: "No. Pick a trade and start building right away. Your draft is saved in your browser. You only create an account (with a one-time email link) when you are ready to download your first PDF or save to the cloud." },
  { q: "Will my customer see my costs or markup?", a: "Never. Customer-facing proposals are built only from customer prices. Internal costs, margins, and notes are not included in the preview or the PDF." },
  { q: "Do you provide local material prices?", a: "Only when a licensed pricing source is connected. We never show made-up prices. Until then, you enter your own costs, which is what accurate bids are built on anyway." },
  { q: "Where is my draft saved?", a: "Before you sign in, drafts are saved in this browser on this device. After you sign in, they autosave to your account so you can pick them up on any device." },
  { q: `What is ${PM_PRODUCT_NAME}?`, a: `An add-on for Unlimited that turns won bids into job schedules: a Gantt timeline built from your estimate, a company calendar, staff and subcontractor assignments, progress tracking, and customer progress updates you review and share. It's ${PRICES.pmMonthly}/month (${PRICES.pmAnnual}/year on annual plans). Enterprise includes ${PRICES.pmIncludedEnterpriseEditors} schedule editor, and extra editors are ${PRICES.pmEditor}/month each.`, pmOnly: true },
  { q: "Does Built2Bid work for a team?", a: `Yes. Enterprise is ${PRICES.enterpriseBase}/month for ${PRICES.enterpriseIncludedUsers} licensed users, each with their own login and unlimited bidding, plus roles and permissions, a company dashboard, and one proposal style for the whole company. More users are added at volume pricing.` },
  { freePlanOnly: true, q: "What counts as one of my free bids?", a: "A credit is used when you finalize a new bid. Editing, re-finalizing, or re-downloading a bid you already finalized is free, and drafts never use a credit. Your monthly bid is used first, then starter credits." },
];

const VISITOR_POINTS = ["No sign-up until you download", "No credit card", "Your costs stay private"];
const MEMBER_POINTS = ["Every trade, one pricing engine", "Your costs stay private", "Branded PDF proposals"];


export default async function HomePage() {
  const status = await getAccountStatus();
  const visitor = !status.signedIn;
  const badge = creditBadge(status);
  const pm = pmMarketedLive();
  const shownFaqs = faqs.filter((f) => (!f.visitorOnly || visitor) && (!f.freePlanOnly || status.kind !== "unlimited") && (!f.pmOnly || pm));
  const softwareApp = {
    "@type": "SoftwareApplication",
    name: site.name,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description: site.description,
    offers: [
      { "@type": "Offer", price: "0", priceCurrency: "USD", name: "Free" },
      { "@type": "Offer", price: "19.99", priceCurrency: "USD", name: "Unlimited Monthly" },
      { "@type": "Offer", price: "149", priceCurrency: "USD", name: "Unlimited Annual" },
      ...(pm ? [{ "@type": "Offer", price: PRICES.pmMonthly.replace("$", ""), priceCurrency: "USD", name: `${PM_PRODUCT_NAME} add-on (monthly)` }] : []),
      { "@type": "Offer", price: PRICES.enterpriseBase.replace("$", ""), priceCurrency: "USD", name: `Enterprise (${PRICES.enterpriseIncludedUsers} users, monthly)` },
    ],
  };
  // One graph: the business, the website and the product, linked by @id so search engines can
  // tie the brand name, logo and support contact to the app listing.
  const orgId = `${site.url}/#organization`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": orgId,
        name: site.name,
        url: site.url,
        logo: `${site.url}/icon.png`,
        contactPoint: { "@type": "ContactPoint", contactType: "customer support", email: site.supportEmail, availableLanguage: "English" },
      },
      { "@type": "WebSite", "@id": `${site.url}/#website`, name: site.name, url: site.url, publisher: { "@id": orgId } },
      { ...softwareApp, url: site.url, publisher: { "@id": orgId } },
    ],
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <section className="on-dark relative overflow-hidden bg-navy text-white">
        <div aria-hidden className="blueprint-grid-dark pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent_95%)]" />
        <Container className="relative grid items-center gap-12 pb-16 pt-12 sm:pt-16 lg:grid-cols-[1.05fr_1fr] lg:gap-14 lg:pb-20">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-3 py-1 text-xs font-semibold text-[#D5DFE9]">
              <span className="h-1.5 w-1.5 rounded-full bg-teal" aria-hidden />
              <span data-testid="hero-tagline">{visitor ? `For contractors in every trade · ${plans.starterCredits} free bids to start` : MEMBER_TAGLINE}</span>
              {badge && <span className="whitespace-nowrap border-l border-white/20 pl-2" data-testid="hero-credits">{badge}</span>}
            </p>
            <h1 className="mt-5 max-w-xl text-4xl font-extrabold leading-[1.08] tracking-tight text-white sm:text-5xl lg:text-[3.25rem]">
              Win More Bids. Manage Every Job. <span className="relative inline-block text-cyan">Grow Your Business.<svg aria-hidden viewBox="0 0 300 12" preserveAspectRatio="none" className="absolute -bottom-2 left-0 h-2.5 w-full"><path d="M3 9C80 3 200 2 297 6" fill="none" stroke="#14B8A6" strokeWidth="4" strokeLinecap="round" /></svg></span>
            </h1>
            <p className="mt-6 max-w-xl text-lg text-[#D5DFE9]">
              {pm
                ? "Create professional estimates, track every bid from draft to signed, schedule won jobs, assign your crew and subs, and keep customers informed. All from one contractor platform."
                : "Create professional estimates, send proposals customers can sign online, and track every bid from draft to signed. All from one contractor platform."}
            </p>
            <AccountCtas status={status} tone="dark" arrow createFreeLabel={`Start Your ${plans.starterCredits} Free Bids`}
              secondary={visitor && pm ? { action: "pm", label: `Explore ${PM_PRODUCT_NAME}`, href: `#${PILLAR_ANCHOR.run}` } : undefined}
              howHref="#how-it-works" className="mt-8" />
            <ReplayTourButton testId="watch-demo" className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg px-1 text-sm font-semibold text-cyan underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan">
              Watch Demo <span className="font-normal text-[#B8C6D4]">(3 min)</span>
            </ReplayTourButton>
            <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-[#D5DFE9]">
              {(visitor ? VISITOR_POINTS : MEMBER_POINTS).map((x) => (
                <li key={x} className="flex items-center gap-1.5"><Check className="h-4 w-4 text-teal" aria-hidden />{x}</li>
              ))}
            </ul>
          </div>
          <SampleProposal className="mx-auto w-full max-w-xl lg:max-w-none" dark />
        </Container>
        <nav aria-label="What Built2Bid does" className="relative border-t border-white/10">
          <Container className="grid gap-3 py-5 sm:grid-cols-3">
            {PILLAR_ORDER.map((p) => {
              const Icon = PILLAR_ICON[p];
              return (
                <a key={p} href={`#${PILLAR_ANCHOR[p]}`} className="group flex min-h-11 items-start gap-3 rounded-xl px-2 py-2 hover:bg-white/5" data-testid={`pillar-link-${p}`}>
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white/10 text-cyan"><Icon className="h-5 w-5" aria-hidden /></span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1 font-display font-bold text-white">{PILLARS[p].title}<ArrowRight className="h-4 w-4 opacity-0 transition group-hover:opacity-100" aria-hidden /></span>
                    <span className="block text-sm text-[#B8C6D4]">{p === "run" && !pm ? "Coming soon" : PILLARS[p].kicker}</span>
                  </span>
                </a>
              );
            })}
          </Container>
        </nav>
      </section>

      <section id="trades" className="scroll-mt-20 border-b border-line py-16 sm:py-20">
        <Container>
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-accent-ink">Start here</p>
            <h2 className="mt-2 text-3xl font-extrabold text-navy sm:text-4xl">What are you bidding today?</h2>
            <p className="mt-3 text-lg text-ink-soft">Pick a trade to open a bid with sections ready for that kind of work.</p>
          </div>
          <div className="mx-auto mt-10 max-w-5xl">
            <TradePicker trades={pickerTrades()} />
          </div>
        </Container>
      </section>

      <section id="how-it-works" className="scroll-mt-20 py-20" aria-labelledby="pillars-h">
        <Container>
          <div className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-accent-ink">One workflow</p>
            <h2 id="pillars-h" className="mt-2 text-3xl font-extrabold text-navy sm:text-4xl">From first estimate to finished job</h2>
            <p className="mt-3 text-lg text-ink-soft">Estimating, proposals and your pipeline are included on every plan. Scheduling and team tools are there when you need them. Each feature below shows the plan it needs.</p>
          </div>
          <div className="mt-10"><PillarSections /></div>
        </Container>
      </section>

      <section className="border-y border-line bg-surface py-20">
        <Container className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <h2 className="text-3xl font-extrabold text-navy sm:text-4xl">Know your profit before you send the bid</h2>
            <p className="mt-3 text-lg text-ink-soft">
              Markup and margin are not the same thing. A 25% markup is a 20% gross margin. {site.name} lets you price either way and always shows
              both, so you never under-price a job by mixing them up.
            </p>
            <ul className="mt-6 space-y-3 text-ink-soft">
              {[
                "Markup or target-margin pricing, with per-group and per-item overrides",
                "Separate sales tax from revenue, with taxable and non-taxable items",
                "Overhead, contingency, permits, and delivery as costs or pass-through charges",
                "Precise decimal math: every printed line multiplies out exactly",
                "Show the customer group totals, item names only, full itemization or one project total",
              ].map((x) => (
                <li key={x} className="flex gap-2"><Check className="mt-0.5 h-5 w-5 shrink-0 text-ok" aria-hidden />{x}</li>
              ))}
            </ul>
          </div>
          <ProposalSample />
        </Container>
      </section>

      <section className="on-dark relative overflow-hidden bg-navy py-16 text-white">
        <div aria-hidden className="blueprint-grid-dark pointer-events-none absolute inset-0" />
        <Container className="relative flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
          <PlanBand status={status} />
        </Container>
      </section>

      <section className="py-20">
        <Container className="max-w-3xl">
          <h2 className="text-3xl font-extrabold text-navy">Questions contractors ask</h2>
          <div className="mt-8 divide-y divide-line rounded-xl border border-line bg-surface">
            {shownFaqs.map((f) => (
              <details key={f.q} className="group p-5">
                <summary className="cursor-pointer list-none font-semibold marker:hidden [&::-webkit-details-marker]:hidden">
                  <span className="flex items-center justify-between gap-4">{f.q}<span className="text-muted transition group-open:rotate-45" aria-hidden>+</span></span>
                </summary>
                <p className="mt-2 text-ink-soft">{f.a}</p>
              </details>
            ))}
          </div>
          <p className="mt-6 text-sm text-muted">More in our <Link href="/learn" className="text-accent-ink underline">contractor guides</Link>, or <a href={`mailto:${site.supportEmail}`} className="text-accent-ink underline">email support</a>.</p>
        </Container>
      </section>
    </>
  );
}

/** Closing band: the public offer for visitors, plan-appropriate next steps for customers. */
function PlanBand({ status }: { status: AccountStatus }) {
  const outline = "border border-white/30 bg-transparent text-white hover:bg-white/10";
  const { primary, secondary } = accountCtas(status);
  const copy = {
    signed_out: {
      h: `Free to start. ${plans.monthlyPriceLabel}/month when you need more.`,
      p: `${plans.starterCredits} free bids to start, plus ${plans.monthlyCredits} free bid every month. Unlimited for ${plans.monthlyPriceLabel}/month, or ${plans.annualPriceLabel}/year billed annually.`,
    },
    free: {
      h: "Bidding regularly? Go Unlimited.",
      p: `Finalize as many bids as you need for ${plans.monthlyPriceLabel}/month, or ${plans.annualPriceLabel}/year billed annually.`,
    },
    no_credits: {
      h: "Keep bidding with Unlimited.",
      p: `Your bids and drafts are all still here. Go Unlimited for ${plans.monthlyPriceLabel}/month, or ${plans.annualPriceLabel}/year, to finalize as many as you need.`,
    },
    unlimited: {
      h: "You're on Unlimited.",
      p: pmMarketedLive()
        ? `Finalize as many bids as you need. Add ${PM_PRODUCT_NAME} for ${PRICES.pmMonthly}/month to schedule won jobs and keep customers updated.`
        : "Finalize as many bids as you need. Your company details and branding carry over to every proposal.",
    },
  }[status.kind];
  // Visitors compare plans; Free-plan members see plans next to Create; others get their usual pair.
  const second = status.kind === "signed_out" || status.kind === "free" ? { action: "plans", label: status.kind === "free" ? "View Plans" : "Compare plans", href: "/pricing" } : secondary;
  return (
    <>
      <div>
        <h2 className="text-3xl font-extrabold" data-testid="plan-band-heading">{copy.h}</h2>
        <p className="mt-2 text-[#D5DFE9]">{copy.p}</p>
      </div>
      <div className="flex flex-wrap gap-3">
        <ButtonLink href={primary.href} variant="accent" size="lg" data-cta={primary.action}>{primary.label}</ButtonLink>
        <ButtonLink href={second.href} size="lg" className={outline} data-cta={second.action}>{second.label}</ButtonLink>
      </div>
    </>
  );
}
