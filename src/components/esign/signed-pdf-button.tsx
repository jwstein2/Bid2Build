"use client";
import { Download, Loader2 } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";

/** Download Signed PDF: asks the server for a short-lived link (it retries a failed render). */
export function SignedPdfButton({ signatureId, variant = "secondary", compact, className }: { signatureId: string; variant?: "accent" | "secondary"; compact?: boolean; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function go() {
    if (busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/signatures/${signatureId}/pdf`).catch(() => null);
      const d = r ? await r.json().catch(() => ({})) : {};
      if (r?.ok && d.url) window.location.assign(d.url);
      else setMsg(d?.error?.message ?? "Couldn't prepare the signed PDF. Please try again.");
    } finally { setBusy(false); }
  }
  return (
    <span className="inline-flex flex-col">
      <button type="button" onClick={go} disabled={busy} aria-label="Download Signed PDF"
        className={cn("inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold disabled:opacity-60",
          variant === "accent" ? "bg-accent text-navy hover:bg-accent-hover" : "border border-line bg-surface text-navy hover:bg-black/5", className)}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
        {compact ? "Signed PDF" : "Download Signed PDF"}
      </button>
      {msg && <span className="mt-1 max-w-xs text-xs text-danger" role="alert">{msg}</span>}
    </span>
  );
}
