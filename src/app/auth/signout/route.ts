import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { PRACTICE_PAUSE_COOKIE } from "@/lib/demo/scope";

export async function POST(request: Request) {
  if (isSupabaseConfigured()) await (await createClient()).auth.signOut();
  const res = NextResponse.redirect(new URL("/", request.url), { status: 303 });
  // A paused practice session never outlives signing out (the next person on this browser can't resume it anyway).
  res.cookies.set(PRACTICE_PAUSE_COOKIE, "", { maxAge: 0, path: "/" });
  return res;
}
