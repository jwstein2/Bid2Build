"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, Info, OctagonAlert, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/misc";
import { ALERT_LABELS, SEVERITY_LABELS } from "@/lib/financials/ui-labels";
import type { AlertKind, AlertSeverity } from "@/lib/financials/types";
import { finAction, usd } from "./fin-client";

export interface AlertRow { id: string; kind: string; severity: string; status: string; details?: Record<string, unknown> | null; job_id?: string | null; jobHref?: string | null; status_reason?: string | null }

const ICON = { info: Info, warning: AlertTriangle, action_required: OctagonAlert } as const;
const TONE = { info: "neutral", warning: "warn", action_required: "danger" } as const;

function detailText(a: AlertRow) {
  const d = a.details ?? {};
  const parts: string[] = [];
  if (d.amount) parts.push(usd(d.amount));
  if (d.unpaid) parts.push(`${usd(d.unpaid)} unpaid`);
  if (d.outstanding) parts.push(`${usd(d.outstanding)} still owed`);
  if (d.invoiced && d.contract) parts.push(`Invoiced ${usd(d.invoiced)} of ${usd(d.contract)}`);
  if (d.reason) parts.push(`Reason given: ${String(d.reason)}`);
  return parts.join(" · ");
}

/**
 * Billing alerts (info / warning / action required). They never block anything and can't be hidden:
 * acknowledging keeps an alert listed; overriding needs a reason and is recorded in the audit log.
 */
export function AlertsPanel({ alerts, canAct, onChanged, showRefresh = true }: { alerts: AlertRow[]; canAct: boolean; onChanged?: () => void; showRefresh?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [overriding, setOverriding] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const done = () => { if (onChanged) onChanged(); else router.refresh(); };
  const act = async (payload: Record<string, unknown>, k: string) => {
    setBusy(k); setErr(null);
    const r = await finAction(payload);
    setBusy(null);
    if (!r.ok) return setErr(r.message);
    setOverriding(null); setReason("");
    done();
  };
  const order = { action_required: 0, warning: 1, info: 2 } as Record<string, number>;
  const sorted = [...alerts].sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3));
  return (
    <section aria-labelledby="fin-alerts-h" className="rounded-xl border border-line bg-surface p-4" data-testid="fin-alerts">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="fin-alerts-h" className="font-display text-lg font-extrabold">Alerts</h2>
        <span className="text-xs text-muted">Alerts never block your work.</span>
        {showRefresh && canAct && (
          <Button variant="ghost" size="sm" className="ml-auto" disabled={busy === "refresh"} onClick={() => act({ action: "refresh_alerts" }, "refresh")}>
            <RefreshCw className="h-4 w-4" aria-hidden /> {busy === "refresh" ? "Checking…" : "Check again"}
          </Button>
        )}
      </div>
      {err && <p role="alert" className="mt-2 text-sm text-danger">{err}</p>}
      {sorted.length === 0 ? <p className="mt-2 text-sm text-ink-soft">No billing alerts right now.</p> : (
        <ul className="mt-3 space-y-2">
          {sorted.map((a) => {
            const sev = (a.severity in ICON ? a.severity : "info") as AlertSeverity;
            const Icon = ICON[sev];
            return (
              <li key={a.id} className="rounded-lg border border-line p-3" data-severity={sev}>
                <div className="flex flex-wrap items-start gap-2">
                  <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${sev === "action_required" ? "text-danger" : sev === "warning" ? "text-warn" : "text-muted"}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{ALERT_LABELS[a.kind as AlertKind] ?? a.kind}</p>
                    {detailText(a) && <p className="text-xs text-muted">{detailText(a)}</p>}
                    {a.status === "acknowledged" && <p className="text-xs text-muted">Acknowledged{a.status_reason ? `: ${a.status_reason}` : ""}</p>}
                  </div>
                  <Badge tone={TONE[sev]}>{SEVERITY_LABELS[sev]}</Badge>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {a.jobHref && <Link href={a.jobHref} className="inline-flex min-h-9 items-center text-sm font-semibold text-accent-ink underline">Open job</Link>}
                  {canAct && a.status === "open" && <Button variant="secondary" size="sm" disabled={busy === a.id} onClick={() => act({ action: "alert_status", alertId: a.id, status: "acknowledged" }, a.id)}>Acknowledge</Button>}
                  {canAct && <Button variant="ghost" size="sm" onClick={() => { setOverriding(overriding === a.id ? null : a.id); setReason(""); }}>Override…</Button>}
                </div>
                {overriding === a.id && (
                  <form className="mt-2 flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); if (reason.trim()) void act({ action: "alert_status", alertId: a.id, status: "overridden", reason: reason.trim() }, a.id); }}>
                    <label className="sr-only" htmlFor={`ov-${a.id}`}>Reason for overriding</label>
                    <input id={`ov-${a.id}`} className="field flex-1" placeholder="Why this is OK (saved in the audit log)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} required />
                    <Button type="submit" size="sm" disabled={!reason.trim() || busy === a.id}>Save override</Button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
