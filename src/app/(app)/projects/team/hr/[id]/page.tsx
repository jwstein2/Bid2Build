import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isPmEnabled } from "@/lib/env";
import { piiReady } from "@/lib/security/pii";
import { mapHrFile } from "@/lib/team/hr";
import { HrFileView } from "@/components/team/hr-file";
import { TeamNav } from "@/components/team/team-nav";
import { Notice } from "@/components/ui/misc";

export const metadata: Metadata = { title: "HR file", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function HrFilePage({ params }: { params: Promise<{ id: string }> }) {
  if (!isPmEnabled()) notFound();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data, error } = await (await createClient()).rpc("pm_employee_hr_get", { p_resource_id: id });
  if (error && /not_found/.test(error.message ?? "")) notFound();
  const forbidden = error && /forbidden/.test(error.message ?? "");
  const file = !error && data ? mapHrFile(data) : null;
  return (
    <div className="mx-auto max-w-5xl space-y-5" data-guide-page="projects.team.hr-file">
      <div>
        <Link href="/projects/team/hr" className="inline-flex items-center gap-1 text-sm font-semibold text-accent-ink hover:underline">‹ HR files</Link>
        <h1 className="mt-1 text-3xl font-extrabold text-navy">{file?.name ?? "HR file"}</h1>
        {file?.profile?.title && <p className="text-ink-soft">{file.profile.title}</p>}
      </div>
      <TeamNav active="hr" />
      {file ? <HrFileView file={file} piiReady={piiReady()} today={new Date().toISOString().slice(0, 10)} />
        : forbidden ? <Notice tone="warn" title="Restricted">Only the company owner and HR managers can open HR files.</Notice>
        : <Notice tone="warn" title="HR files are being set up">The database update for this page hasn&apos;t been applied yet.</Notice>}
    </div>
  );
}
