"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

/** Owner-only switch: bids must be approved before anyone (except approvers) can mark them Sent. */
export function ApprovalToggle({ required }: { required: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(required);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function toggle(next: boolean) {
    setBusy(true); setErr(null); setOn(next);
    const r = await fetch("/api/company/pipeline", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "approval_rule", required: next }) }).catch(() => null);
    const d = await r?.json().catch(() => null);
    setBusy(false);
    if (!r?.ok) { setOn(!next); setErr(d?.error?.message ?? "Something went wrong. Please try again."); return; }
    router.refresh();
  }
  return (
    <div>
      <label className="flex items-start gap-3">
        <input type="checkbox" className="mt-1 h-5 w-5" checked={on} disabled={busy} onChange={(e) => toggle(e.target.checked)} data-testid="approval-toggle" />
        <span><span className="font-semibold">Require approval before a bid is marked Sent</span>
          <span className="block text-sm text-ink-soft">Estimators move bids to Ready for Review; a manager or you approves them. Managers can&apos;t approve their own bids while this is on.</span></span>
      </label>
      {err && <p role="alert" className="mt-1 text-sm text-danger">{err}</p>}
    </div>
  );
}
