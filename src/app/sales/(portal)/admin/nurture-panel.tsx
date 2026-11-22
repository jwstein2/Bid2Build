import Link from "next/link";
import { Badge, Card, Notice } from "@/components/ui/misc";
import { CampaignStatsCard, type CampaignStats } from "@/components/sales/campaign-stats";
import { answeredInitial, buildCtx, FOLLOW_UP_KEYS, KIND_LABEL, noAnswerInitial, renderKey, STATUS_LABEL, type CampaignKind } from "@/lib/sales/nurture/templates";
import { site } from "@/lib/site";
import { adminControlCampaign, saveNurtureSettings, setRepSender, toggleNurturePause } from "./nurture-actions";

export interface NurtureAdmin {
  settings: { enabled: boolean; send_mode: "off" | "test" | "live"; test_recipients: string[]; paused: boolean; follow_up_1_days: number; follow_up_2_days: number; send_start_hour: number; send_end_hour: number;
    weekdays_only: boolean; daily_limit: number; rep_daily_limit: number; postal_address: string | null; templates_approved_at: string | null };
  blockers: string[]; is_owner: boolean; team: CampaignStats; reps: { id: string; full_name: string; status: string; email: string; from_email: string | null; stats: CampaignStats }[];
  live: { id: string; lead_id: string; company_name: string; rep_name: string; kind: CampaignKind; status: string; steps_sent: number; next_send_at: string | null; started_at: string }[];
  failures: { company_name: string; rep_name: string; step: number; status: string; error: string | null; bounced: boolean; at: string }[];
  suppressions: { key: string; reason: string; at: string }[]; bad_emails: number;
  events: { kind: string; details: Record<string, unknown> | null; at: string; company_name: string | null; actor: string | null }[];
}

const input = "min-h-11 w-full rounded-lg border border-line bg-white px-3 text-sm";
const btn = "min-h-11 rounded-lg bg-ink px-4 text-sm font-semibold text-white";
const ghost = "min-h-9 rounded-lg border border-line bg-white px-2 text-xs font-semibold";
const when = (s: string | null) => (s ? new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }) : "—");
const BLOCKER: Record<string, string> = {
  feature_off: "The feature is off (reps don't see campaign controls).", sending_off: "Sending is off.", no_test_recipients: "Test mode needs at least one test address.",
  templates_not_approved: "Templates aren't approved yet.", no_postal_address: "The company postal address is missing (required by CAN-SPAM).",
};

