import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/access/server";

/** Same access as Team & Subcontractors (V6.7 "Team, subs & suppliers"). */
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireCapability(await createClient(), "team_directory");
  return children;
}
