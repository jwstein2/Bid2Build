"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Re-fetch the server-rendered page when the contractor comes back to the tab (at most once a
 * minute), so a bid signed while they were away shows up without a manual refresh. No polling.
 */
export function RefreshOnFocus({ minIntervalMs = 60_000 }: { minIntervalMs?: number }) {
  const router = useRouter();
  const last = useRef(0);
  useEffect(() => {
    last.current = Date.now();
    const onVisible = () => {
      if (document.visibilityState !== "visible" || Date.now() - last.current < minIntervalMs) return;
      last.current = Date.now();
      router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [router, minIntervalMs]);
  return null;
}