/** Admin Sales Hub → Follow-up emails: switches, timing, limits, template review, performance, failures, opt-outs and the audit log. */
export function NurturePanel({ data, canSettings, canAct }: { data: NurtureAdmin; canSettings: boolean; canAct: boolean }) {
  const s = data.settings;
  const sample = buildCtx({ contactName: "Dana Smith", companyName: "ABC Construction", trades: ["roofing"], rep: { full_name: "Rita Rep", email: "rita@example.com", phone: "507-555-0100", code: "ABCD2345", booking_slug: "rita" }, origin: site.url });
  const noLink = { ...sample, scheduleLink: null };
  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold">Status</h2>
          <div className="flex gap-2"><Badge tone={s.enabled ? "ok" : "neutral"}>{s.enabled ? "Feature on" : "Feature off"}</Badge><Badge tone={s.send_mode === "live" ? "danger" : s.send_mode === "test" ? "warn" : "neutral"}>{s.send_mode === "live" ? "Live sending" : s.send_mode === "test" ? "Test sending" : "Sending off"}</Badge>{s.paused && <Badge tone="warn">Paused</Badge>}</div>
        </div>
        {data.blockers.length > 0 ? <ul className="mt-2 list-disc pl-5 text-sm text-ink-soft">{data.blockers.map((b) => <li key={b}>{BLOCKER[b] ?? b}</li>)}</ul>
          : <p className="mt-2 text-sm text-ink-soft">Ready. Reps can record call outcomes and send first emails{s.send_mode === "test" ? ", but only to the test addresses" : ""}; follow-ups send automatically every 15 minutes inside the sending window.</p>}
        {canSettings && (
          <form action={toggleNurturePause} className="mt-3"><input type="hidden" name="paused" value={s.paused ? "0" : "1"} />
            <button className={s.paused ? btn : "min-h-11 rounded-lg border border-danger px-4 text-sm font-semibold text-danger"}>{s.paused ? "Resume automated sending" : "Pause all automated sending"}</button>
          </form>
        )}
      </Card>

      <Card className="p-5" data-testid="nurture-senders">
        <h2 className="text-lg font-bold">Rep sending addresses</h2>
        <p className="mt-1 text-sm text-ink-soft">Follow-up emails only go out from a rep&apos;s own @built2bid.org address, and replies come back to it. Until one is assigned, follow-up emails are off for that rep: they can&apos;t start a campaign, and any scheduled follow-ups wait. Create the mailbox or alias in Google Workspace first.</p>
        <ul className="mt-3 divide-y divide-line">
          {data.reps.filter((r) => r.status === "active" || r.from_email).map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-40 flex-1"><p className="text-sm font-semibold">{r.full_name}</p>
                {r.from_email ? <Badge tone="ok">{`Sends as ${r.from_email}`}</Badge> : <Badge tone="warn">Off: no @built2bid.org address</Badge>}</div>
              {canSettings && (
                <form action={setRepSender} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="rep" value={r.id} />
                  <label className="sr-only" htmlFor={`sender-${r.id}`}>Sending address for {r.full_name}</label>
                  <input id={`sender-${r.id}`} name="email" type="email" placeholder="name@built2bid.org" pattern="[A-Za-z0-9._+\-]+@built2bid\.org"
                    defaultValue={r.from_email ?? ""} className="min-h-11 w-60 rounded-lg border border-line bg-white px-3 text-sm" />
                  <button className="min-h-11 rounded-lg border border-line bg-white px-3 text-sm font-semibold">Save</button>
                  {r.from_email && <button name="clear" value="1" className="min-h-11 rounded-lg px-2 text-sm font-semibold text-danger">Remove</button>}
                </form>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <CampaignStatsCard s={data.team} title="Team results (last 90 days)" links={false} />
      {data.reps.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-paper text-left text-xs text-muted"><tr><th className="p-3">Rep</th><th className="p-3">Emails sent</th><th className="p-3">Nurture</th><th className="p-3">Follow-up</th><th className="p-3">Replies</th><th className="p-3">Meetings</th><th className="p-3">Accounts</th><th className="p-3">Paid</th><th className="p-3">Bounced</th><th className="p-3">Opted out</th></tr></thead>
            <tbody>{data.reps.map((r) => (
              <tr key={r.id} className="border-t border-line"><td className="p-3 font-semibold">{r.full_name}</td><td className="p-3">{r.stats.emails_sent}</td><td className="p-3">{r.stats.nurture_active}</td><td className="p-3">{r.stats.follow_up_active}</td><td className="p-3">{r.stats.replied}</td><td className="p-3">{r.stats.meetings}</td><td className="p-3">{r.stats.accounts_created}</td><td className="p-3">{r.stats.converted}</td><td className="p-3">{r.stats.failed}</td><td className="p-3">{r.stats.unsubscribed}</td></tr>
            ))}</tbody>
          </table>
        </Card>
      )}

      {canSettings && (
        <Card className="p-5">
          <h2 className="text-lg font-bold">Settings</h2>
          <form action={saveNurtureSettings} className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm font-semibold sm:col-span-2"><input type="checkbox" name="enabled" defaultChecked={s.enabled} className="h-5 w-5" /> Feature on (reps see call outcomes and campaign controls on leads)</label>
            <label className="text-sm">Sending<select name="send_mode" defaultValue={s.send_mode} className={input}><option value="off">Off: nothing sends</option><option value="test">Test: only the test addresses below</option><option value="live" disabled={!data.is_owner && s.send_mode !== "live"}>Live: real leads (platform owner only)</option></select></label>
            <label className="text-sm">Test addresses (comma separated)<input name="test_recipients" defaultValue={s.test_recipients.join(", ")} className={input} /></label>
            <label className="text-sm">First follow-up after (days)<input name="follow_up_1_days" type="number" min={1} max={14} defaultValue={s.follow_up_1_days} className={input} /></label>
            <label className="text-sm">Final follow-up after (days, from the first email)<input name="follow_up_2_days" type="number" min={2} max={30} defaultValue={s.follow_up_2_days} className={input} /></label>
            <label className="text-sm">Send from (hour, lead&apos;s local time)<input name="send_start_hour" type="number" min={6} max={20} defaultValue={s.send_start_hour} className={input} /></label>
            <label className="text-sm">Send until (hour, lead&apos;s local time)<input name="send_end_hour" type="number" min={7} max={21} defaultValue={s.send_end_hour} className={input} /></label>
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="weekdays_only" defaultChecked={s.weekdays_only} className="h-5 w-5" /> Weekdays only</label>
            <label className="text-sm">Team limit per 24 hours<input name="daily_limit" type="number" min={1} max={1000} defaultValue={s.daily_limit} className={input} /></label>
            <label className="text-sm">Limit per rep per 24 hours<input name="rep_daily_limit" type="number" min={1} max={500} defaultValue={s.rep_daily_limit} className={input} /></label>
            <label className="text-sm sm:col-span-2">Company postal address (shown in every email footer)<input name="postal_address" defaultValue={s.postal_address ?? ""} maxLength={300} className={input} /></label>
            <div className="text-sm sm:col-span-2">
              {s.templates_approved_at ? <p>Templates approved {when(s.templates_approved_at)}. <label className="ml-2 inline-flex items-center gap-2"><input type="checkbox" name="revoke_templates" /> Withdraw approval</label></p>
                : <label className="flex items-center gap-2 font-semibold"><input type="checkbox" name="approve_templates" className="h-5 w-5" /> I reviewed the templates below and approve them</label>}
            </div>
            {data.is_owner && s.send_mode !== "live" && <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" name="confirm_live" className="mt-1 h-5 w-5" /> If choosing Live: I tested with test addresses and want real leads to receive these emails.</label>}
            <div className="sm:col-span-2"><button className={btn}>Save settings</button></div>
          </form>
        </Card>
      )}

      <Card className="p-5">
        <h2 className="text-lg font-bold">Live campaigns ({data.live.length})</h2>
        {data.live.length === 0 ? <p className="mt-2 text-sm text-ink-soft">None right now. Nothing is ever enrolled automatically: a rep starts each one after a call.</p> : (
          <ul className="mt-2 divide-y divide-line text-sm">
            {data.live.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span><Link href={`/sales/admin/leads/${c.lead_id}`} className="font-semibold underline">{c.company_name}</Link> · {c.rep_name} · {KIND_LABEL[c.kind]} · {STATUS_LABEL[c.status]} · {c.steps_sent} sent · next {when(c.next_send_at)}</span>
                {canAct && <span className="flex gap-1">
                  {(c.status === "active" ? ["pause", "stop"] : ["resume", "stop"]).map((a) => <form key={a} action={adminControlCampaign}><input type="hidden" name="campaign" value={c.id} /><input type="hidden" name="action" value={a} /><button className={ghost}>{a[0].toUpperCase() + a.slice(1)}</button></form>)}
                </span>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-lg font-bold">Failed deliveries</h2>
          {data.failures.length === 0 ? <p className="mt-2 text-sm text-ink-soft">None.</p> : (
            <ul className="mt-2 space-y-1 text-sm">{data.failures.map((f, i) => <li key={i}>{when(f.at)} · {f.company_name} ({f.rep_name}) · email {f.step + 1}: {f.bounced ? "bounced" : f.error}</li>)}</ul>
          )}
        </Card>
        <Card className="p-5">
          <h2 className="text-lg font-bold">Opt-outs and suppression</h2>
          <p className="mt-1 text-xs text-muted">Opt-outs apply to every rep and to future imports. {data.bad_emails} known-bad addresses are also skipped.</p>
          {data.suppressions.length === 0 ? <p className="mt-2 text-sm text-ink-soft">No email opt-outs yet.</p> : (
            <ul className="mt-2 space-y-1 text-sm">{data.suppressions.map((x) => <li key={x.key}>{x.key} · {x.reason.replace("_", " ")} · {when(x.at)}</li>)}</ul>
          )}
        </Card>
      </div>

      <Card className="p-5">
        <h2 className="text-lg font-bold">Approved email templates</h2>
        <p className="mt-1 text-sm text-ink-soft">Sample data shown. The first email is reviewed and can be edited by the rep. Follow-ups are chosen right before sending from the lead&apos;s verified activity (only an account linked to that lead counts), and sent exactly as written. No AI writes or changes them.</p>
        <div className="mt-3 space-y-2">
          {[answeredInitial(sample), noAnswerInitial(sample), ...FOLLOW_UP_KEYS.map((k) => renderKey(k, sample))].map((t) => (
            <details key={t.key} className="rounded-lg border border-line p-3">
              <summary className="cursor-pointer text-sm font-semibold">{t.key.replace(/_/g, " ")} · {t.subject}</summary>
              <p className="mt-2 whitespace-pre-wrap text-sm text-ink-soft">{t.body}</p>
            </details>
          ))}
          <details className="rounded-lg border border-line p-3">
            <summary className="cursor-pointer text-sm font-semibold">When a rep hasn&apos;t turned on a booking page (example)</summary>
            <p className="mt-2 whitespace-pre-wrap text-sm text-ink-soft">{renderKey("no_answer_d7", noLink).body}</p>
          </details>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="text-lg font-bold">Audit log</h2>
        {data.events.length === 0 ? <p className="mt-2 text-sm text-ink-soft">Nothing yet.</p> : (
          <ul className="mt-2 space-y-1 text-xs text-ink-soft">{data.events.map((e, i) => <li key={i}>{when(e.at)} · {e.kind.replace(/_/g, " ")}{e.company_name ? ` · ${e.company_name}` : ""}{e.actor ? ` · by ${e.actor}` : ""}{e.details && typeof e.details.reason === "string" ? ` · ${e.details.reason}` : ""}</li>)}</ul>
        )}
      </Card>
      {!canSettings && <Notice>Only administrators who manage the team can change these settings.</Notice>}
    </div>
  );
}
