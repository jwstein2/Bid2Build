import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isPmEnabled } from "@/lib/env";
import { loadClockProjects } from "@/lib/team/server";
import { mapCorrections, mapMyStatus } from "@/lib/workforce/gps/model";
import { EmployeeClock } from "@/components/workforce/gps/employee-clock";
import { Notice } from "@/components/ui/misc";

export const metadata: Metadata = { title: "Time clock", robots: { index: false } };

/** Employee time clock (V8.2): manual punches always; automatic GPS clock-in while open when the company uses it. */
export default async function ClockPage() {
  if (!isPmEnabled()) notFound();
  const supabase = await createClient();
  const [st, corr, projects] = await Promise.all([supabase.rpc("pm_gps_my_status"), supabase.rpc("pm_time_corrections_list", { p_status: "all" }), loadClockProjects(supabase)]);
  return (
    <div className="mx-auto max-w-3xl space-y-5" data-guide-page="clock">
      <div>
        <h1 className="text-3xl font-extrabold text-navy">Time clock</h1>
        <p className="mt-1 text-ink-soft">Clock in and out, see your hours, and ask for a fix if something&apos;s wrong.</p>
      </div>
      {st.error || !st.data
        ? <Notice tone="warn" title="The new time clock is being set up">Use <Link href="/projects/team/time" className="underline">Employees &amp; time</Link> for now.</Notice>
        : <EmployeeClock initial={{ status: mapMyStatus(st.data), corrections: corr.error ? [] : mapCorrections(corr.data) }} projects={projects} />}
    </div>
  );
}
