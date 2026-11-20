"use client";
import { useState } from "react";

export function CopyLink({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <input readOnly value={value} aria-label="Affiliate link" onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 rounded-md border border-line-strong bg-paper px-3 py-2 font-mono text-sm" />
      <button type="button" className="min-h-11 rounded-md bg-ink px-4 text-sm font-semibold text-white"
        onClick={async () => { try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 2000); } catch { /* select-and-copy still works */ } }}>
        {done ? "Copied" : "Copy"}
      </button>
      <span aria-live="polite" className="sr-only">{done ? "Link copied" : ""}</span>
    </div>
  );
}
