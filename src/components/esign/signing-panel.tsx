"use client";
import Link from "next/link";
import { CheckCircle2, Clock, FileSignature, Hourglass, Link2, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { bidSigning, SIGNING_LABELS, type RequestRow, type SignatureRow } from "@/lib/esign/status";
import { Button } from "../ui/button";
import { LocalTime } from "./local-time";
import { SignedPdfButton } from "./signed-pdf-button";
import { ContractorStatus } from "./contractor-status";
import type { ContractorState } from "@/lib/esign/contractor/state";

/** A signing link just created; shown in the Email Proposal dialog. */
export interface CreatedLink { url: string; requestId: string; expiresAt: string; versionNumber: number; total: string; file?: File; message: string }

/** Signing status of this bid + Create Signing Link, on the Proposal step. */
export function SigningPanel({ estimateId, onCreate, creating, refreshKey, onRevoked, signBeforeSend, onSignBeforeSend }: {
  estimateId: string; onCreate: () => void; creating: boolean; refreshKey: number;
  /** V5.3: the bid owner signs for the contractor before the link is created (contractor-first). */
  signBeforeSend?: boolean; onSignBeforeSend?: (v: boolean) => void;
  /** A revoked link must never be offered again in the Email Proposal dialog. */
  onRevoked?: (requestId: string) => void;
}) {
  const [data, setData] = useState<{ requests: RequestRow[]; signatures: SignatureRow[]; contractor?: ContractorState | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await fetch(`/api/estimates/${estimateId}/signing`, { cache: "no-store" }).catch(() => null);
    if (r?.ok) setData(await r.json());
  }, [estimateId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads server state for this bid
  useEffect(() => { void load(); }, [load, refreshKey]);

  async function revoke(id: string) {
    setBusy(id); setErr(null);
    const r = await fetch(`/api/estimates/${estimateId}/signing/${id}`, { method: "DELETE" }).catch(() => null);
    if (!r?.ok) setErr("Couldn't revoke the link. Please try again.");
    else onRevoked?.(id);
    await load(); setBusy(null);
  }

  const s = data ? bidSigning(data.requests, data.signatures) : null;
  const pending = data?.requests.find((r) => r.status === "pending" && new Date(r.expires_at) > new Date());
  return (
    <section aria-labelledby="signing-h" className="mb-5 rounded-xl border border-line bg-surface p-4" data-testid="signing-panel" data-guide="builder.signing">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="signing-h" className="flex items-center gap-2 font-display text-lg font-extrabold text-navy"><FileSignature className="h-5 w-5" aria-hidden /> Get it signed online</h2>
          <p className="text-sm text-ink-soft">Your customer reviews this exact version and signs on their phone or computer. No account or payment needed.</p>
        </div>
        <Button loading={creating} variant="accent" onClick={onCreate} disabled={creating} data-testid="create-signing-link">
          {!creating && <Link2 className="h-4 w-4" aria-hidden />} Create Signing Link
        </Button>
      </div>
      {s && s.state !== "none" && (
        <div className="mt-3 space-y-2 border-t border-line pt-3 text-sm">
          {s.signed && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-ok-tint px-2.5 py-0.5 text-xs font-bold text-ok"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden />Signed v{s.signed.versionNumber}</span>
              <span className="text-ink-soft"><LocalTime iso={s.signed.at} /></span>
              <Link href={`/signed/${s.signed.id}`} className="font-semibold text-brand underline">View Signed Proposal</Link>
              <SignedPdfButton signatureId={s.signed.id} compact />
            </div>
          )}
          {s.state !== "signed" && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-black/5 px-2.5 py-0.5 text-xs font-bold text-ink-soft">
                {s.state === "awaiting" ? <Hourglass className="h-3.5 w-3.5" aria-hidden /> : s.state === "expired" ? <Clock className="h-3.5 w-3.5" aria-hidden /> : <XCircle className="h-3.5 w-3.5" aria-hidden />}
                {SIGNING_LABELS[s.state]}
              </span>
              {pending && <span className="text-ink-soft">Link expires <LocalTime iso={pending.expires_at} relative={false} /></span>}
              {pending && <Button size="sm" variant="ghost" onClick={() => void revoke(pending.id)} disabled={busy === pending.id}>Revoke link</Button>}
            </div>
          )}
          {s.signed && s.state === "signed" && <p className="text-xs text-muted">Changing the bid never alters the signed version. To get a revision signed, edit the bid and create a new signing link.</p>}
          {err && <p className="text-danger" role="alert">{err}</p>}
        </div>
      )}
      {data?.contractor && (
        <div className="mt-3 border-t border-line pt-3">
          <ContractorStatus estimateId={estimateId} state={data.contractor} pending={Boolean(pending)}
            signed={s?.signed ? (() => { const row = data.signatures.find((x) => x.id === s.signed!.id); return row ? { id: row.id, request_id: row.request_id, version_id: row.version_id, version_number: row.version_number, signed_at: row.signed_at } : null; })() : null}
            signBeforeSend={signBeforeSend} onSignBeforeSend={onSignBeforeSend} onChanged={() => void load()} />
        </div>
      )}
    </section>
  );
}
