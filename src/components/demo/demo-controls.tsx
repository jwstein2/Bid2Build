"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { FlaskConical, LogOut, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { DemoSessionKind } from "@/lib/demo/session";
import { useDemoSwitch } from "./use-demo-switch";
import { DEMO_HINT_COOKIE, readDemoHint } from "@/lib/demo/session";

/** Small status line under a demo button while the sample company is prepared or the session switches. */
function SwitchStatus({ phase, progress, error }: { phase: string; progress: number; error: string | null }) {
  if (phase === "preparing") return <p role="status" className="mt-1 text-xs text-muted" data-testid="demo-progress">Preparing the sample company… {progress}%</p>;
  if (phase === "switching") return <p role="status" className="mt-1 text-xs text-muted">Switching…</p>;
  if (phase === "error" && error) return <p role="alert" className="mt-1 text-xs text-danger" data-testid="demo-error">{error}</p>;
  return null;
}

/**
 * "Enter Demo Mode" for the platform owner (the server checks ownership again; this only decides what
 * is shown) and "Try a practice estimate" for everyone when Practice Mode is on.
 */
export function DemoEnterButton({ kind, className, variant = "secondary", label }: { kind: DemoSessionKind; className?: string; variant?: "primary" | "secondary" | "ghost"; label?: string }) {
  const s = useDemoSwitch();
  const busy = s.phase === "preparing" || s.phase === "switching";
  return (
    <div className={className}>
      <Button type="button" variant={variant} size="sm" onClick={() => void s.enter(kind)} disabled={busy} data-testid={kind === "practice" ? "practice-enter" : "demo-enter"} aria-describedby={kind === "practice" ? "practice-help" : "demo-help"}>
        <FlaskConical className="h-4 w-4" aria-hidden /> {label ?? (kind === "practice" ? "Practice with sample data" : "Enter Demo Mode")}
      </Button>
      <span id={kind === "practice" ? "practice-help" : "demo-help"} className="sr-only">
        {kind === "practice" ? "Opens a separate practice workspace with sample data. Your real account is not changed." : "Opens the sample company in a separate demo workspace. Your real account is not changed."}
      </span>
      <SwitchStatus phase={s.phase} progress={s.progress} error={s.error} />
    </div>
  );
}

/** Sidebar entry (dark navy background), owner only. */
export function DemoNavItem({ className }: { className: string }) {
  const s = useDemoSwitch();
  return (
    <div>
      <button type="button" className={className} onClick={() => void s.enter("owner_demo")} disabled={s.phase === "preparing" || s.phase === "switching"} data-testid="nav-demo-enter">
        <FlaskConical className="h-4 w-4" aria-hidden /> Demo Mode
      </button>
      {s.phase !== "idle" && <div className="px-3 text-[#C9D6E3] [&_p]:text-[#C9D6E3]"><SwitchStatus phase={s.phase} progress={s.progress} error={s.error} /></div>}
    </div>
  );
}

/**
 * Persistent DEMO MODE / PRACTICE MODE bar at the top of every signed-in page of a demo session. Exit
 * returns to the real account; Reset (with confirmation) re-seeds only this demo workspace.
 */
