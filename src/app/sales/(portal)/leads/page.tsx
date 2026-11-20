import Link from "next/link";
import { Badge, Card, Notice } from "@/components/ui/misc";
import { requireSalesRep } from "@/lib/sales/server";
import { STAGES, STAGE_LABEL, TRADES, type Lead, type LeadTask } from "@/lib/sales/crm";
import { dateLabel } from "@/lib/sales/format";
import { createLead, importMyLeads } from "./actions";
import { AttentionCard, type Attention } from "./attention";
import { EmailStatusBadge } from "@/components/sales/email-status";
import { isBadEmail } from "@/lib/sales/crm";

export const metadata = { title: "Leads" };
const overdue = (iso: string) => new Date(iso).getTime() < Date.now();
const input = "min-h-11 w-full rounded-lg border border-line bg-white px-3 text-sm";

export default async function SalesLeads({ searchParams }: { searchParams: Promise<{ stage?: string; q?: string; ok?: string; err?: string }> }) {
  const { db } = await requireSalesRep();
  const sp = await searchParams;
  const { data, error } = await db.rpc("sales_crm_leads");
  if (error || !data) return <Notice title="Leads are getting set up">Check back in a little while.</Notice>;
  const { leads, tasks, role } = data as { leads: Lead[]; tasks: LeadTask[]; role: string };
  // V8.6 notices (new leads assigned, leads moved). Missing until 20270121001000 is applied.
  const nres = await db.rpc("sales_my_notices");
  const notices = (nres.error ? [] : nres.data ?? []) as { id: number; kind: string; body: string; at: string; unread: boolean }[];
  // V8.7 lead recycling. Missing until 20270122001000 is applied.
  const ares = await db.rpc("sales_my_attention");
  const attention = ares.error ? null : (ares.data as Attention);
  const stage = STAGES.find((s) => s === sp.stage);
  const q = (sp.q ?? "").trim().toLowerCase();
  const shown = leads.filter((l) => (!stage || l.stage === stage) && (!q || `${l.company_name} ${l.contact_name ?? ""} ${l.city ?? ""} ${l.zip ?? ""} ${l.trades.join(" ")}`.toLowerCase().includes(q)));
  const counts = Object.fromEntries(STAGES.map((s) => [s, leads.filter((l) => l.stage === s).length]));
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold">Leads</h1>
        <p className="mt-1 text-ink-soft">{role === "manager" ? "Every lead on the team." : "Leads assigned to you."} Each business is worked by one rep at a time.</p>
      </div>
      {sp.ok && <Notice tone="ok">{sp.ok}</Notice>}
      {sp.err && <Notice tone="warn">{sp.err}</Notice>}

      {attention && <AttentionCard data={attention} />}

      {notices.length > 0 && (
        <Card className="p-5">
          <h2 className="text-lg font-bold">Updates</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {notices.slice(0, 6).map((n) => <li key={n.id} className={n.unread ? "font-semibold" : "text-ink-soft"}>{n.body} <span className="text-xs font-normal text-muted">{dateLabel(n.at)}</span></li>)}
          </ul>
        </Card>
      )}

      {tasks.length > 0 && (
        <Card className="p-5">
          <h2 className="text-lg font-bold">Your next actions</h2>
          <ul className="mt-2 divide-y divide-line text-sm">
            {tasks.slice(0, 8).map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link href={`/sales/leads/${t.lead_id}`} className="font-semibold underline">{t.company_name}</Link>
                <span>{t.title}</span>
                <Badge tone={overdue(t.due_at) ? "danger" : "neutral"}>{overdue(t.due_at) ? "Overdue · " : "Due "}{dateLabel(t.due_at)}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <nav aria-label="Pipeline stages" className="flex gap-1 overflow-x-auto text-sm">
        <Link href="/sales/leads" aria-current={!stage ? "page" : undefined} className={`whitespace-nowrap rounded-md px-2.5 py-1.5 font-medium ${!stage ? "bg-ink text-white" : "text-ink-soft hover:bg-white"}`}>All ({leads.length})</Link>
        {STAGES.map((s) => (
          <Link key={s} href={`/sales/leads?stage=${s}`} aria-current={stage === s ? "page" : undefined} className={`whitespace-nowrap rounded-md px-2.5 py-1.5 font-medium ${stage === s ? "bg-ink text-white" : "text-ink-soft hover:bg-white"}`}>{STAGE_LABEL[s]} ({counts[s]})</Link>
        ))}
      </nav>
      <form className="flex gap-2" action="/sales/leads">
        {stage && <input type="hidden" name="stage" value={stage} />}
        <input name="q" defaultValue={sp.q} placeholder="Search name, city, ZIP or trade" aria-label="Search leads" className={input} />
        <button className="min-h-11 rounded-lg border border-line bg-white px-4 text-sm font-semibold">Search</button>
      </form>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b border-line text-left text-muted"><tr><th className="p-3">Business</th><th className="p-3">Location</th><th className="p-3">Trades</th><th className="p-3">Stage</th><th className="p-3">Next action</th>{role === "manager" && <th className="p-3">Rep</th>}</tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={6} className="p-4 text-ink-soft">No leads here yet. Add one below.</td></tr>}
            {shown.map((l) => (
              <tr key={l.id} className="border-b border-line last:border-0">
                <td className="p-3"><Link href={`/sales/leads/${l.id}`} className="font-semibold underline">{l.company_name}</Link>{l.contact_name && <p className="text-xs text-muted">{l.contact_name}</p>}{l.do_not_contact && <Badge tone="danger">Do not contact</Badge>}{l.email && isBadEmail(l.email_status) && <EmailStatusBadge status={l.email_status} />}</td>
                <td className="p-3">{[l.city, l.state].filter(Boolean).join(", ") || "—"} {l.zip}</td>
                <td className="p-3">{l.trades.join(", ") || "—"}</td>
                <td className="p-3"><Badge tone={l.stage === "paying" ? "ok" : l.stage === "lost" ? "neutral" : "brand"}>{STAGE_LABEL[l.stage]}</Badge></td>
                <td className="p-3">{l.next_action_at ? dateLabel(l.next_action_at) : "—"}</td>
                {role === "manager" && <td className="p-3">{l.rep_name ?? "Unassigned"}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="p-5">
        <h2 className="text-lg font-bold">Add a lead</h2>
        <form action={createLead} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-sm">Business name<input name="company_name" required maxLength={200} className={input} /></label>
          <label className="text-sm">Contact name<input name="contact_name" maxLength={120} className={input} /></label>
          <label className="text-sm">Email<input name="email" type="email" className={input} /></label>
          <label className="text-sm">Phone<input name="phone" maxLength={40} className={input} /></label>
          <label className="text-sm">Website<input name="website" maxLength={300} className={input} /></label>
          <div className="grid grid-cols-3 gap-2">
            <label className="col-span-1 text-sm">City<input name="city" maxLength={100} className={input} /></label>
            <label className="text-sm">State<input name="state" maxLength={40} className={input} /></label>
            <label className="text-sm">ZIP<input name="zip" inputMode="numeric" pattern="\d{5}" className={input} /></label>
          </div>
          <fieldset className="sm:col-span-2 lg:col-span-3">
            <legend className="text-sm">Trades</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {TRADES.map((tr) => <label key={tr} className="inline-flex min-h-9 items-center gap-1 rounded-full border border-line bg-white px-3 text-sm"><input type="checkbox" name="trades" value={tr} /> {tr}</label>)}
            </div>
          </fieldset>
          <label className="text-sm sm:col-span-2 lg:col-span-3">Notes<textarea name="notes" maxLength={4000} rows={2} className={`${input} py-2`} /></label>
          <label className="flex items-center gap-2 text-sm sm:col-span-2 lg:col-span-3"><input type="checkbox" name="allow_duplicate" /> It&apos;s a different business from a similar one already on file</label>
          <div><button className="min-h-11 rounded-lg bg-ink px-4 text-sm font-semibold text-white">Add lead</button></div>
        </form>
      </Card>

      <Card className="p-5">
        <details>
          <summary className="cursor-pointer text-lg font-bold">Import your own list</summary>
          <p className="mt-2 text-sm text-ink-soft">Upload a CSV with a header row (company, contact, email, phone, website, city, state, zip, trades), up to 500 rows. New businesses become your leads. Anything already on file stays with whoever has it, and existing Built2Bid customers go to an admin to review.</p>
          <form action={importMyLeads} className="mt-3 grid gap-3">
            <label className="text-sm">CSV file<input type="file" name="file" accept=".csv,text/csv,text/plain" className={`${input} py-2`} /></label>
            <label className="text-sm">Or paste rows<textarea name="rows" rows={3} className={`${input} py-2 font-mono`} placeholder="Summit Roofing, Dana Lee, dana@summitroofing.com, 612-555-0100, summitroofing.com, Minneapolis, MN, 55401, roofing" /></label>
            <div><button className="min-h-11 rounded-lg bg-ink px-4 text-sm font-semibold text-white">Import</button></div>
          </form>
        </details>
      </Card>
    </div>
  );
}
