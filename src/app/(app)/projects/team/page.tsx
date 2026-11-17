import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Users } from "lucide-react";
import { createClient, getUser } from "@/lib/supabase/server";
import { isPmEnabled } from "@/lib/env";
import { defaultWindow, loadTeam, loadWorkspace } from "@/lib/projects/server";
import { TeamDirectory } from "@/components/projects/team-directory";
import { Notice } from "@/components/ui/misc";
import { TeamNav } from "@/components/team/team-nav";
import { loadComplianceSummary } from "@/lib/team/server";

export const metadata: Metadata = { title: "Team & Subcontractors", robots: { index: false } };

/** Projects → Team & Subcontractors (V4.2). */
export default async function TeamPage() {
  if (!isPmEnabled()) notFound();
  const supabase = await createClient();
  const user = await getUser();
  const win = defaultWindow();
  const [team, ws, people, compliance] = await Promise.all([
    loadTeam(supabase),
    loadWorkspace(supabase, win.from, win.to),
    supabase.rpc("pm_people").then((r) => (r.error ? [] : ((r.data as { id: string; name: string }[]) ?? []))),
    loadComplianceSummary(supabase),
  ]);
  const usage: Record<string, number> = {};
  for (const t of ws?.tasks ?? []) if (t.resourceId && t.status !== "complete") usage[t.resourceId] = (usage[t.resourceId] ?? 0) + 1;
  return (
    <div className="mx-auto max-w-5xl space-y-5" data-guide-page="projects.team">
      <div>
        <Link href="/projects" className="inline-flex items-center gap-1 text-sm font-semibold text-accent-ink hover:underline"><ChevronLeft className="h-4 w-4" aria-hidden /> Projects</Link>
        <h1 className="mt-1 flex items-center gap-2 text-3xl font-extrabold text-navy"><Users className="h-7 w-7 text-accent-ink" aria-hidden /> Team &amp; Subcontractors</h1>
        <p className="mt-1 text-ink-soft">Who does the work: your staff, the subcontractors you hire and your crews. Assign them to sections and tasks, see who&apos;s booked, and catch double-bookings.</p>
      </div>
      <TeamNav active="people" />
      {team
        ? <TeamDirectory team={team} people={people} me={user?.id ?? null} usage={usage} compliance={compliance} />
        : <Notice tone="warn" title="Team & Subcontractors is being set up">The database update for this page hasn&apos;t been applied yet.</Notice>}
    </div>
  );
}
