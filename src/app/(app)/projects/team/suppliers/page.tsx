import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isPmEnabled } from "@/lib/env";
import { loadSuppliers } from "@/lib/team/server";
import { SupplierDirectory } from "@/components/team/supplier-directory";
import { TeamHeader, TeamNav } from "@/components/team/team-nav";
import { Notice } from "@/components/ui/misc";

export const metadata: Metadata = { title: "Suppliers", robots: { index: false } };

/** Projects → Team → Suppliers: the supplier directory, linked to supplier price-list imports. */
export default async function SuppliersPage() {
  if (!isPmEnabled()) notFound();
  const list = await loadSuppliers(await createClient());
  return (
    <div className="mx-auto max-w-5xl space-y-5" data-guide-page="projects.team.suppliers">
      <TeamHeader title="Suppliers" intro="Where you buy materials: account numbers, reps, and the price lists you've imported from each supplier." />
      <TeamNav active="suppliers" />
      {list ? <SupplierDirectory list={list} /> : <Notice tone="warn" title="Suppliers are being set up">The database update for this page hasn&apos;t been applied yet.</Notice>}
    </div>
  );
}
