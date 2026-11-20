"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, ChevronLeft, ChevronRight, Clock, Download, History, LogIn, LogOut, MapPin, Pencil, Plus, RotateCcw, Undo2, User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Notice } from "@/components/ui/misc";
import { api } from "@/components/schedule/client";
import {
  accuracyLabel, addDays, entryHours, fmtHours, laborByProject, localDay, mapLink, payrollCsv, PAY_TYPE_LABEL, TIME_STATUS_LABEL,
  timeEntriesCsv, weekStart, weeklyTotals, type Employee, type EmployeeList, type PayType, type TimeEntry, type Timesheet,
} from "@/lib/team/records";

type Project = { id: string; name: string };
const money = (n: number | null) => (n === null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD" }));
const tzNow = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago"; } catch { return "America/Chicago"; } };
const time = (iso: string | null, tz: string) => (iso ? new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso)) : "—");
/** ISO instant → value for <input type="datetime-local"> in the browser's own time zone. */
const toLocalInput = (iso: string) => { const d = new Date(iso); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : "");
function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
/** Location at the moment of a punch only (never in the background). Resolves null if refused or slow. */
function getLocation(): Promise<{ lat: number; lng: number; accuracyM: number } | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => navigator.geolocation.getCurrentPosition(
    (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy }),
    () => resolve(null), { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 }));
}

/**
 * Employees & time: your own time clock, the employee directory (Staff in Team & Subcontractors), and for
 * managers the weekly timesheet with approvals, fixes (with a reason), labor by project and payroll
 * preparation exports. Built2Bid doesn't run payroll or calculate tax.
 */
