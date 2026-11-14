"use client";
import { Loader2, Minus, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button } from "../ui/button";
import { ENTERPRISE_INCLUDED_USERS, formatCents } from "@/lib/enterprise/pricing";

type Preview = { fromUsers: number; toUsers: number; beforeCents: number; afterCents: number; deltaCents: number; dueNowCents: number; creditCents: number; prorationDate: number; currentPeriodEnd: string | null };

/** Choose a new licensed-user count, see Stripe's exact proration, then confirm. */
export function SeatChanger({ current, seatsInUse }: { current: number; seatsInUse: number }) {
  const router = useRouter();
  const id = useId();
  const min = Math.max(ENTERPRISE_INCLUDED_USERS, seatsInUse);
  const [target, setTarget] = useState(current + 1);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<"preview" | "confirm" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [attempt] = useState(() => crypto.randomUUID());

  const set = (n: number) => { setTarget(Math.max(min, Math.min(10_000, Math.round(n) || min))); setPreview(null); setErr(null); setDone(null); };

  async function call(action: "preview" | "confirm") {
    setBusy(action); setErr(null);
    const r = await fetch("/api/company/seats", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, users: target, fromUsers: current, prorationDate: preview?.prorationDate, attempt }),
    }).catch(() => null);
    const d = await r?.json().catch(() => null);
    setBusy(null);
    if (!r?.ok) { setErr(d?.error?.message ?? "Something went wrong. Nothing was changed."); return; }
    if (action === "preview") setPreview(d as Preview);
    else { setPreview(null); setDone(`You now have ${d.users} licensed users.`); router.refresh(); }
  }

  const adding = target > current;
  return (
    <div data-testid="seat-changer">
      <label htmlFor={`${id}-n`} className="text-sm font-semibold">Licensed users</label>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" aria-label="Fewer users" onClick={() => set(target - 1)} disabled={target <= min}><Minus className="h-4 w-4" /></Button>
        <input id={`${id}-n`} type="number" inputMode="numeric" min={min} value={target} onChange={(e) => set(Number(e.target.value))}
          className="h-10 w-20 rounded-lg border border-line bg-surface px-3 text-center text-base font-semibold" />
        <Button type="button" variant="secondary" aria-label="More users" onClick={() => set(target + 1)}><Plus className="h-4 w-4" /></Button>
        <Button type="button" onClick={() => call("preview")} disabled={busy !== null || target === current}>
          {busy === "preview" && <Loader2 className="h-4 w-4 animate-spin" />}Preview change
        </Button>
      </div>
      <p className="mt-1 text-xs text-ink-soft">{seatsInUse} in use (active users and pending invitations). You can&apos;t go below that or below the {ENTERPRISE_INCLUDED_USERS} included users.</p>

      {preview && (
        <div role="dialog" aria-labelledby={`${id}-confirm`} className="mt-4 rounded-xl border border-line bg-paper p-4" data-testid="seat-preview">
          <h3 id={`${id}-confirm`} className="font-display font-bold">{adding ? "Add" : "Remove"} {Math.abs(preview.toUsers - preview.fromUsers)} licensed user{Math.abs(preview.toUsers - preview.fromUsers) === 1 ? "" : "s"}?</h3>
          <dl className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-ink-soft">Monthly price now ({preview.fromUsers} users)</dt><dd>{formatCents(preview.beforeCents)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-ink-soft">New monthly price ({preview.toUsers} users)</dt><dd className="font-semibold">{formatCents(preview.afterCents)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-ink-soft">Change per month</dt><dd>{preview.deltaCents > 0 ? "+" : ""}{formatCents(preview.deltaCents)}</dd></div>
            {adding
              ? <div className="flex justify-between gap-3 border-t border-line pt-1 font-bold"><dt>Charged now (prorated for the rest of this period)</dt><dd data-testid="due-now">{formatCents(preview.dueNowCents)}</dd></div>
              : <div className="flex justify-between gap-3 border-t border-line pt-1 font-bold"><dt>Credit on your next invoice</dt><dd>{formatCents(preview.creditCents)}</dd></div>}
          </dl>
          <p className="mt-2 text-xs text-ink-soft">{adding
            ? "Your card on file is charged now. If it's declined, no licenses are added."
            : "The licenses are removed now. Make sure everyone you still need has an active seat; deactivated users keep all their bids in the company."}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => call("confirm")} disabled={busy !== null}>{busy === "confirm" && <Loader2 className="h-4 w-4 animate-spin" />}{adding ? `Confirm and pay ${formatCents(preview.dueNowCents)}` : "Confirm removal"}</Button>
            <Button variant="secondary" onClick={() => setPreview(null)} disabled={busy !== null}>Cancel</Button>
          </div>
        </div>
      )}
      {err && <p role="alert" className="mt-2 text-sm text-danger">{err}</p>}
      {done && <p role="status" className="mt-2 text-sm text-ok">{done}</p>}
    </div>
  );
}
