import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, Circle, Clock, Lock } from "lucide-react";
import { Container, Notice } from "@/components/ui/misc";
import { buttonClass } from "@/components/ui/button";
import { Flash } from "@/components/creator/flash";
import { CourseCover, comingLabel } from "@/components/academy/course-card";
import { ResourceCard } from "@/components/academy/resource-card";
import { SaveButton } from "@/components/academy/controls";
import { getCourse, loadMe, signedMediaUrls } from "@/lib/academy/server";
import { ACCESS_LABEL, LEVEL_LABEL, pillarMeta } from "@/lib/academy/types";
import { openGraphFor } from "@/lib/seo/open-graph";
import { site } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";
import { StateRequirementsPanel } from "@/components/academy/startup/state-panel";
import { resolveLocation } from "@/lib/academy/kb/server";
import { advancedState } from "@/lib/academy/advanced/server";
import { AdvancedOffer } from "@/components/academy/advanced/offer";
import { metaDescription } from "@/lib/seo/meta";

export async function generateMetadata({ params }: PageProps<"/academy/courses/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const c = await getCourse(slug);
  if (!c) return { title: "Course" };
  const title = c.course.seo_title ?? c.course.title;
  const description = metaDescription(c.course.seo_description ?? c.course.summary ?? "");
  // Only published courses with lessons are indexable; "coming soon" cards are kept out of search (thin content).
  const indexable = c.course.status === "published" && c.outline.length > 0;
  return {
    title, description, alternates: { canonical: `/academy/courses/${slug}` }, robots: indexable ? undefined : { index: false, follow: true },
    openGraph: openGraphFor({ title: `${title} | ${site.name}`, description, path: `/academy/courses/${slug}` }),
  };
}

