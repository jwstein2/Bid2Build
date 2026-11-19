"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * A rep's permanent link with copy / email / text / QR. The QR SVG is rendered on the server from the
 * same link. Nothing here sends a message: email and text open the rep's own apps.
 */
export function ShareLink({ link, qrSvg, qrDataUrl }: { link: string; qrSvg: string; qrDataUrl: string }) {
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const body = `Here's Built2Bid, the bid and proposal app for contractors I mentioned. Start free: ${link}`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked: the link is selectable */ }
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input readOnly value={link} aria-label="Your referral link" onFocus={(e) => e.currentTarget.select()}
          className="min-h-11 w-full min-w-0 rounded-lg border border-line bg-white px-3 font-mono text-sm" />
        <Button onClick={copy} className="shrink-0">{copied ? "Copied" : "Copy link"}</Button>
      </div>
      <div className="flex flex-wrap gap-2 text-sm">
        <a className="inline-flex min-h-11 items-center rounded-lg border border-line bg-white px-3 font-semibold" href={`mailto:?subject=${encodeURIComponent("Built2Bid for your bids")}&body=${encodeURIComponent(body)}`}>Email</a>
        <a className="inline-flex min-h-11 items-center rounded-lg border border-line bg-white px-3 font-semibold" href={`sms:?&body=${encodeURIComponent(body)}`}>Text message</a>
        <button type="button" onClick={() => setShowQr((v) => !v)} aria-expanded={showQr} className="inline-flex min-h-11 items-center rounded-lg border border-line bg-white px-3 font-semibold">{showQr ? "Hide QR code" : "QR code"}</button>
      </div>
      {showQr && (
        <div className="inline-flex flex-col items-center gap-2 rounded-xl border border-line bg-white p-4">
          <div className="h-48 w-48" role="img" aria-label="QR code for your referral link" dangerouslySetInnerHTML={{ __html: qrSvg }} />
          <a href={qrDataUrl} download="built2bid-referral-qr.png" className="text-sm font-semibold text-brand underline">Download PNG</a>
        </div>
      )}
    </div>
  );
}
