import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isPmEnabled } from "@/lib/env";
import { loadSuppliers } from "@/lib/team/server";
import { mapConnections } from "@/lib/pricing/providers";
import { SupplierPricing } from "@/components/team/supplier-pricing";
import { TeamHeader, TeamNav } from "@/components/team/team-nav";

export const metadata: Metadata = { title: "Supplier pricing", robots: { index: false } };

/** Projects → Team → Supplier pricing: price cross-check, branch finder, opt-in supplier connections. */
export default async function SupplierPricingPage() {
  if (!isPmEnabled()) notFound();
  const supabase = await createClient();
  const [suppliers, conn] = await Promise.all([loadSuppliers(supabase), supabase.rpc("supplier_connections_list")]);
  const connections = conn.error || !conn.data ? null : mapConnections(conn.data);
  const options = (suppliers?.suppliers ?? []).filter((s) => s.status === "active").map((s) => ({ id: s.id, name: s.name }));
  return (
    <div className="mx-auto max-w-5xl space-y-5" data-guide-page="projects.team.pricing">
      <TeamHeader title="Supplier pricing" intro="Compare what your suppliers charge for the same product, find branches near a job, and choose which supplier connections to turn on." />
      <TeamNav active="pricing" />
      <SupplierPricing connections={connections} suppliers={options} />
    </div>
  );
}
