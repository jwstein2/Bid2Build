import Link from "next/link";
import { Badge, Card, Notice } from "@/components/ui/misc";
import { isBadEmail, STAGES, STAGE_LABEL, SOURCE_LABEL, type Stage } from "@/lib/sales/crm";
import { EmailStatusBadge } from "@/components/sales/email-status";
import { dateLabel } from "@/lib/sales/format";
import { ageLabel, filterQuery, HOLD_LABEL, ORIGIN_LABEL, WARNING_LABEL, type LeadFilters } from "@/lib/sales/leads-admin";
import { allocateQueue, assignLeadsV86, cancelAssign, confirmAssign, decideDuplicate, importLeadsV86, recheckAllLeadEmails } from "./lead-actions";
import { FileDrop } from "@/components/ui/file-drop";

export interface AdminLeadRow {
  id: string; company_name: string; contact_name: string | null; email: string | null; phone: string | null; website: string | null;
  city: string | null; state: string | null; zip: string | null; trades: string[]; stage: Stage; source: string; lead_origin: string;
  assigned_rep: string | null; rep_name: string | null; assigned_at: string | null; hold_reason: string | null;
  last_activity_at: string | null; next_action_at: string | null; discovered_at: string; do_not_contact: boolean;
  customer_user_id: string | null; sales_brief: string | null; business_started: string | null; notes: string | null; dnc_status?: string; email_status?: string; email_check_note?: string | null;
  seen_again: number; beneficiary: string | null;
}
export interface AdminLeads { total: number; leads: AdminLeadRow[]; trades: string[]; states: string[]; queue: Record<string, { count: number; oldest: string }>; possible_pending: number }
export interface PendingAssign { leads: string[]; mode: string; rep: string | null; warnings: { lead_id: string; company_name: string; owner: string; warnings: string[] }[] }
export interface PossibleDup {
  id: number; at: string; source: string; row: Record<string, string | string[] | null>;
  candidates: { id: string; company_name: string; city: string | null; state: string | null; zip: string | null; phone: string | null; email: string | null; website: string | null; rep_name: string | null; stage: string }[];
}

const input = "min-h-11 w-full rounded-lg border border-line bg-white px-3 text-sm";
const sel = "min-h-11 rounded-lg border border-line bg-white px-2 text-sm";
const btn = "min-h-11 rounded-lg bg-ink px-4 text-sm font-semibold text-white";
const btnLight = "min-h-11 rounded-lg border border-line bg-white px-3 text-sm font-semibold";
const overdue = (iso: string | null) => !!iso && new Date(iso).getTime() < Date.now();

