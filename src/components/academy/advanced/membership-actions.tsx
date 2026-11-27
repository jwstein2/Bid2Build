"use client";
import Link from "next/link";
import { useState } from "react";
import { Loader2 } from "lucide-react";

/** Cancel at period end / keep my membership / payment methods and invoices (Stripe portal) / upgrade. */
export function MembershipActions({ id, canceling, canUpgrade }: { id: string; canceling: boolean; canUpgrade: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  async function run(action: "cancel" | "resume" | "portal") {
    setBusy(action); setErr(null);
    try {
      const r = await fetch("/api/academy/advanced/manage", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, membership: id }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error?.message ?? "Something went wrong.");
      if (j.url) window.location.assign(j.url); else window.location.reload();
    } catch (e) { setErr((e as Error).message); setBusy(null); }
  }
  const btn = "inline-flex min-h-10 items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm font-semibold hover:bg-paper disabled:opacity-60";
  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-2">
        {canUpgrade && <Link href="/academy/advanced" className={btn}>Add subjects / upgrade</Link>}
        <button type="button" className={btn} onClick={() => run("portal")} disabled={busy !== null}>{busy === "portal" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Payment method and invoices</button>
        {canceling
          ? <button type="button" className={btn} onClick={() => run("resume")} disabled={busy !== null} data-testid="resume">{busy === "resume" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Keep my membership</button>
          : confirm
            ? <button type="button" className={`${btn} border-danger text-danger`} onClick={() => run("cancel")} disabled={busy !== null} data-testid="confirm-cancel">{busy === "cancel" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Yes, cancel at the end of this period</button>
            : <button type="button" className={btn} onClick={() => setConfirm(true)} data-testid="cancel">Cancel membership</button>}
      </div>
      {err && <p role="alert" className="mt-2 text-sm font-semibold text-danger">{err}</p>}
    </div>
  );
}
