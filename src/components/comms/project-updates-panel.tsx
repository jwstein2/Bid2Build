"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Card, Field, Notice } from "@/components/ui/misc";
import { FREQUENCY_LABEL, MESSAGE_STATUS_LABEL, type MessageStatus, type UpdateFrequency } from "@/lib/comms/types";

interface State {
  settings: { frequency: UpdateFrequency; mode: "review" | "automatic"; recipientEmail: string | null; recipientName: string | null; pausedAt: string | null; autoConfirmedAt: string | null } | null;
  defaults: { frequency: UpdateFrequency; mode: "review" | "automatic"; timezone: string };
  next: { id: string; status: MessageStatus; scheduled_for: string | null; status_reason: string | null; trigger: string } | null;
  nextWeeklyAt: string | null;
  last: { sent_at: string; subject: string } | null;
  scheduleStatus: string;
  preview: { subject: string; body: string; recipient: { email: string | null; name: string } } | null;
}
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");

/** Customer updates for one project: frequency, review-first vs automatic, next/last email, preview. */
export function ProjectUpdatesPanel({ scheduleId, canConfigure, canAuto }: { scheduleId: string; canConfigure: boolean; canAuto: boolean }) {
  const [st, setSt] = useState<State | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [agree, setAgree] = useState(false);
  const [email, setEmail] = useState("");
  const load = useCallback((preview = false) => {
    fetch(`/api/comms/projects/${scheduleId}${preview ? "?preview=1" : ""}`, { cache: "no-store" }).then(async (r) => {
      const d = await r.json().catch(() => ({}));
      if (r.ok) { setSt(d); setEmail(d.settings?.recipientEmail ?? ""); } else if (r.status !== 402 && r.status !== 403) setErr(d?.error?.message ?? null);
    }).catch(() => {});
  }, [scheduleId]);
  useEffect(() => { load(); }, [load]);
  if (!st) return null;
  // A project without its own settings starts in Review first, even if the company default is automatic:
  // automatic sending is always confirmed per project (with the disclaimer) before it applies.
  const cur = st.settings ?? { frequency: "off" as UpdateFrequency, mode: "review" as const, recipientEmail: null, recipientName: null, pausedAt: null, autoConfirmedAt: null };
  const save = async (patch: Partial<{ frequency: UpdateFrequency; mode: string; paused: boolean; recipientEmail: string | null; confirmAutomatic: boolean }>) => {
    setBusy(true); setErr(null);
    const r = await fetch(`/api/comms/projects/${scheduleId}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ frequency: cur.frequency, mode: cur.mode, ...patch }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) setErr(d?.error?.message ?? "Could not save."); else setSt({ ...st, ...d, preview: st.preview });
  };
  const on = cur.frequency !== "off" && !cur.pausedAt;
  return (
    <Card id="customer-updates" className="mb-4 space-y-3 p-4" data-testid="project-updates-panel" data-guide="project.updates">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-bold">Customer updates</h2>
          <p className="text-sm text-ink-soft">Progress emails to the homeowner, built from this schedule. Work is only called complete after it&apos;s confirmed.</p>
        </div>
        <Badge tone={on ? "ok" : cur.pausedAt ? "warn" : "neutral"}>{cur.pausedAt ? "Paused" : on ? `${FREQUENCY_LABEL[cur.frequency]} · ${cur.mode === "automatic" ? "Automatic" : "Review first"}` : "Off"}</Badge>
      </div>
      {err && <Notice tone="danger">{err}</Notice>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Send updates" htmlFor="pu-freq">
          <select id="pu-freq" className="field" disabled={!canConfigure || busy} value={cur.frequency} onChange={(e) => save({ frequency: e.target.value as UpdateFrequency })} data-testid="pu-frequency">
            {(Object.keys(FREQUENCY_LABEL) as UpdateFrequency[]).map((k) => <option key={k} value={k}>{FREQUENCY_LABEL[k]}</option>)}
          </select>
        </Field>
        <Field label="Sending mode" htmlFor="pu-mode" hint={canAuto ? undefined : "Only someone your company owner allows can turn on automatic sending."}>
          <select id="pu-mode" className="field" disabled={!canConfigure || busy} value={cur.mode} onChange={(e) => (e.target.value === "automatic" ? setConfirm(true) : save({ mode: "review" }))} data-testid="pu-mode">
            <option value="review">Review first (recommended)</option>
            <option value="automatic" disabled={!canAuto}>Automatic</option>
          </select>
        </Field>
        <Field label="Customer email" htmlFor="pu-email" hint={st.preview?.recipient.email && !email ? `Using ${st.preview.recipient.email} from the bid` : "Leave blank to use the email on the bid."}>
          <input id="pu-email" type="email" className="field" disabled={!canConfigure || busy} value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => email !== (cur.recipientEmail ?? "") && save({ recipientEmail: email || null })} />
        </Field>
      </div>
      {confirm && (
        <div className="space-y-2 rounded-lg border border-warn/40 bg-warn-tint p-3 text-sm" data-testid="pu-confirm-auto">
          <p>Project updates will be sent automatically using the latest verified project information. You will receive advance reminders, but an update may send without manual review.</p>
          <label className="flex items-center gap-2 font-semibold"><input type="checkbox" className="h-4 w-4" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> I understand and want automatic sending for this project</label>
          <div className="flex gap-2"><Button size="sm" disabled={!agree || busy} onClick={() => { setConfirm(false); setAgree(false); void save({ mode: "automatic", confirmAutomatic: true }); }}>Turn on automatic</Button><Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>Keep review first</Button></div>
        </div>
      )}
      <dl className="grid gap-2 text-sm sm:grid-cols-3">
        <div><dt className="text-muted">Next email</dt><dd>{st.next ? `${MESSAGE_STATUS_LABEL[st.next.status]} · ${when(st.next.scheduled_for)}` : on && st.nextWeeklyAt ? `Weekly update ${when(st.nextWeeklyAt)}` : on ? "When a section is confirmed complete" : "—"}</dd></div>
        <div><dt className="text-muted">Last email</dt><dd>{st.last ? when(st.last.sent_at) : "—"}</dd></div>
        <div><dt className="text-muted">Status</dt><dd>{cur.pausedAt ? "Paused" : st.scheduleStatus !== "active" ? "Starts when the schedule is published" : st.next?.status_reason ?? (on ? "Active" : "Off")}</dd></div>
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => load(true)} data-testid="pu-preview"><Mail className="h-4 w-4" aria-hidden /> Preview email</Button>
        {canConfigure && cur.frequency !== "off" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => save({ paused: !cur.pausedAt })}>{cur.pausedAt ? "Resume updates" : "Pause updates"}</Button>}
        {st.next && <Link href={`/dashboard/customers/communications?tab=${st.next.status === "awaiting_review" ? "attention" : "scheduled"}&type=project_update`} className="inline-flex min-h-9 items-center rounded-md border border-line px-3 text-sm font-semibold">Review queued email</Link>}
        {busy && <Loader2 className="h-4 w-4 animate-spin self-center" aria-hidden />}
      </div>
      {st.preview && (
        <div className="rounded-lg border border-line bg-paper p-3 text-sm" data-testid="pu-preview-body">
          <p className="text-xs text-muted">To {st.preview.recipient.name} {st.preview.recipient.email ? `<${st.preview.recipient.email}>` : "(no email on this bid)"}</p>
          <p className="font-semibold">{st.preview.subject}</p>
          <pre className="mt-2 whitespace-pre-wrap font-sans">{st.preview.body}</pre>
          <p className="mt-2 text-xs text-muted">A secure link to the full schedule update (PDF-ready) is added when it sends.</p>
        </div>
      )}
    </Card>
  );
}
