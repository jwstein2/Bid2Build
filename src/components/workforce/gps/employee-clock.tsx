"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BellRing, Clock, LocateFixed, LogIn, LogOut, MapPin, Pause, Play, ShieldCheck, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Notice } from "@/components/ui/misc";
import { api } from "@/components/schedule/client";
import { addDays, entryHours, fmtHours, localDay, TIME_SOURCE_LABEL, TIME_STATUS_LABEL, weekStart, WORK_TYPE_LABEL, type Timesheet, type TimeEntry, type WorkType } from "@/lib/team/records";
import { clientEventId, GeofenceTracker, type GeoEvent } from "@/lib/workforce/gps/geofence";
import { disclosureText, type Correction, type MyStaff, type MyStatus, type Permission } from "@/lib/workforce/gps/model";

type Project = { id: string; name: string };
type Data = { status: MyStatus; corrections: Correction[] };
type EventReply = { ok: true; outcome: string; message?: string | null; prompt?: "start_shift" | "left_site" | null; locationName?: string; entry: TimeEntry | null };
const hm = (iso: string | null | undefined, tz: string) => (iso ? new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso)) : "—");
const dayTime = (iso: string | null | undefined, tz: string) => (iso ? new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso)) : "—");
const toLocalInput = (iso: string) => { const d = new Date(iso); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const appMode = (): "pwa" | "browser" => {
  if (typeof window === "undefined") return "browser";
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.("(display-mode: standalone)").matches || nav.standalone ? "pwa" : "browser";
};
const QUEUE_KEY = "b2b-gps-queue";
type Queued = { body: Record<string, unknown>; tries: number };
const readQueue = (): Queued[] => { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]") as Queued[]; } catch { return []; } };
const writeQueue = (q: Queued[]) => { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-50))); } catch { /* storage off: events just aren't retried */ } };

function notify(text: string) {
  try { navigator.vibrate?.(200); } catch { /* not supported */ }
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.visibilityState !== "visible") new Notification("Built2Bid", { body: text, tag: "b2b-clock" });
  } catch { /* iPhone web pages can't show this; the on-screen banner covers it */ }
}

/**
 * Employee time clock (V8.2). Manual Clock in / Clock out always works. When the company turned on automatic GPS
 * time tracking for this person and they accepted the notice, the screen watches location only while it is open
 * and sends arrive / stay / leave events for their assigned sites. It says plainly that nothing runs once the
 * phone puts the page in the background.
 */
