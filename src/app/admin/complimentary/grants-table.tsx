"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Notice } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/builder/dialogs";
import { DURATION_PRESETS, INCLUDED_SEATS, MAX_EXTRA_SEATS, MAX_GRANT_DAYS, STATE_LABELS, STATE_TONES, daysLeft, type CompHistoryEntry, type CompRow } from "@/lib/comp/grants";
import { extendGrant, grantDetail, pauseGrant, resendInvitation, resumeGrant, revokeGrant, setExtraSeats, type ActionResult } from "./actions";
import { CopyLink } from "./copy-link";

type Dialog = { kind: "extend" | "revoke" | "pause" | "resume" | "resend" | "seats" | "details"; row: CompRow } | null;

function LocalDate({ iso, time }: { iso: string | null; time?: boolean }) {
  if (!iso) return <span className="text-muted">—</span>;
  const d = new Date(iso);
  return <time dateTime={iso} suppressHydrationWarning>{time ? d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : d.toLocaleDateString(undefined, { dateStyle: "medium" })}</time>;
}

const PLAN_SHORT = { unlimited: "Unlimited", enterprise: "Enterprise" } as const;

function actionsFor(r: CompRow): Exclude<Dialog, null>["kind"][] {
  const a: Exclude<Dialog, null>["kind"][] = [];
  if (r.state !== "revoked") a.push("extend");
  if (r.state === "active") a.push("pause");
  if (r.state === "paused") a.push("resume");
  if (r.state === "pending" || r.state === "invite_expired") a.push("resend");
  if (r.plan === "enterprise" && r.state !== "revoked") a.push("seats");
  if (r.state !== "revoked") a.push("revoke");
  a.push("details");
  return a;
}

const ACTION_LABELS = { extend: "Extend", pause: "Pause", resume: "Resume", resend: "Resend invitation", seats: "Seats", revoke: "Revoke", details: "Details" } as const;

function Paid({ r }: { r: CompRow }) {
  if (r.converted) return <Badge tone="ok">Converted</Badge>;
  if (r.paid_now) return <Badge tone="brand">Already paying</Badge>;
  return <span className="text-muted">—</span>;
}

function Expiry({ r }: { r: CompRow }) {
  if (r.state === "pending" || r.state === "invite_expired") return <span className="text-ink-soft">{r.duration_days} days after accepting</span>;
  const left = daysLeft(r.expires_at);
  return <span><LocalDate iso={r.expires_at} />{r.state === "active" && left !== null && <span className={`block text-xs ${left <= 7 ? "font-semibold text-warn" : "text-muted"}`}>{left} day{left === 1 ? "" : "s"} left</span>}</span>;
}

