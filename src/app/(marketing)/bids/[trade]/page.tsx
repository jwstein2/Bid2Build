import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Check } from "lucide-react";
import { Container } from "@/components/ui/misc";
import { familyTint, TradeIcon } from "@/components/trade-icon";
import { getTrade, trades, UNIT_ABBR } from "@/lib/trades/catalog";
import { plans, site } from "@/lib/site";
import { AccountCtas } from "@/components/account/account-ctas";
import { getAccountStatus } from "@/lib/account/server";
import { creditBadge, CTA_LABELS, type AccountStatus } from "@/lib/account/status";

export const dynamicParams = false;
export function generateStaticParams() {
  return trades.map((t) => ({ trade: t.slug }));
}

export async function generateMetadata({ params }: PageProps<"/bids/[trade]">): Promise<Metadata> {
  const { trade: slug } = await params;
  const t = getTrade(slug);
  if (!t) return {};
  return {
    title: t.seoTitle,
    description: `${t.intro} ${plans.starterCredits} free bids to start, plus ${plans.monthlyCredits} free every month.`,
    alternates: { canonical: `/bids/${t.slug}` },
    openGraph: { title: `${t.seoTitle} | ${site.name}`, description: t.intro },
  };
}

const genericFaqs = [
  { q: "Will my customer see my costs?", a: "No. The proposal shows only customer prices, in the level of detail you choose. Internal costs, markup, margin, and notes never appear." },
  { q: "Do the suggested items include prices?", a: "No. Suggestions help you remember what belongs in the bid. You enter your own costs, so nothing is priced with made-up numbers." },
];

