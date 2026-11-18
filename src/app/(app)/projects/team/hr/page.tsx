import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isPmEnabled } from "@/lib/env";
import { mapHrOverview } from "@/lib/team/hr";
import { HrOverviewView } from "@/components/team/hr-overview";
import { TeamHeader, TeamNav } from "@/components/team/team-nav";
import { Notice } from "@/components/ui/misc";

export const metadata: Metadata = { title: "HR files", robots: { index: false } };

/** Projects → Team → HR files. Owner and named HR managers only. */
export default async function HrPage() {
  if (!isPmEnabled()) notFound();
  const { data, error } = await (await createClient()).rpc("pm_hr_overview");
  const ov = !error ? mapHrOverview(data) : null;
  return (
    <div className="mx-auto max-w-5xl space-y-5" data-guide-page="projects.team.hr">
      <TeamHeader title="HR files" intro="Each employee's personal details, emergency contacts, Social Security number, hiring paperwork, certifications and time off, kept private to the owner and HR managers." />
      <TeamNav active="hr" />
      {!ov ? <Notice tone="warn" title="HR files are being set up">The database update for this page hasn&apos;t been applied yet.</Notice>
        : !ov.canManage ? <Notice tone="warn" title="Restricted">Only the company owner and people the owner names as HR managers can open HR files.</Notice>
        : <HrOverviewView overview={ov} today={new Date().toISOString().slice(0, 10)} />}
    </div>
  );
}
