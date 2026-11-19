import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, Notice } from "@/components/ui/misc";
import { CopyField } from "@/components/sales/copy-field";
import { requireSalesAdmin } from "@/lib/sales/server";
import { dateLabel, usd } from "@/lib/sales/format";
import { site } from "@/lib/site";
import { inviteEmailsOn } from "@/lib/sales/invite-email";
import { ADMIN_LEAD_ERRORS, DELIVERY_LABEL, LEAD_PLANS, LIFECYCLE, lifecycle, REASON_CATEGORIES } from "@/lib/sales/leads-admin";
import { cancelOffboarding, completeOffboarding, reactivateRep, reassignRepLeads, revokeInvite, saveAllocation, sendInvite, setAccess, startOffboarding, updateOffboarding } from "../../../rep-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Manage rep" };

interface Offboarding {
  id: string; status: string; effective_date: string; reason_category: string; admin_notes: string | null; access_end: string; lead_plan: string; meetings_note: string | null;
  commission_review: string; reward_review: string; agreement_status: string; final_payout_review: string; tax_retention: string; started_at: string; completed_at: string | null; canceled_reason: string | null;
}
interface Work {
  leads: Record<"new" | "contacted" | "active" | "trial" | "customers" | "lost", number>; follow_ups: number; attributed_customers: number;
  meetings: { id: string; starts_at: string; customer_name: string; session: string }[];
  commissions: Record<string, { count: number; cents: number }>; unpaid_statements: number; boxes_open: number; rewards_open: number;
}
interface Manage {
  rep: {
    id: string; full_name: string; email: string; phone: string | null; role: string; status: string; sells: boolean; linked: boolean; created_at: string; activated_at: string | null;
    removed_at: string | null; reactivated_at: string | null; allocation_paused: boolean; allocation_paused_at: string | null; allocation_note: string | null; auto_leads: boolean | null;
    auto_effective: boolean; lead_states: string[]; lead_trades: string[]; last_allocated_at: string | null; eligible_now: boolean; is_owner: boolean; is_me: boolean; on_time_off: boolean; last_sign_in_at: string | null;
  };
  invites: { id: string; created_at: string; expires_at: string; opened_at: string | null; accepted_at: string | null; revoked_at: string | null; email: string | null; sent_at: string | null; send_count: number; delivery_status: string; last_error: string | null }[];
  offboarding: Offboarding | null; offboardings: Offboarding[]; work: Work; history: { action: string; at: string; details: Record<string, unknown> }[];
}

const input = "min-h-11 w-full rounded-lg border border-line bg-white px-3 text-sm";
const btn = "min-h-11 rounded-lg bg-ink px-4 text-sm font-semibold text-white";
const btnLight = "min-h-11 rounded-lg border border-line bg-white px-4 text-sm font-semibold";
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const ACTION: Record<string, string> = {
  "sales.offboarding_started": "Offboarding started", "sales.offboarding_updated": "Offboarding checklist updated", "sales.offboarding_completed": "Offboarded",
  "sales.offboarding_canceled": "Offboarding canceled", "sales.rep_reactivated": "Reactivated", "sales.rep_suspended": "Access suspended", "sales.rep_restored": "Access restored",
  "sales.allocation_paused": "Lead allocation paused", "sales.allocation_saved": "Lead allocation saved", "sales.invite_created": "Invite link created",
  "sales.invite_emailed": "Invitation emailed", "sales.invite_revoked": "Invitation turned off", "sales.rep_leads_reassigned": "Leads reassigned",
  "sales.rep_updated": "Profile updated", "sales.rep_role_changed": "Role changed", "sales.rep_invited": "Added to the team",
};

/**
 * One place to run a rep's whole lifecycle: invitation, lead allocation, access, offboarding and
 * reactivation. Each control is checked again in the database; offboarding never deletes records.
 */
