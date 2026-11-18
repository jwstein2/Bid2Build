import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isPmEnabled } from "@/lib/env";
import { Totals1099View } from "@/components/team/totals-1099";
import { TeamHeader, TeamNav } from "@/components/team/team-nav";

export const metadata: Metadata = { title: "1099 totals", robots: { index: false } };

/** Projects → Team → 1099 totals. Defaults to last year in January–March (filing season), else this year. */
export default async function Totals1099Page() {
  if (!isPmEnabled()) notFound();
  const now = new Date();
  const year = now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear();
  return (
    <div className="mx-auto max-w-5xl space-y-5" data-guide-page="projects.team.1099">
      <TeamHeader title="1099 totals" intro="What you paid each subcontractor this year, who needs a 1099-NEC, and whose W-9 is missing." />
      <TeamNav active="1099" />
      <Totals1099View initialYear={year} />
    </div>
  );
}
