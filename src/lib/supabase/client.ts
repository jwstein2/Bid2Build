"use client";
import { createBrowserClient } from "@supabase/ssr";
import { isSupabaseConfigured, publicEnv } from "../env";

let client: ReturnType<typeof createBrowserClient> | null = null;
export function getBrowserClient() {
  if (!isSupabaseConfigured()) return null;
  client ??= createBrowserClient(publicEnv.supabaseUrl, publicEnv.supabaseKey);
  return client;
}
