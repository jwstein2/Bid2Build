import { NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/http/redirect";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));
  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      if (url.searchParams.get("marketing") === "1") {
        await supabase.from("profiles").update({ marketing_opt_in: true, marketing_opt_in_at: new Date().toISOString() }).eq("id", data.user.id);
      }
      try { await createAdminClient().from("analytics_events").insert({ user_id: data.user.id, event: "account_created" }); } catch { /* best effort */ }
      return NextResponse.redirect(new URL(next, url.origin));
    }
  }
  return NextResponse.redirect(new URL(`/login?error=link&next=${encodeURIComponent(next)}`, url.origin));
}
