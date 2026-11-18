"use client";
import { useOptimistic, useRef, useState, useTransition, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Bookmark, Flag, ThumbsUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { buttonClass } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { REPORT_REASONS } from "@/lib/academy/types";
import { reportContent, toggleBookmark, toggleReaction } from "@/app/(marketing)/academy/actions";

/** Submit button that shows a pending state while its form's server action runs. */
export function Submit({ children, pending: pendingLabel = "Saving…", variant = "primary", size = "md", className }: { children: ReactNode; pending?: string; variant?: "primary" | "accent" | "secondary" | "ghost" | "danger"; size?: "sm" | "md"; className?: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} aria-busy={pending} className={buttonClass(variant, size, className)}>{pending ? pendingLabel : children}</button>;
}

export function ReactButton({ type, id, count, reacted, disabled, label = "Like" }: { type: "post" | "comment"; id: string; count: number; reacted: boolean; disabled?: boolean; label?: string }) {
  const [state, setState] = useOptimistic({ count, reacted });
  const [err, setErr] = useState<string | null>(null);
  const [, start] = useTransition();
  const router = useRouter();
  return (
    <span className="inline-flex items-center gap-1">
      <button type="button" disabled={disabled} aria-pressed={state.reacted} aria-label={`${label} (${state.count})`} data-testid={`react-${type}`}
        title={disabled ? "You can't like your own post" : undefined}
        onClick={() => start(async () => {
          setErr(null);
          const next = !state.reacted;
          setState({ reacted: next, count: state.count + (next ? 1 : -1) });
          const r = await toggleReaction(type, id, next);
          if (!r.ok) setErr(r.message);
          router.refresh();
        })}
        className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-md px-2 text-sm font-semibold transition-colors", state.reacted ? "text-accent-ink" : "text-muted hover:bg-black/5 hover:text-ink", disabled && "cursor-not-allowed opacity-60")}>
        <ThumbsUp className={cn("h-4 w-4", state.reacted && "fill-current")} aria-hidden /> {state.count}
      </button>
      {err && <span role="alert" className="text-xs text-danger">{err}</span>}
    </span>
  );
}

export function SaveButton({ type, id, saved }: { type: "post" | "course" | "lesson" | "resource"; id: string; saved: boolean }) {
  const [on, setOn] = useOptimistic(saved);
  const [, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  return (
    <span className="inline-flex items-center gap-1">
      <button type="button" aria-pressed={on} data-testid={`save-${type}`}
        onClick={() => start(async () => { setErr(null); setOn(!on); const r = await toggleBookmark(type, id, !on); if (!r.ok) setErr(r.message); router.refresh(); })}
        className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-md px-2 text-sm font-semibold", on ? "text-accent-ink" : "text-muted hover:bg-black/5 hover:text-ink")}>
        <Bookmark className={cn("h-4 w-4", on && "fill-current")} aria-hidden /> {on ? "Saved" : "Save"}
      </button>
      {err && <span role="alert" className="text-xs text-danger">{err}</span>}
    </span>
  );
}

export function ReportButton({ type, id }: { type: "post" | "comment" | "member"; id: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState<"idle" | "sending" | "done" | string>("idle");
  return (
    <>
      <button type="button" onClick={() => { setStatus("idle"); dialog.current?.showModal(); }} className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-2 text-sm font-semibold text-muted hover:bg-black/5 hover:text-ink">
        <Flag className="h-4 w-4" aria-hidden /> Report
      </button>
      <dialog ref={dialog} className="m-auto w-[min(92vw,28rem)] rounded-xl border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-black/40" aria-labelledby={`report-${id}`}>
        <form className="p-5" onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setStatus("sending");
          const r = await reportContent(type, id, String(f.get("reason")), String(f.get("details") ?? ""));
          setStatus(r.ok ? "done" : r.message);
        }}>
          <h2 id={`report-${id}`} className="font-display text-lg font-bold">Report this {type}</h2>
          {status === "done" ? (
            <p className="mt-3 text-sm text-ink-soft">Thanks. A moderator will review it. Reports are confidential.</p>
          ) : (
            <>
              <fieldset className="mt-3 grid gap-2 text-sm">
                <legend className="sr-only">Reason</legend>
                {REPORT_REASONS.map((r, i) => <label key={r.key} className="flex items-center gap-2"><input type="radio" name="reason" value={r.key} defaultChecked={i === 0} required /> {r.label}</label>)}
              </fieldset>
              <label className="mt-3 block text-sm font-semibold" htmlFor={`report-details-${id}`}>Details (optional)</label>
              <textarea id={`report-details-${id}`} name="details" maxLength={1000} rows={3} className="mt-1 w-full rounded-md border border-line-strong bg-surface p-2 text-sm" />
              {status !== "idle" && status !== "sending" && <p role="alert" className="mt-2 text-sm text-danger">{status}</p>}
            </>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => dialog.current?.close()} className={buttonClass("secondary", "sm")}>{status === "done" ? "Close" : "Cancel"}</button>
            {status !== "done" && <button type="submit" disabled={status === "sending"} className={buttonClass("primary", "sm")}>{status === "sending" ? "Sending…" : "Send report"}</button>}
          </div>
        </form>
      </dialog>
    </>
  );
}
