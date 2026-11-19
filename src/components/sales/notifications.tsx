import Link from "next/link";

export interface SalesNotice { category: "personal" | "admin"; kind: string; count: number; href: string }

const TEXT: Record<string, (n: number) => string> = {
  tasks_overdue: (n) => `${n} follow-up${n === 1 ? "" : "s"} overdue`,
  box_ready: (n) => `${n} gift box${n === 1 ? "" : "es"} ready to open`,
  statements_to_approve: (n) => `${n} statement${n === 1 ? "" : "s"} to approve`,
  boxes_to_approve: (n) => `${n} milestone bonus${n === 1 ? "" : "es"} to approve`,
  leads_unassigned: (n) => `${n} lead${n === 1 ? "" : "s"} waiting for a rep`,
  payouts_to_record: (n) => `${n} approved statement${n === 1 ? "" : "s"} to pay and record`,
};

/**
 * One notification menu for everyone in the portal, in Personal and Administrative groups (a person sees
 * only the groups their roles have). Items come from sales_my_notifications, which lists each item once.
 * Plain <details>, so it works without client JavaScript.
 */
export function SalesNotifications({ items, showGroups }: { items: SalesNotice[]; showGroups: boolean }) {
  const total = items.reduce((t, i) => t + i.count, 0);
  const groups: [SalesNotice["category"], string][] = [["personal", "Personal"], ["admin", "Administrative"]];
  return (
    <details className="relative">
      <summary aria-label={total ? `Notifications: ${total}` : "Notifications"} className="flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center rounded-md text-white/85 hover:bg-white/10 [&::-webkit-details-marker]:hidden">
        <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2}><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
        {total > 0 && <span className="absolute right-1 top-1 min-w-4 rounded-full bg-accent px-1 text-center text-[10px] font-bold leading-4 text-white">{total > 99 ? "99+" : total}</span>}
      </summary>
      <div className="absolute right-0 z-30 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-white p-2 text-ink shadow-lg">
        {items.length === 0 && <p className="p-3 text-sm text-ink-soft">You&apos;re all caught up.</p>}
        {groups.map(([cat, label]) => {
          const list = items.filter((i) => i.category === cat);
          if (!list.length) return null;
          return (
            <div key={cat} className="py-1">
              {showGroups && <p className="px-3 pb-1 text-xs font-bold uppercase tracking-wide text-muted">{label}</p>}
              <ul>{list.map((i) => <li key={i.kind}><Link href={i.href} className="block rounded-md px-3 py-2 text-sm hover:bg-paper">{TEXT[i.kind]?.(i.count) ?? `${i.count} ${i.kind}`}</Link></li>)}</ul>
            </div>
          );
        })}
      </div>
    </details>
  );
}
