import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
import { Container } from "@/components/ui/misc";
import { TradeIcon } from "@/components/trade-icon";
import { CourseCard } from "@/components/academy/course-card";
import { listCourses, listTrades, loadMe, myProgress } from "@/lib/academy/server";
import { openGraphFor } from "@/lib/seo/open-graph";
import { site } from "@/lib/site";
import { ChallengeCard } from "@/components/academy/challenge-card";
import { loadChallenge } from "@/lib/academy/rewards-server";

const title = "Contractor Classroom: Free Business Courses by Trade";
const description = "Free business courses for contractors, organized by trade: sales, estimating, project management, financials, hiring, recurring revenue and safety.";
export const metadata: Metadata = {
  title, description, alternates: { canonical: "/academy/classroom" },
  openGraph: openGraphFor({ title: `${title} | ${site.name}`, description, path: "/academy/classroom" }),
};

const FAMILIES = ["Exterior", "Interior", "Systems", "Sitework", "Structures", "General"];

export default async function ClassroomPage({ searchParams }: PageProps<"/academy/classroom">) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 60).trim() : "";
  const [{ me }, trades, all, progress, challenge] = await Promise.all([loadMe(), listTrades(), listCourses({}), myProgress(), loadChallenge()]);
  const tradeName = new Map(trades.map((t) => [t.slug, t.name]));
  const tradeIcon = new Map(trades.map((t) => [t.slug, t.icon ?? "Hammer"]));
  const general = all.filter((c) => !c.trade_slug);
  const counts = new Map<string, { live: number; total: number }>();
  for (const c of all) if (c.trade_slug) { const x = counts.get(c.trade_slug) ?? { live: 0, total: 0 }; x.total++; if (c.status === "published") x.live++; counts.set(c.trade_slug, x); }
  const mine = (me.trades ?? []).filter((t) => tradeName.has(t));
  const results = q ? all.filter((c) => `${c.title} ${c.summary} ${c.trade_slug ? tradeName.get(c.trade_slug) : ""}`.toLowerCase().includes(q.toLowerCase())).slice(0, 48) : [];

  return (
    <Container className="py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-extrabold">Classroom</h1>
          <p className="mt-1 max-w-2xl text-ink-soft">Business courses organized by trade. Start with the Sales Academy, then open your trade&apos;s classroom.</p>
        </div>
        <form action="/academy/classroom" role="search" className="relative w-full max-w-sm">
          <label htmlFor="course-q" className="sr-only">Search courses</label>
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <input id="course-q" name="q" defaultValue={q} placeholder="Search courses or trades" className="w-full rounded-md border border-line-strong bg-surface py-2 pr-3 pl-9 text-sm" />
        </form>
      </div>

      {challenge ? <ChallengeCard status={challenge} className="mt-6 max-w-xl" /> : (
        <Link href="/academy/challenge" className="mt-6 block max-w-xl rounded-xl border border-line bg-surface p-4 shadow-card hover:border-line-strong" data-testid="challenge-promo">
          <span className="block font-bold">Learn More. Build Better. Earn a Free Month.</span>
          <span className="mt-1 block text-sm text-ink-soft">Finish 4 trainings and pass one 20-question quiz (80%) in the same month to earn one free month of Individual Unlimited. One per account, lifetime.</span>
        </Link>
      )}

      {q ? (
        <section className="mt-8">
          <h2 className="text-lg font-bold">{results.length ? `Courses matching “${q}”` : `No courses match “${q}”`}</h2>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{results.map((c) => <CourseCard key={c.id} course={c} tradeName={c.trade_slug ? tradeName.get(c.trade_slug) : null} progress={progress.get(c.id)} />)}</ul>
        </section>
      ) : (
        <>
          <section className="mt-8" aria-labelledby="featured-h">
            <h2 id="featured-h" className="text-lg font-bold">For every trade</h2>
            <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{general.map((c) => <CourseCard key={c.id} course={c} progress={progress.get(c.id)} />)}</ul>
          </section>
          {mine.length > 0 && (
            <section className="mt-10" aria-labelledby="mine-h">
              <h2 id="mine-h" className="text-lg font-bold">Your trades</h2>
              <ul className="mt-3 flex flex-wrap gap-2">
                {mine.map((t) => <li key={t}><Link href={`/academy/classroom/${t}`} className="inline-flex items-center gap-2 rounded-full border border-navy bg-navy px-4 py-2 text-sm font-semibold text-white"><TradeIcon name={tradeIcon.get(t) ?? "Hammer"} className="h-4 w-4" /> {tradeName.get(t)}</Link></li>)}
              </ul>
            </section>
          )}
          <section className="mt-10" aria-labelledby="trades-h">
            <h2 id="trades-h" className="text-lg font-bold">Browse by trade</h2>
            {FAMILIES.map((fam) => {
              const list = trades.filter((t) => t.family === fam);
              if (!list.length) return null;
              return (
                <div key={fam} className="mt-5">
                  <h3 className="text-xs font-bold tracking-wide text-muted uppercase">{fam}</h3>
                  <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {list.map((t) => {
                      const c = counts.get(t.slug) ?? { live: 0, total: 0 };
                      return (
                        <li key={t.slug}>
                          <Link href={`/academy/classroom/${t.slug}`} className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3 shadow-card hover:border-line-strong" data-testid="trade-tile">
                            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-tint text-navy"><TradeIcon name={t.icon ?? "Hammer"} className="h-5 w-5" /></span>
                            <span className="min-w-0">
                              <span className="block font-semibold">{t.name}</span>
                              <span className="block text-xs text-muted">{c.total} courses{c.live ? ` · ${c.live} open now` : ""}</span>
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </section>
        </>
      )}
    </Container>
  );
}
