"use client";
import { ArrowRightLeft, CalendarRange, Loader2, Minus, Plus, UserMinus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button } from "../ui/button";
import { Badge, Card, Notice } from "../ui/misc";
import { formatCents } from "@/lib/enterprise/pricing";
import { PM_EDITOR_CENTS, PM_INCLUDED_ENTERPRISE_EDITORS } from "@/lib/pm/billing";
import { SEAT_TYPE_LABEL, seatBilling, type PmSeats } from "@/lib/pm/seats";

type Preview = { fromExtra: number; toExtra: number; beforeCents: number; afterCents: number; deltaCents: number; dueNowCents: number; creditCents: number; effective: string; prorationDate: number; nextInvoiceAt: string | null };
type Member = { id: string; name: string; role: string };
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { dateStyle: "long" }) : "your next invoice");
const when = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/**
 * Enterprise scheduling editor seats (V4 Phase 9): who holds each seat, its kind and billing status,
 * when it last changed, and controls to assign, reassign or remove. Moving a seat never buys another
 * one, and removing someone warns first: their schedules stay, they just become view-only.
 * canManage = manage_pm_seats; canBuy = manage_pm_addons plus an active paid subscription.
 */
export function PmEditorsCard({ seats, members, extra, canManage, canBuy, comp, billingHref }: {
  seats: PmSeats; members: Member[]; extra: number; canManage: boolean; canBuy: boolean; comp: boolean; billingHref?: string;
}) {
  const router = useRouter();
  const id = useId();
  const [target, setTarget] = useState(extra + 1);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [moving, setMoving] = useState<{ from: string; to: string } | null>(null);
  const [attempt] = useState(() => crypto.randomUUID());
  const assigned = seats.seats.map((x) => x.userId);
  const limit = seats.limit;
  const nameOf = (uid: string | null) => members.find((m) => m.id === uid)?.name ?? (uid ? "A former member" : "—");
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

  async function post(url: string, body: unknown, key: string, ok: string) {
    setBusy(key); setErr(null); setDone(null);
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const d = await r?.json().catch(() => null);
    setBusy(null);
    if (!r?.ok) { setErr(d?.error?.message ?? "Couldn't update seats. Nothing was changed."); return false; }
    setDone(ok); setConfirmRemove(null); setMoving(null); router.refresh();
    return true;
  }
  const assign = (m: Member) => post("/api/company/pm-editors/assign", { userId: m.id, assign: true }, m.id, `${m.name} can now edit schedules.`);
  const remove = (uid: string) => post("/api/company/pm-editors/assign", { userId: uid, assign: false }, uid, `${nameOf(uid)} is now view-only. Their schedules are unchanged.`);
  const reassign = (from: string, to: string) => post("/api/company/pm-editors/reassign", { from, to }, from, `Seat moved to ${nameOf(to)}. Your billed seats didn't change.`);

  const adding = target > extra;
  const full = assigned.length >= limit;
  return (
    <Card className="p-5" data-testid="pm-editors">
      <div className="flex gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent-ink"><CalendarRange className="h-5 w-5" aria-hidden /></span>
        <div>
          <h2 className="font-display text-lg font-bold">Project Command Center editors</h2>
          <p className="text-sm text-ink-soft">
            {PM_INCLUDED_ENTERPRISE_EDITORS} schedule editor is included with Team. Extra editors are {formatCents(PM_EDITOR_CENTS)}/month each and don&apos;t change your licensed users.
            Everyone else in your company can view schedules.
          </p>
        </div>
      </div>
      <p className="mt-3 text-sm font-semibold" data-testid="pm-editor-summary">{assigned.length} of {limit} editor seat{limit === 1 ? "" : "s"} assigned{extra > 0 ? ` (${PM_INCLUDED_ENTERPRISE_EDITORS} included + ${extra} paid)` : ""}</p>

      <ul className="mt-2 divide-y divide-line rounded-lg border border-line" data-testid="pm-seats">
        {seats.seats.length === 0 && <li className="px-3 py-3 text-sm text-muted">No one holds a seat yet. Everyone can view schedules.</li>}
        {seats.seats.map((x) => {
          const n = seats.schedules[x.userId] ?? 0;
          const others = members.filter((m) => !assigned.includes(m.id));
          return (
            <li key={x.userId} className="space-y-2 px-3 py-3 text-sm" data-testid={`seat-${x.userId}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold">{nameOf(x.userId)} <span className="font-normal capitalize text-muted">· {members.find((m) => m.id === x.userId)?.role ?? ""}</span></p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
                    <Badge tone={x.covered ? (x.seatType === "paid" ? "accent" : "ok") : "warn"}>{SEAT_TYPE_LABEL[x.seatType]}</Badge>
                    <span>{seatBilling(x)}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-muted">Effective {when(x.changedAt)} · Last change by {nameOf(x.changedBy)}{x.changedAt !== x.assignedAt ? ` · seat first assigned ${when(x.assignedAt)}` : ""}</p>
                </div>
                {canManage && (
                  <span className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" disabled={busy !== null || others.length === 0} onClick={() => { setMoving({ from: x.userId, to: "" }); setConfirmRemove(null); }} data-testid={`reassign-${x.userId}`}><ArrowRightLeft className="h-4 w-4" aria-hidden /> Reassign</Button>
                    <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => { setConfirmRemove(x.userId); setMoving(null); }} data-testid={`remove-${x.userId}`}><UserMinus className="h-4 w-4" aria-hidden /> Remove</Button>
                  </span>
                )}
              </div>
              {moving?.from === x.userId && (
                <div className="rounded-lg border border-line bg-paper p-3" role="group" aria-label={`Reassign ${nameOf(x.userId)}'s seat`} data-testid="reassign-panel">
                  <label className="block"><span className="label">Give this seat to</span>
                    <select className="field" value={moving.to} onChange={(e) => setMoving({ ...moving, to: e.target.value })} data-testid="reassign-to">
                      <option value="">Choose a team member…</option>
                      {others.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </label>
                  <p className="mt-2 text-xs text-ink-soft">The seat keeps its place and kind, so nothing is bought or charged again. {nameOf(x.userId)} becomes view-only{n ? ` on ${n} schedule${n === 1 ? "" : "s"}` : ""}; every schedule and its history stay as they are.</p>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" disabled={!moving.to || busy !== null} onClick={() => reassign(x.userId, moving.to)} data-testid="reassign-confirm">{busy === x.userId && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Move seat</Button>
                    <Button size="sm" variant="secondary" onClick={() => setMoving(null)}>Cancel</Button>
                  </div>
                </div>
              )}
              {confirmRemove === x.userId && (
                <div role="alertdialog" aria-labelledby={`${id}-rm-${x.userId}`} data-testid="remove-confirm">
                  <Notice tone="warn" title={`Remove ${nameOf(x.userId)}'s editor seat?`}>
                    <span id={`${id}-rm-${x.userId}`}>{n ? `They can currently edit ${n} company schedule${n === 1 ? "" : "s"}. ` : ""}After this they can still view schedules but can&apos;t change them. No schedule, task or customer update is deleted.{x.seatType === "paid" ? " The paid seat stays on your subscription until you remove it under Billing." : ""}</span>
                  </Notice>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant="danger" disabled={busy !== null} onClick={() => remove(x.userId)} data-testid="remove-yes">{busy === x.userId && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Remove seat</Button>
                    <Button size="sm" variant="secondary" onClick={() => setConfirmRemove(null)}>Keep</Button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {canManage && (() => {
        const others = members.filter((m) => !assigned.includes(m.id));
        if (!others.length) return null;
        return (
          <div className="mt-3">
            <p className="text-sm font-semibold">View-only members</p>
            <ul className="mt-1 divide-y divide-line rounded-lg border border-line">
              {others.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0"><span className="font-medium">{m.name}</span> <span className="capitalize text-muted">· {m.role}</span></span>
                  <Button size="sm" variant="secondary" disabled={busy !== null || full} onClick={() => assign(m)} aria-label={`Make ${m.name} a schedule editor`}>{busy === m.id && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Make editor</Button>
                </li>
              ))}
            </ul>
          </div>
        );
      })()}
      {full && canManage && <p className="mt-1 text-xs text-ink-soft">All editor seats are in use. Reassign a seat, or {canBuy ? "add a seat below." : comp ? "contact Built2Bid to arrange more." : billingHref ? <>ask your company owner to add one under <a className="underline" href={billingHref}>Billing</a>.</> : "ask your company owner to add one."}</p>}

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
                  : <div className="flex justify-between gap-3 border-t border-line pt-1 font-bold"><dt>Refund or credit</dt><dd data-testid="pm-editor-no-credit">None (this period is already paid)</dd></div>}
              </dl>
              {!adding && <p className="mt-2 text-xs text-ink-soft">The unassigned editor seats are removed now. Your next invoice is at the new price.</p>}
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
