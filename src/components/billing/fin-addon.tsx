"use client";
import { Landmark } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button } from "../ui/button";
import { Badge, Card } from "../ui/misc";
import { formatCents } from "@/lib/enterprise/pricing";
import { FIN_SOLO_ANNUAL_CENTS, FIN_SOLO_CENTS } from "@/lib/financials/billing";

type Preview = { monthlyCents: number; interval: "month" | "year"; effective: string; dueNowCents: number; nextInvoiceAt: string | null; prorationDate: number };
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { dateStyle: "long" }) : "your next billing date");

/**
 * Solo Financials add-on: $21.99/month ($219.99/year on annual plans) on the Standard plan. Preview shows the exact charge first;
 * removal keeps recording on until the end of the paid period, and the books stay readable after.
 */
export function FinAddonCard({ active, periodEnd, annual, purchasable, hasPlan }: {
  active: boolean; periodEnd: string | null; annual: boolean; purchasable: boolean; hasPlan: boolean;
}) {
  const router = useRouter();
  const id = useId();
  const price = annual ? `${formatCents(FIN_SOLO_ANNUAL_CENTS)}/year` : `${formatCents(FIN_SOLO_CENTS)}/month`;
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [attempt] = useState(() => crypto.randomUUID());

  async function call(action: "preview" | "add" | "remove") {
    setBusy(action); setErr(null); setDone(null);
    const r = await fetch("/api/billing/fin-addon", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, prorationDate: preview?.prorationDate, attempt: `${attempt}-${action}` }),
    }).catch(() => null);
    const d = await r?.json().catch(() => null);
    setBusy(null);
    if (!r?.ok) { setErr(d?.error?.message ?? "Something went wrong. Nothing was changed."); return; }
    if (action === "preview") { setPreview(d as Preview); return; }
    setPreview(null); setConfirmRemove(false);
    setDone(action === "add" ? "Financials is on. You can record invoices, payments and costs now." : `Removed. You can keep recording until ${day(d.recordUntil)}; after that your books stay readable and exportable.`);
    router.refresh();
  }

  return (
    <Card className="p-5" data-testid="fin-addon">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent-ink"><Landmark className="h-5 w-5" aria-hidden /></span>
          <div>
            <h2 className="font-display text-lg font-bold">Financials add-on</h2>
            <p className="text-sm text-ink-soft">Invoices from your signed payment schedule, payments, job costs and budget vs actual. {price} on top of your plan, for you plus a free read-only seat for your accountant.</p>
          </div>
        </div>
        {active && <Badge tone="ok">active</Badge>}
      </div>
      <div className="mt-4">
        {active && !confirmRemove && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-ink-soft">{price}, billed with your plan. Next charge {day(periodEnd)}.</p>
            <Button variant="secondary" size="sm" onClick={() => setConfirmRemove(true)}>Remove add-on</Button>
          </div>
        )}
        {active && confirmRemove && (
          <div role="dialog" aria-labelledby={`${id}-rm`} className="rounded-xl border border-line bg-paper p-4">
            <h3 id={`${id}-rm`} className="font-display font-bold">Remove the Financials add-on?</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-soft">
              <li>No more add-on charges. There&apos;s no refund for the current period.</li>
              <li>You can keep recording until {day(periodEnd)}.</li>
              <li>After that your books stay readable and exportable. Nothing is deleted.</li>
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button loading={busy === "remove"} variant="danger" onClick={() => call("remove")} disabled={busy !== null}>Remove add-on</Button>
              <Button variant="secondary" onClick={() => setConfirmRemove(false)} disabled={busy !== null}>Keep it</Button>
            </div>
          </div>
        )}
        {!active && !preview && (
          !purchasable ? <p className="text-sm text-ink-soft">Coming soon. You&apos;ll be able to add Financials here shortly.</p>
          : !hasPlan ? <p className="text-sm text-ink-soft">Financials is added to the Individual Unlimited plan. <a href="/pricing" className="font-semibold underline">See plans</a></p>
          : <Button loading={busy === "preview"} onClick={() => call("preview")} disabled={busy !== null}>Add Financials, {price}</Button>
        )}
        {preview && (
          <div role="dialog" aria-labelledby={`${id}-pv`} className="rounded-xl border border-line bg-paper p-4" data-testid="fin-preview">
            <h3 id={`${id}-pv`} className="font-display font-bold">Add Financials?</h3>
            <dl className="mt-2 space-y-1 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-ink-soft">New charge</dt><dd className="font-semibold">{formatCents(preview.monthlyCents)}/{preview.interval === "year" ? "year" : "month"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-soft">Starts</dt><dd>Today, {day(preview.effective)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-soft">Next invoice ({day(preview.nextInvoiceAt)})</dt><dd>+{formatCents(preview.monthlyCents)}</dd></div>
              <div className="flex justify-between gap-3 border-t border-line pt-1 font-bold"><dt>Charged now (prorated to {day(preview.nextInvoiceAt)})</dt><dd>{formatCents(preview.dueNowCents)}</dd></div>
            </dl>
            <p className="mt-2 text-xs text-ink-soft">Your card on file is charged now. If it&apos;s declined, nothing is added. No long-term contract: remove it any time; paid periods aren&apos;t refunded.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button loading={busy === "add"} onClick={() => call("add")} disabled={busy !== null}>Confirm and pay {formatCents(preview.dueNowCents)}</Button>
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
