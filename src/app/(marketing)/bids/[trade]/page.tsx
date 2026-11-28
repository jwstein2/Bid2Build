import { openGraphFor } from "@/lib/seo/open-graph";
import type { Metadata } from "next";
import { pmMarketedLive } from "@/lib/marketing/catalog";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Calculator, Check, EyeOff, Percent } from "lucide-react";
import { Container } from "@/components/ui/misc";
import { familyTint, TradeIcon } from "@/components/trade-icon";
import { getTrade, trades, UNIT_ABBR } from "@/lib/trades/catalog";
import { articlesForTrade } from "@/lib/learn/articles";
import { plans, site } from "@/lib/site";
import { AccountCtas } from "@/components/account/account-ctas";
import { getAccountStatus } from "@/lib/account/server";
import { creditBadge, CTA_LABELS, type AccountStatus } from "@/lib/account/status";
import { landingFor, PRICE_DISPLAYS } from "@/lib/trades/landing";
import { TrackLandingView } from "@/components/analytics/track-view";
import { quantityToolForTrade, toolBySlug } from "@/lib/marketing/tools";
import { ACADEMY_TRADES } from "@/lib/academy/content/catalog";
import { WELCOME_VIDEO } from "@/components/onboarding/steps";
import { VideoPlaceholder } from "@/components/onboarding/video-placeholder";
import { metaDescription } from "@/lib/seo/meta";

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
    description: metaDescription(`${t.intro} ${plans.starterCredits} free bids to start, plus ${plans.monthlyCredits} free every month.`),
    alternates: { canonical: `/bids/${t.slug}` },
    openGraph: openGraphFor({ title: `${t.seoTitle} | ${site.name}`, description: metaDescription(t.intro), path: `/bids/${t.slug}`, ownImage: true }),
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
  const guides = articlesForTrade(t.slug);
  const tool = quantityToolForTrade(t.slug);
  const markupTool = toolBySlug("markup-margin-calculator");
  const academy = ACADEMY_TRADES.some((a) => a.slug === t.slug) ? `/academy/classroom/${t.slug}` : "/academy/classroom";
  // Priority trades get conversion copy, a real sample proposal and the calculator explainer.
  const L = landingFor(t.slug);
  const lower = t.name.toLowerCase();
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
      <TrackLandingView trade={t.slug} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <section className="border-b border-line bg-surface">
        <Container className="grid gap-10 py-14 lg:grid-cols-[1.3fr_1fr]">
          <div>
            <nav aria-label="Breadcrumb" className="text-sm text-muted"><Link href="/bids" className="hover:text-ink">Trades</Link> / <span>{t.name}</span></nav>
            <div className="mt-4 flex items-center gap-3">
              <span className={`grid h-12 w-12 place-items-center rounded-xl ${familyTint[t.family]}`}><TradeIcon name={t.icon} className="h-7 w-7" /></span>
              <p className="font-semibold text-accent-dark">{t.seoTitle}</p>
            </div>
            <h1 className="mt-4 text-4xl font-extrabold leading-tight sm:text-5xl">{L?.headline ?? t.headline}</h1>
            <p className="mt-4 text-lg text-ink-soft">{L?.sub ?? t.intro}</p>
            {L && <p className="mt-3 text-ink-soft">{t.intro}</p>}
            <AccountCtas status={status} createHref={start} createFreeLabel={L?.cta} secondary={secondary} arrow className="mt-7" />
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

      {L && (
        <section className="border-b border-line" data-testid="trade-landing">
          <Container className="py-14">
            <h2 className="text-2xl font-extrabold">Sound familiar?</h2>
            <ul className="mt-6 grid gap-4 md:grid-cols-3">
              {L.pains.map((p) => <li key={p} className="rounded-xl border border-line bg-surface p-4 text-ink-soft">{p}</li>)}
            </ul>

            <div className="mt-14 grid items-start gap-8 lg:grid-cols-2">
              <figure>
                <h2 className="text-2xl font-extrabold">What your customer receives</h2>
                <p className="mt-2 text-ink-soft">A branded PDF with your logo and details, your scope and terms, and only the prices you choose to show.</p>
                {/* eslint-disable-next-line @next/next/no-img-element -- static, pre-sized image; keeps the page light */}
                <img src={`/media/proposals/${t.slug}-v1.webp`} width={900} height={1165} loading="lazy" decoding="async" alt={`Page 1 of a sample ${lower} proposal made in Built2Bid, showing sections with prices and a total`} className="mt-5 w-full max-w-md rounded-lg border border-line shadow-sm" data-testid="sample-proposal" />
                <figcaption className="mt-2 text-xs text-muted">Real Built2Bid output. Company, customer and prices are example data.</figcaption>
              </figure>
              <div>
                <h2 className="text-2xl font-extrabold">See Built2Bid in action</h2>
                {WELCOME_VIDEO.src ? (
                  <>
                    <p className="mt-2 text-ink-soft">A short walkthrough of building an estimate and sending the proposal. Captions are on.</p>
                    <video className="mt-5 aspect-video w-full rounded-lg border border-line bg-black" controls preload="none" playsInline poster={WELCOME_VIDEO.poster ?? undefined} data-testid="demo-video">
                      <source src={WELCOME_VIDEO.src} type="video/mp4" />
                    </video>
                  </>
                ) : (
                  <VideoPlaceholder className="mt-5" tone="light" />
                )}

                <h2 className="mt-10 flex items-center gap-2 text-2xl font-extrabold"><Calculator className="h-6 w-6 text-accent-dark" aria-hidden />How the {lower} calculators work</h2>
                <p className="mt-2 text-ink-soft">{L.calculator}</p>
                <ul className="mt-3 space-y-1.5">{L.calculatorBullets.map((b) => <li key={b} className="flex gap-2 text-ink-soft"><Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden />{b}</li>)}</ul>
                <p className="mt-2 text-sm text-muted">You can always type quantities yourself. Calculator inputs stay with your estimate, never on the proposal.</p>
              </div>
            </div>

            <h2 className="mt-14 text-2xl font-extrabold">Price it your way, present it professionally</h2>
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <div className="rounded-xl border border-line bg-surface p-4">
                <h3 className="flex items-center gap-2 font-bold"><Percent className="h-4 w-4 text-accent-dark" aria-hidden />Markup or target margin</h3>
                <p className="mt-1 text-sm text-ink-soft">Choose either one and watch cost, price, profit and margin update as you go, so 25% markup is never mistaken for 25% margin.</p>
              </div>
              <div className="rounded-xl border border-line bg-surface p-4">
                <h3 className="flex items-center gap-2 font-bold"><EyeOff className="h-4 w-4 text-accent-dark" aria-hidden />Your costs stay private</h3>
                <p className="mt-1 text-sm text-ink-soft">Internal costs, markup, margin and notes never appear on the proposal.</p>
              </div>
              <div className="rounded-xl border border-line bg-surface p-4">
                <h3 className="font-bold">Four ways to show the price</h3>
                <ul className="mt-1 space-y-1 text-sm text-ink-soft">{PRICE_DISPLAYS.map((d) => <li key={d.title}><span className="font-semibold text-ink">{d.title}:</span> {d.body}</li>)}</ul>
              </div>
            </div>
            <AccountCtas status={status} createHref={start} createFreeLabel={L.cta} secondary={false} arrow className="mt-8" />
          </Container>
        </section>
      )}

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

        <section className="mt-14" data-testid="trade-learn">
          <h2 className="text-2xl font-extrabold">Learn and calculate before you bid</h2>
          <p className="mt-2 text-ink-soft">Free tools and guides. Every calculator result can go straight into a {lower} bid.</p>
          <ul className="mt-6 grid gap-4 md:grid-cols-3">
            {tool && (
              <li className="rounded-xl border border-line bg-surface p-4 hover:border-line-strong">
                <Link href={`/tools/${tool.slug}?from=trade-${t.slug}`} className="flex items-center gap-2 font-bold hover:underline"><Calculator className="h-4 w-4 text-accent-dark" aria-hidden />Free {tool.name.toLowerCase()}</Link>
                <p className="mt-1 text-sm text-ink-soft">{tool.intro}</p>
              </li>
            )}
            {markupTool && (
              <li className="rounded-xl border border-line bg-surface p-4 hover:border-line-strong">
                <Link href={`/tools/${markupTool.slug}?from=trade-${t.slug}`} className="flex items-center gap-2 font-bold hover:underline"><Percent className="h-4 w-4 text-accent-dark" aria-hidden />{markupTool.name}</Link>
                <p className="mt-1 text-sm text-ink-soft">See what 25% markup really earns, and the markup a target margin needs.</p>
              </li>
            )}
            <li className="rounded-xl border border-line bg-surface p-4 hover:border-line-strong">
              <Link href={academy} className="font-bold hover:underline">{t.name} lessons in the Contractor Academy</Link>
              <p className="mt-1 text-sm text-ink-soft">Free courses on pricing, selling and running jobs, with a community of contractors.</p>
            </li>
          </ul>
          {guides.length > 0 && (
            <>
              <h3 className="mt-8 text-xl font-extrabold">{t.name} pricing guides</h3>
              <ul className="mt-4 grid gap-3 md:grid-cols-2">
                {guides.map((g) => (
                  <li key={g.slug} className="rounded-xl border border-line bg-surface p-4 hover:border-line-strong">
                    <Link href={`/learn/${g.slug}`} className="font-bold hover:underline">{g.title}</Link>
                    <p className="mt-1 text-sm text-ink-soft">{g.description}</p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        {related.length > 0 && (
          <>
            <h2 className="mt-14 text-xl font-extrabold">Related trades</h2>
            <ul className="mt-4 flex flex-wrap gap-2">
              {related.map((r) => (
                <li key={r.slug}><Link href={`/bids/${r.slug}`} className="inline-block rounded-full border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:border-brand/40">{r.seoTitle}</Link></li>
              ))}
              <li><Link href="/learn/markup-vs-margin" className="inline-block rounded-full border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:border-brand/40">Markup vs. margin guide</Link></li>
              {pmMarketedLive() && <li><Link href="/#run-the-job" className="inline-block rounded-full border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:border-brand/40">Contractor project scheduling</Link></li>}
              <li><Link href="/pricing" className="inline-block rounded-full border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:border-brand/40">Compare plans</Link></li>
            </ul>
          </>
        )}

        <div className="on-dark blueprint-grid-dark mt-14 rounded-2xl bg-brand p-8 text-white">
          <h2 className="text-2xl font-extrabold">Ready to build your {t.name.toLowerCase()} bid?</h2>
          <p className="mt-2 text-white/80">{status.signedIn ? "Your company details and branding carry over to every bid." : "Start now. Create an account only when you are ready to download."}</p>
          <AccountCtas status={status} createHref={start} createFreeLabel={L?.cta} tone="dark" secondary={status.kind === "no_credits" ? { ...secondary, label: CTA_LABELS.draft } : false} className="mt-5" />
        </div>
      </Container>
    </>
  );
}

function tradeNote(s: AccountStatus): string {
  switch (s.kind) {
    case "signed_out": return `No signup to start. ${plans.starterCredits} free bids to start, plus ${plans.monthlyCredits} every month.`;
    case "free": return s.creditsLeft !== null ? `You have ${creditBadge(s)}. Drafts never use a credit.` : "Drafts never use a credit.";
    case "no_credits": return "You're out of free bids. Drafts and previews still work; get Individual Unlimited to finalize.";
    case "unlimited": return "Individual Unlimited plan: finalize as many bids as you need.";
  }
}
