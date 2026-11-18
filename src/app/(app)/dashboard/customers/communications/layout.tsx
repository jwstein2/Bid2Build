import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/access/server";

/** V6.7: direct-URL guard. A company member whose access settings turn this off is sent to /no-access (records untouched). */
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireCapability(await createClient(), "communications");
  return children;
}
