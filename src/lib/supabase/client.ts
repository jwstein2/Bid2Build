"use client";
import { createBrowserClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseConfigured, publicEnv } from "../env";

let client: ReturnType<typeof createBrowserClient> | null = null;
export function getBrowserClient() {
  if (!isSupabaseConfigured()) return null;
  client ??= createBrowserClient(publicEnv.supabaseUrl, publicEnv.supabaseKey);
  return client;
}

let otpClient: SupabaseClient | null = null;
/**
 * Sends sign-in emails with the implicit flow. Its links return the session in the
 * URL fragment, so they work in any browser or device (the Gmail app, a phone).
 * PKCE links only work in the browser that asked for them. /auth/finish turns the
 * fragment into the normal cookie session; this client never stores anything.
 */
export function getOtpClient() {
  if (!isSupabaseConfigured()) return null;
  otpClient ??= createClient(publicEnv.supabaseUrl, publicEnv.supabaseKey, {
    auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return otpClient;
}
