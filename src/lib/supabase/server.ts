import "server-only";
import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { isSupabaseConfigured, publicEnv, serverEnv } from "../env";
import { THEME_META_KEY, parseThemePref, type ThemePref } from "../theme";

/** Supabase client acting as the signed-in user (RLS enforced). */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(publicEnv.supabaseUrl, publicEnv.supabaseKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component: the proxy refreshes the session instead.
        }
      },
    },
  });
}

/** Service-role client. Bypasses RLS: use only in server routes after authorizing the caller. */
export function createAdminClient() {
  const key = serverEnv().supabaseServiceKey;
  if (!publicEnv.supabaseUrl || !key) throw new Error("Supabase service credentials are not configured");
  return createSupabaseClient(publicEnv.supabaseUrl, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export interface SessionUser {
  id: string;
  email: string | null;
  emailVerified: boolean;
  /** E.164 ("+15551234567") once a phone is on the account, else null. */
  phone: string | null;
  phoneVerified: boolean;
  /** Proved control of the email OR the phone. Gates exports, credits and checkout. */
  verified: boolean;
  /** Saved Light/Dark/Black choice (auth user_metadata.b2b_theme); undefined when never chosen. */
  theme?: ThemePref;
  /** When the account was created (ISO), for the 7-day activation window. */
  createdAt?: string | null;
}

/**
 * The verified Supabase auth user for this request (contacts the Auth server; never trusts the cookie
 * alone). Cached per server request with React cache(), so the layout, the page and helpers that all
 * ask "who is signed in?" share one Auth round trip instead of making one each.
 */
export const getAuthUser = cache(async (): Promise<User | null> => {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
});

/** Verified server-side user lookup (one Auth round trip per request, shared via getAuthUser). */
export async function getUser(): Promise<SessionUser | null> {
  const user = await getAuthUser();
  return user ? sessionUserFrom(user) : null;
}

/** Supabase stores phones as digits without "+"; normalise to E.164 for the app. */
export function sessionUserFrom(u: { id: string; email?: string | null; email_confirmed_at?: string | null; phone?: string | null; phone_confirmed_at?: string | null; created_at?: string | null; user_metadata?: Record<string, unknown> | null }): SessionUser {
  const emailVerified = Boolean(u.email && u.email_confirmed_at);
  const digits = (u.phone ?? "").replace(/\D/g, "");
  const phoneVerified = Boolean(digits && u.phone_confirmed_at);
  const theme = parseThemePref(u.user_metadata?.[THEME_META_KEY]);
  return { id: u.id, email: u.email || null, emailVerified, phone: digits ? `+${digits}` : null, phoneVerified, verified: emailVerified || phoneVerified, ...(u.created_at ? { createdAt: u.created_at } : {}), ...(theme ? { theme } : {}) };
}
