"use client";
import type { Progress } from "@/lib/guide/rules";
import type { Workspace } from "@/lib/guide/tours";

export interface GuideState {
  signedIn: boolean;
  known: boolean;
  workspace: Workspace;
  createdAt: string | null;
  welcomeDone: boolean;
  progress: Progress[];
  practice: boolean;
  ai: boolean;
}

/** Fired to open a guided tour by id from anywhere (settings, help links, the demo banner). */
export const START_GUIDE_TOUR_EVENT = "b2b:guide:start";
/** Fired to open the Guide panel. */
export const OPEN_GUIDE_EVENT = "b2b:guide:open";

export function startGuideTour(id: string) {
  window.dispatchEvent(new CustomEvent(START_GUIDE_TOUR_EVENT, { detail: id }));
}

let cached: Promise<GuideState | null> | null = null;
export function loadGuideState(fresh = false): Promise<GuideState | null> {
  if (!cached || fresh) {
    cached = fetch("/api/guide", { cache: "no-store", credentials: "same-origin" })
      .then(async (r) => {
        if (!r.ok) return null;
        const j = await r.json();
        if (!j?.signedIn) return null;
        return {
          signedIn: true, known: Boolean(j.known), workspace: (["real", "demo", "practice"].includes(j.workspace) ? j.workspace : "real") as Workspace,
          createdAt: typeof j.createdAt === "string" ? j.createdAt : null, welcomeDone: Boolean(j.welcomeDone),
          progress: Array.isArray(j.progress) ? (j.progress as Progress[]) : [], practice: Boolean(j.practice), ai: Boolean(j.ai),
        };
      })
      .catch(() => null);
  }
  return cached;
}

export type GuideEvent = {
  event: "offered" | "started" | "step" | "completed" | "dismissed" | "snoozed" | "launcher_opened" | "help_viewed" | "help_search" | "checklist_opened";
  tourId?: string; version?: number; step?: number; page?: string; role?: string; dedupe?: string;
};

/** Fire-and-forget first-party guide analytics (also updates tour progress on the server). */
export function recordGuide(e: GuideEvent) {
  try {
    void fetch("/api/guide", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(e), keepalive: true, credentials: "same-origin" })
      .then((r) => { if (r.ok && e.tourId) cached = null; }, () => {});
  } catch { /* offline */ }
}
