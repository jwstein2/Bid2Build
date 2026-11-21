"use client";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/misc";
import { tbAction } from "@/components/tax-banking/client";
import type { JobProgressMilestone } from "@/lib/cash-v9/load";

type Payload = { hasSchedule: boolean; scheduleDraft: boolean; sections: { id: string; name: string }[]; milestones: JobProgressMilestone[] };
const METHODS = [
  { value: "duration", label: "Working days" }, { value: "weight", label: "Task weights" }, { value: "financial", label: "Estimated cost" },
] as const;
const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const shortDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * V9: link a payment milestone to schedule progress ("due at 30% complete"). When verified progress reaches it, a person
 * confirms; that records the milestone's own trigger once so the invoice dialog prefills as usual. Nothing is sent.
 */
export function MilestoneProgressCard({ jobId, canConfirm, onChanged }: { jobId: string; canConfirm: boolean; onChanged: () => void }) {
  const [data, setData] = useState<Payload | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    const res = await fetch(`/api/financials/cash-v9?jobId=${jobId}`, { cache: "no-store" }).catch(() => null);
    if (!res?.ok) { setFailed(true); return; }
    setData(await res.json().catch(() => null)); setFailed(false);
  }, [jobId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- load once on mount
  useEffect(() => { void load(); }, [load]);
  if (failed || !data) return null;
  const open = data.milestones.filter((m) => m.state === "not_triggered" && !["agreement_signed", "calendar_date"].includes(m.triggerKind));
  if (!open.length) return null;
  return (
    <section className="rounded-xl border border-line bg-surface p-4" aria-labelledby="v9-mp-h" data-testid="v9-milestone-progress">
      <h2 id="v9-mp-h" className="font-display text-lg font-extrabold">Milestones tied to schedule progress</h2>
      <p className="text-xs text-muted">Progress comes from the tasks your crew marks complete, never from how much time has passed. Reaching a milestone only makes it ready to confirm: nothing is invoiced or sent until you choose to.</p>
      {!data.hasSchedule && <p className="mt-2 text-sm text-muted">This job doesn&apos;t have a schedule with tasks yet, so progress can&apos;t be measured.</p>}
      {data.scheduleDraft && <p className="mt-2 text-sm text-warn">The schedule is still a draft, so dates are less certain.</p>}
      <ul className="mt-3 space-y-2">{open.map((m) => <Row key={m.id} m={m} sections={data.sections} canConfirm={canConfirm} hasSchedule={data.hasSchedule} onDone={() => { void load(); onChanged(); }} />)}</ul>
    </section>
  );
}

function Row({ m, sections, canConfirm, hasSchedule, onDone }: { m: JobProgressMilestone; sections: Payload["sections"]; canConfirm: boolean; hasSchedule: boolean; onDone: () => void }) {
  const [editing, setEditing] = useState(false);
  const [threshold, setThreshold] = useState(m.rule ? String(m.rule.threshold) : "30");
  const [method, setMethod] = useState<string>(m.rule?.method ?? "duration");
  const [section, setSection] = useState(m.rule?.sectionKey ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const post = async (payload: Record<string, unknown>, ok: string) => {
    setBusy(true); setMsg(null);
    const r = await tbAction(payload, "/api/financials/cash-v9");
    setBusy(false);
    if (!r.ok) { setMsg({ tone: "danger", text: r.message }); return false; }
    setMsg({ tone: "ok", text: ok }); onDone(); return true;
  };
  const pct = m.progress ?? 0;
  const t = Number(threshold);
  return (
    <li className="rounded-lg border border-line p-3" data-testid="v9-mp-row">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 font-semibold">{m.seq}. {m.description}</span>
        <span className="tabular-nums font-semibold">{usd(m.amount)}</span>
        {m.eligible && <Badge tone="warn">Ready to confirm</Badge>}
      </div>
      {m.rule ? (
        <div className="mt-2 space-y-1">
          <div className="h-2 w-full overflow-hidden rounded-full bg-black/10" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`Verified progress ${pct}%`}>
            <div className="h-full bg-brand" style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
          <p className="text-xs text-muted">
            Due at {m.rule.threshold}% complete{m.rule.sectionKey ? ` of ${sections.find((x) => x.id === m.rule!.sectionKey)?.name ?? "one section"}` : ""} ({METHODS.find((x) => x.value === m.rule!.method)?.label.toLowerCase()}).
            {" "}Verified progress: {pct}%.{!m.eligible && m.projectedOn ? ` Projected to reach it ${shortDate(m.projectedOn)}${m.slipDays > 0 ? `, ${m.slipDays} days behind plan` : ""}.` : ""}
          </p>
        </div>
      ) : <p className="mt-1 text-xs text-muted">Not tied to progress yet. The forecast assumes it at the projected finish.</p>}
      {canConfirm && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {m.eligible && <Button type="button" size="sm" disabled={busy} data-testid="v9-mp-confirm"
            onClick={() => post({ action: "progress_confirm", milestoneId: m.id, p: {} }, "Confirmed. It's ready to invoice: use Create invoice above.")}>Confirm progress</Button>}
          {hasSchedule && <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(!editing)}>{m.rule ? "Change rule" : "Tie to progress"}</Button>}
          {m.rule && <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => post({ action: "progress_rule_save", milestoneId: m.id, p: { remove: true } }, "Rule removed.")}>Remove rule</Button>}
        </div>
      )}
      {editing && (
        <form className="mt-2 grid gap-2 sm:grid-cols-4" onSubmit={async (e) => { e.preventDefault(); if (await post({ action: "progress_rule_save", milestoneId: m.id, p: { threshold: t, method, sectionKey: section || undefined } }, "Saved.")) setEditing(false); }}>
          <label className="label" htmlFor={`mp-t-${m.id}`}>Due at<span className="mt-1 flex items-center gap-1"><input id={`mp-t-${m.id}`} inputMode="decimal" className="field" value={threshold} onChange={(e) => setThreshold(e.target.value.replace(/[^0-9.]/g, ""))} />%</span></label>
          <label className="label" htmlFor={`mp-m-${m.id}`}>Measured by<select id={`mp-m-${m.id}`} className="field mt-1" value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</select></label>
          <label className="label" htmlFor={`mp-s-${m.id}`}>Of<select id={`mp-s-${m.id}`} className="field mt-1" value={section} onChange={(e) => setSection(e.target.value)}><option value="">The whole job</option>{sections.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          <div className="flex items-end"><Button type="submit" size="sm" disabled={busy || !(t > 0 && t <= 100)}>Save rule</Button></div>
        </form>
      )}
      {msg && <p role="status" className={`mt-1 text-sm ${msg.tone === "ok" ? "text-ok" : "text-danger"}`}>{msg.text}</p>}
    </li>
  );
}
