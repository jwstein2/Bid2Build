import Link from "next/link";
import { Fragment } from "react";
import { notFound } from "next/navigation";
import { Badge, Card, Notice } from "@/components/ui/misc";
import { requireSalesRep } from "@/lib/sales/server";
import { ACTIVITY_LABEL, SOURCE_LABEL, STAGES, STAGE_LABEL, verificationSources, type Duplicate, type Lead, type LeadActivity, type LeadTask } from "@/lib/sales/crm";
import { dateLabel, TIER_LABEL } from "@/lib/sales/format";
import { logActivity, saveTask, updateLead } from "../actions";
import { StarterScript } from "@/components/sales/starter-script";

export const metadata = { title: "Lead" };
const input = "min-h-11 w-full rounded-lg border border-line bg-white px-3 text-sm";
const btn = "min-h-11 rounded-lg bg-ink px-4 text-sm font-semibold text-white";
const when = (s: string) => new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });

export default async function LeadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { db } = await requireSalesRep();
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data, error } = await db.rpc("sales_crm_lead", { p_id: id });
  if (error || !data) notFound();
  const { lead: l, activities, tasks, duplicates } = data as { lead: Lead; activities: LeadActivity[]; tasks: LeadTask[]; duplicates: Duplicate[] };
  return (
    <div className="space-y-6">
      <div>
        <Link href="/sales/leads" className="text-sm font-semibold text-brand underline">← All leads</Link>
        <h1 className="mt-2 text-3xl font-extrabold">{l.company_name}</h1>
        <p className="mt-1 text-sm text-ink-soft">
          <Badge tone={l.stage === "paying" ? "ok" : "brand"}>{STAGE_LABEL[l.stage]}</Badge>{" "}
          {[l.city, l.state, l.zip].filter(Boolean).join(", ")} · {l.trades.join(", ") || "no trade set"} · {SOURCE_LABEL[l.source] ?? l.source}, found {dateLabel(l.discovered_at)}
          {l.customer_tier && <> · Built2Bid account: {TIER_LABEL[l.customer_tier] ?? l.customer_tier}</>}
        </p>
      </div>
      {sp.ok && <Notice tone="ok">{sp.ok}</Notice>}
      {sp.err && <Notice tone="warn">{sp.err}</Notice>}
      {l.do_not_contact && <Notice tone="danger" title="Do not contact">This business asked not to be contacted. Don&apos;t reach out.</Notice>}
      {duplicates.length > 0 && <Notice tone="warn" title="Similar businesses on file">{duplicates.map((d) => `${d.company_name}${d.zip ? ` (${d.zip})` : ""}: ${d.rep_name ?? "unassigned"}`).join("; ")}</Notice>}

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          {(l.sales_brief || l.business_started || l.verification) && (
            <Card className="p-5">
              <h2 className="text-lg font-bold">Sales brief</h2>
              {l.sales_brief ? <p className="mt-2 text-sm">{l.sales_brief}</p> : <p className="mt-2 text-sm text-ink-soft">The brief is being written and will show here shortly.</p>}
              <dl className="mt-3 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                {l.contact_name && <><dt className="text-muted">Owner</dt><dd>{l.contact_name}</dd></>}
                {l.business_started && <><dt className="text-muted">In business since</dt><dd>{l.business_started}</dd></>}
                {verificationSources(l.verification).map((v) => (
                  <Fragment key={v.field}><dt className="text-muted">{v.field} checked on</dt><dd className="break-all">{v.urls.map((u, i) => <Fragment key={u}>{i > 0 && ", "}<a href={u} target="_blank" rel="noopener noreferrer nofollow" className="text-brand underline">{hostOf(u)}</a></Fragment>)}</dd></Fragment>
                ))}
              </dl>
            </Card>
          )}
          <Card className="p-5">
            <h2 className="text-lg font-bold">Starter script</h2>
            <div className="mt-2"><StarterScript leadId={l.id} disabled={!!l.do_not_contact} /></div>
          </Card>
          <Card className="p-5">
            <h2 className="text-lg font-bold">Log an activity</h2>
            <form action={logActivity} className="mt-3 grid gap-3 sm:grid-cols-[160px_1fr]">
              <input type="hidden" name="id" value={l.id} />
              <label className="text-sm">Type<select name="kind" className={input}><option value="call">Call</option><option value="email">Email</option><option value="text">Text</option><option value="meeting">Meeting / demo</option><option value="note">Note</option></select></label>
              <label className="text-sm">What happened<textarea name="body" required maxLength={4000} rows={2} className={`${input} py-2`} /></label>
              <div><button className={btn}>Log it</button></div>
            </form>
          </Card>
          <Card className="p-5">
            <h2 className="text-lg font-bold">History</h2>
            <ol className="mt-3 space-y-3 text-sm">
              {activities.length === 0 && <li className="text-ink-soft">Nothing yet.</li>}
              {activities.map((a) => (
                <li key={a.id} className="border-l-2 border-line pl-3">
                  <p className="text-xs text-muted">{ACTIVITY_LABEL[a.kind] ?? a.kind} · {when(a.occurred_at)}{a.rep_name ? ` · ${a.rep_name}` : ""}</p>
                  {a.body && <p className="whitespace-pre-wrap">{a.body}</p>}
                </li>
              ))}
            </ol>
          </Card>
        </div>
        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="text-lg font-bold">Tasks</h2>
            <ul className="mt-2 space-y-2 text-sm">
              {tasks.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2">
                  <span className={t.done_at ? "text-muted line-through" : ""}>{t.title} · {dateLabel(t.due_at)}</span>
                  <form action={saveTask}><input type="hidden" name="id" value={l.id} /><input type="hidden" name="task" value={t.id} /><input type="hidden" name="done" value={t.done_at ? "0" : "1"} /><button className="text-sm font-semibold text-brand underline">{t.done_at ? "Reopen" : "Done"}</button></form>
                </li>
              ))}
            </ul>
            <form action={saveTask} className="mt-3 grid gap-2">
              <input type="hidden" name="id" value={l.id} /><input type="hidden" name="task" value="" />
              <label className="text-sm">Next action<input name="title" required maxLength={200} placeholder="e.g. Call back about demo" className={input} /></label>
              <label className="text-sm">Due<input name="due" type="date" required className={input} /></label>
              <div><button className={btn}>Add task</button></div>
            </form>
          </Card>
          <Card className="p-5">
            <h2 className="text-lg font-bold">Details</h2>
            <form action={updateLead} className="mt-3 grid gap-2">
              <input type="hidden" name="id" value={l.id} />
              <label className="text-sm">Stage<select name="stage" defaultValue={l.stage} className={input}>{STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}</select></label>
              <label className="text-sm">If lost, why<input name="lost_reason" defaultValue={l.lost_reason ?? ""} maxLength={300} className={input} /></label>
              <label className="text-sm">Contact<input name="contact_name" defaultValue={l.contact_name ?? ""} maxLength={120} className={input} /></label>
              <label className="text-sm">Email<input name="email" type="email" defaultValue={l.email ?? ""} className={input} /></label>
              <label className="text-sm">Phone<input name="phone" defaultValue={l.phone ?? ""} maxLength={40} className={input} /></label>
              <label className="text-sm">Website<input name="website" defaultValue={l.website ?? ""} maxLength={300} className={input} /></label>
              <div className="grid grid-cols-3 gap-2">
                <label className="text-sm">City<input name="city" defaultValue={l.city ?? ""} className={input} /></label>
                <label className="text-sm">State<input name="state" defaultValue={l.state ?? ""} className={input} /></label>
                <label className="text-sm">ZIP<input name="zip" defaultValue={l.zip ?? ""} pattern="\d{5}" className={input} /></label>
              </div>
              <label className="text-sm">Notes<textarea name="notes" defaultValue={l.notes ?? ""} rows={3} maxLength={4000} className={`${input} py-2`} /></label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="do_not_contact" defaultChecked={l.do_not_contact} /> Do not contact (they opted out)</label>
              <div><button className={btn}>Save details</button></div>
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}

function hostOf(u: string): string {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; }
}
