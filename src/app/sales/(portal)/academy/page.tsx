import Link from "next/link";
import { Card } from "@/components/ui/misc";
import { requireSalesRep } from "@/lib/sales/server";
import { MENTORS, TOPICS, isCertified } from "@/lib/sales/academy";

export const metadata = { title: "Sales Academy" };

export default async function AcademyHome() {
  const { db } = await requireSalesRep();
  const { data } = await db.rpc("sales_my_academy");
  const progress = (data ?? []) as { topic: string; best_score: number; total: number; passed_at: string | null }[];
  const passed = progress.filter((p) => p.passed_at).map((p) => p.topic);
  const certified = isCertified(passed);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold">Sales Academy</h1>
        <p className="mt-1 text-ink-soft">Learn from the greats, one topic at a time. Pass every topic quiz to become <strong>certified to sell</strong> Built2Bid.</p>
      </div>
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-bold">{certified ? "🎓 Certified to sell" : `${passed.length} of ${TOPICS.length} topics passed`}</p>
          <span className="text-sm text-muted">Pass mark: 3 of 4 per topic</span>
        </div>
        <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={TOPICS.length} aria-valuenow={passed.length} aria-label="Certification progress">
          <div className="h-full rounded-full bg-ok" style={{ width: `${Math.round((passed.length / TOPICS.length) * 100)}%` }} />
        </div>
      </Card>
      <ol className="grid gap-3 sm:grid-cols-2">
        {TOPICS.map((t, i) => {
          const p = progress.find((x) => x.topic === t.id);
          return (
            <li key={t.id}>
              <Link href={`/sales/academy/${t.id}`} className="block h-full rounded-xl border border-line bg-surface p-4 hover:border-ink">
                <p className="text-xs font-semibold text-muted">Topic {i + 1}{p?.passed_at ? " · ✓ Passed" : p ? ` · Best ${p.best_score}/${p.total}` : ""}</p>
                <h2 className="mt-1 font-bold">{t.title}</h2>
                <p className="mt-1 text-sm text-ink-soft">{t.goal}</p>
                <p className="mt-2 text-xs text-muted">{t.videos.length} video{t.videos.length === 1 ? "" : "s"} · {t.quiz.length}-question quiz</p>
              </Link>
            </li>
          );
        })}
      </ol>
      <Card className="p-5">
        <h2 className="text-lg font-bold">Our teachers</h2>
        <p className="mt-1 text-sm text-ink-soft">Lessons are our own short summaries of their ideas. Go to the source for the full material.</p>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {Object.values(MENTORS).map((m) => (
            <li key={m.id} className="text-sm">
              <p className="font-semibold">{m.name}</p>
              <p className="text-ink-soft">{m.knownFor}</p>
              <p className="mt-1 space-x-3">
                <a href={m.site.url} target="_blank" rel="noopener noreferrer" className="text-brand underline">{m.site.label}</a>
                {m.book && <a href={m.book.url} target="_blank" rel="noopener noreferrer" className="text-brand underline">Book: {m.book.title}</a>}
                <a href={m.channel.url} target="_blank" rel="noopener noreferrer" className="text-brand underline">YouTube</a>
              </p>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
