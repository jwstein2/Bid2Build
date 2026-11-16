import { openGraphFor } from "@/lib/seo/open-graph";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Container } from "@/components/ui/misc";
import { articles, getArticle } from "@/lib/learn/articles";
import { plans, site } from "@/lib/site";
import { getTrade } from "@/lib/trades/catalog";
import { AccountCtas } from "@/components/account/account-ctas";
import { getAccountStatus } from "@/lib/account/server";

export const dynamicParams = false;
export function generateStaticParams() { return articles.map((a) => ({ slug: a.slug })); }

export async function generateMetadata({ params }: PageProps<"/learn/[slug]">): Promise<Metadata> {
  const a = getArticle((await params).slug);
  if (!a) return {};
  return { title: a.title, description: a.description, alternates: { canonical: `/learn/${a.slug}` }, openGraph: openGraphFor({ title: a.title, description: a.description, path: `/learn/${a.slug}`, type: "article", ownImage: true }) };
}

export default async function ArticlePage({ params }: PageProps<"/learn/[slug]">) {
  const a = getArticle((await params).slug);
  if (!a) notFound();
  const status = await getAccountStatus();
  const trade = a.trade ? getTrade(a.trade) : undefined;
  const ld = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: a.title,
    description: a.description,
    datePublished: a.published ?? a.updated,
    dateModified: a.updated,
    mainEntityOfPage: `${site.url}/learn/${a.slug}`,
    author: { "@type": "Organization", name: site.name, url: site.url },
    publisher: { "@type": "Organization", name: site.name, logo: { "@type": "ImageObject", url: `${site.url}/brand/icon-512.png` } },
  };
  return (
    <Container className="py-12">
      <article className="mx-auto max-w-2xl">
        <Link href="/learn" className="text-sm text-ink-soft underline">Learn</Link>
        <h1 className="mt-2 text-4xl font-extrabold leading-tight">{a.title}</h1>
        <p className="mt-2 text-sm text-muted">Updated {new Date(a.updated + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>
        <div className="mt-6 space-y-5 leading-relaxed">
          {a.blocks.map((b, i) => (
            <section key={i}>
              {b.h && <h2 className="mb-2 text-xl font-bold">{b.h}</h2>}
              {b.p?.map((t) => <p key={t} className="mb-3 text-ink-soft">{t}</p>)}
              {b.formula && <div className="mb-3 rounded-lg bg-brand-tint px-4 py-3 font-mono text-sm">{b.formula.map((f) => <p key={f}>{f}</p>)}</div>}
              {b.list && <ul className="mb-3 list-disc space-y-1 pl-5 text-ink-soft">{b.list.map((t) => <li key={t}>{t}</li>)}</ul>}
            </section>
          ))}
        </div>
        {a.sources && a.sources.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-2 text-lg font-bold">Further reading</h2>
            <ul className="list-disc space-y-1 pl-5 text-sm text-ink-soft">
              {a.sources.map((s) => (
                <li key={s.url}><a href={s.url} target="_blank" rel="nofollow noopener noreferrer" className="underline">{s.title}</a></li>
              ))}
            </ul>
          </section>
        )}
        {trade && (
          <p className="mt-8 text-ink-soft">
            Building a {trade.name.toLowerCase()} bid? See the <Link href={`/bids/${trade.slug}`} className="font-semibold text-ink underline">{trade.seoTitle}</Link> for the sections and items most {trade.name.toLowerCase()} estimates include.
          </p>
        )}
        <div className="mt-10 rounded-xl border border-line bg-surface p-5">
          <p className="font-bold">Put it into practice</p>
          <p className="mt-1 text-sm text-ink-soft">{status.kind === "no_credits" ? "Drafts are always free. Go Unlimited to finalize as many bids as you need." : status.signedIn ? "Open a new bid and apply it to your next estimate." : `Build an estimate and proposal free. ${plans.starterCredits} free bids to start, plus ${plans.monthlyCredits} every month.`}</p>
          <AccountCtas status={status} size="md" secondary={false} className="mt-3" />
        </div>
      </article>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, "\\u003c") }} />
    </Container>
  );
}
