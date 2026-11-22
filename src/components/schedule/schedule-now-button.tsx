"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarRange } from "lucide-react";
import { getBrowserClient } from "@/lib/supabase/client";
import { isPmEnabled } from "@/lib/env";
import { buttonClass } from "@/components/ui/button";
import { calendarHref } from "@/lib/projects/calendar-link";

/**
 * Schedule Now in the bid header: shown only for an accepted bid (Won, a job stage, or signed). If the
 * bid already has a schedule it opens that one instead, so no duplicate project is ever started.
 */
export function ScheduleNowButton({ estimateId }: { estimateId: string }) {
  const [state, setState] = useState<{ href: string; label: string } | null>(null);
  useEffect(() => {
    if (!isPmEnabled()) return;
    let live = true;
    const sb = getBrowserClient();
    void Promise.all([
      sb.from("estimates").select("pipeline_stage").eq("id", estimateId).maybeSingle(),
      sb.from("project_schedules").select("id").eq("estimate_id", estimateId).neq("status", "archived").maybeSingle(),
      sb.from("signatures").select("id").eq("estimate_id", estimateId).limit(1),
    ]).then(([e, s, sig]) => {
      if (!live) return;
      if (s.data?.id) return setState({ href: calendarHref({ project: s.data.id }), label: "Open schedule" });
      const accepted = ["won", "scheduled", "in_progress", "completed"].includes((e.data as { pipeline_stage?: string } | null)?.pipeline_stage ?? "") || Boolean(sig.data?.length);
      if (accepted && !s.error) setState({ href: `/projects/new?estimate=${estimateId}`, label: "Schedule Now" });
    });
    return () => { live = false; };
  }, [estimateId]);
  if (!state) return null;
  return <Link href={state.href} className={buttonClass("secondary", "sm")} data-testid="schedule-now"><CalendarRange className="h-4 w-4" aria-hidden /> {state.label}</Link>;
}
