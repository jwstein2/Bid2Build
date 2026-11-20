import { Chip, Empty, Table, type Tone } from "@/components/admin/cc";
import { FEE_REASON, HOLD_REASON, PAYOUT_STATUS, money } from "@/lib/payouts/labels";

export interface PayoutRow {
  id: string; ref: string; staff_id: string; staff_name: string; mode: "test" | "live"; provider: string; speed: string; gross_cents: number; adjustments_cents: number;
  fee_cents: number; fee_bearer: "recipient" | "company"; fee_reason: string | null; net_cents: number; status: string; hold_reasons: string[]; scheduled_for: string;
  submitted_at: string | null; settled_at: string | null; failed_at: string | null; failure_code: string | null; failure_message: string | null; provider_ref: string | null;
  reconciliation: string; funding_source: string | null; created_at: string; attempts: number;
  destination: { institution_name: string | null; last4: string | null; account_type: string } | null;
  items: { source_kind: string; source_id: string; amount_cents: number; description: string | null; active: boolean }[];
}

export const STATUS_TONE: Record<string, Tone> = { scheduled: "blue", held: "amber", needs_approval: "amber", submitting: "violet", submitted: "violet", paid: "green", failed: "red", returned: "red", canceled: "muted" };
const d = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");

/**
 * Payout ledger: original earnings (items), fee and who bore it, net, schedule, provider evidence and reconciliation.
 * `actions` renders owner/finance controls per row (forms), so the same table serves the owner and finance views.
 */
export function PayoutLedger({ rows, actions }: { rows: PayoutRow[]; actions?: (p: PayoutRow) => React.ReactNode }) {
  if (rows.length === 0) return <Empty>No payouts here.</Empty>;
  return (
    <Table head={["Reference", "Recipient", "Earned", "Fee", "Net", "Dates", "Status", "Provider / recon", ...(actions ? [""] : [])]} minWidth={1100} align={["l", "l", "r", "r", "r", "l", "l", "l", "l"]}>
      {rows.map((p) => (
        <tr key={p.id} className="align-top">
          <td className="text-xs text-white">{p.ref}{p.mode === "test" && <div><Chip tone="muted">TEST · no money moved</Chip></div>}</td>
          <td className="text-xs text-white">{p.staff_name}<div className="text-ink-soft">{p.destination ? `${p.destination.institution_name ?? "Bank"} ••${p.destination.last4 ?? "?"}` : "—"}</div></td>
          <td className="text-right text-xs text-white">{money(p.gross_cents)}<div className="text-ink-soft">{p.items.filter((i) => i.active || p.status !== "canceled").map((i) => i.description).join(", ")}</div>{p.adjustments_cents !== 0 && <div className="text-ink-soft">adj {money(p.adjustments_cents)}</div>}</td>
          <td className="text-right text-xs text-white">{money(p.fee_cents)}<div className="text-ink-soft">{p.fee_bearer === "recipient" ? "paid by recipient" : `Built2Bid${p.fee_reason ? `: ${FEE_REASON[p.fee_reason] ?? p.fee_reason}` : ""}`}</div></td>
          <td className="text-right text-xs font-bold text-white">{money(p.net_cents)}</td>
          <td className="text-xs text-ink-soft">Pay date {d(p.scheduled_for)}<div>Sent {d(p.submitted_at)}</div><div>{p.status === "paid" ? `Settled ${d(p.settled_at)}` : p.failed_at ? `Ended ${d(p.failed_at)}` : ""}</div></td>
          <td className="text-xs"><Chip tone={STATUS_TONE[p.status] ?? "muted"}>{PAYOUT_STATUS[p.status] ?? p.status}</Chip>
            {p.hold_reasons.length > 0 && <ul className="mt-1 text-[11px] text-[var(--cc-amber)]">{p.hold_reasons.map((h) => <li key={h}>{HOLD_REASON[h] ?? h}</li>)}</ul>}
            {p.failure_code && <div className="mt-1 text-[11px] text-[var(--cc-red)]">{p.failure_code}{p.failure_message ? `: ${p.failure_message}` : ""}</div>}</td>
          <td className="text-[11px] text-ink-soft">{p.provider_ref ?? "not sent"}<div>{p.reconciliation}</div>{p.attempts > 1 && <div>{p.attempts} attempts</div>}</td>
          {actions && <td className="text-xs">{actions(p)}</td>}
        </tr>
      ))}
    </Table>
  );
}
