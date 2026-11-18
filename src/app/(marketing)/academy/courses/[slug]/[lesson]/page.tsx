import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, CheckCircle2, Circle, Lock, Sparkles } from "lucide-react";
import { Container, Notice } from "@/components/ui/misc";
import { buttonClass } from "@/components/ui/button";
import { Flash } from "@/components/creator/flash";
import { Markdown } from "@/components/academy/markdown";
import { ResourceCard } from "@/components/academy/resource-card";
import { Quiz } from "@/components/academy/quiz";
import { Submit } from "@/components/academy/controls";
import { getLesson, loadMe } from "@/lib/academy/server";
import type { AppAction } from "@/lib/academy/types";
import { isPmEnabled } from "@/lib/env";
import { loadPmAccess } from "@/lib/pm/server";
import { createClient } from "@/lib/supabase/server";
import { openGraphFor } from "@/lib/seo/open-graph";
import { site } from "@/lib/site";
import { completeLesson } from "../../../actions";
import timelineShot from "@/assets/marketing/timeline.webp";

const tradeLabel = (slug: string) => slug.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

export async function generateMetadata({ params }: PageProps<"/academy/courses/[slug]/[lesson]">): Promise<Metadata> {
  const { slug, lesson } = await params;
  const r = await getLesson(slug, lesson);
  if (!r) return { title: "Lesson" };
  const title = r.state === "ok" ? `${r.lesson.title} | ${r.course.title}` : r.title;
  const description = r.state === "ok" ? (r.lesson.summary ?? r.course.summary) : r.course.summary;
  // Only lessons open to everyone are indexable; member and premium lessons are not shown to crawlers.
  const indexable = r.state === "ok" && r.lesson.access === "public";
  return {
    title, description, alternates: { canonical: `/academy/courses/${slug}/${lesson}` }, robots: indexable ? undefined : { index: false, follow: true },
    openGraph: openGraphFor({ title: `${title} | ${site.name}`, description, path: `/academy/courses/${slug}/${lesson}` }),
  };
}

/** Deep link into Built2Bid. Project Command Center links respect the PM entitlement: preview + upgrade when the member lacks it. */
async function AppActionCard({ action, signedIn }: { action: AppAction; signedIn: boolean }) {
  let allowed = true;
  if (action.area === "pm" || action.area === "schedule") {
    allowed = false;
    if (signedIn && isPmEnabled()) {
      const access = await loadPmAccess(await createClient());
      allowed = Boolean(access && access.scope !== "none");
    }
  }
  const href = signedIn ? action.href : `/login?next=${encodeURIComponent(action.href)}`;
  return (
    <section className="mt-8 rounded-xl border border-accent-ink/30 bg-accent-tint p-5" aria-labelledby="practice-h" data-testid="app-action" data-allowed={allowed}>
      <h2 id="practice-h" className="flex items-center gap-2 font-bold text-accent-dark"><Sparkles className="h-4 w-4" aria-hidden /> Put it into practice in Built2Bid</h2>
      <p className="mt-1 text-sm text-ink">{action.why}</p>
      {allowed ? (
        <Link href={href} className={buttonClass("accent", "md", "mt-3")}>{action.label} <ArrowRight className="h-4 w-4" aria-hidden /></Link>
      ) : (
        <div className="mt-3 grid gap-4 sm:grid-cols-[minmax(0,1fr)_14rem] sm:items-center">
          <div>
            <p className="text-sm text-ink-soft">This step uses <b className="text-ink">Project Command Center</b>, an add-on to your plan. Here&apos;s a preview of the timeline view.</p>
            <Link href="/pricing#project-command-center" className={buttonClass("primary", "sm", "mt-3")}>See Project Command Center</Link>
          </div>
          <Image src={timelineShot} alt="Preview of the Project Command Center timeline" className="rounded-lg border border-line shadow-card" sizes="224px" />
        </div>
      )}
    </section>
  );
}

