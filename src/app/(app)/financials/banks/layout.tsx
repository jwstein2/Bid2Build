import { createClient } from "@/lib/supabase/server";
import { requireAnyCapability } from "@/lib/access/server";

/** V6.7 direct-URL guard; the page and every RPC re-check the financial permission. */
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireAnyCapability(await createClient(), ["bank"]);
  return children;
}
