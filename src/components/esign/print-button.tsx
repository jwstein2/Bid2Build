"use client";
import { Printer } from "lucide-react";
import { cn } from "@/lib/cn";

/** Prints the page; the signing page marks everything except the proposal itself as no-print. */
export function PrintButton({ className, label = "Print proposal" }: { className?: string; label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} data-testid="print-proposal"
      className={cn("inline-flex min-h-11 items-center gap-2 rounded-lg border border-line px-4 font-semibold text-navy hover:bg-black/5", className)}>
      <Printer className="h-4 w-4" aria-hidden /> {label}
    </button>
  );
}
