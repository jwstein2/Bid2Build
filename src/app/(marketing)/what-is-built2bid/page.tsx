import type { Metadata } from "next";
import Link from "next/link";
import { Check, Minus } from "lucide-react";
import { Container } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { FACTS_PATH, productFacts } from "@/lib/marketing/product-facts";
import { openGraphFor } from "@/lib/seo/open-graph";
import { breadcrumbLd, faqLd, ldJson, organizationLd, softwareApplicationLd } from "@/lib/seo/structured-data";
import { site } from "@/lib/site";

const title = `What is ${site.name}? Features, pricing and limits`;
const description = `Plain facts about ${site.name}, estimating and proposal software for small contractors: who it's for, what it does, what it costs and what it doesn't do.`;

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: FACTS_PATH },
  openGraph: openGraphFor({ title, description, path: FACTS_PATH }),
};

const verified = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`${id}-h`} className="mt-12" id={id}>
      <h2 id={`${id}-h`} className="text-2xl font-extrabold text-navy">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

const TIER_LABEL: Record<string, string> = { core: "Free", unlimited: "Individual Unlimited", pm: "Add-on", enterprise: "Team" };

export default function WhatIsBuilt2BidPage() {
  const f = productFacts();
  const json = ldJson(
    organizationLd(),
    { "@type": "WebPage", "@id": `${site.url}${FACTS_PATH}`, url: `${site.url}${FACTS_PATH}`, name: title, description, dateModified: f.verifiedOn, about: { "@id": `${site.url}/#software` }, publisher: { "@id": `${site.url}/#organization` } },
    softwareApplicationLd({ description: f.summary }),
    faqLd(f.faqs),
    breadcrumbLd([{ name: `What is ${site.name}?`, path: FACTS_PATH }]),
  );

  return (
    <Container className="py-12 sm:py-16">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />
      <article className="mx-auto max-w-3xl" data-testid="product-facts">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-accent-ink">Product facts</p>
        <h1 className="mt-2 text-4xl font-extrabold text-navy">What is {site.name}?</h1>
        <p className="mt-4 text-lg text-ink-soft" data-testid="facts-summary">{f.summary}</p>
        <p className="mt-3 text-sm text-ink-soft">
          Last checked against the live app on <time dateTime={f.verifiedOn} data-testid="facts-verified">{verified(f.verifiedOn)}</time>. Prices and plan details on this page come from the same source as the{" "}
          <Link href="/pricing" className="font-semibold text-accent-ink underline">pricing page</Link>.
        </p>

        <nav aria-label="On this page" className="mt-6 rounded-xl border border-line bg-surface p-4 text-sm">
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {[["who", "Who it's for"], ["problems", "Problems it solves"], ["features", "What it does"], ["trades", "Trades"], ["pricing", "Plans and prices"], ["free", "What's free"], ["integrations", "Integrations"], ["limits", "What it doesn't do"], ["company", "Company"], ["faq", "FAQ"]].map(([id, label]) => (
              <li key={id}><a href={`#${id}`} className="inline-flex min-h-11 items-center font-semibold text-accent-ink underline-offset-4 hover:underline">{label}</a></li>
            ))}
          </ul>
        </nav>

        <Section id="who" title="Who it's for">
          <ul className="space-y-2 text-ink-soft">{f.audience.map((a) => <li key={a} className="flex gap-2"><Check className="mt-1 h-4 w-4 shrink-0 text-ok" aria-hidden />{a}</li>)}</ul>
        </Section>

        <Section id="problems" title="Problems it solves">
          <dl className="grid gap-4 sm:grid-cols-2">
            {f.problems.map((p) => (
              <div key={p.title} className="rounded-xl border border-line bg-surface p-5">
                <dt className="font-semibold text-ink">{p.title}</dt>
                <dd className="mt-2 text-sm text-ink-soft">{p.body}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section id="features" title="What it does">
          {f.workflows.map((w) => (
            <div key={w.pillar} className="mt-6 first:mt-0">
              <h3 className="text-lg font-bold text-ink">{w.title}</h3>
              <p className="mt-1 text-sm text-ink-soft">{w.lead}</p>
              <ul className="mt-3 divide-y divide-line rounded-xl border border-line bg-surface">
                {w.features.map((x) => (
                  <li key={x.name} className="p-4 text-sm">
                    <p className="flex flex-wrap items-baseline justify-between gap-2"><span className="font-semibold text-ink">{x.name}</span><span className="text-xs font-semibold text-ink-soft">{TIER_LABEL[x.tier]}</span></p>
                    <p className="mt-1 text-ink-soft">{x.description}</p>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="mt-4 text-sm"><Link href="/pricing#compare" className="font-semibold text-accent-ink underline">Compare every feature by plan</Link>{" · "}<Link href="/compare" className="font-semibold text-accent-ink underline">Compare with other contractor software</Link></p>
        </Section>

        <Section id="trades" title="Trades with their own estimate builder">
          <ul className="flex flex-wrap gap-2 text-sm">
            {f.trades.map((t) => <li key={t.slug}><Link href={`/bids/${t.slug}`} className="inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-3 font-semibold text-ink hover:border-accent">{t.name}</Link></li>)}
          </ul>
          <p className="mt-3 text-sm text-ink-soft">Anything else starts from a custom estimate. Multi-trade estimates are supported.</p>
        </Section>

        <Section id="pricing" title="Plans and prices">
          <div className="grid gap-4 sm:grid-cols-3">
            {f.plans.map((p) => (
              <div key={p.name} className="rounded-xl border border-line bg-surface p-5" data-testid={`facts-plan-${p.name}`}>
                <h3 className="font-bold text-ink">{p.name}</h3>
                <p className="mt-1 text-lg font-extrabold text-navy">{p.price}</p>
                <p className="mt-2 text-sm text-ink-soft">{p.summary}</p>
                <ul className="mt-3 space-y-1 text-sm text-ink-soft">{p.points.map((x) => <li key={x}>{x}</li>)}</ul>
              </div>
            ))}
          </div>
          {f.addOns.map((a) => (
            <div key={a.name} className="mt-4 rounded-xl border border-line bg-surface p-5">
              <h3 className="font-bold text-ink">{a.name} add-on <span className="font-extrabold text-navy">· {a.price}</span></h3>
              <p className="mt-2 text-sm text-ink-soft">{a.summary}</p>
            </div>
          ))}
          <p className="mt-4 text-sm text-ink-soft">No long-term contracts. Cancel any time; paid periods are non-refundable. Sales tax is added where it applies. <Link href="/pricing" className="font-semibold text-accent-ink underline">See full pricing</Link>.</p>
        </Section>

        <Section id="free" title="What's free">
          <ul className="space-y-2 text-ink-soft">{f.free.map((x) => <li key={x} className="flex gap-2"><Check className="mt-1 h-4 w-4 shrink-0 text-ok" aria-hidden />{x}</li>)}</ul>
          <p className="mt-3 text-sm"><Link href="/tools" className="font-semibold text-accent-ink underline">Free calculators</Link>{" · "}<Link href="/learn" className="font-semibold text-accent-ink underline">Contractor guides</Link>{" · "}<Link href="/academy/classroom" className="font-semibold text-accent-ink underline">Contractor Academy</Link></p>
        </Section>

        <Section id="integrations" title="Integrations and built-in tools">
          <dl className="divide-y divide-line rounded-xl border border-line bg-surface">
            {f.integrations.map((i) => (
              <div key={i.name} className="p-4 text-sm sm:grid sm:grid-cols-[180px_1fr] sm:gap-4">
                <dt className="font-semibold text-ink">{i.name}</dt>
                <dd className="mt-1 text-ink-soft sm:mt-0">{i.status}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section id="limits" title="What it doesn't do (yet)">
          <ul className="space-y-2 text-ink-soft" data-testid="facts-limits">{f.limitations.map((x) => <li key={x} className="flex gap-2"><Minus className="mt-1 h-4 w-4 shrink-0 text-ink-soft" aria-hidden />{x}</li>)}</ul>
        </Section>

        <Section id="company" title="Company and support">
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[160px_1fr]">
            <dt className="font-semibold text-ink">Company</dt><dd className="text-ink-soft">{f.company.legalName}, a {f.company.state} company</dd>
            <dt className="font-semibold text-ink">Launched</dt><dd className="text-ink-soft">{f.company.launched}</dd>
            <dt className="font-semibold text-ink">Website</dt><dd className="text-ink-soft"><a href={f.company.website} className="font-semibold text-accent-ink underline">{f.company.website.replace(/^https?:\/\//, "")}</a></dd>
            <dt className="font-semibold text-ink">Support</dt><dd className="text-ink-soft"><a href={`mailto:${f.company.support}`} className="font-semibold text-accent-ink underline">{f.company.support}</a></dd>
            <dt className="font-semibold text-ink">More</dt><dd className="text-ink-soft"><Link href="/about" className="font-semibold text-accent-ink underline">About us</Link>{" · "}<Link href="/security" className="font-semibold text-accent-ink underline">Security</Link>{" · "}<Link href="/privacy" className="font-semibold text-accent-ink underline">Privacy</Link></dd>
          </dl>
        </Section>

        <Section id="faq" title="Frequently asked questions">
          <div className="divide-y divide-line rounded-xl border border-line bg-surface">
            {f.faqs.map((q) => (
              <div key={q.q} className="p-5">
                <h3 className="font-semibold text-ink">{q.q}</h3>
                <p className="mt-2 text-sm text-ink-soft">{q.a}</p>
              </div>
            ))}
          </div>
        </Section>

        <div className="mt-12 flex flex-wrap items-center gap-4">
          <ButtonLink href="/#trades" variant="accent" size="lg" data-cta="facts-start">Build a free estimate</ButtonLink>
          <Link href="/pricing" className="inline-flex min-h-11 items-center font-semibold text-accent-ink underline-offset-4 hover:underline" data-cta="facts-pricing">View pricing</Link>
        </div>
      </article>
    </Container>
  );
}
