import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, Notice } from "@/components/ui/misc";
import { requireSalesAdmin } from "@/lib/sales/server";
import { ACTIVITY_LABEL, SOURCE_LABEL, STAGE_LABEL, verificationSources, type Duplicate, type Lead } from "@/lib/sales/crm";
import { dateLabel } from "@/lib/sales/format";
import { ADMIN_LEAD_ERRORS, DISPOSITIONS, DISPOSITION_LABEL, HOLD_LABEL, METHOD_LABEL, ORIGIN_LABEL } from "@/lib/sales/leads-admin";
import { cookies } from "next/headers";
import { adminLogActivity, adminScheduleFollowUp, assignLeadsV86, cancelAssign, confirmAssign, holdLeads } from "../../lead-actions";
import type { PendingAssign } from "../../leads-panel";
import { CONTACT_LEVEL, RECYCLE_OUTCOME, RECYCLE_PROTECTED, RECYCLE_REASON, RECYCLE_RULE, untilLabel, WARNING_LABEL } from "@/lib/sales/leads-admin";
import { extendDeadline, holdFromRecycling, recycleNow } from "../../recycle-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lead" };

interface Detail {
  lead: Lead & { lead_origin: string; hold_reason: string | null; hold_note: string | null; assigned_at: string | null };
  activities: { id: number; kind: string; body: string | null; occurred_at: string; disposition: string | null; evidence: string; actor: string | null; is_owner: boolean }[];
  tasks: { id: string; title: string; due_at: string; done_at: string | null; rep_name: string | null }[];
  assignments: { rep_name: string | null; previous: string | null; method: string; reason: string | null; at: string; ended_at: string | null; algorithm: string | null }[];
  beneficiary: { rep_name: string; since: string } | null;
  bookings: { starts_at: string; session: string; rep_name: string }[];
  imports: { at: string; outcome: string; source: string; label: string | null }[];
  duplicates: Duplicate[];
}

interface LeadRecycle {
  state: { rule: string | null; deadline: string | null; warned: boolean; protected: string | null } | null;
  contact_level: string; count: number; hold_until: string | null; hold_note: string | null; origin: string;
  history: { reason: string; outcome: string; cycle: number; at: string; note: string | null; from: string | null; to: string | null }[];
  disputes: { id: string; status: string; note: string; at: string }[];
}

const input = "min-h-11 w-full rounded-lg border border-line bg-white px-3 text-sm";
const btn = "min-h-11 rounded-lg bg-ink px-4 text-sm font-semibold text-white";
const btnLight = "min-h-11 rounded-lg border border-line bg-white px-3 text-sm font-semibold";
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Chicago" });

