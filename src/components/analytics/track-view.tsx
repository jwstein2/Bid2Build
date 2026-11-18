"use client";
import { useEffect } from "react";
import { track } from "@/lib/analytics/track";
import { cleanFrom } from "@/lib/analytics/from";

/**
 * Fires one landing_view per page per browser session (GA4, and the Meta Pixel if allowed).
 * A ?from= label (e.g. "fb" or "tool-concrete") rides along as context; nothing else from the URL.
 */
export function TrackLandingView({ trade }: { trade: string }) {
  useEffect(() => {
    const key = `b2b:lv:${trade}`;
    try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, "1"); } catch { /* storage blocked: still fine */ }
    // Tags load afterInteractive; wait briefly so the event isn't dropped.
    const from = cleanFrom(new URLSearchParams(window.location.search).get("from"));
    const t = setTimeout(() => track("landing_view", { trade, page_type: "trade", from }), 1500);
    return () => clearTimeout(t);
  }, [trade]);
  return null;
}
