import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, Sparkles } from "lucide-react";
import { Container, Notice } from "@/components/ui/misc";
import { SubjectCard } from "@/components/academy/advanced/subject-card";
import { advancedState, displayStage, listSubjects, loadMyAccess } from "@/lib/academy/advanced/server";
import { ALL_ACCESS_EXCLUDES, PLAN_META, hasSubject, usd } from "@/lib/academy/advanced/plans";

// Depends on the visitor (staff preview, membership) and on switches that change at runtime.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Advanced Learning for Contractors",
  description: "Deeper courses on AI and running a contracting business, with practice inside Built2Bid. Every subject has a free preview lesson.",
  alternates: { canonical: "/academy/advanced" },
};

export default async function AdvancedPage() {
  const state = await advancedState();
  if (!state.visible) notFound();
  const [subjects, access, stage] = await Promise.all([listSubjects({ includeDraft: state.staff }), loadMyAccess(), displayStage()]);
  const open = subjects.filter((s) => s.status === "published" && s.purchasable);
  const upcoming = subjects.filter((s) => !(s.status === "published" && s.purchasable));
  return (
    <Container className="py-8">
      {!state.publicOn && <Notice tone="warn" title="Staff preview" className="mb-5">Advanced Learning is hidden from members until it&apos;s switched on in Manage Academy → Advanced and in Netlify (ACADEMY_ADVANCED_ENABLED).</Notice>}
      <p className="text-xs font-bold tracking-wide text-accent-ink uppercase">Classroom · Advanced Learning</p>
      <h1 className="mt-1 font-display text-3xl font-extrabold">Advanced Learning</h1>
      <p className="mt-2 max-w-2xl text-ink-soft">Deeper, practical courses for running a contracting business, each with exercises you can try in Built2Bid. Every subject has a free preview lesson, and all the free Classroom courses stay free.</p>
      {access.plan && <p className="mt-3 text-sm"><Link href="/academy/advanced/membership" className="font-semibold text-accent-ink underline">Your membership: {PLAN_META[access.plan].name}</Link></p>}

      <section className="mt-8" aria-labelledby="open-h">
        <h2 id="open-h" className="text-lg font-bold">Open now</h2>
        {open.length ? <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{open.map((s) => <SubjectCard key={s.slug} s={s} owned={hasSubject(access, s.slug) && !access.staff} />)}</ul>
          : <p className="mt-2 text-sm text-ink-soft">The first subjects are being reviewed and open soon.</p>}
      </section>

      <section className="mt-10 rounded-2xl border border-line bg-paper p-5" aria-labelledby="how-h">
        <h2 id="how-h" className="text-lg font-bold">Three ways to learn</h2>
        <ul className="mt-4 grid gap-3 md:grid-cols-3">
          {(["one_subject", "two_subjects", "all_access"] as const).map((p) => (
            <li key={p} className="rounded-xl border border-line bg-surface p-4">
              <p className="font-bold">{PLAN_META[p].name}</p>
              <p className="mt-1 font-display text-xl font-extrabold">{usd(p === "one_subject" ? stage.one_subject_cents : p === "two_subjects" ? stage.two_subjects_cents : stage.all_access_cents)}<span className="text-sm font-semibold text-ink-soft">/month</span></p>
              <ul className="mt-2 space-y-1 text-sm text-ink-soft">{PLAN_META[p].includes.map((i) => <li key={i} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden />{i}</li>)}</ul>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted">Founding-member prices, before tax. Your monthly rate stays the same while you keep your package. Prices for new members rise as the library grows. Cancel anytime; paid months aren&apos;t refunded. All Access doesn&apos;t include {ALL_ACCESS_EXCLUDES.join("; ")}.</p>
        <p className="mt-2 flex items-center gap-1.5 text-sm text-ink-soft"><Sparkles className="h-4 w-4 text-accent-ink" aria-hidden /> Open a subject to see its free preview and choose a package.</p>
      </section>

      {upcoming.length > 0 && (
        <section className="mt-10" aria-labelledby="up-h">
          <h2 id="up-h" className="text-lg font-bold">Upcoming subjects</h2>
          <p className="mt-1 text-sm text-ink-soft">Being written now. They aren&apos;t sold until their lessons are published. All Access members get each one as it opens.</p>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{upcoming.map((s) => <SubjectCard key={s.slug} s={s} />)}</ul>
        </section>
      )}
    </Container>
  );
}