export default async function TradePage({ params }: PageProps<"/bids/[trade]">) {
  const { trade: slug } = await params;
  const t = getTrade(slug);
  if (!t) notFound();
  const status = await getAccountStatus();
  const faqs = [...t.faqs, ...genericFaqs];
  const start = `/start/${t.slug}`;
  // Starting a draft never uses a credit, so it stays one click away in every state.
  const secondary = status.kind === "no_credits"
    ? { action: "draft" as const, label: CTA_LABELS.draft, href: start }
    : { action: "draft" as const, label: "Start from blank", href: `${start}?blank=1` };
  const related = trades.filter((x) => x.family === t.family && x.slug !== t.slug).slice(0, 4);
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "FAQPage",
        mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Trades", item: `${site.url}/bids` },
          { "@type": "ListItem", position: 2, name: t.name, item: `${site.url}/bids/${t.slug}` },
        ],
      },
    ],
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <section className="border-b border-line bg-surface">
        <Container className="grid gap-10 py-14 lg:grid-cols-[1.3fr_1fr]">
          <div>
            <nav aria-label="Breadcrumb" className="text-sm text-muted"><Link href="/bids" className="hover:text-ink">Trades</Link> / <span>{t.name}</span></nav>
            <div className="mt-4 flex items-center gap-3">
              <span className={`grid h-12 w-12 place-items-center rounded-xl ${familyTint[t.family]}`}><TradeIcon name={t.icon} className="h-7 w-7" /></span>
              <p className="font-semibold text-accent-dark">{t.seoTitle}</p>
            </div>
            <h1 className="mt-4 text-4xl font-extrabold leading-tight sm:text-5xl">{t.headline}</h1>
            <p className="mt-4 text-lg text-ink-soft">{t.intro}</p>
            <AccountCtas status={status} createHref={start} secondary={secondary} arrow className="mt-7" />
            <p className="mt-3 text-sm text-muted" data-testid="trade-cta-note">{tradeNote(status)}</p>
          </div>
          <div className="rounded-2xl border border-line bg-paper p-5">
            <h2 className="font-bold">Example {t.name.toLowerCase()} projects</h2>
            <ul className="mt-3 space-y-2">
              {t.projects.map((p) => <li key={p} className="flex gap-2 text-ink-soft"><Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden />{p}</li>)}
            </ul>
            <h2 className="mt-6 font-bold">Pro tips</h2>
            <ul className="mt-2 space-y-2 text-sm text-ink-soft">{t.tips.map((x) => <li key={x}>• {x}</li>)}</ul>
          </div>
        </Container>
      </section>

      <Container className="py-14">
        <h2 className="text-2xl font-extrabold">How a {t.name.toLowerCase()} bid comes together</h2>
        <ol className="mt-6 grid gap-4 md:grid-cols-4">
          {[
            ["Start", `Open a ${t.name.toLowerCase()} estimate with the sections below already in place, or a blank one.`],
            ["Add items", "Click suggested items to add them, then enter quantities and your costs."],
            ["Set your price", "Choose markup or target margin. See cost, price, profit, and margin update live."],
            ["Send", "Pick the proposal style, preview it, and download a branded PDF."],
          ].map(([h, b], i) => (
            <li key={h} className="rounded-xl border border-line bg-surface p-4">
              <span className="text-xs font-bold text-accent-dark">{i + 1}</span>
              <h3 className="mt-1 font-bold">{h}</h3>
              <p className="mt-1 text-sm text-ink-soft">{b}</p>
            </li>
          ))}
        </ol>

        <h2 className="mt-14 text-2xl font-extrabold">Common sections in a {t.name.toLowerCase()} estimate</h2>
        <p className="mt-2 text-ink-soft">Suggested items are a checklist, not prices. You decide what goes in.</p>
        <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {t.template.groups.filter((g) => g.items.length).map((g) => (
            <div key={g.name} className="rounded-xl border border-line bg-surface p-4">
              <h3 className="font-bold">{g.name}</h3>
              <ul className="mt-2 space-y-1 text-sm text-ink-soft">
                {g.items.map((it) => (
                  <li key={it.name} className="flex justify-between gap-3"><span>{it.name}</span><span className="text-muted">{UNIT_ABBR[it.unit] ?? it.unit}</span></li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <h2 className="mt-14 text-2xl font-extrabold">{t.name} estimate FAQ</h2>
        <div className="mt-6 divide-y divide-line rounded-xl border border-line bg-surface">
          {faqs.map((f) => (
            <div key={f.q} className="p-5">
              <h3 className="font-semibold">{f.q}</h3>
              <p className="mt-1 text-ink-soft">{f.a}</p>
            </div>
          ))}
        </div>

        {related.length > 0 && (
          <>
            <h2 className="mt-14 text-xl font-extrabold">Related trades</h2>
            <ul className="mt-4 flex flex-wrap gap-2">
              {related.map((r) => (
                <li key={r.slug}><Link href={`/bids/${r.slug}`} className="inline-block rounded-full border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:border-brand/40">{r.seoTitle}</Link></li>
              ))}
              <li><Link href="/learn/markup-vs-margin" className="inline-block rounded-full border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:border-brand/40">Markup vs. margin guide</Link></li>
            </ul>
          </>
        )}

        <div className="on-dark blueprint-grid-dark mt-14 rounded-2xl bg-brand p-8 text-white">
          <h2 className="text-2xl font-extrabold">Ready to build your {t.name.toLowerCase()} bid?</h2>
          <p className="mt-2 text-white/80">{status.signedIn ? "Your company details and branding carry over to every bid." : "Start now. Create an account only when you are ready to download."}</p>
          <AccountCtas status={status} createHref={start} tone="dark" secondary={status.kind === "no_credits" ? { ...secondary, label: CTA_LABELS.draft } : false} className="mt-5" />
        </div>
      </Container>
    </>
  );
}

function tradeNote(s: AccountStatus): string {
  switch (s.kind) {
    case "signed_out": return `No signup to start. ${plans.starterCredits} free bids to start, plus ${plans.monthlyCredits} every month.`;
    case "free": return s.creditsLeft !== null ? `You have ${creditBadge(s)}. Drafts never use a credit.` : "Drafts never use a credit.";
    case "no_credits": return "You're out of free bids. Drafts and previews still work; go Unlimited to finalize.";
    case "unlimited": return "Unlimited plan: finalize as many bids as you need.";
  }
}
