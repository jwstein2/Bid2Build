import Link from "next/link";
import { Badge, Card, Notice } from "@/components/ui/misc";
import { requireSalesRep } from "@/lib/sales/server";
import { googleConfigured, responderAllowed, SCOPES } from "@/lib/sales/google";
import { addDays, DEFAULT_OOO, EVENT_KINDS, fmtTime, fmtWhen, SESSIONS, viewDays, ymd, zonedMidnight, type CalView, type SessionId } from "@/lib/sales/calendar";
import { site } from "@/lib/site";
import { CopyField } from "@/components/sales/copy-field";
import { cancelMyBooking, cancelTimeOff, deleteCalendarEvent, disconnectGoogle, saveCalendarSettings, saveEvent, saveTimeOff } from "./actions";

export const metadata = { title: "Calendar" };

type Ev = { id: string; kind: string; title: string; description: string | null; starts_at: string; ends_at: string; all_day: boolean; lead: string | null };
type Bk = { id: string; session: SessionId; starts_at: string; ends_at: string; customer_name: string; customer_email: string; customer_company: string | null; plan: string | null; notes: string | null; reassigned: boolean };
type Tk = { id: string; title: string; due_at: string; lead: string };
type To = { id: string; starts_at: string; ends_at: string; all_day: boolean; note: string | null; customer_message: string; backup_contact: string; responder_status: string };
interface Cal {
  settings: { time_zone: string; booking_slug: string | null; booking_enabled: boolean; session_minutes: number; buffer_minutes: number; min_notice_hours: number; max_days_ahead: number; meeting_link: string | null; rules: { d: number; s: string; e: string }[] };
  events: Ev[]; bookings: Bk[]; tasks: Tk[]; time_off: To[];
  google: { connected: boolean; status: string; email: string | null; scopes: string[]; last_error: string | null } | null;
}

const input = "mt-1 min-h-11 w-full rounded-lg border border-line bg-white px-3 text-sm";
const btn = "min-h-11 rounded-lg bg-ink px-4 text-sm font-semibold text-white";
const btnLight = "min-h-11 rounded-lg border border-line bg-white px-3 text-sm font-semibold";
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu"];
const LAYERS = [["events", "My events"], ["bookings", "Client sessions"], ["tasks", "Follow-ups due"], ["timeoff", "Time off"]] as const;
const GOOGLE_MSG: Record<string, string> = {
  connected: "Google Calendar connected.", declined: "Google connection canceled.", failed: "Google connection didn't finish. Try again.",
  unavailable: "Google Calendar isn't set up for Built2Bid yet. The owner adds it in the environment settings.",
};

function nextDay() {
  const now = Date.now();
  return { p_from: new Date(now).toISOString(), p_to: new Date(now + 86_400_000).toISOString() };
}

