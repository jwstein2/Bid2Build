"use client";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Search, X } from "lucide-react";

type Opt = { value: string; label: string };

/**
 * Customers search, status filter and sort. Everything lives in the URL (?q=&focus=&sort=), so Back,
 * refresh and the metric cards all restore the same view; the server does the filtering.
 */
export function DirectoryControls({ q, focus, sort, focusOptions, sortOptions }: { q: string; focus: string; sort: string; focusOptions: Opt[]; sortOptions: Opt[] }) {
  const router = useRouter();
  const path = usePathname();
  const [text, setText] = useState(q);
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- keep the box in sync when a metric card or Back changes the URL
  useEffect(() => { setText(q); }, [q]);

  const go = (next: { q?: string; focus?: string; sort?: string }) => {
    const p = new URLSearchParams();
    const v = { q: text, focus, sort, ...next };
    if (v.q.trim()) p.set("q", v.q.trim());
    if (v.focus !== "all") p.set("focus", v.focus);
    if (v.sort !== "activity") p.set("sort", v.sort);
    const qs = p.toString();
    start(() => router.replace(qs ? `${path}?${qs}` : path, { scroll: false }));
  };

  return (
    <form role="search" aria-label="Find customers" className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); go({}); }} data-testid="customer-controls" data-guide="customers.controls" aria-busy={pending}>
      <label className="min-w-0 flex-1 basis-64">
        <span className="label">Search</span>
        <span className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <input
            type="search" className="field pl-9 pr-9" value={text} placeholder="Name, email, phone, address or bid"
            onChange={(e) => {
              const v = e.target.value;
              setText(v);
              if (timer.current) clearTimeout(timer.current);
              timer.current = setTimeout(() => go({ q: v }), 300);
            }}
            data-testid="customer-search"
          />
          {text && <button type="button" className="absolute right-1 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-md text-muted hover:text-ink" aria-label="Clear search" onClick={() => { setText(""); go({ q: "" }); }}><X className="h-4 w-4" aria-hidden /></button>}
        </span>
      </label>
      <label className="w-full sm:w-auto">
        <span className="label">Status</span>
        <select className="field w-full sm:w-56" value={focus} onChange={(e) => go({ focus: e.target.value })} data-testid="customer-focus">
          {focusOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      <label className="w-full sm:w-auto">
        <span className="label">Sort by</span>
        <select className="field w-full sm:w-48" value={sort} onChange={(e) => go({ sort: e.target.value })} data-testid="customer-sort">
          {sortOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
    </form>
  );
}
