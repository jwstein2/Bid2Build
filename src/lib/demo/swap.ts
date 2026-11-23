/**
 * Practice Mode applies only to the paid app (see ./scope). The proxy calls this on page loads, client
 * navigations and server actions:
 *  - a practice / demo session opening a page outside the paid app is paused: this browser goes back to the
 *    real session (from the stash Enter saved) and the practice session's refresh token is kept in an
 *    httpOnly cookie, so the Academy, news, admin and the public site always run as the real account;
 *  - the real account opening a paid-app page with a paused practice resumes it.
 * The session switch happens before the page or action runs (the proxy rewrites the request cookies), so
 * there is no extra redirect. Neither session is ever signed out here: on any failure the session the
 * request arrived with is put back and the request carries on unchanged.
 */
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { DEMO_HINT_COOKIE, DEMO_RETURN_COOKIE, DEMO_RETURN_MAX_AGE, parseDemoClaim, type DemoClaim } from "./session";
import { inPracticeScope, PRACTICE_PAUSE_COOKIE } from "./scope";
import { decodeStash, encodeStash } from "./stash";

export type CookieOp = { name: string; value: string; maxAge: number; httpOnly: boolean };
export type SwapResult = { swapped: "paused" | "resumed" | null; cookies: CookieOp[] };

const set = (name: string, value: string, httpOnly = true): CookieOp => ({ name, value, maxAge: DEMO_RETURN_MAX_AGE, httpOnly });
const del = (name: string): CookieOp => ({ name, value: "", maxAge: 0, httpOnly: true });
const NONE: SwapResult = { swapped: null, cookies: [] };

async function restore(supabase: SupabaseClient, s: Session) {
  await supabase.auth.setSession({ access_token: s.access_token, refresh_token: s.refresh_token }).catch(() => {});
}

export async function practiceSwap(
  supabase: SupabaseClient,
  pathname: string,
  current: { sub?: string; app_metadata?: unknown } | null | undefined,
  readCookie: (name: string) => string | undefined,
): Promise<SwapResult> {
  if (!current?.sub) return NONE;
  const claim: DemoClaim | null = parseDemoClaim(current.app_metadata);
  const scoped = inPracticeScope(pathname);

  if (claim && !scoped) {
    // Pause: back to the real account for this page.
    const real = decodeStash(readCookie(DEMO_RETURN_COOKIE));
    if (!real || real.uid !== claim.owner) return NONE;
    const { data: before } = await supabase.auth.getSession();
    const practice = before.session;
    if (!practice || practice.user.id !== current.sub) return NONE;
    const { data, error } = await supabase.auth.refreshSession({ refresh_token: real.rt });
    if (error || data.user?.id !== claim.owner) { await restore(supabase, practice); return NONE; }
    return { swapped: "paused", cookies: [set(PRACTICE_PAUSE_COOKIE, encodeStash({ rt: practice.refresh_token, uid: practice.user.id })), del(DEMO_RETURN_COOKIE), del(DEMO_HINT_COOKIE)] };
  }

  if (!claim && scoped) {
    // Resume a paused practice for the same person.
    const paused = decodeStash(readCookie(PRACTICE_PAUSE_COOKIE));
    if (!paused) return NONE;
    const { data: before } = await supabase.auth.getSession();
    const real = before.session;
    if (!real || real.user.id !== current.sub) return NONE;
    const { data, error } = await supabase.auth.refreshSession({ refresh_token: paused.rt });
    const resumed = parseDemoClaim(data.user?.app_metadata);
    if (error || data.user?.id !== paused.uid || !resumed || resumed.owner !== real.user.id) {
      await restore(supabase, real);
      return { swapped: null, cookies: [del(PRACTICE_PAUSE_COOKIE)] };   // stale or someone else's: forget it
    }
    return { swapped: "resumed", cookies: [set(DEMO_RETURN_COOKIE, encodeStash({ rt: real.refresh_token, uid: real.user.id })), set(DEMO_HINT_COOKIE, resumed.kind, false), del(PRACTICE_PAUSE_COOKIE)] };
  }
  return NONE;
}
