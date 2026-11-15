"use client";
import { CalendarRange, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button } from "../ui/button";
import { Badge, Card } from "../ui/misc";
import { formatCents } from "@/lib/enterprise/pricing";
import { PM_ADDON_CENTS } from "@/lib/pm/billing";

type Preview = { monthlyCents: number; interval: "month" | "year" | null; effective: string; dueNowCents: number; nextInvoiceAt: string | null; prorationDate: number };
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { dateStyle: "long" }) : "your next billing date");

/**
 * Standard Unlimited "Project scheduling" add-on: $4.99/month, one schedule editor. Preview shows the
 * exact charge before anything changes; removal keeps editing until the end of the paid period.
 */
export function PmAddonCard({ state, periodEnd, annual }: {
  state: { addon: boolean; addonUntil: string | null; source: string | null; canEdit: boolean } | null;
  periodEnd: string | null; annual: boolean;
}) {
  const router = useRouter();
  const id = useId();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [attempt] = useState(() => crypto.randomUUID());

  async function call(action: "preview" | "add" | "remove") {
    setBusy(action); setErr(null); setDone(null);
    const r = await fetch("/api/billing/pm-addon", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, prorationDate: preview?.prorationDate, attempt: `${attempt}-${action}` }),
    }).catch(() => null);
    const d = await r?.json().catch(() => null);
    setBusy(null);
    if (!r?.ok) { setErr(d?.error?.message ?? "Something went wrong. Nothing was changed."); return; }
    if (action === "preview") { setPreview(d as Preview); return; }
    setPreview(null); setConfirmRemove(false);
    setDone(action === "add" ? "Project scheduling is on. You're the schedule editor for your account." : `Removed. You can keep editing schedules until ${day(d.editUntil)}; after that they stay saved and view-only.`);
    router.refresh();
  }

  const active = Boolean(state?.addon);
  const ending = !active && Boolean(state?.addonUntil && new Date(state.addonUntil) > new Date());
  const comp = state?.source === "complimentary" && state.canEdit;
  return (
    <Card className="p-5" data-testid="pm-addon">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent-ink"><CalendarRange className="h-5 w-5" aria-hidden /></span>
          <div>
            <h2 className="font-display text-lg font-bold">Project scheduling add-on</h2>
            <p className="text-sm text-ink-soft">Turn won bids into job schedules with a timeline, tasks and progress tracking. {formatCents(PM_ADDON_CENTS)}/month, includes one schedule editor (you).</p>
          </div>
        </div>
        {active ? <Badge tone="ok">active</Badge> : ending ? <Badge tone="neutral">ending</Badge> : comp ? <Badge tone="ok">complimentary</Badge> : null}
      </div>

      <div className="mt-4">
        {comp && <p className="text-sm text-ink-soft">Included with your complimentary access. Nothing is charged.</p>}
        {active && !confirmRemove && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-ink-soft">{formatCents(PM_ADDON_CENTS)}/month, billed with your plan. Next charge {day(periodEnd)}.</p>
            <Button variant="secondary" size="sm" onClick={() => setConfirmRemove(true)}>Remove add-on</Button>
          </div>
        )}
        {active && confirmRemove && (
          <div role="dialog" aria-labelledby={`${id}-rm`} className="rounded-xl border border-line bg-paper p-4" data-testid="pm-remove">
            <h3 id={`${id}-rm`} className="font-display font-bold">Remove project scheduling?</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-soft">
              <li>No more add-on charges. There&apos;s no refund for the current period.</li>
              <li>You can keep editing schedules until {day(periodEnd)}.</li>
              <li>After that your schedules stay saved and you can still view them. Nothing is deleted.</li>
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="danger" onClick={() => call("remove")} disabled={busy !== null}>{busy === "remove" && <Loader2 className="h-4 w-4 animate-spin" />}Remove add-on</Button>
              <Button variant="secondary" onClick={() => setConfirmRemove(false)} disabled={busy !== null}>Keep it</Button>
            </div>
          </div>
        )}
        {!active && !comp && !preview && (
          <div className="flex flex-wrap items-center gap-3">
            {ending && <p className="text-sm text-ink-soft">Removed. Editing stays on until {day(state!.addonUntil)}.</p>}
            {annual
              ? <p className="text-sm text-ink-soft">Available on monthly plans now; annual plans are coming soon.</p>
              : <Button onClick={() => call("preview")} disabled={busy !== null}>{busy === "preview" && <Loader2 className="h-4 w-4 animate-spin" />}{ending ? "Turn it back on" : "Add project scheduling"}</Button>}
          </div>
        )}
        {preview && (
          <div role="dialog" aria-labelledby={`${id}-pv`} className="rounded-xl border border-line bg-paper p-4" data-testid="pm-preview">
            <h3 id={`${id}-pv`} className="font-display font-bold">Add project scheduling?</h3>
            <dl className="mt-2 space-y-1 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-ink-soft">New charge</dt><dd className="font-semibold">{formatCents(preview.monthlyCents)}/{preview.interval === "year" ? "year" : "month"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-soft">Billing</dt><dd>With your plan, every {preview.interval === "year" ? "year" : "month"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-soft">Starts</dt><dd>Today, {day(preview.effective)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-soft">Next invoice ({day(preview.nextInvoiceAt)})</dt><dd>+{formatCents(preview.monthlyCents)}</dd></div>
              <div className="flex justify-between gap-3 border-t border-line pt-1 font-bold"><dt>Charged now (prorated to {day(preview.nextInvoiceAt)})</dt><dd data-testid="pm-due-now">{formatCents(preview.dueNowCents)}</dd></div>
            </dl>
            <p className="mt-2 text-xs text-ink-soft">Your card on file is charged now. If it&apos;s declined, nothing is added. You can remove the add-on any time; editing stays on until the end of the period you paid for.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={() => call("add")} disabled={busy !== null}>{busy === "add" && <Loader2 className="h-4 w-4 animate-spin" />}Confirm and pay {formatCents(preview.dueNowCents)}</Button>
              <Button variant="secondary" onClick={() => setPreview(null)} disabled={busy !== null}>Cancel</Button>
            </div>
          </div>
        )}
        {err && <p role="alert" className="mt-2 text-sm text-danger">{err}</p>}
        {done && <p role="status" className="mt-2 text-sm text-ok">{done}</p>}
      </div>
    </Card>
  );
}
