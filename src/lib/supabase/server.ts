import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { isSupabaseConfigured, publicEnv, serverEnv } from "../env";

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
}

/** Verified server-side user lookup (contacts the Auth server; never trusts the cookie alone). */
export async function getUser(): Promise<SessionUser | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null, emailVerified: Boolean(data.user.email_confirmed_at) };
}
