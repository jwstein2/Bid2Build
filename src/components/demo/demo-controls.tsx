"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { FlaskConical, LogOut, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { DemoSessionKind } from "@/lib/demo/session";
import { useDemoSwitch } from "./use-demo-switch";
import { DEMO_HINT_COOKIE, readDemoHint } from "@/lib/demo/session";
import { inPracticeScope } from "@/lib/demo/scope";

/**
 * One hard reload when a client navigation crossed the paid-app boundary: the server already switched the
 * session (src/lib/demo/swap.ts), but a shared layout (banner, menu) kept from the previous page would still
 * show the old mode. Guarded per page for a few seconds so it can never loop.
 */
function reloadOnce(pathname: string) {
  try {
    const k = `b2b-practice-reload:${pathname}`;
    const last = Number(sessionStorage.getItem(k) ?? 0);
    if (Date.now() - last < 15_000) return;
    sessionStorage.setItem(k, String(Date.now()));
  } catch { return; }
  window.location.reload();
}

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
 * Sidebar "Practice Mode" switch (Help section, next to What's New), for every signed-in user.
 * Off → a short explanation and "Turn on" (fake sample data, nothing real happens). On → turns it off and
 * returns to the real account. While any demo session is active this is the way back out.
 */
export function PracticeNavToggle({ className, active }: { className: string; active: DemoSessionKind | null }) {
  const s = useDemoSwitch();
  const [asking, setAsking] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  // Keep "Turn on" clear of the fixed Guide button at the bottom of the menu.
  useEffect(() => { if (asking) panel.current?.scrollIntoView({ block: "center", behavior: "smooth" }); }, [asking]);
  const busy = s.phase === "preparing" || s.phase === "switching";
  const on = active !== null;
  const label = active === "owner_demo" ? "Demo Mode" : "Practice Mode";
  return (
    <div>
      <button type="button" role="switch" aria-checked={on} className={cn(className, "items-center")} disabled={busy}
        onClick={() => (on ? void s.exit() : setAsking((v) => !v))} data-testid="nav-practice-toggle" aria-describedby="nav-practice-help">
        <FlaskConical className="h-4 w-4" aria-hidden />
        <span className="flex-1">{label}</span>
        <span aria-hidden className={cn("relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors", on ? "bg-[#14B8A6]" : "bg-white/20")}>
          <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all", on ? "left-[18px]" : "left-0.5")} />
        </span>
        <span className="sr-only">{on ? "On" : "Off"}</span>
      </button>
      <span id="nav-practice-help" className="sr-only">
        {on ? "Turns off the fake sample data and goes back to your real account." : "Opens a separate workspace with fake sample data. Nothing you do there is real."}
      </span>
      {asking && !on && (
        <div ref={panel} className="mx-2 mb-2 mt-1 rounded-lg bg-white/10 p-3 text-xs text-[#E6EDF4]" role="group" aria-label="Turn on Practice Mode" data-testid="practice-confirm">
          <p className="font-bold text-white">Practice with fake sample data</p>
          <p className="mt-1">Practice Mode opens a separate workspace with a few made-up customers and bids. Nothing there is real: no emails or texts are sent, nothing is charged, and your real bids aren&apos;t touched.</p>
          <p className="mt-1">Turn Practice Mode off to get back to your real account.</p>
          <div className="mt-2 flex gap-2">
            <Button type="button" size="sm" variant="primary" disabled={busy} onClick={() => void s.enter("practice")} data-testid="practice-enter">Turn on</Button>
            <Button type="button" size="sm" variant="ghost" className="text-[#E6EDF4] hover:bg-white/10" onClick={() => setAsking(false)}>Cancel</Button>
          </div>
        </div>
      )}
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
      <span className="rounded bg-black/15 px-2 py-0.5 text-xs font-extrabold tracking-[0.12em]">{practice ? "PRACTICE MODE · FAKE DATA" : "DEMO MODE"}</span>
      {practice ? (
        <span className="min-w-0 basis-full font-semibold sm:basis-0 sm:flex-1" data-testid="practice-banner-text">
          Everything here is fake sample data. No emails or texts are sent and nothing is charged.
          <span className="font-normal"> Turn off Practice Mode to use your real account.</span>
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate font-semibold">
          {company ?? "Sample company"}
          <span className="hidden font-normal sm:inline"> · Sample data only. Nothing here reaches real customers, payments or billing.</span>
        </span>
      )}
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
            <LogOut className="h-4 w-4" aria-hidden /> {practice ? "Turn off Practice Mode" : "Exit Demo Mode"}
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
      const scoped = inPracticeScope(pathname);
      // Practice Mode is only for the paid app: a practice bar still showing outside it is a kept layout.
      if (serverBar && !scoped) { reloadOnce(pathname); return; }
      setHere(Boolean(hint) && !serverBar && scoped);
      if (!hint || !scoped) return;
      const inAppLayout = Boolean(document.querySelector("[data-testid='nav-help']"));
      if (checked.current && !(inAppLayout && !serverBar)) return;
      checked.current = true;
      void fetch("/api/guide", { cache: "no-store", credentials: "same-origin" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { workspace?: string } | null) => {
          const ws = j?.workspace;
          if (ws === "demo" || ws === "practice") {
            // Practice resumed on the way back into the app, but the kept menu/bar still shows the real account.
            if (inAppLayout && !serverBar) { reloadOnce(pathname); return; }
            setConfirmed(ws === "practice" ? "practice" : "owner_demo");
          }
          else if (j) document.cookie = `${DEMO_HINT_COOKIE}=; path=/; max-age=0; secure; samesite=lax`;
        })
        .catch(() => {});
    }, 0);
    return () => clearTimeout(t);
  }, [pathname]);
  if (!confirmed || !here) return null;
  return <DemoBanner kind={confirmed} company={null} sticky={false} anywhere />;
}
