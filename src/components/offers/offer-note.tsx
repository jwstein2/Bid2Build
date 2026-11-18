"use client";
import Link from "next/link";
import { useState } from "react";
import { Gift, Sparkles, X } from "lucide-react";
import { reportOffer } from "@/lib/offers/client";
import { MONTHLY } from "@/lib/billing/plans";
import { cn } from "@/lib/cn";

/** T1: the account has exactly one free bid left after finalizing. Inline, dismissible, never a modal. */
export function CreditsLowNote({ onClose, className }: { onClose: () => void; className?: string }) {
  const dismiss = () => { reportOffer("t1_credits_low", "dismissed"); onClose(); };
  return (
    <div role="status" className={cn("flex items-start gap-3 rounded-lg border border-accent/40 bg-brand-tint px-4 py-3 text-sm", className)} data-testid="offer-t1">
      <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-accent-ink" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-ink">You have <span className="font-semibold">1 free bid left</span>. Bidding regularly? Unlimited is {MONTHLY.price}/month, and drafts stay free either way.</p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          <Link href="/settings/billing" onClick={() => reportOffer("t1_credits_low", "clicked", "checkout")} className="inline-flex min-h-9 items-center font-semibold text-navy underline underline-offset-2">See Unlimited</Link>
          <button type="button" onClick={dismiss} className="inline-flex min-h-9 items-center text-ink-soft hover:text-ink">Not now</button>
        </div>
      </div>
      <button type="button" onClick={dismiss} aria-label="Dismiss" className="grid h-8 w-8 shrink-0 place-items-center rounded text-muted hover:bg-black/5"><X className="h-4 w-4" aria-hidden /></button>
    </div>
  );
}

/** T8: a proposal is out. Celebrate and offer the referral link (the referrer earns a free month). */
export function ProposalReadyNote({ link, onClose, className }: { link: string | null; onClose: () => void; className?: string }) {
  const [copied, setCopied] = useState(false);
  const dismiss = () => { reportOffer("t8_first_sent", "dismissed"); onClose(); };
  const copy = () => {
    if (!link) return;
    navigator.clipboard?.writeText(link).then(() => setCopied(true), () => setCopied(false));
    reportOffer("t8_first_sent", "clicked", "copy_link");
  };
  const share = async () => {
    if (!link) return;
    reportOffer("t8_first_sent", "clicked", "share");
    if (navigator.share) { try { await navigator.share({ title: "Built2Bid", text: "I build my bids with Built2Bid. Try it free:", url: link }); return; } catch { /* cancelled */ } }
    copy();
  };
  return (
    <div role="status" className={cn("flex items-start gap-3 rounded-lg border border-ok/30 bg-ok-tint px-4 py-3 text-sm", className)} data-testid="offer-t8">
      <Gift className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-ink">Nice work. Your proposal is ready to go.</p>
        {link ? (
          <>
            <p className="mt-0.5 text-ink-soft">Know another contractor who still writes bids by hand? Share your link. When they start a paid plan, you get a month free.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <input readOnly value={link} aria-label="Your referral link" onFocus={(e) => e.currentTarget.select()} className="min-h-9 min-w-0 flex-1 basis-48 rounded-md border border-line-strong bg-surface px-2 font-mono text-xs" />
              <button type="button" onClick={copy} className="min-h-9 rounded-md border border-line-strong bg-surface px-3 font-semibold hover:bg-paper">{copied ? "Copied" : "Copy link"}</button>
              <button type="button" onClick={share} className="min-h-9 rounded-md bg-accent px-3 font-semibold text-navy hover:bg-accent-hover sm:hidden">Share</button>
            </div>
          </>
        ) : <p className="mt-0.5 text-ink-soft">Your customer sees only the prices you chose to show.</p>}
      </div>
      <button type="button" onClick={dismiss} aria-label="Dismiss" className="grid h-8 w-8 shrink-0 place-items-center rounded text-muted hover:bg-black/5"><X className="h-4 w-4" aria-hidden /></button>
    </div>
  );
}