export default async function ManageRep({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string; invite?: string; invite_rep?: string }> }) {
  const { user, db, has } = await requireSalesAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sp = await searchParams;
  const { data, error } = await db.rpc("admin_sales_rep_manage", { p_caller: user.id, p_rep: id });
  if (error?.message?.includes("not_found")) notFound();
  if (error || !data) return <Notice tone="warn">Run <code className="break-all">supabase/migrations/20270121001000_sales_v86_leads.sql</code> in the Supabase SQL Editor to manage reps here.</Notice>;
  const m = data as Manage;
  const r = m.rep;
  const repsRes = await db.from("sales_reps").select("id, full_name").eq("status", "active").eq("sells", true).neq("id", id).order("full_name");
  const others = (repsRes.data ?? []) as { id: string; full_name: string }[];
  const canManage = has("manage_reps") && (has("platform_owner") || (r.role !== "admin" && !r.is_me));
  const lc = LIFECYCLE[lifecycle({ status: r.status, linked: r.linked, allocation_paused: r.allocation_paused, reactivated_at: r.reactivated_at }, !!m.offboarding)];
  const inv = m.invites[0];
  const invState = !inv ? null : inv.accepted_at ? `Accepted ${dateLabel(inv.accepted_at)}` : inv.revoked_at ? "Turned off" : new Date(inv.expires_at) < new Date() ? "Expired" : inv.opened_at ? `Opened ${dateLabel(inv.opened_at)}, not signed in yet` : "Not opened yet";
  const inviteLink = sp.invite && sp.invite_rep === id && /^[A-Za-z0-9_-]{43}$/.test(sp.invite) ? new URL(`/sales/invite/${sp.invite}`, site.url).toString() : null;
  const err = sp.err ? ADMIN_LEAD_ERRORS[sp.err] ?? "That didn't work. Check the form and try again." : null;
  const w = m.work;
  const openLeads = w.leads.new + w.leads.contacted + w.leads.active + w.leads.trial;
  const o = m.offboarding;
  const reviewDone = o && o.commission_review === "reviewed" && o.reward_review === "reviewed" && o.final_payout_review !== "pending" && o.agreement_status !== "unknown" && o.tax_retention !== "pending";
  const owed = (["pending", "earned", "approved"] as const).reduce((t, s) => t + (w.commissions[s]?.cents ?? 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/sales/admin?tab=team" className="text-sm font-semibold text-brand underline">← Sales team</Link>
        <h1 className="mt-2 text-3xl font-extrabold">{r.full_name} <Badge tone={lc.tone}>{lc.label}</Badge></h1>
        <p className="mt-1 text-sm text-ink-soft">{r.email}{r.phone ? ` · ${r.phone}` : ""} · {r.role === "admin" ? "Sales administrator" : r.role === "manager" ? "Sales manager" : "Sales rep"}{r.is_owner ? " · platform owner" : ""}
          {" · "}added {dateLabel(r.created_at)}{r.last_sign_in_at ? ` · last signed in ${dateLabel(r.last_sign_in_at)}` : r.linked ? "" : " · hasn't signed in yet"}{r.reactivated_at ? ` · reactivated ${dateLabel(r.reactivated_at)}` : ""}</p>
        <p className="mt-1 text-sm"><Link className="text-brand underline" href={`/sales/admin/reps/${id}`}>View activity</Link> · <Link className="text-brand underline" href={`/sales/admin?tab=leads&owner=${id}`}>Their leads</Link> · <Link className="text-brand underline" href="/sales/admin?tab=commissions">Commissions</Link> · <Link className="text-brand underline" href="/sales/admin?tab=compliance">Compliance</Link> · <Link className="text-brand underline" href="/sales/admin?tab=team">Edit profile</Link></p>
      </div>
      {sp.ok && <Notice tone="ok">{sp.ok}</Notice>}
      {err && <Notice tone="danger">{err}</Notice>}
      {!canManage && <Notice tone="warn">{r.is_me ? "You can't change your own team record. Ask the platform owner." : "Only the platform owner can change an administrator."}</Notice>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {([["Open leads", openLeads], ["Customers", w.leads.customers], ["Open follow-ups", w.follow_ups], ["Upcoming meetings", w.meetings.length], ["Commission not yet paid", usd(owed)], ["Paid all time", usd(w.commissions.paid?.cents ?? 0)], ["Unpaid statements", w.unpaid_statements], ["Open boxes and rewards", w.boxes_open + w.rewards_open]] as [string, string | number][]).map(([k, v]) => (
          <Card key={k} className="p-4"><p className="text-sm text-muted">{k}</p><p className="text-xl font-extrabold">{v}</p></Card>
        ))}
      </div>

      {r.status !== "removed" && !r.linked && (
        <Card className="p-5">
          <h2 className="text-lg font-bold">Invitation</h2>
          {inv ? (
            <dl className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[12rem_1fr]">
              <dt className="text-muted">Status</dt><dd>{invState}</dd>
              <dt className="text-muted">Sent to</dt><dd>{inv.email ?? r.email}</dd>
              <dt className="text-muted">Email</dt><dd>{DELIVERY_LABEL[inv.delivery_status] ?? inv.delivery_status}{inv.sent_at ? ` · ${dateLabel(inv.sent_at)}` : ""}{inv.send_count > 1 ? ` · sent ${inv.send_count} times` : ""}{inv.last_error ? ` · ${inv.last_error}` : ""}</dd>
              <dt className="text-muted">Works until</dt><dd>{dateLabel(inv.expires_at)}</dd>
            </dl>
          ) : <p className="mt-1 text-sm text-ink-soft">No invitation yet.</p>}
          {inviteLink && (
            <div className="mt-3 space-y-2 rounded-lg border border-ok/40 bg-ok-tint p-3">
              <p className="text-sm font-semibold">Invite link (shown once, works for 14 days)</p>
              <CopyField value={inviteLink} label={`Invite link for ${r.full_name}`} />
              <p className="text-xs text-ink-soft">It only works when they sign in with {r.email}. A newer link turns this one off. Only a hash of it is stored, so it can&apos;t be shown again.</p>
            </div>
          )}
          {canManage && <div className="mt-3 flex flex-wrap gap-2">
            <form action={sendInvite}><input type="hidden" name="rep" value={id} /><button className={btn}>{inviteEmailsOn() ? (inv ? "Resend invitation" : "Email invitation") : inv ? "New invite link" : "Create invite link"}</button></form>
            {inv && !inv.accepted_at && !inv.revoked_at && <form action={revokeInvite}><input type="hidden" name="rep" value={id} /><button className={btnLight}>Turn off this invitation</button></form>}
          </div>}
          <p className="mt-2 text-xs text-muted">{inviteEmailsOn() ? "Emails go from your founder address. \"Accepted\" means the provider took it; delivered or bounced appears once the provider reports it." : "Invitation emails are off (SALES_INVITE_EMAILS). Each new link is shown here to copy and send yourself."} After signing in they land on their Sales Hub welcome.</p>
        </Card>
      )}

      {r.status !== "removed" && r.sells && (
        <Card className="p-5">
          <h2 className="text-lg font-bold">Lead allocation</h2>
          <p className="mt-1 text-sm text-ink-soft">{r.eligible_now ? "Getting new company leads by round robin." : "Not getting new company leads right now"}{r.on_time_off ? " (on time off)" : ""}{r.last_allocated_at ? ` · last automatic lead ${dateLabel(r.last_allocated_at)}` : ""}.</p>
          <form action={saveAllocation} className="mt-3 grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="rep" value={id} />
            <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" name="paused" defaultChecked={r.allocation_paused} disabled={!canManage} className="mt-1" /> Pause new leads (their current leads stay with them)</label>
            <label className="text-sm">Pause note (optional)<input name="note" maxLength={300} defaultValue={r.allocation_note ?? ""} disabled={!canManage} className={input} /></label>
            <label className="text-sm">Automatic leads
              <select name="auto" defaultValue={r.auto_leads === null ? "default" : r.auto_leads ? "on" : "off"} disabled={!canManage} className={input}>
                <option value="default">By role ({r.role === "admin" || r.is_owner ? "administrators: off" : "reps: on"})</option><option value="on">On</option><option value="off">Off (manual assignment only)</option>
              </select>
            </label>
            <label className="text-sm">States they cover (blank = anywhere)<input name="states" defaultValue={r.lead_states.join(", ")} placeholder="MN, WI" disabled={!canManage} className={input} /></label>
            <label className="text-sm">Trades they cover (blank = any)<input name="trades" defaultValue={r.lead_trades.join(", ")} placeholder="roofing, siding" disabled={!canManage} className={input} /></label>
            {canManage && <div><button className={btn}>Save allocation</button></div>}
          </form>
        </Card>
      )}

      {r.status !== "removed" && canManage && (
        <Card className="p-5">
          <h2 className="text-lg font-bold">Access</h2>
          {r.status === "suspended" ? (
            <form action={setAccess} className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
              <input type="hidden" name="rep" value={id} /><input type="hidden" name="action" value="restore" />
              <label className="text-sm">Reason (kept in the audit log)<input name="reason" required minLength={3} maxLength={300} className={input} /></label>
              <div className="flex items-end"><button className={btn}>Restore access</button></div>
            </form>
          ) : (
            <form action={setAccess} className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
              <input type="hidden" name="rep" value={id} /><input type="hidden" name="action" value="suspend" />
              <label className="text-sm">Reason (kept in the audit log)<input name="reason" required minLength={3} maxLength={300} className={input} /></label>
              <div className="flex items-end"><button className={btnLight}>Suspend access</button></div>
              <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" name="sign_out" className="mt-1" /> Also sign them out everywhere now (this ends every Built2Bid session for that login)</label>
            </form>
          )}
          <p className="mt-2 text-xs text-muted">Suspended reps can&apos;t open the Sales Hub and get no new leads. Their leads, customers and pay stay as they are.</p>
        </Card>
      )}

      {o && (
        <Card className="space-y-4 p-5">
          <div>
            <h2 className="text-lg font-bold">Offboarding <Badge tone="warn">In progress</Badge></h2>
            <p className="mt-1 text-sm text-ink-soft">Started {dateLabel(o.started_at)} · effective {dateLabel(o.effective_date)} · {REASON_CATEGORIES[o.reason_category]}. They get no new leads. Nothing is deleted and no pay is forfeited.</p>
          </div>
          <div className="rounded-lg border border-line p-3">
            <h3 className="font-semibold">1. Leads and customers</h3>
            <p className="mt-1 text-sm">New {w.leads.new} · contacted {w.leads.contacted} · active opportunities {w.leads.active} · in trial {w.leads.trial} · customers {w.leads.customers} (stay put) · open follow-ups {w.follow_ups} (move with their lead)</p>
            {has("reassign_leads") && openLeads > 0 && (
              <form action={reassignRepLeads} className="mt-3 grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="rep" value={id} />
                <fieldset className="text-sm sm:col-span-2"><legend>Move</legend>
                  <div className="mt-1 flex flex-wrap gap-3">
                    {([["new", "New"], ["contacted", "Contacted"], ["active", "Active opportunities"], ["trial", "In trial"]] as const).map(([k, l]) => <label key={k} className="inline-flex items-center gap-1"><input type="checkbox" name="cat" value={k} defaultChecked={k === "new" || k === "contacted"} /> {l}</label>)}
                  </div>
                </fieldset>
                <label className="text-sm">How<select name="method" defaultValue={o.lead_plan === "manual" ? "equal" : o.lead_plan} className={input}>
                  <option value="equal">{LEAD_PLANS.equal}</option><option value="trade">{LEAD_PLANS.trade}</option><option value="territory">{LEAD_PLANS.territory}</option><option value="rep">{LEAD_PLANS.rep}</option><option value="unassign">Back to the unassigned queue</option>
                </select></label>
                <label className="text-sm">Rep (if one rep)<select name="target" className={input}><option value="">Pick a rep</option>{others.map((x) => <option key={x.id} value={x.id}>{x.full_name}</option>)}</select></label>
                <div><button className={btn}>Move these leads</button></div>
                <p className="text-xs text-muted sm:col-span-2">Commission attribution never moves. New owners get a notice. Or assign them yourself from <Link className="underline" href={`/sales/admin?tab=leads&owner=${id}`}>their leads</Link>.</p>
              </form>
            )}
          </div>
          <div className="rounded-lg border border-line p-3">
            <h3 className="font-semibold">2. Meetings</h3>
            {w.meetings.length === 0 ? <p className="mt-1 text-sm text-ink-soft">No upcoming client sessions.</p> : (
              <ul className="mt-1 list-disc pl-5 text-sm">{w.meetings.map((b) => <li key={b.id}>{new Date(b.starts_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Chicago" })} · {b.customer_name}</li>)}</ul>
            )}
            {w.meetings.length > 0 && <p className="mt-1 text-xs text-muted">Reassign each session on the <Link className="underline" href="/sales/admin">Overview</Link> tab. They aren&apos;t canceled automatically.</p>}
          </div>
          {canManage && (
            <form action={updateOffboarding} className="space-y-3 rounded-lg border border-line p-3">
              <input type="hidden" name="rep" value={id} /><input type="hidden" name="id" value={o.id} />
              <h3 className="font-semibold">3. Reviews</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">Commission review ({w.commissions.pending?.count ?? 0} pending, {w.commissions.earned?.count ?? 0} earned, {w.commissions.approved?.count ?? 0} approved)<select name="commission_review" defaultValue={o.commission_review} className={input}><option value="pending">Not reviewed yet</option><option value="reviewed">Reviewed (sales paid before they leave still pay out)</option></select></label>
                <label className="text-sm">Bonuses and rewards ({w.boxes_open} boxes, {w.rewards_open} rewards open)<select name="reward_review" defaultValue={o.reward_review} className={input}><option value="pending">Not reviewed yet</option><option value="reviewed">Reviewed</option></select></label>
                <label className="text-sm">Rep agreement<select name="agreement_status" defaultValue={o.agreement_status} className={input}><option value="unknown">Not checked</option><option value="on_file">Signed agreement on file (kept)</option><option value="not_applicable">Not applicable</option><option value="missing">Missing</option></select></label>
                <label className="text-sm">Final payout ({w.unpaid_statements} unpaid statements)<select name="final_payout_review" defaultValue={o.final_payout_review} className={input}><option value="pending">Not reviewed yet</option><option value="scheduled">Final payout scheduled on the normal statement</option><option value="not_needed">Nothing owed</option></select></label>
                <label className="text-sm">Tax records (W-9, 1099)<select name="tax_retention" defaultValue={o.tax_retention} className={input}><option value="pending">Not confirmed</option><option value="retained">Kept for the required period</option><option value="not_applicable">Not applicable</option></select></label>
                <label className="text-sm">Lead plan<select name="lead_plan" defaultValue={o.lead_plan} className={input}>{Object.entries(LEAD_PLANS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                <label className="text-sm">Effective date<input type="date" name="effective_date" defaultValue={o.effective_date} className={input} /></label>
                <label className="text-sm">Reason<select name="reason_category" defaultValue={o.reason_category} className={input}>{Object.entries(REASON_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                <label className="text-sm sm:col-span-2">Meeting coverage notes<textarea name="meetings_note" maxLength={1000} rows={2} defaultValue={o.meetings_note ?? ""} className={`${input} py-2`} /></label>
                <label className="text-sm sm:col-span-2">Administrative notes (administrators only; no health, family or other personal details)<textarea name="admin_notes" maxLength={4000} rows={3} defaultValue={o.admin_notes ?? ""} className={`${input} py-2`} /></label>
              </div>
              <p className="text-xs text-muted">Final pay: Built2Bid pays every sale whose customer payment happened before the rep left, including lines still in the 30-day hold, on the normal statement. Check your state&apos;s final-payment timing for contractors and employees with your accountant.</p>
              <button className={btnLight}>Save checklist</button>
            </form>
          )}
          {canManage && (
            <div className="grid gap-3 sm:grid-cols-2">
              <form action={completeOffboarding} className="space-y-2 rounded-lg border border-line p-3">
                <input type="hidden" name="rep" value={id} /><input type="hidden" name="id" value={o.id} />
                <h3 className="font-semibold">4. Finish</h3>
                <p className="text-sm text-ink-soft">Ends access, turns off their booking link, invitations and Google Calendar connection, and shares out any open leads left. Earned pay, statements, agreements, customers and history are kept.</p>
                <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="sign_out" defaultChecked className="mt-1" /> Sign them out everywhere</label>
                <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirm" required className="mt-1" /> I&apos;ve reviewed this and want to finish offboarding {r.full_name}</label>
                <button className={btn} disabled={!reviewDone}>Finish offboarding</button>
                {!reviewDone && <p className="text-xs text-muted">Complete every review above first.</p>}
              </form>
              <form action={cancelOffboarding} className="space-y-2 rounded-lg border border-line p-3">
                <input type="hidden" name="rep" value={id} /><input type="hidden" name="id" value={o.id} />
                <h3 className="font-semibold">Cancel offboarding</h3>
                <label className="text-sm">Reason<input name="reason" required minLength={3} maxLength={300} className={input} /></label>
                <button className={btnLight}>Cancel offboarding</button>
              </form>
            </div>
          )}
        </Card>
      )}

      {!o && r.status !== "removed" && canManage && (
        <Card className="p-5">
          <details>
            <summary className="cursor-pointer text-lg font-bold">Offboard {r.full_name}</summary>
            <p className="mt-2 text-sm text-ink-soft">A guided checklist. Starting it stops new leads right away. Nothing is deleted, no pay is forfeited, and nothing is sent to the rep.</p>
            <form action={startOffboarding} className="mt-3 grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="rep" value={id} />
              <label className="text-sm">Effective date<input type="date" name="effective_date" required defaultValue={today()} className={input} /></label>
              <label className="text-sm">Reason<select name="reason_category" required className={input}>{Object.entries(REASON_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label className="text-sm">When access ends<select name="access_end" defaultValue="on_completion" className={input}><option value="on_completion">When I finish the checklist</option><option value="now">Now (suspend while I work through it)</option></select></label>
              <label className="text-sm">Lead plan<select name="lead_plan" defaultValue="equal" className={input}>{Object.entries(LEAD_PLANS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label className="text-sm sm:col-span-2">Administrative notes (administrators only)<textarea name="admin_notes" maxLength={4000} rows={3} className={`${input} py-2`} placeholder="What happened and any follow-up. Leave out health, family or other personal details." /></label>
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="sign_out" className="mt-1" /> If access ends now, sign them out everywhere</label>
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirm" required className="mt-1" /> Start offboarding</label>
              <div><button className={btn}>Start offboarding</button></div>
            </form>
          </details>
        </Card>
      )}

      {(r.status === "removed" || r.status === "suspended") && !o && canManage && (
        <Card className="p-5">
          <h2 className="text-lg font-bold">Reactivate</h2>
          <p className="mt-1 text-sm text-ink-soft">Brings back the same person and record: history, customers, ledger and payouts stay as they were. Leads moved to others stay with them. Lead allocation starts paused.</p>
          <form action={reactivateRep} className="mt-3 grid gap-3">
            <input type="hidden" name="rep" value={id} />
            <label className="text-sm">Note (optional)<input name="note" maxLength={500} className={input} /></label>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="agreement" required className="mt-1" /> I&apos;ve confirmed it&apos;s really them (same email) and a current rep agreement and tax form are on file</label>
            <div><button className={btn}>Reactivate</button></div>
          </form>
        </Card>
      )}

      {m.offboardings.length > 0 && (
        <Card className="p-5">
          <h2 className="text-lg font-bold">Past offboardings</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {m.offboardings.map((x) => (
              <li key={x.id} className="border-l-2 border-line pl-3">
                <p className="font-semibold">{x.status === "completed" ? `Offboarded ${dateLabel(x.completed_at)}` : `Canceled: ${x.canceled_reason ?? ""}`} · {REASON_CATEGORIES[x.reason_category]} · effective {dateLabel(x.effective_date)}</p>
                {x.admin_notes && <p className="whitespace-pre-wrap text-ink-soft">{x.admin_notes}</p>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="p-5">
        <h2 className="text-lg font-bold">History</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {m.history.length === 0 && <li className="text-ink-soft">Nothing yet.</li>}
          {m.history.map((h, i) => <li key={i}><span className="text-muted">{dateLabel(h.at)}</span> · {ACTION[h.action] ?? h.action.replace(/^sales\./, "").replace(/_/g, " ")}{typeof h.details?.reason === "string" ? `: ${h.details.reason}` : ""}</li>)}
        </ul>
      </Card>
    </div>
  );
}