export function TimeWorkspace({ employees, projects, me }: { employees: EmployeeList; projects: Project[]; me: string | null }) {
  const router = useRouter();
  const [tz] = useState(tzNow);
  const [week, setWeek] = useState(() => weekStart(localDay(new Date().toISOString(), tzNow())));
  const [sheet, setSheet] = useState<Timesheet | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const names = useMemo(() => Object.fromEntries(employees.employees.map((e) => [e.id, e.name])), [employees.employees]);
  const mine = employees.employees.filter((e) => e.linkedUserId === me && e.status === "active" && e.clockEnabled);

  const [reload, setReload] = useState(0);
  useEffect(() => {
    let live = true;
    // Pad a day either side so entries near midnight in other time zones aren't missed; grouping is by local day.
    const from = new Date(`${addDays(week, -1)}T00:00:00Z`).toISOString(), to = new Date(`${addDays(week, 8)}T00:00:00Z`).toISOString();
    api<Timesheet>(`/api/team/time?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`).then((r) => {
      if (!live) return;
      if (!r.ok) { setLoadErr(r.message); return; }
      setLoadErr(null);
      setSheet({ ...r.data, entries: r.data.entries.filter((e) => weekStart(localDay(e.clockIn, tz)) === week || e.status === "open") });
    });
    return () => { live = false; };
  }, [week, tz, reload]);
  const refresh = () => { setReload((n) => n + 1); router.refresh(); };

  return (
    <div className="space-y-6" data-testid="time-workspace">
      {msg && <Notice tone={msg.ok ? "ok" : "danger"}>{msg.text}</Notice>}
      {mine.length > 0 && <section className="grid gap-3 md:grid-cols-2">{mine.map((e) => (
        <ClockCard key={`${e.id}-${sheet?.entries.find((x) => x.resourceId === e.id && x.status === "open")?.id ?? "out"}`} employee={e} projects={projects} open={sheet?.entries.find((x) => x.resourceId === e.id && x.status === "open") ?? null}
          onDone={(t) => { setMsg({ ok: true, text: t }); refresh(); }} onError={(t) => setMsg({ ok: false, text: t })} />))}</section>}
      {mine.length === 0 && (
        <Notice>
          {employees.canManage
            ? <>To clock in yourself, add yourself as Staff in <Link href="/projects/team" className="font-semibold underline">People &amp; subs</Link> and link your login. You can also clock crew in and out below.</>
            : <>You&apos;re not set up to clock in yet. Ask your company admin to add you as Staff and link your login.</>}
        </Notice>
      )}

      <EmployeeDirectory list={employees} projects={projects} sheet={sheet} onSaved={(t) => { setMsg({ ok: true, text: t }); refresh(); }} onError={(t) => setMsg({ ok: false, text: t })} />

      <section className="space-y-3" data-testid="timesheet">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-xl font-extrabold text-navy">{employees.canManage ? "Timesheet" : "My time"}</h2>
          <Button size="sm" variant="secondary" onClick={() => setWeek(addDays(week, -7))} aria-label="Previous week"><ChevronLeft className="h-4 w-4" aria-hidden /></Button>
          <span className="text-sm font-semibold" data-testid="week-label">Week of {new Date(`${week}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}</span>
          <Button size="sm" variant="secondary" onClick={() => setWeek(addDays(week, 7))} aria-label="Next week"><ChevronRight className="h-4 w-4" aria-hidden /></Button>
        </div>
        {loadErr && <Notice tone="danger">{loadErr}</Notice>}
        {!sheet && !loadErr && <p className="text-sm text-muted">Loading…</p>}
        {sheet && <SheetView key={week} sheet={sheet} week={week} tz={tz} names={names} employees={employees.employees} projects={projects}
          onChanged={(t) => { setMsg({ ok: true, text: t }); refresh(); }} onError={(t) => setMsg({ ok: false, text: t })} />}
      </section>
      <p className="text-xs text-muted">Here, location is saved only at the moment someone clocks in or out, only when they tick “Include my location”, and is cleared after 90 days. Automatic GPS clock-in (off unless your company sets it up in <Link href="/projects/workforce/time-tracking" className="underline">Time tracking</Link>) records arrivals and departures at work sites only, never a trail. Employees can also use <Link href="/clock" className="underline">Time clock</Link> on their phone. Built2Bid doesn&apos;t calculate payroll or taxes: export the hours for whoever runs your payroll.</p>
    </div>
  );
}

function ProjectSelect({ value, onChange, projects, id }: { value: string; onChange: (v: string) => void; projects: Project[]; id: string }) {
  return (
    <select id={id} className="field" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">No project (shop, travel, other)</option>
      {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  );
}

function ClockCard({ employee, projects, open, onDone, onError }: { employee: Employee; projects: Project[]; open: TimeEntry | null; onDone: (t: string) => void; onError: (t: string) => void }) {
  const [project, setProject] = useState(open?.scheduleId ?? "");
  const [withLoc, setWithLoc] = useState(false);
  const [breakMin, setBreakMin] = useState(0);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { if (!open) return; const t = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(t); }, [open]);

  async function punch() {
    setBusy(true);
    const loc = withLoc ? await getLocation() : null;
    const noLoc = withLoc && !loc ? " Your location wasn't available, so it was saved without it." : "";
    const body = open
      ? { action: "clock_out", entryId: open.id, scheduleId: project || null, breakMinutes: breakMin, note: note || null, ...(loc ?? {}) }
      : { action: "clock_in", resourceId: employee.id, scheduleId: project || null, note: note || null, ...(loc ?? {}) };
    const r = await api<TimeEntry>("/api/team/time", { method: "POST", body: JSON.stringify(body) });
    setBusy(false);
    if (!r.ok) { onError(r.message); return; }
    setNote(""); setBreakMin(0);
    onDone((open ? `Clocked out: ${fmtHours(entryHours(r.data))}. Waiting for approval.` : "Clocked in.") + noLoc);
  }
  return (
    <div className="rounded-xl border border-line bg-surface p-4" data-testid="clock-card">
      <p className="flex items-center gap-2 font-semibold text-navy"><Clock className="h-4 w-4 text-accent-ink" aria-hidden />{employee.name}{employee.title ? <span className="font-normal text-ink-soft">· {employee.title}</span> : null}</p>
      <p className="mt-1 text-sm" data-testid="clock-status">{open
        ? <><Badge tone="accent">Clocked in</Badge> since {new Date(open.clockIn).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} · {fmtHours(entryHours(open, now))}</>
        : <Badge>Clocked out</Badge>}</p>
      <div className="mt-3 grid gap-2">
        <label className="block"><span className="label">Project</span><ProjectSelect id={`clock-project-${employee.id}`} value={project} onChange={setProject} projects={projects} /></label>
        {open && <label className="block"><span className="label">Unpaid break (minutes)</span>
          <input type="number" min={0} max={720} className="field" value={breakMin} onChange={(e) => setBreakMin(Math.max(0, Math.min(720, Number(e.target.value) || 0)))} data-testid="clock-break" /></label>}
        <label className="block"><span className="label">Note (optional)</span><input className="field" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></label>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={withLoc} onChange={(e) => setWithLoc(e.target.checked)} data-testid="clock-location" />
          <span>Include my location for this punch <span className="block text-xs text-muted">Saved once, with its accuracy. Never tracked in the background.</span></span></label>
        <Button onClick={punch} disabled={busy} variant={open ? "primary" : "accent"} data-testid={open ? "clock-out" : "clock-in"}>
          {open ? <><LogOut className="h-4 w-4" aria-hidden /> {busy ? "Clocking out…" : "Clock out"}</> : <><LogIn className="h-4 w-4" aria-hidden /> {busy ? "Clocking in…" : "Clock in"}</>}
        </Button>
      </div>
    </div>
  );
}

function EmployeeDirectory({ list, projects, sheet, onSaved, onError }: { list: EmployeeList; projects: Project[]; sheet: Timesheet | null; onSaved: (t: string) => void; onError: (t: string) => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [archived, setArchived] = useState(false);
  const shown = list.employees.filter((e) => (archived ? e.status === "archived" : e.status === "active"));
  return (
    <section className="space-y-3" data-testid="employee-directory">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-xl font-extrabold text-navy">Employees</h2>
        <Button size="sm" variant="secondary" onClick={() => setArchived(!archived)} aria-pressed={archived}>{archived ? "Show active" : "Show archived"}</Button>
        {list.canManage && <Link href="/projects/team" className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-line-strong bg-surface px-3 text-sm font-semibold hover:bg-paper"><Plus className="h-4 w-4" aria-hidden /> Add or archive staff</Link>}
      </div>
      {shown.length === 0 && <div className="rounded-xl border border-dashed border-line p-5 text-center text-sm text-muted" data-testid="employee-empty">
        {list.employees.length === 0 ? <>No employees yet. Add your people as <b>Staff</b> in People &amp; subs, then set their title and cost rate here.</> : "No one here."}</div>}
      <ul className="grid gap-3 md:grid-cols-2">
        {shown.map((e) => {
          const open = sheet?.entries.find((x) => x.resourceId === e.id && x.status === "open");
          return (
            <li key={e.id} className="rounded-xl border border-line bg-surface p-4" data-testid="employee-card" data-search-id={e.id}>
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-paper text-navy"><User className="h-4 w-4" aria-hidden /></span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 font-semibold text-navy">{e.name}
                    {(open || e.clockedInAt) && <Badge tone="accent">Clocked in</Badge>}
                    {e.linkedUserId ? <Badge>Has a login</Badge> : null}
                    {!e.clockEnabled && <Badge tone="warn">Time clock off</Badge>}</p>
                  <p className="text-sm text-ink-soft">{[e.title, PAY_TYPE_LABEL[e.payType], list.canManage && e.hourlyCost !== null ? `cost ${money(e.hourlyCost)}/h` : null].filter(Boolean).join(" · ")}</p>
                  {(e.phone || e.email) && <p className="text-sm text-ink-soft">{[e.phone, e.email].filter(Boolean).join(" · ")}</p>}
                  {e.emergencyName && <p className="text-xs text-muted">Emergency contact: {e.emergencyName}{e.emergencyPhone ? `, ${e.emergencyPhone}` : ""}</p>}
                  {e.hireDate && <p className="text-xs text-muted">Hired {new Date(`${e.hireDate}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}</p>}
                </div>
              </div>
              {list.canManage && e.status === "active" && (
                <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(editing === e.id ? null : e.id)} data-testid="employee-edit"><Pencil className="h-4 w-4" aria-hidden /> Details</Button>
                  {e.clockEnabled && <CrewPunch employee={e} open={open ?? null} projects={projects} onDone={onSaved} onError={onError} />}
                </div>
              )}
              {editing === e.id && <ProfileForm employee={e} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); onSaved(`${e.name} saved.`); }} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** A manager clocks a crew member in or out (for people without a login). No location. */
