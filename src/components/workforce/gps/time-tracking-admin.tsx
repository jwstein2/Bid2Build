"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, CircleCheck, Clock, Download, ExternalLink, LocateFixed, MapPin, Plus, Search, Settings2, ShieldCheck, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Notice } from "@/components/ui/misc";
import { api } from "@/components/schedule/client";
import { COMMON_TIMEZONES } from "@/components/schedule/client";
import { addDays, localDay, REVIEW_FLAG_LABEL, TIME_SOURCE_LABEL, weekStart, WORK_TYPE_LABEL, type Timesheet, type TimeEntry } from "@/lib/team/records";
import { fmtRadius, radiusGuidance, RADIUS_PRESETS } from "@/lib/workforce/gps/geofence";
import { OVERTIME_RULES } from "@/lib/workforce/gps/overtime";
import { payrollCsvV2, payrollRows, timeDetailCsv } from "@/lib/workforce/gps/export";
import {
  EVENT_KIND_LABEL, LOCATION_KIND_LABEL, OUTCOME_LABEL, PERMISSION_LABEL, setupSteps, WEEKDAYS,
  type Correction, type Exceptions, type GeoEventRow, type GpsAdmin, type GpsSettings, type LocationKind, type WorkLocation,
} from "@/lib/workforce/gps/model";
import { CLASSIFICATION_LABEL, type Classification } from "@/lib/workforce/hub/model";
import { LaborReportPanel, PayPanel, SchedulesPanel } from "@/components/workforce/hub/admin-panels";
import { WorkerInviteButton } from "@/components/workforce/hub/worker-invite";

