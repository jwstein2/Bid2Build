"use client";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Download, Hourglass, PenLine } from "lucide-react";
import { useState } from "react";
import { Button } from "../ui/button";
import { LocalTime } from "./local-time";
import { applicationLabel, EXECUTION_LABELS, executionState, type ContractorSignatureRow, type RequirementRow } from "@/lib/esign/contractor/status";
import { CONTRACTOR_SIGN_INTENT_NOTICE, MISSING_LABELS, signBeforeSendText } from "@/lib/esign/contractor/config";
import type { ContractorState } from "@/lib/esign/contractor/state";

/** A customer signature on this bid, as the Proposal step loads it. */
export interface SignedVersion { id: string; request_id?: string; version_id: string; version_number: number; signed_at: string }

/**
 * Contractor side of the signing panel (V5.3): status of the latest customer-signed version, the
 * countersign action for an authorized viewer, the executed PDF, and what happens on the next send.
 */
export function ContractorStatus({ estimateId, state, signed, pending, signBeforeSend, onSignBeforeSend, onChanged }: {
  estimateId: string; state: ContractorState; signed: SignedVersion | null; pending: boolean;
  signBeforeSend?: boolean; onSignBeforeSend?: (v: boolean) => void; onChanged: () => void;
}) {
  const res = state.resolution;
  const req: RequirementRow | undefined = signed ? state.requirements.find((r) => r.request_id === signed.request_id) : undefined;
  const k: ContractorSignatureRow | undefined = signed ? state.signatures.find((x) => x.version_id === signed.version_id) : undefined;
  const ex = signed ? executionState({ request_id: signed.request_id ?? "", version_id: signed.version_id }, req ?? null, k ?? null) : null;
  const designated = state.designatedName ?? "the designated signer";

  return (
    <div className="space-y-2 rounded-lg bg-paper p-3 text-sm" data-testid="contractor-status">
      <p className="text-xs font-bold uppercase tracking-wide text-muted">Contractor signature</p>
      {signed && ex === "fully_executed" && k && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-ok-tint px-2.5 py-0.5 text-xs font-bold text-ok" data-testid="execution-badge"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden />{EXECUTION_LABELS.fully_executed}</span>
          <span className="text-ink-soft">{k.signer_name}{k.signer_title ? `, ${k.signer_title}` : ""} · <LocalTime iso={k.applied_at} /></span>
          <ExecutedPdfButton signatureId={signed.id} />
          <p className="w-full text-xs text-muted">{applicationLabel(k)}.</p>
        </div>
      )}
      {signed && (ex === "awaiting_contractor" || ex === "historical") && (
        <Countersign estimateId={estimateId} versionId={signed.version_id} state={state} historical={ex === "historical"} designated={designated} onChanged={onChanged} />
      )}
      {signed && ex === "not_required" && <p className="text-ink-soft">Your signing policy didn&apos;t require a contractor signature when this link was created.</p>}

      {!signed && (
        <>
          {pending && state.signatures.length > 0 && <p className="flex items-center gap-1.5 text-ink-soft"><CheckCircle2 className="h-4 w-4 text-ok" aria-hidden /> Signed for the contractor by {state.signatures[0].signer_name} before sending. Waiting for the customer.</p>}
          {!pending && res && !res.required && <p className="text-ink-soft">Not required by your signing policy.</p>}
          {!pending && res?.required && res.autoEligible && res.autoTiming === "before_send" && <p className="text-ink-soft" data-testid="auto-preview">{designated}&apos;s signature will be applied automatically when you create the link (authorized in advance under your signing policy).</p>}
          {!pending && res?.required && !(res.autoEligible && res.autoTiming === "before_send") && (
            <>
              <p className="text-ink-soft">{res.autoEligible ? `${designated}'s signature will be applied automatically right after the customer signs.` : `After the customer signs, ${designated} countersigns. The contract shows "Awaiting Contractor Signature" until then.`}</p>
              {state.me.canSign && onSignBeforeSend && (
                <label className="flex items-start gap-2">
                  <input type="checkbox" className="mt-0.5 h-4 w-4" checked={Boolean(signBeforeSend)} onChange={(e) => onSignBeforeSend(e.target.checked)} data-testid="sign-before-send" />
                  <span>Sign now as <b>{state.me.name}</b> before sending. {signBeforeSendText({ signerName: state.me.name ?? "" })}</span>
                </label>
              )}
            </>
          )}
          {res?.required && res.missing && <Missing code={res.missing} me={state.me} />}
        </>
      )}
    </div>
  );
}

