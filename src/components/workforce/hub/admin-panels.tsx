"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Download, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Notice } from "@/components/ui/misc";
import { api } from "@/components/schedule/client";
import { addDays, localDay, weekStart } from "@/lib/team/records";
import { OVERTIME_RULES } from "@/lib/workforce/gps/overtime";
import type { WorkLocation } from "@/lib/workforce/gps/model";
import { CLASSIFICATION_LABEL, SHIFT_CATEGORIES, categoryLabel, type LaborReport, type PayWorker, type ScheduleItem } from "@/lib/workforce/hub/model";
import { PAY_DISCLAIMER, type PayProjection } from "@/lib/workforce/hub/pay";
import type { PayResult } from "@/lib/workforce/hub/server";

/**
 * V8.3 admin panels on Projects → Contractors & Workforce → Time tracking: work schedules (internal shifts next to
 * project assignments), the employer labor report (job cost vs overhead), and projected pay (HR access only).
 */
type Person = { id: string; name: string };
const input = "rounded-lg border border-line bg-surface px-3 py-2 text-sm";
const money = (n: number | null) => (n === null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD" }));
const hrs = (n: number) => `${(Math.round(n * 100) / 100).toLocaleString("en-US")} h`;
const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const csvCell = (v: unknown) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function Msg({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return <p role="status" className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-ok-tint text-ok" : "bg-danger-tint text-danger"}`}>{msg.text}</p>;
}

// ---- Schedules ---------------------------------------------------------------------------------------------------
type Draft = { id?: string; dates: string[]; startTime: string; endTime: string; unpaidBreakMinutes: number; category: string; scheduleId: string; locationId: string; notes: string };

export function SchedulesPanel({ staff, locations, projects, tz, canEdit }: { staff: Person[]; locations: WorkLocation[]; projects: Record<string, string>; tz: string; canEdit: boolean }) {
  const [who, setWho] = useState(staff[0]?.id ?? "");
  const [week, setWeek] = useState(() => weekStart(localDay(new Date().toISOString(), tz)));
  const [items, setItems] = useState<ScheduleItem[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(week, i)), [week]);
  const [tick, setTick] = useState(0);
  const load = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    if (!who) return;
    let off = false;
    void api<{ items: ScheduleItem[] }>(`/api/workforce/hub/shifts?resourceId=${who}&from=${week}&to=${addDays(week, 6)}`).then((r) => {
      if (off) return;
      if (r.ok) setItems(r.data.items); else { setItems([]); setMsg({ ok: false, text: r.message }); }
    });
    return () => { off = true; };
  }, [who, week, tick]);
  const internalLocs = locations.filter((l) => l.status === "active");

  async function save() {
    if (!draft) return;
    if (draft.dates.length === 0) { setMsg({ ok: false, text: "Pick at least one day." }); return; }
    const body = { action: "save", id: draft.id, resourceId: who, ...(draft.id ? { date: draft.dates[0] } : { dates: draft.dates }), startTime: draft.startTime, endTime: draft.endTime,
      unpaidBreakMinutes: draft.unpaidBreakMinutes, category: draft.category, scheduleId: draft.category === "project" ? draft.scheduleId || null : null, locationId: draft.locationId || null, notes: draft.notes || null };
    const r = await api("/api/workforce/hub/shifts", { method: "POST", body: JSON.stringify(body) });
    if (!r.ok) { setMsg({ ok: false, text: r.message }); return; }
    setMsg({ ok: true, text: draft.id ? "Shift updated." : `${draft.dates.length === 1 ? "Shift" : `${draft.dates.length} shifts`} added.` });
    setDraft(null); load();
  }
  async function cancel(id: string) {
    const r = await api("/api/workforce/hub/shifts", { method: "POST", body: JSON.stringify({ action: "cancel", id }) });
    setMsg(r.ok ? { ok: true, text: "Shift cancelled." } : { ok: false, text: r.message });
    load();
  }
  if (staff.length === 0) return <Notice>Add employees as Staff in Team &amp; Subcontractors to schedule shifts.</Notice>;
  const total = (items ?? []).filter((i) => i.category !== "time_off").reduce((s, i) => s + i.hours, 0);

  return (
    <div className="space-y-4" data-testid="hub-schedules">
      <p className="text-sm text-ink-soft">Schedule paid company time that isn&apos;t a customer job (shop, office, training, admin, travel), next to the project assignments from your schedules. Workers see this on <strong>My work</strong>.</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm font-semibold">Employee
          <select className={`${input} mt-1 block`} value={who} onChange={(e) => { setWho(e.target.value); setDraft(null); }} data-testid="hub-sched-person">
            {staff.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></label>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" aria-label="Previous week" onClick={() => setWeek(addDays(week, -7))}><ChevronLeft className="h-4 w-4" aria-hidden /></Button>
          <span className="text-sm font-semibold">Week of {dayLabel(week)}</span>
          <Button size="sm" variant="ghost" aria-label="Next week" onClick={() => setWeek(addDays(week, 7))}><ChevronRight className="h-4 w-4" aria-hidden /></Button>
        </div>
        <span className="text-sm text-ink-soft">{hrs(total)} scheduled</span>
        {canEdit && <Button size="sm" className="ml-auto" onClick={() => setDraft({ dates: [], startTime: "07:00", endTime: "15:30", unpaidBreakMinutes: 30, category: "shop", scheduleId: "", locationId: "", notes: "" })} data-testid="hub-shift-new"><Plus className="h-4 w-4" aria-hidden /> Add shift</Button>}
      </div>
      <Msg msg={msg} />
      {draft && (
        <section className="space-y-3 rounded-xl border border-line bg-surface p-4" data-testid="hub-shift-form">
          <div className="flex items-center"><h3 className="mr-auto font-extrabold text-navy">{draft.id ? "Edit shift" : "New shift"}</h3><Button size="sm" variant="ghost" aria-label="Close" onClick={() => setDraft(null)}><X className="h-4 w-4" aria-hidden /></Button></div>
          <fieldset><legend className="text-sm font-semibold">Days</legend>
            <div className="mt-1 flex flex-wrap gap-2">{days.map((d) => (
              <label key={d} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line px-2 text-sm">
                <input type="checkbox" checked={draft.dates.includes(d)} disabled={Boolean(draft.id) && !draft.dates.includes(d)} data-testid={`hub-shift-day-${d}`}
                  onChange={(e) => setDraft({ ...draft, dates: e.target.checked ? [...draft.dates, d].sort() : draft.dates.filter((x) => x !== d) })} />{dayLabel(d)}</label>
            ))}</div></fieldset>
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="text-sm font-semibold">Start<input type="time" className={`${input} mt-1 block w-full`} value={draft.startTime} onChange={(e) => setDraft({ ...draft, startTime: e.target.value })} data-testid="hub-shift-start" /></label>
            <label className="text-sm font-semibold">End<input type="time" className={`${input} mt-1 block w-full`} value={draft.endTime} onChange={(e) => setDraft({ ...draft, endTime: e.target.value })} data-testid="hub-shift-end" /></label>
            <label className="text-sm font-semibold">Unpaid break (min)<input type="number" min={0} max={240} className={`${input} mt-1 block w-full`} value={draft.unpaidBreakMinutes} onChange={(e) => setDraft({ ...draft, unpaidBreakMinutes: Number(e.target.value) || 0 })} /></label>
            <label className="text-sm font-semibold">Paid for<select className={`${input} mt-1 block w-full`} value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} data-testid="hub-shift-category">
              {SHIFT_CATEGORIES.map((c) => <option key={c} value={c}>{categoryLabel(c)}</option>)}</select></label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {draft.category === "project" && <label className="text-sm font-semibold">Project<select className={`${input} mt-1 block w-full`} value={draft.scheduleId} onChange={(e) => setDraft({ ...draft, scheduleId: e.target.value })}>
              <option value="">Pick a project</option>{Object.entries(projects).map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></label>}
            <label className="text-sm font-semibold">Work location (optional)<select className={`${input} mt-1 block w-full`} value={draft.locationId} onChange={(e) => setDraft({ ...draft, locationId: e.target.value })}>
              <option value="">None</option>{internalLocs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
            <label className="text-sm font-semibold sm:col-span-2">Notes / responsibilities<textarea className={`${input} mt-1 block w-full`} rows={2} maxLength={1000} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></label>
          </div>
          <div className="flex gap-2"><Button onClick={save} data-testid="hub-shift-save">Save</Button><Button variant="ghost" onClick={() => setDraft(null)}>Cancel</Button></div>
        </section>
      )}
      <ol className="grid gap-2 sm:grid-cols-7" data-testid="hub-sched-week">
        {days.map((d) => {
          const list = (items ?? []).filter((i) => i.date === d);
          return (
            <li key={d} className="rounded-xl border border-line bg-surface p-2 text-sm">
              <p className="font-semibold text-navy">{dayLabel(d)}</p>
              {list.length === 0 ? <p className="text-xs text-muted">Nothing scheduled</p> : list.map((i) => (
                <div key={`${i.kind}-${i.id}-${i.date}`} className="mt-1 rounded-lg bg-paper p-1.5" data-testid="hub-sched-item">
                  <p className="font-semibold">{i.kind === "task" ? i.project ?? i.title : i.kind === "time_off" ? "Time off" : categoryLabel(i.category)}</p>
                  <p className="text-xs text-ink-soft">{i.startTime && i.endTime ? `${i.startTime}–${i.endTime} · ` : ""}{hrs(i.hours)}{i.estimated ? " (est.)" : ""}</p>
                  {i.kind === "task" && <Badge tone="brand">Project assignment</Badge>}
                  {i.kind === "shift" && canEdit && (
                    <span className="mt-1 flex gap-1">
                      <Button size="sm" variant="link" onClick={() => setDraft({ id: i.id, dates: [i.date], startTime: i.startTime ?? "07:00", endTime: i.endTime ?? "15:30", unpaidBreakMinutes: i.unpaidBreakMinutes, category: i.category, scheduleId: i.scheduleId ?? "", locationId: i.locationId ?? "", notes: i.notes ?? "" })}>Edit</Button>
                      <Button size="sm" variant="link" onClick={() => cancel(i.id)}>Cancel</Button>
                    </span>
                  )}
                </div>
              ))}
            </li>
          );
        })}
      </ol>
      <p className="text-xs text-muted">Project assignments come from each project&apos;s schedule (edit them there). Approved time off comes from Team &amp; Subcontractors.</p>
    </div>
  );
}

// ---- Labor report ------------------------------------------------------------------------------------------------
export function LaborReportPanel({ tz }: { tz: string }) {
  const [from, setFrom] = useState(() => weekStart(localDay(new Date().toISOString(), tz)));
  const [to, setTo] = useState(() => addDays(weekStart(localDay(new Date().toISOString(), tz)), 6));
  const [rep, setRep] = useState<LaborReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let off = false;
    void api<LaborReport>(`/api/workforce/hub/report?from=${from}&to=${to}`).then((r) => {
      if (off) return;
      if (r.ok) { setRep(r.data); setErr(null); } else { setRep(null); setErr(r.message); }
    });
    return () => { off = true; };
  }, [from, to]);
  function csv() {
    if (!rep) return;
    const head = ["Type", "Job or category", "Scheduled hours", "Actual hours", "Approved hours", ...(rep.canSeeCost ? ["Scheduled cost", "Actual cost", "Approved cost"] : [])];
    const rows = [
      ...rep.jobs.map((j) => ["Customer project", j.name, j.scheduledHours, j.actualHours, j.approvedHours, ...(rep.canSeeCost ? [j.scheduledCost, j.actualCost, j.approvedCost] : [])]),
      ...rep.nonProject.map((c) => ["Overhead (paid, not a job)", categoryLabel(c.category), c.scheduledHours, c.actualHours, c.approvedHours, ...(rep.canSeeCost ? ["", c.actualCost, ""] : [])]),
    ];
    download(`labor-report-${from}-to-${to}.csv`, [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\n"));
  }
  return (
    <div className="space-y-4" data-testid="hub-report">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm font-semibold">From<input type="date" className={`${input} mt-1 block`} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="text-sm font-semibold">To<input type="date" className={`${input} mt-1 block`} value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <Button size="sm" variant="secondary" onClick={csv} disabled={!rep}><Download className="h-4 w-4" aria-hidden /> Download CSV</Button>
      </div>
      {err && <Notice tone="warn">{err}</Notice>}
      {rep && (
        <>
          <div className="grid gap-3 sm:grid-cols-4" data-testid="hub-report-totals">
            {[["Scheduled", hrs(rep.totals.scheduledHours)], ["Actual (clocked)", hrs(rep.totals.actualHours)], ["On customer jobs", hrs(rep.totals.projectHours)], ["Paid overhead (not a job)", hrs(rep.totals.overheadHours)]].map(([k, v]) => (
              <div key={k} className="rounded-xl border border-line bg-surface p-3"><p className="text-xs uppercase tracking-wide text-muted">{k}</p><p className="text-xl font-extrabold text-navy">{v}</p></div>
            ))}
          </div>
          {rep.canSeeCost
            ? <p className="text-sm text-ink-soft">Labor cost uses each person&apos;s employer cost rate from Team &amp; Subcontractors: actual {money(rep.totals.actualCost)}, of which overhead {money(rep.totals.overheadCost)}. Pay rates are never shown here.</p>
            : <p className="text-sm text-ink-soft">Costs are hidden. Only the company owner and team managers see labor cost.</p>}
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full min-w-[40rem] text-left text-sm" data-testid="hub-report-jobs">
              <thead className="bg-paper text-xs uppercase tracking-wide text-muted"><tr><th className="px-3 py-2">Customer project</th><th className="px-3 py-2">People</th><th className="px-3 py-2">Scheduled</th><th className="px-3 py-2">Actual</th><th className="px-3 py-2">Difference</th><th className="px-3 py-2">Approved</th>{rep.canSeeCost && <><th className="px-3 py-2">Scheduled cost</th><th className="px-3 py-2">Actual cost</th></>}</tr></thead>
              <tbody className="divide-y divide-line">
                {rep.jobs.length === 0 && <tr><td className="px-3 py-3 text-muted" colSpan={8}>No project hours in this range.</td></tr>}
                {rep.jobs.map((j) => {
                  const d = j.actualHours - j.scheduledHours;
                  return (
                    <tr key={j.scheduleId}><td className="px-3 py-2 font-semibold">{j.name}</td><td className="px-3 py-2">{j.people}</td><td className="px-3 py-2">{hrs(j.scheduledHours)}</td><td className="px-3 py-2">{hrs(j.actualHours)}</td>
                      <td className={`px-3 py-2 ${Math.abs(d) >= 0.25 ? (d > 0 ? "text-warn" : "text-ink-soft") : ""}`}>{d > 0 ? "+" : ""}{hrs(d)}</td><td className="px-3 py-2">{hrs(j.approvedHours)}</td>
                      {rep.canSeeCost && <><td className="px-3 py-2">{money(j.scheduledCost)}</td><td className="px-3 py-2">{money(j.actualCost)}{j.uncostedHours > 0 && <span className="block text-xs text-muted">{hrs(j.uncostedHours)} with no cost rate</span>}</td></>}</tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full min-w-[32rem] text-left text-sm" data-testid="hub-report-overhead">
              <thead className="bg-paper text-xs uppercase tracking-wide text-muted"><tr><th className="px-3 py-2">Paid time that isn&apos;t a job (overhead)</th><th className="px-3 py-2">Scheduled</th><th className="px-3 py-2">Actual</th><th className="px-3 py-2">Approved</th>{rep.canSeeCost && <th className="px-3 py-2">Actual cost</th>}</tr></thead>
              <tbody className="divide-y divide-line">
                {rep.nonProject.length === 0 && <tr><td className="px-3 py-3 text-muted" colSpan={5}>No overhead hours in this range.</td></tr>}
                {rep.nonProject.map((c) => (
                  <tr key={c.category}><td className="px-3 py-2 font-semibold">{categoryLabel(c.category)}</td><td className="px-3 py-2">{hrs(c.scheduledHours)}</td><td className="px-3 py-2">{hrs(c.actualHours)}</td><td className="px-3 py-2">{hrs(c.approvedHours)}</td>{rep.canSeeCost && <td className="px-3 py-2">{money(c.actualCost)}</td>}</tr>
                ))}
              </tbody>
            </table>
          </div>
          {rep.totals.unpaidHours > 0 && <p className="text-xs text-muted">{hrs(rep.totals.unpaidHours)} of unpaid time was recorded and is left out of every total.</p>}
        </>
      )}
    </div>
  );
}

// ---- Projected pay -----------------------------------------------------------------------------------------------
type PaySettingsView = { enabled: boolean; workersCanSee: boolean; displayPeriod: "week" | "pay_period"; payFrequency: string; periodAnchor: string; overtimeRule: string | null; otMultiplier: number; dtMultiplier: number; differentials: Record<string, number> };
type PayAdmin = { settings: PaySettingsView; gpsOvertimeRule: string | null; workers: PayWorker[]; forecasts: Record<string, PayResult> };
const RATE_KEYS = ["training", "shop", "office", "admin", "travel", "other_paid", "project"] as const;

export function PayPanel() {
  const [data, setData] = useState<PayAdmin | null>(null);
  const [err, setErr] = useState<{ forbidden: boolean; text: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [s, setS] = useState<PaySettingsView | null>(null);
  const [rates, setRates] = useState<{ id: string; name: string; rates: Record<string, string> } | null>(null);
  const [tick, setTick] = useState(0);
  const load = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    let off = false;
    void api<PayAdmin>("/api/workforce/hub/admin").then((r) => {
      if (off) return;
      if (r.ok) { setData(r.data); setS({ ...r.data.settings, periodAnchor: String(r.data.settings.periodAnchor ?? "").slice(0, 10), otMultiplier: Number(r.data.settings.otMultiplier), dtMultiplier: Number(r.data.settings.dtMultiplier) }); setErr(null); }
      else setErr({ forbidden: r.status === 403, text: r.message });
    });
    return () => { off = true; };
  }, [tick]);
  const post = async (body: Record<string, unknown>, ok: string) => {
    const r = await api("/api/workforce/hub/admin", { method: "POST", body: JSON.stringify(body) });
    setMsg(r.ok ? { ok: true, text: ok } : { ok: false, text: r.message });
    if (r.ok) load();
    return r.ok;
  };
  if (err) return err.forbidden
    ? <Notice title="Projected pay is for HR access only" >Ask the company owner to give you HR access in Team &amp; Access.</Notice>
    : <Notice tone="warn">{err.text}</Notice>;
  if (!data || !s) return <p className="text-sm text-muted">Loading…</p>;
  const ruleLabel = (k: string | null) => OVERTIME_RULES.find((r) => r.value === k)?.label ?? k ?? "Federal";

  return (
    <div className="space-y-5" data-testid="hub-pay">
      <Notice>{PAY_DISCLAIMER} Estimates use the pay rates in each person&apos;s HR record and their schedule. The final amount only comes from a payroll provider, and none is connected, so it always shows as not available.</Notice>
      <Msg msg={msg} />
      <section className="space-y-3 rounded-xl border border-line bg-surface p-4" data-testid="hub-pay-settings">
        <h3 className="font-extrabold text-navy">Company settings</h3>
        <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} data-testid="hub-pay-enabled" /> Calculate projected pay</label>
        <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={s.workersCanSee} disabled={!s.enabled} onChange={(e) => setS({ ...s, workersCanSee: e.target.checked })} data-testid="hub-pay-workers" /> Show workers their own estimate (off by default; admins can always see it)</label>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm font-semibold">Show estimates for<select className={`${input} mt-1 block w-full`} value={s.displayPeriod} onChange={(e) => setS({ ...s, displayPeriod: e.target.value as PaySettingsView["displayPeriod"] })}>
            <option value="week">This week</option><option value="pay_period">This pay period</option></select></label>
          <label className="text-sm font-semibold">Pay schedule<select className={`${input} mt-1 block w-full`} value={s.payFrequency} onChange={(e) => setS({ ...s, payFrequency: e.target.value })}>
            <option value="weekly">Weekly</option><option value="biweekly">Every two weeks</option><option value="semimonthly">Twice a month (1st–15th, 16th–end)</option><option value="monthly">Monthly</option></select></label>
          <label className="text-sm font-semibold">A pay period started on<input type="date" className={`${input} mt-1 block w-full`} value={s.periodAnchor} onChange={(e) => setS({ ...s, periodAnchor: e.target.value })} /></label>
          <label className="text-sm font-semibold">Overtime rule<select className={`${input} mt-1 block w-full`} value={s.overtimeRule ?? ""} onChange={(e) => setS({ ...s, overtimeRule: e.target.value || null })}>
            <option value="">Same as time tracking ({ruleLabel(data.gpsOvertimeRule)})</option>{OVERTIME_RULES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select></label>
          <label className="text-sm font-semibold">Overtime multiplier<input type="number" step="0.05" min={1} max={3} className={`${input} mt-1 block w-full`} value={s.otMultiplier} onChange={(e) => setS({ ...s, otMultiplier: Number(e.target.value) })} /></label>
          <label className="text-sm font-semibold">Double-time multiplier<input type="number" step="0.05" min={1} max={4} className={`${input} mt-1 block w-full`} value={s.dtMultiplier} onChange={(e) => setS({ ...s, dtMultiplier: Number(e.target.value) })} /></label>
        </div>
        <fieldset><legend className="text-sm font-semibold">Extra per hour by type of work (differentials, $)</legend>
          <div className="mt-1 grid gap-2 sm:grid-cols-4">{RATE_KEYS.map((k) => (
            <label key={k} className="text-xs text-ink-soft">{categoryLabel(k)}<input type="number" min={0} max={200} step="0.25" className={`${input} mt-0.5 block w-full`} value={s.differentials[k] ?? ""}
              onChange={(e) => { const d = { ...s.differentials }; if (e.target.value === "") delete d[k]; else d[k] = Number(e.target.value); setS({ ...s, differentials: d }); }} /></label>
          ))}</div>
          <p className="mt-1 text-xs text-muted">Night and weekend differentials aren&apos;t estimated yet.</p></fieldset>
        <Button onClick={() => post({ action: "settings", enabled: s.enabled, workersCanSee: s.workersCanSee, displayPeriod: s.displayPeriod, payFrequency: s.payFrequency, periodAnchor: s.periodAnchor || undefined,
          overtimeRule: s.overtimeRule ?? "", otMultiplier: s.otMultiplier, dtMultiplier: s.dtMultiplier, differentials: s.differentials }, "Projected pay settings saved.")} data-testid="hub-pay-save">Save settings</Button>
      </section>

      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[52rem] text-left text-sm" data-testid="hub-pay-workers-table">
          <thead className="bg-paper text-xs uppercase tracking-wide text-muted"><tr><th className="px-3 py-2">Employee</th><th className="px-3 py-2">Pay</th><th className="px-3 py-2">Estimate on</th><th className="px-3 py-2">Worker sees it</th><th className="px-3 py-2">Scheduled projection</th><th className="px-3 py-2">Actual so far</th><th className="px-3 py-2">Final</th><th className="px-3 py-2"></th></tr></thead>
          <tbody className="divide-y divide-line">
            {data.workers.map((w) => {
              const f = data.forecasts[w.id];
              const p: PayProjection | null = f && f.available ? f.projection : null;
              return (
                <tr key={w.id} data-testid={`hub-pay-row-${w.id}`}>
                  <td className="px-3 py-2"><span className="font-semibold">{w.name}</span><span className="block text-xs text-muted">{w.classification ? CLASSIFICATION_LABEL[w.classification] : "Classification not set"}{w.exempt ? " · exempt" : ""}</span></td>
                  <td className="px-3 py-2">{w.payRate === null ? <span className="text-muted">No rate in HR record</span> : `${money(w.payRate)}/${w.payRateUnit === "year" ? "yr" : "hr"}`}</td>
                  <td className="px-3 py-2"><input type="checkbox" aria-label={`Estimate pay for ${w.name}`} checked={w.projectionEnabled} data-testid={`hub-pay-on-${w.id}`}
                    onChange={(e) => post({ action: "worker", resourceId: w.id, projectionEnabled: e.target.checked }, e.target.checked ? `Estimates on for ${w.name}.` : `Estimates off for ${w.name}. Nothing is calculated or shown for them.`)} /></td>
                  <td className="px-3 py-2"><select className={input} aria-label={`Does ${w.name} see their estimate`} value={w.workerCanSee === null ? "" : w.workerCanSee ? "yes" : "no"} disabled={!w.projectionEnabled} data-testid={`hub-pay-see-${w.id}`}
                    onChange={(e) => post({ action: "worker", resourceId: w.id, workerCanSee: e.target.value === "" ? null : e.target.value === "yes" }, `Visibility saved for ${w.name}.`)}>
                    <option value="">Company default</option><option value="yes">Show</option><option value="no">Hide</option></select>
                    <span className="block text-xs text-muted">{w.workerSees ? "Visible to them" : "Hidden from them"}</span></td>
                  <td className="px-3 py-2">{p?.scheduled ? <><strong>{money(p.scheduled.gross)}</strong><span className="block text-xs text-muted">{hrs(p.scheduled.hours)}{p.scheduled.overtime ? ` · ${hrs(p.scheduled.overtime)} OT` : ""} · {p.period.label}</span></> : <span className="text-muted">{p?.reason ?? (w.projectionEnabled && s.enabled ? "—" : "Off")}</span>}</td>
                  <td className="px-3 py-2">{p?.actual ? <><strong>{money(p.actual.gross)}</strong><span className="block text-xs text-muted">{hrs(p.actual.hours)} clocked</span></> : "—"}</td>
                  <td className="px-3 py-2 text-xs text-muted">From payroll (not connected)</td>
                  <td className="px-3 py-2"><Button size="sm" variant="ghost" onClick={() => setRates({ id: w.id, name: w.name, rates: Object.fromEntries(Object.entries(w.rates).map(([k, v]) => [k, String(v)])) })}>Rates</Button></td>
                </tr>
              );
            })}
            {data.workers.length === 0 && <tr><td className="px-3 py-3 text-muted" colSpan={8}>No active staff yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {!s.enabled && <p className="text-sm text-ink-soft"><CalendarDays className="mr-1 inline h-4 w-4" aria-hidden />Projected pay is off, so estimates above are only shown to you here once you turn it on.</p>}
      {rates && (
        <section className="space-y-3 rounded-xl border border-line bg-surface p-4" data-testid="hub-pay-rates">
          <div className="flex items-center"><h3 className="mr-auto font-extrabold text-navy">{rates.name}: other hourly rates</h3><Button size="sm" variant="ghost" aria-label="Close" onClick={() => setRates(null)}><X className="h-4 w-4" aria-hidden /></Button></div>
          <p className="text-xs text-muted">Leave blank to use their base rate. Used only for estimates; payroll stays the source of truth.</p>
          <div className="grid gap-2 sm:grid-cols-4">{RATE_KEYS.map((k) => (
            <label key={k} className="text-xs text-ink-soft">{categoryLabel(k)} ($/hr)<input type="number" min={0} max={2000} step="0.25" className={`${input} mt-0.5 block w-full`} value={rates.rates[k] ?? ""} onChange={(e) => setRates({ ...rates, rates: { ...rates.rates, [k]: e.target.value } })} /></label>
          ))}</div>
          <Button onClick={async () => { if (await post({ action: "worker", resourceId: rates.id, rates: Object.fromEntries(Object.entries(rates.rates).filter(([, v]) => v !== "").map(([k, v]) => [k, Number(v)])) }, `Rates saved for ${rates.name}.`)) setRates(null); }}>Save rates</Button>
        </section>
      )}
    </div>
  );
}