export default async function LessonPage({ params, searchParams }: PageProps<"/academy/courses/[slug]/[lesson]">) {
  const { slug, lesson: lessonSlug } = await params;
  const sp = await searchParams;
  const r = await getLesson(slug, lessonSlug);
  if (!r) notFound();
  const { me } = await loadMe();
  const idx = r.outline.findIndex((o) => o.slug === lessonSlug);
  const prev = idx > 0 ? r.outline[idx - 1] : null;
  const next = idx >= 0 && idx < r.outline.length - 1 ? r.outline[idx + 1] : null;
  const here = `/academy/courses/${slug}/${lessonSlug}`;

  const outline = (
    <nav aria-label="Course lessons" className="overflow-hidden rounded-xl border border-line bg-surface">
      <p className="border-b border-line px-3 py-2 text-xs font-bold tracking-wide text-muted uppercase">{r.course.title}</p>
      <ol className="max-h-[60vh] overflow-y-auto">
        {r.outline.map((o) => (
          <li key={o.id}>
            <Link href={`/academy/courses/${slug}/${o.slug}`} aria-current={o.slug === lessonSlug ? "page" : undefined}
              className={`flex items-start gap-2 px-3 py-2 text-sm hover:bg-paper ${o.slug === lessonSlug ? "bg-brand-tint font-semibold" : ""}`}>
              {o.completed ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-label="Completed" /> : o.locked ? <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-label="Locked" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-line-strong" aria-hidden />}
              <span>{o.title}</span>
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );

  const pager = (
    <div className="mt-10 flex flex-wrap justify-between gap-3 border-t border-line pt-5">
      {prev ? <Link href={`/academy/courses/${slug}/${prev.slug}`} className="inline-flex items-center gap-1 text-sm font-semibold text-accent-ink hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden /> {prev.title}</Link> : <span />}
      {next ? <Link href={`/academy/courses/${slug}/${next.slug}`} className="inline-flex items-center gap-1 text-sm font-semibold text-accent-ink hover:underline">{next.title} <ArrowRight className="h-4 w-4" aria-hidden /></Link> : <Link href={`/academy/courses/${slug}`} className="text-sm font-semibold text-accent-ink hover:underline">Back to course</Link>}
    </div>
  );

  if (r.state === "locked") {
    const premium = r.access === "premium";
    return (
      <Container className="py-8">
        <Link href={`/academy/courses/${slug}`} className="inline-flex items-center gap-1 text-sm font-semibold text-accent-ink hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden /> {r.course.title}</Link>
        <div className="mt-4 grid gap-8 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <aside className="hidden lg:block">{outline}</aside>
          <div className="min-w-0" data-testid="lesson-locked">
            <h1 className="font-display text-3xl font-extrabold">{r.title}</h1>
            <div className="mt-5 max-w-2xl">
              {premium ? (
                <Notice title="This is a premium lesson">Premium lessons are included with Built2Bid Unlimited, or when an Academy admin grants premium access.{" "}
                  <Link href="/pricing" className="font-semibold underline">See plans</Link></Notice>
              ) : (
                <Notice title="Join the Academy to read this lesson">Membership is free. Joining saves your progress, unlocks member lessons and lets you ask questions in the community.{" "}
                  <Link href={me.signed_in ? "/academy/join" : `/login?next=${encodeURIComponent("/academy/join")}`} className="font-semibold underline">Join free</Link></Notice>
              )}
            </div>
            {pager}
          </div>
        </div>
      </Container>
    );
  }

  const { lesson, resources, completed } = r;
  const notes = Object.entries(lesson.trade_notes ?? {});
  const myTrades = me.trades ?? [];
  notes.sort(([a], [b]) => Number(myTrades.includes(b)) - Number(myTrades.includes(a)));
  const isStatic = lesson.id.startsWith("static-");
  const jsonLd = lesson.access === "public" ? {
    "@context": "https://schema.org", "@type": "LearningResource", name: lesson.title, description: lesson.summary ?? undefined, url: `${site.url}${here}`,
    isPartOf: { "@type": "Course", name: r.course.title, url: `${site.url}/academy/courses/${slug}` }, isAccessibleForFree: true, learningResourceType: "Lesson",
    timeRequired: lesson.estimated_minutes ? `PT${lesson.estimated_minutes}M` : undefined, provider: { "@type": "Organization", name: site.name, sameAs: site.url },
  } : null;

  return (
    <Container className="py-8">
      {jsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />}
      <Link href={`/academy/courses/${slug}`} className="inline-flex items-center gap-1 text-sm font-semibold text-accent-ink hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden /> {r.course.title}</Link>
      <div className="mt-3"><Flash msg={typeof sp.msg === "string" ? sp.msg : undefined} err={typeof sp.err === "string" ? sp.err : undefined} /></div>
      <div className="mt-4 grid gap-8 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <aside className="hidden lg:sticky lg:top-20 lg:block lg:self-start">{outline}</aside>
        <article className="min-w-0 max-w-3xl" data-testid="lesson">
          <p className="text-xs font-bold tracking-wide text-accent-ink uppercase">Lesson {idx + 1} of {r.outline.length}{lesson.estimated_minutes ? ` · ${lesson.estimated_minutes} min` : ""}</p>
          <h1 className="mt-1 font-display text-3xl font-extrabold">{lesson.title}</h1>
          {lesson.summary && <p className="mt-2 text-lg text-ink-soft">{lesson.summary}</p>}
          {lesson.body_md && <Markdown source={lesson.body_md} className="mt-6 space-y-4 leading-relaxed text-ink-soft" />}

          {lesson.takeaways.length > 0 && (
            <section className="mt-8 rounded-xl border border-line bg-surface p-5" aria-labelledby="takeaways-h">
              <h2 id="takeaways-h" className="font-bold">Key takeaways</h2>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-soft">{lesson.takeaways.map((t) => <li key={t}>{t}</li>)}</ul>
            </section>
          )}
          {lesson.checklist.length > 0 && (
            <section className="mt-6 rounded-xl border border-line bg-surface p-5" aria-labelledby="checklist-h">
              <h2 id="checklist-h" className="font-bold">Checklist</h2>
              <ul className="mt-2 space-y-1.5 text-sm">{lesson.checklist.map((t, i) => <li key={t}><label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5" id={`chk-${i}`} /> <span>{t}</span></label></li>)}</ul>
              <p className="mt-2 text-xs text-muted">Checkboxes are for your own use and aren&apos;t saved.</p>
            </section>
          )}
          {notes.length > 0 && (
            <section className="mt-6" aria-labelledby="notes-h">
              <h2 id="notes-h" className="font-bold">Notes for your trade</h2>
              <div className="mt-2 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
                {notes.map(([t, n], i) => (
                  <details key={t} open={i === 0} className="group p-4">
                    <summary className="cursor-pointer font-semibold">{tradeLabel(t)}{myTrades.includes(t) ? " · Your trade" : ""}</summary>
                    <p className="mt-2 text-sm text-ink-soft">{n}</p>
                  </details>
                ))}
              </div>
            </section>
          )}

          {lesson.app_action && <AppActionCard action={lesson.app_action} signedIn={me.signed_in} />}

          {resources.length > 0 && (
            <section className="mt-8" aria-labelledby="lres-h">
              <h2 id="lres-h" className="font-bold">Go deeper with independent creators</h2>
              <p className="mt-1 text-sm text-muted">We link to the original and credit the creator. Nothing is copied or hosted here.</p>
              <div className="mt-3 grid gap-4">{resources.map((x) => <ResourceCard key={x.id} r={x} embed />)}</div>
            </section>
          )}

          {lesson.quiz && lesson.quiz.length > 0 && (
            <section className="mt-8 rounded-xl border border-line bg-surface p-5" aria-labelledby="quiz-h">
              <h2 id="quiz-h" className="font-bold">Quick check</h2>
              <div className="mt-3"><Quiz questions={lesson.quiz} scoreField={me.member && !isStatic ? "quiz_score" : undefined} /></div>
            </section>
          )}

          <div className="mt-8">
            {me.member && !isStatic ? (
              <form id="complete-lesson" action={completeLesson} className="flex flex-wrap items-center gap-3">
                <input type="hidden" name="lesson_id" value={lesson.id} />
                <input type="hidden" name="return_to" value={here} />
                <input type="hidden" name="done" value={completed ? "false" : "true"} />
                {completed ? <><span className="inline-flex items-center gap-1 text-sm font-semibold text-ok"><CheckCircle2 className="h-4 w-4" aria-hidden /> Completed</span><Submit variant="ghost" size="sm" pending="Updating…">Mark as not complete</Submit></>
                  : <Submit variant="accent" pending="Saving…">Mark lesson complete</Submit>}
              </form>
            ) : !me.member ? (
              <p className="text-sm text-ink-soft"><Link href={me.signed_in ? "/academy/join" : `/login?next=${encodeURIComponent("/academy/join")}`} className="font-semibold text-accent-ink underline">Join the Academy free</Link> to save your progress and earn course badges.</p>
            ) : null}
          </div>
          {pager}
        </article>
      </div>
    </Container>
  );
}
