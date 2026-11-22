"use client";
import { useState } from "react";
import { Check, Copy } from "lucide-react";

/** Copies a plain-text citation (section, edition, official link, last verified date). */
export function CopyCitation({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" data-testid="copy-citation"
      onClick={() => { void navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1800); }, () => {}); }}
      className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs font-semibold text-ink-soft hover:bg-brand-tint hover:text-navy">
      {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
      {done ? "Copied" : "Copy citation"}
    </button>
  );
}
