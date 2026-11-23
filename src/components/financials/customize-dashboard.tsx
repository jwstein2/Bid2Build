"use client";
import { cn } from "@/lib/cn";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { finAction } from "./fin-client";

/**
 * Contractor Mode (default) / Accountant Mode. Offered only to people authorized for accounting work.
 * Clear feedback: hover and pressed states, a keyboard focus ring, and the tapped mode shows a spinner and is
 * highlighted right away while its layout loads (the switch stays busy until the new page has rendered).
 */
export function ModeToggle({ mode, className }: { mode: "contractor" | "accountant"; /** Layout overrides, e.g. full width on phones. */ className?: string }) {
  const router = useRouter();
  const [target, setTarget] = useState<"contractor" | "accountant" | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const busy = target !== null || refreshing;

  const set = async (m: "contractor" | "accountant") => {
    if (m === mode || busy) return;
    setTarget(m); setFailed(false);
    const r = await finAction({ action: "set_mode", mode: m });
    if (!r.ok) { setTarget(null); setFailed(true); return; }
    startRefresh(() => { router.refresh(); });
    setTarget(null);
  };
  // While the refresh runs, keep showing the mode that was picked.
  const [picked, setPicked] = useState<"contractor" | "accountant" | null>(null);
  if (target && picked !== target) setPicked(target);
  if (!busy && picked) setPicked(null);
  const active = target ?? (refreshing && picked ? picked : mode);
  return (
      <div role="group" aria-label="View mode" aria-busy={busy || undefined} className={cn("relative inline-flex rounded-lg border border-line bg-surface p-0.5", className)} data-testid="fin-mode" data-guide="fin.mode" data-busy={busy || undefined}>
        {(["contractor", "accountant"] as const).map((m) => {
          const on = active === m;
          const loading = busy && on && m !== mode;
          return (
            <button key={m} type="button" aria-pressed={on} disabled={busy && !on} onClick={() => set(m)}
              className={cn(
                "inline-flex min-h-10 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 text-sm font-semibold transition duration-150 max-[359px]:px-2",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:scale-[0.97]",
                on ? "bg-brand text-white shadow-sm hover:brightness-110" : "text-ink-soft hover:bg-black/5 hover:text-ink active:bg-black/10 dark:hover:bg-white/10 dark:active:bg-white/15",
                busy && !on && "cursor-wait opacity-60",
                loading && "cursor-wait",
              )}>
              {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {m === "contractor" ? "Contractor" : "Accountant"} Mode
            </button>
          );
        })}
        <span className="sr-only" role="status" aria-live="polite">{busy ? `Switching to ${active === "accountant" ? "Accountant" : "Contractor"} Mode…` : ""}</span>
        {failed && <span className="absolute left-0 top-full z-10 mt-1 whitespace-nowrap rounded bg-surface px-1 text-xs text-danger" role="alert">Couldn&apos;t switch modes. Try again.</span>}
      </div>
  );
}
