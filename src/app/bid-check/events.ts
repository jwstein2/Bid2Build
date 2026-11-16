"use client";
import type { Answers, Arrival } from "@/lib/bid-check/types";

/** Fire-and-forget progress event (answer keys only, never personal data). */
export function sendEvent(sid: string, type: string, answers?: Answers, arrival?: Arrival) {
  try {
    void fetch("/api/bid-check/event", { method: "POST", headers: { "content-type": "application/json" }, keepalive: true, body: JSON.stringify({ sid, type, answers, arrival }) }).catch(() => {});
  } catch { /* analytics never breaks the page */ }
}

