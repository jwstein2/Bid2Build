"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

/**
 * "My Sales Hub | Admin Sales Hub". Shown only to people with both. Switching changes the view, never
 * the role: the server checks capabilities on every page and action either way. The choice is
 * remembered (sales_view cookie) so /sales opens where they left off.
 */
export function HubSwitcher() {
  const path = usePathname();
  const admin = path.startsWith("/sales/admin");
  const item = (on: boolean) => cn("inline-flex min-h-9 items-center rounded-md px-3 text-sm font-semibold", on ? "bg-white text-navy" : "text-white/80 hover:bg-white/10 hover:text-white");
  return (
    <nav aria-label="Choose hub" className="inline-flex rounded-lg bg-white/10 p-0.5">
      <Link href="/sales/view?to=my" aria-current={!admin ? "page" : undefined} className={item(!admin)}>My Sales Hub</Link>
      <Link href="/sales/view?to=admin" aria-current={admin ? "page" : undefined} className={item(admin)}>Admin Sales Hub</Link>
    </nav>
  );
}
