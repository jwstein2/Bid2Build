import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isPmEnabled } from "@/lib/env";
import { loadClockProjects } from "@/lib/team/server";
import { mapCorrections, mapMyStatus } from "@/lib/workforce/gps/model";
import { EmployeeClock } from "@/components/workforce/gps/employee-clock";
import { WorkerHome } from "@/components/workforce/hub/worker-home";
import { mapWorkerWeek, type WorkerWeek } from "@/lib/workforce/hub/model";
import { Notice } from "@/components/ui/misc";
import { InstallMyWork } from "@/components/workforce/hub/install-my-work";
import { MyJobs, MyProfile, ReviewShortcut } from "@/components/workforce/hub/my-profile";
import { mapWorkerProfiles } from "@/lib/workforce/hub/profile";

export const metadata: Metadata = { title: "My work", robots: { index: false } };

/**
 * Worker dashboard (V8.3) + time clock (V8.2): where I am now, today's jobs, my week (scheduled vs recorded), optional
 * pay estimate, then the clock (manual punches always; automatic GPS clock-in while open when the company uses it).
 */
export default async function ClockPage({ searchParams }: { searchParams: Promise<{ joined?: string }> }) {
  if (!isPmEnabled()) notFound();
  const supabase = await createClient();
  const joined = (await searchParams).joined === "1";
  const [st, corr, projects, prof] = await Promise.all([supabase.rpc("pm_gps_my_status"), supabase.rpc("pm_time_corrections_list", { p_status: "all" }), loadClockProjects(supabase),
    supabase.rpc("pm_worker_my_profile")]);
  // My profile + jobs I'm on (skipped quietly before the 20270227001000 SQL runs).
  const profiles = prof.error ? [] : mapWorkerProfiles(prof.data);
  const status = st.error || !st.data ? null : mapMyStatus(st.data);
  // One dashboard per staff record linked to this login (normally one). Skipped quietly before the V8.3 SQL runs.
  const weeks: WorkerWeek[] = [];
  for (const m of status?.me ?? []) {
    const w = await supabase.rpc("pm_worker_week", { p_resource: m.resourceId, p_week: new Date().toISOString().slice(0, 10) });
    if (!w.error && w.data) weeks.push(mapWorkerWeek(w.data));
  }
  return (
    <div className="mx-auto max-w-3xl space-y-5" data-guide-page="clock">
      <div>
        <h1 className="text-3xl font-extrabold text-navy">My work</h1>
        <p className="mt-1 text-ink-soft">Your profile, schedule and jobs, your hours, and the time clock. Forgot your phone or missed a punch? Ask for a review below.</p>
      </div>
      {joined && <Notice tone="ok" title="You're in">This is My work: today&apos;s jobs, your week and the time clock. It&apos;s also in your menu.</Notice>}
      {joined && <InstallMyWork />}
      {profiles.map((p) => <MyProfile key={p.resourceId} initial={p} />)}
      {weeks.map((w) => <WorkerHome key={w.resource.id} initial={w} />)}
      {profiles.map((p) => <MyJobs key={p.resourceId} jobs={p.jobs} today={weeks[0]?.today ?? new Date().toISOString().slice(0, 10)} />)}
      {weeks.length > 0 && <ReviewShortcut />}
      {weeks.length > 0 && <h2 className="pt-2 text-xl font-extrabold text-navy" id="time-clock">Time clock</h2>}
      {!status
        ? <Notice tone="warn" title="The new time clock is being set up">Use <Link href="/projects/team/time" className="underline">Employees &amp; time</Link> for now.</Notice>
        : <EmployeeClock initial={{ status, corrections: corr.error ? [] : mapCorrections(corr.data) }} projects={projects} />}
      {!joined && (status?.me.length ?? 0) > 0 && <InstallMyWork />}
    </div>
  );
}
