"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { finAction, fmtDate } from "./fin-client";
import { Badge, Notice } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { describeRule, type ReminderKind, type ReminderRule } from "@/lib/financials/reminders";

export interface RecentReminder { id: string; invoiceNumber: string | null; customer: string; kind: ReminderKind; status: string; reason: string | null; at: string }

const KIND_LABEL: Record<ReminderKind, string> = { balance_reminder: "Before it's due", overdue_reminder: "Past due" };
const STATUS: Record<string, { label: string; tone: "ok" | "warn" | "danger" | "neutral" }> = {
  sent: { label: "Sent", tone: "ok" }, delivered: { label: "Delivered", tone: "ok" }, provider_accepted: { label: "Sent", tone: "ok" }, replied: { label: "Customer replied", tone: "ok" },
  scheduled: { label: "Sending soon", tone: "neutral" }, sending: { label: "Sending", tone: "neutral" }, failed: { label: "Retrying", tone: "warn" },
  canceled: { label: "Not sent", tone: "neutral" }, bounced: { label: "Bounced", tone: "danger" }, paused: { label: "Paused", tone: "warn" },
};

/**
 * Automatic payment reminders (Accounts receivable). Off until the contractor turns a rule on. Reminders go
 * out from the hourly customer-email job after 9 AM in the book's time zone, never for paid, void or
 * disputed invoices, and never twice within two days for the same invoice.
 */
export function ReminderSettings({ rules, canEdit, sendingOn, recent }: { rules: Record<ReminderKind, ReminderRule>; canEdit: boolean; sendingOn: boolean; recent: RecentReminder[] }) {
  const router = useRouter();
  const [r, setR] = useState(rules);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const set = (k: ReminderKind, patch: Partial<ReminderRule>) => setR((x) => ({ ...x, [k]: { ...x[k], ...patch } }));
  const save = async () => {
    setBusy(true); setMsg(null);
    const res = await finAction({ action: "save_reminders", reminders: (["balance_reminder", "overdue_reminder"] as const).map((k) => ({
      kind: k, enabled: r[k].enabled, offsetDays: r[k].offsetDays, repeatEveryDays: r[k].maxReminders > 1 ? (r[k].repeatEveryDays ?? 7) : r[k].repeatEveryDays, maxReminders: r[k].maxReminders,
    })) });
    setBusy(false);
    if (!res.ok) { setMsg({ tone: "danger", text: res.message }); return; }
    setMsg({ tone: "ok", text: "Saved. Reminders follow these settings from the next hourly run." });
    setOpen(false);
    router.refresh();
  };
  const anyOn = rules.balance_reminder.enabled || rules.overdue_reminder.enabled;
  const num = (v: string, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number(v) || min)));

  return (
    <section className="card p-4" data-testid="reminder-settings" aria-labelledby="reminders-h">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="reminders-h" className="font-display text-lg font-bold">Automatic payment reminders</h2>
          <p className="text-sm text-muted">Built2Bid emails your customer for you, using your company name and your saved wording. Paid, voided and disputed invoices never get one.</p>
        </div>
        <Badge tone={anyOn ? "ok" : "neutral"}>{anyOn ? "On" : "Off"}</Badge>
      </div>
      {!sendingOn && anyOn && <Notice tone="warn" className="mt-3" title="Customer email sending is paused">Your reminders are saved and will start when Built2Bid customer email is switched back on.</Notice>}
      <ul className="mt-3 space-y-1 text-sm">
        {(["balance_reminder", "overdue_reminder"] as const).map((k) => <li key={k}><span className="font-semibold">{KIND_LABEL[k]}:</span> {describeRule(rules[k])}</li>)}
      </ul>
      {canEdit && !open && <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={() => setOpen(true)} data-testid="reminders-edit">Change reminder settings</Button>}
      {!canEdit && <p className="mt-2 text-xs text-muted">Only people who manage financial settings can change these.</p>}
      {open && (
        <div className="mt-4 space-y-4">
          {(["balance_reminder", "overdue_reminder"] as const).map((k) => {
            const x = r[k];
            const before = k === "balance_reminder";
            return (
              <fieldset key={k} className="rounded-xl border border-line p-3">
                <legend className="px-1 text-sm font-semibold">{KIND_LABEL[k]}</legend>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={x.enabled} onChange={(e) => set(k, { enabled: e.target.checked })} data-testid={`rem-${k}-on`} />
                  {before ? "Remind customers before an invoice is due" : "Remind customers when an invoice is past due"}</label>
                <div className="mt-2 grid gap-3 sm:grid-cols-3">
                  <label className="label">{before ? "Days before due date" : "Days after due date"}
                    <input type="number" inputMode="numeric" min={before ? 0 : 1} max={90} className="field mt-1" value={x.offsetDays} disabled={!x.enabled}
                      onChange={(e) => set(k, { offsetDays: num(e.target.value, before ? 0 : 1, 90) })} data-testid={`rem-${k}-offset`} /></label>
                  <label className="label">How many reminders
                    <input type="number" inputMode="numeric" min={1} max={10} className="field mt-1" value={x.maxReminders} disabled={!x.enabled}
                      onChange={(e) => set(k, { maxReminders: num(e.target.value, 1, 10) })} data-testid={`rem-${k}-max`} /></label>
                  <label className="label">Days between reminders
                    <input type="number" inputMode="numeric" min={2} max={60} className="field mt-1" value={x.repeatEveryDays ?? 7} disabled={!x.enabled || x.maxReminders < 2}
                      onChange={(e) => set(k, { repeatEveryDays: num(e.target.value, 2, 60) })} data-testid={`rem-${k}-repeat`} /></label>
                </div>
                <p className="mt-2 text-xs text-muted">{describeRule({ ...x, repeatEveryDays: x.maxReminders > 1 ? (x.repeatEveryDays ?? 7) : x.repeatEveryDays })}</p>
              </fieldset>
            );
          })}
          <p className="text-xs text-muted">Reminders go out after 9 AM in your time zone, at most one every two days per invoice. Replies go to your email. Change the wording from any invoice&apos;s email preview.</p>
          <div className="flex gap-2">
            <Button loading={busy} type="button" disabled={busy} onClick={save} data-testid="reminders-save">{busy ? "Saving…" : "Save reminders"}</Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => { setR(rules); setOpen(false); }}>Cancel</Button>
          </div>
        </div>
      )}
      {msg && <p role="status" className={`mt-2 text-sm ${msg.tone === "ok" ? "text-ok" : "text-danger"}`}>{msg.text}</p>}
      {recent.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold">Recent automatic reminders</h3>
          <ul className="mt-1 divide-y divide-line text-sm" data-testid="reminders-recent">
            {recent.map((m) => {
              const st = STATUS[m.status] ?? { label: m.status, tone: "neutral" as const };
              return (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>{m.customer} · Invoice {m.invoiceNumber ?? "—"} · {KIND_LABEL[m.kind]}{m.reason && m.status === "canceled" ? <span className="block text-xs text-muted">{m.reason}</span> : null}</span>
                  <span className="flex items-center gap-2"><span className="text-xs text-muted">{fmtDate(m.at)}</span><Badge tone={st.tone}>{st.label}</Badge></span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
