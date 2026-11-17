"use client";
import { Bell, CalendarClock, CheckCircle2, Clock, Gauge, Loader2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { useDismiss } from "@/components/ui/use-dismiss";

interface Notice {
  id: string; kind: string; scheduleId: string; taskId: string; reason: "end_date" | "progress_100" | "both"; title: string; status: string;
  data: {
    projectName?: string; taskName?: string; sectionName?: string | null; assignee?: string | null; plannedEnd?: string; percentComplete?: number; customerName?: string | null;
    // V4.6 customer communications notices
    messageId?: string; scheduledFor?: string; timezone?: string; mode?: "review" | "automatic"; subject?: string; classification?: string;
    sections?: { name: string; status: string; progress: number | null; plannedEnd: string }[];
  };
  canConfirm: boolean; readAt: string | null; createdAt: string;
}
const REASON: Record<Notice["reason"], string> = { end_date: "Reached its planned finish", progress_100: "Marked 100% complete", both: "100% and past its planned finish" };
const day = (d?: string) => (d ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`)) : "");

/**
 * Task review notices for the responsible PM (V4.3). In-app only: the homeowner is never notified, a
 * task is never completed automatically, and each task/finish date produces at most one notice.
 */
export function NotificationBell() {
  const [items, setItems] = useState<Notice[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const load = useCallback(() => {
    fetch("/api/notifications", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => { if (d?.available) setItems(d.items); else setItems(null); }).catch(() => {});
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 5 * 60_000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(t); window.removeEventListener("focus", onFocus); };
  }, [load]);
  const bell = useRef<HTMLButtonElement>(null);
  useDismiss(open, () => setOpen(false), { inside: [ref], returnFocus: bell });
  if (items === null) return null;
  const act = async (n: Notice, action: "confirm" | "later" | "read") => {
    setBusy(n.id); setErr(null);
    try {
      const r = await fetch(`/api/notifications/${n.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error?.message ?? "Something went wrong.");
      if (action !== "read") setItems((xs) => (xs ?? []).filter((x) => x.id !== n.id));
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };
  const unread = items.filter((n) => !n.readAt).length;
  return (
    <div className="relative" ref={ref}>
      <button ref={bell} type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="dialog" data-testid="notification-bell"
        className="relative grid min-h-9 min-w-9 place-items-center rounded-md text-ink-soft hover:bg-black/5" aria-label={`Task review notices${items.length ? `, ${items.length} open` : ""}`}>
        <Bell className="h-5 w-5" aria-hidden />
        {items.length > 0 && <span className={cn("absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-bold", unread ? "bg-danger text-white" : "bg-black/10 text-ink")}>{items.length}</span>}
      </button>
      {open && (
        <div role="dialog" aria-label="Task review notices" className="absolute right-0 z-50 mt-2 w-[min(92vw,24rem)] rounded-xl border border-line bg-surface p-2 shadow-xl">
          <p className="px-2 py-1 text-sm font-bold">Notices</p>
          {err && <p className="px-2 text-xs text-danger" role="alert">{err}</p>}
          {items.length === 0 && <p className="px-2 py-3 text-sm text-muted">You&apos;re all caught up. When a task you manage reaches its finish date or 100%, it shows up here for you to confirm.</p>}
          <ul className="max-h-[60vh] space-y-2 overflow-y-auto">
            {items.map((n) => (
              n.kind !== "task_review" ? <CommNotice key={n.id} n={n} busy={busy === n.id} onLater={() => void act(n, "later")} onClose={() => setOpen(false)} /> : (
              <li key={n.id} className="rounded-lg border border-line p-2.5 text-sm" onMouseEnter={() => !n.readAt && void act(n, "read").then(() => setItems((xs) => (xs ?? []).map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x))))}>
                <p className="font-semibold">{n.data.taskName ?? n.title}</p>
                <p className="text-xs text-ink-soft">{n.data.projectName}{n.data.customerName ? ` · ${n.data.customerName}` : ""}{n.data.sectionName ? ` · ${n.data.sectionName}` : ""}</p>
                <p className="mt-0.5 text-xs text-muted">{REASON[n.reason]} · finish {day(n.data.plannedEnd)} · {n.data.percentComplete ?? 0}%{n.data.assignee ? ` · ${n.data.assignee}` : ""}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {n.canConfirm && <button className="inline-flex min-h-8 items-center gap-1 rounded-md bg-navy px-2 text-xs font-semibold text-white disabled:opacity-50" disabled={busy === n.id} onClick={() => void act(n, "confirm")}>
                    {busy === n.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />} Confirm Complete</button>}
                  <Link className="inline-flex min-h-8 items-center gap-1 rounded-md border border-line px-2 text-xs font-semibold" href={`/projects/${n.scheduleId}?task=${n.taskId}&focus=progress`} onClick={() => setOpen(false)}><Gauge className="h-3.5 w-3.5" aria-hidden /> Update Progress</Link>
                  <Link className="inline-flex min-h-8 items-center gap-1 rounded-md border border-line px-2 text-xs font-semibold" href={`/projects/${n.scheduleId}?task=${n.taskId}&focus=dates`} onClick={() => setOpen(false)}><CalendarClock className="h-3.5 w-3.5" aria-hidden /> Adjust Schedule</Link>
                  <button className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-xs font-semibold text-ink-soft hover:bg-black/5" disabled={busy === n.id} onClick={() => void act(n, "later")}><Clock className="h-3.5 w-3.5" aria-hidden /> Review Later</button>
                </div>
              </li>
              )
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** V4.6: planned customer update reminders and customer replies (in-app only). */
function CommNotice({ n, busy, onLater, onClose }: { n: Notice; busy: boolean; onLater: () => void; onClose: () => void }) {
  const at = n.data.scheduledFor ? new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: n.data.timezone || undefined }).format(new Date(n.data.scheduledFor)) : null;
  const reply = n.kind === "customer_reply";
  const link = "inline-flex min-h-8 items-center gap-1 rounded-md border border-line px-2 text-xs font-semibold";
  return (
    <li className="rounded-lg border border-line p-2.5 text-sm" data-testid={`notice-${n.kind}`}>
      <p className="font-semibold">{n.title}</p>
      <p className="text-xs text-ink-soft">{[n.data.projectName, n.data.customerName].filter(Boolean).join(" · ")}</p>
      {reply ? <p className="mt-0.5 text-xs text-muted">Re: {n.data.subject}</p> : (
        <>
          {at && <p className="mt-0.5 text-xs text-muted">Planned send: {at} · {n.data.mode === "automatic" ? "sends automatically unless you skip it" : "won't send until you approve it"}</p>}
          {(n.data.sections ?? []).map((x) => <p key={x.name} className="text-xs text-muted">{x.name}: {x.status}{x.progress !== null ? ` · ${x.progress}% recorded` : ""} · planned finish {day(x.plannedEnd)}</p>)}
          <p className="mt-1 text-xs">Would you like to review the schedule before this update is sent?</p>
        </>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {reply ? <Link className={link} href="/dashboard/customers/communications?tab=replies" onClick={onClose}>Open conversation</Link> : <>
          {n.scheduleId && <Link className={link} href={`/projects/${n.scheduleId}`} onClick={onClose}><CalendarClock className="h-3.5 w-3.5" aria-hidden /> Review schedule</Link>}
          <Link className={link} href="/dashboard/customers/communications?tab=attention&type=project_update" onClick={onClose}>Preview update</Link>
          {n.scheduleId && <Link className={link} href={`/projects/${n.scheduleId}?focus=progress`} onClick={onClose}><Gauge className="h-3.5 w-3.5" aria-hidden /> Adjust progress</Link>}
          <Link className={link} href="/dashboard/customers/communications?tab=scheduled&type=project_update" onClick={onClose}>Skip or keep scheduled</Link>
        </>}
        <button className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-xs font-semibold text-ink-soft hover:bg-black/5" disabled={busy} onClick={onLater}><Clock className="h-3.5 w-3.5" aria-hidden /> Later</button>
      </div>
    </li>
  );
}
