import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/misc";
import { articles, getArticle } from "@/lib/learn/articles";
import { site } from "@/lib/site";

export const dynamicParams = false;
export function generateStaticParams() { return articles.map((a) => ({ slug: a.slug })); }

export async function generateMetadata({ params }: PageProps<"/learn/[slug]">): Promise<Metadata> {
  const a = getArticle((await params).slug);
  if (!a) return {};
  return { title: a.title, description: a.description, alternates: { canonical: `/learn/${a.slug}` }, openGraph: { title: a.title, description: a.description, type: "article" } };
}

export default async function ArticlePage({ params }: PageProps<"/learn/[slug]">) {
  const a = getArticle((await params).slug);
  if (!a) notFound();
  const ld = { "@context": "https://schema.org", "@type": "Article", headline: a.title, description: a.description, dateModified: a.updated, publisher: { "@type": "Organization", name: site.name } };
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
        <div className="mt-10 rounded-xl border border-line bg-surface p-5">
          <p className="font-bold">Put it into practice</p>
          <p className="mt-1 text-sm text-ink-soft">Build an estimate and proposal free. Three finished bids every month.</p>
          <ButtonLink href="/bids" variant="accent" className="mt-3">Start a bid</ButtonLink>
        </div>
      </article>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, "\\u003c") }} />
    </Container>
  );
}
