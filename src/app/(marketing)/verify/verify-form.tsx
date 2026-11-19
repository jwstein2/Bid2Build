"use client";
import { useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";

type Result = { match: false } | { match: true; kind: "signed" | "executed"; companyName: string | null; proposalNumber: string; versionNumber: number; signedAt: string; executedAt: string | null };

const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
const when = (iso: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }).format(new Date(iso)) + " UTC";

export function VerifyForm() {
  const [busy, setBusy] = useState(false);
  const [hash, setHash] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function check(file: File | undefined) {
    setResult(null); setError(null); setHash(null);
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) { setError("That file is too large to be a signed proposal."); return; }
    setBusy(true);
    try {
      const sha256 = hex(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()));
      setHash(sha256);
      const r = await fetch("/api/signatures/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sha256 }) });
      const body = await r.json().catch(() => null);
      if (!r.ok) setError(body?.error?.message ?? body?.message ?? "We couldn't check that file. Please try again.");
      else setResult(body as Result);
    } catch {
      setError("We couldn't read that file. Please try again.");
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface p-4">
      <label className="block text-sm font-semibold text-ink">Signed PDF
        <input type="file" accept="application/pdf,.pdf" className="mt-1 block w-full text-sm" disabled={busy} onChange={(e) => check(e.target.files?.[0])} data-testid="verify-file" />
      </label>
      {busy && <p className="text-sm text-muted">Checking…</p>}
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      {result?.match === true && (
        <div className="flex items-start gap-2 rounded-lg bg-ok-tint p-3 text-sm text-ink" role="status" data-testid="verify-match">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-ok" aria-hidden />
          <div>
            <p className="font-bold">This file matches our records and has not been changed.</p>
            <p>{result.kind === "executed" ? "Fully executed agreement" : "Customer-signed proposal"}{result.companyName ? ` from ${result.companyName}` : ""}, proposal #{result.proposalNumber}, version {result.versionNumber}. Signed {when(result.signedAt)}{result.executedAt ? `; fully executed ${when(result.executedAt)}` : ""}.</p>
          </div>
        </div>
      )}
      {result?.match === false && (
        <div className="flex items-start gap-2 rounded-lg bg-black/5 p-3 text-sm text-ink" role="status" data-testid="verify-nomatch">
          <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-hidden />
          <p>No match. This file isn&apos;t a signed copy we produced, or it has been changed, printed or re-saved since it was downloaded. Ask the contractor or the signer for the original download.</p>
        </div>
      )}
      {hash && <p className="break-all font-mono text-xs text-muted">SHA-256: {hash}</p>}
    </div>
  );
}