export function EmployeeClock({ initial, projects }: { initial: Data; projects: Project[] }) {
  const [data, setData] = useState<Data>(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const reload = useCallback(async () => {
    const r = await api<Data>("/api/workforce/gps/me");
    if (r.ok) setData(r.data);
  }, []);
  const tz = data.status.settings.timezone;
  if (data.status.me.length === 0) {
    return <Notice title="You're not set up on the time clock yet">Ask your company admin to add you as Staff in Team &amp; Subcontractors and link your login.</Notice>;
  }
  return (
    <div className="space-y-5" data-testid="employee-clock">
      {msg && <Notice tone={msg.ok ? "ok" : "danger"}>{msg.text}</Notice>}
      {data.status.me.map((m) => (
        <StaffClock key={m.resourceId} me={m} status={data.status} tz={tz} projects={projects} corrections={data.corrections.filter((c) => c.resourceId === m.resourceId)}
          reload={reload} say={(ok, text) => setMsg({ ok, text })} />
      ))}
    </div>
  );
}

function StaffClock({ me, status, tz, projects, corrections, reload, say }: { me: MyStaff; status: MyStatus; tz: string; projects: Project[]; corrections: Correction[]; reload: () => Promise<void>; say: (ok: boolean, t: string) => void }) {
  const open = me.open;
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(t); }, []);
  const [prompt, setPrompt] = useState<{ kind: "start_shift"; ev: GeoEvent; name: string } | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const post = useCallback(async (body: Record<string, unknown>) => api<EventReply & { data?: unknown }>("/api/workforce/gps/me", { method: "POST", body: JSON.stringify(body) }), []);

  // ---- manual clock ---------------------------------------------------------------------------------------------
  const [loc, setLoc] = useState(open?.locationId ?? "");
  const [workType, setWorkType] = useState<WorkType>("regular");
  const [unpaid, setUnpaid] = useState(0);
  const [paid, setPaid] = useState(0);
  const [busy, setBusy] = useState(false);
  async function manual() {
    setBusy(true);
    const r = open
      ? await post({ action: "clock_out", entryId: open.id, breakMinutes: unpaid, paidBreakMinutes: paid })
      : await post({ action: "clock_in", resourceId: me.resourceId, locationId: loc || null, workType });
    setBusy(false);
    if (!r.ok) { say(false, r.message); return; }
    setUnpaid(0); setPaid(0);
    say(true, open ? `Clocked out: ${fmtHours(entryHours(r.data.entry!))}. Waiting for approval.` : `Clocked in${loc ? ` — ${me.choices.find((c) => c.id === loc)?.name ?? ""}` : ""}.`);
    await reload();
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-line bg-surface p-4" data-testid="clock-status-card">
        <p className="flex items-center gap-2 text-lg font-extrabold text-navy"><Clock className="h-5 w-5 text-accent-ink" aria-hidden />{me.name}</p>
        <p className="mt-1 text-sm" data-testid="clock-state">
          {open ? <><Badge tone="accent">Clocked in</Badge> {open.locationId ? `at ${me.choices.find((c) => c.id === open.locationId)?.name ?? "work"}` : ""} since {hm(open.clockIn, tz)} · {fmtHours(entryHours(open, now))} <span className="text-muted">({TIME_SOURCE_LABEL[open.source]})</span></>
            : <Badge>Clocked out</Badge>}
        </p>
        {banner && <p className="mt-2 rounded-lg bg-accent-tint px-3 py-2 text-sm font-semibold text-navy" role="status" data-testid="clock-banner"><BellRing className="mr-1 inline h-4 w-4" aria-hidden />{banner}</p>}
        {open?.awaySince && (
          <div className="mt-3 rounded-lg border border-warn/40 bg-warn-tint p-3 text-sm" data-testid="away-prompt">
            <p className="font-semibold">You left the site at {hm(open.awaySince, tz)}. Are you still working?</p>
            <p className="text-ink-soft">Picking up materials, a supplier run or driving to another job is work time.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" onClick={async () => { const r = await post({ action: "resolve", entryId: open.id, answer: "working" }); if (!r.ok) say(false, r.message); else { say(true, "Still on the clock."); await reload(); } }}>Still working</Button>
              <Button size="sm" variant="secondary" onClick={async () => { const r = await post({ action: "resolve", entryId: open.id, answer: "clock_out" }); if (!r.ok) say(false, r.message); else { say(true, `Clocked out at ${hm(open.awaySince, tz)}.`); await reload(); } }}>Clock out at {hm(open.awaySince, tz)}</Button>
            </div>
          </div>
        )}
        {prompt && !open && (
          <div className="mt-3 rounded-lg border border-accent-ink/40 bg-accent-tint p-3 text-sm" data-testid="start-prompt">
            <p className="font-semibold">You&apos;re at {prompt.name}. Start your shift?</p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" onClick={async () => {
                const r = await post({ action: "event", resourceId: me.resourceId, ...prompt.ev, kind: "dwell", occurredAt: new Date().toISOString(), confirmed: true, source: appMode(), clientEventId: `${me.resourceId}:confirm:${Date.now()}` });
                setPrompt(null);
                if (!r.ok) { say(false, r.message); return; }
                if (r.data.message) { setBanner(r.data.message); notify(r.data.message); }
                await reload();
              }}>Start my shift</Button>
              <Button size="sm" variant="ghost" onClick={() => setPrompt(null)}>Not now</Button>
            </div>
          </div>
        )}
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {!open && (
            <>
              <label className="block"><span className="label">Where</span>
                <select className="field" value={loc} onChange={(e) => setLoc(e.target.value)} data-testid="clock-location-select">
                  <option value="">Somewhere else / not listed</option>
                  {me.choices.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select></label>
              <label className="block"><span className="label">Type of work</span>
                <select className="field" value={workType} onChange={(e) => setWorkType(e.target.value as WorkType)}>
                  {(Object.keys(WORK_TYPE_LABEL) as WorkType[]).map((w) => <option key={w} value={w}>{WORK_TYPE_LABEL[w]}</option>)}
                </select></label>
            </>
          )}
          {open && (
            <>
              <label className="block"><span className="label">Unpaid break taken (minutes)</span><input type="number" min={0} max={720} className="field" value={unpaid} onChange={(e) => setUnpaid(Math.max(0, Math.min(720, Number(e.target.value) || 0)))} /></label>
              <label className="block"><span className="label">Paid break taken (minutes)</span><input type="number" min={0} max={720} className="field" value={paid} onChange={(e) => setPaid(Math.max(0, Math.min(720, Number(e.target.value) || 0)))} /></label>
            </>
          )}
        </div>
        <Button className="mt-3 w-full sm:w-auto" size="lg" variant={open ? "secondary" : "primary"} onClick={manual} disabled={busy} data-testid="manual-punch">
          {open ? <><LogOut className="h-5 w-5" aria-hidden />Clock out</> : <><LogIn className="h-5 w-5" aria-hidden />Clock in</>}
        </Button>
        <p className="mt-2 text-xs text-muted">Nothing is deducted automatically. Only breaks you enter here come off your hours.</p>
      </section>

      <GpsCard me={me} status={status} post={post} reload={reload} say={say} setBanner={setBanner} onPrompt={(ev, name) => setPrompt({ kind: "start_shift", ev, name })} />
      <MyWeek me={me} tz={tz} projects={projects} corrections={corrections} post={post} reload={reload} say={say} />
    </div>
  );
}

