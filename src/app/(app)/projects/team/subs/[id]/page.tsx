import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isPmEnabled } from "@/lib/env";
import { mapSubRecord } from "@/lib/team/records";
import { SubRecordView } from "@/components/team/sub-record";
import { TeamNav } from "@/components/team/team-nav";
import { Notice } from "@/components/ui/misc";

export const metadata: Metadata = { title: "Subcontractor record", robots: { index: false } };

export default async function SubRecordPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isPmEnabled()) notFound();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data, error } = await (await createClient()).rpc("pm_sub_record", { p_resource_id: id });
  const forbidden = error && /forbidden/.test(error.message ?? "");
  if (error && !forbidden && /not_found/.test(error.message ?? "")) notFound();
  const record = !error && data ? mapSubRecord(data) : null;
  return (
    <div className="mx-auto max-w-5xl space-y-5" data-guide-page="projects.team.sub-record">
      <div>
        <Link href="/projects/team/subs" className="inline-flex items-center gap-1 text-sm font-semibold text-accent-ink hover:underline">‹ Sub records</Link>
        <h1 className="mt-1 text-3xl font-extrabold text-navy">{record?.name ?? "Subcontractor record"}</h1>
      </div>
      <TeamNav active="subs" />
      {record ? <SubRecordView record={record} today={new Date().toISOString().slice(0, 10)} />
        : forbidden ? <Notice tone="warn" title="Restricted">Only the company owner and people allowed to “Manage subcontractor compliance” can see W-9s and certificates.</Notice>
        : <Notice tone="warn" title="Subcontractor records are being set up">The database update for this page hasn&apos;t been applied yet.</Notice>}
    </div>
  );
}