function CrewPunch({ employee, open, projects, onDone, onError }: { employee: Employee; open: TimeEntry | null; projects: Project[]; onDone: (t: string) => void; onError: (t: string) => void }) {
  const [show, setShow] = useState(false);
  const [project, setProject] = useState("");
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    const body = open ? { action: "clock_out", entryId: open.id } : { action: "clock_in", resourceId: employee.id, scheduleId: project || null };
    const r = await api<TimeEntry>("/api/team/time", { method: "POST", body: JSON.stringify(body) });
    setBusy(false); setShow(false);
    if (!r.ok) onError(r.message); else onDone(open ? `${employee.name} clocked out.` : `${employee.name} clocked in.`);
  }
  if (open) return <Button size="sm" variant="ghost" onClick={go} disabled={busy} data-testid="crew-clock-out"><LogOut className="h-4 w-4" aria-hidden /> Clock out</Button>;
  if (!show) return <Button size="sm" variant="ghost" onClick={() => setShow(true)} data-testid="crew-clock-in"><LogIn className="h-4 w-4" aria-hidden /> Clock in</Button>;
  return (
    <span className="flex w-full flex-wrap items-end gap-2">
      <label className="min-w-0 flex-1"><span className="label">Project</span><ProjectSelect id={`crew-project-${employee.id}`} value={project} onChange={setProject} projects={projects} /></label>
      <Button size="sm" onClick={go} disabled={busy}>Clock in now</Button>
      <Button size="sm" variant="secondary" onClick={() => setShow(false)}>Cancel</Button>
    </span>
  );
}

