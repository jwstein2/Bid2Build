import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, Circle, Eye, Lock } from "lucide-react";
import { Container, Notice } from "@/components/ui/misc";
import { AdvancedOffer } from "@/components/academy/advanced/offer";
import { SubjectIcon } from "@/components/academy/advanced/subject-card";
import { advancedState, getSubject } from "@/lib/academy/advanced/server";
import { getCourse } from "@/lib/academy/server";

export async function generateMetadata({ params }: PageProps<"/academy/advanced/[subject]">): Promise<Metadata> {
  const { subject } = await params;
  const s = await getSubject(subject);
  if (!s) return { title: "Advanced Learning" };
  return { title: `${s.title} | Advanced Learning`, description: s.summary, alternates: { canonical: `/academy/advanced/${s.slug}` } };
}

export default async function SubjectPage({ params, searchParams }: PageProps<"/academy/advanced/[subject]">) {
  const { subject: slug } = await params;
  const sp = await searchParams;
  const state = await advancedState();
  if (!state.visible) notFound();
  const s = await getSubject(slug, { includeDraft: state.staff });
  if (!s) notFound();
  const courses = (await Promise.all(s.courses.map((c) => getCourse(c.slug)))).filter((c): c is NonNullable<typeof c> => Boolean(c));
  const total = courses.reduce((n, c) => n + c.outline.length, 0);
  const minutes = courses.reduce((n, c) => n + c.outline.reduce((m, o) => m + (o.estimated_minutes ?? 0), 0), 0);
  return (
    <Container className="py-8">
      <Link href="/academy/advanced" className="inline-flex items-center gap-1 text-sm font-semibold text-accent-ink hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden /> Advanced Learning</Link>
      {sp.checkout === "cancelled" && <Notice className="mt-4" title="Checkout cancelled">Nothing was charged and your free access is unchanged.</Notice>}
      <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs font-bold tracking-wide text-accent-ink uppercase"><SubjectIcon name={s.icon} className="h-4 w-4" /> Advanced subject{s.status !== "published" ? ` · ${s.status === "upcoming" ? "Upcoming" : "Draft"}` : ""}</p>
          <h1 className="mt-1 font-display text-3xl font-extrabold">{s.title}</h1>
          <p className="mt-2 text-lg text-ink-soft">{s.summary}</p>
          {s.description && <p className="mt-4 text-ink-soft">{s.description}</p>}
          {s.outcomes.length > 0 && (
            <section className="mt-6 rounded-xl border border-line bg-surface p-5" aria-labelledby="out-h">
              <h2 id="out-h" className="font-bold">What you&apos;ll be able to do</h2>
              <ul className="mt-2 space-y-1.5 text-sm text-ink-soft">{s.outcomes.map((o) => <li key={o} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden />{o}</li>)}</ul>
            </section>
          )}
        </div>
        <aside className="rounded-xl border border-line bg-surface p-5 text-sm lg:self-start">
          <p className="font-bold">At a glance</p>
          <ul className="mt-2 space-y-1 text-ink-soft">
            <li>{total} lessons{minutes ? `, about ${Math.round((minutes / 60) * 10) / 10} hours` : ""}</li>
            <li>Exercises and a knowledge check in every lesson</li>
            <li>A capstone project and final assessment</li>
            <li>Practice steps inside Built2Bid</li>
          </ul>
        </aside>
      </div>

      <div className="mt-8"><AdvancedOffer subject={s.slug} /></div>

      <section className="mt-10" aria-labelledby="cur-h">
        <h2 id="cur-h" className="text-lg font-bold">Curriculum</h2>
        {courses.map((c) => (
          <div key={c.course.id} className="mt-4 overflow-hidden rounded-xl border border-line bg-surface">
            <p className="border-b border-line px-4 py-3 font-semibold">{c.course.title}{c.course.status !== "published" ? <span className="ml-2 text-xs font-semibold text-muted">({c.course.status === "in_review" ? "in review" : c.course.status})</span> : null}</p>
            <ol className="divide-y divide-line">
              {c.outline.map((o, i) => (
                <li key={o.id}>
                  <Link href={`/academy/courses/${c.course.slug}/${o.slug}`} className="flex items-start gap-3 px-4 py-3 hover:bg-paper" data-testid="curriculum-lesson" data-locked={o.locked}>
                    {o.completed ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-label="Completed" /> : o.locked ? <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-label="Locked" /> : o.access !== "advanced" ? <Eye className="mt-0.5 h-4 w-4 shrink-0 text-accent-ink" aria-label="Free preview" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-line-strong" aria-hidden />}
                    <span className="min-w-0">
                      <span className="block font-semibold">{i + 1}. {o.title}{o.access !== "advanced" && <span className="ml-2 rounded bg-brand-tint px-1.5 py-0.5 text-[11px] font-bold text-navy">Free preview</span>}</span>
                      {o.summary && <span className="mt-0.5 block text-sm text-ink-soft">{o.summary}</span>}
                    </span>
                    {o.estimated_minutes ? <span className="ml-auto shrink-0 text-xs text-muted">{o.estimated_minutes} min</span> : null}
                  </Link>
                </li>
              ))}
              {!c.outline.length && <li className="px-4 py-3 text-sm text-ink-soft">Lessons are being written.</li>}
            </ol>
          </div>
        ))}
        {!courses.length && <p className="mt-2 text-sm text-ink-soft">Lessons for this subject are being written.</p>}
      </section>
    </Container>
  );
}
