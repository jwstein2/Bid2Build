/**
 * Per-account feature discovery state and the rules that use it. Pure functions, so the modal,
 * notice and walkthrough decisions are unit tested (tests/feature-registry.test.ts).
 *
 * Stored per account in Supabase auth user_metadata.b2b_features (the user can only write their
 * own; nothing here grants access to anything: entitlement always comes from library_access()).
 *
 *   acked       premium feature ids the account has already been told are unlocked
 *   notice      newest release version whose What's New notice was seen or dismissed
 *   tour        walkthrough finished or skipped (it is never forced)
 *   guides      page guides (page-guides.ts) the person finished; they can always be replayed
 */
import { FEATURES, LATEST_RELEASE, RELEASES, compareVersions, type Feature, type FeatureId } from "./registry";

export interface FeatureState {
  v: 1;
  acked: FeatureId[];
  notice: string | null;
  tour: "completed" | "dismissed" | null;
  /** Page keys whose walkthrough was finished. Only present once one has been. */
  guides?: string[];
}

export interface Access {
  /** library_access(): Unlimited subscription, Enterprise seat, complimentary grant or admin. */
  unlimited: boolean;
  /** pm_entitlement().can_edit */
  pm?: boolean;
}

export const META_KEY = "b2b_features";
/** Window event that starts the feature walkthrough; detail = feature ids (optional). */
export const START_TOUR_EVENT = "b2b:features:tour";
/**
 * Window event the walkthrough sends before a step that needs local, temporary UI opened (a phone
 * menu, a collapsed list, the Bids view a feature announcement lives in); detail = the step's reveal
 * key, or null when the walkthrough ends. The component that owns that UI opens it, remembers what it
 * changed, and puts it back on null unless the person changed it themselves in the meantime. It never
 * navigates, saves or sends anything.
 */
export const REVEAL_FEATURE_EVENT = "b2b:features:reveal";
/** Reveal key for a feature announcement step: the feature's Bids view, or the phone menu for sidebar links. */
export const revealKeyFor = (f: Pick<Feature, "id" | "view">): string => (f.view ? `bids.view:${f.view}` : `feature:${f.id}`);

const isId = (x: unknown): x is FeatureId => typeof x === "string" && FEATURES.some((f) => f.id === x);

export function parseState(raw: unknown): FeatureState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return {
    v: 1,
    acked: Array.isArray(r.acked) ? [...new Set(r.acked.filter(isId))] : [],
    notice: typeof r.notice === "string" && RELEASES.some((x) => x.version === r.notice) ? r.notice : null,
    tour: r.tour === "completed" || r.tour === "dismissed" ? r.tour : null,
    ...(Array.isArray(r.guides) && r.guides.length ? { guides: [...new Set(r.guides.filter((g): g is string => typeof g === "string" && /^[a-z][a-z.-]{0,63}$/.test(g)))].slice(0, 80) } : {}),
  };
}

export const released = (list: readonly Feature[] = FEATURES) => list.filter((f) => f.status === "released");

export function hasAccess(f: Feature, a: Access): boolean {
  return f.entitlement === "free" || (f.entitlement === "unlimited" && a.unlimited) || (f.entitlement === "pm" && Boolean(a.pm));
}

/** Released features this account can use right now. */
export function available(a: Access, list: readonly Feature[] = FEATURES): Feature[] {
  return released(list).filter((f) => hasAccess(f, a));
}

/**
 * First time an account is seen. Accounts that already pay are told only about premium features
 * released after the newest release they could have known (the release before LATEST_RELEASE), so
 * long-time customers aren't shown "unlocked" features they've used for months. Free accounts start
 * with nothing acknowledged, so upgrading later lists everything Unlimited adds. Accounts created
 * after the latest release don't get a "What's New" notice for it.
 */
export function initialState(a: Access, accountCreatedAt: string | null, list: readonly Feature[] = FEATURES): FeatureState {
  const prev = RELEASES.length > 1 ? RELEASES[RELEASES.length - 2].version : null;
  const acked = a.unlimited && prev ? released(list).filter((f) => f.entitlement !== "free" && compareVersions(f.release, prev) <= 0).map((f) => f.id) : [];
  const newAccount = accountCreatedAt !== null && accountCreatedAt.slice(0, 10) >= LATEST_RELEASE.date;
  return { v: 1, acked, notice: newAccount ? LATEST_RELEASE.version : null, tour: null };
}

/** Premium features the account has and hasn't been told about: drives "Your New Features Are Ready". */
export function newlyUnlocked(s: FeatureState, a: Access, list: readonly Feature[] = FEATURES): Feature[] {
  return available(a, list).filter((f) => f.entitlement !== "free" && !s.acked.includes(f.id));
}

/**
 * The dismissible, version-aware What's New notice: released features newer than the last notice
 * seen, limited to what this account can use, minus anything the unlocked modal already covers.
 * Never-seen accounts get only the latest release.
 */
export function whatsNew(s: FeatureState, a: Access, list: readonly Feature[] = FEATURES): Feature[] {
  if (s.notice && compareVersions(s.notice, LATEST_RELEASE.version) >= 0) return [];
  const unlocked = new Set(newlyUnlocked(s, a, list).map((f) => f.id));
  return available(a, list).filter((f) => (s.notice ? compareVersions(f.release, s.notice) > 0 : f.release === LATEST_RELEASE.version) && !unlocked.has(f.id));
}

export type FeatureAction = { ack: string[] } | { notice: string } | { tour: "completed" | "dismissed" } | { guide: string };

/** Applies a client action. Unknown ids and versions are ignored; acknowledging is additive only. */
export function applyAction(s: FeatureState, act: FeatureAction): FeatureState {
  if ("ack" in act) return { ...s, acked: [...new Set([...s.acked, ...act.ack.filter(isId)])] };
  if ("notice" in act) {
    if (!RELEASES.some((r) => r.version === act.notice)) return s;
    return s.notice && compareVersions(s.notice, act.notice) >= 0 ? s : { ...s, notice: act.notice };
  }
  if ("guide" in act) {
    if (!/^[a-z][a-z.-]{0,63}$/.test(act.guide) || s.guides?.includes(act.guide)) return s;
    return { ...s, guides: [...(s.guides ?? []), act.guide].slice(-80) };
  }
  return { ...s, tour: act.tour };
}

/** Walkthrough steps for a set of ids (or every feature the account can use, newest release first). */
export function tourSteps(a: Access, ids?: readonly string[] | null): Feature[] {
  const can = available(a);
  if (ids?.length) return ids.map((id) => can.find((f) => f.id === id)).filter((f): f is Feature => Boolean(f));
  return [...can].sort((x, y) => compareVersions(y.release, x.release));
}
