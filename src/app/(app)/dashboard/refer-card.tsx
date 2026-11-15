"use client";
import { useState } from "react";
import { Gift } from "lucide-react";
import { Card } from "@/components/ui/misc";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Refer a contractor, get a month free": the member's own link, share/copy buttons and counts. */
export function ReferCard({ link, signedUp, paying, monthsEarned, eligible }: { link: string; signedUp: number; paying: number; monthsEarned: number; eligible: boolean }) {
  const [copied, setCopied] = useState(false);
  const text = "I build my bids with Built2Bid. Try it free:";
  const share = async () => {
    if (typeof navigator !== "undefined" && navigator.share) {
      try { await navigator.share({ title: "Built2Bid", text, url: link }); return; } catch { /* cancelled: fall back to copy */ }
    }
    navigator.clipboard?.writeText(link).then(() => setCopied(true), () => setCopied(false));
  };
  return (
    <Card className="p-4 sm:p-5" data-testid="refer-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-extrabold text-navy"><Gift className="h-5 w-5 text-accent-ink" aria-hidden />Refer a contractor, get a month free</h2>
          <p className="mt-1 text-sm text-ink-soft">Share your link. When a contractor signs up with it and starts a paid plan, you get 1 month free: a credit on your next bill if you&apos;re subscribed, or 30 days of Unlimited if you&apos;re not.</p>
        </div>
        {(signedUp > 0 || monthsEarned > 0) && (
          <p className="text-sm text-muted" data-testid="refer-counts">{plural(signedUp, "signup", "signups")} · {paying} paying · <span className="font-semibold text-ok">{plural(monthsEarned, "free month", "free months")} earned</span></p>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Your referral link" className="min-h-11 min-w-0 flex-1 basis-56 rounded-md border border-line-strong bg-paper px-3 font-mono text-sm" />
        <button type="button" onClick={() => navigator.clipboard?.writeText(link).then(() => setCopied(true), () => setCopied(false))}
          className="min-h-11 rounded-md border border-line-strong bg-surface px-4 font-semibold hover:bg-paper">{copied ? "Copied" : "Copy link"}</button>
        <button type="button" onClick={share} className="min-h-11 rounded-md bg-accent px-4 font-semibold text-navy shadow-sm hover:bg-accent-hover sm:hidden">Share</button>
      </div>
      {!eligible && <p className="mt-2 text-xs text-muted">This is an internal or test account, so referrals from it are tracked but don&apos;t earn rewards.</p>}
    </Card>
  );
}
