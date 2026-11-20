import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, HardHat, LocateFixed } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { isPmEnabled } from "@/lib/env";
import { todayIn } from "@/lib/schedule/calendar";
import { loadWorkforce } from "@/lib/workforce/server";
import { WorkforcePage } from "@/components/workforce/workforce-page";
import { Notice } from "@/components/ui/misc";

export const metadata: Metadata = { title: "Contractors & Workforce", robots: { index: false } };

/**
 * PM Hub → Contractors & Workforce (V7.3): who you use, what they do, where they're booked, and
 * "assign to another job" from one place. Same directory and assignments as Projects.
 */
export default async function WorkforceRoute({ searchParams }: { searchParams: Promise<{ q?: string; section?: string; open?: string; assignProject?: string; view?: string }> }) {
  if (!isPmEnabled()) notFound();
  const supabase = await createClient();
  const [wf, people, sp] = await Promise.all([
    loadWorkforce(supabase),
    supabase.rpc("pm_people").then((r) => (r.error ? [] : ((r.data as { id: string; name: string }[]) ?? []))),
    searchParams,
  ]);
  const clean = (v: unknown, max = 100) => (typeof v === "string" ? v.slice(0, max) : undefined);
  const uuid = (v: unknown) => (typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);
  return (
    <div className="mx-auto max-w-7xl space-y-5" data-guide-page="projects.workforce">
      <div>
        <Link href="/projects" className="inline-flex items-center gap-1 text-sm font-semibold text-accent-ink hover:underline"><ChevronLeft className="h-4 w-4" aria-hidden /> Projects</Link>
        <h1 className="mt-1 flex items-center gap-2 text-3xl font-extrabold text-navy"><HardHat className="h-7 w-7 text-accent-ink" aria-hidden /> Contractors &amp; Workforce</h1>
        <p className="mt-1 text-ink-soft">Find the right sub, worker or crew, see where they&apos;re booked, and put them on another job without leaving PM Hub.</p>
        <Link href="/projects/workforce/time-tracking" className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 text-sm font-semibold text-navy hover:border-accent-ink" data-testid="workforce-time-tracking-link">
          <LocateFixed className="h-4 w-4 text-accent-ink" aria-hidden /> Time tracking: GPS clock-in, timesheets &amp; payroll export</Link>
      </div>
      {wf
        ? <WorkforcePage wf={wf} today={todayIn("America/Chicago")} people={people}
            initial={{ q: clean(sp.q), section: clean(sp.section, 20), open: uuid(sp.open), assignProject: uuid(sp.assignProject), view: clean(sp.view, 20) }} />
        : <Notice tone="warn" title="Contractors & Workforce is being set up">The database update for this page hasn&apos;t been applied yet. Your people and assignments are safe in <Link href="/projects/team" className="underline">Team &amp; Subcontractors</Link>.</Notice>}
    </div>
  );
}
