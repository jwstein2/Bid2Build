"use client";

import { useEffect, useSyncExternalStore } from "react";
import { createPresence, type PresenceController, type PresenceKind } from "@/lib/academy/presence";
import type { AcademyStats } from "@/lib/academy/server";

/**
 * One presence loop per browser tab, shared by the Academy layout (heartbeat) and any stats panel (display).
 * See src/lib/academy/presence.ts for the rules.
 */

let stats: AcademyStats | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
let viewers = 0;

async function send(kind: PresenceKind) {
  const res = await fetch("/api/academy/presence", { method: kind === "beat" ? "POST" : "GET", cache: "no-store", credentials: "same-origin" });
  if (!res.ok) throw new Error(`presence ${res.status}`);
  const body = (await res.json().catch(() => null)) as { stats?: AcademyStats | null } | null;
  if (body?.stats) { stats = body.stats; emit(); }
}

let controller: PresenceController | null = null;
const getController = () =>
  (controller ??= createPresence({
    send,
    visible: () => document.visibilityState === "visible",
    now: () => Date.now(),
    wantsStats: () => viewers > 0,
  }));

const ACTIVITY_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "scroll", "touchstart", "focus"] as const;

/** Mounted once in the Academy layout. Runs the heartbeat for members and the stats refresh for everyone. */
export function AcademyPresence({ member }: { member: boolean }) {
  useEffect(() => {
    const c = getController();
    const onActivity = () => c.activity();
    const onVisibility = () => c.visibility();
    const onOnline = () => c.online();
    if (member) for (const e of ACTIVITY_EVENTS) window.addEventListener(e, onActivity, { passive: true, capture: true });
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    const timer = window.setInterval(() => c.tick(), 15_000);
    c.start(member);
    return () => {
      if (member) for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, onActivity, { capture: true });
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      window.clearInterval(timer);
      c.stop();
    };
  }, [member]);
  return null;
}

/** Live Academy stats: starts from the server-rendered numbers and updates without a page refresh. */
export function useAcademyStats(initial: AcademyStats | null): AcademyStats | null {
  useEffect(() => {
    viewers++;
    return () => { viewers--; };
  }, []);
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => stats ?? initial,
    () => initial,
  );
}