export default async function CoursePage({ params, searchParams }: PageProps<"/academy/courses/[slug]">) {
  const { slug } = await params;
  const sp = await searchParams;
  const data = await getCourse(slug);
  if (!data) notFound();
  const { course, outline, resources, trade } = data;
  if (course.adv_subject && !(await advancedState()).visible) notFound();
  const { me, user } = await loadMe();
  const live = course.status === "published";
  const done = outline.filter((o) => o.completed).length;
  const next = outline.find((o) => !o.completed && !o.locked) ?? outline[0];
  const modules = [...new Map(outline.map((o) => [o.module_id ?? "none", o.module_title ?? "Lessons"])).entries()];
  const minutes = outline.reduce((s, o) => s + (o.estimated_minutes ?? 0), 0);
  const covers = await signedMediaUrls([course.cover_path]);
  const startup = course.pillar === "getting_started" && trade ? await resolveLocation(sp) : null;
  let saved = false;
  if (me.member && user && !course.id.startsWith("static-")) {
    const { data: b } = await (await createClient()).from("academy_bookmarks").select("target_id").eq("user_id", user.id).eq("target_type", "course").eq("target_id", course.id).maybeSingle();
    saved = Boolean(b);
  }
  const jsonLd = live ? {
    "@context": "https://schema.org", "@type": "Course", name: course.title, description: course.summary, url: `${site.url}/academy/courses/${slug}`,
    provider: { "@type": "Organization", name: site.name, sameAs: site.url }, isAccessibleForFree: course.access !== "premium", educationalLevel: LEVEL_LABEL[course.level],
    hasCourseInstance: { "@type": "CourseInstance", courseMode: "online", courseWorkload: minutes ? `PT${minutes}M` : undefined },
  } : null;

  return (
    <Container className="py-8">
      {jsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />}
      <Link href={course.adv_subject ? `/academy/advanced/${course.adv_subject}` : trade ? `/academy/classroom/${trade.slug}` : "/academy/classroom"} className="inline-flex items-center gap-1 text-sm font-semibold text-accent-ink hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden /> {course.adv_subject ? "Advanced Learning" : trade ? `${trade.name} Classroom` : "Classroom"}
      </Link>
      <div className="mt-3"><Flash msg={typeof sp.msg === "string" ? sp.msg : undefined} err={typeof sp.err === "string" ? sp.err : undefined} /></div>
      <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0">
          <p className="text-xs font-bold tracking-wide text-accent-ink uppercase">{course.adv_subject ? "Advanced Learning" : pillarMeta(course.pillar).label}{trade ? ` · ${trade.name}` : " · Every trade"}</p>
          <h1 className="mt-1 font-display text-3xl font-extrabold">{course.title}</h1>
          <p className="mt-2 text-lg text-ink-soft">{course.summary}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
            {live ? <span className="rounded bg-ok-tint px-2 py-1 text-ok">{ACCESS_LABEL[course.access]}</span> : <span className="rounded bg-idle-tint px-2 py-1 text-ink-soft">{comingLabel(course.release_on)}</span>}
            <span className="rounded bg-black/5 px-2 py-1 text-ink-soft">{LEVEL_LABEL[course.level]}</span>
            {live && <span className="rounded bg-black/5 px-2 py-1 text-ink-soft">{outline.length} lessons{minutes ? ` · about ${minutes} min` : ""}</span>}
            {course.content_class === "mixed" && <span className="rounded bg-black/5 px-2 py-1 text-ink-soft">Built2Bid lessons + credited expert resources</span>}
          </div>
          {course.description && <p className="mt-5 max-w-3xl leading-relaxed text-ink-soft">{course.description}</p>}
          {startup && trade && <StateRequirementsPanel state={startup.state} trade={trade.slug} tradeName={trade.name} />}

          {live ? (
            <section className="mt-8" aria-labelledby="outline-h">
              <h2 id="outline-h" className="text-lg font-bold">Course outline</h2>
              {modules.map(([mid, mtitle]) => (
                <div key={mid} className="mt-4">
                  {modules.length > 1 && <h3 className="text-sm font-bold text-muted">{mtitle}</h3>}
                  <ol className="mt-2 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
                    {outline.filter((o) => (o.module_id ?? "none") === mid).map((o) => (
                      <li key={o.id}>
                        <Link href={`/academy/courses/${slug}/${o.slug}`} className="flex items-start gap-3 p-3 hover:bg-paper" data-testid="outline-lesson">
                          {o.completed ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-ok" aria-label="Completed" /> : o.locked ? <Lock className="mt-0.5 h-5 w-5 shrink-0 text-muted" aria-label="Locked" /> : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-line-strong" aria-hidden />}
                          <span className="min-w-0 flex-1">
                            <span className="block font-semibold">{o.title}</span>
                            {o.summary && <span className="block text-sm text-ink-soft">{o.summary}</span>}
                          </span>
                          <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
                            {o.locked && <span className="rounded bg-black/5 px-1.5 py-0.5">{o.access === "advanced" ? "Advanced" : o.access === "premium" ? "Premium" : "Members"}</span>}
                            {!o.locked && course.adv_subject && o.access !== "advanced" && <span className="rounded bg-brand-tint px-1.5 py-0.5 font-bold text-navy">Free preview</span>}
                            {o.estimated_minutes ? <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" aria-hidden />{o.estimated_minutes}m</span> : null}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
              {course.adv_subject && outline.some((o) => o.locked) && <div className="mt-6"><AdvancedOffer subject={course.adv_subject} /></div>}
            </section>
          ) : (
            <section className="mt-8" aria-labelledby="planned-h">
              <Notice title="This course is being written">We publish a course only when its lessons have been written and reviewed. Here&apos;s what it will cover.</Notice>
              <h2 id="planned-h" className="mt-5 text-lg font-bold">Planned lessons</h2>
              <ol className="mt-2 list-decimal space-y-1 pl-6 text-ink-soft">{course.planned_lessons.map((l) => <li key={l}>{l}</li>)}</ol>
              {course.pillar === "sales" && <p className="mt-4 text-sm">While it&apos;s in progress, the <Link href="/academy/courses/contractor-sales-academy" className="font-semibold text-accent-ink underline">Contractor Sales Academy</Link> covers the full sales process with notes for many trades.</p>}
            </section>
          )}

          {resources.length > 0 && (
            <section className="mt-10" aria-labelledby="cres-h">
              <h2 id="cres-h" className="text-lg font-bold">{live ? "More from independent creators" : "Credited resources you can use now"}</h2>
              <p className="mt-1 text-sm text-muted">We link to the original and credit the creator. Nothing is copied or hosted here.</p>
              <div className="mt-4 grid gap-4 md:grid-cols-2">{resources.map((r) => <ResourceCard key={r.id} r={r} compact />)}</div>
            </section>
          )}
        </div>

        <aside className="lg:sticky lg:top-20 lg:self-start">
          <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
            <CourseCover course={course} tradeName={trade?.name} coverUrl={course.cover_path ? covers.get(course.cover_path) : null} />
            <div className="p-4">
              {live && outline.length > 0 ? (
                <>
                  {me.member && <p className="text-sm text-muted">{done} of {outline.length} lessons complete</p>}
                  <Link href={`/academy/courses/${slug}/${next.slug}`} className={buttonClass("accent", "lg", "mt-2 w-full")} data-cta="course-start">{done > 0 ? "Continue" : "Start course"}</Link>
                  {!me.member && !course.adv_subject && outline.some((o) => o.locked) && <p className="mt-3 text-xs text-muted">The first lessons are open to everyone. <Link href={me.signed_in ? "/academy/join" : "/login?next=/academy/join"} className="font-semibold text-accent-ink underline">Join free</Link> to unlock the rest and save your progress.</p>}
                </>
              ) : (
                <p className="text-sm text-ink-soft">{comingLabel(course.release_on)}. {me.member ? "Save it to find it again." : ""}</p>
              )}
              {me.member && !course.id.startsWith("static-") && <div className="mt-2"><SaveButton type="course" id={course.id} saved={saved} /></div>}
            </div>
          </div>
        </aside>
      </div>
    </Container>
  );
}