export function GrantsTable({ rows, filtered }: { rows: CompRow[]; filtered: boolean }) {
  const [dialog, setDialog] = useState<Dialog>(null);
  if (rows.length === 0) {
    return <p className="rounded-xl border border-line bg-surface p-6 text-center text-sm text-muted">{filtered ? "No grants match these filters." : "No complimentary grants yet. Use the form above to grant access."}</p>;
  }
  const actionButtons = (r: CompRow) => (
    <div className="flex flex-wrap gap-1">
      {actionsFor(r).map((k) => (
        <button key={k} type="button" onClick={() => setDialog({ kind: k, row: r })}
          className={`min-h-9 rounded-md border px-2 py-1 text-xs font-semibold ${k === "revoke" ? "border-danger/40 text-danger hover:bg-danger-tint" : "border-line-strong hover:bg-paper"}`}>
          {ACTION_LABELS[k]}<span className="sr-only"> for {r.email}</span>
        </button>
      ))}
    </div>
  );
  return (
    <>
      {/* Desktop table */}
      <div className="hidden overflow-x-auto rounded-xl border border-line bg-surface lg:block">
        <table className="w-full min-w-[1100px] text-sm">
          <thead className="bg-paper text-left text-xs uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="px-3 py-2">Recipient</th><th className="px-3 py-2">Plan</th><th className="px-3 py-2">Seats</th>
              <th className="px-3 py-2">Starts</th><th className="px-3 py-2">Expires</th><th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Last activity</th><th className="px-3 py-2">Granted by</th><th className="px-3 py-2">Paid</th><th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-line align-top">
                <td className="max-w-[16rem] px-3 py-2"><p className="break-all font-semibold">{r.email}</p>{r.account_name && <p className="text-xs text-ink-soft">{r.account_name}</p>}</td>
                <td className="px-3 py-2">{PLAN_SHORT[r.plan]}</td>
                <td className="tabular px-3 py-2">{r.included_seats + r.extra_seats}{r.extra_seats > 0 && <span className="block text-xs text-muted">+{r.extra_seats} extra</span>}</td>
                <td className="px-3 py-2"><LocalDate iso={r.starts_at} /></td>
                <td className="px-3 py-2"><Expiry r={r} /></td>
                <td className="px-3 py-2"><Badge tone={STATE_TONES[r.state]}>{STATE_LABELS[r.state]}</Badge></td>
                <td className="px-3 py-2"><LocalDate iso={r.last_activity_at} /></td>
                <td className="max-w-[10rem] break-all px-3 py-2 text-xs text-ink-soft">{r.granted_by_email ?? "—"}</td>
                <td className="px-3 py-2"><Paid r={r} /></td>
                <td className="px-3 py-2">{actionButtons(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <ul className="space-y-3 lg:hidden">
        {rows.map((r) => (
          <li key={r.id} className="rounded-xl border border-line bg-surface p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0"><p className="break-all font-semibold">{r.email}</p>{r.account_name && <p className="text-xs text-ink-soft">{r.account_name}</p>}</div>
              <Badge tone={STATE_TONES[r.state]}>{STATE_LABELS[r.state]}</Badge>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-ink-soft">Plan</dt><dd>{PLAN_SHORT[r.plan]} · {r.included_seats + r.extra_seats} seat{r.included_seats + r.extra_seats === 1 ? "" : "s"}</dd>
              <dt className="text-ink-soft">Starts</dt><dd><LocalDate iso={r.starts_at} /></dd>
              <dt className="text-ink-soft">Expires</dt><dd><Expiry r={r} /></dd>
              <dt className="text-ink-soft">Last activity</dt><dd><LocalDate iso={r.last_activity_at} /></dd>
              <dt className="text-ink-soft">Paid</dt><dd><Paid r={r} /></dd>
            </dl>
            <div className="mt-3">{actionButtons(r)}</div>
          </li>
        ))}
      </ul>

      {dialog && <ActionDialog dialog={dialog} onClose={() => setDialog(null)} />}
    </>
  );
}

function ActionDialog({ dialog, onClose }: { dialog: Exclude<Dialog, null>; onClose: () => void }) {
  const { kind, row } = dialog;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [days, setDays] = useState("30");
  const [reason, setReason] = useState("");
  const [seats, setSeats] = useState(String(row.extra_seats));
  const [approve, setApprove] = useState(false);
  const [detail, setDetail] = useState<{ history: CompHistoryEntry[]; row: CompRow } | null | "error">(null);

  const run = (fn: () => Promise<ActionResult>) => start(async () => { const r = await fn(); setResult(r); if (r.ok) router.refresh(); });

  useEffect(() => {
    if (kind !== "details") return;
    let live = true;
    grantDetail(row.id).then((d) => { if (live) setDetail(d.ok ? { history: d.history, row: d.row } : "error"); }, () => { if (live) setDetail("error"); });
    return () => { live = false; };
  }, [kind, row.id]);

  const done = result?.ok;
  const titles = {
    extend: "Extend complimentary access", pause: "Pause complimentary access", resume: "Resume complimentary access",
    resend: "Resend invitation", seats: "Complimentary Enterprise seats", revoke: "Revoke complimentary access", details: "Grant details",
  } as const;

  const footer = (confirmLabel: string, onConfirm: () => void, danger = false, disabled = false) => (
    <div className="mt-5 flex flex-wrap justify-end gap-2">
      <Button variant="ghost" onClick={onClose}>{done ? "Close" : "Cancel"}</Button>
      {!done && <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} disabled={pending || disabled}>{pending ? "Working…" : confirmLabel}</Button>}
    </div>
  );

  const d = Number(days);
  const daysOk = Number.isInteger(d) && d >= 1 && d <= MAX_GRANT_DAYS;
  const s = Number(seats);
  const seatsOk = Number.isInteger(s) && s >= 0 && s <= MAX_EXTRA_SEATS && s !== row.extra_seats && approve;

  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose(); }} title={titles[kind]} description={row.email} wide={kind === "details"}>
      {kind === "extend" && (<>
        <p className="text-sm text-ink-soft">{row.state === "pending" || row.state === "invite_expired" ? `Adds days to the ${row.duration_days}-day period that starts when they accept.` : row.state === "expired" ? "This grant has ended. Extending restarts access from today." : "Adds days to the current end date."}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {DURATION_PRESETS.map((p) => <button key={p} type="button" onClick={() => setDays(String(p))} className={`min-h-10 rounded-md border px-3 text-sm ${days === String(p) ? "border-brand bg-brand-tint font-semibold" : "border-line-strong"}`}>+{p} days</button>)}
          <label className="flex items-center gap-1 text-sm">+<input type="number" min={1} max={MAX_GRANT_DAYS} value={days} onChange={(e) => setDays(e.target.value)} className="min-h-10 w-20 rounded-md border border-line-strong px-2" aria-label="Days to add" /> days</label>
        </div>
        {footer("Extend", () => run(() => extendGrant({ id: row.id, days: d })), false, !daysOk)}
      </>)}

      {kind === "pause" && (<>
        <p className="text-sm text-ink-soft">Access stops right away. When you resume, the end date moves out by however long it was paused, so they don&apos;t lose any days.</p>
        {footer("Pause access", () => run(() => pauseGrant(row.id)))}
      </>)}

      {kind === "resume" && (<>
        <p className="text-sm text-ink-soft">Access turns back on and the end date moves out by the time it was paused.</p>
        {footer("Resume access", () => run(() => resumeGrant(row.id)))}
      </>)}

      {kind === "resend" && (<>
        <p className="text-sm text-ink-soft">Sends a fresh invitation valid for 30 days. Any earlier link stops working.</p>
        {footer("Resend invitation", () => run(() => resendInvitation(row.id)))}
      </>)}

      {kind === "seats" && (<>
        <p className="text-sm text-ink-soft">{INCLUDED_SEATS.enterprise} licensed users are included. Extra complimentary seats are free for the company and need your explicit authorization.</p>
        <label className="mt-3 flex items-center gap-2 text-sm font-medium">Extra seats
          <input type="number" min={0} max={MAX_EXTRA_SEATS} value={seats} onChange={(e) => { setSeats(e.target.value); setApprove(false); }} className="min-h-10 w-24 rounded-md border border-line-strong px-2" />
          <span className="font-normal text-ink-soft">= {INCLUDED_SEATS.enterprise + (Number.isInteger(s) ? s : 0)} licensed users</span>
        </label>
        <label className="mt-3 flex items-start gap-2 rounded-md border border-warn/40 bg-warn-tint px-3 py-2 text-sm">
          <input type="checkbox" checked={approve} onChange={(e) => setApprove(e.target.checked)} className="mt-1" />
          <span>As the Built2Bid platform owner, I authorize this seat count.</span>
        </label>
        {footer("Save seats", () => run(() => setExtraSeats({ id: row.id, extraSeats: s, approve: true })), false, !seatsOk)}
      </>)}

      {kind === "revoke" && (<>
        <p className="text-sm text-ink-soft">Complimentary access ends immediately{row.state === "pending" ? " and the invitation link stops working" : ""}. Their account, bids, customers and any paid subscription are not affected. This can&apos;t be undone; you can create a new grant later.</p>
        <label className="mt-3 block text-sm font-medium">Reason <span className="font-normal text-muted">(optional, admins only)</span>
          <input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} className="mt-1 min-h-11 w-full rounded-md border border-line-strong px-3" />
        </label>
        {footer("Revoke access", () => run(() => revokeGrant(row.id, reason)), true)}
      </>)}

      {kind === "details" && (
        detail === "error" ? <Notice tone="danger">Could not load this grant.</Notice> :
        !detail ? <p className="text-sm text-muted" role="status">Loading…</p> : (
          <div className="space-y-4 text-sm">
            <dl className="grid grid-cols-[10rem_1fr] gap-y-1.5">
              <dt className="text-ink-soft">Status</dt><dd><Badge tone={STATE_TONES[detail.row.state]}>{STATE_LABELS[detail.row.state]}</Badge></dd>
              <dt className="text-ink-soft">Plan</dt><dd>{PLAN_SHORT[detail.row.plan]} · {detail.row.included_seats + detail.row.extra_seats} licensed user{detail.row.included_seats + detail.row.extra_seats === 1 ? "" : "s"}</dd>
              <dt className="text-ink-soft">Account</dt><dd>{detail.row.user_id ? (detail.row.account_name ?? "Account linked") : "Not activated yet"}</dd>
              <dt className="text-ink-soft">Granted</dt><dd><LocalDate iso={detail.row.created_at} time /> by {detail.row.granted_by_email ?? "—"}</dd>
              <dt className="text-ink-soft">Activated</dt><dd><LocalDate iso={detail.row.activated_at} time /></dd>
              <dt className="text-ink-soft">Access period</dt><dd>{detail.row.starts_at ? <><LocalDate iso={detail.row.starts_at} /> → <LocalDate iso={detail.row.expires_at} /></> : `${detail.row.duration_days} days after accepting`}</dd>
              {detail.row.invite_expires_at && detail.row.status === "pending" && <><dt className="text-ink-soft">Invitation</dt><dd>Sent {detail.row.invite_send_count}×, link expires <LocalDate iso={detail.row.invite_expires_at} /></dd></>}
              {detail.row.note && <><dt className="text-ink-soft">Note</dt><dd>{detail.row.note}</dd></>}
              {detail.row.revoke_reason && <><dt className="text-ink-soft">Revoke reason</dt><dd>{detail.row.revoke_reason}</dd></>}
              <dt className="text-ink-soft">Billing</dt><dd>{detail.row.converted ? "Subscribed after the grant" : detail.row.paid_now ? "Was already a paying customer" : "No paid subscription"}</dd>
            </dl>
            <div>
              <h3 className="font-semibold">History</h3>
              <ol className="mt-2 space-y-1.5">
                {detail.history.map((h, i) => (
                  <li key={i} className="flex flex-wrap gap-x-2 border-t border-line pt-1.5">
                    <span className="text-muted"><LocalDate iso={h.at} time /></span>
                    <span className="font-medium">{h.action.replace("comp.", "").replace(/_/g, " ")}</span>
                    <span className="text-ink-soft">{h.actor_email ?? ""}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )
      )}

      {result && (result.ok ? (
        <div className="mt-4 space-y-2">
          <Notice tone="ok">{result.message}</Notice>
          {result.warning && <Notice tone="warn" title="Invitation not sent">{result.warning}</Notice>}
          {result.inviteLink && <CopyLink link={result.inviteLink} />}
        </div>
      ) : <Notice tone="danger" className="mt-4">{result.error}</Notice>)}
    </Modal>
  );
}