// -------------------------------------------------------------------------------------------------------------------
function GpsCard({ me, status, post, reload, say, setBanner, onPrompt }: {
  me: MyStaff; status: MyStatus; post: (b: Record<string, unknown>) => Promise<{ ok: true; data: EventReply } | { ok: false; message: string }>;
  reload: () => Promise<void>; say: (ok: boolean, t: string) => void; setBanner: (t: string) => void; onPrompt: (ev: GeoEvent, name: string) => void;
}) {
  const s = status.settings;
  const needsConsent = me.enrolled && s.enabled && (!me.consentAt || (me.consentVersion ?? 0) < s.disclosureVersion);
  const [running, setRunning] = useState(false);
  const [perm, setPerm] = useState<Permission>(me.permission);
  const [last, setLast] = useState<{ accuracyM: number; at: number } | null>(null);
  const [near, setNear] = useState<string | null>(null);
  const [wake, setWake] = useState(false);
  const tracker = useMemo(() => new GeofenceTracker({ dwellMin: s.entryDwellMin, graceMin: s.exitGraceMin, maxAccuracyM: s.maxAccuracyM }), [s.entryDwellMin, s.exitGraceMin, s.maxAccuracyM]);
  useEffect(() => { tracker.setSites(me.locations.map((l) => ({ id: l.id, name: l.name, lat: l.lat, lng: l.lng, radiusM: l.radiusM }))); }, [tracker, me.locations]);
  const names = useMemo(() => Object.fromEntries(me.locations.map((l) => [l.id, l.name])), [me.locations]);
  const sending = useRef(false);

  const report = useCallback((p: Permission) => {
    setPerm(p);
    void post({ action: "device", resourceId: me.resourceId, permission: p, appMode: appMode(), device: navigator.userAgent.includes("iPhone") ? "iPhone" : /Android/.test(navigator.userAgent) ? "Android" : "Other" });
  }, [post, me.resourceId]);

  const flush = useCallback(async () => {
    if (sending.current) return;
    sending.current = true;
    try {
      let q = readQueue();
      while (q.length) {
        const item = q[0];
        const r = await post(item.body);
        if (!r.ok && (r as { status?: number }).status === 0 && item.tries < 20) { q[0] = { ...item, tries: item.tries + 1 }; writeQueue(q); break; } // offline: retry later
        q = q.slice(1); writeQueue(q);
        if (r.ok) {
          const d = r.data;
          if (d.prompt === "start_shift") onPrompt({ kind: "dwell", locationId: String(item.body.locationId), occurredAt: String(item.body.occurredAt), accuracyM: Number(item.body.accuracyM), distanceM: Number(item.body.distanceM) }, d.locationName ?? "work");
          if (d.message && d.outcome !== "asked") { setBanner(d.message); notify(d.message); }
          if (d.prompt === "left_site" && d.message) notify(d.message);
          if (["clocked_in", "clocked_out", "transferred", "asked", "confirmed", "returned"].includes(d.outcome)) await reload();
        }
      }
    } finally { sending.current = false; }
  }, [post, reload, setBanner, onPrompt]);

  const onEvents = useCallback((evs: GeoEvent[]) => {
    if (!evs.length) return;
    writeQueue([...readQueue(), ...evs.map((e) => ({ body: { action: "event", resourceId: me.resourceId, source: appMode(), clientEventId: clientEventId(e), ...e }, tries: 0 }))]);
    void flush();
  }, [flush, me.resourceId]);

  // Watch location only while running (this screen open, GPS active for this person, the employee didn't pause it).
  useEffect(() => {
    if (!running || !me.active || !navigator.geolocation) return;
    const handle = (p: GeolocationPosition) => {
      setLast({ accuracyM: p.coords.accuracy, at: p.timestamp });
      if (perm !== "granted") report("granted");
      const evs = tracker.feed({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy, at: Date.now() });
      const snap = tracker.snapshot();
      const inside = Object.entries(snap).find(([, st]) => st === "in");
      setNear(inside ? names[inside[0]] ?? null : null);
      onEvents(evs);
    };
    const onErr = (e: GeolocationPositionError) => { if (e.code === e.PERMISSION_DENIED) { report("denied"); setRunning(false); } };
    const id = navigator.geolocation.watchPosition(handle, onErr, { enableHighAccuracy: true, maximumAge: 15_000, timeout: 30_000 });
    // Phones don't always report when you're standing still: ask once a minute too.
    const t = setInterval(() => navigator.geolocation.getCurrentPosition(handle, onErr, { enableHighAccuracy: true, maximumAge: 30_000, timeout: 30_000 }), 60_000);
    const online = () => void flush();
    window.addEventListener("online", online);
    return () => { navigator.geolocation.clearWatch(id); clearInterval(t); window.removeEventListener("online", online); };
  }, [running, me.active, tracker, names, onEvents, perm, report, flush]);

  // Start automatically when opened if location is already allowed; report permission status either way.
  useEffect(() => {
    if (!me.active) return;
    if (!navigator.geolocation) { queueMicrotask(() => report("unavailable")); return; }
    let cancelled = false;
    navigator.permissions?.query({ name: "geolocation" as PermissionName }).then((st) => {
      if (cancelled) return;
      const p = st.state as Permission;
      report(p);
      if (p === "granted") setRunning(true);
      st.onchange = () => report(st.state as Permission);
    }).catch(() => { /* Older Safari: wait for the Start button */ });
    void flush();
    return () => { cancelled = true; };
  }, [me.active, report, flush]);

  // Keep the screen on while running, when the phone supports it (so the page isn't suspended by auto-lock).
  useEffect(() => {
    if (!wake || !running) return;
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    const get = () => nav.wakeLock?.request("screen").then((l) => { lock = l; }).catch(() => setWake(false));
    void get();
    const vis = () => { if (document.visibilityState === "visible") void get(); };
    document.addEventListener("visibilitychange", vis);
    return () => { document.removeEventListener("visibilitychange", vis); void lock?.release(); };
  }, [wake, running]);

  if (!s.enabled || !me.enrolled) {
    return (
      <section className="rounded-xl border border-line bg-surface p-4 text-sm" data-testid="gps-card">
        <p className="font-semibold text-navy"><LocateFixed className="mr-1 inline h-4 w-4 text-accent-ink" aria-hidden />Automatic GPS clock-in is off for you</p>
        <p className="mt-1 text-ink-soft">Use the Clock in and Clock out buttons. Your company decides whether to use automatic GPS time tracking.</p>
      </section>
    );
  }
  if (needsConsent) {
    return (
      <section className="space-y-3 rounded-xl border border-accent-ink/40 bg-surface p-4 text-sm" data-testid="gps-consent">
        <p className="text-lg font-extrabold text-navy"><ShieldCheck className="mr-1 inline h-5 w-5 text-accent-ink" aria-hidden />Automatic clock-in with GPS</p>
        <ul className="list-disc space-y-1.5 pl-5">{disclosureText(status.companyName, { entryDwellMin: s.entryDwellMin, exitGraceMin: s.exitGraceMin, exitAction: s.exitAction, retentionDays: s.retentionDays }).map((t) => <li key={t}>{t}</li>)}</ul>
        {s.disclosureExtra && <p className="whitespace-pre-line rounded bg-paper px-3 py-2"><span className="font-semibold">From {status.companyName ?? "your company"}:</span> {s.disclosureExtra}</p>}
        <div className="flex flex-wrap gap-2">
          <Button onClick={async () => { const r = await post({ action: "consent", resourceId: me.resourceId, agree: true, version: s.disclosureVersion }); if (!r.ok) say(false, r.message); else { say(true, "Thanks. Allow location when your phone asks."); await reload(); } }} data-testid="gps-agree">I agree</Button>
          <Button variant="ghost" onClick={async () => { await post({ action: "consent", resourceId: me.resourceId, agree: false, version: s.disclosureVersion }); say(true, "No problem. Use the Clock in and Clock out buttons."); await reload(); }}>No thanks, I&apos;ll clock in by hand</Button>
        </div>
      </section>
    );
  }
  if (!me.active) {
    return (
      <section className="rounded-xl border border-line bg-surface p-4 text-sm" data-testid="gps-card">
        <p className="font-semibold text-navy">Automatic GPS clock-in is turned off</p>
        <p className="mt-1 text-ink-soft">You turned it off. Use the buttons above, or turn it back on.</p>
        <Button className="mt-2" size="sm" variant="secondary" onClick={async () => { const r = await post({ action: "consent", resourceId: me.resourceId, agree: true, version: s.disclosureVersion }); if (!r.ok) say(false, r.message); else await reload(); }}>Turn it back on</Button>
      </section>
    );
  }
  return (
    <section className="space-y-3 rounded-xl border border-line bg-surface p-4 text-sm" data-testid="gps-card">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-lg font-extrabold text-navy"><LocateFixed className="mr-1 inline h-5 w-5 text-accent-ink" aria-hidden />Automatic clock-in</p>
        <Badge tone={running ? "ok" : perm === "denied" ? "danger" : "neutral"} >{running ? "On while this screen is open" : perm === "denied" ? "Location blocked" : "Paused"}</Badge>
      </div>
      {perm === "denied" ? (
        <Notice tone="warn" title="Location is blocked for Built2Bid">Use the Clock in and Clock out buttons, or allow location for built2bid.org in your phone&apos;s settings (iPhone: Settings → Privacy &amp; Security → Location Services → Safari Websites; Android: Chrome → Site settings → Location) and come back.</Notice>
      ) : perm === "unavailable" ? (
        <Notice tone="warn">This device can&apos;t share its location. Use the Clock in and Clock out buttons.</Notice>
      ) : (
        <div className="flex flex-wrap gap-2">
          {running
            ? <Button size="sm" variant="secondary" onClick={() => setRunning(false)}><Pause className="h-4 w-4" aria-hidden />Pause</Button>
            : <Button size="sm" onClick={() => { setRunning(true); if (typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission().catch(() => {}); }} data-testid="gps-start"><Play className="h-4 w-4" aria-hidden />{perm === "granted" ? "Start" : "Allow location and start"}</Button>}
          {running && "wakeLock" in navigator && (
            <label className="inline-flex min-h-9 items-center gap-2"><input type="checkbox" checked={wake} onChange={(e) => setWake(e.target.checked)} />Keep screen on</label>
          )}
        </div>
      )}
      {running && <p data-testid="gps-live">{near ? <>At <strong>{near}</strong>.</> : "Not at an assigned site."} {last ? <span className="text-muted">GPS ±{Math.round(last.accuracyM)} m{last.accuracyM > s.maxAccuracyM ? " (too weak to use right now)" : ""}.</span> : <span className="text-muted">Waiting for GPS…</span>}</p>}
      <div>
        <p className="font-semibold">Your sites today</p>
        {me.locations.length === 0 ? <p className="text-ink-soft">You aren&apos;t assigned to a site today. Clock in by hand.</p>
          : <ul className="mt-1 space-y-0.5">{me.locations.map((l) => <li key={l.id}><MapPin className="mr-1 inline h-3.5 w-3.5 text-accent-ink" aria-hidden />{l.name}</li>)}</ul>}
      </div>
      <Notice title="Keep Built2Bid open on screen">
        <Smartphone className="mr-1 inline h-4 w-4" aria-hidden />Phones pause web pages when you switch apps, lock the screen or close the browser. Automatic clock-in and clock-out only happen while this screen is open; anything that happened while it was closed isn&apos;t recorded. If you forget, clock in or out by hand or ask for a fix below.
      </Notice>
      <p className="text-xs text-muted">Only arrivals and departures at your work sites are saved, with distance and GPS accuracy. No trail of where you go. <button type="button" className="underline" onClick={async () => { setRunning(false); await post({ action: "consent", resourceId: me.resourceId, agree: false, version: s.disclosureVersion }); say(true, "Automatic clock-in is off. Use the buttons above."); await reload(); }}>Turn off automatic clock-in</button></p>
    </section>
  );
}

// -------------------------------------------------------------------------------------------------------------------
function MyWeek({ me, tz, projects, corrections, post, reload, say }: { me: MyStaff; tz: string; projects: Project[]; corrections: Correction[]; post: (b: Record<string, unknown>) => Promise<{ ok: true; data: EventReply } | { ok: false; message: string }>; reload: () => Promise<void>; say: (ok: boolean, t: string) => void }) {
  const [week, setWeek] = useState(() => weekStart(localDay(new Date().toISOString(), tz)));
  const [sheet, setSheet] = useState<Timesheet | null>(null);
  const [fix, setFix] = useState<{ entryId: string | null; clockIn: string; clockOut: string; breakMinutes: number; workType: WorkType; locationId: string; scheduleId: string; reason: string } | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    const from = new Date(`${addDays(week, -1)}T00:00:00Z`).toISOString(), to = new Date(`${addDays(week, 8)}T00:00:00Z`).toISOString();
    api<Timesheet>(`/api/team/time?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`).then((r) => {
      if (live && r.ok) setSheet({ ...r.data, entries: r.data.entries.filter((e) => e.resourceId === me.resourceId && weekStart(localDay(e.clockIn, tz)) === week) });
    });
    return () => { live = false; };
  }, [week, tz, me.resourceId, n, me.open?.id]);
  const total = sheet?.entries.filter((e) => e.status !== "rejected").reduce((s, e) => s + entryHours(e), 0) ?? 0;
  const signed = sheet?.signoffs?.find((x) => x.resourceId === me.resourceId && x.week === week);
  const pendingFor = new Set(corrections.filter((c) => c.status === "pending" && c.entryId).map((c) => c.entryId));
  async function submitFix() {
    if (!fix) return;
    const r = await post({ action: "correction", resourceId: me.resourceId, entryId: fix.entryId, clockIn: new Date(fix.clockIn).toISOString(), clockOut: new Date(fix.clockOut).toISOString(),
      breakMinutes: fix.breakMinutes, workType: fix.workType, locationId: fix.locationId || null, scheduleId: fix.scheduleId || null, reason: fix.reason });
    if (!r.ok) { say(false, r.message); return; }
    setFix(null); say(true, "Sent to your manager. Your original time stays on record until they decide."); setN((x) => x + 1); await reload();
  }
  return (
    <section className="space-y-3" data-testid="my-week">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-xl font-extrabold text-navy">My time</h2>
        <Button size="sm" variant="secondary" onClick={() => setWeek(addDays(week, -7))} aria-label="Previous week">‹</Button>
        <span className="text-sm font-semibold">Week of {new Date(`${week}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} · {fmtHours(total)}</span>
        <Button size="sm" variant="secondary" onClick={() => setWeek(addDays(week, 7))} aria-label="Next week">›</Button>
      </div>
      {!sheet ? <p className="text-sm text-muted">Loading…</p> : sheet.entries.length === 0 ? <p className="text-sm text-muted">No time this week.</p> : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface text-sm">
          {[...sheet.entries].sort((a, b) => a.clockIn.localeCompare(b.clockIn)).map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2">
              <span className="font-semibold">{dayTime(e.clockIn, tz)} – {e.clockOut ? hm(e.clockOut, tz) : "now"}</span>
              <span>{fmtHours(entryHours(e))}</span>
              {e.locationId && sheet.locations?.[e.locationId] && <span className="text-ink-soft">{sheet.locations[e.locationId]}</span>}
              {e.workType && e.workType !== "regular" && <Badge>{WORK_TYPE_LABEL[e.workType]}</Badge>}
              <Badge tone={e.status === "approved" ? "ok" : e.status === "rejected" ? "danger" : "neutral"}>{TIME_STATUS_LABEL[e.status]}</Badge>
              <span className="ml-auto">{e.status !== "open" && (pendingFor.has(e.id) ? <span className="text-xs text-muted">Fix requested</span> :
                <Button size="sm" variant="link" onClick={() => setFix({ entryId: e.id, clockIn: toLocalInput(e.clockIn), clockOut: toLocalInput(e.clockOut ?? new Date().toISOString()), breakMinutes: e.breakMinutes, workType: e.workType ?? "regular", locationId: e.locationId ?? "", scheduleId: e.scheduleId ?? "", reason: "" })}>Request a fix</Button>)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => { const d = new Date(); d.setHours(7, 0, 0, 0); const e = new Date(d); e.setHours(15, 30); setFix({ entryId: null, clockIn: toLocalInput(d.toISOString()), clockOut: toLocalInput(e.toISOString()), breakMinutes: 0, workType: "regular", locationId: "", scheduleId: "", reason: "" }); }}>Add missing time</Button>
        {sheet && sheet.entries.length > 0 && (
          <Button size="sm" variant="secondary" disabled={Boolean(me.open)} onClick={async () => { const r = await post({ action: "signoff", resourceId: me.resourceId, week }); if (!r.ok) say(false, r.message); else { say(true, "Week confirmed. You can still ask for fixes."); setN((x) => x + 1); } }}>
            {signed ? `Confirmed ${new Date(signed.signedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · confirm again` : "My hours are right: confirm this week"}</Button>
        )}
      </div>
      {fix && (
        <div className="space-y-2 rounded-xl border border-accent-ink/40 bg-surface p-4 text-sm" data-testid="fix-form">
          <p className="font-semibold">{fix.entryId ? "Request a fix" : "Add missing time"}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block"><span className="label">Started</span><input type="datetime-local" className="field" value={fix.clockIn} onChange={(e) => setFix({ ...fix, clockIn: e.target.value })} /></label>
            <label className="block"><span className="label">Finished</span><input type="datetime-local" className="field" value={fix.clockOut} onChange={(e) => setFix({ ...fix, clockOut: e.target.value })} /></label>
            <label className="block"><span className="label">Unpaid break (minutes)</span><input type="number" min={0} max={720} className="field" value={fix.breakMinutes} onChange={(e) => setFix({ ...fix, breakMinutes: Math.max(0, Math.min(720, Number(e.target.value) || 0)) })} /></label>
            <label className="block"><span className="label">Type of work</span><select className="field" value={fix.workType} onChange={(e) => setFix({ ...fix, workType: e.target.value as WorkType })}>
              {(Object.keys(WORK_TYPE_LABEL) as WorkType[]).map((w) => <option key={w} value={w}>{WORK_TYPE_LABEL[w]}</option>)}</select></label>
            <label className="block"><span className="label">Where</span><select className="field" value={fix.locationId} onChange={(e) => setFix({ ...fix, locationId: e.target.value })}>
              <option value="">Not listed</option>{me.choices.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label className="block"><span className="label">Project</span><select className="field" value={fix.scheduleId} onChange={(e) => setFix({ ...fix, scheduleId: e.target.value })}>
              <option value="">No project</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          </div>
          <label className="block"><span className="label">What happened?</span><input className="field" maxLength={500} value={fix.reason} onChange={(e) => setFix({ ...fix, reason: e.target.value })} placeholder="e.g. Phone died, I started at 7:00" /></label>
          <div className="flex gap-2"><Button size="sm" onClick={submitFix} disabled={!fix.reason.trim()}>Send to my manager</Button><Button size="sm" variant="ghost" onClick={() => setFix(null)}>Cancel</Button></div>
        </div>
      )}
      {corrections.length > 0 && (
        <div className="space-y-1 text-sm">
          <p className="font-semibold">My requests</p>
          <ul className="space-y-1">{corrections.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2"><span>{dayTime(c.clockIn, tz)} – {hm(c.clockOut, tz)}</span>
              <Badge tone={c.status === "approved" ? "ok" : c.status === "denied" ? "danger" : "neutral"}>{c.status === "pending" ? "Waiting" : c.status[0].toUpperCase() + c.status.slice(1)}</Badge>
              {c.decisionNote && <span className="text-ink-soft">“{c.decisionNote}”</span>}
              {c.status === "pending" && <Button size="sm" variant="link" onClick={async () => { const r = await post({ action: "withdraw", id: c.id }); if (r.ok) await reload(); }}>Withdraw</Button>}</li>
          ))}</ul>
        </div>
      )}
    </section>
  );
}
