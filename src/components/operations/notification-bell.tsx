"use client";
import { Bell, CalendarClock, CheckCircle2, Clock, Gauge, Loader2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

interface Notice {
  id: string; kind: string; scheduleId: string; taskId: string; reason: "end_date" | "progress_100" | "both"; title: string; status: string;
  data: { projectName?: string; taskName?: string; sectionName?: string | null; assignee?: string | null; plannedEnd?: string; percentComplete?: number; customerName?: string | null };
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
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
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
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="dialog" data-testid="notification-bell"
        className="relative grid min-h-9 min-w-9 place-items-center rounded-md text-ink-soft hover:bg-black/5" aria-label={`Task review notices${items.length ? `, ${items.length} open` : ""}`}>
        <Bell className="h-5 w-5" aria-hidden />
        {items.length > 0 && <span className={cn("absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-bold", unread ? "bg-danger text-white" : "bg-black/10 text-ink")}>{items.length}</span>}
      </button>
      {open && (
        <div role="dialog" aria-label="Task review notices" className="absolute right-0 z-50 mt-2 w-[min(92vw,24rem)] rounded-xl border border-line bg-surface p-2 shadow-xl">
          <p className="px-2 py-1 text-sm font-bold">Tasks to review</p>
          {err && <p className="px-2 text-xs text-danger" role="alert">{err}</p>}
          {items.length === 0 && <p className="px-2 py-3 text-sm text-muted">You&apos;re all caught up. When a task you manage reaches its finish date or 100%, it shows up here for you to confirm.</p>}
          <ul className="max-h-[60vh] space-y-2 overflow-y-auto">
            {items.map((n) => (
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
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