export function DemoBanner({ kind, company, sticky = true, anywhere = false }: { kind: DemoSessionKind; company: string | null; sticky?: boolean; anywhere?: boolean }) {
  const s = useDemoSwitch();
  const [confirming, setConfirming] = useState(false);
  const cancel = useRef<HTMLButtonElement>(null);
  const practice = kind === "practice";
  useEffect(() => { document.documentElement.dataset.b2bDemo = kind; return () => { delete document.documentElement.dataset.b2bDemo; }; }, [kind]);
  useEffect(() => { if (confirming) cancel.current?.focus(); }, [confirming]);
  const busy = s.phase === "preparing" || s.phase === "switching";
  return (
    <div role="region" aria-label={practice ? "Practice Mode" : "Demo Mode"} data-testid="demo-banner" data-kind={kind} data-anywhere={anywhere ? "" : undefined}
      className={cn(sticky ? "sticky top-0 z-40" : "relative z-40", "flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm no-print", practice ? "bg-[#14B8A6] text-[#06231F]" : "bg-[#F59E0B] text-[#2B1600]")}>
      <span className="rounded bg-black/15 px-2 py-0.5 text-xs font-extrabold tracking-[0.12em]">{practice ? "PRACTICE MODE" : "DEMO MODE"}</span>
      <span className="min-w-0 flex-1 truncate font-semibold">
        {company ?? (practice ? "Sample data" : "Sample company")}
        <span className="hidden font-normal sm:inline"> · Sample data only. Nothing here reaches real customers, payments or billing.</span>
      </span>
      {confirming ? (
        <span className="flex flex-wrap items-center gap-2" role="group" aria-label="Confirm reset">
          <span className="font-semibold">{practice ? "Start the practice over?" : "Reset the demo workspace to fresh sample data?"}</span>
          <Button size="sm" variant="primary" onClick={() => { setConfirming(false); void s.reset(kind); }} data-testid="demo-reset-confirm">Yes, reset</Button>
          <Button ref={cancel} size="sm" variant="ghost" onClick={() => setConfirming(false)}><X className="h-4 w-4" aria-hidden /> Cancel</Button>
        </span>
      ) : (
        <span className="flex items-center gap-2">
          <Button size="sm" variant="ghost" className="min-h-9 bg-black/10 hover:bg-black/20" onClick={() => setConfirming(true)} disabled={busy} data-testid="demo-reset">
            <RotateCcw className="h-4 w-4" aria-hidden /> {practice ? "Start over" : "Reset demo"}
          </Button>
          <Button size="sm" variant="primary" className="min-h-9" onClick={() => void s.exit()} disabled={busy} data-testid="demo-exit">
            <LogOut className="h-4 w-4" aria-hidden /> {practice ? "Back to my account" : "Exit Demo Mode"}
          </Button>
        </span>
      )}
      {s.phase !== "idle" && <div className="w-full"><SwitchStatus phase={s.phase} progress={s.progress} error={s.error} /></div>}
    </div>
  );
}

/**
 * DEMO MODE bar for pages outside the signed-in layout (estimate builder, trade picker, start pages),
 * mounted once in the root layout. Shown only when the display-hint cookie is set AND the server confirms
 * this session is a demo login; a stale hint (e.g. after signing out) is cleared. The signed-in layout
 * renders its own server-side bar, so this one stays out of the way there.
 */
export function DemoBannerAnywhere() {
  const pathname = usePathname();
  const [confirmed, setConfirmed] = useState<DemoSessionKind | null>(null);
  const [here, setHere] = useState(false);
  const checked = useRef(false);
  useEffect(() => {
    // Re-evaluated on every route change: client navigation can move between the signed-in layout (own bar) and the builder.
    const t = setTimeout(() => {
      const hint = readDemoHint(document.cookie);
      const serverBar = Array.from(document.querySelectorAll("[data-testid='demo-banner']")).some((el) => !el.hasAttribute("data-anywhere"));
      setHere(Boolean(hint) && !serverBar);
      if (!hint || checked.current) return;
      checked.current = true;
      void fetch("/api/guide", { cache: "no-store", credentials: "same-origin" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { workspace?: string } | null) => {
          const ws = j?.workspace;
          if (ws === "demo" || ws === "practice") setConfirmed(ws === "practice" ? "practice" : "owner_demo");
          else if (j) document.cookie = `${DEMO_HINT_COOKIE}=; path=/; max-age=0; secure; samesite=lax`;
        })
        .catch(() => {});
    }, 0);
    return () => clearTimeout(t);
  }, [pathname]);
  if (!confirmed || !here) return null;
  return <DemoBanner kind={confirmed} company={null} sticky={false} anywhere />;
}