function ProfileForm({ employee, onCancel, onSaved }: { employee: Employee; onCancel: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ title: employee.title ?? "", payType: employee.payType, hourlyCost: employee.hourlyCost?.toFixed(2) ?? "", hireDate: employee.hireDate ?? "",
    emergencyName: employee.emergencyName ?? "", emergencyPhone: employee.emergencyPhone ?? "", clockEnabled: employee.clockEnabled });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save() {
    setBusy(true); setErr(null);
    const r = await api(`/api/team/employees/${employee.id}`, { method: "POST", body: JSON.stringify(f) });
    setBusy(false);
    if (!r.ok) { setErr(r.message); return; }
    onSaved();
  }
  return (
    <div className="mt-3 space-y-3 rounded-lg bg-paper p-3" data-testid="profile-form">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block"><span className="label">Job title</span><input className="field" value={f.title} maxLength={120} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Lead carpenter" /></label>
        <label className="block"><span className="label">Pay type</span>
          <select className="field" value={f.payType} onChange={(e) => setF({ ...f, payType: e.target.value as PayType })}>
            {(Object.keys(PAY_TYPE_LABEL) as PayType[]).map((k) => <option key={k} value={k}>{PAY_TYPE_LABEL[k]}</option>)}</select></label>
        <label className="block"><span className="label">Hourly cost rate ($)</span>
          <input className="field" inputMode="decimal" value={f.hourlyCost} onChange={(e) => setF({ ...f, hourlyCost: e.target.value.replace(/[^\d.]/g, "") })} placeholder="e.g. 42.50" data-testid="profile-rate" />
          <span className="mt-1 block text-xs text-muted">Wage plus taxes and benefits per hour. Used for job labor cost. Only managers see it.</span></label>
        <label className="block"><span className="label">Hire date</span><input type="date" className="field" value={f.hireDate} onChange={(e) => setF({ ...f, hireDate: e.target.value })} /></label>
        <label className="block"><span className="label">Emergency contact</span><input className="field" value={f.emergencyName} maxLength={200} onChange={(e) => setF({ ...f, emergencyName: e.target.value })} /></label>
        <label className="block"><span className="label">Emergency phone</span><input className="field" type="tel" value={f.emergencyPhone} maxLength={40} onChange={(e) => setF({ ...f, emergencyPhone: e.target.value })} /></label>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.clockEnabled} onChange={(e) => setF({ ...f, clockEnabled: e.target.checked })} /> Uses the time clock</label>
      {err && <Notice tone="danger">{err}</Notice>}
      <div className="flex gap-2"><Button size="sm" onClick={save} disabled={busy} data-testid="profile-save">{busy ? "Saving…" : "Save"}</Button><Button size="sm" variant="secondary" onClick={onCancel}>Cancel</Button></div>
    </div>
  );
}

