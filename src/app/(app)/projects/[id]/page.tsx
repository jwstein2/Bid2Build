import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAccountStatus } from "@/lib/account/server";
import { createClient } from "@/lib/supabase/server";
import { isPmEnabled } from "@/lib/env";
import { loadSchedule } from "@/lib/schedule/server";
import { loadPmAccess } from "@/lib/pm/server";
import { listPublications } from "@/lib/schedule/publications";
import { tradeName } from "@/lib/trades/catalog";
import { ScheduleEditor } from "@/components/schedule/editor";
import { ProjectSummary } from "@/components/projects/project-summary";
import { loadActivity } from "@/lib/projects/server";
import { progressOf } from "@/lib/schedule/progress";
import { todayIn } from "@/lib/schedule/calendar";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { ProjectTabs } from "@/components/operations/project-tabs";
import { ProjectUpdatesPanel } from "@/components/comms/project-updates-panel";
import { loadCommAccess } from "@/lib/comms/server";

export const metadata: Metadata = { title: "Project schedule", robots: { index: false } };

/**
 * Project detail: the Gantt schedule. Anyone who can see the bid can view it; editing needs the PM
 * entitlement (checked again by the server on every save).
 */
export default async function SchedulePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string; tab?: string }> }) {
  if (!isPmEnabled()) notFound();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const [data, pm, publications, account, comm] = await Promise.all([loadSchedule(supabase, id), loadPmAccess(supabase), listPublications(supabase, id), getAccountStatus(), loadCommAccess(supabase)]);
  if (!data) notFound();
  const editHint = data.canEdit ? null : pm?.scope === "company" || data.schedule.companyId ? "seat" : account.kind === "unlimited" ? "addon" : "upgrade";
  const { created, tab } = await searchParams;
  // V4.1 summary (people, closeout, activity). Absent before the V4.1 SQL runs: the editor still works.
  const [{ data: row }, activity, { data: peopleRaw }, { data: sig }, { data: est }] = await Promise.all([
    supabase.from("project_schedules").select("sales_rep_id, project_manager_id, actual_finish, closeout_note").eq("id", id).maybeSingle(),
    loadActivity(supabase, id),
    supabase.rpc("pm_people"),
    supabase.from("signatures").select("id").eq("estimate_id", data.schedule.estimateId).order("signed_at", { ascending: false }).limit(1),
    supabase.from("estimates").select("pipeline_stage, customer_id").eq("id", data.schedule.estimateId).maybeSingle(),
  ]);
  const leaves = data.tasks.filter((t) => !data.tasks.some((c) => c.parentId === t.id));
  const summary = row && activity ? {
    id, estimateId: data.schedule.estimateId, companyId: data.schedule.companyId, status: data.schedule.status, revision: data.schedule.revision,
    startDate: data.schedule.startDate, finishDate: data.tasks.reduce<string | null>((m, t) => (!m || t.plannedEnd > m ? t.plannedEnd : m), null),
    targetEndDate: data.schedule.targetEndDate, actualFinish: (row.actual_finish as string | null) ?? null, closeoutNote: (row.closeout_note as string | null) ?? null,
    progress: progressOf(data.tasks, data.schedule.progressMethod).percent, customerName: data.snapshot.estimate.customerName ?? "",
    salesRepId: (row.sales_rep_id as string | null) ?? null, projectManagerId: (row.project_manager_id as string | null) ?? null,
    canEdit: data.permissions.edit, canPublish: data.permissions.publish,
    people: ((peopleRaw as { id: string; name: string }[] | null) ?? []).map((x) => ({ id: x.id, name: x.name })),
    openTasks: leaves.filter((t) => t.status !== "complete").length, lastUpdateAt: publications[0]?.publishedAt ?? null,
    signatureId: (sig as { id: string }[] | null)?.[0]?.id ?? null, manuallyApproved: !sig?.length && ["won", "scheduled", "in_progress", "completed"].includes(String(est?.pipeline_stage ?? "")),
    activity, today: todayIn(data.schedule.calendar.timezone),
  } : null;
  return (
    <div className="mx-auto max-w-7xl">
      <Breadcrumbs className="mb-3" items={[{ label: "Projects", href: "/projects" }, { label: data.schedule.name }]} />
      {summary && <ProjectSummary {...summary} />}
      {comm?.pm && comm.perms.includes("view_communications") && (
        <ProjectUpdatesPanel scheduleId={id} canConfigure={comm.perms.includes("configure_project_updates")} canAuto={comm.perms.includes("enable_auto_project_updates")} />
      )}
      <ProjectTabs estimateId={data.schedule.estimateId} initialTab={tab} customerId={(est?.customer_id as string | null) ?? null}>
        <ScheduleEditor initial={data} editHint={editHint} created={created === "1"} publications={publications} tradeLabels={Object.fromEntries(data.snapshot.trades.map((t) => [t, tradeName(t)]))} />
      </ProjectTabs>
    </div>
  );
}