export default async function CalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { db, rep } = await requireSalesRep();
  const tab = sp.tab === "settings" || sp.tab === "timeoff" ? sp.tab : "calendar";
  const view: CalView = sp.view === "day" || sp.view === "month" ? sp.view : "week";
  // First read gets the zone; the range is computed in it.
  const probe = await db.rpc("sales_my_calendar", nextDay());
  if (probe.error || !probe.data) return <Notice title="Your calendar is getting set up">Check back in a little while.</Notice>;
  const tz = (probe.data as Cal).settings.time_zone;
  const today = ymd(new Date(), tz);
  const anchor = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;
  const days = viewDays(view, anchor);
  const { data } = await db.rpc("sales_my_calendar", { p_from: zonedMidnight(days[0], tz).toISOString(), p_to: zonedMidnight(addDays(days[days.length - 1], 1), tz).toISOString() });
  const c = (data ?? probe.data) as Cal;
  const show = new Set((sp.show ?? "events,bookings,tasks,timeoff").split(","));
  const bookingLink = c.settings.booking_slug ? new URL(`/meet/${c.settings.booking_slug}`, site.url).toString() : null;
  const step = view === "day" ? 1 : view === "week" ? 7 : 0;
  const prev = step ? addDays(anchor, -step) : `${addDays(`${anchor.slice(0, 8)}01`, -1).slice(0, 8)}01`;
  const next = step ? addDays(anchor, step) : `${addDays(`${anchor.slice(0, 8)}28`, 7).slice(0, 8)}01`;
  const href = (q: Record<string, string>) => `/sales/calendar?${new URLSearchParams({ view, date: anchor, ...(sp.show ? { show: sp.show } : {}), ...q }).toString()}`;

  type Item = { key: string; at: string; end?: string; label: string; sub?: string; cls: string; kind: "event" | "booking" | "task" | "timeoff"; id: string; allDay?: boolean };
  const items: Item[] = [
    ...(show.has("events") ? c.events.map((e) => ({ key: `e${e.id}`, at: e.starts_at, end: e.ends_at, label: e.title, sub: EVENT_KINDS[e.kind]?.label, cls: EVENT_KINDS[e.kind]?.color ?? "", kind: "event" as const, id: e.id, allDay: e.all_day })) : []),
    ...(show.has("bookings") ? c.bookings.map((b) => ({ key: `b${b.id}`, at: b.starts_at, end: b.ends_at, label: `${SESSIONS[b.session].title}: ${b.customer_name}`, sub: b.customer_company ?? undefined, cls: "bg-emerald-50 text-emerald-900 border-emerald-400", kind: "booking" as const, id: b.id })) : []),
    ...(show.has("tasks") ? c.tasks.map((t) => ({ key: `t${t.id}`, at: t.due_at, label: t.title, sub: t.lead, cls: "bg-amber-50 text-amber-900 border-amber-300 border-dashed", kind: "task" as const, id: t.id })) : []),
  ];
  const away = (day: string) => show.has("timeoff") && c.time_off.some((t) => new Date(t.starts_at) < zonedMidnight(addDays(day, 1), tz) && new Date(t.ends_at) > zonedMidnight(day, tz));
  const onDay = (day: string) => items.filter((i) => ymd(new Date(i.at), tz) === day).sort((a, b) => a.at.localeCompare(b.at));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold">Calendar</h1>
          <p className="mt-1 text-sm text-ink-soft">Your calls, follow-ups, client sessions and time off, in {tz.replace("_", " ")}. You set your own hours. Only you see your events and notes.</p>
        </div>
        <nav className="flex gap-1 text-sm" aria-label="Calendar sections">
          {[["calendar", "Calendar"], ["settings", "Availability & booking"], ["timeoff", "Time off"]].map(([k, l]) => (
            <Link key={k} href={`/sales/calendar${k === "calendar" ? "" : `?tab=${k}`}`} aria-current={tab === k ? "page" : undefined} className={`rounded-md px-3 py-2 font-semibold ${tab === k ? "bg-ink text-white" : "border border-line bg-white"}`}>{l}</Link>
          ))}
        </nav>
      </div>
      {sp.ok && <Notice tone="ok">{sp.ok}</Notice>}
      {sp.err && <Notice tone="danger">{sp.err}</Notice>}
      {sp.google && GOOGLE_MSG[sp.google] && <Notice tone={sp.google === "connected" ? "ok" : "warn"}>{GOOGLE_MSG[sp.google]}</Notice>}
      {c.time_off.some((t) => new Date(t.starts_at) <= new Date() && new Date(t.ends_at) > new Date()) && <Notice tone="warn" title="You're marked out of office">New bookings are blocked until your time off ends. Existing sessions stay on your calendar.</Notice>}

      {tab === "calendar" && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <Link href={href({ date: prev })} className={btnLight} aria-label="Previous">‹</Link>
              <Link href={href({ date: today })} className={btnLight}>Today</Link>
              <Link href={href({ date: next })} className={btnLight} aria-label="Next">›</Link>
              <span className="ml-2 font-bold">{view === "month" ? fmtTime(`${anchor}T12:00:00Z`, "UTC", { month: "long", year: "numeric" }) : view === "week" ? `Week of ${fmtTime(`${days[0]}T12:00:00Z`, "UTC", { month: "short", day: "numeric" })}` : fmtTime(`${anchor}T12:00:00Z`, "UTC", { weekday: "long", month: "long", day: "numeric" })}</span>
            </div>
            <div className="flex gap-1 text-sm">{(["day", "week", "month"] as const).map((v) => <Link key={v} href={`/sales/calendar?${new URLSearchParams({ view: v, date: anchor })}`} aria-current={view === v ? "page" : undefined} className={`rounded-md px-3 py-2 font-semibold capitalize ${view === v ? "bg-ink text-white" : "border border-line bg-white"}`}>{v}</Link>)}</div>
          </div>
          <div className="flex flex-wrap gap-2 text-xs" aria-label="Show on calendar">
            {LAYERS.map(([k, l]) => {
              const on = show.has(k);
              const nextShow = [...LAYERS.map(([x]) => x)].filter((x) => (x === k ? !on : show.has(x))).join(",") || "none";
              return <Link key={k} href={href({ show: nextShow })} aria-pressed={on} className={`rounded-full border px-3 py-1 font-semibold ${on ? "border-ink bg-ink text-white" : "border-line bg-white text-ink-soft"}`}>{l}</Link>;
            })}
          </div>

          {view === "month" ? (
            <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-line bg-line text-xs">
              {DOW.map((d) => <div key={d} className="bg-surface p-2 font-semibold text-muted">{d}</div>)}
              {days.map((d) => {
                const list = onDay(d);
                return (
                  <Link key={d} href={`/sales/calendar?${new URLSearchParams({ view: "day", date: d })}`} className={`min-h-20 bg-white p-1.5 ${d.slice(0, 7) !== anchor.slice(0, 7) ? "opacity-50" : ""} ${away(d) ? "bg-[repeating-linear-gradient(45deg,#fff,#fff_6px,#f1f5f9_6px,#f1f5f9_12px)]" : ""}`}>
                    <span className={`font-semibold ${d === today ? "rounded bg-ink px-1 text-white" : ""}`}>{Number(d.slice(8))}</span>
                    {list.slice(0, 3).map((i) => <p key={i.key} className={`mt-0.5 truncate rounded border px-1 ${i.cls}`}>{i.allDay ? "" : `${fmtTime(i.at, tz)} `}{i.label}</p>)}
                    {list.length > 3 && <p className="text-muted">+{list.length - 3} more</p>}
                    {away(d) && <p className="text-muted">Out of office</p>}
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className={`grid gap-3 ${view === "week" ? "md:grid-cols-7" : ""}`}>
              {days.map((d, i) => (
                <Card key={d} className={`p-3 ${away(d) ? "bg-surface" : ""}`}>
                  <p className={`text-sm font-bold ${d === today ? "text-brand" : ""}`}>{view === "week" ? DOW[i] : ""} {fmtTime(`${d}T12:00:00Z`, "UTC", { month: "short", day: "numeric" })}</p>
                  {away(d) && <p className="text-xs font-semibold text-muted">Out of office</p>}
                  <ul className="mt-2 space-y-1.5">
                    {onDay(d).map((it) => (
                      <li key={it.key} className={`rounded border px-2 py-1 text-xs ${it.cls}`}>
                        <p className="font-semibold">{it.allDay ? "All day" : it.kind === "task" ? `Due ${fmtTime(it.at, tz)}` : `${fmtTime(it.at, tz)}–${fmtTime(it.end!, tz)}`}</p>
                        <p>{it.label}</p>{it.sub && <p className="opacity-75">{it.sub}</p>}
                        {view === "day" && it.kind === "event" && <form action={deleteCalendarEvent} className="mt-1"><input type="hidden" name="id" value={it.id} /><input type="hidden" name="view" value={view} /><input type="hidden" name="date" value={anchor} /><button className="underline">Remove</button></form>}
                        {view === "day" && it.kind === "booking" && (() => { const b = c.bookings.find((x) => x.id === it.id)!; return (
                          <details className="mt-1"><summary className="cursor-pointer underline">Details</summary>
                            <p>{b.customer_email}{b.plan ? ` · plan: ${b.plan}` : ""}</p>{b.notes && <p>“{b.notes}”</p>}
                            <form action={cancelMyBooking} className="mt-1 flex gap-1"><input type="hidden" name="id" value={b.id} /><input type="hidden" name="view" value={view} /><input type="hidden" name="date" value={anchor} />
                              <input name="reason" placeholder="Reason (optional)" className="rounded border border-line px-1" /><button className="underline">Cancel session</button></form>
                          </details>); })()}
                        {it.kind === "task" && <Link href="/sales/leads" className="underline">Open lead</Link>}
                      </li>
                    ))}
                    {onDay(d).length === 0 && !away(d) && <li className="text-xs text-muted">Open</li>}
                  </ul>
                </Card>
              ))}
            </div>
          )}

          <Card className="p-5">
            <h2 className="text-lg font-bold">Add to your calendar</h2>
            <form action={saveEvent} className="mt-3 grid gap-2 sm:grid-cols-6">
              <input type="hidden" name="tz" value={tz} /><input type="hidden" name="view" value={view} /><input type="hidden" name="date" value={anchor} />
              <label className="text-xs sm:col-span-2">What<input name="title" required maxLength={200} className={input} /></label>
              <label className="text-xs">Type<select name="kind" className={input}>{Object.entries(EVENT_KINDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
              <label className="text-xs">Day<input name="day" type="date" required defaultValue={anchor} className={input} /></label>
              <label className="text-xs">Start<input name="start" type="time" defaultValue="09:00" className={input} /></label>
              <label className="text-xs">End<input name="end" type="time" defaultValue="09:30" className={input} /></label>
              <label className="text-xs sm:col-span-4">Private notes<input name="description" maxLength={2000} className={input} /></label>
              <label className="flex items-center gap-2 text-sm sm:col-span-1"><input type="checkbox" name="all_day" /> All day</label>
              <div className="sm:col-span-1"><button className={btn}>Add</button></div>
            </form>
            <p className="mt-2 text-xs text-muted">Everything here blocks your booking link at that time. Personal events stay private and are never shared.</p>
          </Card>
        </>
      )}

      {tab === "settings" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="p-5">
            <h2 className="text-lg font-bold">Hours and booking link</h2>
            <form action={saveCalendarSettings} className="mt-3 grid gap-3">
              <label className="text-xs">Your time zone<select name="time_zone" defaultValue={tz} className={input}>{[...new Set([tz, ...ZONES])].map((z) => <option key={z} value={z}>{z.replace("_", " ")}</option>)}</select></label>
              <fieldset><legend className="text-sm font-semibold">Weekly hours clients can book</legend>
                {[1, 2, 3, 4, 5, 6, 7].map((d) => { const r = c.settings.rules.find((x) => x.d === d); return (
                  <div key={d} className="mt-1 grid grid-cols-[5rem_1fr_1fr] items-center gap-2 text-sm">
                    <label className="flex items-center gap-2"><input type="checkbox" name={`on_${d}`} defaultChecked={!!r} />{DOW[d - 1]}</label>
                    <input type="time" name={`s_${d}`} defaultValue={r?.s ?? "09:00"} aria-label={`${DOW[d - 1]} start`} className={input} />
                    <input type="time" name={`e_${d}`} defaultValue={r?.e ?? "17:00"} aria-label={`${DOW[d - 1]} end`} className={input} />
                  </div>); })}
              </fieldset>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs">Session length<select name="session_minutes" defaultValue={c.settings.session_minutes} className={input}>{[15, 30, 45, 60].map((m) => <option key={m} value={m}>{m} minutes</option>)}</select></label>
                <label className="text-xs">Gap between meetings (min)<input name="buffer_minutes" type="number" min={0} max={60} defaultValue={c.settings.buffer_minutes} className={input} /></label>
                <label className="text-xs">Minimum notice (hours)<input name="min_notice_hours" type="number" min={0} max={168} defaultValue={c.settings.min_notice_hours} className={input} /></label>
                <label className="text-xs">Book up to (days ahead)<input name="max_days_ahead" type="number" min={1} max={90} defaultValue={c.settings.max_days_ahead} className={input} /></label>
              </div>
              <label className="text-xs">Video meeting link (optional, added to confirmations)<input name="meeting_link" type="url" placeholder="https://meet.google.com/…" defaultValue={c.settings.meeting_link ?? ""} className={input} /></label>
              <label className="text-xs">Booking link name<input name="booking_slug" pattern="[a-z0-9][a-z0-9-]{1,38}[a-z0-9]" placeholder={rep.full_name.split(" ")[0].toLowerCase()} defaultValue={c.settings.booking_slug ?? ""} className={input} /></label>
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="booking_enabled" defaultChecked={c.settings.booking_enabled} className="mt-1" /> Let customers book Win the Job, Run the Job and Grow the Business sessions with me</label>
              <div><button className={btn}>Save availability</button></div>
            </form>
            {bookingLink && c.settings.booking_enabled && <div className="mt-4"><CopyField value={bookingLink} label="Your booking link" /></div>}
          </Card>
          <Card className="p-5">
            <h2 className="text-lg font-bold">Google Calendar</h2>
            {!googleConfigured() ? (
              <p className="mt-2 text-sm text-ink-soft">Not available yet. Once the owner sets up Google sign-in for Built2Bid, you can connect your calendar here so busy times block your booking link.</p>
            ) : c.google?.connected ? (
              <div className="mt-2 space-y-2 text-sm">
                <p><Badge tone="ok">Connected</Badge> {c.google.email}</p>
                <ul className="list-disc pl-5 text-ink-soft">
                  <li>We read only when you&apos;re busy, never event titles or details.</li>
                  <li>We add client sessions and out-of-office blocks, and only ever change those.</li>
                  {c.google.scopes.includes(SCOPES.gmail) && <li>We can set your Gmail vacation responder when you add time off.</li>}
                </ul>
                {responderAllowed() && !c.google.scopes.includes(SCOPES.gmail) && <a href="/api/sales/google/connect?gmail=1" className="font-semibold text-brand underline">Also allow the Gmail vacation responder</a>}
                <form action={disconnectGoogle}><button className={btnLight}>Disconnect</button></form>
              </div>
            ) : (
              <div className="mt-2 space-y-2 text-sm">
                {c.google && c.google.status !== "connected" && <Notice tone="warn">{c.google.last_error ?? "Google access stopped working."} Reconnect below.</Notice>}
                <p className="text-ink-soft">Connect with Google&apos;s own sign-in. You never share your password. We ask only to see busy times and to manage the events we add.</p>
                <a href="/api/sales/google/connect" className={`${btn} inline-flex items-center`}>Connect Google Calendar</a>
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === "timeoff" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="p-5">
            <h2 className="text-lg font-bold">Mark yourself out of office</h2>
            <p className="mt-1 text-xs text-muted">New bookings are blocked for the whole period. Existing sessions are never canceled; you&apos;ll see anything that needs attention. Your note stays private.</p>
            <form action={saveTimeOff} className="mt-3 grid gap-2 sm:grid-cols-2">
              <input type="hidden" name="tz" value={tz} />
              <label className="text-xs">From<input name="from" type="date" required defaultValue={today} className={input} /></label>
              <label className="text-xs">Through<input name="to" type="date" required defaultValue={today} className={input} /></label>
              <label className="text-xs">Length<select name="all_day" className={input}><option value="on">Full days</option><option value="off">Part of a day</option></select></label>
              <div className="grid grid-cols-2 gap-2"><label className="text-xs">Start time<input name="start_time" type="time" defaultValue="12:00" className={input} /></label><label className="text-xs">End time<input name="end_time" type="time" defaultValue="17:00" className={input} /></label></div>
              <label className="text-xs sm:col-span-2">Private note (only you see this)<input name="note" maxLength={500} className={input} /></label>
              <label className="text-xs sm:col-span-2">Backup contact for customers<input name="backup_contact" defaultValue="support@built2bid.org" maxLength={200} className={input} /></label>
              <label className="text-xs sm:col-span-2">Message customers see (auto-reply)<textarea name="customer_message" rows={9} maxLength={2000} defaultValue={DEFAULT_OOO(rep.full_name, "[Return Date]")} className={`${input} py-2`} /></label>
              {c.google?.scopes.includes(SCOPES.gmail) && <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" name="responder" defaultChecked className="mt-1" /> Turn on my Gmail vacation responder for these dates</label>}
              <div className="sm:col-span-2"><button className={btn}>Save time off</button></div>
            </form>
            <p className="mt-2 text-xs text-muted">Replace [Return Date] with your return date. The message never says why you&apos;re away.</p>
          </Card>
          <div className="space-y-4">
            {c.time_off.length === 0 ? <Card className="p-5 text-sm text-ink-soft">No time off scheduled.</Card> : c.time_off.map((t) => (
              <Card key={t.id} className="p-4 text-sm">
                <p className="font-semibold">{fmtWhen(t.starts_at, tz)} to {fmtWhen(t.ends_at, tz)}</p>
                {t.note && <p className="text-ink-soft">Note: {t.note}</p>}
                <p className="text-xs text-muted">Backup: {t.backup_contact} · Gmail auto-reply: {t.responder_status === "set" ? "on" : t.responder_status === "failed" ? "couldn't be set" : "not used"}</p>
                {(() => { const bs = c.bookings.filter((b) => b.starts_at < t.ends_at && b.ends_at > t.starts_at); return bs.length > 0 && (
                  <div className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs"><p className="font-semibold">Sessions during this time (not canceled):</p>{bs.map((b) => <p key={b.id}>{fmtWhen(b.starts_at, tz)} · {b.customer_name}</p>)}<p>Reschedule with the customer, or ask an admin to reassign.</p></div>); })()}
                <form action={cancelTimeOff} className="mt-2"><input type="hidden" name="id" value={t.id} /><button className={btnLight}>Remove time off</button></form>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
