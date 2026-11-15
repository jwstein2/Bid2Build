/**
 * Signing status of a bid, derived from its signing requests and signatures. Kept separate from the
 * estimate's own lifecycle (draft / finalized / archived): a signed bid is not paid or completed.
 */
export type SigningState = "none" | "awaiting" | "signed" | "expired" | "revoked";

export interface RequestRow { id: string; estimate_id: string; version_id: string; status: "pending" | "signed" | "revoked"; expires_at: string; created_at: string; revoke_reason?: string | null; signed_at?: string | null }
export interface SignatureRow { id: string; estimate_id: string; version_id: string; version_number: number; total: number | string; signed_at: string; signer_name: string; pdf_status: "pending" | "ready" | "failed"; customer_name?: string; project_title?: string; proposal_number?: string }

export interface BidSigning {
  state: SigningState;
  /** Most recent signature on the bid, if any (it stays visible when a revision is out for signature). */
  signed: { id: string; at: string; versionNumber: number; total: number; pdfStatus: SignatureRow["pdf_status"] } | null;
  /** The newest request (drives Awaiting / Expired / Revoked). */
  latest: { id: string; versionId: string; expiresAt: string; createdAt: string } | null;
}

export const SIGNING_LABELS: Record<SigningState, string> = { none: "Not sent", awaiting: "Awaiting Signature", signed: "Signed", expired: "Expired", revoked: "Revoked" };

export function bidSigning(requests: RequestRow[], signatures: SignatureRow[], now = new Date()): BidSigning {
  const sig = [...signatures].sort((a, b) => b.signed_at.localeCompare(a.signed_at))[0] ?? null;
  const req = [...requests].sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
  const signed = sig ? { id: sig.id, at: sig.signed_at, versionNumber: sig.version_number, total: Number(sig.total), pdfStatus: sig.pdf_status } : null;
  const latest = req ? { id: req.id, versionId: req.version_id, expiresAt: req.expires_at, createdAt: req.created_at } : null;
  let state: SigningState = "none";
  if (req) {
    if (req.status === "signed") state = "signed";
    else if (req.status === "revoked") state = signed ? "signed" : "revoked";
    else if (new Date(req.expires_at) <= now) state = signed ? "signed" : "expired";
    else state = "awaiting";
  } else if (signed) state = "signed";
  return { state, signed, latest };
}

/** Group rows by estimate and derive each bid's signing status. */
export function signingByEstimate(requests: RequestRow[], signatures: SignatureRow[], now = new Date()): Map<string, BidSigning> {
  const ids = new Set([...requests.map((r) => r.estimate_id), ...signatures.map((s) => s.estimate_id)]);
  const out = new Map<string, BidSigning>();
  for (const id of ids) out.set(id, bidSigning(requests.filter((r) => r.estimate_id === id), signatures.filter((s) => s.estimate_id === id), now));
  return out;
}

/** "Today at 2:14 PM", "Yesterday at 9:05 AM", or "Nov 3 at 4:30 PM" in the viewer's time zone. */
export function signedWhen(iso: string, now = new Date(), timeZone?: string): string {
  const d = new Date(iso);
  const day = (x: Date) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(x);
  const time = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(d);
  if (day(d) === day(now)) return `Today at ${time}`;
  if (day(d) === day(new Date(now.getTime() - 86_400_000))) return `Yesterday at ${time}`;
  const sameYear = day(d).slice(0, 4) === day(now).slice(0, 4);
  const date = new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) }).format(d);
  return `${date} at ${time}`;
}

/** Signatures within the last `days`, newest first (the dashboard's "Recently Signed"). */
export function recentSignatures<T extends Pick<SignatureRow, "signed_at">>(rows: T[], days: number, now = new Date()): T[] {
  const since = now.getTime() - days * 86_400_000;
  return rows.filter((x) => new Date(x.signed_at).getTime() >= since).sort((a, b) => b.signed_at.localeCompare(a.signed_at));
}
