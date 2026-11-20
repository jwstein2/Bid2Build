import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isPmEnabled } from "@/lib/env";
import { mapSubRecord } from "@/lib/team/records";
import { SubRecordView } from "@/components/team/sub-record";
import { FullTinCard, RequestDocsCard, type SubDocRequest } from "@/components/team/sub-secure";
import { piiReady } from "@/lib/security/pii";
import { TeamNav } from "@/components/team/team-nav";
import { Notice } from "@/components/ui/misc";

export const metadata: Metadata = { title: "Subcontractor record", robots: { index: false } };

export default async function SubRecordPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isPmEnabled()) notFound();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pm_sub_record", { p_resource_id: id });
  const forbidden = error && /forbidden/.test(error.message ?? "");
  if (error && !forbidden && /not_found/.test(error.message ?? "")) notFound();
  const record = !error && data ? mapSubRecord(data) : null;
  // Self-serve links and the encrypted full TIN come from a later database update; both cards hide until it's applied.
  const [reqs, tin, res] = record ? await Promise.all([
    supabase.from("pm_sub_doc_requests").select("id, kinds, to_email, created_at, expires_at, opened_at, completed_at, revoked_at").eq("resource_id", id).order("created_at", { ascending: false }).limit(5),
    supabase.rpc("pm_sensitive_status", { p_resource_id: id, p_kind: "tin" }),
    supabase.from("pm_resources").select("email").eq("id", id).maybeSingle(),
  ]) : [null, null, null];
  const requests: SubDocRequest[] | null = reqs && !reqs.error ? (reqs.data ?? []).map((r) => ({
    id: r.id as string, kinds: r.kinds as SubDocRequest["kinds"], toEmail: (r.to_email as string | null) ?? null, createdAt: r.created_at as string, expiresAt: r.expires_at as string,
    openedAt: (r.opened_at as string | null) ?? null, completedAt: (r.completed_at as string | null) ?? null, revokedAt: (r.revoked_at as string | null) ?? null,
  })) : null;
  const tinStatus = tin && !tin.error ? (tin.data as { onFile: boolean; last4?: string; updatedAt?: string } | null) : null;
  // eslint-disable-next-line react-hooks/purity -- server component, rendered per request
  const now = Date.now();
  return (
    <div className="mx-auto max-w-5xl space-y-5" data-guide-page="projects.team.sub-record">
      <div>
        <Link href="/projects/team/subs" className="inline-flex items-center gap-1 text-sm font-semibold text-accent-ink hover:underline">‹ Sub records</Link>
        <h1 className="mt-1 text-3xl font-extrabold text-navy">{record?.name ?? "Subcontractor record"}</h1>
      </div>
      <TeamNav active="subs" />
      {record && requests && <RequestDocsCard resourceId={record.resourceId} requests={requests} defaultEmail={String((res?.data as { email?: string | null } | null)?.email ?? "")} now={now} />}
      {record && tinStatus && <FullTinCard resourceId={record.resourceId} status={tinStatus} ready={piiReady()} tinType={record.tax?.tinType ?? null} />}
      {record ? <SubRecordView record={record} today={new Date().toISOString().slice(0, 10)} piiReady={piiReady()} />
        : forbidden ? <Notice tone="warn" title="Restricted">Only the company owner and people allowed to “Manage subcontractor compliance” can see W-9s and certificates.</Notice>
        : <Notice tone="warn" title="Subcontractor records are being set up">The database update for this page hasn&apos;t been applied yet.</Notice>}
    </div>
  );
}
