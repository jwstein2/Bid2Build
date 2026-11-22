import Link from "next/link";
import { Badge, Card } from "@/components/ui/misc";
import { CALL_OUTCOMES, KIND_LABEL, MILESTONE_LABEL, START_BLOCK_LABEL, STATUS_LABEL, type CampaignKind, type Milestone } from "@/lib/sales/nurture/templates";
import { controlCampaign, recordCallOutcome, scheduleCall } from "@/app/sales/(portal)/leads/campaign-actions";
import type { Rendered } from "@/lib/sales/nurture/templates";

export interface CampaignMessage { id: string; step: number; status: string; scheduled_for: string; sent_at: string | null; delivered_at: string | null; bounced_at: string | null; template_key: string | null; milestone: string | null; subject: string | null; body: string | null; error: string | null }
export interface Campaign { id: string; kind: CampaignKind; status: string; to_email: string; steps_sent: number; first_sent_at: string | null; last_sent_at: string | null; next_send_at: string | null; end_reason: string | null; started_at: string; paused_at: string | null; ended_at: string | null; rep_name: string; messages: CampaignMessage[] }
export interface CampaignState {
  enabled: boolean; send_mode: "off" | "test" | "live"; paused: boolean; blockers: string[]; test_recipients: string[]; follow_up_days: [number, number];
  suppressed: string | null; milestones: { top: Milestone; linked: boolean; paid: boolean };
  can_start: { answered: string; no_answer: string }; live: Campaign | null; history: Campaign[];
  events: { kind: string; details: Record<string, unknown> | null; at: string }[];
  rep: { full_name: string; email: string; phone: string | null; code: string; booking_slug: string | null; from_email: string | null };
}

