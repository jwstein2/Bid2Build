"use client";
import { track } from "@/lib/analytics/track";
import type { OfferId } from "./policy";

export interface ClaimResult { show: boolean; referralLink?: string | null }

/** Ask the server whether this offer may show now (caps and suppression live there). Never throws. */
export async function claimOffer(offer: OfferId): Promise<ClaimResult> {
  try {
    const r = await fetch("/api/offers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ offer, action: "claim" }) });
    if (!r.ok) return { show: false };
    const d = (await r.json()) as ClaimResult;
    if (d.show) track("offer_shown", { offer });
    return d;
  } catch {
    return { show: false };
  }
}

/** Record a click, dismissal or answer. Fire-and-forget; uses keepalive so it survives navigation. */
export function reportOffer(offer: OfferId, action: "clicked" | "dismissed" | "answered", detail?: string) {
  if (action === "clicked") track("offer_clicked", { offer, target: detail });
  try {
    void fetch("/api/offers", { method: "POST", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify({ offer, action, detail }) }).catch(() => {});
  } catch { /* never breaks the page */ }
}
