import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, LocateFixed } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { isPmEnabled } from "@/lib/env";
import { loadClockProjects } from "@/lib/team/server";
import { mapAdmin, mapCorrections, mapExceptions } from "@/lib/workforce/gps/model";
import { TimeTrackingAdmin } from "@/components/workforce/gps/time-tracking-admin";
import { Notice } from "@/components/ui/misc";

export const metadata: Metadata = { title: "Time tracking", robots: { index: false } };
const TABS = ["overview", "locations", "employees", "settings", "corrections", "payroll"] as const;

/**
 * Projects → Contractors & Workforce → Time tracking (V8.2): automatic GPS clock-in/out for the company's own W-2
 * employees. Customer-facing; nothing to do with Built2Bid's internal staff.
 */
export default async function TimeTrackingPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  if (!isPmEnabled()) notFound();
  const supabase = await createClient();
  const [ov, sp, projects] = await Promise.all([supabase.rpc("pm_gps_admin_overview"), searchParams, loadClockProjects(supabase)]);
  const header = (
    <div>
      <Link href="/projects/workforce" className="inline-flex items-center gap-1 text-sm font-semibold text-accent-ink hover:underline"><ChevronLeft className="h-4 w-4" aria-hidden /> Contractors &amp; Workforce</Link>
      <h1 className="mt-1 flex items-center gap-2 text-3xl font-extrabold text-navy"><LocateFixed className="h-7 w-7 text-accent-ink" aria-hidden /> Time tracking</h1>
      <p className="mt-1 text-ink-soft">GPS clock-in at your shop and jobsites, timesheet approvals and payroll-ready exports for your W-2 crew.</p>
    </div>
  );
  if (ov.error || !ov.data) {
    const forbidden = ov.error?.code === "42501" || /forbidden/.test(ov.error?.message ?? "");
    return (
      <div className="mx-auto max-w-5xl space-y-5">{header}
        {forbidden
          ? <Notice title="Only time admins and supervisors can open this page">To clock in or out, use <Link href="/clock" className="underline">Time clock</Link>.</Notice>
          : <Notice tone="warn" title="Time tracking is being set up">The database update for this page hasn&apos;t been applied yet. The <Link href="/projects/team/time" className="underline">time clock</Link> still works.</Notice>}
      </div>
    );
  }
  const admin = mapAdmin(ov.data);
  const [ex, corr] = await Promise.all([
    admin.canSupervise ? supabase.rpc("pm_gps_exceptions") : Promise.resolve({ data: null }),
    supabase.rpc("pm_time_corrections_list", { p_status: "pending" }),
  ]);
  const tab = TABS.find((t) => t === sp.tab);
  return (
    <div className="mx-auto max-w-6xl space-y-5" data-guide-page="projects.workforce.time-tracking">
      {header}
      <TimeTrackingAdmin initial={{ admin, exceptions: ex.data ? mapExceptions(ex.data) : null, corrections: "error" in corr && corr.error ? [] : mapCorrections(corr.data) }}
        projects={Object.fromEntries(projects.map((p) => [p.id, p.name]))} initialTab={tab} />
    </div>
  );
}
