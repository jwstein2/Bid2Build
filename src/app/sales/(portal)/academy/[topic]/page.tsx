import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/misc";
import { requireSalesRep } from "@/lib/sales/server";
import { MENTORS, TOPICS, topicById } from "@/lib/sales/academy";
import { AcademyVideo } from "@/components/sales/academy-video";
import { AcademyQuiz } from "@/components/sales/academy-quiz";

export default async function AcademyTopic({ params }: { params: Promise<{ topic: string }> }) {
  await requireSalesRep();
  const t = topicById((await params).topic);
  if (!t) notFound();
  const i = TOPICS.indexOf(t);
  const next = TOPICS[i + 1];
  return (
    <div className="space-y-6">
      <div>
        <Link href="/sales/academy" className="text-sm font-semibold text-brand underline">← Sales Academy</Link>
        <h1 className="mt-2 text-3xl font-extrabold">{t.title}</h1>
        <p className="mt-1 text-ink-soft">{t.goal}</p>
      </div>
      <Card className="p-5">
        <h2 className="text-lg font-bold">Key ideas</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {t.principles.map((p, k) => <li key={k}><span className="font-semibold">{MENTORS[p.mentor].name}:</span> {p.text}</li>)}
        </ul>
        <div className="mt-4 rounded-lg bg-paper p-4 text-sm"><p className="font-semibold">Try it on a contractor</p><p className="mt-1 italic">{t.tryIt}</p></div>
      </Card>
      {t.videos.length > 0 && (
        <section aria-labelledby="videos-h">
          <h2 id="videos-h" className="mb-3 text-lg font-bold">Watch</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{t.videos.map((v) => <AcademyVideo key={v.id} v={v} />)}</div>
          <p className="mt-2 text-xs text-muted">Videos play from each teacher&apos;s official YouTube channel. Credit and rights belong to them.</p>
        </section>
      )}
      <Card className="p-5">
        <h2 className="text-lg font-bold">Quiz</h2>
        <p className="mt-1 mb-4 text-sm text-ink-soft">Get 3 of 4 right to pass this topic.</p>
        <AcademyQuiz topicId={t.id} questions={t.quiz.map((q) => ({ q: q.q, options: q.options }))} />
      </Card>
      {next && <Link href={`/sales/academy/${next.id}`} className="inline-block font-semibold text-brand underline">Next topic: {next.title} →</Link>}
    </div>
  );
}
