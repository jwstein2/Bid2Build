"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { Loader2, Search, X } from "lucide-react";

const input = "w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm";

/**
 * The main code search box. It stays in step with the URL (the page remounts it per query, so a stale question never
 * lingers), shows a quiet "Searching…" state while the results load, and has a clear button.
 */
export function SearchBox({ q, hidden, children }: { q: string; hidden: Record<string, string | null>; children?: ReactNode }) {
  const router = useRouter();
  const [value, setValue] = useState(q);
  const [pending, start] = useTransition();
  const go = (params: URLSearchParams) => start(() => router.push(`/academy/codes${params.size ? `?${params}` : ""}`));

  return (
    <form
      action="/academy/codes"
      role="search"
      className="mt-4"
      onSubmit={(e) => {
        e.preventDefault();
        const params = new URLSearchParams();
        new FormData(e.currentTarget).forEach((v, k) => { if (typeof v === "string" && v.trim()) params.set(k, v.trim()); });
        go(params);
      }}
    >
      {Object.entries(hidden).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <div className="relative">
          <label htmlFor="kb-q" className="sr-only">Ask a construction code question or enter a code section</label>
          <Search className="pointer-events-none absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-muted" aria-hidden />
          <input id="kb-q" name="q" value={value} onChange={(e) => setValue(e.target.value)} maxLength={300} autoComplete="off" enterKeyHint="search"
            placeholder="Ask a construction code question or enter a code section..." className={`${input} min-h-12 py-3 pr-10 pl-10 text-base`} data-testid="kb-q" />
          {value && (
            <button type="button" aria-label="Clear search" data-testid="kb-clear"
              onClick={() => {
                setValue("");
                if (q) { const p = new URLSearchParams(); Object.entries(hidden).forEach(([k, v]) => { if (v) p.set(k, v); }); go(p); }
              }}
              className="absolute top-1/2 right-2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-muted hover:bg-paper hover:text-ink">
              <X className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>
        <button type="submit" disabled={pending} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-navy px-6 text-sm font-semibold text-white disabled:opacity-80" data-testid="kb-search">
          {pending ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Searching…</> : "Search"}
        </button>
      </div>
      <p className="sr-only" aria-live="polite">{pending ? "Searching" : ""}</p>
      {children}
    </form>
  );
}
