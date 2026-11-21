import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isFinancialsEnabled, isPmEnabled } from "@/lib/env";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { JobFinancials } from "@/components/financials/job-financials";
import { loadJobHeader } from "@/lib/financials/loaders";

export const metadata: Metadata = { title: "Job financials", robots: { index: false } };

/** One job's financials (also shown as the Financials tab on the project page). */
export default async function JobFinancialsPage({ params, searchParams }: { params: Promise<{ estimateId: string }>; searchParams: Promise<{ do?: string }> }) {
  if (!isFinancialsEnabled()) notFound();
  const { estimateId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(estimateId)) notFound();
  const db = await createClient();
  const est = await loadJobHeader(db, estimateId);
  if (!est) {
    // Links built from a financial job id (cash forecast, alerts) land here too: send them to the job's bid page.
    const { data: job } = await db.from("fin_jobs").select("estimate_id").eq("id", estimateId).maybeSingle();
    if (job?.estimate_id && job.estimate_id !== estimateId) redirect(`/financials/jobs/${job.estimate_id}`);
    notFound();
  }
  const { data: sched } = isPmEnabled() ? await db.from("project_schedules").select("id").eq("estimate_id", estimateId).maybeSingle() : { data: null };
  const sp = await searchParams;
  return (
    <div className="mx-auto max-w-6xl space-y-3">
      <Breadcrumbs items={[{ label: "Financials", href: "/financials" }, { label: "Jobs", href: "/financials/records?view=jobs" }, { label: String(est.title ?? "Job") }]} />
      {sched?.id && <Link href={`/projects/${sched.id}?tab=financials`} className="text-sm font-semibold text-accent-ink underline">Open the project</Link>}
      <JobFinancials estimateId={estimateId} initialAction={sp.do && /^[a-z]+$/.test(sp.do) ? sp.do : null} />
    </div>
  );
}
