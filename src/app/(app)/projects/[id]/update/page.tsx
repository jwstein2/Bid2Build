import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { isPmEnabled } from "@/lib/env";
import { loadSchedule } from "@/lib/schedule/server";
import { listPublications, ownerBranding } from "@/lib/schedule/publications";
import { UpdateComposer } from "@/components/schedule/update-composer";

export const metadata: Metadata = { title: "Customer update", robots: { index: false } };

/** Preview Customer Update. Editors only (viewers see published updates on the schedule page). */
export default async function UpdatePage({ params }: { params: Promise<{ id: string }> }) {
  if (!isPmEnabled()) notFound();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const data = await loadSchedule(supabase, id);
  if (!data) notFound();
  if (!data.canEdit) redirect(`/projects/${id}`);
  const admin = createAdminClient();
  const [pubs, brand, { data: est }] = await Promise.all([
    listPublications(supabase, id),
    ownerBranding(supabase, admin, id),
    supabase.from("estimates").select("customer_email").eq("id", data.schedule.estimateId).maybeSingle(),
  ]);
  const { data: signed } = brand.logoPath ? await admin.storage.from("logos").createSignedUrl(brand.logoPath, 3600) : { data: null };
  return (
    <div className="mx-auto max-w-7xl">
      <UpdateComposer data={data} lastVersion={pubs[0]?.version ?? null} customerEmail={(est as { customer_email?: string | null } | null)?.customer_email ?? null}
        contactName={brand.contactName} logoUrl={signed?.signedUrl ?? null} />
    </div>
  );
}
