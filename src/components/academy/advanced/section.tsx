import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SubjectCard } from "./subject-card";
import { advancedState, displayStage, listSubjects, loadMyAccess } from "@/lib/academy/advanced/server";
import { hasSubject, usd } from "@/lib/academy/advanced/plans";

/** Classroom: "Advanced Learning", after the general courses and before the trade directory. Renders nothing while off. */
export async function AdvancedSection() {
  const state = await advancedState();
  if (!state.visible) return null;
  const [subjects, access, stage] = await Promise.all([listSubjects({ includeDraft: state.staff }), loadMyAccess(), displayStage()]);
  const open = subjects.filter((s) => s.status === "published" && s.purchasable);
  const shown = (open.length ? open : subjects).slice(0, 3);
  if (!shown.length) return null;
  return (
    <section className="mt-10" aria-labelledby="adv-h" data-testid="advanced-section">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="adv-h" className="text-lg font-bold">Advanced Learning</h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-soft">Deeper courses with practice inside Built2Bid. Free preview lesson in every subject{open.length ? `; memberships from ${usd(stage.one_subject_cents)}/month` : ""}.{!state.publicOn ? " (Staff preview: hidden from members.)" : ""}</p>
        </div>
        <Link href="/academy/advanced" className="inline-flex items-center gap-1 text-sm font-semibold text-accent-ink hover:underline">All advanced subjects <ArrowRight className="h-4 w-4" aria-hidden /></Link>
      </div>
      <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{shown.map((s) => <SubjectCard key={s.slug} s={s} owned={hasSubject(access, s.slug) && !access.staff} />)}</ul>
    </section>
  );
}