const input = "min-h-11 w-full rounded-lg border border-line bg-white px-3 text-sm";
const btn = "min-h-11 rounded-lg bg-ink px-4 text-sm font-semibold text-white";
const ghost = "min-h-11 rounded-lg border border-line bg-white px-3 text-sm font-semibold";
const when = (s: string | null | undefined) => (s ? new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago", timeZoneName: "short" }) : "—");
const day = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Chicago" }) : "—");
const STEP_LABEL = (kind: CampaignKind, step: number) => (step === 0 ? (kind === "answered" ? "Thank-you email" : "Introduction email") : step === 1 ? (kind === "answered" ? "Activity-based follow-up" : "Product introduction") : "Final follow-up");
const TONE: Record<string, "ok" | "warn" | "danger" | "brand" | "neutral"> = { active: "brand", paused: "warn", completed: "neutral", replied: "ok", meeting_scheduled: "ok", converted: "ok", unsubscribed: "danger", not_interested: "neutral", stopped: "neutral", failed_delivery: "danger" };

/** Call outcome buttons (reuses the call log). Shown when follow-up emails are switched on. */
export function CallOutcomeCard({ leadId, state, defaultTz }: { leadId: string; state: CampaignState; defaultTz: string }) {
  return (
    <Card className="p-5" data-testid="call-outcome">
      <h2 className="text-lg font-bold">After the call</h2>
      <p className="mt-1 text-sm text-muted">Pick what happened. Answered or no answer opens the first email for you to review and send. The rest happens automatically.</p>
      <form action={recordCallOutcome} className="mt-3 space-y-3">
        <input type="hidden" name="id" value={leadId} /><input type="hidden" name="tz" value={defaultTz} />
        <fieldset className="grid gap-2 sm:grid-cols-2">
          <legend className="sr-only">Call outcome</legend>
          {CALL_OUTCOMES.map((o) => (
            <label key={o.v} className="flex min-h-11 items-center gap-2 rounded-lg border border-line px-3 text-sm has-[:checked]:border-brand has-[:checked]:ring-2 has-[:checked]:ring-brand/30">
              <input type="radio" name="outcome" value={o.v} required /> {o.label}
            </label>
          ))}
        </fieldset>
        <label className="block text-sm">Callback time (for a callback, {defaultTz.split("/")[1]?.replace("_", " ")} time)<input type="datetime-local" name="callback_at" className={input} /></label>
        <label className="block text-sm">Notes (optional)<textarea name="note" rows={2} maxLength={3000} className={`${input} py-2`} /></label>
        <div className="flex flex-wrap items-center gap-3"><button className={btn}>Save outcome</button>
          {state.can_start.answered !== "ok" && state.can_start.no_answer !== "ok" && <span className="text-xs text-muted">{START_BLOCK_LABEL[state.can_start.answered] ?? ""}</span>}
        </div>
      </form>
    </Card>
  );
}

export function CampaignPanel({ leadId, company, state, lastCall, preview }: { leadId: string; company: string; state: CampaignState; lastCall: string | null; preview: { rendered: Rendered | null; endsAs: string | null; at: string | null } | null }) {
  const c = state.live ?? state.history[0] ?? null;
  const sent = (c?.messages ?? []).filter((m) => m.status === "sent");
  const last = sent[sent.length - 1];
  const next = c?.messages.find((m) => m.status === "scheduled" || m.status === "failed");
  const ms = state.milestones;
  const account = ms.paid ? "Paying customer" : ms.linked ? MILESTONE_LABEL[ms.top] : ms.top === "account_exists" ? "Has an account (not linked to you)" : "Not registered (or not linked)";
  return (
    <Card className="p-5" data-testid="campaign-panel">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-lg font-bold">Follow-up emails</h2>
        {state.send_mode === "test" && <Badge tone="warn">Test mode</Badge>}
      </div>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted">Lead</dt><dd>{company}</dd>
        <dt className="text-muted">Call outcome</dt><dd>{lastCall ?? "No call logged yet"}</dd>
        <dt className="text-muted">Campaign</dt><dd>{c ? <><Badge tone={TONE[c.status] ?? "neutral"}>{`${KIND_LABEL[c.kind]} ${STATUS_LABEL[c.status] ?? c.status}`}</Badge>{c.end_reason && !state.live ? <span className="text-xs text-muted"> · {c.end_reason}</span> : null}</> : STATUS_LABEL.not_enrolled}</dd>
        <dt className="text-muted">Last email</dt><dd>{last ? `${STEP_LABEL(c!.kind, last.step)} sent ${when(last.sent_at)}${last.bounced_at ? " · bounced" : last.delivered_at ? " · delivered" : ""}` : "—"}</dd>
        {state.live && <><dt className="text-muted">Next action</dt><dd>{next ? STEP_LABEL(c!.kind, next.step) : "—"}</dd>
          <dt className="text-muted">Next scheduled send</dt><dd>{state.live.status === "paused" ? "Paused" : next ? day(next.scheduled_for) : "—"}</dd></>}
        <dt className="text-muted">Account status</dt><dd>{account}</dd>
      </dl>
      {state.suppressed && <p className="mt-2 text-sm text-danger">{START_BLOCK_LABEL[state.suppressed]}</p>}

      <div className="mt-4 space-y-2">
        {sent.length > 0 && (
          <details className="rounded-lg border border-line p-3">
            <summary className="cursor-pointer text-sm font-semibold">View email{sent.length > 1 ? "s" : ""} ({sent.length})</summary>
            <ol className="mt-2 space-y-3">
              {sent.map((m) => (
                <li key={m.id} className="text-sm">
                  <p className="text-xs text-muted">{STEP_LABEL(c!.kind, m.step)} · {when(m.sent_at)}{m.milestone && m.step > 0 ? ` · chosen for: ${MILESTONE_LABEL[m.milestone as Milestone] ?? m.milestone}` : ""}</p>
                  <p className="font-semibold">{m.subject}</p>
                  <p className="whitespace-pre-wrap text-ink-soft">{m.body}</p>
                </li>
              ))}
            </ol>
          </details>
        )}
        {state.live && preview && (
          <details className="rounded-lg border border-line p-3">
            <summary className="cursor-pointer text-sm font-semibold">Preview next email</summary>
            <p className="mt-2 text-xs text-muted">Chosen again right before it sends ({preview.at ? day(preview.at) : "soon"}), from their activity at that moment. This is what it would say today.</p>
            {preview.rendered ? (<><p className="mt-2 text-sm font-semibold">{preview.rendered.subject}</p><p className="whitespace-pre-wrap text-sm text-ink-soft">{preview.rendered.body}</p></>)
              : <p className="mt-2 text-sm">{preview.endsAs ? `No email: the campaign would end (${preview.endsAs}).` : "Nothing more to send."}</p>}
          </details>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {state.live?.status === "active" && <form action={controlCampaign}><input type="hidden" name="id" value={leadId} /><input type="hidden" name="campaign" value={state.live.id} /><input type="hidden" name="action" value="pause" /><button className={ghost}>Pause campaign</button></form>}
        {state.live?.status === "paused" && <form action={controlCampaign}><input type="hidden" name="id" value={leadId} /><input type="hidden" name="campaign" value={state.live.id} /><input type="hidden" name="action" value="resume" /><button className={ghost}>Resume campaign</button></form>}
        <a href="#history" className={`${ghost} inline-flex items-center`}>View activity history</a>
        {!state.live && state.can_start.answered === "ok" && <Link href={`/sales/leads/${leadId}/email?kind=answered`} className={`${ghost} inline-flex items-center`}>Email client follow-up</Link>}
        {!state.live && state.can_start.no_answer === "ok" && <Link href={`/sales/leads/${leadId}/email?kind=no_answer`} className={`${ghost} inline-flex items-center`}>Start nurture</Link>}
      </div>
      <details className="mt-3" id="schedule-call">
        <summary className="cursor-pointer text-sm font-semibold">Schedule call</summary>
        <form action={scheduleCall} className="mt-2 space-y-2">
          <input type="hidden" name="id" value={leadId} /><input type="hidden" name="tz" value="America/Chicago" />
          <label className="block text-sm">When (Central time)<input type="datetime-local" name="at" required className={input} /></label>
          <button className={ghost}>Add to my calendar</button>
        </form>
      </details>
      {state.live && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-semibold text-danger">Stop campaign</summary>
          <form action={controlCampaign} className="mt-2 space-y-2">
            <input type="hidden" name="id" value={leadId} /><input type="hidden" name="campaign" value={state.live.id} /><input type="hidden" name="action" value="stop" />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="confirm" required className="h-5 w-5" /> Stop all remaining automatic emails to this lead (it won&apos;t restart)</label>
            <button className={ghost}>Stop campaign</button>
          </form>
        </details>
      )}
      {state.events.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-semibold text-muted">Campaign log</summary>
          <ul className="mt-2 space-y-1 text-xs text-muted">
            {state.events.slice(0, 20).map((e, i) => <li key={i}>{when(e.at)} · {e.kind.replace(/_/g, " ")}{e.details && typeof e.details.reason === "string" ? `: ${e.details.reason}` : e.details && typeof e.details.status === "string" ? `: ${STATUS_LABEL[e.details.status] ?? e.details.status}` : ""}</li>)}
          </ul>
        </details>
      )}
    </Card>
  );
}
