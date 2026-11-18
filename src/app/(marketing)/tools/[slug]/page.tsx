import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Container } from "@/components/ui/misc";
import { LearnTabs } from "@/components/marketing/learn-tabs";
import { QuantityToolForm } from "@/components/marketing/tools/quantity-tool";
import { MarkupToolForm } from "@/components/marketing/tools/markup-tool";
import { cleanFrom, TOOLS, toolBySlug } from "@/lib/marketing/tools";
import { getTrade, trades } from "@/lib/trades/catalog";
import { articles } from "@/lib/learn/articles";
import { openGraphFor } from "@/lib/seo/open-graph";
import { site } from "@/lib/site";

export const dynamicParams = false;
export function generateStaticParams() {
  return TOOLS.map((t) => ({ slug: t.slug }));
}

export async function generateMetadata({ params }: PageProps<"/tools/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const t = toolBySlug(slug);
  if (!t) return {};
  return {
    title: t.title,
    description: t.description,
    alternates: { canonical: `/tools/${t.slug}` },
    openGraph: openGraphFor({ title: `${t.title} | ${site.name}`, description: t.description, path: `/tools/${t.slug}` }),
  };
}

export default async function ToolPage({ params, searchParams }: PageProps<"/tools/[slug]">) {
  const { slug } = await params;
  const tool = toolBySlug(slug);
  if (!tool) notFound();
  const from = cleanFrom((await searchParams).from);
  const trade = tool.kind === "quantity" ? getTrade(tool.trade) : undefined;
  const guide = tool.guide ? articles.find((a) => a.slug === tool.guide) : undefined;
  const others = TOOLS.filter((t) => t.slug !== tool.slug);
  const url = `${site.url}/tools/${tool.slug}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebApplication",
        name: tool.name,
        url,
        description: tool.description,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Any",
        isAccessibleForFree: true,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        publisher: { "@type": "Organization", name: site.name, url: site.url },
      },
      {
        "@type": "HowTo",
        name: `How to use the ${tool.name.toLowerCase()}`,
        step: tool.steps.map((s, i) => ({ "@type": "HowToStep", position: i + 1, name: s.name, text: s.text })),
      },
      {
        "@type": "FAQPage",
        mainEntity: tool.faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Calculators", item: `${site.url}/tools` },
          { "@type": "ListItem", position: 2, name: tool.name, item: url },
        ],
      },
    ],
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Container className="py-10">
        <LearnTabs current="/tools" />
        <nav aria-label="Breadcrumb" className="text-sm text-muted"><Link href="/tools" className="hover:text-ink">Calculators</Link> / <span>{tool.name}</span></nav>
        <div className="mt-3 grid gap-8 lg:grid-cols-[1.25fr_1fr]">
          <div className="min-w-0">
            <h1 className="text-3xl font-extrabold leading-tight sm:text-4xl">{tool.title}</h1>
            <p className="mt-3 text-lg text-ink-soft">{tool.intro}</p>
            <div className="mt-6">
              {tool.kind === "quantity"
                ? <QuantityToolForm tool={tool} tradeName={trade?.name ?? "new"} from={from} />
                : <MarkupToolForm tool={tool} trades={[...trades].sort((a, b) => a.name.localeCompare(b.name)).map((t) => ({ slug: t.slug, name: t.name }))} from={from} />}
            </div>
          </div>
          <aside className="space-y-6">
            <section className="rounded-2xl border border-line bg-paper p-5">
              <h2 className="font-bold">How to use it</h2>
              <ol className="mt-3 space-y-3">
                {tool.steps.map((s, i) => (
                  <li key={s.name} className="flex gap-3">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-navy text-xs font-bold text-white">{i + 1}</span>
                    <div><p className="font-semibold">{s.name}</p><p className="text-sm text-ink-soft">{s.text}</p></div>
                  </li>
                ))}
              </ol>
            </section>
            {trade && (
              <section className="rounded-2xl border border-line bg-surface p-5">
                <h2 className="font-bold">Building a {trade.name.toLowerCase()} bid?</h2>
                <p className="mt-1 text-sm text-ink-soft">{trade.intro}</p>
                <Link href={`/bids/${trade.slug}`} className="mt-2 inline-block text-sm font-semibold text-accent-ink hover:underline">See the {trade.name.toLowerCase()} estimate builder</Link>
              </section>
            )}
          </aside>
        </div>

        <h2 className="mt-14 text-2xl font-extrabold">{tool.name} FAQ</h2>
        <div className="mt-5 divide-y divide-line rounded-xl border border-line bg-surface">
          {tool.faqs.map((f) => (
            <div key={f.q} className="p-5">
              <h3 className="font-semibold">{f.q}</h3>
              <p className="mt-1 text-ink-soft">{f.a}</p>
            </div>
          ))}
        </div>

        <h2 className="mt-12 text-xl font-extrabold">More free tools and guides</h2>
        <ul className="mt-4 flex flex-wrap gap-2">
          {others.map((o) => (
            <li key={o.slug}><Link href={`/tools/${o.slug}`} className="inline-block rounded-full border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:border-brand/40">{o.name}</Link></li>
          ))}
          {guide && <li><Link href={`/learn/${guide.slug}`} className="inline-block rounded-full border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:border-brand/40">{guide.title}</Link></li>}
          <li><Link href="/learn" className="inline-block rounded-full border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:border-brand/40">All guides</Link></li>
          <li><Link href="/academy/classroom" className="inline-block rounded-full border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:border-brand/40">Contractor Academy</Link></li>
        </ul>
      </Container>
    </>
  );
}
