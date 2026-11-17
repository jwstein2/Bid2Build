/**
 * Where an invoice is in its life: Draft → Issued → Email prepared → Sent → Paid (V6 P1-B).
 * Derived only from records: the invoice, its Built2Bid email messages (comm_messages) and a "sent outside
 * Built2Bid" mark (fin_invoice_sends). Nothing here sends anything.
 */
export type SendStep = "draft" | "issued" | "email_prepared" | "sent" | "paid";
export type SendState = SendStep | "email_failed" | "void";
export interface SendInfo { state: SendState; step: SendStep | null; at: string | null; via: "built2bid" | "own_email" | "printed" | "in_person" | "text" | "other" | null; partlyPaid: boolean; marked: boolean }

type Row = Record<string, unknown>;
const PREPARED = new Set(["draft", "scheduled", "awaiting_review", "approved", "sending", "paused"]);
const SENT = new Set(["sent", "delivered", "replied"]);
const num = (v: unknown) => { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; };
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export const STEPS: { key: SendStep; label: string }[] = [
  { key: "draft", label: "Draft" }, { key: "issued", label: "Issued" }, { key: "email_prepared", label: "Email prepared" }, { key: "sent", label: "Sent" }, { key: "paid", label: "Paid" },
];

export const SEND_LABEL: Record<SendState, string> = {
  draft: "Draft", issued: "Issued, not sent", email_prepared: "Email prepared", sent: "Sent", paid: "Paid", email_failed: "Email failed", void: "Void",
};

export const VIA_LABEL: Record<NonNullable<SendInfo["via"]>, string> = {
  built2bid: "by Built2Bid email", own_email: "from your email", printed: "printed", in_person: "in person", text: "by text", other: "",
};

/**
 * @param inv     a fin_invoice_balances_v row (status, balance, paid, credited)
 * @param emails  comm_messages for this invoice (status, sent_at, created_at)
 * @param mark    the live fin_invoice_sends row, if any (method, sent_on)
 */
export function invoiceSendInfo(inv: Row, emails: Row[], mark: Row | null): SendInfo {
  const status = str(inv.status);
  const paidAmt = num(inv.paid) + num(inv.credited);
  const base = { at: null, via: null, partlyPaid: false, marked: Boolean(mark) } as const;
  if (status === "void") return { ...base, state: "void", step: null };
  if (status === "draft") return { ...base, state: "draft", step: "draft" };
  const live = emails.filter((e) => !["canceled", "skipped"].includes(str(e.status)))
    .sort((a, b) => str(b.created_at).localeCompare(str(a.created_at)));
  const sentEmail = live.find((e) => SENT.has(str(e.status)));
  const sentAt = sentEmail ? str(sentEmail.sent_at) || str(sentEmail.created_at) : mark ? str(mark.sent_on) : null;
  const via: SendInfo["via"] = sentEmail ? "built2bid" : mark ? (str(mark.method) as SendInfo["via"]) : null;
  if (num(inv.balance) <= 0 && paidAmt > 0) return { ...base, state: "paid", step: "paid", at: sentAt, via };
  const partlyPaid = paidAmt > 0;
  if (sentAt) return { ...base, state: "sent", step: "sent", at: sentAt, via, partlyPaid };
  const latest = live[0];
  if (latest && str(latest.status) === "failed") return { ...base, state: "email_failed", step: "email_prepared", partlyPaid };
  if (latest && PREPARED.has(str(latest.status))) return { ...base, state: "email_prepared", step: "email_prepared", partlyPaid };
  return { ...base, state: "issued", step: "issued", partlyPaid };
}