function Missing({ code, me }: { code: string; me: ContractorState["me"] }) {
  return (
    <p className="flex items-start gap-1.5 rounded-md bg-warn-tint p-2 text-warn" data-testid="missing-signer">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{MISSING_LABELS[code] ?? "No authorized contractor signer is set up yet."} You can still send the proposal; it stays Awaiting Contractor Signature until an authorized person signs.{" "}
        {!me.hasSignature ? <Link href="/settings/account/signature" className="font-semibold underline">Set up my signature</Link> : <Link href="/settings/company/signing" className="font-semibold underline">Signing settings</Link>}</span>
    </p>
  );
}

function Countersign({ estimateId, versionId, state, historical, designated, onChanged }: { estimateId: string; versionId: string; state: ContractorState; historical: boolean; designated: string; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const statement = state.statements.find((s) => s.versionId === versionId)?.text;
  async function sign() {
    setBusy(true); setErr(null);
    const r = await fetch(`/api/estimates/${estimateId}/countersign`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ versionId, confirm: ok }) }).catch(() => null);
    const d = await r?.json().catch(() => null);
    setBusy(false);
    if (!r?.ok) return setErr(d?.error?.message ?? "Couldn't sign. Nothing was signed. Please try again.");
    setOpen(false); onChanged();
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ${historical ? "bg-black/5 text-ink-soft" : "bg-warn-tint text-warn"}`} data-testid="execution-badge"><Hourglass className="h-3.5 w-3.5" aria-hidden />{historical ? EXECUTION_LABELS.historical : EXECUTION_LABELS.awaiting_contractor}</span>
        {state.me.canSign && !open && <Button size="sm" variant="accent" onClick={() => setOpen(true)} data-testid="countersign">{historical ? "Add countersignature" : "Countersign"}</Button>}
      </div>
      {!state.me.canSign && !historical && <p className="text-ink-soft">Waiting for {designated} to countersign.{state.me.reason === "no_signature_on_file" && <> You&apos;re authorized: <Link href="/settings/account/signature" className="font-semibold underline">set up your signature</Link> to sign it yourself.</>}</p>}
      {historical && <p className="text-xs text-muted">This proposal was signed before contractor signatures were recorded. The original stays exactly as signed; a countersignature added now is recorded separately with today&apos;s date, never backdated.</p>}
      {open && statement && (
        <div className="rounded-lg border border-line bg-surface p-3">
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5 h-4 w-4" checked={ok} onChange={(e) => setOk(e.target.checked)} data-testid="countersign-confirm" />
            <span className="text-ink-soft">{statement}</span>
          </label>
          <div className="mt-2 flex gap-2">
            <Button loading={busy} size="sm" variant="accent" onClick={() => void sign()} disabled={!ok || busy} data-testid="countersign-submit">{!busy && <PenLine className="h-4 w-4" aria-hidden />} Sign for the company</Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
          <p className="mt-2 text-xs text-muted" data-testid="countersign-intent">{CONTRACTOR_SIGN_INTENT_NOTICE}</p>
        </div>
      )}
      {err && <p className="text-danger" role="alert">{err}</p>}
    </div>
  );
}

export function ExecutedPdfButton({ signatureId, compact = true }: { signatureId: string; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go() {
    setBusy(true); setErr(null);
    const r = await fetch(`/api/signatures/${signatureId}/executed`, { cache: "no-store" }).catch(() => null);
    const d = await r?.json().catch(() => null);
    setBusy(false);
    if (!r?.ok || !d?.url) return setErr(d?.error?.message ?? "Couldn't prepare the download.");
    window.location.assign(d.url);
  }
  return (
    <span className="inline-flex flex-col">
      <Button loading={busy} size={compact ? "sm" : "md"} variant={compact ? "ghost" : "accent"} onClick={() => void go()} disabled={busy} data-testid="executed-pdf">{!busy && <Download className="h-4 w-4" aria-hidden />} Download Executed PDF</Button>
      {err && <span className="text-xs text-danger" role="alert">{err}</span>}
    </span>
  );
}
