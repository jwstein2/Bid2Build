import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, MessagesSquare } from "lucide-react";
import { Container } from "@/components/ui/misc";
import { buttonClass } from "@/components/ui/button";
import { TradeIcon } from "@/components/trade-icon";
import { CourseCard } from "@/components/academy/course-card";
import { ResourceCard } from "@/components/academy/resource-card";
import { getTrade, listCourses, listTrades, loadMe, myProgress, tradeResources } from "@/lib/academy/server";
import { PILLARS } from "@/lib/academy/types";
import { openGraphFor } from "@/lib/seo/open-graph";
import { site } from "@/lib/site";

export async function generateMetadata({ params }: PageProps<"/academy/classroom/[trade]">): Promise<Metadata> {
  const { trade } = await params;
  const t = await getTrade(trade);
  if (!t) return { title: "Classroom" };
  const title = t.seo_title ?? `${t.name} Business Courses for Contractors`;
  const description = t.seo_description ?? `Free ${t.name.toLowerCase()} business courses: sales, estimating, project management, financials, hiring and growth.`;
  return { title, description, alternates: { canonical: `/academy/classroom/${t.slug}` }, openGraph: openGraphFor({ title: `${title} | ${site.name}`, description, path: `/academy/classroom/${t.slug}` }) };
}

export default async function TradeClassroom({ params }: PageProps<"/academy/classroom/[trade]">) {
  const { trade: slug } = await params;
  const trade = await getTrade(slug);
  if (!trade) notFound();
  const [{ me }, courses, general, progress, resources, trades] = await Promise.all([
    loadMe(), listCourses({ trade: slug }), listCourses({ trade: null }), myProgress(), tradeResources(slug, 6), listTrades(),
  ]);
  const order = new Map(PILLARS.map((p, i) => [p.key, i]));
  const sorted = [...courses].sort((a, b) => (order.get(a.pillar) ?? 9) - (order.get(b.pillar) ?? 9) || a.sort_order - b.sort_order);
  const live = sorted.filter((c) => c.status === "published").length;
  const isMine = (me.trades ?? []).includes(slug);
  const jsonLd = {
    "@context": "https://schema.org", "@type": "CollectionPage", name: `${trade.name} classroom`, url: `${site.url}/academy/classroom/${slug}`,
    mainEntity: { "@type": "ItemList", itemListElement: [...general, ...sorted].filter((c) => c.status === "published").map((c, i) => ({ "@type": "ListItem", position: i + 1, url: `${site.url}/academy/courses/${c.slug}`, name: c.title })) },
  };

  return (
    <Container className="py-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <Link href="/academy/classroom" className="inline-flex items-center gap-1 text-sm font-semibold text-accent-ink hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden /> All trades</Link>
      <header className="mt-3 flex flex-wrap items-start gap-4">
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-navy text-cyan"><TradeIcon name={trade.icon ?? "Hammer"} className="h-7 w-7" /></span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-3xl font-extrabold">{trade.name} Classroom</h1>
          {trade.intro && <p className="mt-1 max-w-3xl text-ink-soft">{trade.intro}</p>}
          <p className="mt-2 text-sm text-muted">{sorted.length} trade courses · {live} open now · plus the Contractor Sales Academy{isMine ? " · Your trade" : ""}</p>
        </div>
        <label className="w-full sm:w-auto">
          <span className="sr-only">Switch trade</span>
          <form action="/academy/classroom/go" className="flex gap-2">
            <select name="trade" defaultValue={slug} className="rounded-md border border-line-strong bg-surface px-3 py-2 text-sm">
              {trades.map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}
            </select>
            <button className={buttonClass("secondary", "sm")}>Go</button>
          </form>
        </label>
      </header>

      {trade.sales_challenge && (
        <section className="mt-6 rounded-xl border border-accent-ink/30 bg-accent-tint p-4">
          <h2 className="text-sm font-bold text-accent-dark">The sales situation {trade.name.toLowerCase()} contractors meet most</h2>
          <p className="mt-1 text-sm text-ink">{trade.sales_challenge}</p>
        </section>
      )}

      <section className="mt-8" aria-labelledby="courses-h">
        <h2 id="courses-h" className="text-lg font-bold">Courses</h2>
        <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {general.map((c) => <CourseCard key={c.id} course={c} progress={progress.get(c.id)} />)}
          {sorted.map((c) => <CourseCard key={c.id} course={c} tradeName={trade.name} progress={progress.get(c.id)} />)}
        </ul>
        <p className="mt-3 text-xs text-muted">Courses marked &quot;Coming soon&quot; are being written and reviewed. Each one lists its planned lessons and credited resources you can use now.</p>
      </section>

      <section className="mt-10 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-line bg-surface p-5 shadow-card">
          <h2 className="flex items-center gap-2 font-bold"><MessagesSquare className="h-5 w-5 text-accent-ink" aria-hidden /> {trade.name} discussions</h2>
          <p className="mt-1 text-sm text-ink-soft">Ask {trade.name.toLowerCase()} contractors about pricing, crews, customers and tools. Every post can be filtered by trade.</p>
          <Link href={me.member ? `/academy?trade=${slug}` : "/academy/join"} className={buttonClass("secondary", "sm", "mt-3")}>{me.member ? "Open discussions" : "Join to see discussions"}</Link>
        </div>
        <div className="rounded-xl border border-line bg-surface p-5 shadow-card">
          <h2 className="font-bold">Put it into practice in Built2Bid</h2>
          <ul className="mt-2 space-y-2 text-sm">
            <li><Link className="inline-flex items-center gap-1 font-semibold text-accent-ink hover:underline" href={`/start/${slug}`}>Start a {trade.name.toLowerCase()} estimate from the trade template <ArrowRight className="h-3.5 w-3.5" aria-hidden /></Link></li>
            <li><Link className="inline-flex items-center gap-1 font-semibold text-accent-ink hover:underline" href={`/bids/${slug}`}>See what&apos;s in the {trade.name.toLowerCase()} template <ArrowRight className="h-3.5 w-3.5" aria-hidden /></Link></li>
          </ul>
        </div>
      </section>

      {resources.length > 0 && (
        <section className="mt-10" aria-labelledby="res-h">
          <h2 id="res-h" className="text-lg font-bold">Credited resources for {trade.name.toLowerCase()} contractors</h2>
          <p className="mt-1 text-sm text-muted">Hand-picked from independent creators. We link to the original and credit the creator; nothing is copied.</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">{resources.map((r) => <ResourceCard key={r.id} r={r} compact />)}</div>
        </section>
      )}
    </Container>
  );
}
