"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/** A read-only value with a Copy button that confirms ("Copied") for two seconds. */
export function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked: the field is selectable */ }
  };
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <input readOnly value={value} aria-label={label} onFocus={(e) => e.currentTarget.select()}
        className="min-h-11 w-full min-w-0 rounded-lg border border-line bg-white px-3 font-mono text-sm" />
      <Button type="button" onClick={copy} className="shrink-0" aria-live="polite">{copied ? "Copied" : "Copy"}</Button>
    </div>
  );
}
