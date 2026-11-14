"use client";
import { useState } from "react";

/** Shows a freshly created invitation link once (only its hash is stored, so it can't be shown again). */
export function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-lg border border-line bg-paper p-3 text-sm">
      <p className="font-medium">Invitation link</p>
      <p className="text-xs text-muted">Only the invited email can use it. It won&apos;t be shown again; Resend creates a new one.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Invitation link" className="min-h-10 min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-2 font-mono text-xs" />
        <button type="button" className="min-h-10 rounded-md border border-line-strong bg-surface px-3 font-semibold hover:bg-paper"
          onClick={() => navigator.clipboard?.writeText(link).then(() => setCopied(true), () => setCopied(false))}>{copied ? "Copied" : "Copy"}</button>
      </div>
    </div>
  );
}