function SheetView({ sheet, week, tz, names, employees, projects, onChanged, onError }: {
  sheet: Timesheet; week: string; tz: string; names: Record<string, string>; employees: Employee[]; projects: Project[];
  onChanged: (t: string) => void; onError: (t: string) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [editing, setEditing] = useState<TimeEntry | "new" | null>(null);
  const [history, setHistory] = useState<Record<string, { action: string; reason: string | null; at: string; by: string }[] | "loading">>({});
  const weeks = weeklyTotals(sheet.entries, tz, sheet.rates);
  const labor = laborByProject(sheet.entries, sheet.rates);
  const projectName = (id: string | null) => (id ? sheet.projects[id] ?? projects.find((p) => p.id === id)?.name ?? "Project" : "No project");
  const decidable = sheet.entries.filter((e) => e.status !== "open");

  async function decide(decision: "approve" | "reject" | "reopen", ids: string[]) {
    const r = await api<{ changed: number }>("/api/team/time", { method: "POST", body: JSON.stringify({ action: "decide", ids, decision, note: decision === "reject" ? reason : null }) });
    if (!r.ok) { onError(r.message); return; }
    setPicked([]); setRejecting(false); setReason("");
    onChanged(`${r.data.changed} entr${r.data.changed === 1 ? "y" : "ies"} ${decision === "approve" ? "approved" : decision === "reject" ? "sent back" : "reopened"}.`);
  }
  async function showHistory(id: string) {
    if (history[id]) { setHistory((h) => { const n = { ...h }; delete n[id]; return n; }); return; }
    setHistory((h) => ({ ...h, [id]: "loading" }));
    const r = await api<{ history: { action: string; reason: string | null; at: string; by: string }[] }>(`/api/team/time/${id}`);
    setHistory((h) => ({ ...h, [id]: r.ok ? r.data.history : [] }));
  }

  return (
    <div className="space-y-4">
      {sheet.canManage && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="accent" onClick={() => setEditing("new")} data-testid="time-add"><Plus className="h-4 w-4" aria-hidden /> Add time</Button>
          <Button size="sm" variant="secondary" disabled={!picked.length} onClick={() => decide("approve", picked)} data-testid="time-approve"><Check className="h-4 w-4" aria-hidden /> Approve{picked.length ? ` (${picked.length})` : ""}</Button>
          <Button size="sm" variant="secondary" disabled={!picked.length} onClick={() => setRejecting(true)}><Undo2 className="h-4 w-4" aria-hidden /> Send back</Button>
          <Button size="sm" variant="ghost" disabled={!sheet.entries.length} onClick={() => download(`payroll-prep-${week}.csv`, payrollCsv(weeks, names, true))} data-testid="time-export-payroll"><Download className="h-4 w-4" aria-hidden /> Payroll prep CSV</Button>
          <Button size="sm" variant="ghost" disabled={!sheet.entries.length} onClick={() => download(`time-entries-${week}.csv`, timeEntriesCsv(sheet.entries, names, sheet.projects, tz))}><Download className="h-4 w-4" aria-hidden /> All entries CSV</Button>
        </div>
      )}
      {rejecting && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-line bg-paper p-3">
          <label className="min-w-0 flex-1"><span className="label">Why are you sending {picked.length === 1 ? "this entry" : "these entries"} back?</span>
            <input className="field" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Clock-out looks wrong, please check" /></label>
          <Button size="sm" onClick={() => decide("reject", picked)} disabled={!reason.trim()}>Send back</Button>
          <Button size="sm" variant="secondary" onClick={() => setRejecting(false)}>Cancel</Button>
        </div>
      )}
      {editing && <EntryForm entry={editing === "new" ? null : editing} employees={employees.filter((e) => e.status === "active")} projects={projects}
        onCancel={() => setEditing(null)} onSaved={(t) => { setEditing(null); onChanged(t); }} />}

      {sheet.entries.length === 0 ? <p className="rounded-xl border border-dashed border-line p-5 text-center text-sm text-muted" data-testid="time-empty">No time recorded this week.</p> : (
        <div className="relative overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[720px] text-left text-sm" data-testid="time-table">
            <thead className="bg-paper text-xs uppercase text-muted"><tr>
              {sheet.canManage && <th className="w-8 px-3 py-2"><input type="checkbox" aria-label="Select all" checked={picked.length > 0 && picked.length === decidable.length} onChange={(e) => setPicked(e.target.checked ? decidable.map((x) => x.id) : [])} /></th>}
              <th className="px-3 py-2">Who</th><th className="px-3 py-2">Project</th><th className="px-3 py-2">In</th><th className="px-3 py-2">Out</th><th className="px-3 py-2">Hours</th><th className="px-3 py-2">Status</th><th className="px-3 py-2"><span className="sr-only">Actions</span></th>
            </tr></thead>
            <tbody className="divide-y divide-line">
              {sheet.entries.map((e) => {
                const h = history[e.id];
                return [
                  <tr key={e.id} data-testid="time-row">
                    {sheet.canManage && <td className="px-3 py-2">{e.status !== "open" && <input type="checkbox" aria-label={`Select ${names[e.resourceId] ?? "entry"} ${time(e.clockIn, tz)}`} checked={picked.includes(e.id)} onChange={(x) => setPicked(x.target.checked ? [...picked, e.id] : picked.filter((p) => p !== e.id))} />}</td>}
                    <td className="px-3 py-2 font-semibold text-navy">{names[e.resourceId] ?? "Former staff"}</td>
                    <td className="px-3 py-2">{projectName(e.scheduleId)}{e.note ? <span className="block text-xs text-muted">{e.note}</span> : null}</td>
                    <td className="px-3 py-2">{time(e.clockIn, tz)}{e.inLocation && <a href={mapLink(e.inLocation)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-0.5 text-xs text-accent-ink underline"><MapPin className="h-3 w-3" aria-hidden />{accuracyLabel(e.inLocation)}</a>}</td>
                    <td className="px-3 py-2">{time(e.clockOut, tz)}{e.outLocation && <a href={mapLink(e.outLocation)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-0.5 text-xs text-accent-ink underline"><MapPin className="h-3 w-3" aria-hidden />{accuracyLabel(e.outLocation)}</a>}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtHours(entryHours(e))}{e.breakMinutes ? <span className="block text-xs text-muted">{e.breakMinutes} min break</span> : null}</td>
                    <td className="px-3 py-2"><Badge tone={e.status === "approved" ? "ok" : e.status === "rejected" ? "danger" : e.status === "open" ? "accent" : "warn"}>{TIME_STATUS_LABEL[e.status]}</Badge>
                      {e.edited && <span className="block text-xs text-muted">Edited</span>}{e.decisionNote && <span className="block text-xs text-muted">“{e.decisionNote}”</span>}</td>
                    <td className="px-3 py-2"><span className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => showHistory(e.id)} aria-label="History"><History className="h-4 w-4" aria-hidden /></Button>
                      {sheet.canManage && e.status !== "approved" && e.status !== "open" && <Button size="sm" variant="ghost" onClick={() => setEditing(e)} aria-label="Fix this entry" data-testid="time-edit"><Pencil className="h-4 w-4" aria-hidden /></Button>}
                      {sheet.canManage && e.status === "approved" && <Button size="sm" variant="ghost" onClick={() => decide("reopen", [e.id])} aria-label="Reopen"><RotateCcw className="h-4 w-4" aria-hidden /></Button>}
                    </span></td>
                  </tr>,
                  h ? <tr key={`${e.id}-h`}><td colSpan={sheet.canManage ? 8 : 7} className="bg-paper px-3 py-2 text-xs">
                    {h === "loading" ? "Loading…" : h.length === 0 ? "No changes recorded. This came straight from the time clock." : (
                      <ul className="space-y-0.5">{h.map((c, i) => <li key={i}>{new Date(c.at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}: <b>{c.action}</b> by {c.by || "someone"}{c.reason ? ` (“${c.reason}”)` : ""}</li>)}</ul>)}
                  </td></tr> : null,
                ];
              })}
            </tbody>
          </table>
        </div>
      )}

      {sheet.entries.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-line bg-surface p-4" data-testid="week-totals">
            <p className="font-semibold text-navy">Hours this week</p>
            <ul className="mt-2 divide-y divide-line text-sm">{weeks.map((w) => (
              <li key={`${w.resourceId}-${w.week}`} className="flex flex-wrap justify-between gap-2 py-1.5">
                <span>{names[w.resourceId] ?? "Former staff"}</span>
                <span className="text-right">{fmtHours(w.hours)}{w.overtime > 0 ? <span className="text-warn"> · {fmtHours(w.overtime)} over 40</span> : null}
                  <span className="block text-xs text-muted">{fmtHours(w.approvedHours)} approved{sheet.canManage && w.cost !== null ? ` · ${money(w.cost)}` : ""}</span></span>
              </li>))}</ul>
            <p className="mt-2 text-xs text-muted">“Over 40” is weekly hours past 40. Some states also have daily overtime: your payroll provider applies the rules.</p>
          </div>
          {sheet.canManage && <div className="rounded-xl border border-line bg-surface p-4" data-testid="labor-by-project">
            <p className="font-semibold text-navy">Labor by project (approved)</p>
            <ul className="mt-2 divide-y divide-line text-sm">{labor.map((l) => (
              <li key={l.scheduleId ?? "none"} className="flex flex-wrap justify-between gap-2 py-1.5">
                <span>{projectName(l.scheduleId)}</span>
                <span className="text-right">{fmtHours(l.approvedHours)} · {money(l.cost)}<span className="block text-xs text-muted">{l.people} {l.people === 1 ? "person" : "people"}{l.hours !== l.approvedHours ? `, ${fmtHours(l.hours - l.approvedHours)} not yet approved` : ""}</span></span>
              </li>))}</ul>
            <p className="mt-2 text-xs text-muted">Approved hours × each person&apos;s hourly cost rate. Set rates under Details.</p>
          </div>}
        </div>
      )}
    </div>
  );
}

function EntryForm({ entry, employees, projects, onCancel, onSaved }: { entry: TimeEntry | null; employees: Employee[]; projects: Project[]; onCancel: () => void; onSaved: (t: string) => void }) {
  const [who, setWho] = useState(entry?.resourceId ?? employees[0]?.id ?? "");
  const [project, setProject] = useState(entry?.scheduleId ?? "");
  const [inAt, setIn] = useState(entry ? toLocalInput(entry.clockIn) : "");
  const [outAt, setOut] = useState(entry?.clockOut ? toLocalInput(entry.clockOut) : "");
  const [breakMin, setBreak] = useState(entry?.breakMinutes ?? 0);
  const [note, setNote] = useState(entry?.note ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save() {
    setBusy(true); setErr(null);
    const body = { action: "save", ...(entry ? { id: entry.id } : { resourceId: who }), scheduleId: project || null, clockIn: fromLocalInput(inAt), clockOut: fromLocalInput(outAt),
      breakMinutes: breakMin, note: note || null, reason: reason || null };
    const r = await api<TimeEntry>("/api/team/time", { method: "POST", body: JSON.stringify(body) });
    setBusy(false);
    if (!r.ok) { setErr(r.message); return; }
    onSaved(entry ? "Entry fixed. The change and reason are in its history." : "Time added.");
  }
  return (
    <div className="space-y-3 rounded-xl border border-line bg-paper p-4" data-testid="entry-form">
      <p className="flex items-center justify-between font-semibold text-navy">{entry ? "Fix this entry" : "Add time"}<button type="button" onClick={onCancel} aria-label="Close" className="rounded p-1 hover:bg-black/5"><X className="h-4 w-4" aria-hidden /></button></p>
      <div className="grid gap-3 sm:grid-cols-2">
        {!entry && <label className="block"><span className="label">Who</span>
          <select className="field" value={who} onChange={(e) => setWho(e.target.value)} data-testid="entry-who">{employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>}
        <label className="block"><span className="label">Project</span><ProjectSelect id="entry-project" value={project} onChange={setProject} projects={projects} /></label>
        <label className="block"><span className="label">Clock in</span><input type="datetime-local" className="field" value={inAt} onChange={(e) => setIn(e.target.value)} data-testid="entry-in" /></label>
        <label className="block"><span className="label">Clock out</span><input type="datetime-local" className="field" value={outAt} onChange={(e) => setOut(e.target.value)} data-testid="entry-out" /></label>
        <label className="block"><span className="label">Unpaid break (minutes)</span><input type="number" min={0} max={720} className="field" value={breakMin} onChange={(e) => setBreak(Math.max(0, Math.min(720, Number(e.target.value) || 0)))} /></label>
        <label className="block"><span className="label">Note</span><input className="field" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></label>
      </div>
      <label className="block"><span className="label">{entry ? "Reason for the change (required)" : "Reason (optional)"}</span>
        <input className="field" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder={entry ? "e.g. Forgot to clock out" : "e.g. Paper timesheet"} data-testid="entry-reason" /></label>
      {err && <Notice tone="danger">{err}</Notice>}
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={busy || !inAt || !outAt || (!entry && !who) || (!!entry && !reason.trim())} data-testid="entry-save">{busy ? "Saving…" : entry ? "Save fix" : "Add time"}</Button>
        <Button size="sm" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
