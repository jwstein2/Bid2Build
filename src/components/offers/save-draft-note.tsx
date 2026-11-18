"use client";
import { CloudUpload, X } from "lucide-react";
import type { AuthDialogCopy } from "../auth/auth-dialog";
import { cn } from "@/lib/cn";

const KEY = "b2b:save-draft-dismissed";

/** Dismissed on this device within the last 7 days. Storage blocked: treated as not dismissed. */
export function saveDraftDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const at = Number(window.localStorage.getItem(KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < 7 * 86_400_000;
  } catch {
    return false;
  }
}

export const SAVE_DRAFT_COPY: AuthDialogCopy = {
  title: "Save this bid to your email",
  emailDescription: "Enter your email and we'll send a 6-digit code. Your bid moves into a free account, so it's there on any device. No credit card, and saving doesn't use a bid.",
  sentDescription: (email) => `We sent a 6-digit code to ${email}. Enter it to save your bid.`,
  submitLabel: "Send my code",
};

/**
 * BLD-2: a visitor's draft lives only in this browser. Once it has a priced line, offer to save it
 * to an account (the existing sign-in moves the draft over). Inline, dismissible, never blocks editing.
 */
export function SaveDraftNote({ onSave, onDismiss, className }: { onSave: () => void; onDismiss: () => void; className?: string }) {
  const dismiss = () => {
    try { window.localStorage.setItem(KEY, String(Date.now())); } catch { /* still hides for this visit */ }
    onDismiss();
  };
  return (
    <div className={cn("flex items-start gap-3 rounded-lg border border-line bg-surface px-4 py-3 text-sm", className)} data-testid="save-draft-note">
      <CloudUpload className="mt-0.5 h-4 w-4 shrink-0 text-accent-ink" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-ink"><span className="font-semibold">This bid is saved only in this browser.</span> Save it to your email so it&apos;s there on your phone and computer.</p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          <button type="button" onClick={onSave} data-cta="save_draft" className="inline-flex min-h-9 items-center font-semibold text-accent-ink underline-offset-2 hover:underline">Save to my email</button>
          <button type="button" onClick={dismiss} className="inline-flex min-h-9 items-center text-muted hover:text-ink">Not now</button>
        </div>
      </div>
      <button type="button" onClick={dismiss} aria-label="Dismiss" className="grid h-8 w-8 shrink-0 place-items-center rounded text-muted hover:bg-black/5"><X className="h-4 w-4" aria-hidden /></button>
    </div>
  );
}
