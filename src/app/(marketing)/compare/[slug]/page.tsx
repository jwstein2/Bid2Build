import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Check } from "lucide-react";
import { Container } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { COMPARISONS, getComparison } from "@/lib/marketing/comparisons";
import { FACTS_PATH } from "@/lib/marketing/product-facts";
import { openGraphFor } from "@/lib/seo/open-graph";
import { breadcrumbLd, ldJson } from "@/lib/seo/structured-data";
import { site } from "@/lib/site";

export const dynamicParams = false;
export function generateStaticParams() { return COMPARISONS.map((c) => ({ slug: c.slug })); }

const titleFor = (name: string) => `${site.name} vs ${name}: features, pricing and fit`;
const descFor = (name: string) => `An honest comparison of ${site.name} and ${name} for small contractors: prices, estimating, signatures, scheduling and payments, with sources and when each one fits better.`;
const fmt = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

export async function generateMetadata({ params }: PageProps<"/compare/[slug]">): Promise<Metadata> {
  const c = getComparison((await params).slug);
  if (!c) return {};
  const path = `/compare/${c.slug}`;
  return { title: titleFor(c.name), description: descFor(c.name), alternates: { canonical: path }, openGraph: openGraphFor({ title: titleFor(c.name), description: descFor(c.name), path }) };
}

export default async function ComparisonPage({ params }: PageProps<"/compare/[slug]">) {
  const c = getComparison((await params).slug);
  if (!c) notFound();
  const path = `/compare/${c.slug}`;
  const json = ldJson(
    { "@type": "WebPage", "@id": `${site.url}${path}`, url: `${site.url}${path}`, name: titleFor(c.name), description: descFor(c.name), dateModified: c.verifiedOn, publisher: { "@id": `${site.url}/#organization` }, about: { "@id": `${site.url}/#software` } },
    breadcrumbLd([{ name: "Compare", path: "/compare" }, { name: `${site.name} vs ${c.name}`, path }]),
  );
  return (
    <Container className="py-12 sm:py-16">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />
      <article className="mx-auto max-w-4xl" data-testid="comparison">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-accent-ink"><Link href="/compare" className="hover:underline">Compare</Link></p>
        <h1 className="mt-2 text-4xl font-extrabold text-navy">{site.name} vs {c.name}</h1>
        <p className="mt-4 text-lg text-ink-soft">{c.summary}</p>
        <p className="mt-3 text-sm text-ink-soft">
          {c.them} {c.name} details were checked on <time dateTime={c.verifiedOn}>{fmt(c.verifiedOn)}</time> from {c.name}&apos;s own pages (sources below). Promotions are left out; prices change, so check their site before you decide. We make {site.name}, so read this with that in mind.
        </p>

        <div className="mt-8 overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[640px] text-left text-sm">
            <caption className="sr-only">{site.name} compared with {c.name}</caption>
            <thead className="border-b border-line bg-paper text-ink">
              <tr><th scope="col" className="w-40 p-4 font-semibold"> </th><th scope="col" className="p-4 font-semibold">{site.name}</th><th scope="col" className="p-4 font-semibold">{c.name}</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {c.rows.map((r) => (
                <tr key={r.topic} className="align-top">
                  <th scope="row" className="p-4 font-semibold text-ink">{r.topic}</th>
                  <td className="p-4 text-ink-soft">{r.built2bid}</td>
                  <td className="p-4 text-ink-soft">{r.them}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          <section aria-labelledby="them-h" className="rounded-xl border border-line bg-surface p-5">
            <h2 id="them-h" className="text-xl font-extrabold text-navy">{c.name} may fit better if</h2>
            <ul className="mt-3 space-y-2 text-sm text-ink-soft">{c.chooseThem.map((x) => <li key={x} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden />{x}</li>)}</ul>
          </section>
          <section aria-labelledby="us-h" className="rounded-xl border border-line bg-surface p-5">
            <h2 id="us-h" className="text-xl font-extrabold text-navy">{site.name} may fit better if</h2>
            <ul className="mt-3 space-y-2 text-sm text-ink-soft">{c.chooseUs.map((x) => <li key={x} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden />{x}</li>)}</ul>
          </section>
        </div>

        <section aria-labelledby="src-h" className="mt-10 text-sm">
          <h2 id="src-h" className="text-lg font-bold text-ink">Sources</h2>
          <ul className="mt-2 space-y-1 text-ink-soft">
            {c.sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="font-semibold text-accent-ink underline">{s.label}</a>, checked {fmt(c.verifiedOn)}</li>)}
            <li><Link href={FACTS_PATH} className="font-semibold text-accent-ink underline">{site.name} product facts</Link> and <Link href="/pricing" className="font-semibold text-accent-ink underline">pricing</Link></li>
          </ul>
          <p className="mt-3 text-ink-soft">{c.name} is a trademark of its owner. {site.name} is not affiliated with {c.name}. Spot something out of date? Email <a href={`mailto:${site.supportEmail}`} className="font-semibold text-accent-ink underline">{site.supportEmail}</a> and we&apos;ll fix it.</p>
        </section>

        <div className="mt-10 flex flex-wrap items-center gap-4">
          <ButtonLink href="/#trades" variant="accent" size="lg" data-cta={`compare-${c.slug}-start`}>Build a free estimate</ButtonLink>
          <Link href="/pricing" className="inline-flex min-h-11 items-center font-semibold text-accent-ink underline-offset-4 hover:underline">View pricing</Link>
        </div>
      </article>
    </Container>
  );
}
