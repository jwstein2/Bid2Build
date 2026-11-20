import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isPmEnabled } from "@/lib/env";
import { ImportWizard } from "@/components/team/import-wizard";
import { TeamHeader, TeamNav } from "@/components/team/team-nav";
import { Notice } from "@/components/ui/misc";

export const metadata: Metadata = { title: "Import employees and subcontractors", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Projects → Team → Import: bring in a whole crew or sub list from a spreadsheet or payroll export. */
export default async function TeamImportPage() {
  if (!isPmEnabled()) notFound();
  const supabase = await createClient();
  const [team, hr, subs] = await Promise.all([supabase.rpc("pm_team"), supabase.rpc("pm_hr_overview"), supabase.rpc("pm_sub_compliance_summary")]);
  const canManage = (team.data as { canManage?: boolean } | null)?.canManage === true;
  return (
    <div className="mx-auto max-w-5xl space-y-5" data-guide-page="projects.team.import">
      <TeamHeader title="Import employees and subcontractors" intro="Load your whole crew or sub list at once from a template, a payroll export or your own spreadsheet. Review every row before anything is saved." />
      <TeamNav active="import" />
      {team.error ? <Notice tone="warn" title="Team & Subcontractors is being set up">The database update for this page hasn&apos;t been applied yet.</Notice>
        : !canManage ? <Notice tone="warn" title="Restricted">Only the owner and people who can manage the team can import.</Notice>
        : <ImportWizard canHr={(hr.data as { canManage?: boolean } | null)?.canManage === true} canSubs={(subs.data as { canManage?: boolean } | null)?.canManage === true} />}
    </div>
  );
}