export type Tab = "overview" | "locations" | "employees" | "settings" | "corrections" | "payroll" | "schedules" | "report" | "pay";
const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" }, { key: "locations", label: "Work locations" }, { key: "employees", label: "Employees" },
  { key: "schedules", label: "Schedules" }, { key: "corrections", label: "Corrections" }, { key: "payroll", label: "Timesheets & export" },
  { key: "report", label: "Labor report" }, { key: "pay", label: "Projected pay" }, { key: "settings", label: "Settings" },
];
type Data = { admin: GpsAdmin; exceptions: Exceptions | null; corrections: Correction[]; classifications?: Record<string, Classification | null> | null };
const fmtTime = (iso: string | null, tz: string) => (iso ? new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso)) : "—");
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");
function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const osm = (lat: number, lng: number) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`;

/**
 * Projects → Contractors & Workforce → Time tracking (V8.2). Automatic GPS clock-in/out for the company's own W-2
 * employees: setup, work locations and geofences, who it applies to, exceptions, corrections and payroll-ready
 * exports. Off by default. Customer-facing only.
 */
export function TimeTrackingAdmin({ initial, projects, initialTab }: { initial: Data; projects: Record<string, string>; initialTab?: Tab }) {
  const [data, setData] = useState<Data>(initial);
  const [tab, setTab] = useState<Tab>(initialTab ?? "overview");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const a = data.admin;
  const tz = a.settings.timezone;
  const names = useMemo(() => Object.fromEntries(a.employees.map((e) => [e.id, e.name])), [a.employees]);
  const locNames = useMemo(() => Object.fromEntries(a.locations.map((l) => [l.id, l.name])), [a.locations]);

  const reload = useCallback(async () => {
    const r = await api<Data>("/api/workforce/gps");
    if (r.ok) setData(r.data); else setMsg({ ok: false, text: r.message });
  }, []);
  const post = useCallback(async (body: Record<string, unknown>, okText: string) => {
    const r = await api<{ ok: true; data: unknown }>("/api/workforce/gps", { method: "POST", body: JSON.stringify(body) });
    if (!r.ok) { setMsg({ ok: false, text: r.message }); return false; }
    setMsg({ ok: true, text: okText });
    await reload();
    return true;
  }, [reload]);
  const setClass = useCallback(async (resourceId: string, classification: string, name: string) => {
    const r = await api<{ ok: true }>("/api/workforce/hub/admin", { method: "POST", body: JSON.stringify({ action: "classification", resourceId, classification }) });
    if (!r.ok) { setMsg({ ok: false, text: r.message }); return; }
    setMsg({ ok: true, text: classification === "w2" ? `${name} set as a W-2 employee.` : `${name} saved${classification ? ` as ${CLASSIFICATION_LABEL[classification as Classification]}` : ""}. GPS time tracking is off for anyone who isn't W-2.` });
    await reload();
  }, [reload]);

  return (
    <div className="space-y-5" data-testid="gps-admin">
      <nav aria-label="Time tracking sections" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex min-w-max gap-1 border-b border-line">
          {TABS.filter((t) => (t.key !== "settings" || a.canAdmin) && (t.key !== "schedules" || a.canSupervise) && (t.key !== "report" || a.canSupervise)).map((t) => (
            <li key={t.key}>
              <button type="button" onClick={() => { setTab(t.key); setMsg(null); }} aria-current={tab === t.key ? "page" : undefined} data-testid={`gps-tab-${t.key}`}
                className={`inline-flex min-h-11 items-center gap-1.5 border-b-2 px-3 text-sm font-semibold ${tab === t.key ? "border-accent-ink text-navy" : "border-transparent text-ink-soft hover:text-navy"}`}>
                {t.label}{t.key === "corrections" && data.corrections.length > 0 && <Badge tone="warn">{data.corrections.length}</Badge>}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      {msg && <Notice tone={msg.ok ? "ok" : "danger"}>{msg.text}</Notice>}
      {tab === "overview" && <Overview data={data} tz={tz} names={names} locNames={locNames} post={post} go={setTab} />}
      {tab === "locations" && <Locations a={a} projects={projects} post={post} onError={(t) => setMsg({ ok: false, text: t })} />}
      {tab === "employees" && <Employees a={a} tz={tz} locNames={locNames} post={post} classes={data.classifications ?? null} setClass={setClass} reloadAll={() => { void reload(); }} />}
      {tab === "schedules" && a.canSupervise && <SchedulesPanel staff={a.employees.filter((e) => e.kind === "staff" && e.status === "active").map((e) => ({ id: e.id, name: e.name }))} locations={a.locations} projects={projects} tz={tz} canEdit={a.canSupervise} />}
      {tab === "report" && a.canSupervise && <LaborReportPanel tz={tz} />}
      {tab === "pay" && <PayPanel />}
      {tab === "corrections" && <Corrections list={data.corrections} names={names} locNames={locNames} projects={projects} tz={tz} post={post} />}
      {tab === "payroll" && <Payroll a={a} names={names} />}
      {tab === "settings" && a.canAdmin && <SettingsForm a={a} post={post} />}
    </div>
  );
}

// -------------------------------------------------------------------------------------------------------------------
function Overview({ data, tz, names, locNames, post, go }: { data: Data; tz: string; names: Record<string, string>; locNames: Record<string, string>; post: (b: Record<string, unknown>, t: string) => Promise<boolean>; go: (t: Tab) => void }) {
  const a = data.admin;
  const steps = setupSteps(a);
  const ready = steps.slice(0, 3).every((s) => s.done);
  const onClock = a.employees.filter((e) => e.open);
  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-line bg-surface p-4" data-testid="gps-switch">
        <div className="flex flex-wrap items-start gap-3">
          <div className="mr-auto">
            <h2 className="flex items-center gap-2 text-lg font-extrabold text-navy"><LocateFixed className="h-5 w-5 text-accent-ink" aria-hidden />Automatic GPS Time Tracking</h2>
            <p className="mt-1 text-sm text-ink-soft">Clocks your W-2 crew in when they arrive at an approved work location and handles leaving the way you choose. Subcontractors are never included.</p>
          </div>
          <Badge tone={a.settings.enabled ? "ok" : "neutral"}>{a.settings.enabled ? "On" : "Off"}</Badge>
        </div>
        <ol className="mt-3 space-y-1.5 text-sm">
          {steps.map((s) => (
            <li key={s.key} className="flex items-start gap-2">
              {s.done ? <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden /> : <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 border-line-strong" aria-hidden />}
              <span className={s.done ? "text-ink-soft" : ""}>{s.label}<span className="sr-only">{s.done ? " (done)" : " (to do)"}</span></span>
            </li>
          ))}
        </ol>
        {a.canAdmin && (
          <div className="mt-3 flex flex-wrap gap-2">
            {a.settings.enabled
              ? <Button variant="secondary" onClick={() => post({ action: "settings", enabled: false }, "Automatic GPS time tracking is off. The manual time clock still works.")} data-testid="gps-off">Turn off</Button>
              : <Button onClick={() => post({ action: "settings", enabled: true }, "Automatic GPS time tracking is on. Each employee still has to accept the notice on their phone.")} disabled={!ready} data-testid="gps-on">Turn on</Button>}
            {!ready && <Button variant="ghost" onClick={() => go(steps[0].done ? "settings" : "locations")}>Finish setup</Button>}
          </div>
        )}
        <p className="mt-3 text-xs text-muted">Works while the employee has Built2Bid open on their phone. Phones pause web pages in the background, so it can&apos;t run with the app closed yet; see <Link href="#limits" className="underline">what works where</Link>. Manual clock-in always works.</p>
      </section>

      <section className="space-y-2" data-testid="gps-on-clock">
        <h2 className="text-lg font-extrabold text-navy">On the clock now</h2>
        {onClock.length === 0 ? <p className="text-sm text-muted">Nobody is clocked in.</p> : (
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
            {onClock.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
                <span className="font-semibold">{e.name}</span>
                <span className="text-ink-soft">{e.open!.locationId ? locNames[e.open!.locationId] ?? "Work location" : "No location"} · since {fmtTime(e.open!.clockIn, tz)}</span>
                <Badge tone={e.open!.source.startsWith("gps") ? "accent" : "neutral"}>{TIME_SOURCE_LABEL[e.open!.source as keyof typeof TIME_SOURCE_LABEL] ?? "Time clock"}</Badge>
                {e.open!.awaySince && <Badge tone="warn">Left the site {fmtTime(e.open!.awaySince, tz)}, waiting for an answer</Badge>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.exceptions && (
        <section className="space-y-2" data-testid="gps-exceptions">
          <h2 className="text-lg font-extrabold text-navy">Needs a look</h2>
          {data.exceptions.entries.length === 0 && data.exceptions.people.length === 0 && data.exceptions.pendingCorrections === 0
            ? <p className="text-sm text-muted">Nothing right now.</p> : (
            <ul className="space-y-2">
              {data.exceptions.pendingCorrections > 0 && (
                <li><button type="button" onClick={() => go("corrections")} className="flex w-full items-center gap-2 rounded-lg border border-warn/40 bg-warn-tint px-3 py-2 text-left text-sm font-semibold">
                  <AlertTriangle className="h-4 w-4 text-warn" aria-hidden />{data.exceptions.pendingCorrections} correction request{data.exceptions.pendingCorrections === 1 ? "" : "s"} to decide</button></li>
              )}
              {data.exceptions.entries.map((e) => (
                <li key={e.id} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm">
                  <span className="font-semibold">{names[e.resourceId] ?? "Employee"}</span> · {fmtTime(e.clockIn, tz)}{e.clockOut ? ` – ${fmtTime(e.clockOut, tz)}` : ""}
                  {e.locationId && <> · {locNames[e.locationId]}</>}
                  <p className="text-ink-soft">{e.awaySince ? `Left the site at ${fmtTime(e.awaySince, tz)} and hasn't said whether they're still working. The time stays on the clock until they answer or you fix it.` : e.reviewFlag ? REVIEW_FLAG_LABEL[e.reviewFlag] : e.status === "open" ? "Clocked in for more than 12 hours." : ""}</p>
                </li>
              ))}
              {data.exceptions.people.map((p) => (
                <li key={p.resourceId} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm">
                  <span className="font-semibold">{p.name}</span>: {!p.consent ? "hasn't accepted the GPS notice yet (manual clock only)." : p.permission === "denied" ? "blocked location on their phone (manual clock only)." : p.permission === "unavailable" ? "phone has no location (manual clock only)." : `${p.lowAccuracy7d} weak-GPS readings this week were ignored.`}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <Limits />
    </div>
  );
}

/** What actually works where. Kept honest: nothing runs with the browser closed. */
export function Limits() {
  const rows = [
    ["Built2Bid open on screen (phone browser or Home Screen app)", "Works: automatic clock-in/out at assigned sites", "Checked in Chromium with a simulated location; check on your crew's phones"],
    ["App minimized, screen locked, or another app in front", "Doesn't work: phones pause web pages; events resume when Built2Bid is opened again", "iPhone and Android limit"],
    ["App closed", "Doesn't work in a web app", "Needs the native app (planned)"],
    ["Native iPhone / Android app (planned)", "Background arrive/leave, uses the same rules and records", "Not built yet: needs Apple and Google developer accounts"],
  ];
  return (
    <section id="limits" className="space-y-2" data-testid="gps-limits">
      <h2 className="text-lg font-extrabold text-navy">What works where</h2>
      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[34rem] text-left text-sm">
          <thead className="bg-paper text-xs uppercase tracking-wide text-muted"><tr><th className="px-3 py-2">Phone state</th><th className="px-3 py-2">Automatic GPS time</th><th className="px-3 py-2">Status</th></tr></thead>
          <tbody className="divide-y divide-line">{rows.map((r) => <tr key={r[0]}><td className="px-3 py-2">{r[0]}</td><td className="px-3 py-2">{r[1]}</td><td className="px-3 py-2 text-ink-soft">{r[2]}</td></tr>)}</tbody>
        </table>
      </div>
      <p className="text-xs text-muted">The manual Clock in / Clock out buttons always work, with or without location. Employees who say no to location use them instead.</p>
    </section>
  );
}

// -------------------------------------------------------------------------------------------------------------------
type Draft = { id?: string; kind: LocationKind; name: string; address: string; scheduleId: string | null; lat: string; lng: string; radiusM: number;
  pinSource: "device" | "census" | "manual" | null; pinAccuracyM: number | null; everyone: boolean; confirm: boolean; assigned: string[] };
const toDraft = (l: WorkLocation): Draft => ({ id: l.id, kind: l.kind, name: l.name, address: l.address ?? "", scheduleId: l.scheduleId, lat: l.lat?.toString() ?? "", lng: l.lng?.toString() ?? "",
  radiusM: l.radiusM, pinSource: l.pinSource, pinAccuracyM: l.pinAccuracyM, everyone: l.everyone, confirm: Boolean(l.confirmedAt), assigned: l.assigned.map((x) => x.resourceId) });

function Locations({ a, projects, post, onError }: { a: GpsAdmin; projects: Record<string, string>; post: (b: Record<string, unknown>, t: string) => Promise<boolean>; onError: (t: string) => void }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const hasBusiness = a.locations.some((l) => l.kind === "business" && l.status === "active");
  const blank = (kind: LocationKind, extra: Partial<Draft> = {}): Draft => ({ kind, name: "", address: "", scheduleId: null, lat: "", lng: "", radiusM: a.settings.defaultRadiusM,
    pinSource: null, pinAccuracyM: null, everyone: kind === "business", confirm: false, assigned: [], ...extra });
  const active = a.locations.filter((l) => l.status === "active"), archived = a.locations.filter((l) => l.status === "archived");
  return (
    <div className="space-y-4">
      {a.canAdmin && !draft && (
        <div className="flex flex-wrap gap-2">
          {!hasBusiness && <Button onClick={() => setDraft(blank("business", { name: "Main office / shop", address: a.candidates.business ?? "" }))} data-testid="gps-add-business"><Plus className="h-4 w-4" aria-hidden />Main business address</Button>}
          {a.candidates.projects.length > 0 && (
            <select className="field max-w-xs" value="" aria-label="Add a jobsite from a project" data-testid="gps-add-project"
              onChange={(e) => { const p = a.candidates.projects.find((x) => x.scheduleId === e.target.value); if (p) setDraft(blank("project", { name: p.name, address: p.address ?? "", scheduleId: p.scheduleId })); }}>
              <option value="">+ Jobsite from a project…</option>
              {a.candidates.projects.map((p) => <option key={p.scheduleId} value={p.scheduleId}>{p.name}{p.address ? ` · ${p.address}` : ""}</option>)}
            </select>
          )}
          <Button variant="secondary" onClick={() => setDraft(blank("other"))}><Plus className="h-4 w-4" aria-hidden />Other place (warehouse, yard, temporary site)</Button>
        </div>
      )}
      {draft && <LocationEditor a={a} draft={draft} setDraft={setDraft} post={post} onError={onError} />}
      {active.length === 0 && !draft && <Notice title="No work locations yet">Start with your main business address. Jobsites come from your projects&apos; addresses.</Notice>}
      <ul className="grid gap-3 md:grid-cols-2">
        {active.map((l) => (
          <li key={l.id} className="rounded-xl border border-line bg-surface p-4 text-sm" data-testid="gps-location">
            <div className="flex flex-wrap items-start gap-2">
              <p className="mr-auto font-semibold text-navy"><MapPin className="mr-1 inline h-4 w-4 text-accent-ink" aria-hidden />{l.name}</p>
              <Badge tone={l.ready ? "ok" : "warn"}>{l.ready ? "Ready" : l.lat === null ? "Needs a pin" : "Needs confirming"}</Badge>
            </div>
            <p className="text-ink-soft">{LOCATION_KIND_LABEL[l.kind]}{l.scheduleId && projects[l.scheduleId] ? ` · ${projects[l.scheduleId]}` : ""}</p>
            {l.address && <p className="text-ink-soft">{l.address}</p>}
            <p className="mt-1">Geofence {fmtRadius(l.radiusM)}{l.lat !== null && l.lng !== null && <> · <a href={osm(l.lat, l.lng)} target="_blank" rel="noopener noreferrer" className="text-accent-ink underline">check pin<ExternalLink className="ml-0.5 inline h-3 w-3" aria-hidden /></a></>}</p>
            <p className="text-ink-soft">{l.everyone ? "Everyone with GPS time tracking" : `${l.assigned.length} assigned`}{l.scheduledToday.length > 0 ? ` · ${l.scheduledToday.length} more scheduled on this project today` : ""}</p>
            {a.canAdmin && (
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => setDraft(toDraft(l))}>Edit</Button>
                <Button size="sm" variant="ghost" onClick={() => post({ action: "location_status", id: l.id, status: "archived" }, `${l.name} archived. Nobody is clocked in there automatically now.`)}>Archive</Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {archived.length > 0 && (
        <details className="text-sm"><summary className="cursor-pointer font-semibold text-ink-soft">Archived ({archived.length})</summary>
          <ul className="mt-2 space-y-1">{archived.map((l) => <li key={l.id} className="flex items-center gap-2">{l.name}{a.canAdmin && <Button size="sm" variant="link" onClick={() => post({ action: "location_status", id: l.id, status: "active" }, `${l.name} restored.`)}>Restore</Button>}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

function LocationEditor({ a, draft, setDraft, post, onError }: { a: GpsAdmin; draft: Draft; setDraft: (d: Draft | null) => void; post: (b: Record<string, unknown>, t: string) => Promise<boolean>; onError: (t: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [matches, setMatches] = useState<{ address: string; lat: number; lng: number }[] | null>(null);
  const set = (p: Partial<Draft>) => setDraft({ ...draft, ...p });
  const g = radiusGuidance(draft.radiusM);
  const staff = a.employees.filter((e) => e.kind === "staff" && e.status === "active");
  const pinOk = draft.lat !== "" && draft.lng !== "" && Number.isFinite(Number(draft.lat)) && Number.isFinite(Number(draft.lng));
  const custom = !RADIUS_PRESETS.some((p) => p.m === draft.radiusM);

  async function lookup() {
    setBusy(true); setMatches(null);
    const r = await api<{ matches: { address: string; lat: number; lng: number }[] }>(`/api/workforce/geocode?q=${encodeURIComponent(draft.address)}`);
    setBusy(false);
    if (!r.ok) { onError(r.message); return; }
    setMatches(r.data.matches);
  }
  function here() {
    if (!navigator.geolocation) { onError("This device can't share its location. Enter the pin by hand."); return; }
    setBusy(true);
    navigator.geolocation.getCurrentPosition((p) => {
      setBusy(false);
      set({ lat: p.coords.latitude.toFixed(6), lng: p.coords.longitude.toFixed(6), pinSource: "device", pinAccuracyM: Math.round(p.coords.accuracy), confirm: false });
    }, () => { setBusy(false); onError("Location wasn't available. Allow location for this site, or use the address lookup."); }, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 });
  }
  async function save() {
    setBusy(true);
    const ok = await post({ action: "location", id: draft.id, kind: draft.id ? undefined : draft.kind, name: draft.name, address: draft.address || null, scheduleId: draft.scheduleId,
      lat: pinOk ? Number(draft.lat) : null, lng: pinOk ? Number(draft.lng) : null, radiusM: draft.radiusM, pinSource: draft.pinSource ?? "manual", pinAccuracyM: draft.pinAccuracyM,
      everyone: draft.everyone, confirm: draft.confirm && pinOk }, `${draft.name} saved${draft.confirm && pinOk ? " and confirmed" : ". Confirm the pin when it's right"}.`);
    if (ok && draft.id) await post({ action: "assign", id: draft.id, resourceIds: draft.assigned, everyone: draft.everyone }, `${draft.name} saved.`);
    setBusy(false);
    if (ok) setDraft(null);
  }
  return (
    <section className="space-y-3 rounded-xl border border-accent-ink/40 bg-surface p-4" data-testid="gps-location-editor">
      <div className="flex items-center"><h2 className="mr-auto text-lg font-extrabold text-navy">{draft.id ? "Edit work location" : `New: ${LOCATION_KIND_LABEL[draft.kind]}`}</h2>
        <Button size="sm" variant="ghost" onClick={() => setDraft(null)} aria-label="Close"><X className="h-4 w-4" aria-hidden /></Button></div>
      <label className="block"><span className="label">Name</span><input className="field" value={draft.name} maxLength={200} onChange={(e) => set({ name: e.target.value })} /></label>
      <div>
        <label className="block"><span className="label">Address</span><input className="field" value={draft.address} maxLength={500} onChange={(e) => set({ address: e.target.value })} /></label>
        {draft.kind === "business" && a.candidates.business && draft.address === a.candidates.business && <p className="mt-1 text-xs text-muted">From your Company profile. Check it&apos;s where the crew actually shows up.</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={lookup} disabled={busy || draft.address.trim().length < 5}><Search className="h-4 w-4" aria-hidden />Find the address</Button>
        <Button size="sm" variant="secondary" onClick={here} disabled={busy}><LocateFixed className="h-4 w-4" aria-hidden />Use my current location</Button>
      </div>
      <p className="text-xs text-muted">Address lookup uses the free U.S. Census Bureau geocoder (no charge). It can be 50-200 m off, so check the pin. Standing on site and using your current location is usually more accurate.</p>
      {matches && (matches.length === 0 ? <Notice tone="warn">No match for that address. Try the full street address with city and state, or use your current location.</Notice> : (
        <ul className="space-y-1">{matches.map((m) => (
          <li key={`${m.lat},${m.lng}`}><button type="button" className="w-full rounded-lg border border-line px-3 py-2 text-left text-sm hover:border-accent-ink"
            onClick={() => { set({ lat: String(m.lat), lng: String(m.lng), pinSource: "census", pinAccuracyM: null, confirm: false }); setMatches(null); }}>{m.address}</button></li>
        ))}</ul>
      ))}
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block"><span className="label">Latitude</span><input className="field" inputMode="decimal" value={draft.lat} onChange={(e) => set({ lat: e.target.value, pinSource: "manual", confirm: false })} /></label>
        <label className="block"><span className="label">Longitude</span><input className="field" inputMode="decimal" value={draft.lng} onChange={(e) => set({ lng: e.target.value, pinSource: "manual", confirm: false })} /></label>
      </div>
      {pinOk && <p className="text-sm"><a href={osm(Number(draft.lat), Number(draft.lng))} target="_blank" rel="noopener noreferrer" className="text-accent-ink underline">Check this pin on a map<ExternalLink className="ml-0.5 inline h-3 w-3" aria-hidden /></a>
        {draft.pinSource === "device" && draft.pinAccuracyM !== null && <span className="text-ink-soft"> · your phone said ±{draft.pinAccuracyM} m</span>}</p>}
      <fieldset>
        <legend className="label">Geofence radius</legend>
        <div className="flex flex-wrap gap-2">
          {RADIUS_PRESETS.map((p) => (
            <label key={p.m} className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm ${draft.radiusM === p.m ? "border-accent-ink bg-accent-tint font-semibold" : "border-line"}`}>
              <input type="radio" name="radius" checked={draft.radiusM === p.m} onChange={() => set({ radiusM: p.m, confirm: false })} />{p.label}</label>
          ))}
          <label className={`inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm ${custom ? "border-accent-ink bg-accent-tint font-semibold" : "border-line"}`}>
            <input type="radio" name="radius" checked={custom} onChange={() => set({ radiusM: 120, confirm: false })} />Custom
            <input type="number" min={30} max={322} className="field field-sm w-20" value={draft.radiusM} aria-label="Custom radius in metres"
              onChange={(e) => set({ radiusM: Math.max(30, Math.min(322, Math.round(Number(e.target.value) || 30))), confirm: false })} /> m
          </label>
        </div>
        <p className={`mt-1 text-xs ${g.tone === "ok" ? "text-ok" : g.tone === "warn" ? "text-warn" : "text-danger"}`} data-testid="gps-radius-guidance">{g.text}</p>
      </fieldset>
      {draft.id && (
        <fieldset>
          <legend className="label">Who works here</legend>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.everyone} onChange={(e) => set({ everyone: e.target.checked })} />Everyone with GPS time tracking (good for the shop or office)</label>
          {!draft.everyone && (
            <div className="mt-2 grid gap-1 sm:grid-cols-2">
              {staff.map((e) => (
                <label key={e.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.assigned.includes(e.id)}
                  onChange={(ev) => set({ assigned: ev.target.checked ? [...draft.assigned, e.id] : draft.assigned.filter((x) => x !== e.id) })} />{e.name}</label>
              ))}
            </div>
          )}
          {draft.kind === "project" && <p className="mt-1 text-xs text-muted">People assigned to this project&apos;s schedule tasks also count around their task dates.</p>}
        </fieldset>
      )}
      {!draft.id && <p className="text-xs text-muted">After saving, edit the location to choose who works there.</p>}
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={draft.confirm} disabled={!pinOk} onChange={(e) => set({ confirm: e.target.checked })} data-testid="gps-confirm-pin" />
        <span>I checked the pin and radius. Use this location for automatic clock-in.</span></label>
      <div className="flex gap-2"><Button onClick={save} disabled={busy || !draft.name.trim()} data-testid="gps-save-location">Save location</Button><Button variant="ghost" onClick={() => setDraft(null)}>Cancel</Button></div>
    </section>
  );
}

// -------------------------------------------------------------------------------------------------------------------
function Employees({ a, tz, locNames, post, classes, setClass, reloadAll }: { reloadAll: () => void; a: GpsAdmin; tz: string; locNames: Record<string, string>; post: (b: Record<string, unknown>, t: string) => Promise<boolean>; classes: Record<string, Classification | null> | null; setClass: (id: string, c: string, name: string) => Promise<void> }) {
  const [events, setEvents] = useState<{ id: string; name: string; rows: GeoEventRow[] } | null>(null);
  const staff = a.employees.filter((e) => e.kind === "staff" && e.status === "active");
  const subs = a.employees.filter((e) => e.kind === "subcontractor" && e.status === "active");
  async function showEvents(id: string, name: string) {
    const r = await api<{ events: GeoEventRow[] }>(`/api/workforce/gps?events=${id}`);
    setEvents({ id, name, rows: r.ok ? r.data.events : [] });
  }
  void locNames;
  return (
    <div className="space-y-4">
      <Notice>Only turn GPS time tracking on for <strong>W-2 employees whose hours you track</strong>. Having a Built2Bid login doesn&apos;t make someone an employee, and subcontractors, 1099 contractors and vendors are never included. Each person also has to accept the notice on their own phone.</Notice>
      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[46rem] text-left text-sm" data-testid="gps-employees">
          <thead className="bg-paper text-xs uppercase tracking-wide text-muted">
            <tr><th className="px-3 py-2">Employee</th><th className="px-3 py-2">{classes ? "Classification" : "W-2, hours tracked"}</th><th className="px-3 py-2">GPS time</th><th className="px-3 py-2">Accepted notice</th><th className="px-3 py-2">Phone location</th><th className="px-3 py-2"></th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {staff.map((e) => (
              <tr key={e.id}>
                <td className="px-3 py-2"><span className="font-semibold">{e.name}</span>{!e.linked && <span className="block text-xs text-muted">No login linked: manual clock by a manager</span>}{!e.linked && a.canAdmin && <span className="mt-1 block"><WorkerInviteButton resourceId={e.id} name={e.name} onDone={reloadAll} /></span>}{e.flsa === "exempt" && <span className="block text-xs text-muted">FLSA exempt (no overtime split)</span>}</td>
                <td className="px-3 py-2">{classes ? (
                  <select className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm" aria-label={`${e.name}: employment classification`} value={classes[e.id] ?? ""} disabled={!a.canAdmin} data-testid={`hub-class-${e.id}`}
                    onChange={(ev) => setClass(e.id, ev.target.value, e.name)}>
                    <option value="">Not set</option>{(Object.keys(CLASSIFICATION_LABEL) as Classification[]).map((c) => <option key={c} value={c}>{CLASSIFICATION_LABEL[c]}</option>)}
                  </select>
                ) : (
                  <input type="checkbox" aria-label={`${e.name} is a W-2 employee whose hours we track`} checked={Boolean(e.w2ConfirmedAt)} disabled={!a.canAdmin}
                  onChange={(ev) => post({ action: "enroll", resourceId: e.id, w2Confirmed: ev.target.checked, enrolled: ev.target.checked ? e.enrolled : false }, ev.target.checked ? `${e.name} confirmed as a W-2 employee.` : `${e.name} removed from GPS time tracking.`)} />
                )}</td>
                <td className="px-3 py-2"><label className="inline-flex items-center gap-2"><input type="checkbox" checked={e.enrolled} disabled={!a.canAdmin || !e.w2ConfirmedAt || !e.linked} data-testid={`gps-enroll-${e.id}`}
                  onChange={(ev) => post({ action: "enroll", resourceId: e.id, enrolled: ev.target.checked, w2Confirmed: true }, ev.target.checked ? `GPS time tracking turned on for ${e.name}. They'll be asked to accept the notice.` : `GPS time tracking turned off for ${e.name}.`)} />{e.active ? <Badge tone="ok">Active</Badge> : e.enrolled ? <Badge>Waiting for them</Badge> : null}</label></td>
                <td className="px-3 py-2">{e.consentAt ? fmtDate(e.consentAt) : e.consentWithdrawnAt ? <Badge tone="warn">Turned off {fmtDate(e.consentWithdrawnAt)}</Badge> : "—"}</td>
                <td className="px-3 py-2">{e.enrolled ? <><Badge tone={e.permission === "granted" ? "ok" : e.permission === "denied" || e.permission === "unavailable" ? "danger" : "neutral"}>{PERMISSION_LABEL[e.permission]}</Badge>{e.appMode && <span className="block text-xs text-muted">{e.appMode === "pwa" ? "Home Screen app" : e.appMode === "browser" ? "Phone browser" : e.appMode.replace("native_", "Native ")}{e.lastSeenAt ? ` · seen ${fmtTime(e.lastSeenAt, tz)}` : ""}</span>}</> : "—"}</td>
                <td className="px-3 py-2">{a.canSupervise && e.enrolled && <Button size="sm" variant="ghost" onClick={() => showEvents(e.id, e.name)}>Arrivals</Button>}</td>
              </tr>
            ))}
            {subs.map((e) => (
              <tr key={e.id} className="text-muted"><td className="px-3 py-2">{e.name}</td><td className="px-3 py-2" colSpan={5}>Subcontractor: not eligible. Their own time entries (if any) stay separate.</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      {staff.length === 0 && <Notice>Add employees as Staff in <Link href="/projects/team" className="underline">Team &amp; Subcontractors</Link> and link their login.</Notice>}
      {events && (
        <section className="space-y-2 rounded-xl border border-line bg-surface p-4" data-testid="gps-events">
          <div className="flex items-center"><h3 className="mr-auto font-extrabold text-navy">{events.name}: arrivals and departures (14 days)</h3><Button size="sm" variant="ghost" onClick={() => setEvents(null)} aria-label="Close"><X className="h-4 w-4" aria-hidden /></Button></div>
          <p className="text-xs text-muted">Only events at approved work locations, with distance from the site and GPS accuracy. There&apos;s no location trail.</p>
          {events.rows.length === 0 ? <p className="text-sm text-muted">No events.</p> : (
            <ul className="divide-y divide-line text-sm">{events.rows.map((g) => (
              <li key={g.id} className="flex flex-wrap gap-x-2 py-1.5"><span className="font-semibold">{fmtTime(g.occurredAt, tz)}</span><span>{EVENT_KIND_LABEL[g.kind] ?? g.kind}{g.location ? ` · ${g.location}` : ""}</span>
                <span className="text-ink-soft">{OUTCOME_LABEL[g.outcome] ?? g.outcome}{g.distanceM !== null ? ` · ${g.distanceM} m from centre` : ""}{g.accuracyM !== null ? ` · ±${g.accuracyM} m` : ""}</span></li>
            ))}</ul>
          )}
        </section>
      )}
    </div>
  );
}

// -------------------------------------------------------------------------------------------------------------------
function Corrections({ list, names, locNames, projects, tz, post }: { list: Correction[]; names: Record<string, string>; locNames: Record<string, string>; projects: Record<string, string>; tz: string; post: (b: Record<string, unknown>, t: string) => Promise<boolean> }) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  if (list.length === 0) return <p className="text-sm text-muted" data-testid="gps-corrections">No correction requests waiting.</p>;
  return (
    <ul className="space-y-3" data-testid="gps-corrections">
      {list.map((k) => (
        <li key={k.id} className="rounded-xl border border-line bg-surface p-4 text-sm">
          <p className="font-semibold">{names[k.resourceId] ?? "Employee"} · {k.kind === "missing" ? "Missing time" : "Fix an entry"} <span className="font-normal text-muted">· asked {fmtTime(k.requestedAt, tz)}</span></p>
          {k.current && <p className="text-ink-soft">Now: {fmtTime(k.current.clockIn, tz)} – {fmtTime(k.current.clockOut, tz)}{k.current.breakMinutes ? ` · ${k.current.breakMinutes} min unpaid break` : ""}</p>}
          <p>Asked for: <strong>{fmtTime(k.clockIn, tz)} – {fmtTime(k.clockOut, tz)}</strong>{k.breakMinutes ? ` · ${k.breakMinutes} min unpaid break` : ""}{k.paidBreakMinutes ? ` · ${k.paidBreakMinutes} min paid break` : ""} · {WORK_TYPE_LABEL[k.workType]}
            {k.locationId && locNames[k.locationId] ? ` · ${locNames[k.locationId]}` : ""}{k.scheduleId && projects[k.scheduleId] ? ` · ${projects[k.scheduleId]}` : ""}</p>
          <p className="mt-1 rounded bg-paper px-2 py-1">“{k.reason}”</p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="min-w-[14rem] flex-1"><span className="label">Note (needed to deny)</span><input className="field" maxLength={300} value={notes[k.id] ?? ""} onChange={(e) => setNotes({ ...notes, [k.id]: e.target.value })} /></label>
            <Button size="sm" onClick={() => post({ action: "decide_correction", id: k.id, approve: true, note: notes[k.id] || null }, "Correction approved. The entry was updated and its original time kept in the history.")}><Check className="h-4 w-4" aria-hidden />Approve hours</Button>
            <Button size="sm" variant="secondary" disabled={!(notes[k.id] ?? "").trim()} onClick={() => post({ action: "decide_correction", id: k.id, approve: false, note: notes[k.id] }, "Correction denied. The employee can see your note.")}>Deny</Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

// -------------------------------------------------------------------------------------------------------------------
function Payroll({ a, names }: { a: GpsAdmin; names: Record<string, string> }) {
  const tz = a.settings.timezone;
  const [week, setWeek] = useState(() => weekStart(localDay(new Date().toISOString(), tz)));
  const [sheet, setSheet] = useState<Timesheet | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const from = new Date(`${addDays(week, -1)}T00:00:00Z`).toISOString(), to = new Date(`${addDays(week, 8)}T00:00:00Z`).toISOString();
    api<Timesheet>(`/api/team/time?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`).then((r) => {
      if (!live) return;
      if (!r.ok) { setErr(r.message); return; }
      setErr(null);
      setSheet({ ...r.data, entries: r.data.entries.filter((e) => weekStart(localDay(e.clockIn, tz)) === week) });
    });
    return () => { live = false; };
  }, [week, tz]);
  const rule = a.settings.overtimeRule;
  const rows = sheet ? payrollRows(sheet.entries, tz, rule, { exempt: sheet.exempt, signoffs: sheet.signoffs, rates: sheet.rates }) : [];
  const includeCost = sheet ? Object.keys(sheet.rates).length > 0 : false;
  const flagged = sheet?.entries.filter((e: TimeEntry) => e.reviewFlag && e.status !== "approved").length ?? 0;
  return (
    <div className="space-y-3" data-testid="gps-payroll">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => setWeek(addDays(week, -7))} aria-label="Previous week">‹</Button>
        <span className="text-sm font-semibold">Week of {new Date(`${week}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}</span>
        <Button size="sm" variant="secondary" onClick={() => setWeek(addDays(week, 7))} aria-label="Next week">›</Button>
        <span className="text-xs text-muted">Overtime rule: {OVERTIME_RULES.find((r) => r.value === rule)?.label}</span>
      </div>
      {err && <Notice tone="danger">{err}</Notice>}
      {flagged > 0 && <Notice tone="warn">{flagged} entr{flagged === 1 ? "y was" : "ies were"} recorded automatically and need a look (travel or automatic clock-out). Approve or fix them in <Link href="/projects/team/time" className="underline">Employees &amp; time</Link>. They&apos;re included below either way.</Notice>}
      {sheet && (
        <>
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="bg-paper text-xs uppercase tracking-wide text-muted"><tr><th className="px-3 py-2">Employee</th><th className="px-3 py-2">Total</th><th className="px-3 py-2">Regular</th><th className="px-3 py-2">OT</th><th className="px-3 py-2">DT</th><th className="px-3 py-2">Travel</th><th className="px-3 py-2">Approved</th><th className="px-3 py-2">Confirmed by employee</th></tr></thead>
              <tbody className="divide-y divide-line">
                {rows.length === 0 ? <tr><td className="px-3 py-3 text-muted" colSpan={8}>No time this week.</td></tr> : rows.map((r) => (
                  <tr key={r.resourceId}><td className="px-3 py-2 font-semibold">{names[r.resourceId] ?? "Employee"}</td><td className="px-3 py-2">{r.total.toFixed(2)}</td><td className="px-3 py-2">{r.regular.toFixed(2)}</td>
                    <td className="px-3 py-2">{r.overtime.toFixed(2)}</td><td className="px-3 py-2">{r.double.toFixed(2)}</td><td className="px-3 py-2">{r.travel.toFixed(2)}</td><td className="px-3 py-2">{r.approved.toFixed(2)}</td>
                    <td className="px-3 py-2">{r.signedOffAt ? fmtDate(r.signedOffAt) : "—"}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => download(`payroll-${week}.csv`, payrollCsvV2(rows, names, rule, includeCost))} disabled={rows.length === 0} data-testid="gps-export-payroll"><Download className="h-4 w-4" aria-hidden />Payroll CSV</Button>
            <Button size="sm" variant="secondary" onClick={() => download(`time-detail-${week}.csv`, timeDetailCsv(sheet.entries, names, sheet.projects, sheet.locations ?? {}, tz))} disabled={sheet.entries.length === 0}><Download className="h-4 w-4" aria-hidden />Every entry (CSV)</Button>
          </div>
          <p className="text-xs text-muted">Hours for whoever runs your payroll. Built2Bid doesn&apos;t calculate pay or taxes. Lunch is never deducted automatically: only unpaid breaks that were actually recorded come off. Overtime follows the rule in Settings; check it matches your state.</p>
        </>
      )}
    </div>
  );
}

// -------------------------------------------------------------------------------------------------------------------
function SettingsForm({ a, post }: { a: GpsAdmin; post: (b: Record<string, unknown>, t: string) => Promise<boolean> }) {
  const [s, setS] = useState<GpsSettings>(a.settings);
  const [ack, setAck] = useState(Boolean(a.settings.disclosureAckAt));
  const set = (p: Partial<GpsSettings>) => setS({ ...s, ...p });
  const num = (v: string, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(Number(v) || lo)));
  async function save() {
    await post({ action: "settings", disclosureAck: ack, disclosureExtra: s.disclosureExtra ?? "", defaultRadiusM: s.defaultRadiusM, entryDwellMin: s.entryDwellMin, exitGraceMin: s.exitGraceMin,
      entryAction: s.entryAction, exitAction: s.exitAction, startRule: s.startRule, workDays: s.workDays, workStart: s.workStart, workEnd: s.workEnd, earlyMin: s.earlyMin,
      travelWindowMin: s.travelWindowMin, maxAccuracyM: s.maxAccuracyM, overtimeRule: s.overtimeRule, timezone: s.timezone, retentionDays: s.retentionDays }, "Settings saved.");
  }
  return (
    <div className="space-y-5" data-testid="gps-settings">
      <section className="grid gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-2">
        <h2 className="text-lg font-extrabold text-navy sm:col-span-2"><Clock className="mr-1 inline h-5 w-5 text-accent-ink" aria-hidden />Arriving and leaving</h2>
        <label className="block"><span className="label">Stay this long before clocking in (minutes)</span><input type="number" className="field" min={1} max={30} value={s.entryDwellMin} onChange={(e) => set({ entryDwellMin: num(e.target.value, 1, 30) })} />
          <span className="mt-1 block text-xs text-muted">Stops drive-bys from clocking anyone in. 3-5 minutes works for most crews.</span></label>
        <label className="block"><span className="label">Away this long before it counts as leaving (minutes)</span><input type="number" className="field" min={2} max={60} value={s.exitGraceMin} onChange={(e) => set({ exitGraceMin: num(e.target.value, 2, 60) })} /></label>
        <label className="block"><span className="label">On arrival</span><select className="field" value={s.entryAction} onChange={(e) => set({ entryAction: e.target.value as GpsSettings["entryAction"] })}>
          <option value="auto">Clock in automatically</option><option value="ask">Ask the employee first</option></select></label>
        <label className="block"><span className="label">When someone leaves</span><select className="field" value={s.exitAction} onChange={(e) => set({ exitAction: e.target.value as GpsSettings["exitAction"] })} data-testid="gps-exit-action">
          <option value="ask">Ask if they&apos;re still working (recommended)</option><option value="auto">Clock out automatically at the time they left</option></select>
          <span className="mt-1 block text-xs text-muted">Crews leave for supplies, other jobs and paid errands. “Ask” keeps the clock running until they answer. Automatic clock-outs are flagged for your review.</span></label>
        <label className="block"><span className="label">Default geofence radius (m)</span><input type="number" className="field" min={30} max={322} value={s.defaultRadiusM} onChange={(e) => set({ defaultRadiusM: num(e.target.value, 30, 322) })} />
          <span className="mt-1 block text-xs text-muted">Maximum 322 m (0.2 mi).</span></label>
        <label className="block"><span className="label">Ignore GPS readings less accurate than (m)</span><input type="number" className="field" min={20} max={500} value={s.maxAccuracyM} onChange={(e) => set({ maxAccuracyM: num(e.target.value, 20, 500) })} /></label>
        <label className="block"><span className="label">Count travel between two sites up to (minutes)</span><input type="number" className="field" min={10} max={240} value={s.travelWindowMin} onChange={(e) => set({ travelWindowMin: num(e.target.value, 10, 240) })} />
          <span className="mt-1 block text-xs text-muted">Drive time between assigned sites is kept as paid travel (flagged for review), never treated as commuting.</span></label>
      </section>

      <section className="grid gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-2">
        <h2 className="text-lg font-extrabold text-navy sm:col-span-2"><Settings2 className="mr-1 inline h-5 w-5 text-accent-ink" aria-hidden />Work hours</h2>
        <label className="block sm:col-span-2"><span className="label">Clock in automatically</span><select className="field" value={s.startRule} onChange={(e) => set({ startRule: e.target.value as GpsSettings["startRule"] })}>
          <option value="schedule">Only during work hours or on scheduled project days; otherwise ask</option><option value="any_time">Any time they arrive at an assigned site</option></select>
          <span className="mt-1 block text-xs text-muted">Outside these hours the employee is asked “Start your shift?” instead. Work outside a shift can always be recorded.</span></label>
        <fieldset className="sm:col-span-2"><legend className="label">Work days</legend><div className="flex flex-wrap gap-2">{WEEKDAYS.map((d) => (
          <label key={d.n} className={`inline-flex min-h-10 cursor-pointer items-center gap-1 rounded-lg border px-3 text-sm ${s.workDays.includes(d.n) ? "border-accent-ink bg-accent-tint font-semibold" : "border-line"}`}>
            <input type="checkbox" className="sr-only" checked={s.workDays.includes(d.n)} onChange={(e) => set({ workDays: e.target.checked ? [...s.workDays, d.n].sort() : s.workDays.filter((x) => x !== d.n) })} />{d.short}</label>))}</div></fieldset>
        <label className="block"><span className="label">Start</span><input type="time" className="field" value={s.workStart} onChange={(e) => set({ workStart: e.target.value })} /></label>
        <label className="block"><span className="label">End</span><input type="time" className="field" value={s.workEnd} onChange={(e) => set({ workEnd: e.target.value })} /></label>
        <label className="block"><span className="label">Allow arriving early by (minutes)</span><input type="number" className="field" min={0} max={180} value={s.earlyMin} onChange={(e) => set({ earlyMin: num(e.target.value, 0, 180) })} /></label>
        <label className="block"><span className="label">Time zone</span><select className="field" value={s.timezone} onChange={(e) => set({ timezone: e.target.value })}>
          {[...new Set([s.timezone, ...COMMON_TIMEZONES])].map((z) => <option key={z} value={z}>{z.replace("_", " ")}</option>)}</select></label>
        <label className="block sm:col-span-2"><span className="label">Overtime rule for exports</span><select className="field" value={s.overtimeRule} onChange={(e) => set({ overtimeRule: e.target.value as GpsSettings["overtimeRule"] })}>
          {OVERTIME_RULES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select>
          <span className="mt-1 block text-xs text-muted">Used to split regular and overtime hours in the payroll export. Check your state&apos;s rules; Built2Bid doesn&apos;t calculate pay.</span></label>
      </section>

      <section className="space-y-3 rounded-xl border border-line bg-surface p-4">
        <h2 className="text-lg font-extrabold text-navy"><ShieldCheck className="mr-1 inline h-5 w-5 text-accent-ink" aria-hidden />Privacy and employee notice</h2>
        <label className="block"><span className="label">Delete arrival/departure events after (days)</span><input type="number" className="field max-w-[10rem]" min={30} max={365} value={s.retentionDays} onChange={(e) => set({ retentionDays: num(e.target.value, 30, 365) })} />
          <span className="mt-1 block text-xs text-muted">Hours on timesheets are kept; only the location events are deleted.</span></label>
        <label className="block"><span className="label">Anything your company adds to the notice (optional)</span><textarea className="field min-h-20" maxLength={2000} value={s.disclosureExtra ?? ""} onChange={(e) => set({ disclosureExtra: e.target.value })} />
          <span className="mt-1 block text-xs text-muted">Changing this asks every employee to read and accept the notice again.</span></label>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={ack} onChange={(e) => setAck(e.target.checked)} data-testid="gps-ack" />
          <span>I&apos;ve told my employees how GPS time tracking works, what is recorded, who can see it, and that they can use the manual clock instead. Some states require written notice or consent before tracking employee location; check yours.</span></label>
      </section>
      {a.isOwner && a.companyId && <Supervisors a={a} post={post} />}
      <Button onClick={save} data-testid="gps-save-settings">Save settings</Button>
    </div>
  );
}

function Supervisors({ a, post }: { a: GpsAdmin; post: (b: Record<string, unknown>, t: string) => Promise<boolean> }) {
  return (
    <section className="space-y-2 rounded-xl border border-line bg-surface p-4">
      <h2 className="text-lg font-extrabold text-navy"><Users className="mr-1 inline h-5 w-5 text-accent-ink" aria-hidden />Who can see location events</h2>
      <p className="text-sm text-ink-soft"><strong>Time admins</strong> set up GPS time tracking. <strong>Supervisors</strong> see arrivals/departures and exceptions and approve corrections. Everyone else who manages the team can still approve hours but doesn&apos;t see location events.</p>
      {a.supervisors.length === 0 ? <p className="text-sm text-muted">Invite people in Team &amp; Access first.</p> : (
        <ul className="divide-y divide-line text-sm">{a.supervisors.map((m) => (
          <li key={m.userId} className="flex flex-wrap items-center gap-2 py-2"><span className="mr-auto font-semibold">{m.name}</span>
            <select className="field max-w-[12rem]" value={m.role ?? ""} aria-label={`Time tracking role for ${m.name}`}
              onChange={(e) => post({ action: "supervisor", userId: m.userId, role: e.target.value || null }, "Saved.")}>
              <option value="">No access to location events</option><option value="supervisor">Supervisor</option><option value="admin">Time admin</option>
            </select></li>
        ))}</ul>
      )}
    </section>
  );
}
