import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { isPmEnabled } from "@/lib/env";
import { loadSchedule } from "@/lib/schedule/server";
import { getPublication, ownerBranding } from "@/lib/schedule/publications";
import { PublishedUpdate } from "@/components/schedule/published-update";

export const metadata: Metadata = { title: "Published customer update", robots: { index: false } };

/** One published update, exactly as the customer saw it (frozen), with sharing for editors. */
export default async function PublishedUpdatePage({ params }: { params: Promise<{ id: string; pid: string }> }) {
  if (!isPmEnabled()) notFound();
  const { id, pid } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(pid)) notFound();
  const supabase = await createClient();
  const [data, pub] = await Promise.all([loadSchedule(supabase, id), getPublication(supabase, id, pid)]);
  if (!data || !pub) notFound();
  const admin = createAdminClient();
  const [{ data: row }, brand, { data: est }] = await Promise.all([
    admin.from("schedule_publications").select("logo_path").eq("id", pid).maybeSingle(),
    ownerBranding(supabase, admin, id),
    supabase.from("estimates").select("customer_email").eq("id", data.schedule.estimateId).maybeSingle(),
  ]);
  const logoPath = (row as { logo_path?: string | null } | null)?.logo_path ?? null;
  const { data: signed } = logoPath ? await admin.storage.from("logos").createSignedUrl(logoPath, 3600) : { data: null };
  return (
    <div className="mx-auto max-w-4xl">
      <PublishedUpdate scheduleId={id} scheduleName={data.schedule.name} initial={pub} canEdit={data.canEdit} logoUrl={signed?.signedUrl ?? null}
        customerEmail={(est as { customer_email?: string | null } | null)?.customer_email ?? null} contactName={brand.contactName} timezone={data.schedule.calendar.timezone} />
    </div>
  );
}
