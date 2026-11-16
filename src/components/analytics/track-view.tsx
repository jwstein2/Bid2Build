"use client";
import { useEffect } from "react";
import { track } from "@/lib/analytics/track";

/** Fires one landing_view per page per browser session (GA4, and the Meta Pixel if allowed). */
export function TrackLandingView({ trade }: { trade: string }) {
  useEffect(() => {
    const key = `b2b:lv:${trade}`;
    try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, "1"); } catch { /* storage blocked: still fine */ }
    // Tags load afterInteractive; wait briefly so the event isn't dropped.
    const t = setTimeout(() => track("landing_view", { trade }), 1500);
    return () => clearTimeout(t);
  }, [trade]);
  return null;
}
