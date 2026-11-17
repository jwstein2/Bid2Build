"use client";
import { START_TOUR_EVENT, parseState, type Access, type FeatureAction, type FeatureState } from "@/lib/features/state";
import { GUEST_CONTEXT, type GuideContext } from "@/lib/features/page-guides";

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

/**
 * Starts the walkthrough on the current page. Without ids it teaches the page and view on screen;
 * with feature ids (What's New, the unlocked-features modal) it walks through those features. It never
 * navigates.
 */
export function startFeatureTour(ids?: string[]) {
  window.dispatchEvent(new CustomEvent(START_TOUR_EVENT, { detail: ids ?? null }));
}

export type GuideView = GuideContext & { trades: string[]; guides: string[] };

/** Who is looking (plan, role, add-ons) and the trades on their recent bids, read when a walkthrough starts. */
export async function loadGuideContext(): Promise<GuideView> {
  const guest: GuideView = { ...GUEST_CONTEXT, trades: [], guides: [] };
  try {
    const r = await fetch("/api/features?guide=1", { cache: "no-store", credentials: "same-origin" });
    if (!r.ok) return guest;
    const j = await r.json();
    if (!j?.signedIn) return guest;
    const g = j.guide ?? {};
    return {
      signedIn: true,
      unlimited: Boolean(j.access?.unlimited),
      admin: g.admin === true,
      pm: { view: Boolean(g.pm?.view), edit: Boolean(g.pm?.edit) },
      company: g.company && typeof g.company.role === "string"
        ? { role: g.company.role, owner: Boolean(g.company.owner), permissions: Array.isArray(g.company.permissions) ? g.company.permissions.map(String) : [] }
        : null,
      trades: Array.isArray(g.trades) ? g.trades.map(String) : [],
      guides: parseState(j.state)?.guides ?? [],
    };
  } catch {
    return guest;
  }
}
