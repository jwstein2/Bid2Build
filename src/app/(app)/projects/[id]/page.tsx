import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isPmEnabled } from "@/lib/env";
import { loadSchedule } from "@/lib/schedule/server";
import { loadPmAccess } from "@/lib/pm/server";
import { listPublications } from "@/lib/schedule/publications";
import { tradeName } from "@/lib/trades/catalog";
import { ScheduleEditor } from "@/components/schedule/editor";

export const metadata: Metadata = { title: "Project schedule", robots: { index: false } };

/**
 * Project detail: the Gantt schedule. Anyone who can see the bid can view it; editing needs the PM
 * entitlement (checked again by the server on every save).
 */
export default async function SchedulePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  if (!isPmEnabled()) notFound();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const [data, pm, publications] = await Promise.all([loadSchedule(supabase, id), loadPmAccess(supabase), listPublications(supabase, id)]);
  if (!data) notFound();
  const editHint = data.canEdit ? null : pm?.scope === "company" || data.schedule.companyId ? "seat" : "addon";
  const { created } = await searchParams;
  return (
    <div className="mx-auto max-w-7xl">
      <ScheduleEditor initial={data} editHint={editHint} created={created === "1"} publications={publications} tradeLabels={Object.fromEntries(data.snapshot.trades.map((t) => [t, tradeName(t)]))} />
    </div>
  );
}
