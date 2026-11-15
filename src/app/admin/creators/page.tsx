import Link from "next/link";
import { Badge, Card } from "@/components/ui/misc";
import { requireAdmin } from "@/lib/admin/server";
import { STAGE_GROUPS, STAGE_LABELS, STAGE_TONES, isStage, outreachMetrics, type ProspectLite } from "@/lib/creator/crm";
import { Flash, btn, fmtDate, input } from "@/components/creator/flash";
import { importResearch } from "./actions";
import { CreatorSubNav } from "./sub-nav";

export const dynamic = "force-dynamic";

interface Row extends ProspectLite {
  id: string; rank: number | null; score: number | null; channel_name: string; creator_name: string | null; trade: string; subscribers_text: string | null;
  contact_email: string | null; gift_tier: number; first_wave: boolean; waitlist: boolean; cohort: string | null; follow_up_due_at: string | null;
  response_deadline_at: string | null; channel_url: string | null; confidence: string | null;
}

export default async function CreatorPartnerships({ searchParams }: { searchParams: Promise<{ group?: string; trade?: string; q?: string; msg?: string; err?: string }> }) {
  const { db } = await requireAdmin();
  const sp = await searchParams;
  const { data, error } = await db.from("creator_prospects")
    .select("id, rank, score, channel_name, creator_name, trade, subscribers_text, contact_email, gift_tier, first_wave, waitlist, cohort, stage, initial_sent_at, follow_up_due_at, follow_up_sent_at, response_deadline_at, replied_at, replied_after, reply_classification, channel_url, confidence")
    .order("waitlist").order("rank", { ascending: true, nullsFirst: false }).limit(1000);
  if (error) {
    return (
      <div className="space-y-3">
        <h1 className="text-3xl font-extrabold">Creator Partnerships</h1>
        <p className="text-ink-soft">The Creator Partnerships tables aren&apos;t installed yet. Apply <code>supabase/migrations/20261117001000_creator_partner_program.sql</code> and <code>20261117002000_creator_outreach_crm.sql</code> (after owner approval), then reload.</p>
      </div>
    );
  }
  const all = (data ?? []) as Row[];
  const metrics = outreachMetrics(all);
  const group = STAGE_GROUPS.find((g) => g.key === sp.group);
  const trades = [...new Set(all.map((r) => r.trade))].sort();
  const q = (sp.q ?? "").toLowerCase().slice(0, 80);
  const rows = all.filter((r) => (!group || (isStage(r.stage) && group.stages.includes(r.stage))) && (!sp.trade || r.trade === sp.trade)
    && (!q || r.channel_name.toLowerCase().includes(q) || (r.creator_name ?? "").toLowerCase().includes(q)));
  const byGroup = Object.fromEntries(STAGE_GROUPS.map((g) => [g.key, all.filter((r) => isStage(r.stage) && g.stages.includes(r.stage)).length]));
  const qs = (o: Record<string, string | undefined>) => { const u = new URLSearchParams(Object.entries({ group: sp.group, trade: sp.trade, q: sp.q, ...o }).filter(([, v]) => v) as [string, string][]); const s = u.toString(); return s ? `?${s}` : ""; };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold">Creator Partnerships</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-soft">Owner-only CRM for the invitation-only Creator Partner Program. Research stays traceable to its sources. Emails are sent only after you approve each one <em>and</em> switch on sending in Settings.</p>
      </div>
      <CreatorSubNav current="/admin/creators" />
      <Flash msg={sp.msg} err={sp.err} />

      <section aria-label="Outreach metrics" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat k="Initial emails sent" v={metrics.initialSent} />
        <Stat k="3-day follow-ups sent" v={metrics.followUpsSent} />
        <Stat k="Replies after initial" v={metrics.repliesAfterInitial} />
        <Stat k="Replies after follow-up" v={metrics.repliesAfterFollowUp} />
        <Stat k="Positive response rate" v={`${metrics.positiveRate}%`} />
        <Stat k="Accepted partnerships" v={metrics.accepted} />
        <Stat k="Unresponsive creators" v={metrics.unresponsive} />
        <Stat k="Reallocated opportunities" v={metrics.reallocated} />
      </section>

      <nav aria-label="Pipeline modules" className="flex flex-wrap gap-2 text-sm">
        <Link href={`/admin/creators${qs({ group: undefined })}`} className={!group ? "rounded-full bg-ink px-3 py-1 font-semibold text-white" : "rounded-full border border-line px-3 py-1"}>All ({all.length})</Link>
        {STAGE_GROUPS.map((g) => (
          <Link key={g.key} href={`/admin/creators${qs({ group: g.key })}`} className={group?.key === g.key ? "rounded-full bg-ink px-3 py-1 font-semibold text-white" : "rounded-full border border-line px-3 py-1"}>{g.label} ({byGroup[g.key]})</Link>
        ))}
      </nav>

      <form method="get" className="flex flex-wrap items-end gap-2">
        {group && <input type="hidden" name="group" value={group.key} />}
        <label className="text-sm"><span className="mb-1 block font-medium text-ink-soft">Search</span><input name="q" defaultValue={sp.q} className={input} placeholder="Channel or creator" /></label>
        <label className="text-sm"><span className="mb-1 block font-medium text-ink-soft">Trade</span>
          <select name="trade" defaultValue={sp.trade ?? ""} className={input}><option value="">All trades</option>{trades.map((t) => <option key={t}>{t}</option>)}</select></label>
        <button className={btn}>Apply</button>
        <a href="/admin/creators/export" download className="min-h-10 rounded-md border border-line-strong px-3 py-2 text-sm font-semibold">Export CSV</a>
      </form>

      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-paper text-left text-xs uppercase tracking-wide text-muted">
            <tr><th className="px-3 py-2">#</th><th className="px-3 py-2">Creator</th><th className="px-3 py-2">Trade</th><th className="px-3 py-2">Score</th><th className="px-3 py-2">Subs</th><th className="px-3 py-2">Contact</th><th className="px-3 py-2">Gifts</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Next date</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-line align-top">
                <td className="tabular px-3 py-2">{r.rank ?? (r.waitlist ? "W" : "—")}</td>
                <td className="px-3 py-2"><Link href={`/admin/creators/${r.id}`} className="font-semibold text-accent-ink underline">{r.channel_name}</Link>
                  {r.creator_name && <span className="block text-xs text-muted">{r.creator_name}</span>}
                  {r.first_wave && <Badge tone="accent" className="mt-1">First wave</Badge>}</td>
                <td className="px-3 py-2">{r.trade}</td>
                <td className="tabular px-3 py-2">{r.score ?? "—"}{r.confidence && <span className="block text-xs text-muted">{r.confidence} confidence</span>}</td>
                <td className="tabular px-3 py-2">{r.subscribers_text ?? "—"}</td>
                <td className="px-3 py-2">{r.contact_email ? <span className="break-all">{r.contact_email}</span> : <span className="text-warn">No verified email</span>}</td>
                <td className="tabular px-3 py-2">{r.gift_tier}</td>
                <td className="px-3 py-2">{isStage(r.stage) ? <Badge tone={STAGE_TONES[r.stage]}>{STAGE_LABELS[r.stage]}</Badge> : r.stage}{r.cohort && <span className="block text-xs text-muted">{r.cohort}</span>}</td>
                <td className="px-3 py-2 text-xs">{r.stage === "follow_up_scheduled" ? `Follow-up ${fmtDate(r.follow_up_due_at, true)}` : r.stage === "awaiting_response" ? `Deadline ${fmtDate(r.response_deadline_at, true)}` : "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={9} className="px-3 py-8 text-center text-ink-soft">{all.length ? "No creators match these filters." : "No creators yet. Import the research file below."}</td></tr>}
          </tbody>
        </table>
      </div>

      <Card className="p-4">
        <h2 className="font-display text-lg font-bold">Import research</h2>
        <p className="mt-1 text-sm text-ink-soft">Upload <code>creators_seed.json</code> (required) and optionally <code>outreach_drafts.md</code>. Creators are matched by YouTube channel ID, so re-importing updates research without touching outreach status. Drafts are saved as drafts only.</p>
        <form action={importResearch} className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-sm"><span className="mb-1 block font-medium">Research seed (JSON)</span><input type="file" name="seed" accept="application/json,.json" required className="text-sm" /></label>
          <label className="text-sm"><span className="mb-1 block font-medium">Outreach drafts (Markdown, optional)</span><input type="file" name="drafts" accept=".md,text/markdown,text/plain" className="text-sm" /></label>
          <button className={btn}>Import</button>
        </form>
      </Card>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: number | string }) {
  return <Card className="p-4"><p className="text-sm text-ink-soft">{k}</p><p className="tabular mt-1 text-3xl font-extrabold">{typeof v === "number" ? v.toLocaleString("en-US") : v}</p></Card>;
}
