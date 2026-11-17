import type { Metadata } from "next";
import Link from "next/link";
import { PmLockNotice } from "@/components/billing/pm-lock";
import { getAccountStatus } from "@/lib/account/server";
import { notFound, redirect } from "next/navigation";
import { createClient, getUser } from "@/lib/supabase/server";
import { isPmBillingConfigured, isPmEnabled } from "@/lib/env";
import { estimateAccepted } from "@/lib/schedule/server";
import { loadTeam } from "@/lib/projects/server";
import { loadPmAccess } from "@/lib/pm/server";
import { tradeName } from "@/lib/trades/catalog";
import { validTimeZone } from "@/lib/schedule/calendar";
import { Notice } from "@/components/ui/misc";
import { ScheduleWizard, type WizardSection } from "@/components/schedule/wizard";

export const metadata: Metadata = { title: "Schedule Now", robots: { index: false } };

/** Schedule Now: the 9-step wizard for one bid. One schedule per bid, so an existing one opens instead. */
export default async function NewSchedulePage({ searchParams }: { searchParams: Promise<{ estimate?: string }> }) {
  if (!isPmEnabled()) notFound();
  const { estimate: id } = await searchParams;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) redirect("/projects");
  const user = await getUser();
  if (!user) redirect(`/login?next=/projects/new?estimate=${id}`);
  const supabase = await createClient();
  const { data: est } = await supabase.from("estimates").select("id, title, customer_name, estimate_number, pipeline_stage, proposal_config, trades").eq("id", id).maybeSingle();
  if (!est) notFound();
  const { data: existing } = await supabase.from("project_schedules").select("id").eq("estimate_id", id).neq("status", "archived").maybeSingle();
  if (existing?.id) redirect(`/projects/${existing.id}`);

  const [pm, can, groupsRes, itemsRes, versionRes, profileRes, acc, team, peopleRes, reviewRes] = await Promise.all([
    loadPmAccess(supabase),
    supabase.rpc("can_schedule_estimate", { p_estimate_id: id }),
    supabase.from("estimate_groups").select("id, name, sort_order").eq("estimate_id", id).order("sort_order"),
    supabase.from("estimate_items").select("id, name, group_id, sort_order").eq("estimate_id", id).order("sort_order"),
    supabase.from("estimate_versions").select("version_number").eq("estimate_id", id).order("version_number", { ascending: false }).limit(1),
    supabase.from("profiles").select("timezone").eq("id", user.id).maybeSingle(),
    estimateAccepted(supabase, id, est.pipeline_stage as string | null),
    loadTeam(supabase),
    supabase.rpc("pm_people"),
    supabase.from("project_reviews").select("status").eq("estimate_id", id).maybeSingle(),
  ]);

  if (!pm?.canEdit || can.data !== true) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="text-2xl font-extrabold text-navy">Schedule Now</h1>
        {pm?.scope === "company" || isPmBillingConfigured("addon")
          ? <PmLockNotice tone="warn" title="You can't create schedules yet" kind={pm?.scope === "company" ? "company" : (await getAccountStatus()).kind === "unlimited" ? "unlimited" : "free"} />
          : <Notice tone="warn" title="You can't create schedules yet">Project Command Center for Unlimited is coming soon as an add-on.</Notice>}
        <Link href="/projects" className="font-semibold text-accent-ink underline">Back to Projects</Link>
      </div>
    );
  }

  const trades = (est.trades as string[] | null) ?? [];
  const sectionTrades = ((est.proposal_config as { worksheet?: { sectionTrades?: Record<string, string> } } | null)?.worksheet?.sectionTrades) ?? {};
  const items = (itemsRes.data ?? []) as { id: string; name: string; group_id: string }[];
  const sections: WizardSection[] = ((groupsRes.data ?? []) as { id: string; name: string; sort_order: number }[]).map((g) => ({
    id: g.id, name: g.name?.trim() || `Section ${g.sort_order + 1}`, trade: sectionTrades[g.id] ?? trades[0] ?? null,
    items: items.filter((i) => i.group_id === g.id).map((i) => ({ id: i.id, name: i.name?.trim() || "Item" })),
  }));
  // Keep the estimate's trade order (primary trade first), then section order within a trade.
  sections.sort((a, b) => (trades.indexOf(a.trade ?? "") - trades.indexOf(b.trade ?? "")) || 0);
  const tz = (profileRes.data as { timezone?: string | null } | null)?.timezone;

  return (
    <ScheduleWizard
      estimate={{ id, title: est.title as string, number: est.estimate_number as string, customerName: est.customer_name as string, stage: est.pipeline_stage as string | null, versionNumber: (versionRes.data?.[0] as { version_number?: number } | undefined)?.version_number ?? null }}
      accepted={acc.accepted} signed={acc.signed} sections={sections}
      timezone={tz && validTimeZone(tz) ? tz : "America/Chicago"}
      tradeLabels={Object.fromEntries(trades.map((t) => [t, tradeName(t)]))}
      team={team} people={peopleRes.error ? [] : ((peopleRes.data as { id: string; name: string }[]) ?? [])} me={user.id}
      needsReview={!reviewRes.error && (reviewRes.data as { status?: string } | null)?.status === "needs_review"}
    />
  );
}
