"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { GroupId, SearchKind } from "@/lib/search/kinds";

type Props = {
  q: string; group: GroupId | null; groups: { id: GroupId; label: string; kinds: SearchKind[] }[];
  status: string | null; statusChoices: { value: string; label: string }[];
  trade: string | null; trades: { slug: string; name: string }[];
  person: string | null; people: { id: string; name: string }[];
  from: string | null; to: string | null; sort: string;
  customer: string | null; project: string | null; scope: "all" | "project"; hasContext: boolean;
};

const field = "min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink";
const label = "block text-xs font-semibold text-ink-soft";

/** Results page filters. Every change updates the URL (so Back returns to the same query and filters). */
export function SearchFilters(p: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const [q, setQ] = useState(p.q);
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(Boolean(p.status || p.trade || p.person || p.from || p.to));
  // eslint-disable-next-line react-hooks/set-state-in-effect -- keep the box in step with Back / Forward
  useEffect(() => setQ(p.q), [p.q]);
  const go = (patch: Record<string, string | null>) => {
    const n = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) { if (v == null || v === "") n.delete(k); else n.set(k, v); }
    n.delete("page");
    start(() => router.push(`/search?${n}`));
  };
  const chip = (text: string, clear: Record<string, null>) => (
    <button type="button" onClick={() => go(clear)} className="inline-flex min-h-8 items-center gap-1 rounded-full bg-accent-tint px-2.5 text-xs font-semibold text-accent-dark">
      {text}<X className="h-3.5 w-3.5" aria-label="Remove filter" />
    </button>
  );
  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface p-3 sm:p-4" aria-busy={pending}>
      <form role="search" onSubmit={(e) => { e.preventDefault(); go({ q: q.trim() || null }); }} className="flex gap-2">
        <label htmlFor="search-page-q" className="sr-only">Search</label>
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cool-gray" aria-hidden />
          <input id="search-page-q" value={q} onChange={(e) => setQ(e.target.value)} maxLength={100} placeholder="Search everything" className={cn(field, "pl-9")} data-testid="search-page-input" autoComplete="off" />
        </div>
        <button type="submit" className="min-h-11 rounded-lg bg-brand px-4 text-sm font-semibold text-white">Search</button>
      </form>
      <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Category">
        {[{ id: null as GroupId | null, label: "All", kinds: [] as SearchKind[] }, ...p.groups].map((g) => (
          <button key={g.id ?? "all"} type="button" role="tab" aria-selected={p.group === g.id} onClick={() => go({ type: g.id ? g.kinds.join(",") : null, status: null })} data-testid={`search-cat-${g.id ?? "all"}`}
            className={cn("min-h-9 shrink-0 whitespace-nowrap rounded-full border px-3 text-xs font-semibold", p.group === g.id ? "border-brand bg-brand text-white" : "border-line text-ink-soft hover:bg-paper")}>
            {g.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {p.hasContext && (
          <div role="radiogroup" aria-label="Search where" className="inline-flex rounded-lg border border-line p-0.5 text-xs">
            {(["all", "project"] as const).map((s) => (
              <button key={s} type="button" role="radio" aria-checked={p.scope === s} onClick={() => go({ scope: s === "project" ? "project" : null })}
                className={cn("min-h-8 rounded-md px-2.5 font-semibold", p.scope === s ? "bg-brand text-white" : "text-ink-soft hover:bg-black/5")}>{s === "all" ? "All company records" : "This project"}</button>
            ))}
          </div>
        )}
        {p.customer && chip("This customer", { customer: null })}
        {p.project && chip("This project", { project: null })}
        {p.status && chip(`Status: ${p.statusChoices.find((c) => c.value === p.status)?.label ?? p.status.replace(/[_,]/g, " ")}`, { status: null })}
        {p.trade && chip(`Trade: ${p.trades.find((t) => t.slug === p.trade)?.name ?? p.trade}`, { trade: null })}
        {p.person && chip(`Person: ${p.people.find((x) => x.id === p.person)?.name ?? "selected"}`, { person: null })}
        {(p.from || p.to) && chip(`Dates: ${p.from ?? "…"} to ${p.to ?? "…"}`, { from: null, to: null })}
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="search-more-filters" className="ml-auto inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-semibold">
          <SlidersHorizontal className="h-4 w-4" aria-hidden />Filters
        </button>
        <label className="sr-only" htmlFor="search-sort">Sort</label>
        <select id="search-sort" value={p.sort} onChange={(e) => go({ sort: e.target.value === "relevance" ? null : e.target.value })} className="min-h-9 rounded-lg border border-line bg-surface px-2 text-xs font-semibold" data-testid="search-sort">
          <option value="relevance">Best match</option><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="name">Name A–Z</option>
        </select>
      </div>
      {open && (
        <div id="search-more-filters" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {p.statusChoices.length > 0 ? (
            <label className={label}>Status
              <select value={p.status ?? ""} onChange={(e) => go({ status: e.target.value || null })} className={cn(field, "mt-1")} data-testid="search-status">
                <option value="">Any</option>{p.statusChoices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </label>
          ) : <p className="self-end text-xs text-muted">Pick a category for status filters.</p>}
          <label className={label}>Trade
            <select value={p.trade ?? ""} onChange={(e) => go({ trade: e.target.value || null })} className={cn(field, "mt-1")} data-testid="search-trade">
              <option value="">Any trade</option>{p.trades.map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}
            </select>
          </label>
          {p.people.length > 0 && (
            <label className={label}>Assigned / PM
              <select value={p.person ?? ""} onChange={(e) => go({ person: e.target.value || null })} className={cn(field, "mt-1")} data-testid="search-person">
                <option value="">Anyone</option>{p.people.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </label>
          )}
          <div className="grid grid-cols-2 gap-2">
            <label className={label}>From<input type="date" value={p.from ?? ""} onChange={(e) => go({ from: e.target.value || null })} className={cn(field, "mt-1 px-2")} data-testid="search-from" /></label>
            <label className={label}>To<input type="date" value={p.to ?? ""} onChange={(e) => go({ to: e.target.value || null })} className={cn(field, "mt-1 px-2")} data-testid="search-to" /></label>
          </div>
        </div>
      )}
    </div>
  );
}

/** Per-user search preferences: keep history or not, clear it. */
export function SearchSettings() {
  const [state, setState] = useState<{ historyEnabled: boolean; queries: string[]; records: unknown[] } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => fetch("/api/search/recent", { cache: "no-store" }).then((r) => r.json()).then(setState).catch(() => setState(null));
  useEffect(() => { load(); }, []);
  const post = async (body: object, done: string) => {
    const r = await fetch("/api/search/history", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    setMsg(r.ok ? done : "That didn't save. Try again.");
    load();
  };
  return (
    <section className="rounded-xl border border-line bg-surface p-4" aria-labelledby="search-settings-h" data-testid="search-settings">
      <h2 id="search-settings-h" className="font-display text-lg font-extrabold">Search settings</h2>
      <p className="mt-1 text-sm text-ink-soft">Only you can see your recent searches. Records you no longer have access to drop off automatically.</p>
      {state && (
        <div className="mt-3 space-y-3">
          <label className="flex min-h-11 items-center gap-3 text-sm font-semibold">
            <input type="checkbox" checked={state.historyEnabled} onChange={(e) => post({ action: "prefs", historyEnabled: e.target.checked }, e.target.checked ? "Search history is on." : "Search history is off and cleared.")} className="h-5 w-5" data-testid="search-history-toggle" />
            Keep my recent searches and recently opened records
          </label>
          <button type="button" onClick={() => post({ action: "forget" }, "Search history cleared.")} className="min-h-10 rounded-lg border border-line px-3 text-sm font-semibold" data-testid="search-history-clear">
            Clear search history ({state.queries.length + state.records.length})
          </button>
          <p className="text-xs text-muted">Shortcut: press Ctrl K (⌘ K on a Mac) on any screen.</p>
        </div>
      )}
      {msg && <p className="mt-2 text-sm text-ok" role="status">{msg}</p>}
    </section>
  );
}
