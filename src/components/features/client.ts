"use client";
import { PENDING_TOUR_KEY, START_TOUR_EVENT, parseState, type Access, type FeatureAction, type FeatureState } from "@/lib/features/state";

export type FeatureView = { signedIn: false } | { signedIn: true; known: boolean; access: Access; state: FeatureState };

let cached: Promise<FeatureView | null> | null = null;

/** The account's feature state, fetched once per page load (pass fresh to re-check, e.g. after checkout). */
export function loadFeatures(fresh = false): Promise<FeatureView | null> {
  if (!cached || fresh) {
    cached = fetch("/api/features", { cache: "no-store", credentials: "same-origin" })
      .then(async (r) => {
        if (!r.ok) return null;
        const j = await r.json();
        if (!j?.signedIn) return { signedIn: false } as const;
        const state = parseState(j.state);
        if (!state) return null;
        return { signedIn: true, known: Boolean(j.known), access: { unlimited: Boolean(j.access?.unlimited) }, state } as const;
      })
      .catch(() => null);
  }
  return cached;
}

export async function saveFeatures(action: FeatureAction): Promise<boolean> {
  try {
    const r = await fetch("/api/features", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(action) });
    if (r.ok) cached = null;
    return r.ok;
  } catch {
    return false;
  }
}

/** Starts the feature walkthrough (on the dashboard; other pages navigate there first). */
export function startFeatureTour(ids?: string[]) {
  window.dispatchEvent(new CustomEvent(START_TOUR_EVENT, { detail: ids ?? null }));
}

export function setPendingTour(ids: string[] | null) {
  try { window.sessionStorage.setItem(PENDING_TOUR_KEY, JSON.stringify(ids ?? [])); } catch { /* private mode */ }
}
export function takePendingTour(): string[] | null | undefined {
  try {
    const raw = window.sessionStorage.getItem(PENDING_TOUR_KEY);
    if (raw === null) return undefined;
    window.sessionStorage.removeItem(PENDING_TOUR_KEY);
    const v = JSON.parse(raw);
    return Array.isArray(v) && v.length ? v.map(String) : null;
  } catch {
    return undefined;
  }
}
