import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient, getUser } from "@/lib/supabase/server";
import { isPmEnabled } from "@/lib/env";
import { loadClockProjects, loadEmployees } from "@/lib/team/server";
import { TimeWorkspace } from "@/components/team/time-workspace";
import { TeamHeader, TeamNav } from "@/components/team/team-nav";
import { Notice } from "@/components/ui/misc";

export const metadata: Metadata = { title: "Employees & time", robots: { index: false } };

/** Projects → Team → Employees & time: employee directory, time clock, timesheet approvals. */
export default async function TimePage() {
  if (!isPmEnabled()) notFound();
  const supabase = await createClient();
  const [user, employees, projects] = await Promise.all([getUser(), loadEmployees(supabase), loadClockProjects(supabase)]);
  return (
    <div className="mx-auto max-w-5xl space-y-5" data-guide-page="projects.team.time">
      <TeamHeader title="Employees & time" intro="Your employees, the time clock, and a weekly timesheet to approve hours and see labor cost by project." />
      <TeamNav active="time" />
      {employees ? <TimeWorkspace employees={employees} projects={projects} me={user?.id ?? null} />
        : <Notice tone="warn" title="The time clock is being set up">The database update for this page hasn&apos;t been applied yet.</Notice>}
    </div>
  );
}
