"use client";
import Link from "next/link";
import { CheckCircle2, Clock, Copy, Check, Download, FileSignature, Hourglass, Link2, Loader2, Mail, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { bidSigning, SIGNING_LABELS, type RequestRow, type SignatureRow } from "@/lib/esign/status";
import { buildShareEmail, mailtoHref, type ShareEmailInput } from "@/lib/proposal/share-email";
import { Button } from "../ui/button";
import { Notice } from "../ui/misc";
import { Modal } from "../builder/dialogs";
import { LocalTime } from "./local-time";
import { SignedPdfButton } from "./signed-pdf-button";

export interface CreatedLink { url: string; requestId: string; expiresAt: string; versionNumber: number; total: string; file?: File; message: string }

/** Signing status of this bid + Create Signing Link, on the Proposal step. */
export function SigningPanel({ estimateId, onCreate, creating, refreshKey }: {
  estimateId: string; onCreate: () => void; creating: boolean; refreshKey: number;
}) {
  const [data, setData] = useState<{ requests: RequestRow[]; signatures: SignatureRow[] } | null>(null);
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
    await load(); setBusy(null);
  }

  const s = data ? bidSigning(data.requests, data.signatures) : null;
  const pending = data?.requests.find((r) => r.status === "pending" && new Date(r.expires_at) > new Date());
  return (
    <section aria-labelledby="signing-h" className="mb-5 rounded-xl border border-line bg-surface p-4" data-testid="signing-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="signing-h" className="flex items-center gap-2 font-display text-lg font-extrabold text-navy"><FileSignature className="h-5 w-5" aria-hidden /> Get it signed online</h2>
          <p className="text-sm text-ink-soft">Your customer reviews this exact version and signs on their phone or computer. No account or payment needed.</p>
        </div>
        <Button variant="accent" onClick={onCreate} disabled={creating} data-testid="create-signing-link">
          {creating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Link2 className="h-4 w-4" aria-hidden />} Create Signing Link
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
    </section>
  );
}

/** Shown after a link is created: copy it, open the contractor's own email app, or download the PDF. */
export function SigningLinkDialog({ open, onOpenChange, link, email }: { open: boolean; onOpenChange: (o: boolean) => void; link: CreatedLink | null; email: ShareEmailInput }) {
  const [copied, setCopied] = useState(false);
  if (!link) return null;
  const msg = buildShareEmail({ ...email, signingUrl: link.url });
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Your signing link is ready" description="Send it to your customer. They can review the full proposal and sign without an account.">
      <div className="space-y-4">
        <div>
          <label htmlFor="signing-url" className="mb-1 block text-sm font-semibold">Signing link</label>
          <div className="flex gap-2">
            <input id="signing-url" readOnly value={link.url} className="field min-w-0 flex-1 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} data-testid="signing-url" />
            <Button variant="secondary" onClick={async () => { try { await navigator.clipboard.writeText(link.url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked: the field stays selectable */ } }}>
              {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}{copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="mt-1 text-xs text-muted">Version {link.versionNumber} · {link.total} · works until <LocalTime iso={link.expiresAt} relative={false} />. Anyone with this link can view and sign, so send it only to your customer. Creating a new link turns this one off.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={mailtoHref(msg)} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-navy px-4 font-semibold text-white hover:bg-navy/90"><Mail className="h-4 w-4" aria-hidden /> Send via My Email</a>
          {link.file && (
            <Button variant="secondary" onClick={() => { const url = URL.createObjectURL(link.file!); Object.assign(document.createElement("a"), { href: url, download: link.file!.name }).click(); setTimeout(() => URL.revokeObjectURL(url), 10_000); }}>
              <Download className="h-4 w-4" aria-hidden /> Download PDF
            </Button>
          )}
        </div>
        <p className="text-xs text-muted">Send via My Email opens your own email app with the link and a short message filled in. Built2Bid doesn&apos;t send anything for you. {msg.to ? "" : "Add your customer's email on the Customer & project step to fill in the To line."}</p>
        {link.message && <Notice tone="ok">{link.message}</Notice>}
      </div>
    </Modal>
  );
}
