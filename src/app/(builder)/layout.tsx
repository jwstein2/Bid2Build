import { getUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { AppShell } from "@/components/layout/app-shell";

/**
 * Bid builder routes (/start/[trade], /builder, /estimates/[id]). Signed in, they open inside the app
 * sidebar so "Create New Bid" and an open bid stay in the app. Signed out (free drafts from the public
 * trade pages) they stay full screen, as before.
 */
export default async function BuilderLayout({ children }: { children: React.ReactNode }) {
  if (!isSupabaseConfigured()) return children;
  const user = await getUser();
  if (!user) return children;
  return <AppShell user={user} bare>{children}</AppShell>;
}
