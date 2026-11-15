"use client";
import { CalendarRange, Loader2, Minus, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button } from "../ui/button";
import { Card } from "../ui/misc";
import { formatCents } from "@/lib/enterprise/pricing";
import { PM_EDITOR_CENTS, PM_INCLUDED_ENTERPRISE_EDITORS } from "@/lib/pm/billing";

type Preview = { fromExtra: number; toExtra: number; beforeCents: number; afterCents: number; deltaCents: number; dueNowCents: number; creditCents: number; effective: string; prorationDate: number; nextInvoiceAt: string | null };
type Member = { id: string; name: string; role: string };
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { dateStyle: "long" }) : "your next invoice");

/**
 * Enterprise schedule editors: one included, more at $1.99/month each (separate from licensed users),
 * and who holds them. Everyone else in the company can view schedules.
 */
export function PmEditorsCard({ limit, extra, canBuy, comp, members, assigned }: {
  limit: number; extra: number; canBuy: boolean; comp: boolean; members: Member[]; assigned: string[];
}) {
  const router = useRouter();
  const id = useId();
  const [target, setTarget] = useState(extra + 1);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [attempt] = useState(() => crypto.randomUUID());
  const minExtra = Math.max(0, assigned.length - PM_INCLUDED_ENTERPRISE_EDITORS);
  const set = (n: number) => { setTarget(Math.max(minExtra, Math.min(1000, Math.round(n) || 0))); setPreview(null); setErr(null); setDone(null); };

  async function buy(action: "preview" | "confirm") {
    setBusy(action); setErr(null);
    const r = await fetch("/api/company/pm-editors", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, extra: target, fromExtra: extra, prorationDate: preview?.prorationDate, attempt }),
    }).catch(() => null);
    const d = await r?.json().catch(() => null);
    setBusy(null);
    if (!r?.ok) { setErr(d?.error?.message ?? "Something went wrong. Nothing was changed."); return; }
    if (action === "preview") setPreview(d as Preview);
    else { setPreview(null); setDone(`You now have ${PM_INCLUDED_ENTERPRISE_EDITORS + d.extra} schedule editor seats.`); router.refresh(); }
  }

  async function toggle(userId: string, on: boolean) {
    setBusy(userId); setErr(null); setDone(null);
    const r = await fetch("/api/company/pm-editors/assign", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId, assign: on }) }).catch(() => null);
    const d = await r?.json().catch(() => null);
    setBusy(null);
    if (!r?.ok) { setErr(d?.error?.message ?? "Couldn't update editors."); return; }
    router.refresh();
  }

  const adding = target > extra;
  const full = assigned.length >= limit;
  return (
    <Card className="p-5" data-testid="pm-editors">
      <div className="flex gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent-ink"><CalendarRange className="h-5 w-5" aria-hidden /></span>
        <div>
          <h2 className="font-display text-lg font-bold">Project scheduling editors</h2>
          <p className="text-sm text-ink-soft">
            {PM_INCLUDED_ENTERPRISE_EDITORS} schedule editor is included with Enterprise. Extra editors are {formatCents(PM_EDITOR_CENTS)}/month each and don&apos;t change your licensed users.
            Everyone else in your company can view schedules.
          </p>
        </div>
      </div>
      <p className="mt-3 text-sm font-semibold" data-testid="pm-editor-summary">{assigned.length} of {limit} editor seat{limit === 1 ? "" : "s"} assigned{extra > 0 ? ` (${PM_INCLUDED_ENTERPRISE_EDITORS} included + ${extra} paid)` : ""}</p>

      <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
        {members.map((m) => {
          const on = assigned.includes(m.id);
          return (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="min-w-0"><span className="font-medium">{m.name}</span> <span className="text-muted capitalize">· {m.role}</span></span>
              <span className="flex items-center gap-2">
                <span className={on ? "text-ok" : "text-muted"}>{on ? "Can edit" : "View only"}</span>
                <Button size="sm" variant={on ? "ghost" : "secondary"} disabled={busy !== null || (!on && full)} onClick={() => toggle(m.id, !on)} aria-label={`${on ? "Remove" : "Make"} ${m.name} ${on ? "as" : "a"} schedule editor`}>
                  {busy === m.id && <Loader2 className="h-4 w-4 animate-spin" />}{on ? "Remove" : "Make editor"}
                </Button>
              </span>
            </li>
          );
        })}
      </ul>
      {full && <p className="mt-1 text-xs text-ink-soft">All editor seats are in use. {canBuy ? "Add a seat below or remove someone first." : comp ? "Contact Built2Bid to arrange more." : ""}</p>}

      {canBuy && (
        <div className="mt-4 border-t border-line pt-4">
          <label htmlFor={`${id}-n`} className="text-sm font-semibold">Extra editor seats</label>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" aria-label="Fewer editor seats" onClick={() => set(target - 1)} disabled={target <= minExtra}><Minus className="h-4 w-4" /></Button>
            <input id={`${id}-n`} type="number" inputMode="numeric" min={minExtra} value={target} onChange={(e) => set(Number(e.target.value))} className="h-10 w-20 rounded-lg border border-line bg-surface px-3 text-center text-base font-semibold" />
            <Button type="button" variant="secondary" aria-label="More editor seats" onClick={() => set(target + 1)}><Plus className="h-4 w-4" /></Button>
            <Button type="button" onClick={() => buy("preview")} disabled={busy !== null || target === extra}>{busy === "preview" && <Loader2 className="h-4 w-4 animate-spin" />}Preview change</Button>
          </div>
          {preview && (
            <div role="dialog" aria-labelledby={`${id}-c`} className="mt-4 rounded-xl border border-line bg-paper p-4" data-testid="pm-editor-preview">
              <h3 id={`${id}-c`} className="font-display font-bold">{adding ? "Add" : "Remove"} {Math.abs(preview.toExtra - preview.fromExtra)} editor seat{Math.abs(preview.toExtra - preview.fromExtra) === 1 ? "" : "s"}?</h3>
              <dl className="mt-2 space-y-1 text-sm">
                <div className="flex justify-between gap-3"><dt className="text-ink-soft">Editor seats now</dt><dd>{formatCents(preview.beforeCents)}/month</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-ink-soft">New editor seats charge</dt><dd className="font-semibold">{formatCents(preview.afterCents)}/month</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-ink-soft">Effective</dt><dd>Today, {day(preview.effective)}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-ink-soft">Next invoice ({day(preview.nextInvoiceAt)})</dt><dd>{preview.deltaCents > 0 ? "+" : ""}{formatCents(preview.deltaCents)}/month</dd></div>
                {adding
                  ? <div className="flex justify-between gap-3 border-t border-line pt-1 font-bold"><dt>Charged now (prorated)</dt><dd data-testid="pm-editor-due">{formatCents(preview.dueNowCents)}</dd></div>
                  : <div className="flex justify-between gap-3 border-t border-line pt-1 font-bold"><dt>Credit on your next invoice</dt><dd>{formatCents(preview.creditCents)}</dd></div>}
              </dl>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button onClick={() => buy("confirm")} disabled={busy !== null}>{busy === "confirm" && <Loader2 className="h-4 w-4 animate-spin" />}{adding ? `Confirm and pay ${formatCents(preview.dueNowCents)}` : "Confirm removal"}</Button>
                <Button variant="secondary" onClick={() => setPreview(null)} disabled={busy !== null}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      )}
      {err && <p role="alert" className="mt-2 text-sm text-danger">{err}</p>}
      {done && <p role="status" className="mt-2 text-sm text-ok">{done}</p>}
    </Card>
  );
}