/** The admin's full profile of one lead: one shared record, whoever owns it. */
export default async function AdminLead({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string; confirm?: string }> }) {
  const { user, db, has } = await requireSalesAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sp = await searchParams;
  const { data, error } = await db.rpc("admin_sales_lead_detail", { p_caller: user.id, p_lead: id });
  if (error?.message?.includes("not_found")) notFound();
  if (error || !data) return <Notice tone="warn">Run <code className="break-all">supabase/migrations/20270121001000_sales_v86_leads.sql</code> in the Supabase SQL Editor to open lead profiles.</Notice>;
  const d = data as Detail;
  const l = d.lead;
  const repsRes = await db.from("sales_reps").select("id, full_name").in("status", ["active", "invited"]).eq("sells", true).order("full_name");
  const reps = (repsRes.data ?? []) as { id: string; full_name: string }[];
  const back = `lead:${id}`;
  const err = sp.err ? ADMIN_LEAD_ERRORS[sp.err] ?? "That didn't work. Check the form and try again." : null;
  const canAssign = has("reassign_leads");
  const rcRes = await db.rpc("admin_sales_lead_recycle", { p_caller: user.id, p_lead: id });
  const rc = rcRes.error ? null : (rcRes.data as LeadRecycle);
  let pending: PendingAssign | null = null;
  if (sp.confirm) { try { pending = JSON.parse((await cookies()).get("sales_assign_pending")?.value ?? "null"); } catch { pending = null; } }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/sales/admin?tab=leads" className="text-sm font-semibold text-brand underline">← All leads</Link>
        <h1 className="mt-2 text-3xl font-extrabold">{l.company_name}</h1>
        <p className="mt-1 text-sm text-ink-soft">{STAGE_LABEL[l.stage]} · {ORIGIN_LABEL[l.lead_origin] ?? l.lead_origin} · {SOURCE_LABEL[l.source] ?? l.source}, found {dateLabel(l.discovered_at)}
          {l.do_not_contact && <> · <Badge tone="danger">Do not contact</Badge></>}{l.customer_user_id && <> · <Badge tone="ok">Customer{l.customer_tier ? ` (${l.customer_tier})` : ""}</Badge></>}</p>
      </div>
      {sp.ok && <Notice tone="ok">{sp.ok}</Notice>}
      {err && <Notice tone="danger">{err}</Notice>}
      {pending && (
        <Notice tone="warn" title="Check before moving this lead">
          <ul className="mt-1 list-disc pl-5 text-sm">{pending.warnings.map((w) => <li key={w.lead_id}>With {w.owner}: {w.warnings.map((k) => WARNING_LABEL[k] ?? k).join(", ")}.</li>)}</ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <form action={confirmAssign}><input type="hidden" name="back" value={back} /><button className={btn}>Move it anyway</button></form>
            <form action={cancelAssign}><input type="hidden" name="back" value={back} /><button className={btnLight}>Cancel</button></form>
          </div>
        </Notice>
      )}
      {d.duplicates.length > 0 && <Notice tone="warn" title="Similar businesses on file">{d.duplicates.map((x) => `${x.company_name}${x.zip ? ` (${x.zip})` : ""}: ${x.rep_name ?? "unassigned"}`).join("; ")}</Notice>}

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="text-lg font-bold">Ownership</h2>
            <dl className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[12rem_1fr]">
              <dt className="text-muted">Lead owner</dt><dd>{l.rep_name ?? HOLD_LABEL[l.hold_reason ?? "unassigned"]}{l.assigned_at ? ` · since ${dateLabel(l.assigned_at)}` : ""}{l.hold_note ? ` · ${l.hold_note}` : ""}</dd>
              <dt className="text-muted">Commission goes to</dt><dd>{d.beneficiary ? `${d.beneficiary.rep_name} (attributed ${dateLabel(d.beneficiary.since)})` : "Nobody yet (set when the business signs up through a rep's link)"}</dd>
            </dl>
            <p className="mt-2 text-xs text-muted">Owner, the person who did each activity, and who earns commission are tracked separately. Reassigning the lead doesn&apos;t move commission.</p>
            {canAssign && (
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <form action={assignLeadsV86} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="back" value={back} /><input type="hidden" name="lead" value={id} />
                  <label className="text-sm">Owner<select name="rep" defaultValue={l.assigned_rep ?? ""} className={input}><option value="">Pick a rep</option>{reps.map((r) => <option key={r.id} value={r.id}>{r.full_name}</option>)}</select></label>
                  <label className="text-sm">Reason (optional)<input name="reason" maxLength={300} className={input} /></label>
                  <button name="mode" value="rep" className={btn}>{l.assigned_rep ? "Reassign" : "Assign"}</button>
                  <button name="mode" value="self" className={btnLight}>Assign to me</button>
                  {l.assigned_rep ? <button name="mode" value="unassign" className={btnLight}>Return to queue</button> : <button name="mode" value="auto" className={btnLight}>Share out by round robin</button>}
                </form>
                {!l.assigned_rep && (
                  <form action={holdLeads} className="flex items-end gap-2">
                    <input type="hidden" name="back" value={back} /><input type="hidden" name="lead" value={id} />
                    {l.hold_reason && l.hold_reason !== "no_eligible_rep" ? <button name="hold" value="release" className={btnLight}>Release hold</button> : <button name="hold" value="admin_hold" className={btnLight}>Hold</button>}
                  </form>
                )}
              </div>
            )}
          </Card>

          {rc && (
            <Card className="p-5" id="recycling">
              <h2 className="text-lg font-bold">Recycling</h2>
              <dl className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[12rem_1fr]">
                <dt className="text-muted">Contact so far</dt><dd>{CONTACT_LEVEL[rc.contact_level] ?? rc.contact_level}</dd>
                <dt className="text-muted">Clock</dt>
                <dd>{rc.origin !== "company" ? "Not recycled (not a company lead)" : !rc.state ? "No owner" : rc.state.protected ? `Paused: ${RECYCLE_PROTECTED[rc.state.protected] ?? rc.state.protected}`
                  : rc.state.rule ? <>{RECYCLE_RULE[rc.state.rule] ?? rc.state.rule}, deadline {when(rc.state.deadline!)} ({untilLabel(rc.state.deadline)}){rc.state.warned && <> · <Badge tone="warn">Rep warned</Badge></>}</> : "On track (worked, no overdue follow-up)"}</dd>
                <dt className="text-muted">Times recycled</dt><dd>{rc.count}{rc.hold_until ? ` · held until ${dateLabel(rc.hold_until)}${rc.hold_note ? ` (${rc.hold_note})` : ""}` : ""}</dd>
              </dl>
              {canAssign && l.assigned_rep && rc.origin === "company" && (
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <form action={extendDeadline} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="back" value={back} /><input type="hidden" name="lead" value={id} />
                    <label className="text-sm">Extend<select name="days" defaultValue="7" className={input}>{[3, 7, 14, 30].map((n) => <option key={n} value={n}>{n} days</option>)}</select></label>
                    <button className={btnLight}>Extend deadline</button>
                  </form>
                  <form action={holdFromRecycling} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="back" value={back} /><input type="hidden" name="lead" value={id} />
                    {rc.hold_until ? <button name="release" value="1" className={btnLight}>Remove recycling hold</button> : <>
                      <label className="text-sm">Hold until<input type="date" name="until" required className={input} /></label>
                      <label className="text-sm">Note<input name="note" maxLength={300} className={input} /></label>
                      <button className={btnLight}>Hold from recycling</button></>}
                  </form>
                  <form action={recycleNow} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="back" value={back} /><input type="hidden" name="lead" value={id} />
                    <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="confirm" required className="h-5 w-5" /> I&apos;m sure</label>
                    <button className={btnLight}>Recycle now</button>
                  </form>
                </div>
              )}
              {rc.disputes.length > 0 && <p className="mt-2 text-sm">Review requests: {rc.disputes.map((x) => `${dateLabel(x.at)} ${x.status} ("${x.note}")`).join("; ")}</p>}
              {rc.history.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm">{rc.history.map((h, i) => <li key={i}>{dateLabel(h.at)}: {RECYCLE_REASON[h.reason] ?? h.reason}, {h.from ?? "–"} → {h.to ?? "queue"} ({RECYCLE_OUTCOME[h.outcome] ?? h.outcome}){h.note ? ` · ${h.note}` : ""}</li>)}</ul>
              )}
            </Card>
          )}

          <Card className="p-5" id="log">
            <h2 className="text-lg font-bold">Log an activity</h2>
            <p className="mt-1 text-xs text-muted">Recorded once on this lead, as you. {l.rep_name ? `${l.rep_name} sees it in their CRM.` : ""} Calls and texts need a Do Not Call check and calling hours, same as reps.</p>
            <form action={adminLogActivity} className="mt-3 grid gap-3 sm:grid-cols-3">
              <input type="hidden" name="back" value={back} /><input type="hidden" name="lead" value={id} />
              <label className="text-sm">Type<select name="kind" className={input}><option value="email">Email</option><option value="call">Call</option><option value="text">Text</option><option value="meeting">Meeting</option><option value="reply">They replied</option><option value="note">Note</option></select></label>
              <label className="text-sm">Outcome<select name="disposition" className={input}><option value="">No outcome</option>{Object.entries(DISPOSITIONS).map(([k, opts]) => <optgroup key={k} label={ACTIVITY_LABEL[k] ?? k}>{opts.map((o) => <option key={`${k}-${o.v}`} value={o.v}>{o.label}</option>)}</optgroup>)}</select></label>
              <label className="text-sm sm:col-span-3">What happened<textarea name="body" required maxLength={4000} rows={2} className={`${input} py-2`} /></label>
              <div className="flex flex-wrap gap-2"><button className={btn}>Log it</button>{l.email && !l.do_not_contact && <a href={`mailto:${l.email}`} className={`${btnLight} inline-flex items-center`}>Open email</a>}</div>
            </form>
          </Card>

          <Card className="p-5" id="history">
            <h2 className="text-lg font-bold">History</h2>
            <ol className="mt-3 space-y-3 text-sm">
              {d.activities.length === 0 && <li className="text-ink-soft">Nothing yet.</li>}
              {d.activities.map((a) => (
                <li key={a.id} className="border-l-2 border-line pl-3">
                  <p className="text-xs text-muted">{ACTIVITY_LABEL[a.kind] ?? (a.kind === "reply" ? "Reply" : a.kind)}{a.disposition ? ` · ${DISPOSITION_LABEL[a.disposition] ?? a.disposition}` : ""} · {when(a.occurred_at)}{a.actor ? ` · ${a.actor}` : ""}{a.evidence === "manual" && ["call", "email", "text", "meeting", "reply"].includes(a.kind) ? " · logged by hand" : a.evidence === "provider" ? " · from the email provider" : ""}</p>
                  {a.body && <p className="whitespace-pre-wrap">{a.body}</p>}
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="text-lg font-bold">Contact</h2>
            <dl className="mt-2 space-y-1 text-sm">
              {l.contact_name && <div><dt className="inline text-muted">Contact: </dt><dd className="inline">{l.contact_name}</dd></div>}
              {l.email && <div><dt className="inline text-muted">Email: </dt><dd className="inline break-all">{l.email}</dd></div>}
              {l.phone && <div><dt className="inline text-muted">Phone: </dt><dd className="inline">{l.phone}</dd></div>}
              {l.website && <div><dt className="inline text-muted">Website: </dt><dd className="inline break-all">{l.website}</dd></div>}
              <div><dt className="inline text-muted">Location: </dt><dd className="inline">{[l.city, l.state].filter(Boolean).join(", ") || "—"} {l.zip}</dd></div>
              <div><dt className="inline text-muted">Trades: </dt><dd className="inline">{l.trades.join(", ") || "—"}</dd></div>
              {l.business_started && <div><dt className="inline text-muted">In business since: </dt><dd className="inline">{l.business_started}</dd></div>}
            </dl>
            {verificationSources(l.verification).length > 0 && <p className="mt-2 text-xs text-muted">Checked on: {verificationSources(l.verification).map((v) => `${v.field} (${v.urls.length})`).join(", ")}</p>}
          </Card>
          {(l.sales_brief || l.notes) && (
            <Card className="p-5">
              <h2 className="text-lg font-bold">Research</h2>
              {l.sales_brief && <p className="mt-2 text-sm">{l.sales_brief}</p>}
              {l.notes && <p className="mt-2 whitespace-pre-wrap text-sm text-ink-soft">{l.notes}</p>}
            </Card>
          )}
          <Card className="p-5" id="follow-up">
            <h2 className="text-lg font-bold">Follow-ups</h2>
            <ul className="mt-2 space-y-1 text-sm">
              {d.tasks.length === 0 && <li className="text-ink-soft">None.</li>}
              {d.tasks.map((t) => <li key={t.id} className={t.done_at ? "text-muted line-through" : ""}>{t.title} · {dateLabel(t.due_at)}{t.rep_name ? ` · ${t.rep_name}` : ""}</li>)}
            </ul>
            <form action={adminScheduleFollowUp} className="mt-3 grid gap-2">
              <input type="hidden" name="back" value={back} /><input type="hidden" name="lead" value={id} />
              <label className="text-sm">Next step<input name="title" required maxLength={200} className={input} /></label>
              <label className="text-sm">Due<input type="date" name="due" required className={input} /></label>
              <div><button className={btnLight}>Schedule for {l.rep_name ?? "me"}</button></div>
            </form>
          </Card>
          {d.bookings.length > 0 && (
            <Card className="p-5">
              <h2 className="text-lg font-bold">Upcoming sessions</h2>
              <ul className="mt-2 text-sm">{d.bookings.map((b, i) => <li key={i}>{when(b.starts_at)} · {b.rep_name}</li>)}</ul>
            </Card>
          )}
          <Card className="p-5">
            <h2 className="text-lg font-bold">Ownership history</h2>
            <ol className="mt-2 space-y-2 text-sm">
              {d.assignments.length === 0 && <li className="text-ink-soft">Never assigned.</li>}
              {d.assignments.map((a, i) => (
                <li key={i} className="border-l-2 border-line pl-3">
                  <p>{a.rep_name ?? "Unassigned"}{a.previous ? <span className="text-muted"> (from {a.previous})</span> : null}</p>
                  <p className="text-xs text-muted">{METHOD_LABEL[a.method] ?? a.method} · {dateLabel(a.at)}{a.reason ? ` · ${a.reason}` : ""}</p>
                </li>
              ))}
            </ol>
          </Card>
          {d.imports.length > 0 && (
            <Card className="p-5">
              <h2 className="text-lg font-bold">Imports</h2>
              <ul className="mt-2 text-sm">{d.imports.map((x, i) => <li key={i}>{dateLabel(x.at)} · {x.outcome === "duplicate" ? "Seen again (kept as is)" : x.outcome === "added" ? "Added" : x.outcome.replace(/_/g, " ")}{x.label ? ` · ${x.label}` : ""}</li>)}</ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
