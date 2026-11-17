"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/misc";
import { FinDialog } from "./fin-dialog";
import { finAction } from "./fin-client";

/**
 * Company sandbox (Scenario G). In the sandbox every Financials page shows this bar: practice books that never
 * touch the real ones, with no emails. Outside it, a button to enter (with a confirmation that says exactly that).
 */
export function SandboxBar({ sandbox, canManage, compact }: { sandbox: boolean; canManage: boolean; compact?: boolean }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState<"enter" | "reset" | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async (action: "sandbox_enter" | "sandbox_leave" | "sandbox_reset") => {
    setBusy(true); setErr(null);
    const r = await finAction({ action });
    setBusy(false);
    if (!r.ok) return setErr(r.message);
    setConfirm(null);
    router.refresh();
    if (typeof window !== "undefined") window.dispatchEvent(new Event("b2b-fin-book-changed"));
  };
  if (!sandbox) {
    if (compact) return null;
    return (
      <>
        <Button size="sm" variant="ghost" onClick={() => { setErr(null); setConfirm("enter"); }} data-testid="fin-sandbox-enter"><FlaskConical className="h-4 w-4" aria-hidden /> Practice sandbox</Button>
        <FinDialog open={confirm === "enter"} onOpenChange={(o) => { if (!o) setConfirm(null); }} title="Switch to the sandbox?"
          description="Practice invoicing, payments and costs without touching your real books.">
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-soft" data-testid="fin-sandbox-rules">
            <li>A separate set of practice books, numbered SBX-, with copies of your open jobs.</li>
            <li>Nothing you do there changes your real invoices, payments, reports or customers.</li>
            <li>No emails are sent from the sandbox and no money moves.</li>
            <li>Only you switch. Your team stays in the real books until they switch too.</li>
          </ul>
          {err && <div className="mt-3"><Notice tone="danger">{err}</Notice></div>}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => void run("sandbox_enter")} disabled={busy} data-testid="fin-sandbox-enter-confirm">{busy ? "Switching…" : "Switch to the sandbox"}</Button>
            <Button variant="ghost" onClick={() => setConfirm(null)}>Stay in real books</Button>
          </div>
        </FinDialog>
      </>
    );
  }
  return (
    <div role="status" className="flex flex-wrap items-center gap-2 rounded-xl border-2 border-dashed border-warn bg-warn-tint px-4 py-3 text-sm text-ink" data-testid="fin-sandbox-banner">
      <FlaskConical className="h-5 w-5 shrink-0 text-warn" aria-hidden />
      <p className="min-w-0 basis-full sm:basis-0 sm:flex-1"><span className="font-extrabold uppercase tracking-wide text-warn">Sandbox</span> · Practice books. Nothing here changes your real books, and no emails are sent.</p>
      <Button size="sm" variant="secondary" onClick={() => void run("sandbox_leave")} disabled={busy} data-testid="fin-sandbox-leave">Back to real books</Button>
      {canManage && !compact && <Button size="sm" variant="ghost" onClick={() => { setErr(null); setConfirm("reset"); }} data-testid="fin-sandbox-reset">Start over</Button>}
      {err && !confirm && <div className="basis-full"><Notice tone="danger">{err}</Notice></div>}
      <FinDialog open={confirm === "reset"} onOpenChange={(o) => { if (!o) setConfirm(null); }} title="Start the sandbox over?"
        description="You get fresh practice books with new copies of your open jobs. The old sandbox is archived (kept, read-only) and everyone in it goes back to the real books.">
        {err && <div className="mb-3"><Notice tone="danger">{err}</Notice></div>}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void run("sandbox_reset")} disabled={busy} data-testid="fin-sandbox-reset-confirm">{busy ? "Starting over…" : "Start over"}</Button>
          <Button variant="ghost" onClick={() => setConfirm(null)}>Keep this sandbox</Button>
        </div>
      </FinDialog>
    </div>
  );
}
