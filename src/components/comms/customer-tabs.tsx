import Link from "next/link";
import { cn } from "@/lib/cn";
import { Lock } from "lucide-react";

/** Customers section tabs: the directory (every plan) and Communications (Project Command Center). */
export function CustomerTabs({ active, pm }: { active: "directory" | "communications"; pm: boolean }) {
  const cls = (on: boolean) => cn("inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold", on ? "bg-navy text-white" : "text-ink-soft hover:bg-black/5");
  return (
    <nav aria-label="Customers" className="flex flex-wrap gap-1" data-testid="customer-tabs">
      <Link href="/dashboard/customers" className={cls(active === "directory")} aria-current={active === "directory" ? "page" : undefined}>Directory</Link>
      <Link href="/dashboard/customers/communications" className={cls(active === "communications")} aria-current={active === "communications" ? "page" : undefined}>
        Communications {!pm && <Lock className="h-3.5 w-3.5" aria-label="Project Command Center feature" />}
      </Link>
    </nav>
  );
}
