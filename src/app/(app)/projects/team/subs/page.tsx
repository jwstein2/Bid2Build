import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { HardHat } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { isPmEnabled } from "@/lib/env";
import { loadTeam } from "@/lib/projects/server";
import { loadComplianceSummary } from "@/lib/team/server";
import { addDays, complianceBadges } from "@/lib/team/records";
import { TeamHeader, TeamNav } from "@/components/team/team-nav";
import { Badge, Notice } from "@/components/ui/misc";

export const metadata: Metadata = { title: "Subcontractor records", robots: { index: false } };

const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** Projects → Team → Sub records: every subcontractor's W-9 / insurance / agreement status and renewals coming up. */
export default async function SubRecordsPage() {
  if (!isPmEnabled()) notFound();
  const supabase = await createClient();
  const [team, summary] = await Promise.all([loadTeam(supabase), loadComplianceSummary(supabase)]);
  const subs = (team?.resources ?? []).filter((r) => r.kind === "subcontractor" && r.status === "active");
  const today = new Date().toISOString().slice(0, 10);
  const renewals = subs.map((s) => ({ s, c: summary?.subs[s.id] })).filter((x) => x.c && (x.c.expired > 0 || (x.c.nextExpiry && x.c.nextExpiry <= addDays(today, 60))));
  return (
    <div className="mx-auto max-w-5xl space-y-5" data-guide-page="projects.team.subs">
      <TeamHeader title="Subcontractor records" intro="W-9s, insurance certificates, licenses and agreements for each subcontractor, with expiry dates so nothing lapses unnoticed." />
      <TeamNav active="subs" />
      {!summary ? <Notice tone="warn" title="Subcontractor records are being set up">The database update for this page hasn&apos;t been applied yet.</Notice> : (
        <>
          {!summary.canManage && <Notice>You can see who has what on file. Only the company owner and people allowed to “Manage subcontractor compliance” can open W-9s and certificates.</Notice>}
          {renewals.length > 0 && (
            <section className="rounded-xl border border-warn/40 bg-warn-tint p-4" data-testid="renewals">
              <p className="font-semibold text-navy">Renewals to chase</p>
              <ul className="mt-1 space-y-1 text-sm">{renewals.map(({ s, c }) => (
                <li key={s.id}>{summary.canManage ? <Link href={`/projects/team/subs/${s.id}`} className="font-semibold underline">{s.name}</Link> : <b>{s.name}</b>}
                  {": "}{c!.expired > 0 ? `${c!.expired} expired` : ""}{c!.expired > 0 && c!.nextExpiry ? ", " : ""}{c!.nextExpiry ? `next expiry ${fmt(c!.nextExpiry)}` : ""}</li>))}</ul>
              <p className="mt-1 text-xs text-muted">Ask them for an updated certificate from their own email. Nothing is sent automatically.</p>
            </section>
          )}
          {subs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">No subcontractors yet. Add them in <Link href="/projects/team" className="font-semibold underline">People &amp; subs</Link>.</div>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">{subs.map((s) => (
              <li key={s.id} className="rounded-xl border border-line bg-surface p-4" data-testid="sub-row">
                <p className="flex items-center gap-2 font-semibold text-navy"><HardHat className="h-4 w-4 text-accent-ink" aria-hidden />{s.name}</p>
                <p className="mt-1.5 flex flex-wrap gap-1">{complianceBadges(summary.subs[s.id]).map((b) => <Badge key={b.text} tone={b.tone}>{b.text}</Badge>)}
                  {summary.subs[s.id]?.agreementOnFile && <Badge tone="ok">Agreement on file</Badge>}</p>
                {summary.canManage && <Link href={`/projects/team/subs/${s.id}`} className="mt-2 inline-block text-sm font-semibold text-accent-ink underline">Open records</Link>}
              </li>))}</ul>
          )}
        </>
      )}
    </div>
  );
}
