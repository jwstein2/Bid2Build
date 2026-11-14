/**
 * One-time welcome popup ("Welcome to Built2Bid" + getting started tour): who sees it automatically.
 *
 * - Anonymous visitors: browser localStorage (LOCAL_KEY).
 * - Signed-in users: profiles.onboarding_status in Supabase (see migration 20261114002000), mirrored
 *   to localStorage. A visitor who dismissed it before signing up has that choice copied to the
 *   account the first time a session is seen, so it never reappears after sign-up.
 * - Accounts that existed before the feature shipped are 'existing' and never see it automatically.
 * - Replaying from the dashboard Help area never reads or writes any of this.
 */

export type OnboardingStatus = "existing" | "dismissed" | "completed";
export const ONBOARDING_STATUSES: readonly OnboardingStatus[] = ["existing", "dismissed", "completed"];
export const LOCAL_KEY = "b2b:onboarding";
/** Window event that opens the tour as a replay ("Watch Getting Started Tour"). */
export const OPEN_TOUR_EVENT = "b2b:onboarding:open";

export interface LocalOnboarding {
  status: OnboardingStatus;
  at: string;
  /** True once the account (if any) has the same or a final status stored in Supabase. */
  synced?: boolean;
}

export function isOnboardingStatus(v: unknown): v is OnboardingStatus {
  return typeof v === "string" && (ONBOARDING_STATUSES as readonly string[]).includes(v);
}

export function parseLocal(raw: string | null): LocalOnboarding | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<LocalOnboarding>;
    return isOnboardingStatus(v?.status) ? { status: v.status, at: String(v.at ?? ""), synced: Boolean(v.synced) } : null;
  } catch {
    return null;
  }
}

/**
 * Pages where the popup may open by itself: the marketing pages a new visitor lands on and the
 * dashboard. Never the bid builder, sign-in, auth callbacks, checkout returns, settings or admin.
 */
export function isEligiblePath(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, "") || "/";
  return p === "/" || p === "/dashboard" || p === "/pricing" || p === "/bids" || p.startsWith("/bids/") || p === "/learn" || p.startsWith("/learn/");
}

/** Query parameters that mean sign-in or checkout is in progress on this page load. */
const BUSY_PARAMS = ["resume", "upgrade", "checkout", "session_id", "code", "token_hash", "error", "error_code", "next", "plan"];

export function isBusySearch(search: string): boolean {
  const q = new URLSearchParams(search);
  return BUSY_PARAMS.some((k) => q.has(k));
}

/** localStorage keys this app writes; any of them means the browser has used Built2Bid before. */
const RETURNING_PREFIXES = ["byb:", "b2b:step:", "b2b.checkout", "b2b:profile-reminder"];

export function looksReturning(keys: Iterable<string>): boolean {
  for (const k of keys) if (RETURNING_PREFIXES.some((p) => k.startsWith(p))) return true;
  return false;
}

/** Supabase (@supabase/ssr) keeps the session in a readable `sb-<ref>-auth-token` cookie. */
export function hasSessionCookie(cookie: string): boolean {
  return /(?:^|;\s*)sb-[^=;]+-auth-token(?:\.\d+)?=/.test(cookie);
}

/** Whether the server needs asking at all on this page load. */
export function needsServer(local: LocalOnboarding | null, sessionCookie: boolean): boolean {
  if (!sessionCookie) return false;
  return !local || !local.synced;
}

export type ServerView =
  | { signedIn: false }
  | { signedIn: true; status: OnboardingStatus | null; known: boolean };

export type Decision =
  | { show: false; reason: string; writeLocal?: LocalOnboarding; pushToServer?: OnboardingStatus }
  | { show: true };

/**
 * Decides whether to open the popup automatically.
 * `server` is null when the browser has no session cookie (no request was made).
 */
export function decide(opts: { local: LocalOnboarding | null; returning: boolean; server: ServerView | null; now: string }): Decision {
  const { local, returning, server, now } = opts;
  const signedIn = server?.signedIn === true;

  if (signedIn) {
    // Account state wins. Unknown (migration not applied yet, or a read error) = never auto-show.
    if (!server.known) return { show: false, reason: "account-unknown" };
    if (server.status) return { show: false, reason: `account-${server.status}`, writeLocal: { status: server.status, at: local?.at || now, synced: true } };
    // New account. A choice made in this browser before sign-up is copied to the account.
    // ('existing' here only means the browser had used Built2Bid signed out; a new account still sees it.)
    if (local && local.status !== "existing") return { show: false, reason: `local-${local.status}`, pushToServer: local.status, writeLocal: { ...local, synced: true } };
    return { show: true };
  }

  if (local) return { show: false, reason: `local-${local.status}` };
  if (returning) return { show: false, reason: "returning-browser", writeLocal: { status: "existing", at: now } };
  return { show: true };
}
