import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Container } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { FreeCalculator, PrintButton } from "@/components/marketing/free/free-calculators";
import { FREE_RESOURCES, MARKUP_ROWS, marginFromMarkup, resourceBySlug } from "@/lib/marketing/free-resources";
import { openGraphFor } from "@/lib/seo/open-graph";
import { site } from "@/lib/site";

export const dynamicParams = false;
export function generateStaticParams() {
  return FREE_RESOURCES.map((r) => ({ slug: r.slug }));
}

export async function generateMetadata({ params }: PageProps<"/free/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const r = resourceBySlug(slug);
  if (!r) return {};
  return {
    title: r.title,
    description: r.description,
    alternates: { canonical: `/free/${r.slug}` },
    openGraph: openGraphFor({ title: `${r.title} | ${site.name}`, description: r.description, path: `/free/${r.slug}` }),
  };
}

export default async function FreeResourcePage({ params }: PageProps<"/free/[slug]">) {
  const { slug } = await params;
  const r = resourceBySlug(slug);
  if (!r) notFound();
  const others = FREE_RESOURCES.filter((o) => o.slug !== r.slug);
  const hasExamples = r.kind === "calculator";

  return (
    <Container className="py-10">
      <nav aria-label="Breadcrumb" className="text-sm text-muted print:hidden"><Link href="/free" className="hover:text-ink">Free worksheets</Link> / <span>{r.name}</span></nav>
      <div className="mt-3 max-w-3xl">
        <h1 className="text-3xl font-extrabold leading-tight sm:text-4xl">{r.name}</h1>
        <p className="mt-3 text-lg text-ink-soft">{r.intro}</p>
        <div className="mt-4"><PrintButton /></div>

        <div className="mt-6">
          {r.kind === "calculator" && r.calculator && <FreeCalculator id={r.calculator} />}

          {r.kind === "table" && (
            <table className="w-full overflow-hidden rounded-xl border border-line bg-surface text-left" data-testid="margin-table">
              <thead className="bg-paper text-sm"><tr><th className="p-3">Markup on cost</th><th className="p-3">Margin of the price</th><th className="p-3">On a $10,000 cost, price is</th></tr></thead>
              <tbody className="tabular">
                {MARKUP_ROWS.map((m) => (
                  <tr key={m} className="border-t border-line">
                    <td className="p-3 font-semibold">{m}%</td>
                    <td className="p-3">{marginFromMarkup(m).toFixed(1)}%</td>
                    <td className="p-3">{(10000 * (1 + m / 100)).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {(r.kind === "checklist" || r.kind === "template") && r.items && (
            <ol className="divide-y divide-line rounded-xl border border-line bg-surface" data-testid="resource-items">
              {r.items.map((it) => (
                <li key={it.heading} className="flex gap-3 p-4">
                  {r.kind === "checklist" && <span aria-hidden className="mt-1 h-5 w-5 shrink-0 rounded border-2 border-line-strong" />}
                  <div><h2 className="font-bold">{it.heading}</h2><p className="mt-1 text-ink-soft">{it.text}</p></div>
                </li>
              ))}
            </ol>
          )}
        </div>

        {r.kind === "table" && <p className="mt-3 text-sm text-ink-soft">Margin = markup ÷ (100 + markup). A 30% markup gives 30 ÷ 130 = 23.1%.</p>}
        {hasExamples && <p className="mt-3 text-sm text-muted">The starting numbers are fictional examples. Nothing you type is saved or sent anywhere.</p>}
        <p className="mt-3 text-sm text-muted">General information, not legal, tax or financial advice. Check your state’s rules for contracts and deposits.</p>

        <section className="mt-10 rounded-2xl border border-line bg-paper p-5 print:hidden">
          <h2 className="font-bold">Made by Built2Bid</h2>
          <p className="mt-1 text-sm text-ink-soft">Built2Bid is our estimating software for contractors. You can start a bid free, no account needed.</p>
          <ButtonLink href="/bids" className="mt-3" size="sm">Start a free bid</ButtonLink>
        </section>

        {r.related && (
          <ul className="mt-6 flex flex-wrap gap-2 print:hidden">
            {r.related.map((l) => <li key={l.href}><Link href={l.href} className="inline-block rounded-full border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:border-brand/40">{l.label}</Link></li>)}
          </ul>
        )}

        <h2 className="mt-12 text-xl font-extrabold print:hidden">More free worksheets</h2>
        <ul className="mt-4 flex flex-wrap gap-2 print:hidden">
          {others.map((o) => <li key={o.slug}><Link href={`/free/${o.slug}`} className="inline-block rounded-full border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:border-brand/40">{o.name}</Link></li>)}
        </ul>
      </div>
    </Container>
  );
}