/** The Admin Sales Hub's master CRM: queue, imports, filters, compact table with inline and bulk assignment. */
export function LeadsPanel({ data, filters, reps, canAssign, pending, dups, view, importCard }: {
  data: AdminLeads; filters: LeadFilters; reps: { id: string; name: string }[]; canAssign: boolean;
  pending: PendingAssign | null; dups: PossibleDup[] | null; view: string | undefined; importCard: React.ReactNode;
}) {
  const back = filterQuery(filters);
  const queueTotal = Object.values(data.queue).reduce((t, q) => t + q.count, 0);
  const oldest = Object.values(data.queue).map((q) => q.oldest).sort()[0];
  const repOptions = reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>);
  const active = Object.keys(filters).length > 0;

  return (
    <div className="space-y-6">
      {pending && (
        <Notice tone="warn" title="Check before moving these leads">
          <ul className="mt-1 list-disc pl-5 text-sm">
            {pending.warnings.map((w) => <li key={w.lead_id}><strong>{w.company_name}</strong> (with {w.owner}) {w.warnings.map((k) => WARNING_LABEL[k] ?? k).join(", ")}.</li>)}
          </ul>
          <p className="mt-2 text-sm">Moving a lead never moves commission. The current owner keeps their history and gets a notice.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <form action={confirmAssign}><input type="hidden" name="back" value={back} /><button className={btn}>Move {pending.leads.length === 1 ? "it" : `all ${pending.leads.length}`} anyway</button></form>
            <form action={cancelAssign}><input type="hidden" name="back" value={back} /><button className={btnLight}>Cancel</button></form>
          </div>
        </Notice>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        <Card className="p-4">
          <p className="text-sm text-muted">Unassigned queue</p>
          <p className="text-2xl font-extrabold">{queueTotal}</p>
          <p className="text-xs text-muted">{queueTotal ? `Oldest waiting ${ageLabel(oldest)}` : "Every open lead has an owner."}</p>
          {queueTotal > 0 && <ul className="mt-2 space-y-0.5 text-xs">
            {Object.entries(data.queue).map(([k, q]) => <li key={k}><Link className="underline" href={`/sales/admin?${filterQuery({ owner: k === "unassigned" ? "none" : "held" })}`}>{HOLD_LABEL[k] ?? k}</Link>: {q.count}</li>)}
          </ul>}
          {canAssign && queueTotal > 0 && <form action={allocateQueue} className="mt-3"><input type="hidden" name="back" value={back} /><button className={btnLight}>Share out the queue now</button></form>}
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted">Possible duplicates to review</p>
          <p className="text-2xl font-extrabold">{data.possible_pending}</p>
          <p className="text-xs text-muted">Same name in the same town, but no matching website, email or phone.</p>
          {data.possible_pending > 0 && <Link className="mt-2 inline-block text-sm font-semibold text-brand underline" href="/sales/admin?tab=leads&view=dups">Review them</Link>}
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted">How new leads are shared</p>
          <p className="mt-1 text-sm">New company leads go to the active rep who has waited longest for one. Paused, suspended, offboarding and on-leave reps are skipped, and so are administrators unless they opt in. Reps&apos; own leads stay theirs.</p>
        </Card>
      </div>

      {view === "dups" && dups && (
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-bold">Possible duplicates</h2><Link className="text-sm underline" href="/sales/admin?tab=leads">Back to leads</Link></div>
          {dups.length === 0 && <p className="mt-2 text-sm text-ink-soft">Nothing waiting.</p>}
          <ul className="mt-3 space-y-4">
            {dups.map((d) => (
              <li key={d.id} className="rounded-lg border border-line p-3 text-sm">
                <p className="font-semibold">{String(d.row.company_name ?? "")} <span className="font-normal text-muted">· {[d.row.city, d.row.state, d.row.zip].filter(Boolean).join(", ")} · {[d.row.email, d.row.phone, d.row.website].filter(Boolean).join(" · ")} · imported {dateLabel(d.at)}</span></p>
                <p className="mt-2 text-xs text-muted">Might be:</p>
                <ul className="mt-1 space-y-1">
                  {d.candidates.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center gap-2">
                      <Link className="underline" href={`/sales/admin/leads/${c.id}`}>{c.company_name}</Link>
                      <span className="text-muted">{[c.city, c.state, c.zip].filter(Boolean).join(", ")} · {[c.email, c.phone, c.website].filter(Boolean).join(" · ")} · {c.rep_name ?? "unassigned"}</span>
                      {canAssign && <form action={decideDuplicate}><input type="hidden" name="back" value="tab=leads&view=dups" /><input type="hidden" name="row" value={d.id} /><input type="hidden" name="target" value={c.id} /><button name="decision" value="merge" className="text-sm font-semibold text-brand underline">Same business: merge</button></form>}
                    </li>
                  ))}
                </ul>
                {canAssign && <div className="mt-2 flex flex-wrap gap-2">
                  <form action={decideDuplicate}><input type="hidden" name="back" value="tab=leads&view=dups" /><input type="hidden" name="row" value={d.id} /><button name="decision" value="create" className={btnLight}>Different business: add it</button></form>
                  <form action={decideDuplicate}><input type="hidden" name="back" value="tab=leads&view=dups" /><input type="hidden" name="row" value={d.id} /><button name="decision" value="skip" className={btnLight}>Skip this row</button></form>
                </div>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {importCard}

      {canAssign && (
        <Card className="p-5">
          <details>
            <summary className="cursor-pointer text-lg font-bold">Add leads</summary>
            <p className="mt-2 text-sm text-ink-soft">Upload a CSV with a header row (company, contact, email, phone, website, city, state, zip, trades), or paste one business per line in that order. Every row is checked against the whole CRM: matches by website, email or phone stay with their current owner; same-name matches wait for your review.</p>
            <form action={importLeadsV86} className="mt-3 grid gap-3">
              <input type="hidden" name="back" value={back} />
              <FileDrop className="rounded-lg"><label className="text-sm">CSV file<input type="file" name="file" accept=".csv,text/csv,text/plain" className={`${input} py-2`} /></label></FileDrop>
              <label className="text-sm">Or paste rows<textarea name="rows" rows={3} className={`${input} py-2 font-mono`} placeholder="Summit Roofing, Dana Lee, dana@summitroofing.com, 612-555-0100, summitroofing.com, Minneapolis, MN, 55401, roofing;siding" /></label>
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-sm">Then<select name="mode" defaultValue="auto" className={sel}><option value="auto">Share out by round robin</option><option value="rep">Give them all to one rep</option><option value="hold">Hold in the queue</option></select></label>
                <label className="text-sm">Rep (if one rep)<select name="rep" className={sel}><option value="">Pick a rep</option>{repOptions}</select></label>
                <label className="text-sm">Label (optional)<input name="label" maxLength={200} className={input} /></label>
                <button className={btn}>Import</button>
              </div>
            </form>
            <form action={recheckAllLeadEmails} className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
              <input type="hidden" name="back" value={back} />
              <p className="text-sm text-ink-soft">Every lead&apos;s email is checked for a working mail server (DNS only, nothing is sent) when it&apos;s added and daily for new ones. Leads that can&apos;t receive mail are flagged.</p>
              <button className={btn}>Recheck all lead emails</button>
            </form>
          </details>
        </Card>
      )}

      <form method="get" action="/sales/admin" className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6" aria-label="Filter leads">
        <input type="hidden" name="tab" value="leads" />
        <label className="text-sm sm:col-span-3 lg:col-span-2">Search<input name="q" defaultValue={filters.q} placeholder="Business, contact, email, phone, city, ZIP" className={input} /></label>
        <label className="text-sm">Owner<select name="owner" defaultValue={filters.owner ?? ""} className={`${sel} w-full`}><option value="">Everyone</option><option value="none">Unassigned</option><option value="held">On hold / waiting</option>{repOptions}</select></label>
        <label className="text-sm">Stage<select name="stage" defaultValue={filters.stage ?? ""} className={`${sel} w-full`}><option value="">Any</option>{STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}</select></label>
        <label className="text-sm">Trade<select name="trade" defaultValue={filters.trade ?? ""} className={`${sel} w-full`}><option value="">Any</option>{data.trades.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
        <label className="text-sm">State<select name="state" defaultValue={filters.state ?? ""} className={`${sel} w-full`}><option value="">Any</option>{data.states.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
        <label className="text-sm">Follow-up<select name="follow" defaultValue={filters.follow ?? ""} className={`${sel} w-full`}><option value="">Any</option><option value="overdue">Overdue</option><option value="today">Due today</option><option value="week">Next 7 days</option><option value="none">None set</option></select></label>
        <label className="text-sm">Last contact<select name="contact" defaultValue={filters.contact ?? ""} className={`${sel} w-full`}><option value="">Any</option><option value="7">Last 7 days</option><option value="30">Over 30 days ago</option><option value="never">Never</option></select></label>
        <label className="text-sm">Source<select name="origin" defaultValue={filters.origin ?? ""} className={`${sel} w-full`}><option value="">Any</option>{Object.entries(ORIGIN_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="text-sm">Duplicates<select name="dup" defaultValue={filters.dup ?? ""} className={`${sel} w-full`}><option value="">Any</option><option value="seen_again">Seen again in an import</option><option value="possible">Has a possible duplicate</option></select></label>
        <div className="flex items-end gap-2"><button className={btn}>Filter</button>{active && <Link href="/sales/admin?tab=leads" className={`${btnLight} inline-flex items-center`}>Clear</Link>}</div>
      </form>

      <p className="text-sm text-muted">{data.total} lead{data.total === 1 ? "" : "s"}{data.total > data.leads.length ? `, showing the ${data.leads.length} most recently active` : ""}.</p>

      <form id="bulk" action={assignLeadsV86} />
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="border-b border-line text-left text-muted">
            <tr><th className="p-2"><span className="sr-only">Select</span></th><th className="p-2">Business</th><th className="p-2">Trade</th><th className="p-2">Location</th><th className="p-2">Stage</th><th className="p-2">Owner</th><th className="p-2">Last contact</th><th className="p-2">Next follow-up</th><th className="p-2">Source</th>{canAssign && <th className="p-2">Assign</th>}</tr>
          </thead>
          <tbody>
            {data.leads.length === 0 && <tr><td colSpan={10} className="p-4 text-ink-soft">No leads match.</td></tr>}
            {data.leads.map((l) => (
              <tr key={l.id} className="border-b border-line align-top last:border-0">
                <td className="p-2"><input type="checkbox" name="lead" value={l.id} form="bulk" aria-label={`Select ${l.company_name}`} className="size-4" /></td>
                <td className="p-2">
                  <Link href={`/sales/admin/leads/${l.id}`} className="font-semibold underline-offset-2 hover:underline">{l.company_name}</Link>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {l.do_not_contact && <Badge tone="danger">Do not contact</Badge>}
                    {l.customer_user_id && <Badge tone="ok">Customer</Badge>}
                    {l.seen_again > 0 && <Badge>Seen again ×{l.seen_again}</Badge>}
                    {l.email && isBadEmail(l.email_status) && <span title={l.email_check_note ?? undefined}><EmailStatusBadge status={l.email_status} /></span>}
                  </div>
                  {(l.contact_name || l.sales_brief || l.notes || l.email || l.phone) && (
                    <details className="mt-1 max-w-sm">
                      <summary className="cursor-pointer text-xs text-brand">Details</summary>
                      <div className="mt-1 space-y-1 text-xs text-ink-soft">
                        <p>{[l.contact_name, l.email, l.phone, l.website].filter(Boolean).join(" · ")}{l.business_started ? ` · since ${l.business_started.slice(0, 4)}` : ""}</p>
                        {l.sales_brief && <p><span className="font-semibold text-ink">Research:</span> {l.sales_brief}</p>}
                        {l.notes && <p className="whitespace-pre-wrap">{l.notes.slice(0, 600)}</p>}
                        {l.beneficiary && <p>Commission: {l.beneficiary}</p>}
                        <p className="flex flex-wrap gap-3 pt-1">
                          <Link className="underline" href={`/sales/admin/leads/${l.id}#log`}>Log call or email</Link>
                          <Link className="underline" href={`/sales/admin/leads/${l.id}#follow-up`}>Schedule follow-up</Link>
                          <Link className="underline" href={`/sales/admin/leads/${l.id}#history`}>History</Link>
                          {l.email && !l.do_not_contact && !isBadEmail(l.email_status) && <a className="underline" href={`mailto:${l.email}`}>Email</a>}
                        </p>
                      </div>
                    </details>
                  )}
                </td>
                <td className="p-2">{l.trades.join(", ") || "—"}</td>
                <td className="p-2">{[l.city, l.state].filter(Boolean).join(", ") || "—"}{l.zip ? ` ${l.zip}` : ""}</td>
                <td className="p-2">{STAGE_LABEL[l.stage]}</td>
                <td className="p-2">{l.rep_name ?? <span className="text-muted">{HOLD_LABEL[l.hold_reason ?? "unassigned"]}</span>}{l.assigned_at && <p className="text-xs text-muted">since {dateLabel(l.assigned_at)}</p>}</td>
                <td className="p-2">{l.last_activity_at ? dateLabel(l.last_activity_at) : <span className="text-muted">Never</span>}</td>
                <td className="p-2">{l.next_action_at ? <span className={overdue(l.next_action_at) ? "font-semibold text-danger" : ""}>{dateLabel(l.next_action_at)}</span> : "—"}</td>
                <td className="p-2 text-xs">{ORIGIN_LABEL[l.lead_origin] ?? l.lead_origin}<br /><span className="text-muted">{SOURCE_LABEL[l.source] ?? l.source}</span></td>
                {canAssign && <td className="p-2">
                  <form action={assignLeadsV86} className="flex gap-1">
                    <input type="hidden" name="back" value={back} /><input type="hidden" name="lead" value={l.id} />
                    <select name="rep" aria-label={`Owner for ${l.company_name}`} defaultValue={l.assigned_rep ?? ""} className={`${sel} max-w-36`}><option value="">Pick</option>{repOptions}</select>
                    <button name="mode" value="rep" className={btnLight}>{l.assigned_rep ? "Reassign" : "Assign"}</button>
                  </form>
                </td>}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {canAssign && (
        <div className="sticky bottom-2 z-10 space-y-2 rounded-xl border border-line bg-white p-3 shadow-sm">
          <p className="text-sm font-semibold">With the selected leads</p>
          <div className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="back" value={back} form="bulk" />
            <label className="text-sm">Rep<select name="rep" form="bulk" className={sel}><option value="">Pick a rep</option>{repOptions}</select></label>
            <label className="text-sm">Reason (optional)<input name="reason" form="bulk" maxLength={300} className={input} /></label>
            <button name="mode" value="rep" form="bulk" className={btn}>Assign to rep</button>
            <button name="mode" value="self" form="bulk" className={btnLight}>Assign to me</button>
            <button name="mode" value="auto" form="bulk" className={btnLight}>Share out (unassigned only)</button>
            <button name="mode" value="unassign" form="bulk" className={btnLight}>Return to queue</button>
          </div>
          <p className="text-xs text-muted">You&apos;ll see a warning first if a lead has recent conversations, meetings, a proposal, or a customer account. Commission never moves with a lead.</p>
        </div>
      )}
    </div>
  );
}
