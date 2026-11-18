import { createClient } from "@/lib/supabase/server";
import { requireAnyCapability } from "@/lib/access/server";

/** V6.7: direct-URL guard. A company member whose access settings turn this off is sent to /no-access (records untouched). */
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireAnyCapability(await createClient(), ["fin_visibility", "invoices", "payments", "expenses", "bills", "bank", "ledger", "exports", "sub_compliance", "fin_settings"]);
  return children;
}
