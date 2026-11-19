import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAccountStatus } from "@/lib/account/server";
import { createClient } from "@/lib/supabase/server";
import { isFinancialsEnabled, isPmEnabled } from "@/lib/env";
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
import { ProjectCrew, type CrewRow } from "@/components/workforce/project-crew";

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
  // Performance: everything keyed only by the schedule id loads in one parallel round (it used to wait for
  // the schedule first, then the summary, then the crew). Only the two estimate lookups wait for the schedule.
  // V4.1 summary (people, closeout, activity) is absent before the V4.1 SQL runs: the editor still works.
  // V7.3 crew (who's assigned) is skipped quietly before the V4.2 / V7.3 SQL.
  const [data, pm, publications, account, comm, { data: row }, activity, { data: peopleRaw }, crew] = await Promise.all([
    loadSchedule(supabase, id), loadPmAccess(supabase), listPublications(supabase, id), getAccountStatus(), loadCommAccess(supabase),
    supabase.from("project_schedules").select("sales_rep_id, project_manager_id, actual_finish, closeout_note").eq("id", id).maybeSingle(),
    loadActivity(supabase, id),
    supabase.rpc("pm_people"),
    loadCrew(supabase, id),
  ]);
  if (!data) notFound();
  const editHint = data.canEdit ? null : pm?.scope === "company" || data.schedule.companyId ? "seat" : account.kind === "unlimited" ? "addon" : "upgrade";
  const { created, tab } = await searchParams;
  const [{ data: sig }, { data: est }] = await Promise.all([
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
    <div className="mx-auto max-w-7xl" data-guide-page="project.detail" data-guide-trade={data.snapshot.trades.join(" ")}>
      <Breadcrumbs className="mb-3" items={[{ label: "Projects", href: "/projects" }, { label: data.schedule.name }]} />
      {summary && <ProjectSummary {...summary} />}
      {crew && <ProjectCrew scheduleId={id} rows={crew} canEdit={data.permissions.edit} today={todayIn(data.schedule.calendar.timezone)} projectStatus={data.schedule.status} />}
      {comm?.pm && comm.perms.includes("view_communications") && (
        <ProjectUpdatesPanel scheduleId={id} canConfigure={comm.perms.includes("configure_project_updates")} canAuto={comm.perms.includes("enable_auto_project_updates")} />
      )}
      <ProjectTabs estimateId={data.schedule.estimateId} initialTab={tab} customerId={(est?.customer_id as string | null) ?? null} financials={isFinancialsEnabled()}>
        <ScheduleEditor initial={data} editHint={editHint} created={created === "1"} publications={publications} tradeLabels={Object.fromEntries(data.snapshot.trades.map((t) => [t, tradeName(t)]))} />
      </ProjectTabs>
    </div>
  );
}

async function loadCrew(supabase: Awaited<ReturnType<typeof createClient>>, scheduleId: string): Promise<CrewRow[] | null> {
  const { data: tasks, error } = await supabase.from("schedule_tasks")
    .select("id, name, parent_id, planned_start, planned_end, status, resource_id, assignment_status, assignment_inherited")
    .eq("schedule_id", scheduleId).not("resource_id", "is", null).order("planned_start");
  if (error || !tasks) return null;
  type T = { id: string; name: string; parent_id: string | null; planned_start: string; planned_end: string; status: string; resource_id: string; assignment_status: string | null; assignment_inherited: boolean };
  const rows = (tasks as T[]).filter((t) => !(t.assignment_inherited && (tasks as T[]).some((p) => p.id === t.parent_id && p.resource_id === t.resource_id)));
  const ids = [...new Set(rows.map((t) => t.resource_id))];
  if (!ids.length) return [];
  const full = await supabase.from("pm_resources").select("id, name, kind, entity, parent_id").in("id", ids);
  // Before the V7.3 SQL the new columns don't exist: fall back to the V4.2 ones.
  const res: unknown = full.error ? (await supabase.from("pm_resources").select("id, name, kind").in("id", ids)).data : full.data;
  type R = { id: string; name: string; kind: string; entity: string | null; parent_id: string | null };
  const list = (res as R[] | null) ?? [];
  const parentIds = list.map((r) => r.parent_id).filter((x): x is string => !!x);
  const { data: parents } = parentIds.length ? await supabase.from("pm_resources").select("id, name").in("id", parentIds) : { data: [] };
  const byId = new Map(list.map((r) => [r.id, r]));
  const pName = new Map(((parents as { id: string; name: string }[] | null) ?? []).map((p) => [p.id, p.name]));
  return rows.flatMap((t) => {
    const r = byId.get(t.resource_id);
    if (!r) return [];
    const kindLabel = r.kind === "staff" ? "Employee" : r.kind === "crew" ? "Crew" : r.parent_id ? "Worker" : r.entity === "individual" ? "Individual sub" : "Subcontractor";
    return [{ taskId: t.id, task: t.name, start: t.planned_start, end: t.planned_end, taskStatus: t.status, status: t.assignment_status,
      resourceId: r.id, resource: r.name, kindLabel, company: r.parent_id ? pName.get(r.parent_id) ?? null : null }];
  });
}
